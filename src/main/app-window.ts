import { trustedIpcMain as ipcMain } from "./trusted-ipc";
/**
 * Creates and configures the application's Electron browser window.
 */
import { is } from "@electron-toolkit/utils";
import { app, BrowserWindow } from "electron";
import path from "path";
import { pathToFileURL } from "node:url";
import { registerTrustedRenderer } from "./trusted-ipc";

import { isShortcutOverrides, matchesShortcut } from "@shared/keyboard-shortcuts";

import ConfigManager from "./app-config";
import { openExternalUrl } from "./external-links";

const APP_CLOSE_TIMEOUT_MS = 10_000;
let nextCloseRequestId = 0;
let applicationQuitRequested = false;
const applicationWindows = new Set<BrowserWindow>();
const rememberApplicationQuit = () => {
  applicationQuitRequested = true;
};

interface CreateWindowOptions {
  activate?: boolean;
}

export const createWindow = ({ activate = true }: CreateWindowOptions = {}): void => {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    center: true,
    title: "obim",
    // macOS supplies traffic lights for the hidden title bar. Other platforms
    // retain their native frame, including its window controls and system menu.
    ...(process.platform === "darwin"
      ? { frame: false, titleBarStyle: "hidden" as const, trafficLightPosition: { x: 15, y: 10 } }
      : { frame: true }),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  if (applicationWindows.size === 0) app.on("before-quit", rememberApplicationQuit);
  applicationWindows.add(window);

  const rendererFile = path.join(__dirname, "../renderer/index.html");
  const rendererUrl = is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined;
  registerTrustedRenderer(window.webContents, rendererUrl ?? pathToFileURL(rendererFile).href);

  if (process.platform === "darwin") {
    window.setWindowButtonVisibility(ConfigManager.getShowWindowControlsSync());
  }
  window.webContents.setZoomFactor(ConfigManager.getZoomFactorSync());

  let closeApproved = false;
  let pendingCloseRequestId: number | null = null;
  let closeTimeout: ReturnType<typeof setTimeout> | undefined;
  let pdfViewerHasShortcutFocus = false;

  const clearCloseRequest = () => {
    if (closeTimeout) clearTimeout(closeTimeout);
    closeTimeout = undefined;
    pendingCloseRequestId = null;
  };

  const handleCloseResponse = (event: Electron.IpcMainEvent, response: { requestId?: unknown; allow?: unknown }) => {
    if (
      event.sender !== window.webContents ||
      typeof response?.requestId !== "number" ||
      typeof response.allow !== "boolean" ||
      response.requestId !== pendingCloseRequestId
    )
      return;

    clearCloseRequest();
    if (!response.allow) {
      applicationQuitRequested = false;
      return;
    }
    closeApproved = true;
    // Preventing the initial close also cancels Electron's app.quit(). Resume
    // that intent after saving; ordinary macOS window closes remain backgrounded.
    if (applicationQuitRequested) app.quit();
    else window.close();
  };

  const handleFocusWindow = (event: Electron.IpcMainEvent) => {
    if (event.sender !== window.webContents || window.isDestroyed()) return;
    window.focus();
    window.webContents.focus();
  };

  const handlePdfViewerShortcutFocus = (event: Electron.IpcMainEvent, focused: unknown) => {
    if (event.sender !== window.webContents || typeof focused !== "boolean") return;
    pdfViewerHasShortcutFocus = focused;
  };

  const readShortcutBindings = () => {
    const value = ConfigManager.getConfigValueSync("keyboardShortcuts");
    return isShortcutOverrides(value) ? value : {};
  };
  let shortcutBindings = readShortcutBindings();
  const unsubscribeShortcuts = ConfigManager.onConfigChange((keys) => {
    if (keys.includes("keyboardShortcuts")) shortcutBindings = readShortcutBindings();
  });
  let shortcutRecording = false;
  const handleShortcutRecording = (event: Electron.IpcMainEvent, recording: unknown) => {
    if (event.sender !== window.webContents || typeof recording !== "boolean") return;
    shortcutRecording = recording;
    window.webContents.setIgnoreMenuShortcuts(recording);
  };
  ipcMain.on("shortcut-recording", handleShortcutRecording);
  ipcMain.on("app-close-response", handleCloseResponse);
  ipcMain.on("focus-app-window", handleFocusWindow);
  ipcMain.on("pdf-viewer-shortcut-focus", handlePdfViewerShortcutFocus);

  window.on("close", (event) => {
    if (closeApproved || window.webContents.isDestroyed()) return;
    event.preventDefault();
    if (pendingCloseRequestId !== null) return;

    const requestId = ++nextCloseRequestId;
    pendingCloseRequestId = requestId;
    window.webContents.send("app-close-requested", requestId);
    closeTimeout = setTimeout(() => {
      if (pendingCloseRequestId !== requestId) return;
      clearCloseRequest();
      applicationQuitRequested = false;
      // The renderer owns the user-facing timeout notification. Avoid writing here: during app
      // shutdown (and electron-vite restarts) stdout/stderr may already be detached, and a console
      // write can itself throw EIO in the main process.
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send("app-close-timeout");
      }
    }, APP_CLOSE_TIMEOUT_MS);
  });

  window.on("closed", () => {
    clearCloseRequest();
    applicationWindows.delete(window);
    if (applicationWindows.size === 0) {
      applicationQuitRequested = false;
      app.removeListener("before-quit", rememberApplicationQuit);
    }
    unsubscribeShortcuts();
    ipcMain.removeListener("shortcut-recording", handleShortcutRecording);
    ipcMain.removeListener("app-close-response", handleCloseResponse);
    ipcMain.removeListener("focus-app-window", handleFocusWindow);
    ipcMain.removeListener("pdf-viewer-shortcut-focus", handlePdfViewerShortcutFocus);
  });

  window.once("ready-to-show", () => {
    // electron-vite restarts the main process after watched main-process changes.
    // Activating the replacement window makes AeroSpace follow it to another
    // workspace, so keep macOS development restarts visible but inactive.
    if (activate) window.show();
    else window.showInactive();
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || shortcutRecording) return;
    const bindings = shortcutBindings;
    const keyInput = {
      key: input.key,
      code: input.code,
      ctrlKey: input.control,
      metaKey: input.meta,
      altKey: input.alt,
      shiftKey: input.shift,
    };
    const matches = (id: Parameters<typeof matchesShortcut>[0]) =>
      matchesShortcut(id, keyInput, bindings, process.platform === "darwin");
    const tabShortcut = input.isAutoRepeat
      ? null
      : matches("close-current-tab")
        ? "close-current-tab"
        : matches("reopen-last-closed-tab")
          ? "reopen-last-closed-tab"
          : null;
    const zoomShortcut = matches("zoom-in")
      ? "in"
      : matches("zoom-out")
        ? "out"
        : matches("zoom-reset")
          ? "reset"
          : null;

    if (tabShortcut) {
      event.preventDefault();
      window.webContents.send(`${tabShortcut}-shortcut`);
    } else if (zoomShortcut && pdfViewerHasShortcutFocus) {
      event.preventDefault();
      window.webContents.send("pdf-zoom-shortcut", zoomShortcut);
    } else if (zoomShortcut === "in") {
      event.preventDefault();
      const zoomFactor = Math.min(2, Math.round((window.webContents.getZoomFactor() + 0.1) * 10) / 10);
      window.webContents.setZoomFactor(zoomFactor);
      void ConfigManager.updateConfig("zoomFactor", zoomFactor);
    } else if (zoomShortcut === "out") {
      event.preventDefault();
      const zoomFactor = Math.max(0.5, Math.round((window.webContents.getZoomFactor() - 0.1) * 10) / 10);
      window.webContents.setZoomFactor(zoomFactor);
      void ConfigManager.updateConfig("zoomFactor", zoomFactor);
    } else if (zoomShortcut === "reset") {
      event.preventDefault();
      window.webContents.setZoomFactor(1);
      void ConfigManager.updateConfig("zoomFactor", 1);
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url).catch((error) => console.error("Error opening external link:", error));
    return { action: "deny" };
  });

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(rendererFile);
  }
};
