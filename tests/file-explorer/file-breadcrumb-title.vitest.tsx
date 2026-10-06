import { Provider, createStore } from "jotai";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileBreadcrumbTitle } from "../../src/renderer/src/features/files/FileBreadcrumbTitle";
import { fileTreeAtom, renamingRequestAtom } from "../../src/renderer/src/store/fileExplorerStore";
import type { FileItem } from "../../src/shared/file-item";

const state = vi.hoisted(() => ({
  editorView: { dispatch: vi.fn(), focus: vi.fn() },
  findEditor: vi.fn(),
  reveal: vi.fn(),
  openBreadcrumbDirectoryMenu: vi.fn(),
  saveRename: vi.fn(),
  shake: vi.fn(),
  stopRenaming: vi.fn(),
}));

vi.mock("@renderer/features/editor/codemirror-view", () => ({
  EditorView: { findFromDOM: state.findEditor },
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useFileRename: () => ({ saveRename: state.saveRename, stopRenaming: state.stopRenaming }),
}));

vi.mock("@renderer/features/files/useRevealInFileExplorer", () => ({
  useRevealInFileExplorer: () => state.reveal,
}));

vi.mock("@renderer/features/files/menus/useDirectoryMenu", () => ({
  useDirectoryMenu: () => ({ openBreadcrumbDirectoryMenu: state.openBreadcrumbDirectoryMenu }),
}));

vi.mock("@renderer/features/files/shake", () => ({
  shakeElement: state.shake,
}));

const file = (path: string, relativePath: string): FileItem => ({
  id: path,
  filename:
    relativePath
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/, "") ?? "",
  relativePath,
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const renderBreadcrumb = (item: FileItem, isPaneActive = true) => {
  const store = createStore();
  const result = render(
    <Provider store={store}>
      <div className="pane-card pane-card-active">
        <button type="button">Editor target</button>
        <FileBreadcrumbTitle key={item.path} file={item} isPaneActive={isPaneActive} />
        <div className="cm-editor" />
      </div>
    </Provider>,
  );
  return { ...result, store };
};

describe("FileBreadcrumbTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.findEditor.mockReturnValue(state.editorView);
    state.saveRename.mockResolvedValue({ success: true });
  });

  afterEach(() => cleanup());

  it("resets an unfinished rename when the keyed file changes", () => {
    const first = file("/notes/first.md", "first.md");
    const second = file("/notes/second.md", "second.md");
    const { rerender, store } = renderBreadcrumb(first);

    fireEvent.click(screen.getByRole("button", { name: "first" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rename current file" }), {
      target: { value: "unfinished" },
    });

    rerender(
      <Provider store={store}>
        <div className="pane-card pane-card-active">
          <FileBreadcrumbTitle key={second.path} file={second} isPaneActive />
        </div>
      </Provider>,
    );

    expect(screen.queryByRole("textbox", { name: "Rename current file" })).toBeNull();
    expect(screen.getByRole("button", { name: "second" })).toBeTruthy();
  });

  it("starts from F2 only in the active pane", () => {
    const item = file("/notes/note.md", "note.md");
    const { rerender, store } = renderBreadcrumb(item, false);

    fireEvent.keyDown(screen.getByRole("button", { name: "Editor target" }), { key: "F2" });
    expect(screen.queryByRole("textbox", { name: "Rename current file" })).toBeNull();

    rerender(
      <Provider store={store}>
        <div className="pane-card pane-card-active">
          <button type="button">Editor target</button>
          <FileBreadcrumbTitle key={item.path} file={item} isPaneActive />
        </div>
      </Provider>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Editor target" }), { key: "F2" });

    expect(screen.getByRole("textbox", { name: "Rename current file" })).toBeTruthy();
  });

  it("submits valid titles and rejects invalid ones", async () => {
    const item = file("/notes/note.md", "note.md");
    renderBreadcrumb(item);

    fireEvent.click(screen.getByRole("button", { name: "note" }));
    const input = screen.getByRole("textbox", { name: "Rename current file" });
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(state.saveRename).toHaveBeenCalledWith(item.path, "renamed"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Rename current file" })).toBeNull());
    expect(state.editorView.dispatch).not.toHaveBeenCalled();
    expect(state.editorView.focus).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "note" }));
    const invalidInput = screen.getByRole("textbox", { name: "Rename current file" });
    fireEvent.change(invalidInput, { target: { value: "bad/name" } });
    fireEvent.keyDown(invalidInput, { key: "Enter" });

    expect(state.saveRename).toHaveBeenCalledTimes(1);
    expect(state.shake).toHaveBeenCalledWith(invalidInput);
  });

  it("cancels on Escape or blur and consumes targeted rename requests", () => {
    const item = file("/notes/note.md", "Folder/note.md");
    const { store } = renderBreadcrumb(item);

    act(() => store.set(renamingRequestAtom, { filePath: item.path, target: "file-header" }));
    expect(screen.getByRole("textbox", { name: "Rename current file" })).toBeTruthy();
    expect(state.stopRenaming).toHaveBeenCalledWith(item.path);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rename current file" }), { key: "Escape" });
    act(() => store.set(renamingRequestAtom, null));
    fireEvent.click(screen.getByRole("button", { name: "note" }));
    fireEvent.blur(screen.getByRole("textbox", { name: "Rename current file" }));

    expect(screen.queryByRole("textbox", { name: "Rename current file" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Folder" }));
    expect(state.reveal).toHaveBeenCalledWith("Folder");
  });

  it("opens the Explorer directory menu for a folder breadcrumb", () => {
    const item = file("/notes/Folder/note.md", "Folder/note.md");
    const folder: FileItem = {
      id: "folder",
      filename: "Folder",
      relativePath: "Folder",
      path: "/notes/Folder",
      isDirectory: true,
      mimeType: null,
      children: [item],
    };
    const { store } = renderBreadcrumb(item);
    act(() => store.set(fileTreeAtom, [folder]));

    fireEvent.contextMenu(screen.getByRole("button", { name: "Folder" }));

    expect(state.openBreadcrumbDirectoryMenu).toHaveBeenCalledWith(expect.anything(), folder);
  });
});
