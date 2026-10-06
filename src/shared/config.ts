import type { GitSyncOutcome } from "./git";
import type { ShortcutOverrides } from "./keyboard-shortcuts";
import { isValidFilename } from "./pathUtils";

export interface AppConfig {
  taskBoardOpenMode?: "tab" | "hover";
  keyboardShortcuts?: ShortcutOverrides;
  dailyNoteCreationDirectory: string;
  mainDirectory: string;
  recentWorkspaces: string[];
  showWindowControls: boolean;
  sidebarPlacement: SidebarPlacement;
  gitAutoSyncConflictResolution: GitAutoSyncConflictResolution;
  gitAutoSyncIntervalMinutes: number;
  gitAutoSyncByWorkspace: Record<string, GitWorkspaceAutoSyncSettings>;
  gitSyncOutcomesByWorkspace: Record<string, GitSyncOutcome>;
  taskCreationDirectory: string;
  theme: AppTheme;
  zoomFactor: number;
}

export interface GitWorkspaceAutoSyncSettings {
  destination: string;
  conflictResolution: GitAutoSyncConflictResolution;
  intervalMinutes: number;
}

export type GitAutoSyncConflictResolution = "keep-local" | "use-remote";

export const DEFAULT_GIT_AUTO_SYNC_CONFLICT_RESOLUTION: GitAutoSyncConflictResolution = "keep-local";
export const DEFAULT_GIT_AUTO_SYNC_INTERVAL_MINUTES = 0;
export const MIN_GIT_AUTO_SYNC_INTERVAL_MINUTES = 1;
export const MAX_GIT_AUTO_SYNC_INTERVAL_MINUTES = 24 * 60;

export const isGitAutoSyncConflictResolution = (value: unknown): value is GitAutoSyncConflictResolution =>
  value === "keep-local" || value === "use-remote";

export const normalizeGitAutoSyncInterval = (value: unknown) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  (value === 0 || (value >= MIN_GIT_AUTO_SYNC_INTERVAL_MINUTES && value <= MAX_GIT_AUTO_SYNC_INTERVAL_MINUTES))
    ? value
    : null;

export type ConfigKey = keyof AppConfig;

export const DEFAULT_SHOW_WINDOW_CONTROLS = true;
export const DEFAULT_ZOOM_FACTOR = 1;
export const DEFAULT_TASK_CREATION_DIRECTORY = "Tasks";
export const DEFAULT_DAILY_NOTE_CREATION_DIRECTORY = "";

/** Normalizes a portable workspace-relative directory. An empty string selects the workspace root. */
export const normalizeCreationDirectory = (value: unknown) => {
  if (typeof value !== "string") return null;
  const portablePath = value.trim().replaceAll("\\", "/");
  if (portablePath.startsWith("/") || /^[A-Za-z]:\//u.test(portablePath)) return null;
  const normalized = portablePath.replace(/\/+$/gu, "");
  if (!normalized) return "";
  return normalized.split("/").every(isValidFilename) ? normalized : null;
};

export const normalizeZoomFactor = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0.5, Math.min(2, Math.round(value * 10) / 10)) : null;

export const SIDEBAR_PLACEMENTS = {
  EXPLORER_LEFT: "explorer-left",
  EXPLORER_RIGHT: "explorer-right",
} as const;

export type SidebarPlacement = (typeof SIDEBAR_PLACEMENTS)[keyof typeof SIDEBAR_PLACEMENTS];

export const DEFAULT_SIDEBAR_PLACEMENT = SIDEBAR_PLACEMENTS.EXPLORER_LEFT;

export const isSidebarPlacement = (value: unknown): value is SidebarPlacement =>
  value === SIDEBAR_PLACEMENTS.EXPLORER_LEFT || value === SIDEBAR_PLACEMENTS.EXPLORER_RIGHT;

export const APP_THEMES = {
  DARK: "dark",
  LIGHT: "light",
  SYSTEM: "system",
} as const;

export type AppTheme = (typeof APP_THEMES)[keyof typeof APP_THEMES];

export const isAppTheme = (value: unknown): value is AppTheme =>
  value === APP_THEMES.DARK || value === APP_THEMES.LIGHT || value === APP_THEMES.SYSTEM;

export type WorkspaceStatus =
  | { status: "ready"; path: string }
  | { status: "unconfigured" }
  | { status: "unavailable"; path: string; error: string };

export type WorkspaceSelectionResult =
  { status: "selected"; path: string } | { status: "cancelled" } | { status: "error"; error: string };

export type WorkspaceBackupResult =
  { status: "created"; path: string } | { status: "cancelled" } | { status: "error"; error: string };
