import type { TaskActions } from "../src/renderer/src/features/task-board/taskBoardModel";

/** Supplies unused callbacks while tests override the behavior and spies they exercise. */
export const createTaskActions = (overrides: Partial<TaskActions> = {}): TaskActions => ({
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
  loadTags: async () => [],
  openTask: () => {},
  ...overrides,
});
