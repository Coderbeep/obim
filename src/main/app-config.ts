import type { GitSyncOutcome } from "@shared/git";
import { BrowserWindow, app, dialog } from "electron";
import { accessSync, constants, realpathSync, statSync } from "fs";
import path from "path";
import { assertRendererConfigKey, validateRendererConfigUpdate } from "./renderer-config";
import { trustedIpcMain as ipcMain } from "./trusted-ipc";

import {
  DEFAULT_DAILY_NOTE_CREATION_DIRECTORY,
  DEFAULT_GIT_AUTO_SYNC_CONFLICT_RESOLUTION,
  DEFAULT_GIT_AUTO_SYNC_INTERVAL_MINUTES,
  DEFAULT_SHOW_WINDOW_CONTROLS,
  DEFAULT_SIDEBAR_PLACEMENT,
  DEFAULT_TASK_CREATION_DIRECTORY,
  DEFAULT_ZOOM_FACTOR,
  isAppTheme,
  isGitAutoSyncConflictResolution,
  isSidebarPlacement,
  normalizeCreationDirectory,
  normalizeGitAutoSyncInterval,
  normalizeZoomFactor,
  type AppConfig,
  type AppTheme,
  type ConfigKey,
  type GitWorkspaceAutoSyncSettings,
  type SidebarPlacement,
  type WorkspaceBackupResult,
  type WorkspaceSelectionResult,
  type WorkspaceStatus,
} from "@shared/config";
import { mutateConfiguration, readConfiguration } from "./config-persistence";
import { createWorkspaceBackup } from "./workspace-backup";
import { removeLegacyWorkspaceFieldSchema } from "./workspace-migrations";

type Config = Partial<AppConfig>;

/**
 * Persists application settings in Electron's user-data directory and provides
 * typed access to them from the main process and renderer IPC handlers.
 */
class ConfigManager {
  private static changeListeners = new Set<(keys: ConfigKey[]) => void>();

  static onConfigChange(listener: (keys: ConfigKey[]) => void) {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private static CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

  private static getDefaultConfigValue<K extends ConfigKey>(key: K): AppConfig[K] | undefined {
    switch (key) {
      case "keyboardShortcuts":
        return {} as AppConfig[K];
      case "taskCreationDirectory":
        return DEFAULT_TASK_CREATION_DIRECTORY as AppConfig[K];
      case "dailyNoteCreationDirectory":
        return DEFAULT_DAILY_NOTE_CREATION_DIRECTORY as AppConfig[K];
      default:
        return undefined;
    }
  }

  static async initializeConfig(): Promise<WorkspaceSelectionResult> {
    try {
      const mainDirectoryPath = await this.promptUserForMainDirectory();
      if (!mainDirectoryPath) return { status: "cancelled" };

      await this.selectWorkspace(mainDirectoryPath);
      return { status: "selected", path: mainDirectoryPath };
    } catch (error) {
      console.error("Error while initializing config:", error);
      return { status: "error", error: error instanceof Error ? error.message : String(error) };
    }
  }

  static getWorkspaceStatusSync(): WorkspaceStatus {
    const mainDirectory = this.getConfigSync().mainDirectory;
    if (typeof mainDirectory !== "string" || !mainDirectory) return { status: "unconfigured" };
    try {
      if (!statSync(mainDirectory).isDirectory()) {
        return { status: "unavailable", path: mainDirectory, error: "The selected workspace is not a directory." };
      }
      accessSync(mainDirectory, constants.R_OK | constants.W_OK);
      return { status: "ready", path: mainDirectory };
    } catch (error) {
      return {
        status: "unavailable",
        path: mainDirectory,
        error: error instanceof Error ? error.message : "The workspace cannot be opened.",
      };
    }
  }

  static getRecentWorkspacesSync(): string[] {
    const recent = this.getConfigSync().recentWorkspaces;
    return Array.isArray(recent) ? recent.filter((value): value is string => typeof value === "string") : [];
  }

  static async selectRecentWorkspace(workspacePath: string): Promise<WorkspaceSelectionResult> {
    if (!this.getRecentWorkspacesSync().includes(workspacePath)) {
      return { status: "error", error: "That folder is not in the recent workspace list." };
    }
    const status = this.validateWorkspace(workspacePath);
    if (status.status !== "ready") return { status: "error", error: status.error };
    await this.selectWorkspace(workspacePath);
    return { status: "selected", path: workspacePath };
  }

  static async removeRecentWorkspace(workspacePath: string): Promise<string[]> {
    return this.mutateConfig((config) => {
      if (config.mainDirectory === workspacePath) throw new Error("The active workspace cannot be removed.");
      const recent = Array.isArray(config.recentWorkspaces)
        ? config.recentWorkspaces.filter((value): value is string => typeof value === "string")
        : [];
      config.recentWorkspaces = recent.filter((candidate) => candidate !== workspacePath);
      return config.recentWorkspaces;
    });
  }

  static async exportWorkspaceBackup(): Promise<WorkspaceBackupResult> {
    const workspace = this.getWorkspaceStatusSync();
    if (workspace.status !== "ready") {
      return { status: "error", error: "The current workspace is not available." };
    }
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose where to save the workspace backup",
      buttonLabel: "Save backup here",
    });
    if (result.canceled || !result.filePaths[0]) return { status: "cancelled" };
    return createWorkspaceBackup(workspace.path, result.filePaths[0]);
  }

  private static async getConfig(): Promise<Config> {
    return this.getConfigSync();
  }

  private static getConfigSync(): Config {
    return readConfiguration<Config>(this.CONFIG_PATH);
  }

  private static mutateConfig<R>(mutate: (config: Config) => R): Promise<R> {
    let changedKeys: ConfigKey[] = [];
    return mutateConfiguration<Config, R>(this.CONFIG_PATH, (config) => {
      const before = new Map(Object.entries(config).map(([key, value]) => [key, JSON.stringify(value)]));
      const result = mutate(config);
      changedKeys = [...new Set([...before.keys(), ...Object.keys(config)])].filter(
        (key) => before.get(key) !== JSON.stringify(config[key as ConfigKey]),
      ) as ConfigKey[];
      return result;
    }).then((result) => {
      for (const listener of this.changeListeners) {
        try {
          listener(changedKeys);
        } catch (error) {
          console.warn("Configuration observer failed:", error);
        }
      }
      return result;
    });
  }

  static async getConfigValue<K extends ConfigKey>(key: K): Promise<AppConfig[K]> {
    const config = await this.getConfig();
    const value = config[key];
    if (value === undefined) {
      const defaultValue = this.getDefaultConfigValue(key);
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`Missing config value: ${key}`);
    }
    return value;
  }

  static getConfigValueSync<K extends ConfigKey>(key: K): AppConfig[K] {
    const config = this.getConfigSync();
    const value = config[key];
    if (value === undefined) {
      const defaultValue = this.getDefaultConfigValue(key);
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`Missing config value: ${key}`);
    }
    return value;
  }

  static isPropertyDefinedSync(property: ConfigKey): boolean {
    const config = this.getConfigSync();
    return config[property] !== undefined;
  }

  static async removeDeprecatedSourcesSettings(): Promise<void> {
    try {
      await this.mutateConfig((config) => {
        const legacyConfig = config as Config & {
          sourcesUnpaywallEmail?: unknown;
          sourcesMetadataEnabled?: unknown;
          sourcesPdfDirectory?: unknown;
        };
        delete legacyConfig.sourcesUnpaywallEmail;
        delete legacyConfig.sourcesMetadataEnabled;
        delete legacyConfig.sourcesPdfDirectory;
      });
    } catch (error) {
      console.warn("Could not remove a deprecated Sources setting:", error);
    }
  }

  static getShowWindowControlsSync(): boolean {
    const value = this.getConfigSync().showWindowControls;
    return typeof value === "boolean" ? value : DEFAULT_SHOW_WINDOW_CONTROLS;
  }

  static getThemeSync(): AppTheme | null {
    const value = this.getConfigSync().theme;
    return isAppTheme(value) ? value : null;
  }

  static getSidebarPlacementSync(): SidebarPlacement {
    const value = this.getConfigSync().sidebarPlacement;
    return isSidebarPlacement(value) ? value : DEFAULT_SIDEBAR_PLACEMENT;
  }

  static getZoomFactorSync(): number {
    return normalizeZoomFactor(this.getConfigSync().zoomFactor) ?? DEFAULT_ZOOM_FACTOR;
  }

  private static workspaceIdentity(workspacePath: string) {
    try {
      return realpathSync(workspacePath);
    } catch {
      return path.resolve(workspacePath);
    }
  }

  static getGitAutoSyncSettingsSync(workspacePath?: string) {
    const config = this.getConfigSync();
    const workspace = workspacePath ?? config.mainDirectory;
    const stored = workspace ? config.gitAutoSyncByWorkspace?.[this.workspaceIdentity(workspace)] : undefined;
    const valid =
      stored &&
      typeof stored.destination === "string" &&
      /^[0-9a-f]{64}$/u.test(stored.destination) &&
      isGitAutoSyncConflictResolution(stored.conflictResolution) &&
      normalizeGitAutoSyncInterval(stored.intervalMinutes) !== null;
    // Legacy global settings retain the user's conflict preference but never enable
    // a workspace until its destination has been explicitly authorized.
    return {
      conflictResolution: valid
        ? stored.conflictResolution
        : isGitAutoSyncConflictResolution(config.gitAutoSyncConflictResolution)
          ? config.gitAutoSyncConflictResolution
          : DEFAULT_GIT_AUTO_SYNC_CONFLICT_RESOLUTION,
      intervalMinutes: valid ? stored.intervalMinutes : DEFAULT_GIT_AUTO_SYNC_INTERVAL_MINUTES,
      ...(valid ? { destination: stored.destination } : {}),
    };
  }

  static getGitSyncOutcomeSync(workspacePath: string): GitSyncOutcome | undefined {
    const outcome = this.getConfigSync().gitSyncOutcomesByWorkspace?.[this.workspaceIdentity(workspacePath)];
    return outcome &&
      ["running", "failed", "succeeded"].includes(outcome.phase) &&
      typeof outcome.workspacePath === "string" &&
      Number.isFinite(outcome.startedAt)
      ? outcome
      : undefined;
  }

  static async setGitSyncOutcome(workspacePath: string, outcome: GitSyncOutcome): Promise<void> {
    await this.mutateConfig((config) => {
      config.gitSyncOutcomesByWorkspace = {
        ...config.gitSyncOutcomesByWorkspace,
        [this.workspaceIdentity(workspacePath)]: outcome,
      };
    });
  }

  static async setGitAutoSyncSettings(workspacePath: string, settings: GitWorkspaceAutoSyncSettings): Promise<void> {
    if (
      !/^[0-9a-f]{64}$/u.test(settings.destination) ||
      !isGitAutoSyncConflictResolution(settings.conflictResolution) ||
      normalizeGitAutoSyncInterval(settings.intervalMinutes) === null
    )
      throw new TypeError("Select valid workspace auto-sync settings.");
    const identity = this.workspaceIdentity(workspacePath);
    await this.mutateConfig((config) => {
      config.gitAutoSyncByWorkspace = { ...config.gitAutoSyncByWorkspace, [identity]: { ...settings } };
      delete config.gitAutoSyncIntervalMinutes;
      delete config.gitAutoSyncConflictResolution;
    });
  }

  private static validateWorkspace(
    workspacePath: string,
  ): Extract<WorkspaceStatus, { status: "ready" | "unavailable" }> {
    try {
      if (!statSync(workspacePath).isDirectory()) {
        return { status: "unavailable", path: workspacePath, error: "The selected workspace is not a directory." };
      }
      accessSync(workspacePath, constants.R_OK | constants.W_OK);
      return { status: "ready", path: workspacePath };
    } catch (error) {
      return {
        status: "unavailable",
        path: workspacePath,
        error: error instanceof Error ? error.message : "The workspace cannot be opened.",
      };
    }
  }

  private static async selectWorkspace(workspacePath: string): Promise<void> {
    const status = this.validateWorkspace(workspacePath);
    if (status.status !== "ready") throw new Error(status.error);
    await this.mutateConfig((config) => {
      const recent = Array.isArray(config.recentWorkspaces) ? config.recentWorkspaces : [];
      config.mainDirectory = workspacePath;
      config.recentWorkspaces = [workspacePath, ...recent.filter((candidate) => candidate !== workspacePath)].slice(
        0,
        6,
      );
    });
    await removeLegacyWorkspaceFieldSchema(workspacePath);
  }

  static async updateConfig<K extends ConfigKey>(key: K, value: AppConfig[K]): Promise<void> {
    await this.mutateConfig((config) => {
      if (key === "taskCreationDirectory" || key === "dailyNoteCreationDirectory") {
        const normalized = normalizeCreationDirectory(value);
        if (normalized === null) throw new TypeError("Creation folders must be inside the current workspace");
        config[key] = normalized as AppConfig[K];
      } else if (key === "gitAutoSyncIntervalMinutes") {
        const normalized = normalizeGitAutoSyncInterval(value);
        if (normalized === null) throw new TypeError("Auto-sync interval must be 0 or between 1 and 1440 minutes");
        config[key] = normalized as AppConfig[K];
      } else if (key === "gitAutoSyncConflictResolution") {
        if (!isGitAutoSyncConflictResolution(value)) throw new TypeError("Select a valid auto-sync conflict choice");
        config[key] = value as AppConfig[K];
      } else {
        config[key] = value;
      }
    });
    if (key === "mainDirectory") await removeLegacyWorkspaceFieldSchema(String(value));
  }

  private static async promptUserForMainDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select main directory",
    });

    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  }
}

// Renderer configuration API

ipcMain.handle("get-config-value", async (_, key: unknown) => {
  assertRendererConfigKey(key);
  return ConfigManager.getConfigValue(key);
});

ipcMain.handle("update-config", async (_, key: unknown, value: unknown) =>
  ConfigManager.updateConfig(validateRendererConfigUpdate(key, value), value as AppConfig[ConfigKey]),
);

ipcMain.on("get-main-directory-path-sync", (event) => {
  event.returnValue = ConfigManager.getConfigValueSync("mainDirectory");
});

ipcMain.handle("initialize-config", async () => ConfigManager.initializeConfig());

ipcMain.handle("select-recent-workspace", async (_, workspacePath: unknown) =>
  typeof workspacePath === "string"
    ? ConfigManager.selectRecentWorkspace(workspacePath)
    : ({ status: "error", error: "Invalid workspace path." } satisfies WorkspaceSelectionResult),
);

ipcMain.handle("remove-recent-workspace", async (_, workspacePath: unknown) => {
  if (typeof workspacePath !== "string" || !workspacePath) throw new TypeError("Invalid workspace path.");
  return ConfigManager.removeRecentWorkspace(workspacePath);
});

ipcMain.handle("export-workspace-backup", async () => ConfigManager.exportWorkspaceBackup());

ipcMain.on("get-workspace-status-sync", (event) => {
  event.returnValue = ConfigManager.getWorkspaceStatusSync();
});

ipcMain.on("get-recent-workspaces-sync", (event) => {
  event.returnValue = ConfigManager.getRecentWorkspacesSync();
});

ipcMain.on("is-main-directory-defined-sync", (event) => {
  event.returnValue = ConfigManager.isPropertyDefinedSync("mainDirectory");
});

ipcMain.on("get-show-window-controls-sync", (event) => {
  event.returnValue = ConfigManager.getShowWindowControlsSync();
});

ipcMain.on("get-theme-sync", (event) => {
  event.returnValue = ConfigManager.getThemeSync();
});

ipcMain.on("get-sidebar-placement-sync", (event) => {
  event.returnValue = ConfigManager.getSidebarPlacementSync();
});

ipcMain.on("get-zoom-factor-sync", (event) => {
  event.returnValue = ConfigManager.getZoomFactorSync();
});

ipcMain.on("get-app-version-sync", (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.handle("set-show-window-controls", async (_, visible: unknown) => {
  if (typeof visible !== "boolean") throw new TypeError("Window controls visibility must be a boolean");

  await ConfigManager.updateConfig("showWindowControls", visible);
  if (process.platform === "darwin") {
    for (const window of BrowserWindow.getAllWindows()) {
      window.setWindowButtonVisibility(visible);
    }
  }
});

ipcMain.handle("set-theme", async (_, theme: unknown) => {
  if (!isAppTheme(theme)) throw new TypeError("Theme must be light, dark, or system");
  await ConfigManager.updateConfig("theme", theme);
});

ipcMain.handle("set-sidebar-placement", async (_, placement: unknown) => {
  if (!isSidebarPlacement(placement)) {
    throw new TypeError("Sidebar placement must put the explorer on the left or right");
  }
  await ConfigManager.updateConfig("sidebarPlacement", placement);
});

ipcMain.handle("set-zoom-factor", async (event, value: unknown) => {
  const zoomFactor = normalizeZoomFactor(value);
  if (zoomFactor === null) throw new TypeError("Zoom factor must be between 50% and 200%");
  await ConfigManager.updateConfig("zoomFactor", zoomFactor);
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.webContents.setZoomFactor(zoomFactor);
  return zoomFactor;
});

export default ConfigManager;

ipcMain.on("get-keyboard-shortcuts-sync", (event) => {
  event.returnValue = ConfigManager.getConfigValueSync("keyboardShortcuts");
});
ConfigManager.onConfigChange((keys) => {
  if (!keys.includes("keyboardShortcuts")) return;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("keyboard-shortcuts-changed", ConfigManager.getConfigValueSync("keyboardShortcuts"));
  }
});
