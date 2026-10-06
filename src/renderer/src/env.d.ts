import type { FileItem, WorkspaceFileVersion } from "@shared/file-item";
import type { LargeTextPreview } from "@shared/large-files";
import type {
  AppConfig,
  AppTheme,
  ConfigKey,
  GitAutoSyncConflictResolution,
  SidebarPlacement,
  WorkspaceBackupResult,
  WorkspaceSelectionResult,
  WorkspaceStatus,
} from "@shared/config";
import type { WorkspaceSession } from "@shared/workspace-session";
import type { WorkspaceFileChange } from "@shared/workspace-change";
import type { ZoomShortcut } from "@shared/zoom-shortcuts";
import type {
  GitConflictOperationResult,
  GitAutoSyncResult,
  GitSyncOutcome,
  GitConflictPreviewRequest,
  GitConflictPreviewResult,
  GitConflictResolutionRequest,
  GitFileHistoryPage,
  GitFileRestoreRequest,
  GitFileRestoreResult,
  GitFileRevisionRequest,
  GitFileRevisionResult,
  GitFileStatusChangeEvent,
  GitFileStatusSnapshot,
  GitOperationResult,
  GitRemoteConfiguration,
  GitRemoteOperationResult,
  GitRemoteSyncOperationResult,
  GitRemoteSyncStatus,
  GitRepositoryInitializationResult,
  GitIgnoreSettingsResult,
  GitIgnoreUpdateResult,
} from "@shared/git";
import type {
  CreatedDirectoryResult,
  CreatedFileResult,
  ExternalFileImportResult,
  FileOperationResult,
  MovedFileResult,
  NotePdfExportResult,
  WorkspaceFileSaveResult,
  WorkspaceItemCopyResult,
  WorkspaceTextFile,
  WorkspaceFileExportResult,
} from "@shared/file-operations";
import type {
  IndexedDocument,
  IndexedPdfReference,
  WorkspacePropertyMatch,
  WorkspacePropertyQuery,
  WorkspaceFrontmatterFieldObservation,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResult,
} from "@shared/workspace-index";
import type { PdfArticleImportResult } from "@shared/pdf-article-import";
import type { NotePdfExportPayload, NotePdfExportRequest } from "@shared/note-pdf-export";

type ExternalLinkResult = {
  success: boolean;
  error?: string | null;
};

type WorkspaceTreeSnapshot = {
  revision: number;
  items: FileItem[];
};

declare global {
  interface Window {
    api: {
      getFiles: (directoryPath: string) => Promise<FileItem[]>;
      openFile: (filePath: string) => Promise<string>;
      readBinaryFile: (filePath: string) => Promise<Uint8Array>;
      fingerprintWorkspaceFile?: (filePath: string) => Promise<string>;
      openTextFile: (filePath: string) => Promise<WorkspaceTextFile>;
      readLargeTextPreview: (filePath: string) => Promise<LargeTextPreview>;
      searchWorkspaceText: (request: WorkspaceTextSearchRequest) => Promise<WorkspaceTextSearchResult[]>;
      queryWorkspaceProperty: (request: WorkspacePropertyQuery) => Promise<WorkspacePropertyMatch[]>;
      listWorkspaceFrontmatterFields: () => Promise<WorkspaceFrontmatterFieldObservation[]>;
      readIndexedDocuments: (paths: string[]) => Promise<IndexedDocument[]>;
      queryPdfReferences: (basename: string) => Promise<IndexedPdfReference[]>;
      doesFileExist: (filePath: string) => Promise<boolean>;
      saveFile: (
        filePath: string,
        content: string,
        expectedVersion: WorkspaceFileVersion,
      ) => Promise<WorkspaceFileSaveResult>;
      upsertFile: (filePath: string, content: string) => Promise<boolean>;
      createFile: (filePath: string, content: string) => Promise<CreatedFileResult>;
      saveBinaryFile: (filePath: string, content: ArrayBuffer | Uint8Array) => Promise<boolean>;
      createDirectory: (directoryPath: string) => Promise<CreatedDirectoryResult>;
      getFilesRecursiveAsTree: (directoryPath: string) => Promise<WorkspaceTreeSnapshot>;
      getGitFileStatus: (forceRefresh?: boolean) => Promise<GitFileStatusSnapshot>;
      getGitFileHistory: (filePath: string, cursor?: string, limit?: number) => Promise<GitFileHistoryPage>;
      getGitFileRevision: (request: GitFileRevisionRequest) => Promise<GitFileRevisionResult>;
      restoreGitFileRevision: (request: GitFileRestoreRequest) => Promise<GitFileRestoreResult>;
      getGitRemoteConfiguration: () => Promise<GitRemoteConfiguration>;
      getGitRemoteSyncStatus: () => Promise<GitRemoteSyncStatus>;
      getGitSyncOutcome: () => Promise<GitSyncOutcome | null>;
      onGitSyncOutcomeChanged: (callback: (outcome: GitSyncOutcome) => void) => () => void;
      getGitAutoSyncSettings: () => Promise<{
        conflictResolution: GitAutoSyncConflictResolution;
        intervalMinutes: number;
      }>;
      setGitAutoSyncSettings: (settings: {
        conflictResolution: GitAutoSyncConflictResolution;
        intervalMinutes: number;
      }) => Promise<{ conflictResolution: GitAutoSyncConflictResolution; intervalMinutes: number }>;
      cancelGitSync: () => Promise<boolean>;
      runGitAutoSync: () => Promise<GitAutoSyncResult>;
      getGitIgnoreSettings: () => Promise<GitIgnoreSettingsResult>;
      updateGitIgnoreSettings: (patterns: string) => Promise<GitIgnoreUpdateResult>;
      initializeGitRepository: () => Promise<GitRepositoryInitializationResult>;
      stageGitPaths: (paths: string[]) => Promise<GitOperationResult>;
      unstageGitPaths: (paths: string[]) => Promise<GitOperationResult>;
      revertGitPaths: (paths: string[]) => Promise<GitOperationResult>;
      commitGitChanges: (message: string) => Promise<GitOperationResult>;
      setGitRemoteUrl: (url: string) => Promise<GitRemoteOperationResult>;
      removeGitRemote: () => Promise<GitRemoteOperationResult>;
      fetchGitRemote: () => Promise<GitRemoteSyncOperationResult>;
      pullGitRemote: () => Promise<GitRemoteSyncOperationResult>;
      pushGitRemote: () => Promise<GitRemoteSyncOperationResult>;
      beginGitRemoteReconciliation: () => Promise<GitRemoteSyncOperationResult>;
      getGitConflictPreview: (request: GitConflictPreviewRequest) => Promise<GitConflictPreviewResult>;
      resolveGitConflict: (request: GitConflictResolutionRequest) => Promise<GitConflictOperationResult>;
      abortGitRemoteReconciliation: () => Promise<GitConflictOperationResult>;
      onGitFileStatusChanged: (callback: (event: GitFileStatusChangeEvent) => void) => () => void;
      importExternalFiles: (
        files: readonly File[],
        destinationDirectoryPath: string,
      ) => Promise<ExternalFileImportResult>;
      copyImageAt: (x: number, y: number) => Promise<FileOperationResult>;
      hasClipboardImageFiles: () => boolean;
      importClipboardImages: (destinationDirectoryPath: string) => Promise<ExternalFileImportResult>;
      importPdfArticle: (reference: string) => Promise<PdfArticleImportResult>;
      copyWorkspaceItems: (sourcePaths: string[], destinationDirectoryPath: string) => Promise<WorkspaceItemCopyResult>;
      renameFile: (oldPath: string, newName: string) => Promise<MovedFileResult>;
      moveFile: (sourcePath: string, targetDirectoryPath: string) => Promise<MovedFileResult>;
      trashFile: (filePath: string) => Promise<FileOperationResult>;
      revealInSystemFileManager: (filePath: string) => Promise<FileOperationResult>;
      openInDefaultApp: (filePath: string) => Promise<FileOperationResult>;
      exportWorkspaceFileCopy: (filePath: string) => Promise<WorkspaceFileExportResult>;
      exportNoteToPdf: (request: NotePdfExportRequest) => Promise<NotePdfExportResult>;
      openExportedNotePdf: (openToken: string) => Promise<FileOperationResult>;
      getNotePdfExportPayload: (token: string) => Promise<NotePdfExportPayload>;
      getWebsitePreview: (
        url: string,
        request: { userInitiated: true; requestId: string },
      ) => Promise<{ imageDataUrl: string; url: string } | null>;
      cancelWebsitePreview: (requestId: string) => Promise<void>;
      openExternalLink: (url: string) => Promise<ExternalLinkResult>;
      focusAppWindow: () => void;
      setPdfViewerShortcutFocus: (focused: boolean) => void;
      onPdfZoomShortcut: (callback: (shortcut: ZoomShortcut) => void) => () => void;
      onCloseCurrentTabShortcut: (callback: () => void) => () => void;
      onReopenLastClosedTabShortcut: (callback: () => void) => () => void;
      onAppCloseRequested: (callback: (requestId: number) => void | Promise<void>) => () => void;
      respondToAppClose: (requestId: number, allow: boolean) => void;
      onAppCloseTimeout: (callback: () => void) => () => void;
      onWorkspaceFilesChanged: (callback: (changes: WorkspaceFileChange[]) => void) => () => void;
    };
    config: {
      isMacOS: boolean;
      initializeConfig: () => Promise<WorkspaceSelectionResult>;
      getWorkspaceStatusSync: () => WorkspaceStatus;
      getRecentWorkspacesSync: () => string[];
      selectRecentWorkspace: (workspacePath: string) => Promise<WorkspaceSelectionResult>;
      removeRecentWorkspace: (workspacePath: string) => Promise<string[]>;
      exportWorkspaceBackup: () => Promise<WorkspaceBackupResult>;
      getMainDirectoryPathSync: () => string;
      isMainDirectoryPathDefinedSync: () => boolean;
      getShowWindowControlsSync: () => boolean;
      setShowWindowControls: (visible: boolean) => Promise<void>;
      getThemeSync: () => AppTheme | null;
      setTheme: (theme: AppTheme) => Promise<void>;
      getSidebarPlacementSync: () => SidebarPlacement;
      setSidebarPlacement: (placement: SidebarPlacement) => Promise<void>;
      getZoomFactorSync: () => number;
      setZoomFactor: (zoomFactor: number) => Promise<number>;
      getAppVersionSync: () => string;
      getKeyboardShortcutsSync: () => import("@shared/keyboard-shortcuts").ShortcutOverrides;
      onKeyboardShortcutsChange: (
        callback: (shortcuts: import("@shared/keyboard-shortcuts").ShortcutOverrides) => void,
      ) => () => void;
      setShortcutRecording: (recording: boolean) => void;
      getConfigValue: <K extends ConfigKey>(key: K) => Promise<AppConfig[K]>;
      updateConfig: <K extends ConfigKey>(key: K, value: AppConfig[K]) => Promise<void>;
      readWorkspaceSession: () => Promise<WorkspaceSession | null>;
      saveWorkspaceSession: (session: WorkspaceSession) => Promise<void>;
    };
  }
}

export {};
