import { act, cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTaskActions } from "./task-board-actions-test-support";
import { TaskBoard } from "../src/renderer/src/features/task-board/TaskBoard";
import { TaskBoardInspector } from "../src/renderer/src/features/task-board/TaskBoardInspector";
import * as taskBoardHook from "../src/renderer/src/features/task-board/useTaskBoard";
import {
  DEFAULT_TASK_BOARD_PREFERENCES,
  type TaskBoardPreferences,
} from "../src/renderer/src/store/taskBoardPreferencesStore";
import {
  taskBoardInspectorSnapshotAtom,
  taskBoardRevealRequestAtom,
} from "../src/renderer/src/store/taskBoardInspectorStore";

vi.mock("@renderer/features/files/fileActions", () => ({ useFileOpen: () => ({ open: vi.fn() }) }));
vi.mock("@renderer/features/editor/inspector/WidgetStack", () => ({
  RightSidebarWidgetStack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  RightSidebarWidget: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const tasks = ["2026-09-08", "2026-09-09"].map((dueDate) => ({
  id: dueDate,
  path: `/notes/${dueDate}.md`,
  relativePath: `${dueDate}.md`,
  filename: dueDate,
  isDirectory: false as const,
  mimeType: "text/markdown",
  title: dueDate,
  status: "open" as const,
  metadataIssues: [],
  dueDate,
  project: "Research",
}));
function fixture(patch = {}, hiddenSection = false) {
  const fixtureTasks = hiddenSection ? tasks.map((task) => ({ ...task, project: "Hidden" })) : tasks;
  const success = vi.fn(async () => true);
  let updatePreferences: (
    next: TaskBoardPreferences | ((current: TaskBoardPreferences) => TaskBoardPreferences),
  ) => void = () => {};
  const board = {
    allTasks: fixtureTasks,
    orderedTasks: fixtureTasks,
    columns: [],
    projects: hiddenSection
      ? [{ name: "Hidden", colorId: "blue", hidden: true }]
      : [{ name: "Research", colorId: "blue" }],
    error: null,
    hasLoaded: true,
    isLoading: false,
    isMoving: false,
    preferences: {
      ...DEFAULT_TASK_BOARD_PREFERENCES,
      dueFilter: "today" as const,
      ...patch,
    },
    setPreferences: vi.fn((next: TaskBoardPreferences | ((current: TaskBoardPreferences) => TaskBoardPreferences)) =>
      updatePreferences(next),
    ),
    loadTags: vi.fn(async () => []),
    createTask: success,
    completeTask: success,
    cancelTask: success,
    reopenTask: success,
    repairMetadata: success,
    deleteTask: success,
    moveTask: success,
    updateTask: success,
    openTask: vi.fn(),
    createProject: vi.fn(),
    deleteProject: success,
    updateProject: success,
    refresh: vi.fn(),
    usageCountByProjectName: new Map(),
  };
  const taskActions = createTaskActions(board);
  vi.spyOn(taskBoardHook, "useTaskBoard").mockImplementation(() => {
    const [preferences, setPreferences] = useState<TaskBoardPreferences>(board.preferences);
    updatePreferences = setPreferences;
    return { ...board, taskActions, preferences } as unknown as ReturnType<typeof taskBoardHook.useTaskBoard>;
  });
  const store = createStore();
  store.set(taskBoardInspectorSnapshotAtom, { tasks: fixtureTasks, hasLoaded: true, isLoading: false, error: null });
  const view = render(
    <Provider store={store}>
      <div data-testid="board">
        <TaskBoard />
      </div>
      <div data-testid="inspector">
        <TaskBoardInspector />
      </div>
    </Provider>,
  );
  return {
    ...view,
    store,
    board,
    boardUI: within(screen.getByTestId("board")),
    inspector: within(screen.getByTestId("inspector")),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 8, 23, 59, 59));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("updates the mounted Today board and inspector at local midnight", () => {
  const { boardUI, inspector } = fixture();
  expect(boardUI.getByRole("button", { name: "Open task 2026-09-08" })).toBeTruthy();
  expect(within(inspector.getByRole("region", { name: "Today" })).getByText("2026-09-08")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1100));
  expect(boardUI.queryByRole("button", { name: "Open task 2026-09-08" })).toBeNull();
  expect(boardUI.getByRole("button", { name: "Open task 2026-09-09" })).toBeTruthy();
  expect(within(inspector.getByRole("region", { name: "Overdue" })).getByText("2026-09-08")).toBeTruthy();
  expect(within(inspector.getByRole("region", { name: "Today" })).getByText("2026-09-09")).toBeTruthy();
});
it.each(["focus", "pageshow", "visibilitychange"])(
  "refreshes after suspended timers on %s while preserving an explicit date",
  (event) => {
    const { boardUI, inspector } = fixture({
      dueFilter: "range",
      dueDateFilter: "2026-09-08",
      dueDateEndFilter: "2026-09-08",
    });
    act(() => {
      vi.setSystemTime(new Date(2026, 8, 9, 12));
      fireEvent(event === "visibilitychange" ? document : window, new Event(event));
    });
    expect(boardUI.getByRole("button", { name: "Open task 2026-09-08" })).toBeTruthy();
    expect(boardUI.queryByRole("button", { name: "Open task 2026-09-09" })).toBeNull();
    expect(within(inspector.getByRole("region", { name: "Today" })).getByText("2026-09-09")).toBeTruthy();
  },
);
it("keeps the board controls when filters match no tasks", () => {
  const { boardUI } = fixture({ searchQuery: "nothing-matches" });
  expect(boardUI.queryAllByRole("button", { name: /^Open task / })).toHaveLength(0);
  expect(boardUI.getByRole("toolbar", { name: "Task board controls" })).toBeTruthy();
  expect(boardUI.queryByRole("tab", { name: "List view" })).toBeNull();
  expect(boardUI.queryByRole("button", { name: "Add task" })).toBeNull();
  expect(boardUI.getByRole("button", { name: "Manage projects" })).toBeTruthy();
});

it("reveals and highlights an agenda task in a collapsed workflow stage", () => {
  const { boardUI, store } = fixture();
  fireEvent.click(boardUI.getByRole("button", { name: "Collapse Backlog" }));
  act(() => store.set(taskBoardRevealRequestAtom, { task: tasks[0], id: "first" }));
  act(() => vi.advanceTimersByTime(50));
  expect(boardUI.getByRole("button", { name: "Collapse Backlog" }).getAttribute("aria-expanded")).toBe("true");
  const card = document.querySelector<HTMLElement>('[data-task-path="/notes/2026-09-08.md"]');
  expect(card?.dataset.agendaHighlighted).toBe("true");
  expect(document.activeElement).toBe(card);
  act(() => vi.advanceTimersByTime(3100));
  expect(card?.dataset.agendaHighlighted).toBeUndefined();
});
it("reveals an agenda task that the current search filters out", () => {
  const { boardUI, store } = fixture({ searchQuery: "no-match" });
  act(() => store.set(taskBoardRevealRequestAtom, { task: tasks[0], id: "search" }));
  act(() => vi.advanceTimersByTime(50));
  expect(boardUI.getByRole("button", { name: "Open task 2026-09-08" })).toBeTruthy();
  expect(
    document.querySelector<HTMLElement>('[data-task-path="/notes/2026-09-08.md"]')?.dataset.agendaHighlighted,
  ).toBe("true");
});

it("reveals an agenda task in a hidden project without changing its project setting", () => {
  const { store, board } = fixture({}, true);
  const target = store.get(taskBoardInspectorSnapshotAtom)!.tasks[0];
  expect(document.querySelector('[data-task-path="/notes/2026-09-08.md"]')).toBeNull();
  act(() => store.set(taskBoardRevealRequestAtom, { task: target, id: "hidden" }));
  act(() => vi.advanceTimersByTime(50));
  expect(
    document.querySelector<HTMLElement>('[data-task-path="/notes/2026-09-08.md"]')?.dataset.agendaHighlighted,
  ).toBe("true");
  expect("hidden" in board.projects[0] ? board.projects[0].hidden : false).toBe(true);
  expect(board.setPreferences).not.toHaveBeenCalled();
});
