import "./app-profile";
import { trustedIpcMain as ipcMain } from "./trusted-ipc";
/**
 * Boots the Electron main process and registers the application's protocol,
 * lifecycle events, and renderer IPC handlers.
 */
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { BrowserWindow, app, dialog, shell, protocol } from "electron";
import path from "path";
import { copyFile, readFile, lstat, stat } from "fs/promises";
import type { WorkspaceFileVersion } from "@shared/file-item";
import { WORKSPACE_INDEX_PAGE_SIZE } from "@shared/workspace-index";
import type {
  CreatedDirectoryResult,
  CreatedFileResult,
  FileOperationResult,
  MovedFileResult,
  WorkspaceFileSaveResult,
  WorkspaceFileExportResult,
} from "@shared/file-operations";
import { existsSync } from "fs";
import ConfigManager from "./app-config";
import { importExternalFiles, type FileImportSource } from "./file-import";
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  getWorkspaceSnapshot,
  overwriteWorkspaceFileIfVersion,
  queueWorkspaceRead,
  upsertWorkspaceFile,
  trashWorkspaceItem,
} from "./workspace-mutations";
import { moveWorkspaceItemWithLinks, RestoredLinkMoveError } from "./workspace-linked-move";
import { resolveWorkspacePath } from "./workspace-paths";
import { parseWorkspacePropertyQueryRequest } from "./workspace-index";
import { lookup } from "mime-types";
import { isValidFilename, isValidRelativePath } from "@shared/pathUtils";
import { readLargeTextPreview } from "./large-file";
import { createWindow } from "./app-window";
import { requestWebsitePreview, cancelWebsitePreview, cancelWebsitePreviewsForSender } from "./website-preview";
import { openExternalUrl } from "./external-links";
import {
  getWorkspaceDirectoryEntries,
  getWorkspaceFileTree,
  fingerprintWorkspaceFile,
  readWorkspaceTextFile,
  toFileItem,
  toRendererPath,
} from "./workspace-files";
import { closeWorkspaceIndex, getWorkspaceIndex, syncDegradedWorkspaceIndex } from "./workspace-index-runtime";
import { removeLegacyWorkspaceFieldSchema } from "./workspace-migrations";
import { copyImageAt, getClipboardImageSources, hasClipboardImageContent } from "./clipboard-files";
import { closeGitFileStatusRuntime, registerGitFileStatusIpc } from "./git-file-status-runtime";
import "./workspace-session";
import { installMainProcessLoggingGuards } from "./main-process-logging";
import { importPdfArticle } from "./pdf-article-import";
import { registerNotePdfExportIpc } from "./note-pdf-export";

installMainProcessLoggingGuards();

app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("enable-features", "OverlayScrollbar");

registerGitFileStatusIpc();
registerNotePdfExportIpc();

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("io.github.coderbeep.obim");
  await ConfigManager.removeDeprecatedSourcesSettings();

  const workspace = ConfigManager.getWorkspaceStatusSync();
  if (workspace.status === "ready") await removeLegacyWorkspaceFieldSchema(workspace.path);

  protocol.handle("media", async (request) => {
    try {
      const { data, mimeType } = await queueWorkspaceRead(async () => {
        const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
        const urlObj = new URL(request.url);
        const relativePath = decodeURIComponent(urlObj.pathname).replace(/^\/+/, "");
        const filePath = resolveNotesPath(mainDirectoryPath, relativePath);
        return {
          data: await readFile(filePath),
          mimeType: lookup(filePath) || "application/octet-stream",
        };
      });

      return new Response(data, {
        headers: { "Content-Type": mimeType, "X-Content-Type-Options": "nosniff" },
      });
    } catch (error) {
      console.error("Error handling media protocol:", error);
      return new Response("File not found", { status: 404 });
    }
  });

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow({ activate: !(is.dev && process.platform === "darwin") });
  if (workspace.status === "ready") {
    void getWorkspaceIndex().catch((error) => console.warn("Workspace watcher could not start:", error));
  }

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

const resolveNotesPath = resolveWorkspacePath;
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

ipcMain.handle("import-pdf-article", (_event, reference: unknown) => importPdfArticle(reference));

app.on("browser-window-focus", syncDegradedWorkspaceIndex);
app.on("will-quit", () => {
  closeGitFileStatusRuntime();
  closeWorkspaceIndex();
});

ipcMain.handle("get-files", async (_, directoryPath: string) => {
  return queueWorkspaceRead(async () => {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    const resolvedDirectoryPath = resolveNotesPath(mainDirectoryPath, directoryPath);
    return getWorkspaceDirectoryEntries(resolvedDirectoryPath, mainDirectoryPath);
  });
});

ipcMain.handle("open-file", async (_, filePath: string) => {
  return queueWorkspaceRead(async () => {
    try {
      const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
      const fullPath = resolveNotesPath(mainDirectoryPath, filePath);
      return await readFile(fullPath, "utf-8");
    } catch (err) {
      console.error("Error reading file:", err);
      throw err;
    }
  });
});

ipcMain.handle("read-binary-file", async (_, filePath: string) => {
  const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
  const fullPath = resolveNotesPath(mainDirectoryPath, filePath);
  return new Uint8Array(await readFile(fullPath));
});

ipcMain.handle("fingerprint-workspace-file", async (_, filePath: string) => {
  return queueWorkspaceRead(async () => {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    return fingerprintWorkspaceFile(resolveNotesPath(mainDirectoryPath, filePath));
  });
});

ipcMain.handle("open-text-file", async (_, filePath: string) => {
  return queueWorkspaceRead(async () => {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    return readWorkspaceTextFile(resolveNotesPath(mainDirectoryPath, filePath));
  });
});

ipcMain.handle("read-large-text-preview", async (_, filePath: string) => {
  return queueWorkspaceRead(async () => {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    return readLargeTextPreview(resolveNotesPath(mainDirectoryPath, filePath));
  });
});

const validLimit = (value: unknown, fallback: number) =>
  value === undefined
    ? fallback
    : typeof value === "number" && Number.isInteger(value)
      ? Math.max(1, Math.min(100, value))
      : null;
ipcMain.handle("search-workspace-text", (_, request: unknown) =>
  queueWorkspaceRead(async () => {
    if (!request || typeof request !== "object") return [];
    const { query, limit, hideCompletedTasks } = request as {
      query?: unknown;
      limit?: unknown;
      hideCompletedTasks?: unknown;
    };
    const boundedLimit = validLimit(limit, 30);
    if (typeof query !== "string" || query.length > 1000 || boundedLimit === null) return [];
    if (hideCompletedTasks !== undefined && typeof hideCompletedTasks !== "boolean") return [];
    return (await getWorkspaceIndex()).searchText(query, boundedLimit, hideCompletedTasks === true);
  }),
);

ipcMain.handle("query-workspace-property", (_, request: unknown) =>
  queueWorkspaceRead(async () => {
    const query = parseWorkspacePropertyQueryRequest(request);
    return query ? (await getWorkspaceIndex()).queryProperty(query) : [];
  }),
);

ipcMain.handle("list-workspace-frontmatter-fields", () =>
  queueWorkspaceRead(async () => (await getWorkspaceIndex()).listFrontmatterFields()),
);

ipcMain.handle("query-pdf-references", (_, basename: unknown) =>
  queueWorkspaceRead(async () =>
    typeof basename === "string" && basename.length <= 255 && /^[^/\\\\]+\.pdf$/i.test(basename)
      ? (await getWorkspaceIndex()).queryPdfReferences(basename)
      : [],
  ),
);

ipcMain.handle("read-indexed-documents", (_, paths: unknown) =>
  queueWorkspaceRead(async () => {
    if (
      !Array.isArray(paths) ||
      paths.length > WORKSPACE_INDEX_PAGE_SIZE ||
      !paths.every((value) => typeof value === "string")
    )
      return [];
    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    const allowed = paths.flatMap((value) => {
      try {
        return [toRendererPath(resolveNotesPath(workspacePath, value))];
      } catch {
        return [];
      }
    });
    return (await getWorkspaceIndex()).readDocuments(allowed);
  }),
);

ipcMain.handle("does-file-exist", async (_, filePath: string) => {
  return queueWorkspaceRead(async () => {
    try {
      const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
      const fullPath = resolveNotesPath(mainDirectoryPath, filePath);
      return existsSync(fullPath);
    } catch (err) {
      console.error("Error checking file existence:", err);
      return false;
    }
  });
});

const isWorkspaceFileVersion = (value: unknown): value is WorkspaceFileVersion => {
  if (!value || typeof value !== "object") return false;
  const { id, mtimeMs, sizeBytes } = value as Partial<WorkspaceFileVersion>;
  return (
    (id === undefined || (typeof id === "string" && id.length > 0)) &&
    typeof mtimeMs === "number" &&
    Number.isFinite(mtimeMs) &&
    typeof sizeBytes === "number" &&
    Number.isSafeInteger(sizeBytes) &&
    sizeBytes >= 0
  );
};

ipcMain.handle(
  "save-file",
  async (_, filePath: string, content: string, expectedVersion: unknown): Promise<WorkspaceFileSaveResult> => {
    if (typeof filePath !== "string" || typeof content !== "string" || !isWorkspaceFileVersion(expectedVersion)) {
      return { success: false, error: "Invalid file save request" };
    }

    try {
      const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
      return await overwriteWorkspaceFileIfVersion(
        resolveNotesPath(mainDirectoryPath, filePath),
        content,
        expectedVersion,
      );
    } catch (err) {
      console.error("Error saving file:", err);
      return { success: false, error: errorMessage(err) };
    }
  },
);

ipcMain.handle("upsert-file", async (_, filePath: string, content: string) => {
  try {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    return upsertWorkspaceFile(resolveNotesPath(mainDirectoryPath, filePath), content);
  } catch (err) {
    console.error("Error writing application file:", err);
    return false;
  }
});

ipcMain.handle("create-file", async (_, filePath: string, content: string): Promise<CreatedFileResult> => {
  if (!isValidFilename(path.basename(filePath))) {
    return { success: false, error: "Invalid filename" };
  }

  try {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    const fullPath = resolveNotesPath(mainDirectoryPath, filePath);
    const created = await createWorkspaceFile(fullPath, content);
    if (!created) return { success: false, error: "Destination file already exists" };
    return { success: true, file: toFileItem(fullPath, await lstat(fullPath), mainDirectoryPath) };
  } catch (err) {
    console.error("Error creating file:", err);
    return { success: false, error: errorMessage(err) };
  }
});

ipcMain.handle("save-binary-file", async (_, filePath: string, content: ArrayBuffer | Uint8Array) => {
  if (!isValidRelativePath(filePath)) return false;

  try {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    const fullPath = resolveNotesPath(mainDirectoryPath, filePath);
    return createWorkspaceFile(fullPath, content instanceof Uint8Array ? content : new Uint8Array(content));
  } catch (err) {
    console.error("Error saving binary file:", err);
    return false;
  }
});

ipcMain.handle("create-directory", async (_, directoryPath: string): Promise<CreatedDirectoryResult> => {
  if (!isValidFilename(path.basename(directoryPath))) {
    return { success: false, error: "Invalid filename" };
  }

  try {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    const fullPath = resolveNotesPath(mainDirectoryPath, directoryPath);
    const created = await createWorkspaceDirectory(fullPath);
    if (!created) return { success: false, error: "Destination directory already exists" };
    return { success: true, directory: toFileItem(fullPath, await lstat(fullPath), mainDirectoryPath) };
  } catch (error) {
    console.error("Error creating directory:", error);
    return { success: false, error: errorMessage(error) };
  }
});

ipcMain.handle("get-files-recursive-as-tree", async (_, directoryPath: string) => {
  const snapshot = await getWorkspaceSnapshot(async () => {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    return getWorkspaceFileTree(resolveNotesPath(mainDirectoryPath, directoryPath), mainDirectoryPath);
  });
  return { revision: snapshot.revision, items: snapshot.value };
});

const isFileImportSource = (source: unknown): source is FileImportSource => {
  if (!source || typeof source !== "object") return false;
  const candidate = source as Record<string, unknown>;
  if (candidate.kind === "path") return typeof candidate.path === "string";
  return candidate.kind === "buffer" && typeof candidate.name === "string" && candidate.content instanceof Uint8Array;
};

ipcMain.handle("import-external-files", async (_, requestedSources: unknown, destinationDirectoryPath: string) => {
  try {
    if (!Array.isArray(requestedSources) || !requestedSources.every(isFileImportSource)) {
      throw new Error("Import sources are invalid.");
    }

    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    const destinationPath = resolveNotesPath(mainDirectoryPath, destinationDirectoryPath);
    const result = await importExternalFiles(requestedSources, destinationPath);
    return { ...result, importedPaths: result.importedPaths.map(toRendererPath) };
  } catch (error) {
    console.error("Error importing external files:", error);
    return { importedPaths: [], errors: [error instanceof Error ? error.message : String(error)] };
  }
});

ipcMain.handle("copy-image-at", (event, x: unknown, y: unknown) => copyImageAt(event.sender, x, y));

ipcMain.on("has-clipboard-image-files", (event) => {
  event.returnValue = hasClipboardImageContent();
});

ipcMain.handle("import-clipboard-images", async (_, destinationDirectoryPath: string) => {
  try {
    const sources = getClipboardImageSources();
    if (!sources.length) return { importedPaths: [], errors: ["Clipboard does not contain a supported image."] };

    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    const destinationPath = resolveNotesPath(mainDirectoryPath, destinationDirectoryPath);
    const result = await importExternalFiles(sources, destinationPath);
    return { ...result, importedPaths: result.importedPaths.map(toRendererPath) };
  } catch (error) {
    console.error("Error importing clipboard images:", error);
    return { importedPaths: [], errors: [error instanceof Error ? error.message : String(error)] };
  }
});

ipcMain.handle("copy-workspace-items", async (_, sourcePaths: unknown, destinationDirectoryPath: string) => {
  try {
    if (!Array.isArray(sourcePaths) || !sourcePaths.every((sourcePath) => typeof sourcePath === "string")) {
      throw new Error("Copy sources must be workspace paths.");
    }

    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    const destinationPath = resolveNotesPath(mainDirectoryPath, destinationDirectoryPath);
    const sourceErrors: string[] = [];
    const sources: FileImportSource[] = sourcePaths.flatMap((sourcePath) => {
      try {
        return [{ kind: "path", path: resolveNotesPath(mainDirectoryPath, sourcePath) }];
      } catch (error) {
        sourceErrors.push(
          `${path.basename(sourcePath) || sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }
    });
    const result = await importExternalFiles(sources, destinationPath);
    return {
      copiedPaths: result.importedPaths.map(toRendererPath),
      errors: [...sourceErrors, ...result.errors],
    };
  } catch (error) {
    console.error("Error copying workspace items:", error);
    return { copiedPaths: [], errors: [error instanceof Error ? error.message : String(error)] };
  }
});

ipcMain.handle("rename-file", async (_, currentFilePath: string, newFileName: string): Promise<MovedFileResult> => {
  if (!isValidFilename(newFileName)) {
    return { success: false, error: "Invalid filename" };
  }

  const newFilePath = path.join(path.dirname(currentFilePath), path.basename(newFileName));

  try {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    const fullSourcePath = resolveNotesPath(mainDirectoryPath, currentFilePath);
    const fullDestinationPath = resolveNotesPath(mainDirectoryPath, newFilePath);

    const moved = await moveWorkspaceItemWithLinks(mainDirectoryPath, fullSourcePath, fullDestinationPath);
    if (!moved) {
      return { success: false, error: "Destination file already exists" };
    }
    return { success: true, output: toRendererPath(moved.output), linkUpdates: moved.linkUpdates };
  } catch (error) {
    console.error("Error moving file:", error);
    return {
      success: false,
      error: errorMessage(error),
      ...(error instanceof RestoredLinkMoveError ? { linkUpdates: error.linkUpdates } : {}),
    };
  }
});

ipcMain.handle(
  "move-file",
  async (_, movingFilePath: string, destinationDirectoryPath: string): Promise<MovedFileResult> => {
    const destinationPath = path.join(destinationDirectoryPath, path.basename(movingFilePath));

    try {
      const mainDirectoryPath: string = await ConfigManager.getConfigValue("mainDirectory");
      const fullSourcePath = resolveNotesPath(mainDirectoryPath, movingFilePath);
      const fullDestinationPath = resolveNotesPath(mainDirectoryPath, destinationPath);

      const moved = await moveWorkspaceItemWithLinks(mainDirectoryPath, fullSourcePath, fullDestinationPath, true);
      if (!moved) return { success: false, error: "Destination file already exists" };
      return { success: true, output: toRendererPath(moved.output), linkUpdates: moved.linkUpdates };
    } catch (error) {
      console.error("Error moving file:", error);
      return {
        success: false,
        error: errorMessage(error),
        ...(error instanceof RestoredLinkMoveError ? { linkUpdates: error.linkUpdates } : {}),
      };
    }
  },
);

ipcMain.handle("trash-file", async (_, filePath: string): Promise<FileOperationResult> => {
  try {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    await trashWorkspaceItem(resolveNotesPath(mainDirectoryPath, filePath), (resolvedPath) =>
      shell.trashItem(resolvedPath),
    );
    return { success: true };
  } catch (error) {
    console.error("Error moving file to Trash:", error);
    return { success: false, error: errorMessage(error) };
  }
});

ipcMain.handle("reveal-in-system-file-manager", async (_, filePath: string): Promise<FileOperationResult> => {
  try {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    const fullPath = resolveNotesPath(mainDirectoryPath, filePath);
    const fileStat = await stat(fullPath);

    if (fileStat.isDirectory()) {
      const result = await shell.openPath(fullPath);
      return result ? { success: false, error: result } : { success: true };
    }

    shell.showItemInFolder(fullPath);
    return { success: true };
  } catch (error) {
    console.error("Error opening file location:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("open-in-default-app", async (_, filePath: string): Promise<FileOperationResult> => {
  try {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    const fullPath = resolveNotesPath(mainDirectoryPath, filePath);
    const result = await shell.openPath(fullPath);
    return result ? { success: false, error: result } : { success: true };
  } catch (error) {
    console.error("Error opening file in default application:", error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle("export-workspace-file-copy", async (_, filePath: string): Promise<WorkspaceFileExportResult> => {
  try {
    const mainDirectoryPath = await ConfigManager.getConfigValue("mainDirectory");
    const fullPath = resolveNotesPath(mainDirectoryPath, filePath);
    await stat(fullPath);
    const result = await dialog.showSaveDialog({
      title: "Save a copy",
      buttonLabel: "Save copy",
      defaultPath: path.join(app.getPath("downloads"), path.basename(fullPath)),
    });
    if (result.canceled || !result.filePath) return { status: "cancelled" };
    if (path.resolve(result.filePath) === path.resolve(fullPath)) {
      return { status: "error", error: "Choose a different location for the copy." };
    }
    await copyFile(fullPath, result.filePath);
    return { status: "exported", path: result.filePath };
  } catch (error) {
    console.error("Error exporting workspace file:", error);
    return { status: "error", error: errorMessage(error) };
  }
});

const previewSenders = new WeakSet<Electron.WebContents>();
ipcMain.handle("get-website-preview", (event, url: string, request: unknown) => {
  const senderId = event.sender.id;
  if (!previewSenders.has(event.sender)) {
    previewSenders.add(event.sender);
    event.sender.once("destroyed", () => cancelWebsitePreviewsForSender(senderId));
  }
  return requestWebsitePreview(senderId, url, request);
});
ipcMain.handle("cancel-website-preview", (event, requestId: string) =>
  cancelWebsitePreview(event.sender.id, requestId),
);

ipcMain.handle("open-external-link", async (_, rawUrl: string) => {
  try {
    await openExternalUrl(rawUrl);
    return { success: true };
  } catch (error) {
    console.error("Error opening external link:", error);
    return { success: false };
  }
});
