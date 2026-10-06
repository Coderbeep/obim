import { createTaskActions } from "./task-board-actions-test-support";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { TaskBoardTask } from "../src/renderer/src/features/task-board/TaskBoardTask";
import { ContextMenuHost } from "../src/renderer/src/features/context-menu/ContextMenuHost";
import { type TaskBoardTask as Task } from "../src/renderer/src/features/task-board/taskBoardModel";

const task: Task = {
  id: "Read",
  filename: "Read",
  relativePath: "Read.md",
  path: "/notes/Read.md",
  isDirectory: false,
  mimeType: "text/markdown",
  title: "Read",
  status: "open",
  metadataIssues: [],
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderTask(onComplete: () => Promise<boolean>, onReopen: () => Promise<boolean>, item: Task = task) {
  return render(
    <>
      <TaskBoardTask
        item={item}
        taskActions={createTaskActions({
          loadTags: async () => [],
          completeTask: onComplete,
          reopenTask: onReopen,
          cancelTask: async () => true,
          deleteTask: async () => true,
          moveTask: async () => true,
          openTask: () => {},
          updateTask: async () => true,
        })}
        projects={[]}
      />
      <ContextMenuHost />
    </>,
  );
}

test("completes immediately through the task action without a parent checkbox", async () => {
  const complete = vi.fn(async () => true);
  renderTask(complete, async () => true);
  expect(screen.queryByRole("button", { name: "Complete Read" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Task actions for Read" }));
  await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Complete task" })));
  expect(complete).toHaveBeenCalledWith(task);
});

test("reopens a done task through its task action", async () => {
  const reopen = vi.fn(async () => true);
  const done = { ...task, status: "done" as const };
  renderTask(async () => true, reopen, done);
  fireEvent.click(screen.getByRole("button", { name: "Task actions for Read" }));
  await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Reopen task" })));
  expect(reopen).toHaveBeenCalledWith(done);
});
