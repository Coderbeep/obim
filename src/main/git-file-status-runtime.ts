import { trustedIpcMain as ipcMain } from "./trusted-ipc";
import { app, BrowserWindow } from "electron";
import { watch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  GitAutoSyncResult,
  GitSyncOutcome,
  GitConflictOperationResult,
  GitConflictPreviewResult,
  GitConflictResolution,
  GitFileHistoryPage,
  GitFileRestoreRequest,
  GitFileRestoreResult,
  GitFileRevisionRequest,
  GitFileStatusChangeEvent,
  GitOperationResult,
  GitRemoteOperationResult,
  GitRemoteSyncOperationResult,
  GitIgnoreSettingsResult,
  GitIgnoreUpdateResult,
} from "@shared/git";
import { isApplicationGitPath } from "@shared/git";
import { isGitAutoSyncConflictResolution, normalizeGitAutoSyncInterval } from "@shared/config";
import type { WorkspaceFileVersion } from "@shared/file-item";
import ConfigManager from "./app-config";
import { readGitFileHistory, readGitFileRevision, restoreGitFileRevision } from "./git-file-history";
import { classifyGitWatchEvent } from "./git-watch-events";
import {
  abortGitRemoteReconciliation,
  autoSyncGitRemote,
  beginGitRemoteReconciliation,
  commitGitChanges,
  fetchGitRemote,
  initializeGitRepository,
  pullGitRemote,
  pushGitRemote,
  readGitConflictPreview,
  readGitAutoSyncDestination,
  readGitSyncLocalState,
  readGitFileStatus,
  readGitIgnoreSettings,
  readGitRemoteConfiguration,
  readGitRemoteSyncStatus,
  resolveGitConflict,
  removeGitRemote,
  revertGitPaths,
  setGitRemoteUrl,
  stageGitPaths,
  unstageGitPaths,
  updateGitIgnoreSettings,
  type GitRemoteExecutionOptions,
} from "./git-file-status";
import { completedGitSyncOutcome, sanitizeGitSyncError } from "./git-sync-outcome";
import { onWorkspaceMutation, queueWorkspaceMutation, queueWorkspaceRead } from "./workspace-mutations";

const CHANGE_EVENT = "git-file-status-changed";
const CHANGE_DEBOUNCE_MS = 250;
const STATUS_CACHE_TTL_MS = 500;

let workspaceWatcher: FSWatcher | undefined;
let gitWatcher: FSWatcher | undefined;
let watchedWorkspace = "";
let watchedGitDirectory = "";
let changeTimer: NodeJS.Timeout | undefined;
let autoSyncTimer: NodeJS.Timeout | undefined;
let pendingTreeChange = false;
let pendingHistoryChange = false;
const pendingPaths = new Set<string>();
let initializationPromise: ReturnType<typeof initializeGitRepository> | undefined;
let mutationInProgress = false;
let activeSyncWorkspace: string | undefined;
let activeSyncController: AbortController | undefined;
let activeScheduledConsent: { workspacePath: string; destination: string } | undefined;
let runtimeClosed = false;
let localSyncPhase = false;
const syncOutcomes = new Map<string, GitSyncOutcome>();
let unsubscribeConfigChanges: (() => void) | undefined;
let unsubscribeWorkspaceMutations: (() => void) | undefined;
let statusGeneration = 0;
let cachedStatus:
  { expiresAt: number; result: Awaited<ReturnType<typeof readGitFileStatus>>; workspacePath: string } | undefined;
let statusRead:
  | {
      generation: number;
      promise: Promise<Awaited<ReturnType<typeof readGitFileStatus>>>;
      workspacePath: string;
    }
  | undefined;

const closeWatcher = (watcher?: FSWatcher) => {
  try {
    watcher?.close();
  } catch {
    // A failed/degraded watcher is already unusable.
  }
};

const invalidateStatus = () => {
  statusGeneration += 1;
  cachedStatus = undefined;
};

const flushChangeEvent = () => {
  changeTimer = undefined;
  if (mutationInProgress && (!activeSyncController || localSyncPhase)) {
    changeTimer = setTimeout(flushChangeEvent, CHANGE_DEBOUNCE_MS);
    return;
  }

  const paths = [...pendingPaths];
  const event = {
    treeMayHaveChanged: pendingTreeChange,
    ...(paths.length ? { paths } : {}),
    ...(pendingHistoryChange ? { historyMayHaveChanged: true } : {}),
  } satisfies GitFileStatusChangeEvent;
  pendingTreeChange = false;
  pendingHistoryChange = false;
  pendingPaths.clear();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(CHANGE_EVENT, event);
  }
};

const readStatus = (
  workspacePath: string,
  forceRefresh = false,
): Promise<Awaited<ReturnType<typeof readGitFileStatus>>> => {
  if (forceRefresh) invalidateStatus();
  const generation = statusGeneration;
  const now = Date.now();
  if (!forceRefresh && cachedStatus?.workspacePath === workspacePath && cachedStatus.expiresAt > now) {
    return Promise.resolve(cachedStatus.result);
  }
  if (statusRead?.workspacePath === workspacePath && statusRead.generation === generation) {
    return statusRead.promise;
  }

  const promise = readGitFileStatus(workspacePath).then((result) => {
    if (statusGeneration === generation) {
      cachedStatus = { expiresAt: Date.now() + STATUS_CACHE_TTL_MS, result, workspacePath };
    }
    return result;
  });
  statusRead = { generation, promise, workspacePath };
  void promise.finally(() => {
    if (statusRead?.promise === promise) statusRead = undefined;
  });
  return promise;
};

const scheduleChangeEvent = ({
  historyMayHaveChanged = false,
  path: changedPath,
  paths: changedPaths,
  treeMayHaveChanged = false,
}: {
  historyMayHaveChanged?: boolean;
  path?: string;
  paths?: readonly string[];
  treeMayHaveChanged?: boolean;
} = {}) => {
  invalidateStatus();
  pendingTreeChange ||= treeMayHaveChanged;
  pendingHistoryChange ||= historyMayHaveChanged;
  if (changedPath) pendingPaths.add(changedPath);
  for (const path of changedPaths ?? []) {
    if (path) pendingPaths.add(path);
  }
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(flushChangeEvent, CHANGE_DEBOUNCE_MS);
};

const createWatcher = (
  targetPath: string,
  recursive: boolean,
  worktree: boolean,
  onError: (watcher: FSWatcher) => void,
) => {
  try {
    const watcher = watch(targetPath, { recursive }, (eventType, filename) => {
      const classification = classifyGitWatchEvent(eventType, filename, worktree);
      if (classification) scheduleChangeEvent(classification);
    });
    watcher.on("error", () => {
      closeWatcher(watcher);
      onError(watcher);
      scheduleChangeEvent();
    });
    return watcher;
  } catch {
    return undefined;
  }
};

const ensureWatchers = (workspacePath: string, gitDirectory?: string) => {
  const nextWorkspace = path.resolve(workspacePath);
  const nextGitDirectory = gitDirectory ? path.resolve(gitDirectory) : "";

  // A non-repository has no Git state to observe. Focus/visibility refreshes will
  // still discover a repository if one is initialized by another application.
  if (!nextGitDirectory) {
    closeWatcher(workspaceWatcher);
    closeWatcher(gitWatcher);
    workspaceWatcher = undefined;
    gitWatcher = undefined;
    watchedWorkspace = nextWorkspace;
    watchedGitDirectory = "";
    return;
  }

  if (nextWorkspace !== watchedWorkspace || !workspaceWatcher) {
    closeWatcher(workspaceWatcher);
    workspaceWatcher = createWatcher(nextWorkspace, true, true, (failedWatcher) => {
      if (workspaceWatcher === failedWatcher) workspaceWatcher = undefined;
    });
    watchedWorkspace = nextWorkspace;
  }
  const gitDirectoryRelativeToWorkspace = nextGitDirectory ? path.relative(nextWorkspace, nextGitDirectory) : "";
  const gitDirectoryIsOutsideWorkspace =
    gitDirectoryRelativeToWorkspace === ".." ||
    gitDirectoryRelativeToWorkspace.startsWith(`..${path.sep}`) ||
    path.isAbsolute(gitDirectoryRelativeToWorkspace);
  const gitDirectoryIsInsideWorkspace =
    nextGitDirectory && gitDirectoryRelativeToWorkspace !== "" && !gitDirectoryIsOutsideWorkspace;
  const needsSeparateGitWatcher = Boolean(nextGitDirectory && !gitDirectoryIsInsideWorkspace);

  if (nextGitDirectory !== watchedGitDirectory || (needsSeparateGitWatcher && !gitWatcher)) {
    closeWatcher(gitWatcher);
    gitWatcher = needsSeparateGitWatcher
      ? createWatcher(nextGitDirectory, true, false, (failedWatcher) => {
          if (gitWatcher === failedWatcher) gitWatcher = undefined;
        })
      : undefined;
    watchedGitDirectory = nextGitDirectory;
  }
};

const publishSyncOutcome = async (workspacePath: string, outcome: GitSyncOutcome) => {
  syncOutcomes.set(workspacePath, outcome);
  try {
    await ConfigManager.setGitSyncOutcome(workspacePath, outcome);
  } catch {
    /* The visible in-memory outcome remains available if config storage is unavailable. */
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send("git-sync-outcome-changed", outcome);
  }
};

const runWithSyncOutcome = async <T extends GitAutoSyncResult | GitRemoteSyncOperationResult>(
  workspacePath: string,
  source: GitSyncOutcome["source"],
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = syncOutcomes.get(workspacePath) ?? ConfigManager.getGitSyncOutcomeSync(workspacePath);
  const before = await readGitSyncLocalState(workspacePath);
  const startedAt = Date.now();
  activeSyncWorkspace = workspacePath;
  await publishSyncOutcome(workspacePath, {
    ...previous,
    ...before,
    workspacePath,
    source,
    phase: "running",
    startedAt,
    localCommitCreated: false,
    failureCount: previous?.failureCount ?? 0,
  });
  let result: T;
  try {
    result = await operation();
  } catch (error) {
    result = {
      status: "failed",
      error: sanitizeGitSyncError(error instanceof Error ? error.message : "Git synchronization failed."),
    } as T;
  }
  const after = await readGitSyncLocalState(workspacePath).catch(() => before);
  if (result.status === "failed") result = { ...result, error: sanitizeGitSyncError(result.error) };
  const uploadedRevision = result.uploadedRevision;
  const outcome = completedGitSyncOutcome({
    previous,
    before,
    after,
    localCommitCreated: result.localCommitCreated,
    source,
    workspacePath,
    startedAt,
    ...(result.status === "failed" ? { error: result.error } : {}),
    ...(uploadedRevision ? { uploadedRevision } : {}),
  });
  await publishSyncOutcome(workspacePath, outcome);
  activeSyncWorkspace = undefined;
  return result;
};

const syncExecutionOptions = (workspacePath: string, expectedDestination?: string): GitRemoteExecutionOptions => {
  const controller = new AbortController();
  activeSyncController = controller;
  activeScheduledConsent = expectedDestination ? { workspacePath, destination: expectedDestination } : undefined;
  return {
    signal: controller.signal,
    runLocal: <T>(operation: () => Promise<T>) =>
      queueWorkspaceMutation(async () => {
        if (controller.signal.aborted) throw new Error("Git synchronization was cancelled.");
        if (ConfigManager.getConfigValueSync("mainDirectory") !== workspacePath)
          throw new Error("The workspace changed before Git could apply its result.");
        if (expectedDestination) {
          const settings = ConfigManager.getGitAutoSyncSettingsSync(workspacePath);
          const current = await readGitAutoSyncDestination(workspacePath);
          if (
            settings.intervalMinutes === 0 ||
            settings.destination !== expectedDestination ||
            "error" in current ||
            current.destination !== expectedDestination
          ) {
            throw new Error("The workspace synchronization authorization or destination changed.");
          }
        }
        localSyncPhase = true;
        try {
          return await operation();
        } finally {
          localSyncPhase = false;
        }
      }),
  };
};

export const registerGitFileStatusIpc = () => {
  runtimeClosed = false;
  ipcMain.handle("cancel-git-sync", () => {
    if (!activeSyncController) return false;
    activeSyncController.abort();
    return true;
  });
  ipcMain.handle("get-git-sync-outcome", async () => {
    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    const outcome = syncOutcomes.get(workspacePath) ?? ConfigManager.getGitSyncOutcomeSync(workspacePath);
    if (!outcome) return null;
    const local = await readGitSyncLocalState(workspacePath);
    return outcome.phase === "running" && activeSyncWorkspace !== workspacePath
      ? {
          ...outcome,
          ...local,
          phase: "failed",
          error: "The previous synchronization was interrupted. Retry to confirm the remote upload.",
        }
      : { ...outcome, ...local };
  });
  unsubscribeWorkspaceMutations ??= onWorkspaceMutation(() => scheduleChangeEvent());
  ipcMain.handle("get-git-file-status", async (_event, forceRefresh: unknown) => {
    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    const result = await readStatus(workspacePath, forceRefresh === true);
    ensureWatchers(workspacePath, result.gitDirectory);
    return result.snapshot;
  });
  ipcMain.handle("get-git-remote-configuration", async () => {
    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    const status = await readStatus(workspacePath);
    ensureWatchers(workspacePath, status.gitDirectory);
    return readGitRemoteConfiguration(workspacePath, status);
  });
  ipcMain.handle("get-git-remote-sync-status", async () => {
    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    return queueWorkspaceRead(() => readGitRemoteSyncStatus(workspacePath));
  });
  ipcMain.handle(
    "get-git-file-history",
    async (_event, filePath: unknown, cursor?: unknown, limit?: unknown): Promise<GitFileHistoryPage> => {
      const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
      return queueWorkspaceRead(() =>
        readGitFileHistory(
          workspacePath,
          typeof filePath === "string" ? filePath : "",
          typeof cursor === "string" ? cursor : undefined,
          typeof limit === "number" ? limit : undefined,
        ),
      );
    },
  );

  const revisionRequest = (request: unknown): GitFileRevisionRequest => {
    const candidate = request && typeof request === "object" ? (request as Record<string, unknown>) : {};
    return {
      filePath: typeof candidate.filePath === "string" ? candidate.filePath : "",
      pathAtRevision: typeof candidate.pathAtRevision === "string" ? candidate.pathAtRevision : "",
      revisionId: typeof candidate.revisionId === "string" ? candidate.revisionId : "",
      restoreToken: typeof candidate.restoreToken === "string" ? candidate.restoreToken : "",
    };
  };

  const expectedFileVersion = (value: unknown): WorkspaceFileVersion | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.mtimeMs !== "number" ||
      !Number.isFinite(candidate.mtimeMs) ||
      typeof candidate.sizeBytes !== "number" ||
      !Number.isSafeInteger(candidate.sizeBytes) ||
      candidate.sizeBytes < 0 ||
      (candidate.id !== undefined && typeof candidate.id !== "string")
    ) {
      return undefined;
    }
    return {
      ...(typeof candidate.id === "string" ? { id: candidate.id } : {}),
      mtimeMs: candidate.mtimeMs,
      sizeBytes: candidate.sizeBytes,
    };
  };

  ipcMain.handle("get-git-file-revision", async (_event, request: unknown) => {
    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    return queueWorkspaceRead(() => readGitFileRevision(workspacePath, revisionRequest(request)));
  });
  ipcMain.handle("get-git-conflict-preview", async (_event, request: unknown): Promise<GitConflictPreviewResult> => {
    const candidate = request && typeof request === "object" ? (request as Record<string, unknown>) : {};
    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    return queueWorkspaceRead(() =>
      readGitConflictPreview(workspacePath, typeof candidate.path === "string" ? candidate.path : ""),
    );
  });
  ipcMain.handle("initialize-git-repository", async () => {
    if (initializationPromise) return initializationPromise;

    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    initializationPromise = queueWorkspaceRead(async () => {
      return initializeGitRepository(workspacePath);
    });
    try {
      const result = await initializationPromise;
      if (result.status !== "failed") {
        const refreshed = await readGitFileStatus(workspacePath);
        ensureWatchers(workspacePath, refreshed.gitDirectory);
        scheduleChangeEvent();
        if (refreshed.snapshot.status === "ready") return { ...result, snapshot: refreshed.snapshot };
      }
      return result;
    } finally {
      initializationPromise = undefined;
    }
  });

  const runMutation = async (
    operation: (workspacePath: string) => Promise<GitOperationResult>,
    event: { historyMayHaveChanged?: boolean; paths?: readonly string[]; treeMayHaveChanged?: boolean } = {},
    writesWorkspace = false,
  ): Promise<GitOperationResult> => {
    if (mutationInProgress) return { status: "failed", error: "Another Source Control action is still running." };
    mutationInProgress = true;
    try {
      const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
      const result = await (writesWorkspace ? queueWorkspaceMutation : queueWorkspaceRead)(() =>
        operation(workspacePath),
      );
      if (result.status === "succeeded") {
        scheduleChangeEvent(event);
      }
      return result;
    } catch (error) {
      console.error("Source Control action failed:", error);
      return { status: "failed", error: "Source Control could not complete that action." };
    } finally {
      mutationInProgress = false;
    }
  };

  const runRemoteMutation = async (
    operation: (workspacePath: string) => Promise<GitRemoteOperationResult>,
  ): Promise<GitRemoteOperationResult> => {
    if (mutationInProgress) return { status: "failed", error: "Another Source Control action is still running." };
    mutationInProgress = true;
    try {
      const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
      const result = await queueWorkspaceRead(() => operation(workspacePath));
      if (result.status === "succeeded") scheduleChangeEvent();
      return result;
    } catch (error) {
      console.error("Remote configuration action failed:", error);
      return { status: "failed", error: "Git could not update the remote configuration." };
    } finally {
      mutationInProgress = false;
    }
  };

  const runRemoteSync = async (
    operation: (
      workspacePath: string,
      hooksDirectory: string,
      options: GitRemoteExecutionOptions,
    ) => Promise<GitRemoteSyncOperationResult>,
    writesWorkspace = false,
  ): Promise<GitRemoteSyncOperationResult> => {
    if (mutationInProgress) return { status: "failed", error: "Another Version History action is still running." };
    mutationInProgress = true;
    try {
      const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
      const hooksDirectory = path.join(app.getPath("userData"), "empty-git-hooks");
      await mkdir(hooksDirectory, { mode: 0o700, recursive: true });
      const options = syncExecutionOptions(workspacePath);
      const result = await runWithSyncOutcome(workspacePath, "manual", () =>
        writesWorkspace
          ? options.runLocal!(() => operation(workspacePath, hooksDirectory, options))
          : operation(workspacePath, hooksDirectory, options),
      );
      if (result.status === "succeeded" && ConfigManager.getConfigValueSync("mainDirectory") === workspacePath) {
        const visiblePaths =
          result.changedPaths
            ?.map((change) => change.path)
            .filter((changedPath) => !isApplicationGitPath(changedPath)) ?? [];
        const writesFiles = result.action === "pulled" || result.action === "reconciliation-started";
        scheduleChangeEvent({
          historyMayHaveChanged: result.action === "pulled",
          paths: visiblePaths,
          treeMayHaveChanged: writesFiles && visiblePaths.length > 0,
        });
      }
      return result;
    } catch (error) {
      console.error("Remote synchronization action failed:", sanitizeGitSyncError(String(error)));
      return { status: "failed", error: "Git could not complete the remote action." };
    } finally {
      mutationInProgress = false;
      activeSyncController = undefined;
      activeScheduledConsent = undefined;
    }
  };

  const runAutoSync = async (capturedWorkspace?: string, expectedDestination?: string): Promise<GitAutoSyncResult> => {
    if (mutationInProgress) return { status: "failed", error: "Another Version History action is still running." };
    mutationInProgress = true;
    try {
      const workspacePath = capturedWorkspace ?? (await ConfigManager.getConfigValue("mainDirectory"));
      if (capturedWorkspace && ConfigManager.getConfigValueSync("mainDirectory") !== capturedWorkspace) {
        return { status: "failed", error: "The scheduled workspace is no longer active." };
      }
      const hooksDirectory = path.join(app.getPath("userData"), "empty-git-hooks");
      await mkdir(hooksDirectory, { mode: 0o700, recursive: true });
      const { conflictResolution } = ConfigManager.getGitAutoSyncSettingsSync(workspacePath);
      const options = syncExecutionOptions(workspacePath, expectedDestination);
      const result = await runWithSyncOutcome(workspacePath, capturedWorkspace ? "scheduled" : "manual", () =>
        (async () => {
          if (capturedWorkspace) {
            const settings = ConfigManager.getGitAutoSyncSettingsSync(capturedWorkspace);
            if (
              ConfigManager.getConfigValueSync("mainDirectory") !== capturedWorkspace ||
              settings.intervalMinutes === 0 ||
              settings.destination !== expectedDestination
            ) {
              return {
                status: "failed" as const,
                error: "The scheduled workspace authorization changed before synchronization began.",
              };
            }
            const currentDestination = await readGitAutoSyncDestination(capturedWorkspace);
            if ("error" in currentDestination || currentDestination.destination !== expectedDestination) {
              if (autoSyncTimer) clearInterval(autoSyncTimer);
              autoSyncTimer = undefined;
              await ConfigManager.setGitAutoSyncSettings(capturedWorkspace, {
                ...settings,
                destination: expectedDestination!,
                intervalMinutes: 0,
              });
              return {
                status: "failed" as const,
                error:
                  "error" in currentDestination
                    ? currentDestination.error
                    : "The remote destination changed. Review and enable auto-sync in Settings.",
              };
            }
          }
          return autoSyncGitRemote(workspacePath, conflictResolution, hooksDirectory, options, expectedDestination);
        })(),
      );
      if (result.status === "succeeded" && ConfigManager.getConfigValueSync("mainDirectory") === workspacePath) {
        const visiblePaths =
          result.changedPaths
            ?.map((change) => change.path)
            .filter((changedPath) => !isApplicationGitPath(changedPath)) ?? [];
        scheduleChangeEvent({
          historyMayHaveChanged: result.action !== "up-to-date",
          paths: visiblePaths,
          treeMayHaveChanged: visiblePaths.length > 0,
        });
      }
      return result;
    } catch (error) {
      console.error("Automatic Git synchronization failed:", sanitizeGitSyncError(String(error)));
      return { status: "failed", error: "Git could not complete automatic synchronization." };
    } finally {
      mutationInProgress = false;
      activeSyncController = undefined;
      activeScheduledConsent = undefined;
      if (!runtimeClosed) scheduleAutoSync();
    }
  };

  const scheduleAutoSync = () => {
    if (autoSyncTimer) clearInterval(autoSyncTimer);
    autoSyncTimer = undefined;
    let workspacePath: string;
    try {
      workspacePath = ConfigManager.getConfigValueSync("mainDirectory");
    } catch {
      return;
    }
    const { intervalMinutes, destination } = ConfigManager.getGitAutoSyncSettingsSync(workspacePath);
    if (intervalMinutes === 0 || !destination) return;
    const failures =
      (syncOutcomes.get(workspacePath) ?? ConfigManager.getGitSyncOutcomeSync(workspacePath))?.failureCount ?? 0;
    autoSyncTimer = setInterval(
      () => void runAutoSync(workspacePath, destination),
      intervalMinutes * 60_000 * Math.min(8, 2 ** failures),
    );
    autoSyncTimer.unref();
  };

  const currentAutoSyncSettings = async () => {
    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    const settings = ConfigManager.getGitAutoSyncSettingsSync(workspacePath);
    if (settings.intervalMinutes === 0) return settings;
    const current = await readGitAutoSyncDestination(workspacePath);
    return "error" in current || current.destination !== settings.destination
      ? { ...settings, intervalMinutes: 0 }
      : settings;
  };
  ipcMain.handle("get-git-auto-sync-settings", currentAutoSyncSettings);
  ipcMain.handle("set-git-auto-sync-settings", async (_event, value: unknown) => {
    const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const intervalMinutes = normalizeGitAutoSyncInterval(candidate.intervalMinutes);
    if (!isGitAutoSyncConflictResolution(candidate.conflictResolution) || intervalMinutes === null) {
      throw new TypeError("Select a valid auto-sync interval and conflict choice.");
    }
    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    const destination =
      intervalMinutes > 0 ? await readGitAutoSyncDestination(workspacePath) : { destination: "0".repeat(64) };
    if ("error" in destination) throw new Error(destination.error);
    await ConfigManager.setGitAutoSyncSettings(workspacePath, {
      conflictResolution: candidate.conflictResolution,
      intervalMinutes,
      destination: destination.destination,
    });
    scheduleAutoSync();
    return currentAutoSyncSettings();
  });
  unsubscribeConfigChanges ??= ConfigManager.onConfigChange((keys) => {
    if (!keys.some((key) => key === "mainDirectory" || key === "gitAutoSyncByWorkspace")) return;
    if (keys.includes("mainDirectory")) activeSyncController?.abort();
    if (keys.includes("gitAutoSyncByWorkspace") && activeScheduledConsent) {
      const settings = ConfigManager.getGitAutoSyncSettingsSync(activeScheduledConsent.workspacePath);
      if (!settings.intervalMinutes || settings.destination !== activeScheduledConsent.destination)
        activeSyncController?.abort();
    }
    scheduleAutoSync();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(CHANGE_EVENT, {
          treeMayHaveChanged: false,
          autoSyncSettingsChanged: true,
        } satisfies GitFileStatusChangeEvent);
      }
    }
  });
  ipcMain.handle("run-git-auto-sync", () => runAutoSync());
  ipcMain.handle("get-git-ignore-settings", async (): Promise<GitIgnoreSettingsResult> => {
    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    return queueWorkspaceRead(() => readGitIgnoreSettings(workspacePath));
  });
  ipcMain.handle("update-git-ignore-settings", async (_event, patterns: unknown): Promise<GitIgnoreUpdateResult> => {
    if (mutationInProgress) return { status: "failed", error: "Another Version History action is still running." };
    mutationInProgress = true;
    try {
      const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
      const result = await queueWorkspaceMutation(() => updateGitIgnoreSettings(workspacePath, patterns));
      if (result.status === "succeeded") {
        scheduleChangeEvent({ paths: [".gitignore", ...result.untrackedPaths], treeMayHaveChanged: false });
      }
      return result;
    } catch (error) {
      console.error("Git ignore settings failed:", error);
      return { status: "failed", error: "Git ignore settings could not be saved." };
    } finally {
      mutationInProgress = false;
    }
  });
  scheduleAutoSync();

  const runConflictMutation = async (
    operation: (workspacePath: string) => Promise<GitConflictOperationResult>,
  ): Promise<GitConflictOperationResult> => {
    if (mutationInProgress) return { status: "failed", error: "Another Version History action is still running." };
    mutationInProgress = true;
    try {
      const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
      const result = await queueWorkspaceMutation(() => operation(workspacePath));
      if (result.status === "succeeded") {
        const visiblePaths = result.changedPaths
          .map((change) => change.path)
          .filter((changedPath) => !isApplicationGitPath(changedPath));
        scheduleChangeEvent({ paths: visiblePaths, treeMayHaveChanged: visiblePaths.length > 0 });
      }
      return result;
    } catch (error) {
      console.error("Conflict resolution action failed:", error);
      return { status: "failed", error: "Git could not complete the conflict resolution action." };
    } finally {
      mutationInProgress = false;
    }
  };

  ipcMain.handle("stage-git-paths", (_event, paths: string[]) =>
    runMutation((workspacePath) => stageGitPaths(workspacePath, Array.isArray(paths) ? paths : [])),
  );
  ipcMain.handle("unstage-git-paths", (_event, paths: string[]) =>
    runMutation((workspacePath) => unstageGitPaths(workspacePath, Array.isArray(paths) ? paths : [])),
  );
  ipcMain.handle("revert-git-paths", (_event, paths: string[]) => {
    const selectedPaths = Array.isArray(paths) ? paths : [];
    const visiblePaths = selectedPaths.filter((selectedPath) => !isApplicationGitPath(selectedPath));
    return runMutation(
      (workspacePath) => revertGitPaths(workspacePath, selectedPaths),
      {
        paths: visiblePaths,
        treeMayHaveChanged: visiblePaths.length > 0,
      },
      true,
    );
  });
  ipcMain.handle("commit-git-changes", (_event, message: string) =>
    runMutation(
      async (workspacePath) => {
        const hooksDirectory = path.join(app.getPath("userData"), "empty-git-hooks");
        await mkdir(hooksDirectory, { mode: 0o700, recursive: true });
        return commitGitChanges(workspacePath, typeof message === "string" ? message : "", hooksDirectory);
      },
      { historyMayHaveChanged: true },
    ),
  );
  ipcMain.handle("set-git-remote-url", (_event, url: string) =>
    runRemoteMutation((workspacePath) => setGitRemoteUrl(workspacePath, typeof url === "string" ? url : "")),
  );
  ipcMain.handle("remove-git-remote", () => runRemoteMutation(removeGitRemote));
  ipcMain.handle("fetch-git-remote", () => runRemoteSync(fetchGitRemote));
  ipcMain.handle("pull-git-remote", () => runRemoteSync(pullGitRemote));
  ipcMain.handle("push-git-remote", () => runRemoteSync(pushGitRemote));
  ipcMain.handle("begin-git-remote-reconciliation", () => runRemoteSync(beginGitRemoteReconciliation, true));
  ipcMain.handle("resolve-git-conflict", (_event, request: unknown) => {
    const candidate = request && typeof request === "object" ? (request as Record<string, unknown>) : {};
    const resolution = candidate.resolution;
    const validResolution: GitConflictResolution | undefined =
      resolution === "keep-local" || resolution === "save-both" || resolution === "use-remote" ? resolution : undefined;
    if (!validResolution) return { status: "failed", error: "Select a valid conflict resolution choice." };
    return runConflictMutation((workspacePath) =>
      resolveGitConflict(workspacePath, typeof candidate.path === "string" ? candidate.path : "", validResolution),
    );
  });
  ipcMain.handle("abort-git-remote-reconciliation", () =>
    runConflictMutation((workspacePath) => abortGitRemoteReconciliation(workspacePath)),
  );
  ipcMain.handle("restore-git-file-revision", async (_event, request: unknown): Promise<GitFileRestoreResult> => {
    if (mutationInProgress) {
      return { status: "failed", error: "Another Source Control action is still running." };
    }
    mutationInProgress = true;
    try {
      const candidate = request && typeof request === "object" ? (request as Record<string, unknown>) : {};
      const expectedVersion = expectedFileVersion(candidate.expectedVersion);
      const parsedRequest = {
        ...revisionRequest(request),
        ...(expectedVersion ? { expectedVersion } : {}),
      } satisfies GitFileRestoreRequest;
      const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
      const result = await restoreGitFileRevision(workspacePath, parsedRequest);
      if (result.status === "succeeded") scheduleChangeEvent();
      return result;
    } catch (error) {
      console.error("File history restore failed:", error);
      return { status: "failed", error: "The historical file could not be restored." };
    } finally {
      mutationInProgress = false;
    }
  });
};

export const closeGitFileStatusRuntime = () => {
  runtimeClosed = true;
  activeSyncController?.abort();
  activeSyncController = undefined;
  activeScheduledConsent = undefined;
  localSyncPhase = false;
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = undefined;
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = undefined;
  pendingTreeChange = false;
  pendingHistoryChange = false;
  pendingPaths.clear();
  closeWatcher(workspaceWatcher);
  closeWatcher(gitWatcher);
  workspaceWatcher = undefined;
  gitWatcher = undefined;
  watchedWorkspace = "";
  watchedGitDirectory = "";
  mutationInProgress = false;
  activeSyncWorkspace = undefined;
  syncOutcomes.clear();
  unsubscribeConfigChanges?.();
  unsubscribeConfigChanges = undefined;
  unsubscribeWorkspaceMutations?.();
  unsubscribeWorkspaceMutations = undefined;
  initializationPromise = undefined;
  statusGeneration += 1;
  cachedStatus = undefined;
  statusRead = undefined;
};
