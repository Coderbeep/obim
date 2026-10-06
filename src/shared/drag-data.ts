export const FILE_DRAG_DATA_MIME = "application/obim-note-file";
export const TAB_DRAG_DATA_MIME = "application/obim-note-tab";
export const TASK_BOARD_TASK_DRAG_DATA_MIME = "application/obim-task-board-task";
export const TASK_BOARD_PROJECT_DRAG_DATA_MIME = "application/x-obim-board-project";
export const WIDGET_TAB_DRAG_DATA_MIME = "application/obim-widget-tab";

/** Identifies the semantic object in an application drag. */
export type AppDragEntity =
  | { kind: "task"; id: string }
  | { kind: "task-project"; id: string }
  | { kind: "explorer-item"; id: string }
  | { kind: "workspace-tab"; id: string; sourcePaneId: string }
  | { kind: "widget-tab"; id: string; sourcePaneId: string }
  | { kind: "external-files"; id: "external-files" };

/** Stable native payload for a Task Board drag. */
export interface TaskBoardTaskDragData {
  path: string;
}

/** Stable native payload for a workspace tab drag. */
export interface TabDragData {
  sourcePaneId: string;
  tabId: string;
}

/** Stable native payload for an Explorer file drag. */
export interface FileDragData {
  filename: string;
  mimeType: string;
  path: string;
  relativePath: string;
}
