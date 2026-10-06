import { IconFileText, IconFolder, IconFolders } from "@pierre/icons";
import { IconGitBranch } from "@renderer/shared/icons/IconGitBranch";
import { IconTask } from "@renderer/shared/icons/IconTask";

import { ACTION_LABELS } from "@renderer/shared/actionLabels";
import type { IconComponent } from "@renderer/shared/icons/types";
import type { FileItem } from "@shared/file-item";
import { isMarkdownFile } from "@shared/mime-types";

export const ACTION_COMMAND_PURPOSES = ["Workspace", "Files", "Notes", "Tasks", "Version history"] as const;
export type ActionCommandPurpose = (typeof ACTION_COMMAND_PURPOSES)[number];

export interface ActionCommand {
  id: string;
  label: string;
  description: string;
  icon: IconComponent;
  purpose: ActionCommandPurpose;
  keywords?: readonly string[];
  shortcut?: string;
  disabled?: boolean;
  perform: () => void | Promise<unknown>;
}

type ActionCommandContext = {
  activeFile: FileItem | null;
  isActiveFileBookmarked: boolean;
  primaryKey: string;
  shortcutLabels?: { newNote: string; searchFiles: string };
  importArticle: () => void | Promise<unknown>;
  createFolder: () => void | Promise<unknown>;
  createTask: () => void | Promise<unknown>;
  createNote: () => void | Promise<unknown>;
  duplicateFile: (file: FileItem) => void | Promise<unknown>;
  moveFileToTrash: (file: FileItem) => void | Promise<unknown>;
  openFileInNewPane: (file: FileItem) => void | Promise<unknown>;
  openSettings: () => void;
  openTaskBoard: () => void;
  openTodayDailyNote: () => void | Promise<unknown>;
  showKeyboardShortcuts: () => void;
  findFiles: () => void;
  exportNotePdf: (file: FileItem) => void;
  openVersionHistory: () => void;
  openFileHistory: (file: FileItem) => void;
  openMoveToFolder: (file: FileItem) => void;
  renameFile: (file: FileItem) => void;
  revealFile: (file: FileItem) => void | Promise<unknown>;
  stageCurrentFile: () => void | Promise<unknown>;
  syncNow: () => void | Promise<unknown>;
  discardActiveFileChanges: () => void | Promise<unknown>;
  canStageCurrentFile: boolean;
  canSyncNow: boolean;
  canDiscardActiveFileChanges: boolean;
  stageCurrentFileDescription: string;
  syncNowDescription: string;
  discardActiveFileChangesDescription: string;
  toggleBookmark: (file: FileItem, bookmarked: boolean) => void | Promise<unknown>;
};

/**
 * Built-in actions. New application commands only need to implement the
 * ActionCommand interface and join this list.
 */
export const createActionCommands = ({
  activeFile,
  isActiveFileBookmarked,
  primaryKey,
  shortcutLabels,
  createFolder,
  createNote,
  openTodayDailyNote,
  createTask,
  importArticle,
  duplicateFile,
  moveFileToTrash,
  openFileInNewPane,
  openSettings,
  openTaskBoard,
  showKeyboardShortcuts,
  findFiles,
  exportNotePdf,
  openVersionHistory,
  openFileHistory,
  openMoveToFolder,
  renameFile,
  revealFile,
  stageCurrentFile,
  syncNow,
  discardActiveFileChanges,
  canStageCurrentFile,
  canSyncNow,
  canDiscardActiveFileChanges,
  stageCurrentFileDescription,
  syncNowDescription,
  discardActiveFileChangesDescription,
  toggleBookmark,
}: ActionCommandContext): ActionCommand[] => {
  const activeDescription = activeFile ? activeFile.relativePath : "Open a file to use this action";
  const canLinkActiveNote = Boolean(
    activeFile && !activeFile.isDirectory && isMarkdownFile(activeFile.mimeType, activeFile.path),
  );
  const hasActiveFile = Boolean(activeFile && !activeFile.isDirectory);

  return [
    {
      id: "find-files",
      label: ACTION_LABELS.searchFiles,
      description: "Search file names, paths, and note contents",
      icon: IconFolders,
      purpose: "Workspace",
      keywords: ["find", "open", "quick open"],
      shortcut: shortcutLabels?.searchFiles ?? `${primaryKey} P`,
      perform: findFiles,
    },
    {
      id: "open-settings",
      label: ACTION_LABELS.openSettings,
      description: "Configure workspace and application preferences",
      icon: IconFolders,
      purpose: "Workspace",
      keywords: ["preferences", "configure", "options"],
      perform: openSettings,
    },
    {
      id: "show-keyboard-shortcuts",
      label: ACTION_LABELS.showKeyboardShortcuts,
      description: "View the keyboard shortcut reference",
      icon: IconFolders,
      purpose: "Workspace",
      keywords: ["keys", "commands", "help", "hotkeys"],
      perform: showKeyboardShortcuts,
    },
    {
      id: "new-folder",
      label: ACTION_LABELS.newFolder,
      description: "Create a folder at the workspace root",
      icon: IconFolder,
      purpose: "Files",
      keywords: ["create", "directory"],
      perform: createFolder,
    },
    {
      id: "open-in-new-pane",
      label: ACTION_LABELS.openInNewPane,
      description: activeDescription,
      icon: IconFolder,
      purpose: "Files",
      keywords: ["split", "side by side", "column"],
      disabled: !hasActiveFile,
      perform: () => {
        if (activeFile && !activeFile.isDirectory) return openFileInNewPane(activeFile);
      },
    },
    {
      id: "duplicate-file",
      label: ACTION_LABELS.duplicate,
      description: activeDescription,
      icon: IconFolder,
      purpose: "Files",
      keywords: ["copy", "make a copy", "clone"],
      disabled: !hasActiveFile,
      perform: () => {
        if (activeFile && !activeFile.isDirectory) return duplicateFile(activeFile);
      },
    },
    {
      id: "move-to-folder",
      label: ACTION_LABELS.moveToFolder,
      description: activeDescription,
      icon: IconFolder,
      purpose: "Files",
      keywords: ["organize", "directory", "relocate"],
      disabled: !hasActiveFile,
      perform: () => {
        if (activeFile && !activeFile.isDirectory) openMoveToFolder(activeFile);
      },
    },
    {
      id: "rename-file",
      label: ACTION_LABELS.rename,
      description: activeDescription,
      icon: IconFolder,
      purpose: "Files",
      keywords: ["edit", "title", "name", "active file", "current file"],
      disabled: !hasActiveFile,
      perform: () => {
        if (activeFile && !activeFile.isDirectory) renameFile(activeFile);
      },
    },
    {
      id: "toggle-bookmark",
      label: isActiveFileBookmarked ? ACTION_LABELS.removeBookmark : ACTION_LABELS.addBookmark,
      description: activeDescription,
      icon: IconFolder,
      purpose: "Files",
      keywords: ["pin", "favorite", "shortcut", "clear bookmark", "active file"],
      disabled: !hasActiveFile,
      perform: () => {
        if (activeFile && !activeFile.isDirectory) return toggleBookmark(activeFile, isActiveFileBookmarked);
      },
    },
    {
      id: "reveal-file",
      label: ACTION_LABELS.showInFileManager,
      description: activeDescription,
      icon: IconFolder,
      purpose: "Files",
      keywords: ["finder", "explorer", "reveal", "system", "active file"],
      disabled: !hasActiveFile,
      perform: () => {
        if (activeFile && !activeFile.isDirectory) return revealFile(activeFile);
      },
    },
    {
      id: "move-file-to-trash",
      label: ACTION_LABELS.moveToTrash,
      description: activeDescription,
      icon: IconFolder,
      purpose: "Files",
      keywords: ["delete", "remove", "bin", "active file"],
      disabled: !hasActiveFile,
      perform: () => {
        if (activeFile && !activeFile.isDirectory) return moveFileToTrash(activeFile);
      },
    },
    {
      id: "new-note",
      label: ACTION_LABELS.newNote,
      description: "Create a note in the workspace",
      icon: IconFileText,
      purpose: "Notes",
      keywords: ["create", "file", "document"],
      shortcut: shortcutLabels?.newNote ?? `${primaryKey} N`,
      perform: createNote,
    },
    {
      id: "open-today-daily-note",
      label: ACTION_LABELS.openTodayNote,
      description: "Open or create today's daily note",
      icon: IconFileText,
      purpose: "Notes",
      keywords: ["journal", "today", "daily", "diary"],
      perform: openTodayDailyNote,
    },
    {
      id: "export-note-pdf",
      label: ACTION_LABELS.exportNotePdf,
      description: canLinkActiveNote ? activeDescription : "Open a Markdown note to use this action",
      icon: IconFileText,
      purpose: "Notes",
      keywords: ["pdf", "print", "save", "document", "current note"],
      disabled: !canLinkActiveNote,
      perform: () => {
        if (activeFile && canLinkActiveNote) exportNotePdf(activeFile);
      },
    },
    {
      id: "create-task",
      label: ACTION_LABELS.newTask,
      description: "Create a task in the Task Board",
      icon: IconTask,
      purpose: "Tasks",
      keywords: ["task board", "kanban", "new task", "todo"],
      perform: createTask,
    },
    {
      id: "open-task-board",
      label: ACTION_LABELS.openTaskBoard,
      description: "View and organize workspace tasks",
      icon: IconTask,
      purpose: "Tasks",
      keywords: ["tasks", "kanban", "todo", "show task board"],
      perform: openTaskBoard,
    },
    {
      id: "import-article",
      label: ACTION_LABELS.importArticle,
      description: "Find and import a PDF by DOI or arXiv link",
      icon: IconFolder,
      purpose: "Files",
      keywords: ["research", "sources", "paper", "doi", "arxiv", "pdf"],
      perform: importArticle,
    },
    {
      id: "open-version-history",
      label: ACTION_LABELS.openVersionHistory,
      description: "Show workspace changes, saved versions, and remote status",
      icon: IconGitBranch,
      purpose: "Version history",
      keywords: ["git", "source control", "changes", "sidebar", "sync"],
      perform: openVersionHistory,
    },
    {
      id: "file-history",
      label: ACTION_LABELS.fileHistory,
      description: activeDescription,
      icon: IconGitBranch,
      purpose: "Version history",
      keywords: ["version", "git", "changes", "open file history", "sync"],
      disabled: !hasActiveFile,
      perform: () => {
        if (activeFile && !activeFile.isDirectory) openFileHistory(activeFile);
      },
    },
    {
      id: "stage-current-file",
      label: ACTION_LABELS.stageFile,
      description: stageCurrentFileDescription,
      icon: IconGitBranch,
      purpose: "Version history",
      keywords: ["git", "add", "prepare", "commit", "version control", "current file", "sync"],
      disabled: !canStageCurrentFile,
      perform: stageCurrentFile,
    },
    {
      id: "sync-now",
      label: ACTION_LABELS.syncNow,
      description: syncNowDescription,
      icon: IconGitBranch,
      purpose: "Version history",
      keywords: ["git", "fetch", "pull", "push", "origin", "remote", "sync now"],
      disabled: !canSyncNow,
      perform: syncNow,
    },
    {
      id: "discard-active-file-changes",
      label: ACTION_LABELS.discardFileChanges,
      description: discardActiveFileChangesDescription,
      icon: IconGitBranch,
      purpose: "Version history",
      keywords: ["git", "revert", "restore", "undo", "changes", "active file", "sync"],
      disabled: !canDiscardActiveFileChanges,
      perform: discardActiveFileChanges,
    },
  ];
};

const normalize = (value: string) => value.toLocaleLowerCase().trim();

const fuzzyScore = (query: string, value: string) => {
  const text = normalize(value);
  const contiguousIndex = text.indexOf(query);
  if (contiguousIndex >= 0) return 200 - contiguousIndex * 3 - Math.max(0, text.length - query.length);

  let queryIndex = 0;
  let score = 0;
  let previousMatch = -2;
  for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex += 1) {
    if (text[textIndex] !== query[queryIndex]) continue;
    score += textIndex === previousMatch + 1 ? 18 : 8;
    previousMatch = textIndex;
    queryIndex += 1;
  }
  return queryIndex === query.length ? score : null;
};

export const rankActionCommands = (commands: readonly ActionCommand[], query: string) => {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [...commands];
  const phrase = tokens.join(" ");

  return commands
    .map((command, index) => {
      const fields = [command.label, command.description, command.purpose, ...(command.keywords ?? [])];
      const label = normalize(command.label);
      const labelMatch = label === phrase ? 2 : label.includes(phrase) ? 1 : 0;
      let score = 0;
      for (const token of tokens) {
        const fieldScore = Math.max(...fields.map((field) => fuzzyScore(token, field) ?? Number.NEGATIVE_INFINITY));
        if (fieldScore === Number.NEGATIVE_INFINITY) return null;
        score += fieldScore;
      }
      return { command, index, labelMatch, score };
    })
    .filter((entry): entry is { command: ActionCommand; index: number; labelMatch: number; score: number } =>
      Boolean(entry),
    )
    .sort((left, right) => right.labelMatch - left.labelMatch || right.score - left.score || left.index - right.index)
    .map(({ command }) => command);
};
