import {
  TASK_NOTE_PRIORITIES,
  TASK_NOTE_STAGES,
  type TaskNotePriority,
  type TaskNoteStage,
  type TaskNoteStatus,
} from "@shared/note-type-templates";

import type { FileItem } from "@shared/file-item";

export { TASK_BOARD_CONFIG_RELATIVE_PATH } from "@shared/task-board-config";

export const TASK_PRIORITIES = TASK_NOTE_PRIORITIES;
export type TaskPriority = TaskNotePriority;

export const parseTaskPriority = (value: unknown): TaskPriority | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "urgent") return "high";
  return TASK_PRIORITIES.find((priority) => priority === normalized);
};

export interface TaskBoardProject {
  name: string;
  colorId: string;
  hidden?: boolean;
}

export const TASK_BOARD_STAGES = TASK_NOTE_STAGES;
export type TaskBoardStage = TaskNoteStage;
export type TaskBoardWorkflowColumn = TaskBoardStage | "done";

export const TASK_BOARD_WORKFLOW_COLUMNS: ReadonlyArray<{
  id: TaskBoardWorkflowColumn;
  label: string;
  color: string;
}> = [
  { id: "backlog", label: "Backlog", color: "var(--task-stage-backlog)" },
  { id: "doing", label: "Doing", color: "var(--task-stage-doing)" },
  { id: "review", label: "Review", color: "var(--task-stage-review)" },
  { id: "done", label: "Done", color: "var(--task-stage-done)" },
];

export const parseTaskBoardStage = (value: unknown): TaskBoardStage | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLocaleLowerCase();
  return TASK_BOARD_STAGES.find((stage) => stage === normalized);
};

export interface TaskBoardConfig {
  projects: TaskBoardProject[];
  taskOrder: string[];
  pinnedTasks?: string[];
}

export const DEFAULT_TASK_BOARD_PROJECT_COLOR = "teal";

export const TASK_BOARD_PROJECT_COLOR_OPTIONS = [
  { id: "rose", label: "Red", accent: "var(--task-project-red)" },
  { id: "amber", label: "Orange", accent: "var(--task-project-orange)" },
  { id: "slate", label: "Green", accent: "var(--task-project-green)" },
  { id: "teal", label: "Cyan", accent: "var(--task-project-cyan)" },
  { id: "blue", label: "Blue", accent: "var(--task-project-blue)" },
  { id: "violet", label: "Purple", accent: "var(--task-project-purple)" },
] as const;

export type TaskBoardProjectColorId = (typeof TASK_BOARD_PROJECT_COLOR_OPTIONS)[number]["id"];

export const normalizeTaskBoardProjectName = (value: string) => value.trim().replace(/\s+/g, " ");
export const taskBoardProjectNameKey = (value: string) => normalizeTaskBoardProjectName(value).toLocaleLowerCase();
const isProjectColorId = (value: string): value is TaskBoardProjectColorId =>
  TASK_BOARD_PROJECT_COLOR_OPTIONS.some((option) => option.id === value);

const validTaskOrderPath = (value: unknown): value is string => {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  return value.split("/").every((part) => part && part !== "." && part !== "..");
};

export const sanitizeTaskOrder = (value: readonly unknown[]) => {
  const seen = new Set<string>();
  return value.filter((entry): entry is string => {
    if (!validTaskOrderPath(entry) || seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });
};

export const parseTaskBoardConfigSource = (
  source: string,
): { status: "invalid" } | { status: "valid"; config: TaskBoardConfig } => {
  try {
    const value: unknown = JSON.parse(source);
    if (!value || typeof value !== "object") return { status: "invalid" };
    const {
      projects: rawProjects,
      taskOrder: rawTaskOrder,
      pinnedTasks: rawPinnedTasks,
    } = value as {
      projects?: unknown;
      taskOrder?: unknown;
      pinnedTasks?: unknown;
    };
    if (!Array.isArray(rawProjects) || (rawTaskOrder !== undefined && !Array.isArray(rawTaskOrder))) {
      return { status: "invalid" };
    }

    const projects: TaskBoardProject[] = [];
    const names = new Set<string>();
    for (const entry of rawProjects) {
      if (!entry || typeof entry !== "object") continue;
      const {
        name: rawName,
        colorId: rawColorId,
        hidden,
      } = entry as {
        colorId?: unknown;
        hidden?: unknown;
        name?: unknown;
      };
      if (typeof rawName !== "string" || typeof rawColorId !== "string") continue;
      const name = normalizeTaskBoardProjectName(rawName);
      const colorId = rawColorId.trim();
      const nameKey = taskBoardProjectNameKey(name);
      if (!name || names.has(nameKey) || !isProjectColorId(colorId)) continue;
      names.add(nameKey);
      projects.push({ name, colorId, ...(hidden === true ? { hidden: true } : {}) });
    }
    return {
      status: "valid",
      config: {
        projects,
        taskOrder: Array.isArray(rawTaskOrder) ? sanitizeTaskOrder(rawTaskOrder) : [],
        ...(Array.isArray(rawPinnedTasks) ? { pinnedTasks: sanitizeTaskOrder(rawPinnedTasks) } : {}),
      },
    };
  } catch {
    return { status: "invalid" };
  }
};

export const remapTaskOrderPaths = (taskOrder: readonly string[], from: string, to: string, directory = false) =>
  sanitizeTaskOrder(
    taskOrder.map((path) =>
      path === from || (directory && path.startsWith(`${from}/`)) ? `${to}${path.slice(from.length)}` : path,
    ),
  );

export const pruneTaskOrderPaths = (taskOrder: readonly string[], existingTaskPaths: ReadonlySet<string>) =>
  sanitizeTaskOrder(taskOrder).filter((path) => existingTaskPaths.has(path));

export const removeTaskOrderPaths = (taskOrder: readonly string[], removedPath: string, directory = false) =>
  sanitizeTaskOrder(taskOrder).filter(
    (path) => path !== removedPath && !(directory && path.startsWith(`${removedPath}/`)),
  );

export type TaskBoardTaskSummary = Extract<FileItem, { isDirectory: false }> & {
  metadataIssues: string[];
  tags?: string[];
  pinned?: boolean;
  dueDate?: string;
  priority?: TaskPriority;
  project?: string;
  stage?: TaskBoardStage;
  status: TaskNoteStatus;
  title: string;
};

export interface TaskMetadataSnapshot {
  taskName: string;
  dueDate?: string;
  priority?: TaskPriority;
  project?: string;
  stage?: TaskBoardStage;
  tags?: readonly string[];
}

export interface DraftTaskState {
  original?: TaskMetadataSnapshot;
  taskName: string;
  initialBody: string;
  dueDate: string;
  priority?: TaskPriority;
  project?: string;
  stage?: TaskBoardWorkflowColumn;
  tags: string[];
}
