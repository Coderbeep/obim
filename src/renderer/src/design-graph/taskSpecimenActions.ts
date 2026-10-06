import type { TaskActions } from "../features/task-board/taskBoardModel";

/** Interactive specimens keep callbacks local and do not write workspace files. */
export const createTaskSpecimenActions = (overrides: Partial<TaskActions> = {}): TaskActions => ({
  createTask: async () => true,
  updateTask: async () => true,
  completeTask: async () => true,
  cancelTask: async () => true,
  reopenTask: async () => true,
  deleteTask: async () => true,
  pinTask: async () => true,
  moveTask: async () => true,
  repairMetadata: async () => true,
  updateSubtasks: async () => true,
  openTask: () => {},
  loadTags: async () => [],
  ...overrides,
});
