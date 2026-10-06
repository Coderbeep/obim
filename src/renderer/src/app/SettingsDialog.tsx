import {
  IconBook,
  IconChevron,
  IconDesktop,
  IconEye,
  IconEyeSlash,
  IconFileExport,
  IconFolder,
  IconFolderOpen,
  IconFolders,
  IconGear,
  IconKey,
  IconMinus,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSidebarLeft,
  IconSun,
  IconThemes,
  IconTrash,
} from "@pierre/icons";
import { switchWorkspaceSafely } from "@renderer/features/files/workspaceTransition";
import { IconGitBranch } from "@renderer/shared/icons/IconGitBranch";
import { IconTaskBoard } from "@renderer/shared/icons/IconTaskBoard";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { KeyboardShortcutSettings } from "./KeyboardShortcutSettings";

import {
  getDailyNoteCreationDirectory,
  getTaskBoardOpenMode,
  getTaskCreationDirectory,
  updateConfig,
} from "@renderer/config";
import { saveDirtyFileBuffers } from "@renderer/features/files/dirtyFileBuffers";
import { Button } from "@renderer/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@renderer/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@renderer/shared/ui/dropdown-menu";
import { settingsDialogOpenRequestAtom, shortcutHelpOpenAtom } from "@renderer/store/appSessionStore";
import { fileTreeAtom } from "@renderer/store/fileExplorerStore";
import {
  DEFAULT_DAILY_NOTE_CREATION_DIRECTORY,
  DEFAULT_TASK_CREATION_DIRECTORY,
  type WorkspaceStatus,
} from "@shared/config";
import type { FileItem } from "@shared/file-item";
import { basename, getPathWithoutFilename } from "@shared/pathUtils";

import { GitSettings } from "./GitSettings";
import { resetAppLayout } from "./layoutPreferences";
import "./SettingsDialog.css";
import {
  applySidebarPlacement,
  persistSidebarPlacement,
  useSidebarPlacement,
  type SidebarPlacement,
} from "./sidebarPlacement";
import { applyAppTheme, persistAppTheme, readAppTheme, type AppTheme } from "./theme";
import { useWindowControls } from "./useWindowControls";

type SettingsSection = "task-board" | "about" | "appearance" | "backup" | "git" | "keyboard" | "workspace";

const NAV_GROUPS = ["Preferences", "Workspace", "Data", "Help"] as const;
const NAV_ITEMS = [
  {
    id: "appearance",
    label: "Appearance",
    group: "Preferences",
    icon: IconThemes,
    terms: "theme color window sidebar layout zoom interface scale panels",
  },
  { id: "keyboard", label: "Shortcuts", group: "Preferences", icon: IconKey, terms: "keyboard keys bindings" },
  {
    id: "workspace",
    label: "Workspace",
    group: "Workspace",
    icon: IconFolders,
    terms: "folder recent creation location",
  },
  { id: "task-board", label: "Task Board", group: "Workspace", icon: IconTaskBoard, terms: "tasks opening" },
  { id: "backup", label: "Backup & export", group: "Data", icon: IconFileExport, terms: "archive save copy" },
  { id: "git", label: "Version history", group: "Data", icon: IconGitBranch, terms: "git repository sync remote" },
  {
    id: "about",
    label: "About & help",
    group: "Help",
    icon: IconBook,
    terms: "version guide documentation support issues",
  },
] as const;

const SettingsNavButton = ({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof IconThemes;
  label: string;
  onClick(): void;
}) => (
  <button
    type="button"
    className="settings-nav-button"
    data-active={active ? "true" : undefined}
    aria-current={active ? "page" : undefined}
    onClick={onClick}
  >
    <Icon size={15} aria-hidden="true" />
    <span>{label}</span>
  </button>
);

const SettingsPage = ({
  children,
  title,
  description,
}: {
  children: ReactNode;
  title: string;
  description: string;
}) => (
  <section className="settings-page" aria-label={title}>
    <header className="settings-page-heading">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
    <div className="settings-groups">{children}</div>
  </section>
);

const SettingsGroup = ({ children, title }: { children: ReactNode; title: string }) => (
  <section className="settings-group">
    <h3>{title}</h3>
    <div className="settings-group-card">{children}</div>
  </section>
);

const SettingsRow = ({ children, description, label }: { children: ReactNode; description: string; label: string }) => (
  <div className="settings-row">
    <div className="settings-row-copy">
      <strong>{label}</strong>
      <span>{description}</span>
    </div>
    <div className="settings-row-control">{children}</div>
  </div>
);

const Choice = ({ children, selected, onSelect }: { children: ReactNode; selected: boolean; onSelect(): void }) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    tabIndex={selected ? 0 : -1}
    data-selected={selected ? "true" : undefined}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const options = Array.from(
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)') ??
          [],
      );
      if (!options.length) return;
      const index = options.indexOf(event.currentTarget);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + options.length) % options.length;
      event.preventDefault();
      options[next].focus();
      options[next].click();
    }}
    onClick={onSelect}
  >
    {children}
  </button>
);

const workspaceDirectoryOptions = (items: readonly FileItem[]): FileItem[] =>
  items
    .flatMap((item): FileItem[] => (item.isDirectory ? [item, ...workspaceDirectoryOptions(item.children ?? [])] : []))
    .map((directory) => ({ ...directory, relativePath: directory.relativePath.replaceAll("\\", "/") }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

const CreationFolderPicker = ({
  disabled = false,
  label,
  options,
  value,
  onChange,
}: {
  disabled?: boolean;
  label: string;
  options: readonly FileItem[];
  value: string;
  onChange(value: string): void;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryTokens = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  const visibleOptions = options.filter((directory) => {
    const searchable = `${directory.filename} ${directory.relativePath}`.toLocaleLowerCase();
    return queryTokens.every((token) => searchable.includes(token));
  });
  const rootSearchable = "workspace root top level";
  const rootVisible = queryTokens.every((token) => rootSearchable.includes(token));
  const selectedPath = !value
    ? "Workspace root"
    : options.some((directory) => directory.relativePath === value)
      ? value
      : `${value} (folder unavailable)`;

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="settings-folder-picker"
          aria-label={label}
          title={selectedPath}
          disabled={disabled}
        >
          <IconFolder size={14} aria-hidden="true" />
          <span>{selectedPath}</span>
          <IconChevron className="settings-folder-picker-chevron" size={12} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="settings-folder-picker-menu">
        <div className="settings-folder-picker-search">
          <IconSearch size={14} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            aria-label={`Search folders for ${label.toLocaleLowerCase()}`}
            placeholder="Search folders…"
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Escape", "Tab"].includes(event.key)) event.stopPropagation();
            }}
          />
        </div>
        {rootVisible || visibleOptions.length ? (
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(directory) => {
              setQuery("");
              onChange(directory);
            }}
          >
            {rootVisible ? (
              <DropdownMenuRadioItem value="" className="settings-folder-picker-option">
                <IconFolder aria-hidden="true" />
                <span>
                  <strong>Workspace root</strong>
                  <small>Top level of this workspace</small>
                </span>
              </DropdownMenuRadioItem>
            ) : null}
            {visibleOptions.map((directory) => (
              <DropdownMenuRadioItem
                key={directory.path}
                value={directory.relativePath}
                className="settings-folder-picker-option"
                title={directory.relativePath}
              >
                <IconFolder aria-hidden="true" />
                <span>
                  <strong>{directory.filename}</strong>
                  <small>{getPathWithoutFilename(directory.relativePath) || "Workspace root"}</small>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <p className="settings-folder-picker-empty">No matching folders</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const SettingsDialog = () => {
  const store = useStore();
  const fileTree = useAtomValue(fileTreeAtom);
  const settingsDialogOpenRequest = useAtomValue(settingsDialogOpenRequestAtom);
  const setShortcutHelpOpen = useSetAtom(shortcutHelpOpenAtom);
  const [open, setOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const handledSettingsDialogOpenRequest = useRef(settingsDialogOpenRequest);

  useEffect(() => {
    if (settingsDialogOpenRequest === handledSettingsDialogOpenRequest.current) return;
    handledSettingsDialogOpenRequest.current = settingsDialogOpenRequest;
    settingsTriggerRef.current?.click();
  }, [settingsDialogOpenRequest]);
  const [taskOpenMode, setTaskOpenMode] = useState<"tab" | "hover">("tab");
  const [taskOpenModeError, setTaskOpenModeError] = useState(false);
  const [savingTaskOpenMode, setSavingTaskOpenMode] = useState(false);
  useEffect(() => {
    void getTaskBoardOpenMode().then(setTaskOpenMode);
  }, []);
  const selectTaskOpenMode = async (mode: "tab" | "hover") => {
    if (savingTaskOpenMode) return;
    setSavingTaskOpenMode(true);
    setTaskOpenModeError(false);
    try {
      await updateConfig("taskBoardOpenMode", mode);
      setTaskOpenMode(mode);
    } catch {
      setTaskOpenModeError(true);
    } finally {
      setSavingTaskOpenMode(false);
    }
  };
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [navigationQuery, setNavigationQuery] = useState("");
  const visibleNavItems = NAV_ITEMS.filter((item) =>
    `${item.label} ${item.group} ${item.terms}`
      .toLocaleLowerCase()
      .includes(navigationQuery.trim().toLocaleLowerCase()),
  );
  const [theme, setTheme] = useState<AppTheme>(readAppTheme);
  const [themeSaveError, setThemeSaveError] = useState(false);
  const themeSaveRequestRef = useRef(0);
  const sidebarPlacement = useSidebarPlacement();
  const [sidebarPlacementSaveError, setSidebarPlacementSaveError] = useState(false);
  const sidebarPlacementSaveRequestRef = useRef(0);
  const [zoomFactor, setZoomFactor] = useState(() => window.config.getZoomFactorSync?.() ?? 1);
  const [zoomMessage, setZoomMessage] = useState<string | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>(
    () => window.config.getWorkspaceStatusSync?.() ?? { status: "unconfigured" },
  );
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(
    () => window.config.getRecentWorkspacesSync?.() ?? [],
  );
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [workspaceBusyAction, setWorkspaceBusyAction] = useState<"backup" | "switch" | null>(null);
  const [removingWorkspacePath, setRemovingWorkspacePath] = useState<string | null>(null);
  const [taskCreationDirectory, setTaskCreationDirectory] = useState(DEFAULT_TASK_CREATION_DIRECTORY);
  const [dailyNoteCreationDirectory, setDailyNoteCreationDirectory] = useState(DEFAULT_DAILY_NOTE_CREATION_DIRECTORY);
  const [creationDirectoryMessage, setCreationDirectoryMessage] = useState<string | null>(null);
  const creationDirectorySaveRequests = useRef({ dailyNote: 0, task: 0 });
  const windowControls = useWindowControls();
  const appVersion = window.config.getAppVersionSync?.() ?? "development";
  const directoryOptions = useMemo(() => workspaceDirectoryOptions(fileTree), [fileTree]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getTaskCreationDirectory(), getDailyNoteCreationDirectory()]).then(
      ([taskDirectory, dailyNoteDirectory]) => {
        if (cancelled) return;
        setTaskCreationDirectory(taskDirectory);
        setDailyNoteCreationDirectory(dailyNoteDirectory);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const selectTheme = (nextTheme: AppTheme) => {
    const requestId = ++themeSaveRequestRef.current;
    setTheme(nextTheme);
    applyAppTheme(nextTheme);
    setThemeSaveError(false);
    void persistAppTheme(nextTheme).catch((error) => {
      console.error("Unable to save color theme:", error);
      if (themeSaveRequestRef.current === requestId) setThemeSaveError(true);
    });
  };
  const selectSidebarPlacement = (nextPlacement: SidebarPlacement) => {
    const requestId = ++sidebarPlacementSaveRequestRef.current;
    applySidebarPlacement(nextPlacement);
    setSidebarPlacementSaveError(false);
    void persistSidebarPlacement(nextPlacement).catch((error) => {
      console.error("Unable to save sidebar placement:", error);
      if (sidebarPlacementSaveRequestRef.current === requestId) setSidebarPlacementSaveError(true);
    });
  };
  const selectWindowControlsVisibility = (visible: boolean) => {
    void windowControls.updateVisibility(visible).catch((error) => {
      console.error("Unable to update window controls visibility:", error);
    });
  };
  const updateZoom = async (next: number) => {
    setZoomMessage(null);
    try {
      const saved = await window.config.setZoomFactor(next);
      setZoomFactor(saved);
    } catch (error) {
      setZoomMessage(error instanceof Error ? error.message : "The zoom level could not be changed.");
    }
  };
  const saveCreationDirectory = (kind: "dailyNote" | "task", nextDirectory: string) => {
    const key = kind === "task" ? "taskCreationDirectory" : "dailyNoteCreationDirectory";
    const requestId = ++creationDirectorySaveRequests.current[kind];
    if (kind === "task") setTaskCreationDirectory(nextDirectory);
    else if (kind === "dailyNote") setDailyNoteCreationDirectory(nextDirectory);
    setCreationDirectoryMessage(null);
    const save = window.config.updateConfig;
    if (!save) {
      setCreationDirectoryMessage("Creation folders could not be saved in this build.");
      return;
    }
    const persist = kind === "dailyNote" ? updateConfig(key, nextDirectory) : save(key, nextDirectory);
    void persist.catch((error) => {
      console.error("Unable to save creation folder:", error);
      if (creationDirectorySaveRequests.current[kind] === requestId) {
        setCreationDirectoryMessage("The creation folder couldn't be saved. Choose another workspace folder.");
      }
    });
  };
  const refreshWorkspaceDetails = () => {
    setWorkspaceStatus(window.config.getWorkspaceStatusSync?.() ?? { status: "unconfigured" });
    setRecentWorkspaces(window.config.getRecentWorkspacesSync?.() ?? []);
    setZoomFactor(window.config.getZoomFactorSync?.() ?? 1);
  };
  const changeWorkspace = async (select: () => ReturnType<typeof window.config.initializeConfig>) => {
    setWorkspaceMessage(null);
    setWorkspaceBusyAction("switch");
    try {
      const result = await switchWorkspaceSafely(store, select, () => window.location.reload());
      if (result.status === "cancelled") setWorkspaceMessage("No folder was selected. Your workspace is unchanged.");
      else if (result.status === "error") setWorkspaceMessage(result.error);
    } finally {
      setWorkspaceBusyAction(null);
    }
  };
  const chooseWorkspace = () => changeWorkspace(() => window.config.initializeConfig());
  const selectRecentWorkspace = (workspacePath: string) =>
    changeWorkspace(() => window.config.selectRecentWorkspace(workspacePath));
  const removeRecentWorkspace = async (workspacePath: string) => {
    setWorkspaceMessage(null);
    setRemovingWorkspacePath(workspacePath);
    try {
      const nextRecentWorkspaces = await window.config.removeRecentWorkspace(workspacePath);
      setRecentWorkspaces(nextRecentWorkspaces);
      setWorkspaceMessage(`${basename(workspacePath)} was removed from recent workspaces. Its files remain on disk.`);
    } catch (error) {
      console.error("Unable to remove recent workspace:", error);
      setWorkspaceMessage("The workspace could not be removed from the recent list.");
    } finally {
      setRemovingWorkspacePath(null);
    }
  };
  const exportBackup = async () => {
    setWorkspaceMessage(null);
    const saved = await saveDirtyFileBuffers(store);
    if (!saved.success) {
      setWorkspaceMessage("The backup was not created because one or more notes could not be saved.");
      return;
    }
    setWorkspaceBusyAction("backup");
    try {
      const result = await window.config.exportWorkspaceBackup();
      if (result.status === "created") setWorkspaceMessage(`Backup created at ${result.path}`);
      else if (result.status === "cancelled") setWorkspaceMessage("Backup cancelled. No files were changed.");
      else setWorkspaceMessage(result.error);
    } finally {
      setWorkspaceBusyAction(null);
    }
  };
  const revealWorkspace = async () => {
    const result = await window.api.revealInSystemFileManager("");
    if (!result.success) setWorkspaceMessage(result.error);
  };
  const openHelpLink = async (url: string) => {
    const result = await window.api.openExternalLink(url);
    if (!result.success) setWorkspaceMessage("The help page could not be opened.");
  };
  const availableRecentWorkspaces = recentWorkspaces.filter(
    (workspacePath) => workspaceStatus.status !== "ready" || workspacePath !== workspaceStatus.path,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          refreshWorkspaceDetails();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          ref={settingsTriggerRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Open settings"
          title="Settings"
        >
          <IconGear size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="settings-dialog">
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="settings-shell">
          <nav className="settings-nav" aria-label="Settings sections">
            <label className="settings-nav-search">
              <IconSearch size={15} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search settings"
                placeholder="Search settings"
                value={navigationQuery}
                onChange={(event) => setNavigationQuery(event.currentTarget.value)}
              />
            </label>
            <div className="settings-nav-groups">
              {NAV_GROUPS.map((group) => {
                const items = visibleNavItems.filter((item) => item.group === group);
                if (!items.length) return null;
                return (
                  <section className="settings-nav-group" key={group} aria-label={group}>
                    <h2>{group}</h2>
                    {items.map((item) => (
                      <SettingsNavButton
                        key={item.id}
                        active={section === item.id}
                        icon={item.icon}
                        label={item.label}
                        onClick={() => {
                          setSection(item.id);
                          setNavigationQuery("");
                        }}
                      />
                    ))}
                  </section>
                );
              })}
              {!visibleNavItems.length ? <p className="settings-nav-empty">No matching settings pages</p> : null}
            </div>
            <span className="settings-nav-version">Obim {appVersion}</span>
          </nav>

          {section === "workspace" ? (
            <SettingsPage title="Workspace" description="Choose where Obim keeps and creates your files.">
              <SettingsGroup title="Current workspace">
                <SettingsRow
                  label={workspaceStatus.status === "ready" ? basename(workspaceStatus.path) : "No workspace selected"}
                  description={
                    workspaceStatus.status === "unconfigured" ? "Choose a folder to begin." : workspaceStatus.path
                  }
                >
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void revealWorkspace()}
                    disabled={workspaceStatus.status !== "ready"}
                  >
                    <IconFolderOpen size={14} /> Reveal
                  </Button>
                  <Button type="button" onClick={() => void chooseWorkspace()} disabled={workspaceBusyAction !== null}>
                    {workspaceBusyAction === "switch" ? "Choosing…" : "Switch folder"}
                  </Button>
                </SettingsRow>
                {workspaceStatus.status === "unavailable" ? (
                  <p className="settings-message settings-message-warning" role="alert">
                    This folder is unavailable. Choose another folder to reconnect Obim.
                  </p>
                ) : null}
              </SettingsGroup>
              <SettingsGroup title="Creation locations">
                <SettingsRow
                  label="Daily notes"
                  description="Select the workspace directory used for date-based notes opened from the calendar."
                >
                  <CreationFolderPicker
                    label="Folder for daily notes"
                    options={directoryOptions}
                    value={dailyNoteCreationDirectory}
                    onChange={(value) => saveCreationDirectory("dailyNote", value)}
                  />
                </SettingsRow>
                <SettingsRow
                  label="New tasks"
                  description="Select the existing workspace directory used when Task Board creates a task."
                >
                  <CreationFolderPicker
                    label="Default folder for new tasks"
                    options={directoryOptions}
                    value={taskCreationDirectory}
                    onChange={(value) => saveCreationDirectory("task", value)}
                  />
                </SettingsRow>
                {creationDirectoryMessage ? (
                  <p className="settings-message settings-message-error" role="alert">
                    {creationDirectoryMessage}
                  </p>
                ) : null}
              </SettingsGroup>
              <SettingsGroup title="Recent workspaces">
                {availableRecentWorkspaces.length ? (
                  <div className="settings-workspace-list">
                    {availableRecentWorkspaces.map((workspacePath) => (
                      <div className="settings-workspace-item" key={workspacePath}>
                        <button
                          className="settings-workspace-open"
                          type="button"
                          disabled={workspaceBusyAction !== null || removingWorkspacePath !== null}
                          onClick={() => void selectRecentWorkspace(workspacePath)}
                        >
                          <span>
                            <strong>{basename(workspacePath)}</strong>
                            <small>{workspacePath}</small>
                          </span>
                          <span>Open</span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost-destructive"
                          size="icon-sm"
                          aria-label={`Remove ${basename(workspacePath)} from recent workspaces`}
                          title="Remove from recent workspaces"
                          disabled={workspaceBusyAction !== null || removingWorkspacePath !== null}
                          onClick={() => void removeRecentWorkspace(workspacePath)}
                        >
                          <IconTrash size={14} aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="settings-empty">Other workspaces will appear here after you open them.</p>
                )}
              </SettingsGroup>
              {workspaceMessage ? (
                <p className="settings-message" role="status">
                  {workspaceMessage}
                </p>
              ) : null}
            </SettingsPage>
          ) : section === "task-board" ? (
            <SettingsPage title="Task Board" description="Choose how task notes open.">
              <SettingsGroup title="Opening tasks">
                <SettingsRow
                  label="Open tasks in"
                  description="Choose where a task note opens when you click its card or press Return."
                >
                  <div
                    className="settings-choice-group"
                    role="radiogroup"
                    aria-label="Open tasks in"
                    aria-busy={savingTaskOpenMode}
                  >
                    <Choice selected={taskOpenMode === "tab"} onSelect={() => void selectTaskOpenMode("tab")}>
                      New tab
                    </Choice>
                    <Choice selected={taskOpenMode === "hover"} onSelect={() => void selectTaskOpenMode("hover")}>
                      Hover window
                    </Choice>
                  </div>
                </SettingsRow>
                {taskOpenModeError ? (
                  <p role="alert" className="settings-message settings-message-error">
                    Could not save this setting. Try again.
                  </p>
                ) : null}
              </SettingsGroup>
            </SettingsPage>
          ) : section === "appearance" ? (
            <SettingsPage title="Appearance" description="Choose how Obim looks and arranges your workspace.">
              <SettingsGroup title="Theme">
                <SettingsRow
                  label="Color theme"
                  description="System follows the operating system and updates while Obim is open."
                >
                  <div className="settings-choice-group" role="radiogroup" aria-label="Color theme">
                    <Choice selected={theme === "system"} onSelect={() => selectTheme("system")}>
                      <IconDesktop size={15} />
                      System
                    </Choice>
                    <Choice selected={theme === "light"} onSelect={() => selectTheme("light")}>
                      <IconSun size={15} />
                      Light
                    </Choice>
                    <Choice selected={theme === "dark"} onSelect={() => selectTheme("dark")}>
                      <IconMoon size={15} />
                      Dark
                    </Choice>
                  </div>
                </SettingsRow>
                {themeSaveError ? (
                  <p className="settings-message settings-message-error" role="alert">
                    The theme changed for this session but couldn't be saved.
                  </p>
                ) : null}
              </SettingsGroup>
              <SettingsGroup title="Interface scale">
                <SettingsRow label="Zoom" description="Changes the entire Obim interface and is saved on this device.">
                  <div className="settings-stepper">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Zoom out"
                      onClick={() => void updateZoom(zoomFactor - 0.1)}
                      disabled={zoomFactor <= 0.5}
                    >
                      <IconMinus size={14} />
                    </Button>
                    <output aria-live="polite">{Math.round(zoomFactor * 100)}%</output>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Zoom in"
                      onClick={() => void updateZoom(zoomFactor + 0.1)}
                      disabled={zoomFactor >= 2}
                    >
                      <IconPlus size={14} />
                    </Button>
                    <Button type="button" variant="ghost" size="xs" onClick={() => void updateZoom(1)}>
                      Reset
                    </Button>
                  </div>
                </SettingsRow>
                {zoomMessage ? (
                  <p className="settings-message settings-message-error" role="alert">
                    {zoomMessage}
                  </p>
                ) : null}
              </SettingsGroup>
              <SettingsGroup title="Window layout">
                <SettingsRow
                  label="Sidebar placement"
                  description="Explorer and widgets stay on opposite sides of the editor."
                >
                  <div className="settings-choice-group" role="radiogroup" aria-label="Sidebar placement">
                    <Choice
                      selected={sidebarPlacement === "explorer-left"}
                      onSelect={() => selectSidebarPlacement("explorer-left")}
                    >
                      <IconSidebarLeft size={15} />
                      Sidebar left
                    </Choice>
                    <Choice
                      selected={sidebarPlacement === "explorer-right"}
                      onSelect={() => selectSidebarPlacement("explorer-right")}
                    >
                      <IconSidebarLeft className="-scale-x-100" size={15} />
                      Sidebar right
                    </Choice>
                  </div>
                </SettingsRow>
                {windowControls.isMacOS ? (
                  <SettingsRow
                    label="macOS window controls"
                    description="Keep the native traffic-light controls visible in Obim's title bar."
                  >
                    <div className="settings-choice-group" role="radiogroup" aria-label="Window controls">
                      <Choice selected={windowControls.visible} onSelect={() => selectWindowControlsVisibility(true)}>
                        <IconEye size={15} />
                        Integrated
                      </Choice>
                      <Choice selected={!windowControls.visible} onSelect={() => selectWindowControlsVisibility(false)}>
                        <IconEyeSlash size={15} />
                        Hidden
                      </Choice>
                    </div>
                  </SettingsRow>
                ) : null}
                {sidebarPlacementSaveError ? (
                  <p className="settings-message settings-message-error" role="alert">
                    The sidebars moved for this session but their placement could not be saved.
                  </p>
                ) : null}
              </SettingsGroup>
              <SettingsGroup title="Panels">
                <SettingsRow
                  label="Panel layout"
                  description="Restore the Explorer and inspector to their default sizes and widget arrangement."
                >
                  <Button type="button" variant="outline" onClick={resetAppLayout}>
                    Reset layout
                  </Button>
                </SettingsRow>
              </SettingsGroup>
            </SettingsPage>
          ) : section === "keyboard" ? (
            <SettingsPage title="Keyboard shortcuts" description="Find and change the keys you use across Obim.">
              <KeyboardShortcutSettings />
              <Button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setShortcutHelpOpen(true);
                }}
              >
                Show noninvasive shortcut card
              </Button>
            </SettingsPage>
          ) : section === "backup" ? (
            <SettingsPage title="Backup & export" description="Create a separate copy of your workspace files.">
              <SettingsGroup title="Workspace backup">
                <SettingsRow
                  label="Export backup"
                  description="Saves notes and workspace files as an independent timestamped copy. Git history is not included."
                >
                  <Button
                    type="button"
                    onClick={() => void exportBackup()}
                    disabled={workspaceStatus.status !== "ready" || workspaceBusyAction !== null}
                  >
                    <IconFileExport size={14} />
                    {workspaceBusyAction === "backup" ? "Creating…" : "Create backup"}
                  </Button>
                </SettingsRow>
                {workspaceMessage ? (
                  <p className="settings-message" role="status">
                    {workspaceMessage}
                  </p>
                ) : null}
              </SettingsGroup>
            </SettingsPage>
          ) : section === "git" ? (
            <GitSettings />
          ) : (
            <SettingsPage title="About & help" description="Find the app version, documentation, and support links.">
              <SettingsGroup title="Obim">
                <SettingsRow
                  label={`Version ${appVersion}`}
                  description="Markdown WYSIWYG editor with workspace-local notes and tasks."
                >
                  <span className="settings-version-badge">Desktop</span>
                </SettingsRow>
              </SettingsGroup>
              <SettingsGroup title="Help">
                <SettingsRow label="Documentation" description="Open the project guide and current setup notes.">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void openHelpLink("https://github.com/Coderbeep/obim#readme")}
                  >
                    Open guide
                  </Button>
                </SettingsRow>
                <SettingsRow
                  label="Report a problem"
                  description="Include your operating system and the steps that reproduced the issue."
                >
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void openHelpLink("https://github.com/Coderbeep/obim/issues")}
                  >
                    Open issues
                  </Button>
                </SettingsRow>
              </SettingsGroup>
              {workspaceMessage ? (
                <p className="settings-message settings-message-error" role="alert">
                  {workspaceMessage}
                </p>
              ) : null}
            </SettingsPage>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
