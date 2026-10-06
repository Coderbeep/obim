export const WORKSPACE_SESSION_VERSION = 1 as const;
export const MAX_WORKSPACE_SESSION_FILE_ACCESSES = 2_000;
export const MAX_WORKSPACE_SESSION_RECENT_FILES = 100;

export interface WorkspaceSessionExplorerSections {
  bookmarks: boolean;
  files: boolean;
  recent: boolean;
}

export interface WorkspaceSessionExplorerSectionSizes {
  bookmarks: number;
  files: number;
  recent: number;
}
export type WorkspaceSessionTaskLifecycleView = "active" | "closed" | "all" | "none";
export type WorkspaceSessionTaskSort = "custom" | "due" | "created" | "modified" | "title" | "tag" | "priority";
export type WorkspaceSessionSortDirection = "ascending" | "descending";
export interface WorkspaceSessionTaskSortRule {
  field: Exclude<WorkspaceSessionTaskSort, "custom">;
  direction: WorkspaceSessionSortDirection;
}
export type WorkspaceSessionTaskDueFilter = "all" | "overdue" | "today" | "week" | "no-date" | "range";
export type WorkspaceSessionTaskPriorityFilter = "all" | "high" | "medium" | "low" | "none";
export type WorkspaceSessionTaskPriorityChoice = Exclude<WorkspaceSessionTaskPriorityFilter, "all">;
export interface WorkspaceSessionTaskYamlPropertyFilter {
  key: string;
  operator: "has" | "does not have";
}
export interface WorkspaceSessionTaskSavedFilter {
  dueDateEndFilter: string;
  dueDateFilter: string;
  dueFilter: WorkspaceSessionTaskDueFilter;
  id: string;
  lifecycleView: WorkspaceSessionTaskLifecycleView;
  name: string;
  priorityFilters: WorkspaceSessionTaskPriorityChoice[];
  searchQuery: string;
  tagFilters: string[];
  yamlPropertyFilter?: WorkspaceSessionTaskYamlPropertyFilter;
}

export interface WorkspaceSessionPane {
  activeTabId: string | null;
  id: string;
  size: number;
  tabs: string[];
}

export interface WorkspaceSessionTab {
  backStack: string[];
  currentResourceKey: string;
  forwardStack: string[];
  id: string;
}

export interface WorkspaceSessionTaskBoardPreferences {
  selectedProject: string;
  activeSavedFilterId: string | null;
  collapsedSubtaskPaths: string[];
  dueDateEndFilter: string;
  dueDateFilter: string;
  dueFilter: WorkspaceSessionTaskDueFilter;
  lifecycleView: WorkspaceSessionTaskLifecycleView;
  priorityFilters: WorkspaceSessionTaskPriorityChoice[];
  savedFilters: WorkspaceSessionTaskSavedFilter[];
  searchQuery: string;
  sortRules: WorkspaceSessionTaskSortRule[];
  tagFilters: string[];
  yamlPropertyFilter?: WorkspaceSessionTaskYamlPropertyFilter;
}

export interface WorkspaceSession {
  activePaneId: string;
  expandedDirectories: string[];
  explorerSectionSizes: WorkspaceSessionExplorerSectionSizes;
  explorerSections: WorkspaceSessionExplorerSections;
  fileAccesses: Record<string, number>;
  panes: WorkspaceSessionPane[];
  recentFilePaths: string[];
  tabs: WorkspaceSessionTab[];
  taskBoard: WorkspaceSessionTaskBoardPreferences;
  version: typeof WORKSPACE_SESSION_VERSION;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isBoundedString = (value: unknown, max = 8192): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const isStringArray = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((item) => isBoundedString(item));
export const MAX_TASK_BOARD_COLLAPSED_SUBTASK_PATHS = 500;
const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === "string" && options.includes(value as T);
const parseFileAccesses = (value: unknown) => {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > MAX_WORKSPACE_SESSION_FILE_ACCESSES) return null;
  const entries = Object.entries(value);
  if (
    entries.some(
      ([path, accessedAt]) =>
        !isBoundedString(path) || typeof accessedAt !== "number" || !Number.isFinite(accessedAt) || accessedAt <= 0,
    )
  )
    return null;
  return Object.fromEntries(entries) as Record<string, number>;
};
const isExplorerSectionSizes = (value: unknown): value is WorkspaceSessionExplorerSectionSizes =>
  isRecord(value) &&
  [value.bookmarks, value.files, value.recent].every(
    (size) => typeof size === "number" && Number.isFinite(size) && size > 0 && size <= 1_000,
  );
const isTaskPriorityChoices = (value: unknown): value is WorkspaceSessionTaskPriorityChoice[] =>
  Array.isArray(value) &&
  value.length <= 4 &&
  value.every((choice) => isOneOf(choice, ["high", "medium", "low", "none"] as const));
const isTaskTagFilters = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 50 && value.every((tag) => isBoundedString(tag, 256));
const isDateFilterValue = (value: unknown): value is string =>
  typeof value === "string" && (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value));
const normalizeTaskDueFilter = (value: unknown): WorkspaceSessionTaskDueFilter | null => {
  if (!isOneOf(value, ["all", "overdue", "today", "week", "no-date", "range", "date"] as const)) return null;
  return value === "date" ? "range" : value;
};
const normalizeTaskDateRange = (
  dueFilter: WorkspaceSessionTaskDueFilter,
  dueDateFilter: string,
  dueDateEndFilter: string,
) => {
  const completedEnd = dueFilter === "range" && dueDateFilter && !dueDateEndFilter ? dueDateFilter : dueDateEndFilter;
  if (dueFilter === "range" && dueDateFilter && completedEnd && completedEnd < dueDateFilter) {
    return { dueDateEndFilter: dueDateFilter, dueDateFilter: completedEnd };
  }
  return { dueDateEndFilter: completedEnd, dueDateFilter };
};
const isTaskYamlPropertyFilter = (value: unknown): value is WorkspaceSessionTaskYamlPropertyFilter =>
  isRecord(value) &&
  isBoundedString(value.key, 256) &&
  value.key.trim() === value.key &&
  isOneOf(value.operator, ["has", "does not have"] as const);
const parseTaskSavedFilter = (value: unknown): WorkspaceSessionTaskSavedFilter | null => {
  const dueFilter = isRecord(value) ? normalizeTaskDueFilter(value.dueFilter) : null;
  if (
    !isRecord(value) ||
    !isBoundedString(value.id, 128) ||
    !isBoundedString(value.name, 60) ||
    !isOneOf(value.lifecycleView, ["active", "closed", "all", "none"] as const) ||
    !dueFilter ||
    (value.priorityFilter !== undefined &&
      !isOneOf(value.priorityFilter, ["all", "high", "medium", "low", "none"] as const)) ||
    typeof value.searchQuery !== "string" ||
    value.searchQuery.length > 200 ||
    (value.tagFilter !== undefined && (typeof value.tagFilter !== "string" || value.tagFilter.length > 256)) ||
    (value.priorityFilters !== undefined && !isTaskPriorityChoices(value.priorityFilters)) ||
    (value.tagFilters !== undefined && !isTaskTagFilters(value.tagFilters)) ||
    (value.dueDateFilter !== undefined && !isDateFilterValue(value.dueDateFilter)) ||
    (value.dueDateEndFilter !== undefined && !isDateFilterValue(value.dueDateEndFilter)) ||
    (value.yamlPropertyFilter !== undefined && !isTaskYamlPropertyFilter(value.yamlPropertyFilter))
  )
    return null;

  const dueDateFilter = typeof value.dueDateFilter === "string" ? value.dueDateFilter : "";
  const dateRange = normalizeTaskDateRange(
    dueFilter,
    dueDateFilter,
    typeof value.dueDateEndFilter === "string"
      ? value.dueDateEndFilter
      : value.dueFilter === "date"
        ? dueDateFilter
        : "",
  );
  return {
    dueDateEndFilter: dateRange.dueDateEndFilter,
    dueDateFilter: dateRange.dueDateFilter,
    dueFilter,
    id: value.id,
    lifecycleView: value.lifecycleView,
    name: value.name,
    priorityFilters: isTaskPriorityChoices(value.priorityFilters)
      ? value.priorityFilters
      : value.priorityFilter && value.priorityFilter !== "all"
        ? [value.priorityFilter]
        : [],
    searchQuery: value.searchQuery,
    tagFilters: isTaskTagFilters(value.tagFilters) ? value.tagFilters : value.tagFilter ? [value.tagFilter] : [],
    ...(isTaskYamlPropertyFilter(value.yamlPropertyFilter) ? { yamlPropertyFilter: value.yamlPropertyFilter } : {}),
  };
};

export const parseWorkspaceSession = (value: unknown): WorkspaceSession | null => {
  if (!isRecord(value) || value.version !== WORKSPACE_SESSION_VERSION) return null;
  if (!isBoundedString(value.activePaneId) || !Array.isArray(value.panes) || value.panes.length > 8) return null;
  if (!Array.isArray(value.tabs) || value.tabs.length > 100) return null;
  if (
    !isStringArray(value.expandedDirectories, 2_000) ||
    !isStringArray(value.recentFilePaths, MAX_WORKSPACE_SESSION_RECENT_FILES)
  )
    return null;
  if (
    !isRecord(value.explorerSections) ||
    typeof value.explorerSections.bookmarks !== "boolean" ||
    typeof value.explorerSections.files !== "boolean" ||
    typeof value.explorerSections.recent !== "boolean"
  )
    return null;
  if (value.explorerSectionSizes !== undefined && !isExplorerSectionSizes(value.explorerSectionSizes)) return null;
  if (!isRecord(value.taskBoard)) return null;
  const fileAccesses = parseFileAccesses(value.fileAccesses);
  if (!fileAccesses) return null;

  const panes = value.panes.flatMap((pane): WorkspaceSessionPane[] => {
    if (
      !isRecord(pane) ||
      !isBoundedString(pane.id, 256) ||
      !isStringArray(pane.tabs, 100) ||
      (pane.activeTabId !== null && !isBoundedString(pane.activeTabId, 256)) ||
      typeof pane.size !== "number" ||
      !Number.isFinite(pane.size) ||
      pane.size <= 0
    )
      return [];
    return [{ activeTabId: pane.activeTabId, id: pane.id, size: pane.size, tabs: pane.tabs }];
  });
  if (panes.length !== value.panes.length) return null;

  const tabs = value.tabs.flatMap((tab): WorkspaceSessionTab[] => {
    if (
      !isRecord(tab) ||
      !isBoundedString(tab.id, 256) ||
      !isBoundedString(tab.currentResourceKey) ||
      !isStringArray(tab.backStack, 100) ||
      !isStringArray(tab.forwardStack, 100)
    )
      return [];
    return [
      {
        backStack: tab.backStack,
        currentResourceKey: tab.currentResourceKey,
        forwardStack: tab.forwardStack,
        id: tab.id,
      },
    ];
  });
  if (tabs.length !== value.tabs.length) return null;

  const taskBoard = value.taskBoard;
  if (
    !isOneOf(taskBoard.lifecycleView, ["active", "closed", "all", "none"] as const) ||
    (taskBoard.sort !== undefined &&
      !isOneOf(taskBoard.sort, ["custom", "due", "created", "modified", "title", "tag", "priority"] as const)) ||
    (taskBoard.sortDirection !== undefined &&
      !isOneOf(taskBoard.sortDirection, ["ascending", "descending"] as const)) ||
    (taskBoard.sortRules === undefined &&
      (!isOneOf(taskBoard.sort, ["custom", "due", "created", "modified", "title", "tag", "priority"] as const) ||
        !isOneOf(taskBoard.sortDirection, ["ascending", "descending"] as const))) ||
    (taskBoard.sortRules !== undefined &&
      (!Array.isArray(taskBoard.sortRules) ||
        taskBoard.sortRules.length > 6 ||
        taskBoard.sortRules.some(
          (rule) =>
            !isRecord(rule) ||
            !isOneOf(rule.field, ["due", "created", "modified", "title", "tag", "priority"] as const) ||
            !isOneOf(rule.direction, ["ascending", "descending"] as const),
        ) ||
        new Set(taskBoard.sortRules.map((rule) => rule.field)).size !== taskBoard.sortRules.length)) ||
    (taskBoard.dueFilter !== undefined && !normalizeTaskDueFilter(taskBoard.dueFilter)) ||
    (taskBoard.priorityFilter !== undefined &&
      !isOneOf(taskBoard.priorityFilter, ["all", "high", "medium", "low", "none"] as const)) ||
    (taskBoard.savedView !== undefined &&
      !isOneOf(taskBoard.savedView, ["all", "custom", "due-soon", "high-priority", "untagged"] as const)) ||
    (taskBoard.selectedProject !== undefined &&
      (typeof taskBoard.selectedProject !== "string" || taskBoard.selectedProject.length > 8192)) ||
    (taskBoard.searchQuery !== undefined &&
      (typeof taskBoard.searchQuery !== "string" || taskBoard.searchQuery.length > 200)) ||
    (taskBoard.tagFilter !== undefined &&
      (typeof taskBoard.tagFilter !== "string" || taskBoard.tagFilter.length > 256)) ||
    (taskBoard.priorityFilters !== undefined && !isTaskPriorityChoices(taskBoard.priorityFilters)) ||
    (taskBoard.tagFilters !== undefined && !isTaskTagFilters(taskBoard.tagFilters)) ||
    (taskBoard.dueDateFilter !== undefined && !isDateFilterValue(taskBoard.dueDateFilter)) ||
    (taskBoard.dueDateEndFilter !== undefined && !isDateFilterValue(taskBoard.dueDateEndFilter)) ||
    (taskBoard.yamlPropertyFilter !== undefined && !isTaskYamlPropertyFilter(taskBoard.yamlPropertyFilter)) ||
    (taskBoard.activeSavedFilterId !== undefined &&
      taskBoard.activeSavedFilterId !== null &&
      !isBoundedString(taskBoard.activeSavedFilterId, 128)) ||
    (taskBoard.savedFilters !== undefined &&
      (!Array.isArray(taskBoard.savedFilters) ||
        taskBoard.savedFilters.length > 50 ||
        taskBoard.savedFilters.some((filter) => !parseTaskSavedFilter(filter)))) ||
    (taskBoard.collapsedSubtaskPaths !== undefined &&
      (!Array.isArray(taskBoard.collapsedSubtaskPaths) ||
        taskBoard.collapsedSubtaskPaths.length > MAX_TASK_BOARD_COLLAPSED_SUBTASK_PATHS ||
        taskBoard.collapsedSubtaskPaths.some((path) => !isBoundedString(path))))
  )
    return null;

  const savedFilters = Array.isArray(taskBoard.savedFilters)
    ? taskBoard.savedFilters.flatMap((filter) => {
        const parsed = parseTaskSavedFilter(filter);
        return parsed ? [parsed] : [];
      })
    : [];
  const activeSavedFilterId =
    typeof taskBoard.activeSavedFilterId === "string" &&
    savedFilters.some((filter) => filter.id === taskBoard.activeSavedFilterId)
      ? taskBoard.activeSavedFilterId
      : null;
  const dueFilter = normalizeTaskDueFilter(taskBoard.dueFilter) ?? "all";
  const dueDateFilter = typeof taskBoard.dueDateFilter === "string" ? taskBoard.dueDateFilter : "";
  const dateRange = normalizeTaskDateRange(
    dueFilter,
    dueDateFilter,
    typeof taskBoard.dueDateEndFilter === "string"
      ? taskBoard.dueDateEndFilter
      : taskBoard.dueFilter === "date"
        ? dueDateFilter
        : "",
  );
  const sortRules = Array.isArray(taskBoard.sortRules)
    ? (taskBoard.sortRules as WorkspaceSessionTaskSortRule[]).map(({ field, direction }) => ({ field, direction }))
    : taskBoard.sort === "custom"
      ? []
      : [
          {
            field: taskBoard.sort as Exclude<WorkspaceSessionTaskSort, "custom">,
            direction: taskBoard.sortDirection as WorkspaceSessionSortDirection,
          },
        ];

  return {
    activePaneId: value.activePaneId,
    expandedDirectories: value.expandedDirectories,
    explorerSectionSizes: isExplorerSectionSizes(value.explorerSectionSizes)
      ? value.explorerSectionSizes
      : { bookmarks: 1, files: 2, recent: 1 },
    explorerSections: {
      bookmarks: value.explorerSections.bookmarks,
      files: value.explorerSections.files,
      recent: value.explorerSections.recent,
    },
    fileAccesses,
    panes,
    recentFilePaths: value.recentFilePaths,
    tabs,
    taskBoard: {
      selectedProject: taskBoard.selectedProject ?? "",
      activeSavedFilterId,
      collapsedSubtaskPaths: taskBoard.collapsedSubtaskPaths ?? [],
      dueDateEndFilter: dateRange.dueDateEndFilter,
      dueDateFilter: dateRange.dueDateFilter,
      dueFilter,
      lifecycleView: taskBoard.lifecycleView,
      priorityFilters: isTaskPriorityChoices(taskBoard.priorityFilters)
        ? taskBoard.priorityFilters
        : taskBoard.priorityFilter && taskBoard.priorityFilter !== "all"
          ? [taskBoard.priorityFilter]
          : [],
      savedFilters,
      searchQuery: taskBoard.searchQuery ?? "",
      sortRules,
      tagFilters: isTaskTagFilters(taskBoard.tagFilters)
        ? taskBoard.tagFilters
        : typeof taskBoard.tagFilter === "string" && taskBoard.tagFilter
          ? [taskBoard.tagFilter]
          : [],
      ...(isTaskYamlPropertyFilter(taskBoard.yamlPropertyFilter)
        ? { yamlPropertyFilter: taskBoard.yamlPropertyFilter }
        : {}),
    },
    version: WORKSPACE_SESSION_VERSION,
  };
};
