import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { is } from "@electron-toolkit/utils";
import { app, BrowserWindow, dialog, shell } from "electron";

import {
  normalizeNotePdfExportOptions,
  type NotePdfExportPayload,
  type NotePdfExportRequest,
} from "@shared/note-pdf-export";
import type { FileOperationResult, NotePdfExportResult } from "@shared/file-operations";
import { isValidFilename } from "@shared/pathUtils";
import { trustedIpcMain as ipcMain } from "./trusted-ipc";
import { registerTrustedRenderer } from "./trusted-ipc";

const exportPayloads = new Map<string, NotePdfExportPayload>();
const exportedPdfPaths = new Map<string, string>();
const MAX_NOTE_EXPORT_SOURCE_LENGTH = 20 * 1024 * 1024;
const PDF_READY_TIMEOUT_MS = 20_000;
const EXPORTED_PDF_OPEN_TOKEN_TTL_MS = 10 * 60 * 1000;

const exportDocumentUrl = (token: string) => {
  const rendererFile = path.join(__dirname, "../renderer/index.html");
  const rendererUrl = is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined;
  const url = new URL(rendererUrl ?? pathToFileURL(rendererFile).href);
  url.searchParams.set("notePdfExportToken", token);
  return url.href;
};

const parseRequest = (value: unknown): NotePdfExportRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid PDF export request.");
  const request = value as Partial<NotePdfExportRequest>;
  if (
    typeof request.title !== "string" ||
    !request.title.trim() ||
    !isValidFilename(request.title.trim()) ||
    request.title.length > 300 ||
    Array.from(request.title).some((character) => character.charCodeAt(0) <= 0x1f)
  ) {
    throw new TypeError("The note title cannot be used as a PDF filename.");
  }
  if (typeof request.source !== "string" || request.source.length > MAX_NOTE_EXPORT_SOURCE_LENGTH) {
    throw new TypeError("The note is too large to export.");
  }
  return {
    title: request.title.trim(),
    source: request.source,
    options: normalizeNotePdfExportOptions(request.options),
  };
};

const waitForExportDocument = async (window: BrowserWindow) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < PDF_READY_TIMEOUT_MS) {
    const state = (await window.webContents.executeJavaScript(
      `({ ready: document.documentElement.dataset.notePdfExportReady === "true", error: document.documentElement.dataset.notePdfExportError || "" })`,
      true,
    )) as { ready: boolean; error: string };
    if (state.error) throw new Error(state.error);
    if (state.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The note preview did not finish preparing for PDF export.");
};

const renderPdf = async (payload: NotePdfExportPayload) => {
  const url = exportDocumentUrl(payload.token);
  const window = new BrowserWindow({
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  registerTrustedRenderer(window.webContents, url);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    await window.loadURL(url);
    await waitForExportDocument(window);
    return await window.webContents.printToPDF({
      generateTaggedPDF: true,
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
};

const outputPathWithExtension = (filePath: string) =>
  filePath.toLocaleLowerCase().endsWith(".pdf") ? filePath : `${filePath}.pdf`;

const rememberExportedPdf = (filePath: string) => {
  const openToken = randomUUID();
  exportedPdfPaths.set(openToken, filePath);
  const expiry = setTimeout(() => exportedPdfPaths.delete(openToken), EXPORTED_PDF_OPEN_TOKEN_TTL_MS);
  expiry.unref();
  return openToken;
};

export const registerNotePdfExportIpc = () => {
  ipcMain.handle("get-note-pdf-export-payload", (_event, token: unknown) => {
    if (typeof token !== "string") throw new TypeError("Invalid PDF export token.");
    const payload = exportPayloads.get(token);
    if (!payload) throw new Error("This PDF export is no longer available.");
    return payload;
  });

  ipcMain.handle("open-exported-note-pdf", async (_event, value: unknown): Promise<FileOperationResult> => {
    if (typeof value !== "string") return { success: false, error: "Invalid PDF open request." };
    const outputPath = exportedPdfPaths.get(value);
    if (!outputPath) return { success: false, error: "This exported PDF is no longer available to open." };
    exportedPdfPaths.delete(value);
    try {
      const result = await shell.openPath(outputPath);
      return result ? { success: false, error: result } : { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("export-note-to-pdf", async (event, value: unknown): Promise<NotePdfExportResult> => {
    let token: string | null = null;
    try {
      const request = parseRequest(value);
      const parent = BrowserWindow.fromWebContents(event.sender);
      const saveOptions = {
        title: "Export note to PDF",
        buttonLabel: "Export PDF",
        defaultPath: path.join(app.getPath("downloads"), `${request.title}.pdf`),
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
      };
      const selection = parent
        ? await dialog.showSaveDialog(parent, saveOptions)
        : await dialog.showSaveDialog(saveOptions);
      if (selection.canceled || !selection.filePath) return { status: "cancelled" };

      token = randomUUID();
      const payload: NotePdfExportPayload = { ...request, token };
      exportPayloads.set(token, payload);
      const pdf = await renderPdf(payload);
      const outputPath = outputPathWithExtension(selection.filePath);
      await writeFile(outputPath, pdf);
      return { status: "exported", path: outputPath, openToken: rememberExportedPdf(outputPath) };
    } catch (error) {
      console.error("Error exporting note to PDF:", error);
      return { status: "error", error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (token) exportPayloads.delete(token);
    }
  });
};
