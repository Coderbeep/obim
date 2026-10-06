import { Provider, createStore } from "jotai";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBookmarkMenu } from "../../src/renderer/src/features/files/menus/useBookmarkMenu";
import { useDirectoryMenu } from "../../src/renderer/src/features/files/menus/useDirectoryMenu";
import { useFileHeaderMenu } from "../../src/renderer/src/features/files/menus/useFileHeaderMenu";
import { useFileMenu } from "../../src/renderer/src/features/files/menus/useFileMenu";
import { workspacePanesAtom } from "../../src/renderer/src/store/editorPaneStore";
import { bookmarksAtom } from "../../src/renderer/src/store/bookmarkStore";
import { explorerSelectionPathsAtom, fileTreeAtom } from "../../src/renderer/src/store/fileExplorerStore";
import type { ContextMenuEntry } from "../../src/renderer/src/shared/contextMenu";
import { contextMenuRequestAtom } from "../../src/renderer/src/store/contextMenuStore";
import { openWorkspaceItemsByKeyAtom } from "../../src/renderer/src/store/workspaceResourceStore";
import type { FileItem } from "../../src/shared/file-item";
import { actionRunnerRequestAtom } from "../../src/renderer/src/store/actionRunnerStore";
import { notificationsAtom } from "../../src/renderer/src/store/NotificationsStore";

const state = vi.hoisted(() => ({
  addBookmark: vi.fn(),
  addBookmarks: vi.fn(),
  reconcilePasteAvailability: vi.fn(),
  copyAbsolutePaths: vi.fn(),
  copyItems: vi.fn(),
  copyManyToDirectory: vi.fn(),
  copyRelativePaths: vi.fn(),
  createDirectory: vi.fn(),
  createNewFile: vi.fn(),
  open: vi.fn(),
  openInDefaultApp: vi.fn(),
  moveManyToDirectory: vi.fn(),
  pasteSystemClipboard: vi.fn(),
  remove: vi.fn(),
  removeBookmark: vi.fn(),
  removeBookmarks: vi.fn(),
  removeMany: vi.fn(),
  reveal: vi.fn(),
  startRenaming: vi.fn(),
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useDirectoryCreate: () => ({ createDirectory: state.createDirectory }),
  useFileCreate: () => ({ createNewFile: state.createNewFile }),
  useFileCopy: () => ({ copyManyToDirectory: state.copyManyToDirectory }),
  useFileMove: () => ({ moveManyToDirectory: state.moveManyToDirectory }),
  useFileOpen: () => ({ open: state.open }),
  useFileRemove: () => ({ remove: state.remove, removeMany: state.removeMany }),
  useFileRename: () => ({ startRenaming: state.startRenaming }),
  useManageFileBookmark: () => ({
    addBookmark: state.addBookmark,
    addBookmarks: state.addBookmarks,
    removeBookmark: state.removeBookmark,
    removeBookmarks: state.removeBookmarks,
  }),
}));

vi.mock("@renderer/features/files/workspaceFileService", () => ({
  openInDefaultApp: state.openInDefaultApp,
  revealInSystemFileManager: state.reveal,
}));

vi.mock("@renderer/features/files/useFileClipboard", () => ({
  useFileClipboard: () => ({
    reconcilePasteAvailability: state.reconcilePasteAvailability,
    copyAbsolutePaths: state.copyAbsolutePaths,
    copyItems: state.copyItems,
    copyRelativePaths: state.copyRelativePaths,
    pasteSystemClipboard: state.pasteSystemClipboard,
  }),
}));

vi.mock("@renderer/features/workspace/usePaneWorkspace", () => ({
  createNewPaneId: () => "new-pane",
}));

const file = (path: string, relativePath: string): Extract<FileItem, { isDirectory: false }> => ({
  id: path,
  filename: relativePath.split("/").at(-1)?.replace(/\.md$/, "") ?? "",
  relativePath,
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const directory = (path: string, relativePath: string, children: FileItem[] = []): FileItem => ({
  id: path,
  filename: relativePath.split("/").at(-1) ?? "",
  relativePath,
  path,
  isDirectory: true,
  mimeType: null,
  children,
});

const entryOrder = (entries: ContextMenuEntry[] | undefined) =>
  entries?.map((entry) => (entry.kind === "separator" ? "|" : entry.id));

const renderMenu = <T,>(store: ReturnType<typeof createStore>, hook: () => T) =>
  renderHook(hook, {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });

describe("file explorer menus", () => {
  let note: Extract<FileItem, { isDirectory: false }>;
  let second: FileItem;
  let folder: FileItem;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    state.reconcilePasteAvailability.mockReset().mockResolvedValue(false);
    window.config = { getMainDirectoryPathSync: () => "/notes-root" } as Window["config"];
    note = file("/notes-root/note.md", "note.md");
    second = file("/notes-root/second.md", "second.md");
    folder = directory("/notes-root/Folder", "Folder", [second]);
    store = createStore();
    store.set(fileTreeAtom, [note, folder]);
  });

  afterEach(() => cleanup());

  it("creates a pane before opening a file from its context menu", async () => {
    const originalPanes = store.get(workspacePanesAtom);
    state.open.mockImplementationOnce(async (_file, options) => {
      expect(store.get(workspacePanesAtom).map((pane) => pane.id)).toContain(options.paneId);
      return true;
    });
    const { result } = renderMenu(store, useFileMenu);
    act(() => result.current.openFileMenuAt(note, { anchor: null, x: 1, y: 2 }));
    const entry = store
      .get(contextMenuRequestAtom)
      ?.entries.find((entry) => entry.kind === "action" && entry.id === "open-new-pane");
    if (entry?.kind !== "action") throw new Error("Expected Open in new pane");
    await act(async () => {
      await entry.onSelect();
    });
    expect(state.open).toHaveBeenCalledWith(note, {
      paneId: "new-pane",
      openInNewTab: true,
      focusEditor: true,
    });
    expect(store.get(workspacePanesAtom)).toHaveLength(originalPanes.length + 1);
    expect(store.get(workspacePanesAtom)[0].tabs).toEqual(originalPanes[0].tabs);
  });

  it("removes the new empty pane when opening a file fails", async () => {
    const originalPanes = store.get(workspacePanesAtom);
    state.open.mockResolvedValueOnce(false);
    const { result } = renderMenu(store, useFileMenu);
    act(() => result.current.openFileMenuAt(note, { anchor: null, x: 1, y: 2 }));
    const entry = store
      .get(contextMenuRequestAtom)
      ?.entries.find((entry) => entry.kind === "action" && entry.id === "open-new-pane");
    if (entry?.kind !== "action") throw new Error("Expected Open in new pane");
    await act(async () => {
      await entry.onSelect();
    });
    expect(store.get(workspacePanesAtom)).toEqual(originalPanes);
  });

  it("orders a single file menu into consistent groups", () => {
    const { result } = renderMenu(store, useFileMenu);
    act(() => result.current.openFileMenuAt(note, { anchor: null, x: 1, y: 2 }));

    expect(entryOrder(store.get(contextMenuRequestAtom)?.entries)).toEqual([
      "open",
      "open-new-pane",
      "version-history",
      "export-note-pdf",
      "|",
      "copy-menu",
      "make-copy",
      "move-to-folder",
      "|",
      "add-bookmark",
      "|",
      "reveal",
      "|",
      "rename",
      "trash",
    ]);

    const makeCopy = store
      .get(contextMenuRequestAtom)
      ?.entries.find((entry) => entry.kind === "action" && entry.id === "make-copy");
    if (makeCopy?.kind !== "action") throw new Error("Expected Duplicate");
    expect(makeCopy.label).toBe("Duplicate");
    act(() => makeCopy.onSelect());
    expect(state.copyManyToDirectory).toHaveBeenCalledWith([note], "/notes-root");

    const versionHistory = store
      .get(contextMenuRequestAtom)
      ?.entries.find((entry) => entry.kind === "action" && entry.id === "version-history");
    if (versionHistory?.kind !== "action") throw new Error("Expected File history");
    expect(versionHistory.label).toBe("File history");
    act(() => versionHistory.onSelect());
    expect(Object.values(store.get(openWorkspaceItemsByKeyAtom))).toContainEqual(
      expect.objectContaining({ kind: "file-history", file: note }),
    );

    const moveToFolder = store
      .get(contextMenuRequestAtom)
      ?.entries.find((entry) => entry.kind === "action" && entry.id === "move-to-folder");
    if (moveToFolder?.kind !== "action") throw new Error("Expected Move to folder");
    act(() => moveToFolder.onSelect());
    expect(store.get(actionRunnerRequestAtom)).toEqual({
      view: "move-to-folder",
      targets: [note],
      returnToCommands: false,
    });
  });

  it("uses Remove bookmark for an already bookmarked single file", () => {
    store.set(bookmarksAtom, [note]);
    const { result } = renderMenu(store, useFileMenu);
    act(() => result.current.openFileMenuAt(note, { anchor: null, x: 1, y: 2 }));

    expect(entryOrder(store.get(contextMenuRequestAtom)?.entries)).toContain("remove-bookmark");
    expect(entryOrder(store.get(contextMenuRequestAtom)?.entries)).not.toContain("add-bookmark");
  });

  it("keeps a Recent-item menu single even when the same file is selected in the tree", () => {
    store.set(explorerSelectionPathsAtom, [note.path, folder.path]);
    const { result } = renderMenu(store, useFileMenu);
    const anchor = document.createElement("button");
    act(() =>
      result.current.openFileMenu(
        {
          preventDefault: vi.fn(),
          currentTarget: anchor,
          clientX: 1,
          clientY: 2,
        } as never,
        note,
      ),
    );

    expect(entryOrder(store.get(contextMenuRequestAtom)?.entries)).toContain("open");
    expect(
      store.get(contextMenuRequestAtom)?.entries.find((entry) => entry.kind === "action" && entry.id === "copy-menu"),
    ).toMatchObject({ label: "Copy" });
  });

  it("keeps multi-selection order for copy actions and uses counted labels", () => {
    store.set(explorerSelectionPathsAtom, [folder.path, note.path]);
    const { result } = renderMenu(store, useFileMenu);
    act(() => result.current.openFileMenuAt(note, { anchor: null, x: 1, y: 2 }));
    const entries = store.get(contextMenuRequestAtom)!.entries;

    expect(entryOrder(entries)).toEqual([
      "copy-menu",
      "move-to-folder",
      "|",
      "add-bookmarks",
      "remove-bookmarks",
      "|",
      "trash",
    ]);
    expect(entries.filter((entry) => entry.kind === "action").map((entry) => entry.label)).toEqual([
      "Copy",
      "Move 2 items to folder",
      "Add bookmarks (1)",
      "Remove bookmarks (1)",
      "Move 2 items to Trash",
    ]);
    const copyMenu = entries.find((entry) => entry.kind === "action" && entry.id === "copy-menu");
    expect(copyMenu?.kind === "action" ? entryOrder(copyMenu.children) : null).toEqual([
      "copy",
      "copy-path",
      "copy-relative-path",
    ]);
    expect(
      copyMenu?.kind === "action"
        ? copyMenu.children?.filter((entry) => entry.kind === "action").map((entry) => entry.label)
        : null,
    ).toEqual(["2 items", "2 absolute paths", "2 relative paths"]);
    const copyEntry =
      copyMenu?.kind === "action"
        ? copyMenu.children?.find((entry) => entry.kind === "action" && entry.id === "copy")
        : null;
    if (copyEntry?.kind !== "action") throw new Error("Expected Copy");
    act(() => copyEntry.onSelect());
    expect(state.copyItems).toHaveBeenCalledWith([folder, note]);
  });

  it("orders directory and root menus and refreshes Paste availability from the current clipboard", async () => {
    const { result } = renderMenu(store, useDirectoryMenu);
    act(() => result.current.openDirectoryMenuAt(folder, { anchor: null, x: 1, y: 2 }));
    expect(entryOrder(store.get(contextMenuRequestAtom)?.entries)).toEqual([
      "new-note",
      "new-directory",
      "|",
      "paste",
      "|",
      "copy-menu",
      "move-to-folder",
      "|",
      "reveal",
      "|",
      "rename",
      "trash",
    ]);
    const directoryPaste = store
      .get(contextMenuRequestAtom)
      ?.entries.find((entry) => entry.kind === "action" && entry.id === "paste");
    expect(directoryPaste?.kind === "action" ? directoryPaste.disabled : false).toBe(true);
    await waitFor(() => expect(state.reconcilePasteAvailability).toHaveBeenCalledOnce());

    const breadcrumbAnchor = document.createElement("button");
    act(() =>
      result.current.openBreadcrumbDirectoryMenu(
        {
          preventDefault: vi.fn(),
          currentTarget: breadcrumbAnchor,
          clientX: 2,
          clientY: 3,
        } as never,
        folder,
      ),
    );
    expect(entryOrder(store.get(contextMenuRequestAtom)?.entries)).toEqual([
      "new-note",
      "new-directory",
      "|",
      "copy-menu",
      "|",
      "reveal",
    ]);

    state.reconcilePasteAvailability.mockResolvedValueOnce(true);
    act(() => result.current.openRootMenuAt({ anchor: null, x: 3, y: 4 }));
    expect(entryOrder(store.get(contextMenuRequestAtom)?.entries)).toEqual([
      "new-note",
      "new-directory",
      "|",
      "paste",
      "|",
      "reveal",
    ]);
    await waitFor(() => {
      const rootPaste = store
        .get(contextMenuRequestAtom)
        ?.entries.find((entry) => entry.kind === "action" && entry.id === "paste");
      expect(rootPaste?.kind === "action" ? rootPaste.disabled : true).toBe(false);
    });

    const paste = store
      .get(contextMenuRequestAtom)
      ?.entries.find((entry) => entry.kind === "action" && entry.id === "paste");
    if (paste?.kind !== "action") throw new Error("Expected Paste");
    act(() => paste.onSelect());
    expect(state.pasteSystemClipboard).toHaveBeenCalledWith("/notes-root");

    const reveal = store
      .get(contextMenuRequestAtom)
      ?.entries.find((entry) => entry.kind === "action" && entry.id === "reveal");
    if (reveal?.kind !== "action") throw new Error("Expected Show in file manager");
    act(() => reveal.onSelect());
    expect(state.reveal).toHaveBeenCalledWith("/notes-root");
  });

  it("orders the Pinned menu without leading, trailing, or duplicate separators", () => {
    const { result } = renderMenu(store, useBookmarkMenu);
    const anchor = document.createElement("button");
    act(() =>
      result.current.openBookmarkMenu(
        {
          preventDefault: vi.fn(),
          currentTarget: anchor,
          clientX: 5,
          clientY: 6,
        } as never,
        note,
      ),
    );

    const order = entryOrder(store.get(contextMenuRequestAtom)?.entries);
    expect(order).toEqual([
      "open",
      "open-new-pane",
      "|",
      "copy-menu",
      "move-to-folder",
      "|",
      "remove-bookmark",
      "|",
      "reveal",
      "|",
      "rename",
      "trash",
    ]);
    expect(order?.at(0)).not.toBe("|");
    expect(order?.at(-1)).not.toBe("|");
    expect(order?.join(",")).not.toContain("|,|");
  });

  it("right-aligns and toggles the editor header menu from its ellipsis button", () => {
    const { result } = renderMenu(store, useFileHeaderMenu);
    const anchor = document.createElement("button");
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      bottom: 48,
      height: 28,
      left: 92,
      right: 120,
      top: 20,
      width: 28,
      x: 92,
      y: 20,
      toJSON: () => ({}),
    });

    act(() =>
      result.current.openFileHeaderMenu(
        {
          preventDefault: vi.fn(),
          currentTarget: anchor,
        } as never,
        note,
        { paneId: "pane-1", tabId: "tab-1" },
      ),
    );

    expect(store.get(contextMenuRequestAtom)?.position).toEqual({
      alignX: "right",
      x: 120,
      y: 48,
    });

    act(() =>
      result.current.openFileHeaderMenu(
        {
          preventDefault: vi.fn(),
          currentTarget: anchor,
        } as never,
        note,
        { paneId: "pane-1", tabId: "tab-1" },
      ),
    );

    expect(store.get(contextMenuRequestAtom)).toBeNull();
  });

  it("offers the same file actions from a hover window without a tab location", () => {
    const { result } = renderMenu(store, useFileHeaderMenu);
    const anchor = document.createElement("button");
    act(() => result.current.openFileHeaderMenu({ preventDefault: vi.fn(), currentTarget: anchor } as never, note));

    const request = store.get(contextMenuRequestAtom);
    expect(request?.key).toBe(`file-header:${note.path}:hover:window`);
    const rename = request?.entries.find((entry) => entry.kind === "action" && entry.id === "rename");
    if (rename?.kind !== "action") throw new Error("Rename action missing");
    rename.onSelect();
    expect(state.startRenaming).toHaveBeenCalledWith(note.path, "explorer");
  });

  it("offers PDF external actions in the pane header menu and reports failures", async () => {
    const pdf = { ...note, path: "/notes-root/paper.pdf", filename: "paper.pdf", mimeType: "application/pdf" };
    const { result } = renderMenu(store, useFileHeaderMenu);
    const anchor = document.createElement("button");
    act(() =>
      result.current.openFileHeaderMenu({ preventDefault: vi.fn(), currentTarget: anchor } as never, pdf, {
        paneId: "pane-1",
        tabId: "tab-1",
      }),
    );

    const entries = store.get(contextMenuRequestAtom)?.entries;
    expect(entryOrder(entries)).toContain("open-default-app");
    expect(entryOrder(entries)?.filter((id) => id === "reveal")).toHaveLength(1);
    const openExternal = entries?.find((entry) => entry.kind === "action" && entry.id === "open-default-app");
    if (openExternal?.kind !== "action") throw new Error("Open in default app action missing");
    state.openInDefaultApp.mockResolvedValue({ success: false, error: "External app unavailable" });
    act(() => openExternal.onSelect());
    await waitFor(() => expect(state.openInDefaultApp).toHaveBeenCalledWith(pdf.path));
    await waitFor(() => expect(store.get(notificationsAtom).at(-1)?.message).toBe("External app unavailable"));

    const reveal = entries?.find((entry) => entry.kind === "action" && entry.id === "reveal");
    if (reveal?.kind !== "action") throw new Error("Show in file manager action missing");
    state.reveal.mockResolvedValue({ success: false, error: "File manager unavailable" });
    act(() => reveal.onSelect());
    await waitFor(() => expect(state.reveal).toHaveBeenCalledWith(pdf.path));
    await waitFor(() => expect(store.get(notificationsAtom).at(-1)?.message).toBe("File manager unavailable"));

    act(() => result.current.openFileHeaderMenu({ preventDefault: vi.fn(), currentTarget: anchor } as never, pdf));
    expect(entryOrder(store.get(contextMenuRequestAtom)?.entries)).not.toContain("open-default-app");
  });
});
