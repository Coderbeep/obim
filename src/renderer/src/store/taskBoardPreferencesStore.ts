import { atom } from "jotai";

import { MAX_TASK_BOARD_COLLAPSED_SUBTASK_PATHS } from "@shared/workspace-session";
import type { WorkspaceSessionTaskBoardPreferences } from "@shared/workspace-session";

export type TaskBoardPreferences = WorkspaceSessionTaskBoardPreferences;

export const DEFAULT_TASK_BOARD_PREFERENCES: TaskBoardPreferences = {
  activeSavedFilterId: null,
  collapsedSubtaskPaths: [],
  dueDateEndFilter: "",
  dueDateFilter: "",
  dueFilter: "all",
  lifecycleView: "active",
  priorityFilters: [],
  savedFilters: [],
  searchQuery: "",
  sortRules: [],
  tagFilters: [],
};

export const taskBoardPreferencesAtom = atom<TaskBoardPreferences>(DEFAULT_TASK_BOARD_PREFERENCES);

export const setTaskBoardSubtasksCollapsedAtom = atom(null, (get, set, path: string, collapsed: boolean) => {
  const preferences = get(taskBoardPreferencesAtom);
  const paths = preferences.collapsedSubtaskPaths;
  if (paths.includes(path) === collapsed) return;
  set(taskBoardPreferencesAtom, {
    ...preferences,
    collapsedSubtaskPaths: collapsed
      ? [...paths.slice(-(MAX_TASK_BOARD_COLLAPSED_SUBTASK_PATHS - 1)), path]
      : paths.filter((entry) => entry !== path),
  });
});
