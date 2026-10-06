import type { TaskNoteSubtask, TaskNoteSubtaskTarget } from "@renderer/shared/taskNoteSubtasks";
import {
  DEFAULT_TASK_BOARD_PROJECT_COLOR,
  TASK_BOARD_PROJECT_COLOR_OPTIONS,
  taskBoardProjectNameKey,
  TASK_BOARD_WORKFLOW_COLUMNS,
  normalizeTaskBoardProjectName,
  type TaskMetadataSnapshot,
  type TaskPriority,
  type TaskBoardStage,
  type TaskBoardWorkflowColumn,
  type DraftTaskState,
  type TaskBoardProject,
} from "@renderer/shared/taskBoard";
import type { FileItem } from "@shared/file-item";
import type { TaskNoteStatus } from "@shared/note-type-templates";
import { normalizeTag, normalizeTags, tagKey } from "@renderer/shared/tags";
import type {
  WorkspaceSessionTaskDueFilter,
  WorkspaceSessionTaskPriorityChoice,
  WorkspaceSessionTaskBoardPreferences,
  WorkspaceSessionTaskSavedFilter,
} from "@shared/workspace-session";
import { formatDueDateRange, toDateInputValue } from "@renderer/shared/date";

export type { DraftTaskState } from "@renderer/shared/taskBoard";

export type TaskLifecycleStatus = TaskNoteStatus;

export const getTaskNameValidationMessage = (value: string) => {
  const taskName = value.trim();
  if (!taskName) return "Enter a task name.";
  if (Array.from(taskName).some((character) => character.charCodeAt(0) < 32))
    return "Use a single line for the task name.";
  return null;
};

export type TaskBoardTask = Extract<
  FileItem,
  {
    isDirectory: false;
  }
> & {
  title: string;
  preview?: string;
  subtasks?: TaskNoteSubtask[];
  status: TaskLifecycleStatus;
  createdDate?: string;
  closedDate?: string;
  modifiedAtMs?: number;
  metadataIssues: string[];
  dueDate?: string;
  priority?: TaskPriority;
  pinned?: boolean;
  project?: string;
  stage?: TaskBoardStage;
  tags?: string[];
  frontmatterKeys?: string[];
};

export interface TaskBoardColumn {
  name: string;
  accent: string;
  stage: TaskBoardStage | "done";
  tasks: TaskBoardTask[];
}

export type TaskMoveIntent = {
  kind: "board";
  /** Change membership without writing the manual order. */
  projectOnly?: boolean;
  /** A visible insertion anchor avoids counting filtered/completed slots as active tasks. */
  beforePath?: string | null;
  project?: string;
  stage?: TaskBoardStage | "done";
  index: number;
};

export type TaskBoardSort = "custom" | "due" | "created" | "modified" | "title" | "tag" | "priority";

export type TaskBoardSortDirection = "ascending" | "descending";

export interface TaskBoardSortRule {
  field: Exclude<TaskBoardSort, "custom">;
  direction: TaskBoardSortDirection;
}

export interface CreateTaskInput {
  original?: TaskMetadataSnapshot;
  taskName: string;
  initialBody?: string;
  dueDate?: string;
  priority?: TaskPriority;
  project?: string;
  stage?: TaskBoardWorkflowColumn;
  tags?: readonly string[];
}

export interface UpdateTaskMetadataInput {
  original?: TaskMetadataSnapshot;
  taskName?: string;
  dueDate?: string;
  priority?: TaskPriority;
  project?: string;
  stage?: TaskBoardStage;
  tags?: readonly string[];
}

export interface TaskActions {
  createTask: (input: CreateTaskInput, intent?: TaskMoveIntent) => Promise<boolean>;
  updateTask: (task: TaskBoardTask, input: UpdateTaskMetadataInput) => Promise<boolean>;
  completeTask: (task: TaskBoardTask) => Promise<boolean>;
  cancelTask: (task: TaskBoardTask) => Promise<boolean>;
  reopenTask: (task: TaskBoardTask) => Promise<boolean>;
  deleteTask: (task: TaskBoardTask) => Promise<boolean>;
  pinTask: (task: TaskBoardTask, pinned: boolean) => Promise<boolean>;
  moveTask: (task: TaskBoardTask, intent: TaskMoveIntent) => Promise<boolean>;
  repairMetadata: (task: TaskBoardTask) => Promise<boolean>;
  updateSubtasks: (task: TaskBoardTask, change: TaskNoteSubtaskChange) => Promise<boolean>;
  openTask: (task: TaskBoardTask, target?: TaskNoteSubtaskTarget) => void | Promise<void>;
  loadTags: (currentTags?: readonly string[]) => Promise<string[]>;
}

export type TaskNoteSubtaskChange =
  | { kind: "append"; text: string }
  | { kind: "check"; index: number; checked: boolean; expected: readonly TaskNoteSubtask[] };

export type TaskMutationResult = { success: boolean; error?: string };

export type TaskFileMutation = (
  task: TaskBoardTask,
  transform: (source: string) => string,
  options?: { refreshAfter?: boolean },
) => Promise<TaskMutationResult>;

export const TASK_PRIORITY_PRESENTATION: Record<
  TaskPriority,
  {
    className: string;
    label: string;
  }
> = {
  high: { className: "[color:var(--task-priority-high)]", label: "High" },
  medium: { className: "[color:var(--status-info)]", label: "Medium" },
  low: { className: "text-muted-foreground", label: "Low" },
};

export const normalizeTaskTag = normalizeTag;

export const taskTagKey = tagKey;

export const normalizeTaskTags = normalizeTags;

export const getTaskBoardProjectColorTheme = (colorId?: string) =>
  TASK_BOARD_PROJECT_COLOR_OPTIONS.find((option) => option.id === colorId) ??
  TASK_BOARD_PROJECT_COLOR_OPTIONS.find((option) => option.id === DEFAULT_TASK_BOARD_PROJECT_COLOR)!;

export const TASK_BOARD_DETAILS_PREVIEW_LIMIT = 180;

export const taskBoardDetailsPreview = (preview: string) => {
  const characters = Array.from(preview);
  if (characters.length <= TASK_BOARD_DETAILS_PREVIEW_LIMIT) return preview;
  return `${characters
    .slice(0, TASK_BOARD_DETAILS_PREVIEW_LIMIT - 1)
    .join("")
    .trimEnd()}…`;
};

export const createDraftTaskState = (
  defaultProject?: string,
  stage: TaskBoardWorkflowColumn = "backlog",
): DraftTaskState => ({
  taskName: "",
  initialBody: "",
  dueDate: "",
  tags: [],
  ...(defaultProject ? { project: defaultProject } : {}),
  stage,
});

export const FILTER_PROPERTIES = [
  { key: "priority", label: "Priority" },
  { key: "due", label: "Due date" },
  { key: "tag", label: "Tag" },
  { key: "yaml", label: "YAML property" },
] as const;

export const DUE_OPTIONS: ReadonlyArray<{ label: string; value: WorkspaceSessionTaskDueFilter }> = [
  { label: "Today", value: "today" },
  { label: "Next 7 days", value: "week" },
  { label: "Overdue", value: "overdue" },
  { label: "No date", value: "no-date" },
];

export const PRIORITY_OPTIONS: ReadonlyArray<{
  flagClassName?: string;
  label: string;
  value: WorkspaceSessionTaskPriorityChoice;
}> = [
  { flagClassName: "[color:var(--task-priority-high)]", label: "High", value: "high" },
  { flagClassName: "[color:var(--status-info)]", label: "Medium", value: "medium" },
  { flagClassName: "text-muted-foreground", label: "Low", value: "low" },
  { flagClassName: "text-muted-foreground opacity-50", label: "None", value: "none" },
];

/** Runtime filters exclude legacy lifecycle preferences: columns own lifecycle visibility. */
type PersistedTaskFilters = Pick<
  WorkspaceSessionTaskBoardPreferences,
  | "dueDateEndFilter"
  | "dueDateFilter"
  | "dueFilter"
  | "priorityFilters"
  | "searchQuery"
  | "tagFilters"
  | "yamlPropertyFilter"
>;

export type TaskFilters = Omit<PersistedTaskFilters, "priorityFilters" | "tagFilters"> & {
  priorityFilters: Readonly<PersistedTaskFilters["priorityFilters"]>;
  tagFilters: readonly string[];
};

export type FilterPatch = Partial<PersistedTaskFilters>;

export type FilterProperty = (typeof FILTER_PROPERTIES)[number]["key"];

export type FilterOperator = "is" | "is empty" | "has" | "does not have";

export type FilterRow = {
  id: FilterProperty | "draft";
  property: FilterProperty;
  operator: FilterOperator;
  value: string;
  pending: boolean;
};

export type ActiveFilterRow = FilterRow & {
  summary: string;
  chipLabel?: string;
  removeLabel: string;
};

export const selectTaskFilters = (source: TaskFilters): PersistedTaskFilters => ({
  dueDateEndFilter: source.dueDateEndFilter,
  dueDateFilter: source.dueDateFilter,
  dueFilter: source.dueFilter,
  priorityFilters: [...source.priorityFilters],
  searchQuery: source.searchQuery,
  tagFilters: [...source.tagFilters],
  yamlPropertyFilter: source.yamlPropertyFilter,
});

export const emptyTaskFilters = (): PersistedTaskFilters => ({
  dueDateEndFilter: "",
  dueDateFilter: "",
  dueFilter: "all",
  priorityFilters: [],
  searchQuery: "",
  tagFilters: [],
  yamlPropertyFilter: undefined,
});

export const clearFilterProperty = (property: FilterProperty): FilterPatch => {
  if (property === "priority") return { priorityFilters: [] };
  if (property === "due") return { dueFilter: "all" };
  if (property === "tag") return { tagFilters: [] };
  return { yamlPropertyFilter: undefined };
};

export const filterPropertyLabel = (property: FilterProperty) =>
  FILTER_PROPERTIES.find(({ key }) => key === property)?.label ?? property;

export const activeTaskFilterRows = (filters: TaskFilters): ActiveFilterRow[] => {
  const rows: ActiveFilterRow[] = [];
  if (filters.priorityFilters.length) {
    const value = filters.priorityFilters
      .map((choice) => PRIORITY_OPTIONS.find((option) => option.value === choice)?.label ?? choice)
      .join(", ");
    rows.push({
      id: "priority",
      property: "priority",
      operator: "is",
      value,
      pending: false,
      summary: filters.priorityFilters.join(", "),
      chipLabel:
        filters.priorityFilters.length === 1
          ? filters.priorityFilters[0] === "none"
            ? "No priority"
            : `${value} priority`
          : `${filters.priorityFilters.length} priorities`,
      removeLabel: "Remove priority filters",
    });
  }
  if (filters.dueFilter !== "all") {
    const value =
      filters.dueFilter === "range"
        ? formatDueDateRange(filters.dueDateFilter, filters.dueDateEndFilter)
        : (DUE_OPTIONS.find((option) => option.value === filters.dueFilter)?.label ?? filters.dueFilter);
    rows.push({
      id: "due",
      property: "due",
      operator: filters.dueFilter === "no-date" ? "is empty" : "is",
      value,
      pending: false,
      summary: value,
      chipLabel: filters.dueFilter === "today" ? "Due today" : filters.dueFilter === "no-date" ? "No due date" : value,
      removeLabel: "Remove due date filter",
    });
  }
  if (filters.tagFilters.length) {
    const value = filters.tagFilters.map((tag) => (tag === "__untagged__" ? "No tags" : tag)).join(", ");
    rows.push({
      id: "tag",
      property: "tag",
      operator: filters.tagFilters.length === 1 && filters.tagFilters[0] === "__untagged__" ? "is empty" : "has",
      value,
      pending: false,
      summary: value,
      chipLabel:
        filters.tagFilters.length === 1
          ? filters.tagFilters[0] === "__untagged__"
            ? "No tags"
            : `Tag: ${value}`
          : `${filters.tagFilters.length} tag filters`,
      removeLabel: "Remove tag filters",
    });
  }
  if (filters.yamlPropertyFilter) {
    const { key, operator } = filters.yamlPropertyFilter;
    rows.push({
      id: "yaml",
      property: "yaml",
      operator,
      value: key,
      pending: false,
      summary: `YAML ${operator} ${key}`,
      removeLabel: "Remove YAML property filter",
    });
  }
  return rows;
};

export const savedFilterSummary = (filter: TaskFilters) => {
  const parts = activeTaskFilterRows(filter).map(({ summary }) => summary);
  if (filter.searchQuery.trim()) parts.push(`Search: “${filter.searchQuery.trim()}”`);
  return parts.join(" · ");
};

export const saveTaskFilter = (
  current: WorkspaceSessionTaskBoardPreferences,
  id: string,
  name: string,
): WorkspaceSessionTaskBoardPreferences => {
  const saved: WorkspaceSessionTaskSavedFilter = {
    ...selectTaskFilters(current),
    id,
    name,
    lifecycleView: current.lifecycleView,
  };
  return { ...current, activeSavedFilterId: id, savedFilters: [...current.savedFilters.slice(-49), saved] };
};

export const applyTaskFilter = (
  current: WorkspaceSessionTaskBoardPreferences,
  saved: WorkspaceSessionTaskSavedFilter,
): WorkspaceSessionTaskBoardPreferences => ({
  ...current,
  ...selectTaskFilters(saved),
  activeSavedFilterId: saved.id,
  // Retain the backward-readable session field without using it in the runtime view.
  lifecycleView: saved.lifecycleView,
});

export const taskOrderPath = (task: Pick<TaskBoardTask, "relativePath">) => task.relativePath.replaceAll("\\", "/");

/** Unlisted files stay visible first, followed by manifest entries in manifest order. */
export const applyTaskOrder = (tasks: readonly TaskBoardTask[], taskOrder: readonly string[]) => {
  if (!taskOrder.length) return [...tasks];
  const order = new Map(taskOrder.map((path, index) => [path, index]));
  return tasks
    .map((task, discoveryIndex) => ({ task, discoveryIndex, order: order.get(taskOrderPath(task)) }))
    .sort((left, right) => {
      if (left.order === undefined && right.order === undefined) return left.discoveryIndex - right.discoveryIndex;
      if (left.order === undefined) return -1;
      if (right.order === undefined) return 1;
      return left.order - right.order;
    })
    .map(({ task }) => task);
};

export const taskOrderFromTasks = (tasks: readonly TaskBoardTask[]) => tasks.map(taskOrderPath);

/** Replaces active slots while retaining closed task paths in place. */
export const replaceTaskOrderSlots = (
  fullOrder: readonly string[],
  visiblePaths: ReadonlySet<string>,
  reorderedVisiblePaths: readonly string[],
) => {
  let visibleIndex = 0;
  return fullOrder.map((path) => (visiblePaths.has(path) ? (reorderedVisiblePaths[visibleIndex++] ?? path) : path));
};

const taskBelongsToColumn = (task: TaskBoardTask, project?: string, stage?: TaskBoardStage | "done") =>
  taskBoardProjectNameKey(task.project ?? "") === taskBoardProjectNameKey(project ?? "") &&
  (stage === undefined ||
    (stage === "done" ? task.status === "done" : task.status === "open" && (task.stage ?? "backlog") === stage));

/** Converts a final position within a board column to an index in the canonical sequence. */
export const boardColumnIndexToGlobalIndex = (
  tasksWithoutMovedTask: readonly TaskBoardTask[],
  project: string | undefined,
  columnIndex: number,
  stage?: TaskBoardStage | "done",
) => {
  const destinationIndices = tasksWithoutMovedTask.flatMap((task, index) =>
    taskBelongsToColumn(task, project, stage) ? [index] : [],
  );
  if (!destinationIndices.length) return 0;
  if (columnIndex <= 0) return destinationIndices[0];
  if (columnIndex >= destinationIndices.length) return destinationIndices.at(-1)! + 1;
  return destinationIndices[columnIndex];
};

/** Resolve the visible anchor against canonical order, including concurrent membership changes. */
export const taskMoveColumnIndex = (tasks: readonly TaskBoardTask[], task: TaskBoardTask, intent: TaskMoveIntent) => {
  if (intent.beforePath === undefined) return intent.index;
  const remaining = tasks.filter(
    (entry) => entry.path !== task.path && taskBelongsToColumn(entry, intent.project, intent.stage),
  );
  const anchor = intent.beforePath ? tasks.findIndex(({ path }) => path === intent.beforePath) : -1;
  const next =
    anchor >= 0 ? tasks.slice(anchor).find((entry) => remaining.some(({ path }) => path === entry.path)) : undefined;
  return next ? remaining.findIndex(({ path }) => path === next.path) : remaining.length;
};

export const moveTaskInSequence = (
  tasks: readonly TaskBoardTask[],
  task: TaskBoardTask,
  intent: TaskMoveIntent,
  anchorTasks: readonly TaskBoardTask[] = tasks,
) => {
  const without = tasks.filter((entry) => entry.path !== task.path);
  const index = boardColumnIndexToGlobalIndex(
    without,
    intent.project,
    taskMoveColumnIndex(anchorTasks, task, intent),
    intent.stage,
  );
  without.splice(index, 0, {
    ...task,
    project: intent.project,
    ...(intent.stage && intent.stage !== "done" ? { stage: intent.stage } : {}),
    ...(intent.stage === "done" ? { status: "done" as const } : intent.stage ? { status: "open" as const } : {}),
  });
  return without;
};

export const deriveTaskBoardProjects = (
  tasks: readonly TaskBoardTask[],
  configuredProjects: readonly TaskBoardProject[],
): TaskBoardProject[] => {
  const projects: TaskBoardProject[] = [];
  const projectByName = new Map<string, TaskBoardProject>();
  configuredProjects.forEach((project) => {
    const name = normalizeTaskBoardProjectName(project.name);
    const key = taskBoardProjectNameKey(name);
    if (!name || projectByName.has(key)) return;
    const normalized = { name, colorId: project.colorId, ...(project.hidden ? { hidden: true } : {}) };
    projectByName.set(key, normalized);
    projects.push(normalized);
  });
  const fileOnlyProjects = new Map<string, string>();
  tasks.forEach((task) => {
    const name = normalizeTaskBoardProjectName(task.project ?? "");
    const key = taskBoardProjectNameKey(name);
    if (name && !projectByName.has(key) && !fileOnlyProjects.has(key)) fileOnlyProjects.set(key, name);
  });
  [...fileOnlyProjects.values()]
    .sort(
      (left, right) =>
        left.localeCompare(right, "en", { sensitivity: "base" }) ||
        left.localeCompare(right, "en", { sensitivity: "variant" }),
    )
    .forEach((name) => {
      const project = { name, colorId: DEFAULT_TASK_BOARD_PROJECT_COLOR };
      projectByName.set(taskBoardProjectNameKey(name), project);
      projects.push(project);
    });
  return projects;
};

export const deriveTaskBoardWorkflowColumns = (tasks: readonly TaskBoardTask[], project: string): TaskBoardColumn[] => {
  const projectKey = taskBoardProjectNameKey(project);
  const columns = TASK_BOARD_WORKFLOW_COLUMNS.map(({ id, label, color }) => ({
    name: label,
    accent: color,
    stage: id,
    tasks: [] as TaskBoardTask[],
  }));
  const byStage = new Map(columns.map((column) => [column.stage, column]));
  tasks.forEach((task) => {
    if (task.status === "cancelled" || taskBoardProjectNameKey(task.project ?? "") !== projectKey) return;
    byStage.get(task.status === "done" ? "done" : (task.stage ?? "backlog"))?.tasks.push(task);
  });
  return columns;
};

const compareText = (left: string, right: string) =>
  left.localeCompare(right, "en", { sensitivity: "base" }) ||
  left.localeCompare(right, "en", { sensitivity: "variant" });

const priorityRank = (priority?: TaskPriority) =>
  priority === "high" ? 0 : priority === "medium" ? 1 : priority === "low" ? 2 : undefined;

const optionalComparison = <Value>(
  left: Value | undefined,
  right: Value | undefined,
  direction: TaskBoardSortDirection,
  compare: (left: Value, right: Value) => number,
) => {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  const result = compare(left, right);
  return direction === "ascending" ? result : -result;
};

export const sortTaskBoardTasks = (tasks: readonly TaskBoardTask[], rules: readonly TaskBoardSortRule[]) => {
  return tasks
    .map((task, index) => ({ index, task }))
    .sort((left, right) => {
      const pinOrder = Number(Boolean(right.task.pinned)) - Number(Boolean(left.task.pinned));
      if (pinOrder) return pinOrder;
      const lifecycleOrder = Number(left.task.status !== "open") - Number(right.task.status !== "open");
      if (lifecycleOrder) return lifecycleOrder;
      for (const rule of rules) {
        const compared =
          rule.field === "due"
            ? optionalComparison(left.task.dueDate, right.task.dueDate, rule.direction, compareText)
            : rule.field === "created"
              ? optionalComparison(left.task.createdDate, right.task.createdDate, rule.direction, compareText)
              : rule.field === "modified"
                ? optionalComparison(left.task.modifiedAtMs, right.task.modifiedAtMs, rule.direction, (a, b) => a - b)
                : rule.field === "title"
                  ? optionalComparison(left.task.title, right.task.title, rule.direction, compareText)
                  : rule.field === "tag"
                    ? optionalComparison(left.task.tags?.[0], right.task.tags?.[0], rule.direction, compareText)
                    : optionalComparison(
                        priorityRank(left.task.priority),
                        priorityRank(right.task.priority),
                        rule.direction,
                        (a, b) => a - b,
                      );
        if (compared) return compared;
      }
      return left.index - right.index;
    })
    .map(({ task }) => task);
};

/** Applies the Board's text and metadata filters without changing canonical task order. */
export const filterTaskBoardTasks = (tasks: readonly TaskBoardTask[], filters: TaskFilters, today = new Date()) => {
  const query = filters.searchQuery.trim().toLocaleLowerCase();
  const todayValue = toDateInputValue(today);
  const week = new Date(today);
  week.setDate(week.getDate() + 7);
  const weekValue = toDateInputValue(week);

  return tasks.filter((task) => {
    const searchable = [
      task.title,
      task.preview,
      task.project,
      ...(task.tags ?? []),
      ...(task.subtasks ?? []).map(({ text }) => text),
    ]
      .filter(Boolean)
      .join("\n")
      .toLocaleLowerCase();
    if (query && !searchable.includes(query)) return false;
    const taskPriority = task.priority ?? "none";
    if (filters.priorityFilters.length && !filters.priorityFilters.includes(taskPriority)) return false;
    if (filters.tagFilters.length) {
      const untaggedMatches = filters.tagFilters.includes("__untagged__") && !task.tags?.length;
      const selectedTagKeys = new Set(filters.tagFilters.map(taskTagKey));
      const selectedTagMatches = (task.tags ?? []).some((tag) => selectedTagKeys.has(taskTagKey(tag)));
      if (!untaggedMatches && !selectedTagMatches) return false;
    }
    if (filters.yamlPropertyFilter) {
      const hasProperty = task.frontmatterKeys?.includes(filters.yamlPropertyFilter.key) ?? false;
      if (hasProperty !== (filters.yamlPropertyFilter.operator === "has")) return false;
    }
    if (filters.dueFilter === "no-date" && task.dueDate) return false;
    if (filters.dueFilter === "overdue" && (!task.dueDate || task.dueDate >= todayValue)) return false;
    if (filters.dueFilter === "today" && task.dueDate !== todayValue) return false;
    if (filters.dueFilter === "week" && (!task.dueDate || task.dueDate < todayValue || task.dueDate > weekValue))
      return false;
    if (
      filters.dueFilter === "range" &&
      (!task.dueDate ||
        task.dueDate < filters.dueDateFilter ||
        task.dueDate > (filters.dueDateEndFilter || filters.dueDateFilter))
    )
      return false;
    return true;
  });
};
