/**
 * Canonical user-facing names for commands that appear in more than one menu.
 * Keep labels sentence-cased, verb-first, and free of context words such as
 * "active" or "current" when the surrounding UI already names the target.
 */
export const ACTION_LABELS = {
  addBookmark: "Add bookmark",
  discardFileChanges: "Discard file changes",
  duplicate: "Duplicate",
  exportNotePdf: "Export as PDF",
  fileHistory: "File history",
  importArticle: "Import article",
  moveToFolder: "Move to folder",
  moveToTrash: "Move to Trash",
  newFolder: "New folder",
  newNote: "New note",
  newTask: "New task",
  openInNewPane: "Open in new pane",
  openSettings: "Open settings",
  openTaskBoard: "Open Task Board",
  openTodayNote: "Open today's note",
  openVersionHistory: "Open version history",
  removeBookmark: "Remove bookmark",
  rename: "Rename",
  searchFiles: "Search files",
  showInFileManager: "Show in file manager",
  showKeyboardShortcuts: "Show keyboard shortcuts",
  stageFile: "Stage file",
  syncNow: "Sync now",
} as const;

export const moveItemsToFolderLabel = (count: number) =>
  count === 1 ? ACTION_LABELS.moveToFolder : `Move ${count} items to folder`;

export const moveItemsToTrashLabel = (count: number) =>
  count === 1 ? ACTION_LABELS.moveToTrash : `Move ${count} items to Trash`;

export const addBookmarksLabel = (count: number) => `Add bookmarks (${count})`;

export const removeBookmarksLabel = (count: number) => `Remove bookmarks (${count})`;
