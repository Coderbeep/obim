import { createTaskActions } from "./task-board-actions-test-support";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TaskBoardTask } from "../src/renderer/src/features/task-board/TaskBoardTask";
import { AppDndProvider } from "../src/renderer/src/shared/dnd/AppDndProvider";
import { ContextMenuHost } from "../src/renderer/src/features/context-menu/ContextMenuHost";

function fixture(titles = ["A"]) {
  const user = userEvent.setup();
  const onComplete = vi.fn(async () => true);
  const onOpen = vi.fn();
  const view = render(
    <AppDndProvider>
      {titles.map((title) => (
        <TaskBoardTask
          key={title}
          item={{
            id: title,
            title,
            path: `/notes/${title}.md`,
            relativePath: `${title}.md`,
            filename: title,
            mimeType: "text/markdown",
            isDirectory: false,
            status: "open",
            metadataIssues: [],
          }}
          dnd={{
            draggedPath: null,
            clear: vi.fn(),
            startDrag: vi.fn(),
          }}
          taskActions={createTaskActions({
            loadTags: async () => [],
            completeTask: onComplete,
            cancelTask: async () => true,
            deleteTask: async () => true,
            moveTask: async () => true,
            openTask: onOpen,
            reopenTask: async () => true,
            updateTask: async () => true,
          })}
          projects={[]}
        />
      ))}
      <ContextMenuHost />
    </AppDndProvider>,
  );
  return { ...view, user, onComplete, onOpen };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("does not expose a parent-task completion checkbox", () => {
  const { onComplete } = fixture();
  expect(screen.queryByRole("button", { name: "Complete A" })).toBeNull();
  expect(onComplete).not.toHaveBeenCalled();
});
it.each([" ", "{Enter}"])("lets the actions button activate with %s", async (key) => {
  const { user } = fixture();
  screen.getByRole("button", { name: "Task actions for A" }).focus();
  await user.keyboard(key);
  expect(document.documentElement.dataset.appDragKind).toBeUndefined();
  expect(screen.getByRole("menu")).toBeTruthy();
});
it("opens a focused task with Space or Enter without starting a drag", async () => {
  const { user, onOpen } = fixture();
  const card = screen.getByRole("button", { name: "Open task A" });
  card.focus();
  await user.keyboard(" ");
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(document.documentElement.dataset.appDragKind).toBeUndefined();
  await user.keyboard("{ArrowDown}{ArrowRight}");
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(card);
  await user.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledTimes(2);
  expect(document.activeElement).toBe(card);
});

it("switches task editors with F2 and keeps the previous draft available", async () => {
  const { user } = fixture(["A", "B"]);
  screen.getByRole("button", { name: "Open task A" }).focus();
  await user.keyboard("{F2}");
  await user.type(screen.getByRole("textbox", { name: "Task name" }), " revised");
  screen.getByRole("button", { name: "Open task B" }).focus();
  await user.keyboard("{F2}");
  expect(screen.getAllByRole("textbox", { name: "Task name" })).toHaveLength(1);
  expect((screen.getByRole("textbox", { name: "Task name" }) as HTMLInputElement).value).toBe("B");
  screen.getByRole("button", { name: "Open task A" }).focus();
  await user.keyboard("{F2}");
  expect(screen.getAllByRole("textbox", { name: "Task name" })).toHaveLength(1);
  expect((screen.getByRole("textbox", { name: "Task name" }) as HTMLInputElement).value).toBe("A revised");
});
