import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  windowOptions: vi.fn(),
  shortcuts: {} as Record<string, string[]>,
  webListeners: new Map<string, (...args: unknown[]) => void>(),
  ignoreMenuShortcuts: vi.fn(),
  appListeners: new Map<string, (...args: unknown[]) => void>(),
  quit: vi.fn(),
  webContents: undefined as undefined | { mainFrame: { url: string } },
  close: vi.fn(),
  ipcListeners: new Map<string, (...args: unknown[]) => void>(),
  loadFile: vi.fn(() => Promise.resolve()),
  send: vi.fn(),
  windowListeners: new Map<string, (...args: unknown[]) => void>(),
}));

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));
vi.mock("electron", async () => {
  const { pathToFileURL } = await import("node:url");
  return {
    app: {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => mocks.appListeners.set(event, listener)),
      removeListener: vi.fn((event: string) => mocks.appListeners.delete(event)),
      quit: mocks.quit,
    },
    BrowserWindow: class {
      constructor(options: unknown) {
        mocks.windowOptions(options);
        mocks.webContents = this.webContents;
      }
      webContents = {
        mainFrame: { url: "" },
        focus: vi.fn(),
        getZoomFactor: vi.fn(() => 1),
        isDestroyed: vi.fn(() => false),
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => mocks.webListeners.set(event, listener)),
        setIgnoreMenuShortcuts: mocks.ignoreMenuShortcuts,
        once: vi.fn(),
        send: mocks.send,
        setWindowOpenHandler: vi.fn(),
        setZoomFactor: vi.fn(),
      };

      close = mocks.close;
      focus = vi.fn();
      isDestroyed = vi.fn(() => false);
      loadFile = (file: string) => {
        this.webContents.mainFrame.url = pathToFileURL(file).href;
        return mocks.loadFile();
      };
      on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        mocks.windowListeners.set(event, listener);
        return this;
      });
      once = vi.fn();
      setWindowButtonVisibility = vi.fn();
      setZoomFactor = vi.fn();
      show = vi.fn();
      showInactive = vi.fn();
    },
    ipcMain: {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        mocks.ipcListeners.set(event, listener);
      }),
      removeListener: vi.fn(),
    },
  };
});
vi.mock("../src/main/app-config", () => ({
  default: {
    getConfigValueSync: vi.fn(() => mocks.shortcuts),
    onConfigChange: vi.fn(() => vi.fn()),
    getShowWindowControlsSync: vi.fn(() => true),
    getZoomFactorSync: vi.fn(() => 1),
    updateConfig: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("../src/main/external-links", () => ({
  openExternalUrl: vi.fn(() => Promise.resolve()),
}));

import { createWindow } from "../src/main/app-window";

afterEach(() => {
  mocks.windowListeners.get("closed")?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.close.mockClear();
  mocks.loadFile.mockClear();
  mocks.send.mockClear();
  mocks.ipcListeners.clear();
  mocks.windowListeners.clear();
  mocks.windowOptions.mockClear();
  mocks.appListeners.clear();
  mocks.quit.mockClear();
  mocks.webContents = undefined;
  mocks.shortcuts = {};
  mocks.webListeners.clear();
  mocks.ignoreMenuShortcuts.mockClear();
});

describe("platform window chrome", () => {
  it.each(["win32", "linux"])("keeps native controls on %s", (platform) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform as NodeJS.Platform);
    createWindow();
    const options = mocks.windowOptions.mock.calls[0][0];
    expect(options.frame).toBe(true);
    expect(options.titleBarStyle).toBeUndefined();
    expect(options.trafficLightPosition).toBeUndefined();
  });

  it("preserves macOS hidden-title-bar traffic lights", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    createWindow();
    expect(mocks.windowOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        frame: false,
        titleBarStyle: "hidden",
        trafficLightPosition: { x: 15, y: 10 },
      }),
    );
  });
});

describe("application window close guard", () => {
  it("resumes an application quit only after the trusted renderer approves saving", () => {
    createWindow();
    mocks.appListeners.get("before-quit")?.();
    const preventDefault = vi.fn();
    mocks.windowListeners.get("close")?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.quit).not.toHaveBeenCalled();
    const requestId = mocks.send.mock.calls.at(-1)![1];
    const sender = mocks.webContents!;
    mocks.ipcListeners.get("app-close-response")?.(
      { sender, senderFrame: sender.mainFrame },
      { requestId, allow: true },
    );
    expect(mocks.quit).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
    const resumedPreventDefault = vi.fn();
    mocks.windowListeners.get("close")?.({ preventDefault: resumedPreventDefault });
    expect(resumedPreventDefault).not.toHaveBeenCalled();
  });

  it("keeps an ordinary approved macOS window close separate from application quit", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    createWindow();
    mocks.windowListeners.get("close")?.({ preventDefault: vi.fn() });
    const requestId = mocks.send.mock.calls.at(-1)![1];
    const sender = mocks.webContents!;
    mocks.ipcListeners.get("app-close-response")?.(
      { sender, senderFrame: sender.mainFrame },
      { requestId, allow: true },
    );
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.quit).not.toHaveBeenCalled();
  });

  it.each(["denied", "timed out"])("forgets a %s quit before a later ordinary window close", (resolution) => {
    vi.useFakeTimers();
    createWindow();
    mocks.appListeners.get("before-quit")?.();
    mocks.windowListeners.get("close")?.({ preventDefault: vi.fn() });
    const requestId = mocks.send.mock.calls.at(-1)![1];
    const sender = mocks.webContents!;
    if (resolution === "denied") {
      mocks.ipcListeners.get("app-close-response")?.(
        { sender, senderFrame: sender.mainFrame },
        { requestId, allow: false },
      );
    } else vi.advanceTimersByTime(10_000);
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.quit).not.toHaveBeenCalled();
    // A delayed approval for the abandoned request cannot close or quit.
    mocks.ipcListeners.get("app-close-response")?.(
      { sender, senderFrame: sender.mainFrame },
      { requestId, allow: true },
    );
    expect(mocks.close).not.toHaveBeenCalled();
    mocks.windowListeners.get("close")?.({ preventDefault: vi.fn() });
    const nextRequestId = mocks.send.mock.calls.at(-1)![1];
    expect(nextRequestId).not.toBe(requestId);
    mocks.ipcListeners.get("app-close-response")?.(
      { sender, senderFrame: sender.mainFrame },
      { requestId: nextRequestId, allow: true },
    );
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.quit).not.toHaveBeenCalled();
  });

  it("adopts quit intent during a pending close without creating a duplicate save request", () => {
    createWindow();
    mocks.windowListeners.get("close")?.({ preventDefault: vi.fn() });
    const requestId = mocks.send.mock.calls.at(-1)![1];
    mocks.appListeners.get("before-quit")?.();
    mocks.windowListeners.get("close")?.({ preventDefault: vi.fn() });
    expect(mocks.send.mock.calls.filter(([channel]) => channel === "app-close-requested")).toHaveLength(1);
    const sender = mocks.webContents!;
    mocks.ipcListeners.get("app-close-response")?.(
      { sender, senderFrame: sender.mainFrame },
      { requestId, allow: true },
    );
    expect(mocks.quit).toHaveBeenCalledOnce();
  });

  it("does not accept quit approval from a child frame or mismatched request", () => {
    createWindow();
    mocks.appListeners.get("before-quit")?.();
    mocks.windowListeners.get("close")?.({ preventDefault: vi.fn() });
    const requestId = mocks.send.mock.calls.at(-1)![1];
    const sender = mocks.webContents!;
    mocks.ipcListeners.get("app-close-response")?.(
      { sender, senderFrame: { url: sender.mainFrame.url } },
      { requestId, allow: true },
    );
    mocks.ipcListeners.get("app-close-response")?.(
      { sender, senderFrame: sender.mainFrame },
      { requestId: requestId + 1, allow: true },
    );
    expect(mocks.quit).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("notifies the renderer without touching detached stderr when saving times out", () => {
    vi.useFakeTimers();
    const stderrError = Object.assign(new Error("write EIO"), { code: "EIO" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      throw stderrError;
    });
    createWindow();
    const closeListener = mocks.windowListeners.get("close") as
      ((event: { preventDefault: () => void }) => void) | undefined;
    const preventDefault = vi.fn();

    closeListener?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith("app-close-requested", expect.any(Number));

    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenLastCalledWith("app-close-timeout");
  });
});

describe("custom native shortcuts", () => {
  it("loads saved tab bindings and suspends interception while recording", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    mocks.shortcuts = { "close-current-tab": ["Mod+Shift+J"] };
    createWindow();
    const input = (key: string, shift = false) => ({
      type: "keyDown",
      key,
      shift,
      control: true,
      meta: false,
      alt: false,
      isAutoRepeat: false,
    });
    const beforeInput = mocks.webListeners.get("before-input-event")!;
    const preventDefault = vi.fn();
    beforeInput({ preventDefault }, input("w"));
    expect(preventDefault).not.toHaveBeenCalled();
    beforeInput({ preventDefault }, input("j", true));
    expect(mocks.send).toHaveBeenCalledWith("close-current-tab-shortcut");
    mocks.send.mockClear();
    const sender = mocks.webContents!;
    mocks.ipcListeners.get("shortcut-recording")?.({ sender, senderFrame: sender.mainFrame }, true);
    beforeInput({ preventDefault }, input("j", true));
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.ignoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    mocks.ipcListeners.get("shortcut-recording")?.({ sender, senderFrame: sender.mainFrame }, false);
    beforeInput({ preventDefault }, input("j", true));
    expect(mocks.send).toHaveBeenCalledWith("close-current-tab-shortcut");
  });
});
