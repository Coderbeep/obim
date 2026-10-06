import { createTaskActions } from "./task-board-actions-test-support";
import { TaskBoardColumn } from "../src/renderer/src/features/task-board/TaskBoard";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskBoardTask } from "../src/renderer/src/features/task-board/TaskBoardTask";
import { ContextMenuHost } from "../src/renderer/src/features/context-menu/ContextMenuHost";
import { useTaskBoardDnd } from "../src/renderer/src/features/task-board/useTaskBoard";
import { type TaskBoardTask as Task } from "../src/renderer/src/features/task-board/taskBoardModel";
import { TASK_BOARD_TASK_DRAG_DATA_MIME } from "../src/shared/drag-data";
import { AppDndProvider } from "../src/renderer/src/shared/dnd/AppDndProvider";

const task = (title: string, project = "Research"): Task => ({
  id: title,
  filename: title,
  relativePath: `Tasks/${title}.md`,
  path: `/notes/Tasks/${title}.md`,
  isDirectory: false,
  mimeType: "text/markdown",
  title,
  status: "open",
  metadataIssues: [],
  project,
});

const dataTransfer = () => {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    getData: (type: string) => values.get(type) ?? "",
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    setDragImage: vi.fn(),
  };
};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollBy", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Task Board native drag and drop", () => {
  it("starts dragging from metadata chips and their contents while protecting action buttons", () => {
    const item = {
      ...task("Drag metadata"),
      tags: ["science", "reading", "later"],
      priority: "high" as const,
      dueDate: "2026-09-17",
    };
    const startDrag = vi.fn();
    const onOpen = vi.fn();
    const onUpdate = vi.fn(async () => true);
    const success = async () => true;
    render(
      <TaskBoardTask
        dnd={{ draggedPath: null, startDrag, clear: vi.fn() }}
        item={item}
        taskActions={createTaskActions({
          loadTags: async () => [],
          cancelTask: success,
          completeTask: success,
          deleteTask: success,
          moveTask: success,
          openTask: onOpen,
          reopenTask: success,
          updateTask: onUpdate,
        })}
        projects={[]}
      />,
    );
    const card = screen.getByRole("button", { name: "Open task Drag metadata" });
    for (const label of [
      "Show all tags: science",
      "Show 1 more tags",
      "Change priority for Drag metadata",
      "Change due date for Drag metadata",
    ]) {
      const chip = screen.getByRole("button", { name: label });
      for (const target of [chip, ...chip.querySelectorAll("span, svg")]) {
        startDrag.mockClear();
        fireEvent.pointerDown(target, { button: 0 });
        expect(fireEvent.dragStart(card, { dataTransfer: dataTransfer() })).toBe(true);
        expect(startDrag).toHaveBeenCalledWith(expect.anything(), item);
        fireEvent.dragEnd(card);
      }
    }
    for (const label of ["Task actions for Drag metadata"]) {
      startDrag.mockClear();
      fireEvent.pointerDown(screen.getByRole("button", { name: label }), { button: 0 });
      expect(fireEvent.dragStart(card, { dataTransfer: dataTransfer() })).toBe(false);
      expect(startDrag).not.toHaveBeenCalled();
    }
    expect(onOpen).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("writes only the path payload and commits a resolved move", async () => {
    const item = task("Read paper");
    const moveTask = vi.fn(async () => true);
    const { result } = renderHook(() => useTaskBoardDnd({ moveTask, tasks: [item] }));
    const transfer = dataTransfer();
    act(() =>
      result.current.startDrag(
        { dataTransfer: transfer, stopPropagation: vi.fn() } as unknown as React.DragEvent<HTMLElement>,
        item,
      ),
    );
    expect(transfer.setData).toHaveBeenCalledWith(TASK_BOARD_TASK_DRAG_DATA_MIME, JSON.stringify({ path: item.path }));
    expect(result.current.draggedPath).toBe(item.path);
    const intent = result.current.resolveIntent(item.path, { kind: "board", project: "Research", index: 1 });
    expect(intent).toEqual({ kind: "board", project: "Research", index: 1 });
    await act(async () => {
      await result.current.commit(item.path, intent!);
    });
    expect(moveTask).toHaveBeenCalledWith(item, intent);
    expect(result.current.draggedPath).toBeNull();
  });

  it("clears transient state from the draggable lifecycle", () => {
    const item = task("Task");
    const { result } = renderHook(() => useTaskBoardDnd({ moveTask: async () => true, tasks: [item] }));

    const dnd = { ...result.current, startDrag: vi.fn(), clear: vi.fn() };
    const { container } = render(
      <TaskBoardTask
        dnd={dnd}
        item={item}
        taskActions={createTaskActions({
          loadTags: async () => [],
          cancelTask: async () => true,
          completeTask: async () => true,
          deleteTask: async () => true,
          moveTask: async () => true,
          openTask: () => undefined,
          reopenTask: async () => true,
          updateTask: async () => true,
        })}
        projects={[]}
      />,
    );
    const draggable = container.querySelectorAll('[draggable="true"]');
    expect(draggable).toHaveLength(1);
    expect(draggable[0].getAttribute("aria-label")).toBe("Open task Task");
    fireEvent.dragEnd(draggable[0]);
    expect(dnd.clear).toHaveBeenCalledOnce();
  });

  it("uses inline F2 task editing without exposing the body field", async () => {
    const user = userEvent.setup();
    const item = {
      ...task("Editable"),
      preview: "First line\nSecond line",
      priority: "medium" as const,
      tags: ["paper"],
    };
    const onUpdate = vi.fn(async () => false);
    render(
      <TaskBoardTask
        item={item}
        taskActions={createTaskActions({
          loadTags: async () => [],
          cancelTask: async () => true,
          completeTask: async () => true,
          deleteTask: async () => true,
          moveTask: async () => true,
          openTask: () => undefined,
          reopenTask: async () => true,
          updateTask: onUpdate,
        })}
        projects={[{ name: "Development", colorId: "blue" }]}
      />,
    );
    await user.tab();
    await user.keyboard("{F2}");
    const priority = await screen.findByRole("radiogroup", { name: "Choose priority" });
    const title = screen.getByRole("textbox", { name: "Task name" });
    const editor = title.closest("[data-task-editor-layout]");
    expect(editor?.getAttribute("data-task-editor-layout")).toBe("board");
    expect(editor?.className).toContain("grid-cols-[minmax(0,1fr)]");
    expect(title.className).toContain("text-ui-item");
    expect(priority.className).toContain("col-span-2");
    expect(priority.parentElement?.className).toContain("grid-cols-[minmax(0,1fr)_7.5rem]");
    expect(screen.getByRole("radio", { name: "Medium" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/to cancel/)).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Task details" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(item, expect.objectContaining({ priority: "medium", tags: ["paper"] })),
    );
  });

  it("toggles hovered task pinning with P and ignores typing and modified keys", async () => {
    const onPin = vi.fn(async () => true);
    const onUpdate = vi.fn(async () => true);
    const props = {
      taskActions: createTaskActions({
        loadTags: async () => [],
        cancelTask: async () => true,
        completeTask: async () => true,
        deleteTask: async () => true,
        moveTask: async () => true,
        openTask: vi.fn(),
        reopenTask: async () => true,
        updateTask: onUpdate,
        pinTask: onPin,
      }),
      projects: [],
    };
    const item = task("Pin task");
    const { rerender } = render(<TaskBoardTask {...props} item={item} />);
    fireEvent.keyDown(window, { key: "p" });
    expect(onPin).not.toHaveBeenCalled();
    const card = screen.getByRole("button", { name: "Open task Pin task" });
    fireEvent.mouseEnter(card);
    for (const pinned of [true, false]) {
      await act(async () => {
        fireEvent.keyDown(window, { key: "p" });
      });
      expect(onPin).toHaveBeenLastCalledWith(expect.anything(), pinned);
      rerender(<TaskBoardTask {...props} item={{ ...item, pinned }} />);
      expect(Boolean(screen.queryByRole("img", { name: "Pinned task" }))).toBe(pinned);
    }
    expect(onPin).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    fireEvent.keyDown(window, { key: "p", repeat: true });
    fireEvent.keyDown(window, { key: "p", isComposing: true });
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Task name" }), { key: "p" });
    expect(onPin).toHaveBeenCalledTimes(2);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(props.taskActions.openTask).not.toHaveBeenCalled();
  });

  it("opens the hovered task with Return without interfering with focused controls", () => {
    const item = task("Hover open");
    const onOpen = vi.fn();
    const success = async () => true;
    render(
      <TaskBoardTask
        item={item}
        taskActions={createTaskActions({
          openTask: onOpen,
          loadTags: async () => [],
          cancelTask: success,
          completeTask: success,
          deleteTask: success,
          moveTask: success,
          reopenTask: success,
          updateTask: success,
        })}
        projects={[]}
      />,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    const card = screen.getByRole("button", { name: "Open task Hover open" });
    fireEvent.mouseEnter(card);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(item);
    fireEvent.keyDown(screen.getByRole("button", { name: "Task actions for Hover open" }), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("enters inline edit mode when E is pressed over a hovered task", () => {
    const item = task("Hover edit");
    render(
      <TaskBoardTask
        item={item}
        taskActions={createTaskActions({
          loadTags: async () => [],
          cancelTask: async () => true,
          completeTask: async () => true,
          deleteTask: async () => true,
          moveTask: async () => true,
          openTask: () => undefined,
          reopenTask: async () => true,
          updateTask: async () => true,
        })}
        projects={[]}
      />,
    );
    const card = screen.getByRole("button", { name: "Open task Hover edit" });

    fireEvent.keyDown(window, { key: "e" });
    expect(screen.queryByRole("textbox", { name: "Task name" })).toBeNull();

    fireEvent.mouseEnter(card);
    fireEvent.keyDown(window, { key: "e" });

    expect(screen.getByRole("textbox", { name: "Task name" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Task details" })).toBeNull();
  });

  it("offers complete and destructive delete actions in the task menu", async () => {
    vi.useFakeTimers();
    const item = task("Actionable");
    const onComplete = vi.fn(async () => false);
    const onDelete = vi.fn(async () => false);
    render(
      <>
        <TaskBoardTask
          item={item}
          taskActions={createTaskActions({
            loadTags: async () => [],
            completeTask: onComplete,
            cancelTask: async () => false,
            deleteTask: onDelete,
            moveTask: async () => true,
            openTask: () => undefined,
            reopenTask: async () => false,
            updateTask: async () => true,
          })}
          projects={[]}
        />
        <ContextMenuHost />
      </>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Open task Actionable" }), {
      clientX: 120,
      clientY: 80,
    });
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    const actions = screen.getByRole("button", { name: "Task actions for Actionable" });
    const card = screen.getByRole("button", { name: "Open task Actionable" });
    expect(card.className).toContain("border-[var(--border-subtle)]");
    fireEvent.click(actions);
    expect(screen.getByRole("menu").classList.contains("menu-surface")).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Complete task" }));
    expect(screen.queryByRole("button", { name: /completion of Actionable/ })).toBeNull();
    expect(card.className).toContain("border-[var(--border-subtle)]");
    expect(card.className).toContain("bg-[var(--surface-3)]");
    expect(screen.queryByText("Undo")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(onComplete).toHaveBeenCalledWith(item);

    fireEvent.click(screen.getByRole("button", { name: "Task actions for Actionable" }));
    const deleteAction = screen.getByRole("menuitem", { name: "Move to Trash" });
    expect(deleteAction.getAttribute("data-danger")).toBe("true");
    fireEvent.click(deleteAction);
    expect(onDelete).toHaveBeenCalledWith(item);
  });

  it.each(["board"] as const)(
    "shows tag overflow on hover, focus, and click without expanding the %s row",
    async () => {
      const user = userEvent.setup();
      const onOpen = vi.fn();
      render(
        <TaskBoardTask
          item={{ ...task("Hover tags"), tags: ["research", "weather", "reading", "planning", "writing"] }}
          taskActions={createTaskActions({
            loadTags: async () => [],
            cancelTask: async () => true,
            completeTask: async () => true,
            deleteTask: async () => true,
            moveTask: async () => true,
            openTask: onOpen,
            reopenTask: async () => true,
            updateTask: async () => true,
          })}
          projects={[]}
        />,
      );
      const trigger = screen.getByRole("button", { name: "Show 3 more tags" });
      await user.hover(trigger);
      expect(await screen.findByRole("tooltip")).toBeTruthy();
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(trigger.parentElement?.className).toContain("flex-nowrap");
      await user.unhover(trigger);
      await user.keyboard("{Escape}");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      act(() => trigger.focus());
      expect(await screen.findByRole("tooltip")).toBeTruthy();
      await user.keyboard("{Escape}");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(trigger);
      await user.keyboard("{Enter}");
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      await user.keyboard("{Escape}");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      await user.click(trigger);
      expect(await screen.findByRole("tooltip")).toBeTruthy();
      expect(onOpen).not.toHaveBeenCalled();
    },
  );

  it("quick edits preserve other metadata and do not open the task", async () => {
    const user = userEvent.setup();
    const item = {
      ...task("Quick edit", "Research"),
      priority: "high" as const,
      dueDate: "2026-09-17",
      tags: ["science"],
    };
    const onUpdate = vi.fn(async () => true);
    const onOpen = vi.fn();
    render(
      <TaskBoardTask
        item={item}
        taskActions={createTaskActions({
          loadTags: async () => [],
          cancelTask: async () => true,
          completeTask: async () => true,
          deleteTask: async () => true,
          moveTask: async () => true,
          openTask: onOpen,
          reopenTask: async () => true,
          updateTask: onUpdate,
        })}
        projects={[]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Change priority for Quick edit" }));
    await user.click(screen.getByRole("button", { name: "Medium" }));
    expect(onUpdate).toHaveBeenCalledWith(item, {
      original: {
        taskName: item.title,
        project: "Research",
        tags: ["science"],
        dueDate: "2026-09-17",
        priority: "high",
      },
      priority: "medium",
    });
    await user.click(screen.getByRole("button", { name: "Change due date for Quick edit" }));
    await user.click(screen.getByRole("button", { name: "Clear date" }));
    expect(onUpdate).toHaveBeenLastCalledWith(
      item,
      expect.objectContaining({
        dueDate: "",
        original: expect.objectContaining({ priority: "high", tags: ["science"] }),
      }),
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it.each([["research"], ["research", "weather", "reading"]])(
    "opens all tags from a displayed tag without opening the task (%j)",
    async (...tags) => {
      const user = userEvent.setup();
      const onOpen = vi.fn();
      render(
        <TaskBoardTask
          item={{ ...task("Tag click"), tags }}
          taskActions={createTaskActions({
            loadTags: async () => [],
            cancelTask: async () => true,
            completeTask: async () => true,
            deleteTask: async () => true,
            moveTask: async () => true,
            openTask: onOpen,
            reopenTask: async () => true,
            updateTask: async () => true,
          })}
          projects={[]}
        />,
      );
      const trigger = screen.getByRole("button", { name: "Show all tags: research" });
      await user.click(trigger);
      const tooltip = await screen.findByRole("tooltip");
      for (const tag of tags) expect(tooltip.textContent).toContain(tag);
      expect(onOpen).not.toHaveBeenCalled();
      await user.keyboard("{Escape}");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      await user.keyboard("{Enter}");
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(onOpen).not.toHaveBeenCalled();
    },
  );

  it("uses a left-rail board handle, compact metadata footer, and inline quick edits", async () => {
    vi.useFakeTimers();
    const item = {
      ...task("Fully visible"),
      priority: "high" as const,
      dueDate: "2099-01-01",
      tags: ["machine-learning", "algorithms", "optimization"],
    };
    const startDrag = vi.fn();
    const clear = vi.fn();
    const onComplete = vi.fn(async () => true);
    const { container } = render(
      <TaskBoardTask
        dnd={{ draggedPath: null, startDrag, clear }}
        item={item}
        taskActions={createTaskActions({
          loadTags: async () => [],
          cancelTask: async () => true,
          completeTask: onComplete,
          deleteTask: async () => true,
          moveTask: async () => true,
          openTask: () => undefined,
          reopenTask: async () => true,
          updateTask: async () => true,
        })}
        projects={[]}
      />,
    );

    expect(screen.getByText("machine-learning").className).not.toContain("truncate");
    expect(screen.getByText("algorithms")).toBeTruthy();
    expect(screen.getByText("optimization")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show 1 more tags" }).textContent).toBe("+1");
    const tagBadges = [...container.querySelectorAll(".task-board-task-tags [data-task-tag-measure]")];
    expect(tagBadges).toHaveLength(3);
    expect(tagBadges.every((badge) => badge.className.includes("bg-[var(--chip-category)]"))).toBe(true);
    expect(container.querySelectorAll(".task-board-task-metadata [data-task-tag-measure]")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Complete Fully visible" })).toBeNull();
    const card = container.querySelector<HTMLElement>('[data-task-layout="board"]')!;
    const actions = screen.getByRole("button", { name: "Task actions for Fully visible" });
    expect(card.getAttribute("draggable")).toBe("true");
    fireEvent.pointerDown(screen.getByText("Fully visible"), { clientX: 10, clientY: 10 });
    fireEvent.dragStart(card, { clientX: 20, clientY: 20, dataTransfer: dataTransfer() });
    expect(startDrag).toHaveBeenCalledOnce();
    expect(card.className).toContain("border-[var(--border-subtle)]");
    expect(card.className).toContain("rounded-[var(--radius-card)]");
    expect(card.className).toContain("shadow-none");
    expect(card.className).not.toContain("elevation-shadow-raised");
    expect(actions.getAttribute("draggable")).not.toBe("true");
    expect(actions.querySelector("[data-task-drag-dots]")).toBeNull();
    expect(actions.parentElement?.className).not.toContain("absolute");
    expect(actions.parentElement?.parentElement?.className).toContain("grid-cols-[minmax(0,1fr)_24px]");
    expect(screen.queryByRole("button", { name: "Drag Fully visible" })).toBeNull();
    const title = screen.getByText("Fully visible");
    expect(title.className).toContain("leading-5");
    fireEvent.dragStart(card);
    expect(startDrag).toHaveBeenCalledWith(expect.anything(), item);
    fireEvent.dragEnd(card);
    expect(clear).toHaveBeenCalledOnce();
    expect(container.querySelector(".task-board-task-metadata")?.className).toContain("gap-x-3");
    expect(screen.getByRole("button", { name: "Task actions for Fully visible" })).toBe(actions);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("keeps board tags to one line and reveals overflow tags on demand", async () => {
    const user = userEvent.setup();
    const item = { ...task("Tagged"), tags: ["one", "two", "three", "four", "five"] };
    const { container } = render(
      <TaskBoardTask
        item={item}
        taskActions={createTaskActions({
          loadTags: async () => [],
          cancelTask: async () => true,
          completeTask: async () => true,
          deleteTask: async () => true,
          moveTask: async () => true,
          openTask: () => undefined,
          reopenTask: async () => true,
          updateTask: async () => true,
        })}
        projects={[]}
      />,
    );

    const tagRow = container.querySelector(".task-board-task-tags")!;
    expect(tagRow.className).toContain("flex-nowrap");
    expect(tagRow.className).toContain("overflow-hidden");
    expect(tagRow.querySelector('[data-task-tag-measure][aria-hidden="true"]')?.textContent).toBe("three");

    await user.click(screen.getByRole("button", { name: "Show 3 more tags" }));
    expect(screen.getByRole("button", { name: "Show 3 more tags" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("tooltip").textContent).toContain("five");
    expect(tagRow.className).toContain("flex-nowrap");
    expect(screen.getAllByText("five").some((element) => !element.closest('[aria-hidden="true"]'))).toBe(true);
  });
});

it("uses stage-only pointer moves when manual order is unavailable", async () => {
  const item = task("Filtered task");
  const moveTask = vi.fn(async () => true);
  const { result } = renderHook(() => useTaskBoardDnd({ allowReorder: false, tasks: [item], moveTask }));
  expect(
    result.current.resolveIntent(item.path, { kind: "board", project: "Research", stage: "backlog", index: 1 }),
  ).toBeNull();
  const intent = result.current.resolveIntent(item.path, {
    kind: "board",
    project: "Research",
    stage: "doing",
    index: 25,
  });
  expect(intent).toEqual({ kind: "board", project: "Research", stage: "doing", index: 0, projectOnly: true });
  await act(async () => {
    await result.current.commit(item.path, intent!);
  });
  expect(moveTask).toHaveBeenCalledWith(item, intent);
});

it("resolves Task Board boundaries from the current pointer, including a drop before repaint", async () => {
  const items = [task("A"), task("B"), task("C")];
  const moveTask = vi.fn(async () => true);
  const success = async () => true;
  const Board = () => {
    const dnd = useTaskBoardDnd({ tasks: items, moveTask });
    return (
      <TaskBoardColumn
        column={{ name: "Backlog", accent: "var(--task-stage-backlog)", stage: "backlog", tasks: items }}
        dnd={dnd}
        draggable
        addTask={success}
        taskCardProps={{
          taskActions: createTaskActions({
            loadTags: async () => [],
            completeTask: success,
            cancelTask: success,
            deleteTask: success,
            moveTask: success,
            openTask: () => {},
            reopenTask: success,
            updateTask: success,
          }),
          isMoving: false,
        }}
        onOpenManageProjects={() => {}}
        projects={[]}
        project="Research"
      />
    );
  };
  const { container } = render(
    <AppDndProvider>
      <Board />
    </AppDndProvider>,
  );
  const rows = [...container.querySelectorAll<HTMLElement>("[data-task-drop-row]")];
  rows.forEach((row, index) =>
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: index * 110, height: 100 } as DOMRect),
  );
  const column = container.querySelector<HTMLElement>("[data-task-board-column]")!;
  const transfer = dataTransfer();
  fireEvent.dragStart(rows[1].querySelector('[draggable="true"]')!, { dataTransfer: transfer });
  expect(document.querySelector(".app-dnd-overlay")).not.toBeNull();
  const dispatchAt = (element: Element, type: "dragover" | "drop", y: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { clientY: { value: y }, dataTransfer: { value: transfer } });
    fireEvent(element, event);
  };
  const dragOver = (element: Element, y: number) => dispatchAt(element, "dragover", y);
  dragOver(rows[2].querySelector("button")!, 180);
  expect(rows[2].querySelector(".app-dnd-horizontal-insertion-line")).not.toBeNull();
  dragOver(column, 10);
  expect(rows[0].querySelector(".app-dnd-horizontal-insertion-line")).not.toBeNull();
  // The last hover remains at the start, but drop recomputes the end boundary.
  dispatchAt(column, "drop", 350);
  await waitFor(() =>
    expect(moveTask).toHaveBeenCalledWith(
      items[1],
      expect.objectContaining({
        index: 2,
        beforePath: null,
      }),
    ),
  );
});
