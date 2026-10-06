import type { LinkStatusPort } from "../src/renderer/src/features/editor/extensions/shared/linkStatus";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { editorHeadingRequestAtom } from "../src/renderer/src/store/editorPaneStore";
import { Provider, createStore } from "jotai";
import { createElement, useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const codeMirrorState = vi.hoisted(() => {
  const editorView = { dispatch: vi.fn(), focus: vi.fn() };
  return {
    editorView,
    createNoteHeaderExtension: vi.fn<
      (
        title: string,
        onRenameTitle?: (nextTitle: string) => Promise<boolean>,
        onTitleEditRequestStarted?: () => void,
      ) => never[]
    >(() => []),
    createEditorExtensions: vi.fn<
      (parts: {
        openResource: (destination: string) => void | Promise<void>;
        openWikiResource?: (destination: string) => void | Promise<void>;
        canonicalizeWikiResource?: (destination: string) => string;
        linkStatus?: LinkStatusPort;
        imageActions?: {
          resolveSource(src: string, syntax: "markdown" | "wiki"): string | null;
        };
      }) => never[]
    >(() => []),
    navigateToHeading: vi.fn(() => true),
    findFromDOM: vi.fn(() => editorView),
    nextInstanceId: 0,
    onChange: undefined as ((value: string) => void) | undefined,
    openSearchPanel: vi.fn(),
    requestNoteTitleEditEffect: { of: vi.fn((value: number) => ({ requestNoteTitleEdit: value })) },
  };
});

const fileActionState = vi.hoisted(() => ({
  saveRename: vi.fn(async () => ({ success: true as const, newPath: "/notes/renamed.md" })),
  stopRenaming: vi.fn(),
}));

const workspaceFileState = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock("../src/renderer/src/features/editor/headingNavigation", () => ({
  navigateToHeading: codeMirrorState.navigateToHeading,
}));

vi.mock("@codemirror/search", () => ({ openSearchPanel: codeMirrorState.openSearchPanel }));

vi.mock("@renderer/features/editor/codemirror-view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@renderer/features/editor/codemirror-view")>();
  return {
    ...actual,
    EditorView: new Proxy(actual.EditorView, {
      get(target, property, receiver) {
        return property === "findFromDOM" ? codeMirrorState.findFromDOM : Reflect.get(target, property, receiver);
      },
    }),
  };
});

vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    theme,
    value,
    onChange,
    onCreateEditor,
  }: {
    theme: string;
    value: string;
    onChange(value: string): void;
    onCreateEditor(view: typeof codeMirrorState.editorView): void;
  }) => {
    const instanceId = useRef(++codeMirrorState.nextInstanceId);
    codeMirrorState.onChange = onChange;
    useEffect(() => onCreateEditor(codeMirrorState.editorView), [onCreateEditor]);
    return createElement("div", {
      className: "cm-editor",
      "data-testid": "code-mirror",
      "data-instance-id": instanceId.current,
      "data-theme": theme,
      "data-value": value,
    });
  },
}));

vi.mock("../src/renderer/src/features/editor/setup", () => ({
  createEditorExtensions: codeMirrorState.createEditorExtensions,
  resetEditorHistory: vi.fn(),
}));

vi.mock("../src/renderer/src/features/editor/extensions/NoteHeaderExtension", () => ({
  createNoteHeaderExtension: codeMirrorState.createNoteHeaderExtension,
  requestNoteTitleEditEffect: codeMirrorState.requestNoteTitleEditEffect,
}));

vi.mock("@renderer/features/files/fileActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/renderer/src/features/files/fileActions")>()),
  useFileRename: () => ({ saveRename: fileActionState.saveRename, stopRenaming: fileActionState.stopRenaming }),
}));

vi.mock("../src/renderer/src/features/files/workspaceFileService", () => ({
  readTextFile: workspaceFileState.readTextFile,
  saveFile: workspaceFileState.saveFile,
}));

import { createWorkspaceItemViews } from "../src/renderer/src/app/workspaceItemViews";
import { editorFocusRequestAtom } from "../src/renderer/src/store/editorPaneStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { fileTreeAtom, renamingRequestAtom } from "../src/renderer/src/store/fileExplorerStore";
import { fileConflictReviewRequestAtom, fileSaveStatesByPathAtom } from "../src/renderer/src/store/fileSaveStore";
import { NotificationLevel, notificationsAtom } from "../src/renderer/src/store/NotificationsStore";
import { createFileWorkspaceItem } from "../src/shared/workspace";
import type { FileItem } from "../src/shared/file-item";

const file = (path: string): Extract<FileItem, { isDirectory: false }> => ({
  id: path,
  filename: path.split("/").at(-1) ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  sizeBytes: 10,
  isDirectory: false,
  mimeType: "text/markdown",
});

const originalConfig = window.config;
beforeEach(() => {
  window.config = { ...originalConfig, getMainDirectoryPathSync: () => "/notes" };
  workspaceFileState.readTextFile.mockReset();
  workspaceFileState.saveFile
    .mockReset()
    .mockResolvedValue({ success: true, version: { id: "saved", mtimeMs: 200, sizeBytes: 5 } });
  codeMirrorState.navigateToHeading.mockReset().mockReturnValue(true);
  codeMirrorState.onChange = undefined;
  codeMirrorState.editorView.dispatch.mockClear();
  codeMirrorState.editorView.focus.mockClear();
  codeMirrorState.createEditorExtensions.mockClear();
  fileActionState.stopRenaming.mockClear();
});

afterEach(() => {
  cleanup();
  window.config = originalConfig;
  vi.useRealTimers();
});

describe("ObimEditor lifecycle", () => {
  it("consumes a section request once the destination editor is mounted", async () => {
    const item = file("/notes/target.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, { [item.path]: { savedText: "# Target", editorText: "# Target" } });
    store.set(editorHeadingRequestAtom, { filePath: item.path, paneId: "pane-1", fragment: "#target", revision: 1 });
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });
    render(<Provider store={store}>{views.file.render(createFileWorkspaceItem(item), "pane-1")}</Provider>);
    await screen.findByTestId("code-mirror");
    expect(codeMirrorState.navigateToHeading).toHaveBeenCalledTimes(1);
    expect(codeMirrorState.navigateToHeading).toHaveBeenCalledWith(codeMirrorState.editorView, "#target");
    expect(store.get(editorHeadingRequestAtom)).toBeNull();
  });

  it("passes an inline note-title rename through the existing file action", async () => {
    const item = file("/notes/note.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [item.path]: { savedText: "body", editorText: "body" },
    });
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    render(<Provider store={store}>{views.file.render(createFileWorkspaceItem(item), "pane-1")}</Provider>);
    expect((await screen.findByTestId("code-mirror")).getAttribute("data-theme")).toBe("none");
    const [title, renameTitle] = codeMirrorState.createNoteHeaderExtension.mock.lastCall ?? [];

    expect(title).toBe("note");
    await expect(renameTitle?.("renamed")).resolves.toBe(true);
    expect(fileActionState.saveRename).toHaveBeenCalledWith(item.path, "renamed");
  });

  it("routes a new-note rename request to the note header once", async () => {
    const item = file("/notes/Untitled 1.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [item.path]: { savedText: "", editorText: "" },
    });
    store.set(renamingRequestAtom, { filePath: item.path, target: "note-header" });
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    render(<Provider store={store}>{views.file.render(createFileWorkspaceItem(item), "pane-1")}</Provider>);

    await waitFor(() => expect(codeMirrorState.editorView.dispatch).toHaveBeenCalledTimes(1));
    expect(codeMirrorState.editorView.dispatch).toHaveBeenCalledWith({ effects: { requestNoteTitleEdit: 1 } });
    const [, , onTitleEditRequestStarted] = codeMirrorState.createNoteHeaderExtension.mock.lastCall ?? [];
    onTitleEditRequestStarted?.();
    expect(fileActionState.stopRenaming).toHaveBeenCalledWith(item.path);
  });

  it("focuses the matching editor when opening a note from the Explorer", async () => {
    const item = file("/notes/note.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [item.path]: { savedText: "body", editorText: "body" },
    });
    store.set(editorFocusRequestAtom, { filePath: item.path, paneId: "pane-1", revision: 1 });
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    render(<Provider store={store}>{views.file.render(createFileWorkspaceItem(item), "pane-1")}</Provider>);
    const editor = await screen.findByTestId("code-mirror");

    await waitFor(() => {
      expect(codeMirrorState.findFromDOM).toHaveBeenCalledWith(editor);
      expect(codeMirrorState.editorView.focus).toHaveBeenCalledOnce();
    });
  });

  it("keeps the CodeMirror instance mounted when the active file changes", async () => {
    const first = file("/notes/first.md");
    const second = file("/notes/second.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [first.path]: { savedText: "first", editorText: "first" },
      [second.path]: { savedText: "second", editorText: "second" },
    });
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });
    const renderEditor = (selected: typeof first) => views.file.render(createFileWorkspaceItem(selected), "pane-1");

    const { rerender } = render(<Provider store={store}>{renderEditor(first)}</Provider>);
    const editor = await screen.findByTestId("code-mirror");
    const instanceId = editor.getAttribute("data-instance-id");

    rerender(<Provider store={store}>{renderEditor(second)}</Provider>);

    expect(screen.getByTestId("code-mirror")).toBe(editor);
    expect(screen.getByTestId("code-mirror").getAttribute("data-instance-id")).toBe(instanceId);
    expect(screen.getByTestId("code-mirror").getAttribute("data-value")).toBe("second");
  });

  it("routes fragment links to its own editor and leaves file links with the file opener", async () => {
    const item = file("/notes/note.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, { [item.path]: { savedText: "## Tasks", editorText: "## Tasks" } });
    const openLinkedFile = vi.fn();
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile,
      resolveWorkspaceItem: vi.fn(),
    });
    render(<Provider store={store}>{views.file.render(createFileWorkspaceItem(item), "pane-1")}</Provider>);
    await screen.findByTestId("code-mirror");
    const open = codeMirrorState.createEditorExtensions.mock.lastCall![0].openResource;
    await act(async () => open("#tasks"));
    expect(codeMirrorState.navigateToHeading).toHaveBeenCalledWith(codeMirrorState.editorView, "#tasks");
    expect(openLinkedFile).not.toHaveBeenCalled();
    await act(async () => open("Other.md"));
    expect(openLinkedFile).toHaveBeenCalled();
    codeMirrorState.navigateToHeading.mockReturnValueOnce(false);
    await act(async () => open("#missing"));
    expect(store.get(notificationsAtom).at(-1)?.title).toBe("Section not found");
  });

  it("canonicalizes and resolves wiki note links through the workspace tree", async () => {
    const item = file("/notes/current.md");
    const unique = file("/notes/Folder/Architectures.md");
    const duplicateA = file("/notes/A/Review.md");
    const duplicateB = file("/notes/B/Review.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, { [item.path]: { savedText: "", editorText: "" } });
    store.set(fileTreeAtom, [item, unique, duplicateA, duplicateB]);
    const openLinkedFile = vi.fn();
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile,
      resolveWorkspaceItem: vi.fn(),
    });
    render(<Provider store={store}>{views.file.render(createFileWorkspaceItem(item), "pane-1")}</Provider>);
    await screen.findByTestId("code-mirror");
    const options = codeMirrorState.createEditorExtensions.mock.lastCall![0];

    expect(options.canonicalizeWikiResource?.("Folder/Architectures.md")).toBe("Architectures");
    expect(options.canonicalizeWikiResource?.("A/Review.md")).toBe("A/Review");
    await act(async () => options.openWikiResource?.("Architectures#overview"));
    expect(openLinkedFile).toHaveBeenCalledWith("Folder/Architectures.md#overview", item.path);
    await act(async () => options.openWikiResource?.("#local-heading"));
    expect(codeMirrorState.navigateToHeading).toHaveBeenCalledWith(codeMirrorState.editorView, "#local-heading");
  });

  it("supplies current link status and tree subscriptions without reconfiguring the editor", async () => {
    const item = file("/notes/current.md");
    const match = file("/notes/A/Review.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, { [item.path]: { savedText: "", editorText: "" } });
    store.set(fileTreeAtom, [item, match, file("/notes/B/Review.md")]);
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });
    render(<Provider store={store}>{views.file.render(createFileWorkspaceItem(item), "pane-1")}</Provider>);
    await screen.findByTestId("code-mirror");
    const port = codeMirrorState.createEditorExtensions.mock.lastCall![0].linkStatus!;
    const configurations = codeMirrorState.createEditorExtensions.mock.calls.length;
    const listener = vi.fn();
    const unsubscribe = port.subscribe(listener);
    expect(port.resolve("Review", "wiki")).toMatchObject({ status: "ambiguous", matches: 2 });
    await act(async () => store.set(fileTreeAtom, [item, match]));
    expect(listener).toHaveBeenCalledOnce();
    expect(port.resolve("Review", "wiki").status).toBe("resolved");
    expect(codeMirrorState.createEditorExtensions).toHaveBeenCalledTimes(configurations);
    unsubscribe();
    await act(async () => store.set(fileTreeAtom, [item]));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps editor extensions configured when the same pane renders again", async () => {
    const item = file("/notes/note.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [item.path]: { savedText: "body", editorText: "body" },
    });
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });
    const renderEditor = () => views.file.render(createFileWorkspaceItem(item), "pane-1");

    const { rerender } = render(<Provider store={store}>{renderEditor()}</Provider>);
    await screen.findByTestId("code-mirror");
    expect(codeMirrorState.createEditorExtensions).toHaveBeenCalledTimes(1);

    rerender(<Provider store={store}>{renderEditor()}</Provider>);

    expect(codeMirrorState.createEditorExtensions).toHaveBeenCalledTimes(1);
  });

  it("keeps editor extensions configured when the workspace tree refreshes", async () => {
    const item = file("/notes/note.md");
    const image = {
      ...file("/notes/image.png"),
      mimeType: "image/png",
    };
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [item.path]: { savedText: "body", editorText: "body" },
    });
    store.set(fileTreeAtom, [item, image]);
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    render(<Provider store={store}>{views.file.render(createFileWorkspaceItem(item), "pane-1")}</Provider>);
    await screen.findByTestId("code-mirror");
    expect(codeMirrorState.createEditorExtensions).toHaveBeenCalledTimes(1);
    const imageActions = codeMirrorState.createEditorExtensions.mock.lastCall?.[0].imageActions;
    expect(imageActions?.resolveSource("image.png", "wiki")).toBe("image.png");

    act(() => {
      store.set(fileTreeAtom, [
        { ...item, version: { id: "saved", mtimeMs: 200, sizeBytes: 4 } },
        { ...image, id: "/notes/assets/image.png", path: "/notes/assets/image.png", relativePath: "assets/image.png" },
      ]);
    });

    expect(codeMirrorState.createEditorExtensions).toHaveBeenCalledTimes(1);
    expect(imageActions?.resolveSource("image.png", "wiki")).toBe("assets/image.png");
  });

  it("keeps a failed autosave dirty and reports a repeated path error once", async () => {
    const item = file("/notes/note.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [item.path]: { savedText: "saved", editorText: "saved" },
    });
    workspaceFileState.saveFile.mockResolvedValue({ success: false, error: "disk full" });
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    render(<Provider store={store}>{views.file.render(createFileWorkspaceItem(item), "pane-1")}</Provider>);
    await screen.findByTestId("code-mirror");
    vi.useFakeTimers();

    await act(async () => {
      codeMirrorState.onChange?.("draft");
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(workspaceFileState.saveFile).toHaveBeenCalledWith(item.path, "draft");
    expect(store.get(fileBuffersByPathAtom)[item.path]).toEqual({ savedText: "saved", editorText: "draft" });
    expect(store.get(notificationsAtom)).toHaveLength(1);
    expect(store.get(notificationsAtom)[0]).toMatchObject({
      level: NotificationLevel.ERROR,
      title: "Could not save note",
      path: item.path,
      message: "disk full",
    });

    await act(async () => {
      codeMirrorState.onChange?.("draft");
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(workspaceFileState.saveFile).toHaveBeenCalledTimes(2);
    expect(store.get(notificationsAtom)).toHaveLength(1);
  });

  it("advances the saved version when the editor changes during an autosave", async () => {
    const item = file("/notes/note.md");
    const openedVersion = { id: "opened", mtimeMs: 100, sizeBytes: 5 };
    const firstSavedVersion = { id: "first-save", mtimeMs: 200, sizeBytes: 11 };
    const secondSavedVersion = { id: "second-save", mtimeMs: 300, sizeBytes: 12 };
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [item.path]: { savedText: "saved", editorText: "saved", version: openedVersion },
    });
    let finishFirstSave!: (result: { success: true; version: typeof firstSavedVersion }) => void;
    workspaceFileState.saveFile
      .mockReturnValueOnce(new Promise((resolve) => (finishFirstSave = resolve)))
      .mockResolvedValueOnce({ success: true, version: secondSavedVersion });
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    render(<Provider store={store}>{views.file.render(createFileWorkspaceItem(item), "pane-1")}</Provider>);
    await screen.findByTestId("code-mirror");
    vi.useFakeTimers();

    act(() => codeMirrorState.onChange?.("first draft"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(workspaceFileState.saveFile).toHaveBeenCalledWith(item.path, "first draft", openedVersion);

    act(() => codeMirrorState.onChange?.("second draft"));
    await act(async () => {
      finishFirstSave({ success: true, version: firstSavedVersion });
      await Promise.resolve();
    });

    expect(store.get(fileBuffersByPathAtom)[item.path]).toEqual({
      savedText: "first draft",
      editorText: "second draft",
      version: firstSavedVersion,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(workspaceFileState.saveFile).toHaveBeenNthCalledWith(2, item.path, "second draft", firstSavedVersion);
    expect(store.get(fileBuffersByPathAtom)[item.path]).toEqual({
      savedText: "second draft",
      editorText: "second draft",
      version: secondSavedVersion,
    });
    expect(store.get(notificationsAtom)).toHaveLength(0);
  });

  it("keeps conflicting edits safe until the user explicitly reviews both versions", async () => {
    const item = file("/notes/note.md");
    const openedVersion = { id: "opened", mtimeMs: 100, sizeBytes: 5 };
    const externalVersion = { id: "external", mtimeMs: 300, sizeBytes: 8 };
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [item.path]: { savedText: "saved", editorText: "saved", version: openedVersion },
    });
    workspaceFileState.saveFile.mockResolvedValue({
      success: false,
      error: "File changed on disk before it could be saved",
      errorCode: "conflict",
    });
    workspaceFileState.readTextFile.mockResolvedValue({
      success: true,
      content: "external",
      version: externalVersion,
    });
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    render(<Provider store={store}>{views.file.render(createFileWorkspaceItem(item), "pane-1")}</Provider>);
    await screen.findByTestId("code-mirror");
    vi.useFakeTimers();

    await act(async () => {
      codeMirrorState.onChange?.("draft");
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(workspaceFileState.saveFile).toHaveBeenCalledWith(item.path, "draft", openedVersion);
    expect(store.get(fileBuffersByPathAtom)[item.path]).toEqual({
      savedText: "saved",
      editorText: "draft",
      version: openedVersion,
    });
    const conflict = store.get(notificationsAtom).at(-1);
    expect(conflict).toMatchObject({
      level: NotificationLevel.WARNING,
      title: "Note changed on disk",
      path: item.path,
      timeout: 0,
      action: { label: "Review conflict" },
    });
    expect(store.get(fileSaveStatesByPathAtom)[item.path]?.phase).toBe("conflict");

    await act(async () => conflict?.action?.onClick());

    expect(store.get(fileConflictReviewRequestAtom)).toEqual({ path: item.path });
    expect(workspaceFileState.readTextFile).not.toHaveBeenCalled();
    expect(store.get(fileBuffersByPathAtom)[item.path]).toEqual({
      savedText: "saved",
      editorText: "draft",
      version: openedVersion,
    });
  });

  it("opens editor find from non-input controls in the surrounding pane", async () => {
    const item = file("/notes/note.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [item.path]: { savedText: "body", editorText: "body" },
    });
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    render(
      <Provider store={store}>
        <div className="pane-column">
          <button type="button">Pane header</button>
          <input aria-label="Filename" />
          {views.file.render(createFileWorkspaceItem(item), "pane-1")}
        </div>
      </Provider>,
    );

    const editor = await screen.findByTestId("code-mirror");
    fireEvent.keyDown(screen.getByRole("button", { name: "Pane header" }), { key: "f", ctrlKey: true });

    expect(codeMirrorState.findFromDOM).toHaveBeenCalledWith(editor);
    expect(codeMirrorState.openSearchPanel).toHaveBeenCalledWith(codeMirrorState.editorView);

    codeMirrorState.openSearchPanel.mockClear();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Filename" }), { key: "f", ctrlKey: true });
    expect(codeMirrorState.openSearchPanel).not.toHaveBeenCalled();
  });
});
