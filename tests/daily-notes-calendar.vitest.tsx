import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { FileItem } from "../src/shared/file-item";
import { activePaneIdAtom, workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { notificationsAtom, NotificationLevel } from "../src/renderer/src/store/NotificationsStore";
import { fileTreeAtom } from "../src/renderer/src/store/fileExplorerStore";
import { createFileWorkspaceItemKey } from "../src/shared/workspace";

const workspace = vi.hoisted(() => ({
  discoveredTasks: [] as import("../src/renderer/src/features/task-board/taskBoardModel").TaskBoardTask[],
  error: null,
  isLoading: false,
}));
vi.mock("../src/renderer/src/features/task-board/taskBoardWorkspace", () => ({
  useTaskBoardWorkspace: () => workspace,
}));

const fileActions = vi.hoisted(() => ({
  createMarkdownFile: vi.fn(),
  open: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../src/renderer/src/features/files/fileActions", () => ({
  useFileCreate: () => ({ createMarkdownFile: fileActions.createMarkdownFile }),
  useFileOpen: () => ({ open: fileActions.open }),
  useFileRemove: () => ({ remove: fileActions.remove }),
}));

import { DailyNotesCalendar } from "../src/renderer/src/features/daily-notes/DailyNotesCalendar";

const dailyNote: FileItem = {
  id: "daily-2026-09-16",
  filename: "2026-09-16",
  relativePath: "Journal/2026-09-16.md",
  path: "/notes/Journal/2026-09-16.md",
  isDirectory: false,
  mimeType: "text/markdown",
};

beforeEach(() => {
  workspace.discoveredTasks = [];
  fileActions.createMarkdownFile.mockResolvedValue(null);
  fileActions.open.mockResolvedValue(true);
  fileActions.remove.mockResolvedValue(true);
  window.config = {
    getMainDirectoryPathSync: () => "/notes",
    getConfigValue: vi.fn(async (key: string) => {
      if (key === "dailyNoteCreationDirectory") return "Journal";
      throw new Error(`Missing config value: ${key}`);
    }),
  } as unknown as Window["config"];
});

afterEach(() => {
  cleanup();
});

it("marks and opens existing notes, and creates missing dates", async () => {
  const store = createStore();
  store.set(fileTreeAtom, [dailyNote]);

  render(
    <Provider store={store}>
      <DailyNotesCalendar initialMonth={new Date(2026, 8, 2)} />
    </Provider>,
  );

  expect(screen.getByRole("region", { name: "Calendar" })).toBeTruthy();
  const september16 = screen.getByRole("button", { name: /Wednesday, September 16/u });
  await waitFor(() => expect(september16.closest(".rdp-day")?.classList.contains("daily-note-exists")).toBe(true));
  expect(document.querySelector(".daily-notes-calendar")?.classList.contains("task-calendar")).toBe(true);
  expect(screen.queryByText("Select a day to open or create its note.")).toBeNull();

  fireEvent.click(september16);
  await waitFor(() =>
    expect(fileActions.open).toHaveBeenCalledWith(dailyNote, { focusEditor: true, openInNewTab: true }),
  );

  expect(store.get(notificationsAtom)).toEqual([]);
  fileActions.createMarkdownFile.mockResolvedValueOnce({
    ...dailyNote,
    filename: "2026-09-17.md",
    relativePath: "Journal/2026-09-17.md",
    path: "/notes/Journal/2026-09-17.md",
  });
  fireEvent.click(screen.getByRole("button", { name: /Thursday, September 17/u }));
  await waitFor(() =>
    expect(fileActions.createMarkdownFile).toHaveBeenCalledWith(
      "/notes/Journal",
      "2026-09-17.md",
      "# Thursday, September 17, 2026\n\n",
      true,
      { openInNewTab: true },
    ),
  );
  await waitFor(() => expect(store.get(notificationsAtom)).toHaveLength(1));
  const notification = store.get(notificationsAtom)[0];
  expect(notification).toMatchObject({
    level: NotificationLevel.INFO,
    title: "Daily note created",
    message: "Created Journal/2026-09-17.md.",
    path: "/notes/Journal/2026-09-17.md",
    action: { label: "Undo" },
    timeout: 8000,
  });
  await notification.action?.onClick();
  expect(fileActions.remove).toHaveBeenCalledWith({
    ...dailyNote,
    filename: "2026-09-17.md",
    relativePath: "Journal/2026-09-17.md",
    path: "/notes/Journal/2026-09-17.md",
  });
});

it("activates an existing daily-note tab before opening the file again", async () => {
  const store = createStore();
  const dailyTab = createEditorTab("daily-tab", createFileWorkspaceItemKey(dailyNote.path));
  store.set(fileTreeAtom, [dailyNote]);
  store.set(workspacePanesAtom, [
    { id: "pane-1", tabs: [], activeTabId: null, size: 1 },
    { id: "pane-2", tabs: [dailyTab.id], activeTabId: dailyTab.id, size: 1 },
  ]);
  store.set(workspaceTabsByIdAtom, { [dailyTab.id]: dailyTab });

  render(
    <Provider store={store}>
      <DailyNotesCalendar initialMonth={new Date(2026, 8, 2)} />
    </Provider>,
  );

  const september16 = screen.getByRole("button", { name: /Wednesday, September 16/u });
  await waitFor(() => expect(september16.closest(".rdp-day")?.classList.contains("daily-note-exists")).toBe(true));
  fireEvent.click(september16);

  expect(store.get(activePaneIdAtom)).toBe("pane-2");
  expect(fileActions.open).not.toHaveBeenCalled();
});

it("coalesces repeated clicks while a daily note is opening", async () => {
  let finishOpen!: (opened: boolean) => void;
  fileActions.open.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finishOpen = resolve;
      }),
  );
  const store = createStore();
  store.set(fileTreeAtom, [dailyNote]);

  render(
    <Provider store={store}>
      <DailyNotesCalendar initialMonth={new Date(2026, 8, 2)} />
    </Provider>,
  );

  const september16 = screen.getByRole("button", { name: /Wednesday, September 16/u });
  await waitFor(() => expect(september16.closest(".rdp-day")?.classList.contains("daily-note-exists")).toBe(true));
  fireEvent.click(september16);
  fireEvent.click(september16);
  fireEvent.click(september16);

  expect(fileActions.open).toHaveBeenCalledOnce();
  await act(async () => finishOpen(true));
});

it("does not announce creation when creating the daily note fails or is cancelled", async () => {
  const store = createStore();
  render(
    <Provider store={store}>
      <DailyNotesCalendar initialMonth={new Date(2026, 8, 2)} />
    </Provider>,
  );
  const day = screen.getByRole("button", { name: /Thursday, September 17/u });
  await waitFor(() => expect(day.hasAttribute("disabled")).toBe(false));
  await act(async () => fireEvent.click(day));
  expect(fileActions.createMarkdownFile).toHaveBeenCalled();
  expect(store.get(notificationsAtom)).toEqual([]);
});

it("shows live due-task counts and opens tasks independently of daily notes", async () => {
  const task = {
    ...dailyNote,
    path: "/notes/task.md",
    relativePath: "task.md",
    title: "Ship calendar",
    status: "open" as const,
    dueDate: "2026-09-16",
    metadataIssues: [],
  };
  workspace.discoveredTasks = [
    task,
    { ...task, path: "/notes/done.md", status: "done" },
    { ...task, path: "/notes/undated.md", dueDate: undefined },
  ];
  const store = createStore();
  store.set(fileTreeAtom, [dailyNote]);
  const view = render(
    <Provider store={store}>
      <DailyNotesCalendar initialMonth={new Date(2026, 8, 2)} />
    </Provider>,
  );
  const day = await screen.findByRole("button", { name: /Wednesday, September 16.*1 open task due/u });
  await waitFor(() => expect(day.hasAttribute("disabled")).toBe(false));
  expect(day.title).toContain("Ship calendar");
  expect(day.querySelector(".daily-note-task-count")?.textContent).toBe("1");
  fireEvent.click(day);
  fireEvent.click(screen.getByRole("button", { name: "Ship calendar" }));
  await waitFor(() => expect(fileActions.open).toHaveBeenCalledWith(task, { focusEditor: true, openInNewTab: true }));
  workspace.discoveredTasks = [{ ...task, dueDate: "2026-09-17" }];
  view.rerender(
    <Provider store={store}>
      <DailyNotesCalendar initialMonth={new Date(2026, 8, 2)} />
    </Provider>,
  );
  expect(day.querySelector(".daily-note-task-count")).toBeNull();
  expect(screen.getByRole("button", { name: /Thursday, September 17.*1 open task due/u })).toBeTruthy();
  expect(screen.getByText("No open tasks due.")).toBeTruthy();
});
