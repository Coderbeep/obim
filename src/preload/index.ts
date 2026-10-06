import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  GitConflictPreviewRequest,
  GitConflictResolutionRequest,
  GitFileRestoreRequest,
  GitFileRevisionRequest,
} from "@shared/git";
import type { WorkspaceSession } from "@shared/workspace-session";
import type { WorkspaceFileChange } from "@shared/workspace-change";
import type { ZoomShortcut } from "@shared/zoom-shortcuts";

if (!process.contextIsolated) {
  throw new Error("contextIsolation must be enabled in the BrowserWindow");
}

contextBridge.exposeInMainWorld("api", {
  getFiles: (directoryPath) => ipcRenderer.invoke("get-files", directoryPath),
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),
  readBinaryFile: (filePath) => ipcRenderer.invoke("read-binary-file", filePath),
  fingerprintWorkspaceFile: (filePath) => ipcRenderer.invoke("fingerprint-workspace-file", filePath),
  openTextFile: (filePath) => ipcRenderer.invoke("open-text-file", filePath),
  readLargeTextPreview: (filePath) => ipcRenderer.invoke("read-large-text-preview", filePath),
  searchWorkspaceText: (request) => ipcRenderer.invoke("search-workspace-text", request),
  queryWorkspaceProperty: (request) => ipcRenderer.invoke("query-workspace-property", request),
  listWorkspaceFrontmatterFields: () => ipcRenderer.invoke("list-workspace-frontmatter-fields"),
  readIndexedDocuments: (paths) => ipcRenderer.invoke("read-indexed-documents", paths),
  queryPdfReferences: (basename) => ipcRenderer.invoke("query-pdf-references", basename),
  doesFileExist: (filePath) => ipcRenderer.invoke("does-file-exist", filePath),
  saveFile: (filePath, content, expectedVersion) => ipcRenderer.invoke("save-file", filePath, content, expectedVersion),
  upsertFile: (filePath, content) => ipcRenderer.invoke("upsert-file", filePath, content),
  createFile: (filePath, content) => ipcRenderer.invoke("create-file", filePath, content),
  saveBinaryFile: (filePath, content) => ipcRenderer.invoke("save-binary-file", filePath, content),
  createDirectory: (directoryPath) => ipcRenderer.invoke("create-directory", directoryPath),
  getFilesRecursiveAsTree: (directoryPath) => ipcRenderer.invoke("get-files-recursive-as-tree", directoryPath),
  getGitFileStatus: (forceRefresh = false) => ipcRenderer.invoke("get-git-file-status", forceRefresh),
  getGitFileHistory: (filePath: string, cursor?: string, limit?: number) =>
    ipcRenderer.invoke("get-git-file-history", filePath, cursor, limit),
  getGitFileRevision: (request: GitFileRevisionRequest) => ipcRenderer.invoke("get-git-file-revision", request),
  restoreGitFileRevision: (request: GitFileRestoreRequest) => ipcRenderer.invoke("restore-git-file-revision", request),
  getGitRemoteConfiguration: () => ipcRenderer.invoke("get-git-remote-configuration"),
  getGitRemoteSyncStatus: () => ipcRenderer.invoke("get-git-remote-sync-status"),
  getGitSyncOutcome: () => ipcRenderer.invoke("get-git-sync-outcome"),
  onGitSyncOutcomeChanged: (callback) => {
    const listener = (_event, outcome) => callback(outcome);
    ipcRenderer.on("git-sync-outcome-changed", listener);
    return () => ipcRenderer.removeListener("git-sync-outcome-changed", listener);
  },
  getGitAutoSyncSettings: () => ipcRenderer.invoke("get-git-auto-sync-settings"),
  setGitAutoSyncSettings: (settings) => ipcRenderer.invoke("set-git-auto-sync-settings", settings),
  cancelGitSync: () => ipcRenderer.invoke("cancel-git-sync"),
  runGitAutoSync: () => ipcRenderer.invoke("run-git-auto-sync"),
  getGitIgnoreSettings: () => ipcRenderer.invoke("get-git-ignore-settings"),
  updateGitIgnoreSettings: (patterns: string) => ipcRenderer.invoke("update-git-ignore-settings", patterns),
  initializeGitRepository: () => ipcRenderer.invoke("initialize-git-repository"),
  stageGitPaths: (paths: string[]) => ipcRenderer.invoke("stage-git-paths", paths),
  unstageGitPaths: (paths: string[]) => ipcRenderer.invoke("unstage-git-paths", paths),
  revertGitPaths: (paths: string[]) => ipcRenderer.invoke("revert-git-paths", paths),
  commitGitChanges: (message: string) => ipcRenderer.invoke("commit-git-changes", message),
  setGitRemoteUrl: (url: string) => ipcRenderer.invoke("set-git-remote-url", url),
  removeGitRemote: () => ipcRenderer.invoke("remove-git-remote"),
  fetchGitRemote: () => ipcRenderer.invoke("fetch-git-remote"),
  pullGitRemote: () => ipcRenderer.invoke("pull-git-remote"),
  pushGitRemote: () => ipcRenderer.invoke("push-git-remote"),
  beginGitRemoteReconciliation: () => ipcRenderer.invoke("begin-git-remote-reconciliation"),
  getGitConflictPreview: (request: GitConflictPreviewRequest) =>
    ipcRenderer.invoke("get-git-conflict-preview", request),
  resolveGitConflict: (request: GitConflictResolutionRequest) => ipcRenderer.invoke("resolve-git-conflict", request),
  abortGitRemoteReconciliation: () => ipcRenderer.invoke("abort-git-remote-reconciliation"),
  onGitFileStatusChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, change) => callback(change);
    ipcRenderer.on("git-file-status-changed", listener);
    return () => ipcRenderer.removeListener("git-file-status-changed", listener);
  },
  importExternalFiles: async (files: readonly File[], destinationDirectoryPath) => {
    const sources = await Promise.all(
      files.map(async (file) => {
        const filePath = webUtils.getPathForFile(file);
        return filePath
          ? { kind: "path", path: filePath }
          : { kind: "buffer", name: file.name, content: new Uint8Array(await file.arrayBuffer()) };
      }),
    );
    return ipcRenderer.invoke("import-external-files", sources, destinationDirectoryPath);
  },
  copyImageAt: (x: number, y: number) => ipcRenderer.invoke("copy-image-at", x, y),
  hasClipboardImageFiles: () => ipcRenderer.sendSync("has-clipboard-image-files"),
  importClipboardImages: (destinationDirectoryPath: string) =>
    ipcRenderer.invoke("import-clipboard-images", destinationDirectoryPath),
  importPdfArticle: (reference: string) => ipcRenderer.invoke("import-pdf-article", reference),
  copyWorkspaceItems: (sourcePaths, destinationDirectoryPath) =>
    ipcRenderer.invoke("copy-workspace-items", sourcePaths, destinationDirectoryPath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke("rename-file", oldPath, newPath),
  moveFile: (sourcePath, destinationPath) => ipcRenderer.invoke("move-file", sourcePath, destinationPath),
  trashFile: (filePath) => ipcRenderer.invoke("trash-file", filePath),
  revealInSystemFileManager: (filePath) => ipcRenderer.invoke("reveal-in-system-file-manager", filePath),
  openInDefaultApp: (filePath) => ipcRenderer.invoke("open-in-default-app", filePath),
  exportWorkspaceFileCopy: (filePath) => ipcRenderer.invoke("export-workspace-file-copy", filePath),
  exportNoteToPdf: (request) => ipcRenderer.invoke("export-note-to-pdf", request),
  openExportedNotePdf: (openToken: string) => ipcRenderer.invoke("open-exported-note-pdf", openToken),
  getNotePdfExportPayload: (token) => ipcRenderer.invoke("get-note-pdf-export-payload", token),
  getWebsitePreview: (url: string, request: { userInitiated: true; requestId: string }) =>
    ipcRenderer.invoke("get-website-preview", url, request),
  cancelWebsitePreview: (requestId: string) => ipcRenderer.invoke("cancel-website-preview", requestId),
  openExternalLink: (url: string) => ipcRenderer.invoke("open-external-link", url),
  focusAppWindow: () => ipcRenderer.send("focus-app-window"),
  setPdfViewerShortcutFocus: (focused: boolean) => ipcRenderer.send("pdf-viewer-shortcut-focus", focused),
  onPdfZoomShortcut: (callback: (shortcut: ZoomShortcut) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, shortcut: ZoomShortcut) => callback(shortcut);
    ipcRenderer.on("pdf-zoom-shortcut", listener);
    return () => ipcRenderer.removeListener("pdf-zoom-shortcut", listener);
  },
  onCloseCurrentTabShortcut: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("close-current-tab-shortcut", listener);
    return () => ipcRenderer.removeListener("close-current-tab-shortcut", listener);
  },
  onReopenLastClosedTabShortcut: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("reopen-last-closed-tab-shortcut", listener);
    return () => ipcRenderer.removeListener("reopen-last-closed-tab-shortcut", listener);
  },
  onAppCloseRequested: (callback: (requestId: number) => void | Promise<void>) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: number) => void callback(requestId);
    ipcRenderer.on("app-close-requested", listener);
    return () => ipcRenderer.removeListener("app-close-requested", listener);
  },
  respondToAppClose: (requestId: number, allow: boolean) =>
    ipcRenderer.send("app-close-response", { requestId, allow }),
  onAppCloseTimeout: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("app-close-timeout", listener);
    return () => ipcRenderer.removeListener("app-close-timeout", listener);
  },
  onWorkspaceFilesChanged: (callback: (changes: WorkspaceFileChange[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, changes: WorkspaceFileChange[]) => callback(changes);
    ipcRenderer.on("workspace-files-changed", listener);
    return () => ipcRenderer.removeListener("workspace-files-changed", listener);
  },
});

contextBridge.exposeInMainWorld("config", {
  isMacOS: process.platform === "darwin",
  initializeConfig: () => {
    return ipcRenderer.invoke("initialize-config");
  },
  getWorkspaceStatusSync: () => ipcRenderer.sendSync("get-workspace-status-sync"),
  getRecentWorkspacesSync: () => ipcRenderer.sendSync("get-recent-workspaces-sync"),
  selectRecentWorkspace: (workspacePath: string) => ipcRenderer.invoke("select-recent-workspace", workspacePath),
  removeRecentWorkspace: (workspacePath: string) => ipcRenderer.invoke("remove-recent-workspace", workspacePath),
  exportWorkspaceBackup: () => ipcRenderer.invoke("export-workspace-backup"),
  getMainDirectoryPathSync: () => {
    return ipcRenderer.sendSync("get-main-directory-path-sync");
  },
  isMainDirectoryPathDefinedSync: () => {
    return ipcRenderer.sendSync("is-main-directory-defined-sync");
  },
  getShowWindowControlsSync: () => ipcRenderer.sendSync("get-show-window-controls-sync"),
  setShowWindowControls: (visible: boolean) => ipcRenderer.invoke("set-show-window-controls", visible),
  getThemeSync: () => ipcRenderer.sendSync("get-theme-sync"),
  setTheme: (theme: "dark" | "light" | "system") => ipcRenderer.invoke("set-theme", theme),
  getSidebarPlacementSync: () => ipcRenderer.sendSync("get-sidebar-placement-sync"),
  setSidebarPlacement: (placement: "explorer-left" | "explorer-right") =>
    ipcRenderer.invoke("set-sidebar-placement", placement),
  getZoomFactorSync: () => ipcRenderer.sendSync("get-zoom-factor-sync"),
  setZoomFactor: (zoomFactor: number) => ipcRenderer.invoke("set-zoom-factor", zoomFactor),
  getAppVersionSync: () => ipcRenderer.sendSync("get-app-version-sync"),
  getKeyboardShortcutsSync: () => ipcRenderer.sendSync("get-keyboard-shortcuts-sync"),
  onKeyboardShortcutsChange: (callback) => {
    const listener = (_event, shortcuts) => callback(shortcuts);
    ipcRenderer.on("keyboard-shortcuts-changed", listener);
    return () => ipcRenderer.removeListener("keyboard-shortcuts-changed", listener);
  },
  setShortcutRecording: (recording) => ipcRenderer.send("shortcut-recording", recording),
  getConfigValue: (key) => ipcRenderer.invoke("get-config-value", key),
  updateConfig: (key, value) => ipcRenderer.invoke("update-config", key, value),
  readWorkspaceSession: () => ipcRenderer.invoke("read-workspace-session"),
  saveWorkspaceSession: (session: WorkspaceSession) => ipcRenderer.invoke("save-workspace-session", session),
});
