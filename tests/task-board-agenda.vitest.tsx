import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Panel: ({ children, id }: { children: ReactNode; id: string }) => <div data-widget-field={id}>{children}</div>,
  Separator: () => <div />,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));
const openNote = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/files/fileActions", () => ({ useFileOpen: () => ({ open: openNote }) }));
import { TaskBoardInspector } from "../src/renderer/src/features/task-board/TaskBoardInspector";
import { AppDndProvider } from "../src/renderer/src/shared/dnd/AppDndProvider";
import {
  taskBoardInspectorSnapshotAtom,
  taskBoardAgendaActionsAtom,
  taskBoardRevealRequestAtom,
} from "../src/renderer/src/store/taskBoardInspectorStore";
import { type TaskBoardTask } from "../src/renderer/src/features/task-board/taskBoardModel";
import { toDateInputValue } from "../src/renderer/src/shared/date";
const date = (offset = 0) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return toDateInputValue(value);
};
const task = (title: string, extra: Partial<TaskBoardTask> = {}): TaskBoardTask => ({
  id: title,
  title,
  path: "/notes/" + title + ".md",
  relativePath: title + ".md",
  filename: title + ".md",
  isDirectory: false,
  mimeType: "text/markdown",
  status: "open",
  metadataIssues: [],
  ...extra,
});
let store: ReturnType<typeof createStore>;
let actions: {
  openTask: ReturnType<typeof vi.fn<(task: TaskBoardTask) => Promise<void>>>;
  refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;
  projects: { name: string; colorId: string }[];
};
beforeEach(() => {
  store = createStore();
  actions = {
    openTask: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    projects: [{ name: "Research", colorId: "blue" }],
  };
  store.set(taskBoardAgendaActionsAtom, actions);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});
function setup(tasks: TaskBoardTask[], loaded = true) {
  store.set(taskBoardInspectorSnapshotAtom, { tasks, hasLoaded: loaded, isLoading: !loaded, error: null });
  return render(
    <Provider store={store}>
      <AppDndProvider>
        <TaskBoardInspector />
      </AppDndProvider>
    </Provider>,
  );
}

it("keeps today's work visible beyond a large overdue backlog and expands the backlog", () => {
  setup([
    ...Array.from({ length: 12 }, (_, i) => task("Late " + i, { dueDate: date(-i - 1) })),
    task("Due now", { dueDate: date() }),
  ]);
  expect(within(screen.getByRole("region", { name: "Today" })).getByText("Due now")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Overdue" })).getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Show all 12" }));
  expect(within(screen.getByRole("region", { name: "Overdue" })).getAllByRole("listitem")).toHaveLength(12);
});
it("preserves a separate Pinned tasks field and active tab through cold loading", () => {
  const key = "task-board-right-sidebar-widget-stack:dock-layout:1";
  window.localStorage.setItem(
    key,
    JSON.stringify([
      { id: "agenda-pane", tabs: ["task-upcoming"], activeTabId: "task-upcoming", size: 1 },
      { id: "pinned-pane", tabs: ["task-pinned"], activeTabId: "task-pinned", size: 1 },
    ]),
  );
  setup([], false);
  expect(
    screen.getByRole("tab", { name: "Pinned tasks" }).closest("[data-widget-field]")?.getAttribute("data-widget-field"),
  ).toBe("pinned-pane");
  act(() => store.set(taskBoardInspectorSnapshotAtom, { tasks: [], hasLoaded: true, isLoading: false, error: null }));
  expect(screen.getByRole("tab", { name: "Pinned tasks" }).getAttribute("aria-selected")).toBe("true");
  expect(
    JSON.parse(window.localStorage.getItem(key)!).find((pane: { id: string }) => pane.id === "pinned-pane").tabs,
  ).toEqual(["task-pinned"]);
});
it("shows stale-data feedback and retries without removing loaded tasks", async () => {
  setup([task("Current", { dueDate: date() })]);
  act(() => store.set(taskBoardInspectorSnapshotAtom, (value) => value && { ...value, error: "offline" }));
  expect(screen.getByRole("alert").textContent).toContain("last available");
  expect(within(screen.getByRole("tabpanel")).getByText("Current")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(actions.refresh).toHaveBeenCalledOnce());
});
it("reveals a task from its title and opens its note only from the icon", () => {
  const current = task("Navigate", { dueDate: date(), priority: "high", project: "Research", stage: "doing" });
  setup([current]);
  expect(screen.queryByRole("button", { name: "Edit Navigate" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Complete Navigate" })).toBeNull();
  expect(screen.queryByText("All open tasks · all sections")).toBeNull();
  expect(screen.getByText("Research").className).toContain("task-agenda-project");
  expect(screen.getByText("Research").getAttribute("style")).toContain("--task-agenda-project-color");
  expect(screen.getByText("Doing").className).toContain("task-agenda-stage");
  expect(screen.getByText("Doing").getAttribute("style")).toContain("--task-agenda-stage-color");
  expect(screen.getByText("Doing").querySelector(".task-agenda-stage-dot")).toBeTruthy();
  expect(screen.getByText("High")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show task on board: Navigate" }));
  expect(store.get(taskBoardRevealRequestAtom)?.task.path).toBe(current.path);
  expect(openNote).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open task note: Navigate" }));
  expect(actions.openTask).toHaveBeenCalledWith(current);
  expect(openNote).not.toHaveBeenCalled();
});

it("shows active board pins including undated tasks and follows board navigation", () => {
  const pinned = task("Pinned undated", { pinned: true });
  setup([pinned, task("Unpinned"), task("Finished pin", { pinned: true, status: "done" })]);
  fireEvent.click(screen.getByRole("tab", { name: "Pinned tasks" }));
  expect(screen.queryByRole("button", { name: "Show task on board: Unpinned" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Show task on board: Finished pin" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show task on board: Pinned undated" }));
  expect(store.get(taskBoardRevealRequestAtom)?.task.path).toBe(pinned.path);
  fireEvent.click(screen.getByRole("button", { name: "Open task note: Pinned undated" }));
  expect(actions.openTask).toHaveBeenCalledWith(pinned);
  act(() =>
    store.set(taskBoardInspectorSnapshotAtom, (value) => value && { ...value, tasks: [{ ...pinned, pinned: false }] }),
  );
  expect(screen.queryByRole("button", { name: "Show task on board: Pinned undated" })).toBeNull();
});
