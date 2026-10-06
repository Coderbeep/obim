import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskNoteHoverWindow } from "../src/renderer/src/features/task-board/TaskNoteHoverWindow";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { type TaskBoardTask } from "../src/renderer/src/features/task-board/taskBoardModel";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), open: vi.fn(), linked: vi.fn(), menu: vi.fn() }));
vi.mock("../src/renderer/src/features/files/workspaceFileService", () => ({ readTextFile: mocks.read }));
vi.mock("../src/renderer/src/features/files/dirtyFileBuffers", () => ({ saveDirtyFileBuffers: mocks.save }));
vi.mock("../src/renderer/src/features/files/fileActions", () => ({
  useFileOpen: () => ({ open: mocks.open, openLinkedFile: mocks.linked }),
}));
vi.mock("../src/renderer/src/features/files/menus/useFileHeaderMenu", () => ({
  useFileHeaderMenu: () => ({ openFileHeaderMenu: mocks.menu }),
}));
vi.mock("../src/renderer/src/features/editor/ObimEditor", () => ({
  default: ({ filePath }: { filePath: string }) => <div data-testid="obim-editor">{filePath}</div>,
}));
const task: TaskBoardTask = {
  id: "task",
  filename: "Task",
  relativePath: "Task.md",
  path: "/notes/Task.md",
  isDirectory: false,
  mimeType: "text/markdown",
  title: "Task",
  status: "open",
  metadataIssues: [],
};
const pointer = (
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  properties: { pointerId: number; clientX?: number; clientY?: number; button?: number },
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, properties);
  fireEvent(element, event);
};
beforeEach(() => {
  window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
  mocks.read.mockReset().mockResolvedValue({ success: true, content: "# Task\nBody" });
  mocks.save.mockReset().mockResolvedValue({ success: true });
  mocks.open.mockReset().mockResolvedValue(true);
  mocks.menu.mockReset();
});
afterEach(cleanup);
it("saves before dismissing on an outside click and keeps inside clicks open", async () => {
  let finishSave!: (result: { success: boolean }) => void;
  mocks.save.mockImplementation(() => new Promise((resolve) => (finishSave = resolve)));
  const close = vi.fn();
  render(
    <Provider store={createStore()}>
      <TaskNoteHoverWindow request={{ task }} onClose={close} />
    </Provider>,
  );
  const editor = await screen.findByTestId("obim-editor");
  // Radix installs its outside-pointer listener on the next tick.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  fireEvent.pointerDown(editor);
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(close).not.toHaveBeenCalled();
  await act(async () => finishSave({ success: true }));
  expect(close).toHaveBeenCalledOnce();
});

it("keeps the window open while the file-options menu is used", async () => {
  const close = vi.fn();
  render(
    <Provider store={createStore()}>
      <TaskNoteHoverWindow request={{ task }} onClose={close} />
    </Provider>,
  );
  await screen.findByTestId("obim-editor");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const menu = document.createElement("div");
  menu.id = "context-menu";
  document.body.appendChild(menu);
  try {
    fireEvent.pointerDown(menu);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  } finally {
    menu.remove();
  }
});

it("moves from the header, resizes by pointer and keyboard, and leaves header actions clickable", async () => {
  const close = vi.fn();
  render(
    <Provider store={createStore()}>
      <TaskNoteHoverWindow request={{ task }} onClose={close} />
    </Provider>,
  );
  await screen.findByTestId("obim-editor");
  const dialog = screen.getByRole("dialog") as HTMLElement;
  const header = dialog.querySelector("header") as HTMLElement;
  const resize = screen.getByRole("button", { name: "Resize task window" });
  const startX = Number.parseInt(dialog.style.left, 10);
  const startY = Number.parseInt(dialog.style.top, 10);
  pointer(header, "pointerdown", { button: 0, pointerId: 1, clientX: 400, clientY: 100 });
  pointer(header, "pointermove", { pointerId: 1, clientX: 440, clientY: 130 });
  pointer(header, "pointerup", { pointerId: 1 });
  expect(Number.parseInt(dialog.style.left, 10)).toBe(startX + 40);
  expect(Number.parseInt(dialog.style.top, 10)).toBe(startY + 30);

  const startWidth = Number.parseInt(dialog.style.width, 10);
  const startHeight = Number.parseInt(dialog.style.height, 10);
  pointer(resize, "pointerdown", { button: 0, pointerId: 2, clientX: 700, clientY: 600 });
  pointer(resize, "pointermove", { pointerId: 2, clientX: 730, clientY: 620 });
  pointer(resize, "pointerup", { pointerId: 2 });
  expect(Number.parseInt(dialog.style.width, 10)).toBeGreaterThan(startWidth);
  expect(Number.parseInt(dialog.style.height, 10)).toBeGreaterThan(startHeight);
  fireEvent.keyDown(resize, { key: "ArrowLeft" });
  expect(Number.parseInt(dialog.style.width, 10)).toBeLessThan(startWidth + 30);

  pointer(screen.getByRole("button", { name: "Current file options" }), "pointerdown", {
    button: 0,
    pointerId: 3,
    clientX: 800,
    clientY: 100,
  });
  expect(Number.parseInt(dialog.style.left, 10)).toBe(startX + 40);
  expect(close).not.toHaveBeenCalled();
});
it("loads the real editor surface without creating a tab and saves before closing", async () => {
  const store = createStore();
  const close = vi.fn();
  render(
    <Provider store={store}>
      <TaskNoteHoverWindow request={{ task }} onClose={close} />
    </Provider>,
  );
  expect(await screen.findByTestId("obim-editor")).toBeTruthy();
  expect(store.get(fileBuffersByPathAtom)[task.path].editorText).toBe("# Task\nBody");
  expect(mocks.open).not.toHaveBeenCalled();
  const optionsButton = screen.getByRole("button", { name: "Current file options" });
  const openButton = screen.getByRole("button", { name: "Open in tab" });
  const closeButton = screen.getByRole("button", { name: "Close" });
  expect(optionsButton.parentElement).toBe(closeButton.parentElement);
  expect(openButton.parentElement).toBe(closeButton.parentElement);
  expect(openButton.closest("header")?.contains(closeButton)).toBe(true);
  fireEvent.click(optionsButton);
  expect(mocks.menu).toHaveBeenCalledWith(expect.anything(), task);
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(closeButton);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.save).toHaveBeenCalledWith(store, expect.any(Function));
});
it("saves before dismissing with Escape", async () => {
  const close = vi.fn();
  render(
    <Provider store={createStore()}>
      <TaskNoteHoverWindow request={{ task }} onClose={close} />
    </Provider>,
  );
  await screen.findByTestId("obim-editor");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.save).toHaveBeenCalledOnce();
});
it("reuses an unsaved buffer and stays open when saving fails", async () => {
  const store = createStore();
  store.set(fileBuffersByPathAtom, { [task.path]: { savedText: "Old", editorText: "Unsaved" } });
  mocks.save.mockResolvedValue({ success: false, error: "Save failed" });
  const close = vi.fn();
  render(
    <Provider store={store}>
      <TaskNoteHoverWindow request={{ task }} onClose={close} />
    </Provider>,
  );
  await screen.findByTestId("obim-editor");
  expect(mocks.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Save failed");
  expect(close).not.toHaveBeenCalled();
  expect(store.get(fileBuffersByPathAtom)[task.path].editorText).toBe("Unsaved");
  mocks.save.mockResolvedValue({ success: true });
  fireEvent.click(screen.getByRole("button", { name: "Open in tab" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.open).toHaveBeenCalledWith(task);
});
it("offers retry after a failed read and never mounts an empty editor", async () => {
  mocks.read.mockResolvedValueOnce({ success: false, error: "Read failed" });
  render(
    <Provider store={createStore()}>
      <TaskNoteHoverWindow request={{ task }} onClose={() => {}} />
    </Provider>,
  );
  await screen.findByRole("alert");
  expect(screen.queryByTestId("obim-editor")).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
  expect(await screen.findByTestId("obim-editor")).toBeTruthy();
});
