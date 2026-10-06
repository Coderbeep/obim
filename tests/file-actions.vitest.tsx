import { PDF_DEEP_LINK_EVENT } from "../src/renderer/src/shared/pdfDeepLink";
import { act, render, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useExternalFileImport,
  useFileCreate,
  useFileCopy,
  useFileMove,
  useFileOpen,
  useFileRemove,
  useFileRename,
  useManageFileBookmark,
} from "../src/renderer/src/features/files/fileActions";
import { bookmarksAtom } from "../src/renderer/src/store/bookmarkStore";
import { contextMenuRequestAtom } from "../src/renderer/src/store/contextMenuStore";
import {
  activePaneIdAtom,
  editorFocusRequestAtom,
  workspacePanesAtom,
} from "../src/renderer/src/store/editorPaneStore";
import { workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { WorkspaceTransitionStatus } from "../src/renderer/src/app/WorkspaceTransitionStatus";
import { useObimEditor } from "../src/renderer/src/features/editor/useObimEditor";
import { workspaceTransitionAtom } from "../src/renderer/src/store/workspaceTransitionStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import {
  fileAccessesAtom,
  fileTreeAtom,
  recentFilesAtom,
  reloadRevisionAtom,
  renamingRequestAtom,
} from "../src/renderer/src/store/fileExplorerStore";
import { notificationsAtom } from "../src/renderer/src/store/NotificationsStore";
import { currentFileAtom, openWorkspaceItemsByKeyAtom } from "../src/renderer/src/store/workspaceResourceStore";
import { createFileWorkspaceItem } from "../src/shared/workspace";
import { createEditorTab } from "../src/renderer/src/store/editorTabStore";
import type { FileItem } from "../src/shared/file-item";
import { MAX_FULL_TEXT_EDITOR_BYTES } from "../src/shared/large-files";

type Store = ReturnType<typeof createStore>;

const commandMocks = vi.hoisted(() => ({
  copyWorkspaceItems: vi.fn(),
  createFile: vi.fn(),
  trashFile: vi.fn(),
  importExternalFiles: vi.fn(),
  moveFile: vi.fn(),
  readTextFile: vi.fn(),
  renameFile: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock("@renderer/features/files/workspaceFileService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/renderer/src/features/files/workspaceFileService")>()),
  ...commandMocks,
}));

const note = (path: string): Extract<FileItem, { isDirectory: false }> => ({
  id: path,
  filename: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const fileVersion = { id: "file-1", mtimeMs: 100, sizeBytes: 10 };

const directory = (path: string): FileItem => ({
  ...note(path),
  isDirectory: true,
  mimeType: null,
  children: [],
});

const renderBookmarkActions = (initial: FileItem[]) => {
  const store = createStore();
  store.set(bookmarksAtom, initial);
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  return { store, ...renderHook(() => useManageFileBookmark(), { wrapper }) };
};

const renderActions = <T,>(hook: () => T, store: Store = createStore()) => {
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  return { store, ...renderHook(hook, { wrapper }) };
};

const selectCurrentFile = (store: Store, file: FileItem) => {
  const item = createFileWorkspaceItem(file);
  const tab = createEditorTab("tab-current", item.key);
  store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }]);
  store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
  store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
};

const setContextMenuRequest = (store: Store) => {
  store.set(contextMenuRequestAtom, {
    key: "file-actions",
    anchor: null,
    position: { x: 0, y: 0 },
    entries: [],
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  window.api = {
    upsertFile: vi.fn().mockResolvedValue(true),
  } as unknown as Window["api"];
  window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
  commandMocks.copyWorkspaceItems.mockResolvedValue({ copiedPaths: ["/notes/copied.md"], errors: [] });
  commandMocks.createFile.mockResolvedValue({ success: false, error: "failed" });
  commandMocks.trashFile.mockResolvedValue({ success: false, error: "failed" });
  commandMocks.importExternalFiles.mockResolvedValue({ importedPaths: [], errors: [] });
  commandMocks.moveFile.mockResolvedValue({ success: false, error: "failed" });
  commandMocks.readTextFile.mockResolvedValue({ success: true, content: "", version: fileVersion });
  commandMocks.renameFile.mockResolvedValue({ success: false, error: "failed" });
  commandMocks.saveFile.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PDF destinations in existing readers", () => {
  it("dispatches the deep link to an existing reader tab hosting the requested PDF", async () => {
    const pdf = { ...note("/notes/report.pdf"), isDirectory: false as const, mimeType: "application/pdf" };
    const item = createFileWorkspaceItem(pdf);
    const tab = createEditorTab("reader", item.key);
    const store = createStore();
    store.set(fileTreeAtom, [pdf]);
    store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }]);
    store.set(activePaneIdAtom, "pane-1");
    store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
    store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
    const event = vi.fn();
    window.addEventListener(PDF_DEEP_LINK_EVENT, event);
    const { result } = renderActions(useFileOpen, store);
    await act(() => result.current.openLinkedFile("report.pdf#page=2&selection=0,0,0,4"));
    window.removeEventListener(PDF_DEEP_LINK_EVENT, event);
    expect(store.get(workspaceTabsByIdAtom)[tab.id]).toBe(tab);
    expect(event).toHaveBeenCalledOnce();
    expect((event.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      path: pdf.path,
      page: 2,
      selection: { startItem: 0, startOffset: 0, endItem: 0, endOffset: 4 },
      readerId: JSON.stringify(["pane-1", item.key]),
    });
  });

  it("opens a standalone reader when no reader hosts the requested source", async () => {
    const pdf = { ...note("/notes/new.pdf"), isDirectory: false as const, mimeType: "application/pdf" };
    const store = createStore();
    store.set(fileTreeAtom, [pdf]);
    store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [], activeTabId: null, size: 1 }]);
    store.set(activePaneIdAtom, "pane-1");
    const event = vi.fn();
    window.addEventListener(PDF_DEEP_LINK_EVENT, event);
    const { result } = renderActions(useFileOpen, store);
    await act(() => result.current.openLinkedFile("new.pdf#page=2"));
    window.removeEventListener(PDF_DEEP_LINK_EVENT, event);
    const tab = Object.values(store.get(workspaceTabsByIdAtom))[0];
    expect(tab.currentResourceKey).toBe(createFileWorkspaceItem(pdf).key);
    expect((event.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      readerId: JSON.stringify(["pane-1", tab.currentResourceKey]),
      page: 2,
    });
  });
});

describe("bookmark batch actions", () => {
  it("persists one deduplicated bookmark batch", async () => {
    const existing = note("/notes/existing.md");
    const added = note("/notes/added.md");
    const { result, store } = renderBookmarkActions([existing]);

    await act(() => result.current.addBookmarks([added, added, existing, directory("/notes/folder")]));

    expect(store.get(bookmarksAtom)).toEqual([existing, added]);
    expect(window.api.upsertFile).toHaveBeenCalledWith(
      ".obim/bookmarks.json",
      expect.stringContaining('"path": "added.md"'),
    );
  });

  it("removes a deduplicated bookmark batch", async () => {
    const first = note("/notes/first.md");
    const second = note("/notes/second.md");
    const { result, store } = renderBookmarkActions([first, second]);

    await act(() => result.current.removeBookmarks([first, first]));

    expect(store.get(bookmarksAtom)).toEqual([second]);
    expect(window.api.upsertFile).toHaveBeenCalledWith(
      ".obim/bookmarks.json",
      expect.stringContaining('"path": "second.md"'),
    );
  });

  it("does not publish bookmark state when the workspace write fails", async () => {
    const existing = note("/notes/existing.md");
    const added = note("/notes/added.md");
    const { result, store } = renderBookmarkActions([existing]);
    vi.mocked(window.api.upsertFile).mockResolvedValue(false);

    await expect(act(() => result.current.addBookmark(added))).rejects.toThrow("Could not write");

    expect(store.get(bookmarksAtom)).toEqual([existing]);
  });
});

describe("copying current buffer snapshots", () => {
  it.each([false, true])("saves dirty sources before copying a file or folder (folder: %s)", async (folder) => {
    const store = createStore();
    const a = "/notes/folder/a.md";
    const b = "/notes/folder/b.md";
    store.set(fileBuffersByPathAtom, {
      [a]: { savedText: "old a", editorText: "draft a", version: fileVersion },
      [b]: { savedText: "old b", editorText: "draft b", version: fileVersion },
      "/notes/unrelated.md": { savedText: "old", editorText: "unrelated", version: fileVersion },
    });
    const { result } = renderActions(() => useFileCopy(), store);
    await act(() => result.current.copyManyToDirectory([folder ? directory("/notes/folder") : note(a)], "/notes/dest"));
    expect(commandMocks.saveFile).toHaveBeenCalledWith(a, "draft a", fileVersion, expect.anything());
    expect(commandMocks.saveFile).toHaveBeenCalledTimes(folder ? 2 : 1);
    expect(commandMocks.copyWorkspaceItems.mock.invocationCallOrder[0]).toBeGreaterThan(
      commandMocks.saveFile.mock.invocationCallOrder.at(-1)!,
    );
    expect(store.get(fileBuffersByPathAtom)["/notes/unrelated.md"].editorText).toBe("unrelated");
  });

  it("does not create a stale duplicate if any descendant cannot be saved", async () => {
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      "/notes/folder/a.md": { savedText: "old", editorText: "draft", version: fileVersion },
    });
    commandMocks.saveFile.mockResolvedValue({ success: false, errorCode: "conflict", error: "changed on disk" });
    const { result } = renderActions(() => useFileCopy(), store);
    await act(() => result.current.copyManyToDirectory([directory("/notes/folder")], "/notes/dest"));
    expect(commandMocks.copyWorkspaceItems).not.toHaveBeenCalled();
    expect(store.get(reloadRevisionAtom)).toBe(0);
    expect(store.get(notificationsAtom).some((item) => item.title === "Note changed on disk")).toBe(true);
  });

  it("holds its source snapshot through delayed saves and copy, then permits repeated paste", async () => {
    const store = createStore();
    const path = "/notes/a.md";
    store.set(fileBuffersByPathAtom, { [path]: { savedText: "old", editorText: "draft", version: fileVersion } });
    let finishSave!: (value: { success: true }) => void;
    let finishCopy!: (value: { copiedPaths: string[]; errors: string[] }) => void;
    commandMocks.saveFile.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSave = resolve;
      }),
    );
    commandMocks.copyWorkspaceItems.mockReturnValueOnce(
      new Promise((resolve) => {
        finishCopy = resolve;
      }),
    );
    const { result } = renderActions(() => useFileCopy(), store);
    let copying!: Promise<void>;
    act(() => {
      copying = result.current.copyManyToDirectory([note(path)], "/notes/dest");
    });
    await act(async () => {
      await vi.waitFor(() => expect(commandMocks.saveFile).toHaveBeenCalledTimes(1));
    });
    store.set(fileBuffersByPathAtom, (buffers) => ({
      ...buffers,
      [path]: { ...buffers[path], editorText: "late during save" },
    }));
    finishSave({ success: true });
    await act(async () => {
      await vi.waitFor(() => expect(commandMocks.copyWorkspaceItems).toHaveBeenCalledTimes(1));
    });
    store.set(fileBuffersByPathAtom, (buffers) => ({
      ...buffers,
      [path]: { ...buffers[path], editorText: "late during copy" },
    }));
    expect(store.get(fileBuffersByPathAtom)[path].editorText).toBe("draft");
    finishCopy({ copiedPaths: ["/notes/dest/a.md"], errors: [] });
    await act(() => copying);
    await act(() => result.current.copyManyToDirectory([note(path)], "/notes/dest"));
    expect(commandMocks.copyWorkspaceItems).toHaveBeenCalledTimes(2);
    expect(commandMocks.saveFile).toHaveBeenCalledTimes(1);
    store.set(fileBuffersByPathAtom, (buffers) => ({
      ...buffers,
      [path]: { ...buffers[path], editorText: "accepted afterward" },
    }));
    expect(store.get(fileBuffersByPathAtom)[path].editorText).toBe("accepted afterward");
  });
});

describe("external file import actions", () => {
  it("publishes success and error notifications while requesting exactly one reload", async () => {
    commandMocks.importExternalFiles.mockResolvedValue({
      importedPaths: ["/notes/imported.md"],
      errors: ["broken.txt could not be imported"],
    });
    const { result, store } = renderActions(() => useExternalFileImport());

    await act(() => result.current.importExternalFiles([new File(["note"], "imported.md")], "/notes"));

    expect(store.get(reloadRevisionAtom)).toBe(1);
    expect(store.get(notificationsAtom).map(({ title }) => title)).toEqual(["Imported 1 item", "File import failed"]);
  });

  it("shows a delayed import indicator with its destination", async () => {
    vi.useFakeTimers();
    let finish!: (result: { importedPaths: string[]; errors: string[] }) => void;
    commandMocks.importExternalFiles.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result, store } = renderActions(() => useExternalFileImport());
    let operation!: Promise<void>;

    act(() => {
      operation = result.current.importExternalFiles([new File(["note"], "imported.md")], "/notes/Inbox");
    });
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(store.get(notificationsAtom).at(-1)).toMatchObject({
      busy: true,
      message: "Destination: Inbox",
      timeout: 0,
      title: "Importing 1 item…",
    });

    await act(async () => {
      finish({ importedPaths: [], errors: [] });
      await operation;
    });
    expect(store.get(notificationsAtom)).toEqual([]);
  });
});

describe("file creation actions", () => {
  it("creates templated markdown in the requested parent and reloads without opening when requested", async () => {
    const created = note("/notes/Tasks/read-paper.md");
    commandMocks.createFile.mockResolvedValue({ success: true, file: created });
    const { result, store } = renderActions(() => useFileCreate());

    const file = await act(() =>
      result.current.createMarkdownFile("/notes/Tasks", "read-paper.md", "---\ntype: task\n---\n# Read paper\n", false),
    );

    expect(file).toEqual(created);
    expect(commandMocks.createFile).toHaveBeenCalledWith(
      "/notes/Tasks",
      "read-paper.md",
      "---\ntype: task\n---\n# Read paper\n",
    );
    expect(commandMocks.readTextFile).not.toHaveBeenCalled();
    expect(store.get(reloadRevisionAtom)).toBe(1);
  });

  it("opens a created markdown file in a new tab by default", async () => {
    const current = note("/notes/current.md");
    const created = note("/notes/Tasks/open-me.md");
    const store = createStore();
    selectCurrentFile(store, current);
    commandMocks.createFile.mockResolvedValue({ success: true, file: created });
    commandMocks.readTextFile.mockResolvedValue({ success: true, content: "# Open me", version: fileVersion });
    const { result } = renderActions(() => useFileCreate(), store);
    const openedAfter = Date.now();

    await act(() => result.current.createMarkdownFile("/notes/Tasks", "open-me.md", "# Open me", true));

    expect(commandMocks.readTextFile).toHaveBeenCalledWith(created.path);
    expect(store.get(recentFilesAtom)).toEqual([created]);
    expect(store.get(fileAccessesAtom)[created.path]).toBeGreaterThanOrEqual(openedAfter);
    expect(store.get(reloadRevisionAtom)).toBe(1);
    const pane = store.get(workspacePanesAtom)[0];
    expect(pane.tabs).toHaveLength(2);
    expect(store.get(workspaceTabsByIdAtom)[pane.tabs[0]]?.currentResourceKey).toBe(
      createFileWorkspaceItem(current).key,
    );
    expect(store.get(workspaceTabsByIdAtom)[pane.activeTabId!]?.currentResourceKey).toBe(
      createFileWorkspaceItem(created).key,
    );
  });

  it("requests inline note-title editing after creating a new untitled note", async () => {
    const current = note("/notes/current.md");
    const created = note("/notes/Untitled 1.md");
    const store = createStore();
    selectCurrentFile(store, current);
    commandMocks.createFile.mockResolvedValue({ success: true, file: created });
    const { result } = renderActions(() => useFileCreate(), store);

    await act(() => result.current.createNewFile());

    expect(commandMocks.createFile).toHaveBeenCalledWith("/notes", "Untitled 1.md", "");
    expect(store.get(renamingRequestAtom)).toEqual({ filePath: created.path, target: "note-header" });
    const pane = store.get(workspacePanesAtom)[0];
    expect(pane.tabs).toHaveLength(2);
    expect(store.get(workspaceTabsByIdAtom)[pane.tabs[0]]?.currentResourceKey).toBe(
      createFileWorkspaceItem(current).key,
    );
    expect(store.get(workspaceTabsByIdAtom)[pane.activeTabId!]?.currentResourceKey).toBe(
      createFileWorkspaceItem(created).key,
    );
  });

  it("saves the current document once before creating and opening another file", async () => {
    const current = note("/notes/current.md");
    const created = note("/notes/Tasks/next.md");
    const store = createStore();
    selectCurrentFile(store, current);
    store.set(fileBuffersByPathAtom, {
      [current.path]: { savedText: "saved", editorText: "current draft" },
    });
    commandMocks.createFile.mockResolvedValue({ success: true, file: created });
    const { result } = renderActions(() => useFileCreate(), store);

    await act(() => result.current.createMarkdownFile("/notes/Tasks", "next.md", "# Next", true));

    expect(commandMocks.saveFile).toHaveBeenCalledOnce();
    expect(commandMocks.saveFile).toHaveBeenCalledWith(current.path, "current draft");
    expect(commandMocks.createFile).toHaveBeenCalledWith("/notes/Tasks", "next.md", "# Next");
  });

  it("does not save an active oversized preview before creating a file", async () => {
    const large = { ...note("/notes/large.md"), sizeBytes: MAX_FULL_TEXT_EDITOR_BYTES + 1 };
    const created = note("/notes/Tasks/next.md");
    const store = createStore();
    selectCurrentFile(store, large);
    commandMocks.createFile.mockResolvedValue({ success: true, file: created });
    const { result } = renderActions(() => useFileCreate(), store);

    await act(() => result.current.createMarkdownFile("/notes/Tasks", "next.md", "# Next", false));

    expect(commandMocks.saveFile).not.toHaveBeenCalled();
    expect(commandMocks.createFile).toHaveBeenCalledWith("/notes/Tasks", "next.md", "# Next");
  });

  it("publishes no file state or reload when markdown creation fails", async () => {
    const { result, store } = renderActions(() => useFileCreate());
    const itemsBefore = store.get(openWorkspaceItemsByKeyAtom);
    const buffersBefore = store.get(fileBuffersByPathAtom);

    const file = await act(() => result.current.createMarkdownFile("/notes/Tasks", "blocked.md", "content", true));

    expect(file).toBeNull();
    expect(commandMocks.readTextFile).not.toHaveBeenCalled();
    expect(store.get(reloadRevisionAtom)).toBe(0);
    expect(store.get(openWorkspaceItemsByKeyAtom)).toBe(itemsBefore);
    expect(store.get(fileBuffersByPathAtom)).toBe(buffersBefore);
    expect(store.get(recentFilesAtom)).toEqual([]);
  });

  it("resolves filesystem-time collisions with human numbered names, including concurrent creates", async () => {
    const occupied = new Set<string>();
    commandMocks.createFile.mockImplementation(async (directoryPath: string, filename: string) => {
      if (occupied.has(filename)) return { success: false, error: "Destination file already exists" };
      occupied.add(filename);
      return { success: true, file: note(`${directoryPath}/${filename}`) };
    });
    const { result } = renderActions(() => useFileCreate());

    const [first, second] = await act(() =>
      Promise.all([
        result.current.createMarkdownFile("/notes/Tasks", "Read Paper.md", "first", false, {
          numberOnCollision: true,
        }),
        result.current.createMarkdownFile("/notes/Tasks", "Read Paper.md", "second", false, {
          numberOnCollision: true,
        }),
      ]),
    );

    expect([first?.relativePath, second?.relativePath]).toEqual(["Tasks/Read Paper.md", "Tasks/Read Paper 2.md"]);
    expect(commandMocks.createFile.mock.calls.map(([, filename]) => filename)).toEqual([
      "Read Paper.md",
      "Read Paper.md",
      "Read Paper 2.md",
    ]);
  });
});

describe("file move actions", () => {
  it("requests one reload for a successful single move and none for a failed move", async () => {
    const moved = note("/notes/moved.md");
    commandMocks.moveFile
      .mockResolvedValueOnce({ success: true, output: "/notes/archive/moved.md" })
      .mockResolvedValueOnce({ success: false, error: "permission denied" });
    const { result, store } = renderActions(() => useFileMove());

    await act(() => result.current.moveToDirectory(moved, "/notes/archive"));
    expect(store.get(reloadRevisionAtom)).toBe(1);

    await act(() => result.current.moveToDirectory(note("/notes/blocked.md"), "/notes/archive"));
    expect(store.get(reloadRevisionAtom)).toBe(1);
  });

  it("requests one reload for an entire successful move batch", async () => {
    commandMocks.moveFile.mockImplementation(async (path: string, destination: string) => ({
      success: true,
      output: `${destination}/${path.split("/").at(-1)}`,
    }));
    const { result, store } = renderActions(() => useFileMove());

    const outcome = await act(() =>
      result.current.moveManyToDirectory([note("/notes/first.md"), note("/notes/second.md")], "/notes/archive"),
    );

    expect(outcome.moved).toHaveLength(2);
    expect(store.get(reloadRevisionAtom)).toBe(1);
  });

  it("aborts a dirty move when its prerequisite save fails", async () => {
    const file = note("/notes/dirty.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, { [file.path]: { savedText: "saved", editorText: "draft" } });
    commandMocks.saveFile.mockResolvedValue({ success: false, error: "disk full" });
    const { result } = renderActions(() => useFileMove(), store);

    const outcome = await act(() => result.current.moveToDirectory(file, "/notes/archive"));

    expect(outcome).toEqual({ moved: false, error: "disk full" });
    expect(commandMocks.moveFile).not.toHaveBeenCalled();
    expect(store.get(reloadRevisionAtom)).toBe(0);
  });

  it("saves dirty descendants before moving a directory", async () => {
    const folder = directory("/notes/Folder");
    const childPath = "/notes/Folder/Child.md";
    const store = createStore();
    store.set(fileBuffersByPathAtom, { [childPath]: { savedText: "saved", editorText: "draft" } });
    commandMocks.moveFile.mockResolvedValue({ success: true, output: "/notes/Archive/Folder" });
    const { result } = renderActions(() => useFileMove(), store);

    expect(await act(() => result.current.moveToDirectory(folder, "/notes/Archive"))).toMatchObject({ moved: true });

    expect(commandMocks.saveFile).toHaveBeenCalledWith(childPath, "draft", undefined, expect.any(Object));
    expect(commandMocks.saveFile.mock.invocationCallOrder[0]).toBeLessThan(
      commandMocks.moveFile.mock.invocationCallOrder[0],
    );
    expect(store.get(fileBuffersByPathAtom)["/notes/Archive/Folder/Child.md"]).toEqual({
      savedText: "draft",
      editorText: "draft",
    });
  });

  it("remaps every ordered task path after an in-app directory move", async () => {
    let taskBoardSource = JSON.stringify({
      projects: [],
      taskOrder: ["Tasks/Open.md", "Tasks/Nested/Closed.md", "Other.md"],
    });
    window.api = {
      ...window.api,
      doesFileExist: vi.fn(async (path: string) => path === ".todo/taskboard.json"),
      openFile: vi.fn(async () => taskBoardSource),
      upsertFile: vi.fn(async (path: string, content: string) => {
        if (path === ".todo/taskboard.json") taskBoardSource = content;
        return true;
      }),
    } as Window["api"];
    const tasks = directory("/notes/Tasks");
    commandMocks.moveFile.mockResolvedValue({ success: true, output: "/notes/Archive/Tasks" });
    const { result } = renderActions(() => useFileMove());

    expect(await act(() => result.current.moveToDirectory(tasks, "/notes/Archive"))).toMatchObject({ moved: true });

    expect(JSON.parse(taskBoardSource).taskOrder).toEqual([
      "Archive/Tasks/Open.md",
      "Archive/Tasks/Nested/Closed.md",
      "Other.md",
    ]);
  });
});

describe("file action state boundaries", () => {
  it("saves a dirty file before rename and remaps the saved buffer", async () => {
    const file = note("/notes/Old.md");
    const store = createStore();
    const order: string[] = [];
    store.set(fileTreeAtom, [file]);
    store.set(fileBuffersByPathAtom, { [file.path]: { savedText: "saved", editorText: "draft" } });
    commandMocks.saveFile.mockImplementation(async () => {
      order.push("save");
      return { success: true };
    });
    commandMocks.renameFile.mockImplementation(async () => {
      order.push("rename");
      return { success: true, output: "/notes/New.md" };
    });
    const { result } = renderActions(() => useFileRename(), store);

    expect(await act(() => result.current.saveRename(file.path, "New"))).toEqual({
      success: true,
      newPath: "/notes/New.md",
    });

    expect(order).toEqual(["save", "rename"]);
    expect(store.get(fileBuffersByPathAtom)).toEqual({
      "/notes/New.md": { savedText: "draft", editorText: "draft" },
    });
  });

  it("does not rename a dirty file when its prerequisite save fails", async () => {
    const file = note("/notes/Old.md");
    const store = createStore();
    store.set(fileTreeAtom, [file]);
    store.set(fileBuffersByPathAtom, { [file.path]: { savedText: "saved", editorText: "draft" } });
    commandMocks.saveFile.mockResolvedValue({ success: false, error: "disk full" });
    const { result } = renderActions(() => useFileRename(), store);

    expect(await act(() => result.current.saveRename(file.path, "New"))).toEqual({
      success: false,
      error: "disk full",
    });

    expect(commandMocks.renameFile).not.toHaveBeenCalled();
    expect(store.get(fileBuffersByPathAtom)[file.path]).toEqual({ savedText: "saved", editorText: "draft" });
    expect(store.get(notificationsAtom).at(-1)).toMatchObject({
      title: "Could not save note",
      path: file.path,
      message: "disk full",
    });
  });

  it("saves all dirty notes before renaming a directory and updating incoming links", async () => {
    const folder = directory("/notes/Folder");
    const childPath = "/notes/Folder/Child.md";
    const outsidePath = "/notes/Outside.md";
    const store = createStore();
    store.set(fileTreeAtom, [folder]);
    store.set(fileBuffersByPathAtom, {
      [childPath]: { savedText: "saved", editorText: "child draft" },
      [outsidePath]: { savedText: "saved", editorText: "outside draft" },
    });
    commandMocks.renameFile.mockResolvedValue({ success: true, output: "/notes/Renamed" });
    const { result } = renderActions(() => useFileRename(), store);

    expect(await act(() => result.current.saveRename(folder.path, "Renamed"))).toMatchObject({ success: true });

    expect(commandMocks.saveFile).toHaveBeenCalledTimes(2);
    expect(commandMocks.saveFile).toHaveBeenCalledWith(childPath, "child draft", undefined, expect.any(Object));
    expect(commandMocks.saveFile).toHaveBeenCalledWith(outsidePath, "outside draft", undefined, expect.any(Object));
    expect(commandMocks.saveFile.mock.invocationCallOrder[0]).toBeLessThan(
      commandMocks.renameFile.mock.invocationCallOrder[0],
    );
    expect(store.get(fileBuffersByPathAtom)).toEqual({
      "/notes/Renamed/Child.md": { savedText: "child draft", editorText: "child draft" },
      [outsidePath]: { savedText: "outside draft", editorText: "outside draft" },
    });
  });

  it("synchronizes open incoming links and renamed self-links with their new disk versions", async () => {
    const file = note("/notes/Old.md");
    const store = createStore();
    store.set(fileTreeAtom, [file]);
    store.set(fileBuffersByPathAtom, {
      [file.path]: { savedText: "[[Old]]", editorText: "[[Old]]", version: fileVersion },
      "/notes/source.md": { savedText: "[[Old|Alias]]", editorText: "[[Old|Alias]]", version: fileVersion },
    });
    const nextVersion = { id: "new-inode", sizeBytes: 7, mtimeMs: 5 };
    commandMocks.renameFile.mockImplementation(async () => {
      // New typing is accepted and its links are rewritten after the transaction.
      store.set(fileBuffersByPathAtom, (buffers) => ({
        ...buffers,
        "/notes/source.md": { ...buffers["/notes/source.md"], editorText: "[[Old|Alias]] typing during rename" },
      }));
      expect(store.get(fileBuffersByPathAtom)["/notes/source.md"].editorText).toBe(
        "[[Old|Alias]] typing during rename",
      );
      return {
        success: true,
        output: "/notes/New.md",
        updatedLinkCount: 2,
        linkMove: { beforePaths: ["Old.md", "source.md"], afterPaths: ["New.md", "source.md"] },
        linkUpdates: [
          { path: "/notes/New.md", previousContent: "[[Old]]", content: "[[New]]", version: nextVersion },
          {
            path: "/notes/source.md",
            previousContent: "[[Old|Alias]]",
            content: "[[New|Alias]]",
            version: nextVersion,
          },
        ],
      };
    });
    const { result } = renderActions(useFileRename, store);
    expect(await act(() => result.current.saveRename(file.path, "New"))).toMatchObject({ success: true });
    expect(store.get(fileBuffersByPathAtom)).toEqual({
      "/notes/New.md": { savedText: "[[New]]", editorText: "[[New]]", version: nextVersion },
      "/notes/source.md": {
        savedText: "[[New|Alias]]",
        editorText: "[[New|Alias]] typing during rename",
        version: nextVersion,
      },
    });
    store.set(fileBuffersByPathAtom, (buffers) => ({
      ...buffers,
      "/notes/source.md": { ...buffers["/notes/source.md"], editorText: "typing after rename" },
    }));
    expect(store.get(fileBuffersByPathAtom)["/notes/source.md"].editorText).toBe("typing after rename");
  });

  it("shows background progress without a dialog and resumes autosave on the renamed path", async () => {
    vi.useFakeTimers();
    const file = note("/notes/Old.md");
    const store = createStore();
    store.set(fileTreeAtom, [file]);
    store.set(fileBuffersByPathAtom, {
      [file.path]: { savedText: "[[Old]]", editorText: "[[Old]]", version: fileVersion },
    });
    let finish!: (value: unknown) => void;
    commandMocks.renameFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderActions(() => ({ rename: useFileRename(), editor: useObimEditor() }), store);
    render(
      <Provider store={store}>
        <WorkspaceTransitionStatus />
      </Provider>,
    );
    let renaming!: ReturnType<typeof result.current.rename.saveRename>;
    await act(async () => {
      renaming = result.current.rename.saveRename(file.path, "New");
    });
    expect(store.get(workspaceTransitionAtom)?.background).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(store.get(notificationsAtom).find((n) => n.busy)?.title).toBe("Updating links…");
    act(() => {
      store.set(fileBuffersByPathAtom, (buffers) => ({
        ...buffers,
        [file.path]: { ...buffers[file.path], editorText: "[[Old]] newer typing" },
      }));
      result.current.editor.queueAutoSave(file.path, "[[Old]] newer typing");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(commandMocks.saveFile).not.toHaveBeenCalled();
    const nextVersion = { ...fileVersion, id: "rewritten" };
    await act(async () => {
      finish({
        success: true,
        output: "/notes/New.md",
        updatedLinkCount: 1,
        linkMove: { beforePaths: ["Old.md"], afterPaths: ["New.md"] },
        linkUpdates: [{ path: "/notes/New.md", previousContent: "[[Old]]", content: "[[New]]", version: nextVersion }],
      });
      await renaming;
    });
    expect(commandMocks.saveFile).toHaveBeenCalledWith("/notes/New.md", "[[New]] newer typing", nextVersion);
    expect(store.get(fileBuffersByPathAtom)["/notes/New.md"].editorText).toBe("[[New]] newer typing");
    expect(store.get(notificationsAtom).filter((n) => n.busy)).toHaveLength(0);
    expect(store.get(notificationsAtom).map((n) => n.title)).toContain("Updated 1 link");
  });

  it("keeps typing during the prerequisite save and reports rename failures without a lingering spinner", async () => {
    const file = note("/notes/Old.md");
    const store = createStore();
    store.set(fileTreeAtom, [file]);
    store.set(fileBuffersByPathAtom, { [file.path]: { savedText: "old", editorText: "draft", version: fileVersion } });
    commandMocks.saveFile.mockImplementation(async () => {
      store.set(fileBuffersByPathAtom, (buffers) => ({
        ...buffers,
        [file.path]: { ...buffers[file.path], editorText: "draft and newer typing" },
      }));
      return { success: true, version: fileVersion };
    });
    commandMocks.renameFile.mockResolvedValue({ success: false, error: "permission denied" });
    const { result } = renderActions(useFileRename, store);
    expect(await act(() => result.current.saveRename(file.path, "New"))).toMatchObject({ success: false });
    expect(commandMocks.renameFile).toHaveBeenCalled();
    expect(store.get(fileBuffersByPathAtom)[file.path]).toMatchObject({
      savedText: "draft",
      editorText: "draft and newer typing",
    });
    expect(store.get(notificationsAtom).at(-1)).toMatchObject({ title: "Rename failed", message: "permission denied" });
    expect(store.get(workspaceTransitionAtom)).toBeNull();
    expect(store.get(notificationsAtom).filter((n) => n.busy)).toHaveLength(0);
  });

  it("remaps an ordered task path after an in-app file rename", async () => {
    const file = note("/notes/Tasks/Old.md");
    let taskBoardSource = JSON.stringify({
      projects: [],
      taskOrder: ["Tasks/Old.md", "Closed.md"],
    });
    window.api = {
      ...window.api,
      doesFileExist: vi.fn(async (path: string) => path === ".todo/taskboard.json"),
      openFile: vi.fn(async () => taskBoardSource),
      upsertFile: vi.fn(async (path: string, content: string) => {
        if (path === ".todo/taskboard.json") taskBoardSource = content;
        return true;
      }),
    } as Window["api"];
    commandMocks.renameFile.mockResolvedValue({ success: true, output: "/notes/Tasks/New.md" });
    const store = createStore();
    store.set(fileTreeAtom, [file]);
    const { result } = renderActions(() => useFileRename(), store);

    expect(await act(() => result.current.saveRename(file.path, "New"))).toMatchObject({ success: true });

    expect(JSON.parse(taskBoardSource).taskOrder).toEqual(["Tasks/New.md", "Closed.md"]);
  });

  it("keeps the current document visible until the target buffer is ready", async () => {
    const current = note("/notes/current.md");
    const target = note("/notes/target.md");
    const store = createStore();
    selectCurrentFile(store, current);
    store.set(fileBuffersByPathAtom, {
      [current.path]: { savedText: "current", editorText: "current" },
    });
    let finishOpen!: (result: { success: true; content: string; version: typeof fileVersion }) => void;
    commandMocks.readTextFile.mockReturnValue(new Promise((resolve) => (finishOpen = resolve)));
    let targetBufferWhenPublished: string | undefined;
    const unsubscribe = store.sub(openWorkspaceItemsByKeyAtom, () => {
      if (store.get(openWorkspaceItemsByKeyAtom)[createFileWorkspaceItem(target).key]) {
        targetBufferWhenPublished = store.get(fileBuffersByPathAtom)[target.path]?.editorText;
      }
    });
    const { result } = renderActions(() => useFileOpen(), store);
    let opening!: Promise<boolean>;

    act(() => {
      opening = result.current.open(target);
    });
    await act(() => Promise.resolve());
    expect(store.get(currentFileAtom)?.path).toBe(current.path);

    await act(async () => {
      finishOpen({ success: true, content: "# Target", version: fileVersion });
      await opening;
    });
    unsubscribe();

    expect(targetBufferWhenPublished).toBe("# Target");
    expect(store.get(currentFileAtom)?.path).toBe(target.path);
  });

  it("does not delay a clean note switch with a redundant save", async () => {
    const current = note("/notes/current.md");
    const target = note("/notes/target.md");
    const store = createStore();
    selectCurrentFile(store, current);
    store.set(fileBuffersByPathAtom, {
      [current.path]: { savedText: "current", editorText: "current" },
    });
    const { result } = renderActions(() => useFileOpen(), store);

    expect(await act(() => result.current.open(target))).toBe(true);

    expect(commandMocks.saveFile).not.toHaveBeenCalled();
    expect(commandMocks.readTextFile).toHaveBeenCalledWith(target.path);
    expect(store.get(currentFileAtom)?.path).toBe(target.path);
  });

  it("requests editor focus when the file explorer opens a note", async () => {
    const target = note("/notes/target.md");
    const { result, store } = renderActions(() => useFileOpen());

    expect(await act(() => result.current.open(target, { focusEditor: true }))).toBe(true);

    expect(store.get(editorFocusRequestAtom)).toEqual({
      filePath: target.path,
      paneId: "pane-1",
      revision: 1,
    });
  });

  it("opens an oversized text file without reading or hydrating it", async () => {
    const large = { ...note("/notes/large.md"), sizeBytes: MAX_FULL_TEXT_EDITOR_BYTES + 1 };
    const { result, store } = renderActions(() => useFileOpen());

    expect(await act(() => result.current.open(large))).toBe(true);

    expect(commandMocks.readTextFile).not.toHaveBeenCalled();
    const opened = store.get(openWorkspaceItemsByKeyAtom)[createFileWorkspaceItem(large).key];
    expect(opened?.kind).toBe("file");
    expect(opened?.kind === "file" ? opened.file : null).toEqual(large);
    expect(store.get(fileBuffersByPathAtom)[large.path]).toBeUndefined();
    expect(store.get(recentFilesAtom)).toEqual([large]);
  });

  it("does not save an active oversized preview when opening another resource", async () => {
    const large = { ...note("/notes/large.md"), sizeBytes: MAX_FULL_TEXT_EDITOR_BYTES + 1 };
    const store = createStore();
    selectCurrentFile(store, large);
    const { result } = renderActions(() => useFileOpen(), store);

    expect(await act(() => result.current.open(note("/notes/next.md")))).toBe(true);

    expect(commandMocks.saveFile).not.toHaveBeenCalled();
    expect(commandMocks.readTextFile).toHaveBeenCalledWith("/notes/next.md");
  });

  it("prunes persisted bookmarks after removing a file", async () => {
    const removed = note("/notes/remove.md");
    const store = createStore();
    store.set(bookmarksAtom, [removed]);
    commandMocks.trashFile.mockResolvedValue({ success: true });
    const { result } = renderActions(() => useFileRemove(), store);

    await act(() => result.current.remove(removed));

    expect(store.get(bookmarksAtom)).toEqual([]);
    expect(window.api.upsertFile).toHaveBeenCalledWith(".obim/bookmarks.json", expect.stringContaining('"items": []'));
  });

  it("prunes Board ordering only after a successful Trash operation", async () => {
    const removed = note("/notes/Remove.md");
    let taskBoardSource = JSON.stringify({
      projects: [],
      taskOrder: ["Remove.md", "Closed.md"],
    });
    window.api = {
      ...window.api,
      doesFileExist: vi.fn(async (path: string) => path === ".todo/taskboard.json"),
      openFile: vi.fn(async () => taskBoardSource),
      upsertFile: vi.fn(async (path: string, content: string) => {
        if (path === ".todo/taskboard.json") taskBoardSource = content;
        return true;
      }),
    } as Window["api"];
    commandMocks.trashFile.mockResolvedValue({ success: true });
    const { result } = renderActions(() => useFileRemove());

    expect(await act(() => result.current.remove(removed))).toBe(true);

    expect(JSON.parse(taskBoardSource).taskOrder).toEqual(["Closed.md"]);
  });

  it("moves items to Trash without a native confirmation and preserves references when Trash is refused", async () => {
    const first = note("/notes/First.md");
    const second = note("/notes/Second.md");
    const store = createStore();
    store.set(fileTreeAtom, [first, second]);
    selectCurrentFile(store, first);
    store.set(fileBuffersByPathAtom, { [first.path]: { savedText: "saved", editorText: "draft" } });
    const itemsBefore = store.get(openWorkspaceItemsByKeyAtom);
    const { result } = renderActions(() => useFileRemove(), store);
    const confirm = vi.spyOn(window, "confirm");

    commandMocks.trashFile.mockResolvedValue({ success: false, error: "Trash unavailable" });
    expect(await act(() => result.current.removeMany([first, second]))).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
    expect(commandMocks.trashFile).toHaveBeenCalledTimes(2);
    expect(store.get(openWorkspaceItemsByKeyAtom)).toBe(itemsBefore);
    expect(store.get(fileBuffersByPathAtom)[first.path]).toEqual({ savedText: "draft", editorText: "draft" });
    expect(store.get(reloadRevisionAtom)).toBe(0);
    expect(store.get(notificationsAtom).at(-1)).toMatchObject({
      title: "Could not move file to Trash",
      message: expect.stringContaining("Trash unavailable"),
    });
  });

  it("saves a dirty file before Trash and prunes its buffer only after filesystem success", async () => {
    const file = note("/notes/Dirty.md");
    const store = createStore();
    let finishTrash!: (result: { success: true }) => void;
    store.set(fileBuffersByPathAtom, { [file.path]: { savedText: "saved", editorText: "draft" } });
    commandMocks.trashFile.mockReturnValue(
      new Promise((resolve) => {
        finishTrash = resolve;
      }),
    );
    const { result } = renderActions(() => useFileRemove(), store);
    let removing!: Promise<boolean>;

    act(() => {
      removing = result.current.remove(file);
    });
    await act(() => Promise.resolve());

    expect(commandMocks.saveFile).toHaveBeenCalledWith(file.path, "draft");
    expect(commandMocks.trashFile).toHaveBeenCalledWith(file.path);
    expect(store.get(fileBuffersByPathAtom)[file.path]).toEqual({ savedText: "draft", editorText: "draft" });

    await act(async () => {
      finishTrash({ success: true });
      await removing;
    });
    expect(store.get(fileBuffersByPathAtom)[file.path]).toBeUndefined();
  });

  it("does not Trash a dirty file when its prerequisite save fails", async () => {
    const file = note("/notes/Dirty.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, { [file.path]: { savedText: "saved", editorText: "draft" } });
    commandMocks.saveFile.mockResolvedValue({ success: false, error: "read only" });
    const { result } = renderActions(() => useFileRemove(), store);

    expect(await act(() => result.current.remove(file))).toBe(false);

    expect(commandMocks.trashFile).not.toHaveBeenCalled();
    expect(store.get(fileBuffersByPathAtom)[file.path]).toEqual({ savedText: "saved", editorText: "draft" });
  });

  it("does not start a Trash batch when any dirty prerequisite save fails", async () => {
    const first = note("/notes/First.md");
    const second = note("/notes/Second.md");
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [first.path]: { savedText: "saved", editorText: "first draft" },
      [second.path]: { savedText: "saved", editorText: "second draft" },
    });
    commandMocks.saveFile
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: "read only" });
    const { result } = renderActions(() => useFileRemove(), store);

    expect(await act(() => result.current.removeMany([first, second]))).toEqual([]);

    expect(commandMocks.saveFile).toHaveBeenCalledTimes(2);
    expect(commandMocks.trashFile).not.toHaveBeenCalled();
    expect(store.get(fileBuffersByPathAtom)[second.path]).toEqual({
      savedText: "saved",
      editorText: "second draft",
    });
  });

  it("saves dirty descendants before moving a directory to Trash", async () => {
    const folder = directory("/notes/Folder");
    const childPath = "/notes/Folder/Child.md";
    const store = createStore();
    store.set(fileBuffersByPathAtom, { [childPath]: { savedText: "saved", editorText: "draft" } });
    commandMocks.trashFile.mockResolvedValue({ success: true });
    const { result } = renderActions(() => useFileRemove(), store);

    expect(await act(() => result.current.remove(folder))).toBe(true);

    expect(commandMocks.saveFile).toHaveBeenCalledWith(childPath, "draft");
    expect(commandMocks.saveFile.mock.invocationCallOrder[0]).toBeLessThan(
      commandMocks.trashFile.mock.invocationCallOrder[0],
    );
    expect(store.get(fileBuffersByPathAtom)[childPath]).toBeUndefined();
  });

  it("clears the context-menu request before removing from the filesystem", async () => {
    const store = createStore();
    setContextMenuRequest(store);
    commandMocks.trashFile.mockImplementation(async () => {
      expect(store.get(contextMenuRequestAtom)).toBeNull();
      return { success: false, error: "cancelled" };
    });
    const { result } = renderActions(() => useFileRemove(), store);

    await act(() => result.current.remove(note("/notes/remove.md")));

    expect(commandMocks.trashFile).toHaveBeenCalledOnce();
    expect(store.get(contextMenuRequestAtom)).toBeNull();
  });

  it("clears the context-menu request before renaming in the filesystem", async () => {
    const file = note("/notes/old.md");
    const store = createStore();
    store.set(fileTreeAtom, [file]);
    setContextMenuRequest(store);
    commandMocks.renameFile.mockImplementation(async () => {
      expect(store.get(contextMenuRequestAtom)).toBeNull();
      return { success: false, error: "cancelled" };
    });
    const { result } = renderActions(() => useFileRename(), store);

    await act(() => result.current.saveRename(file.path, "renamed"));

    expect(commandMocks.renameFile).toHaveBeenCalledOnce();
    expect(store.get(contextMenuRequestAtom)).toBeNull();
  });

  it("leaves the workspace intact when saving a dirty file blocks an open", async () => {
    const current = note("/notes/current.md");
    const target = note("/notes/target.md");
    const store = createStore();
    selectCurrentFile(store, current);
    store.set(fileBuffersByPathAtom, {
      [current.path]: { savedText: "saved", editorText: "unsaved draft" },
    });
    commandMocks.saveFile.mockResolvedValue({ success: false, error: "disk full" });
    const panesBefore = store.get(workspacePanesAtom);
    const tabsBefore = store.get(workspaceTabsByIdAtom);
    const itemsBefore = store.get(openWorkspaceItemsByKeyAtom);
    const buffersBefore = store.get(fileBuffersByPathAtom);
    const { result } = renderActions(() => useFileOpen(), store);

    const opened = await act(() => result.current.open(target));

    expect(opened).toBe(false);
    expect(commandMocks.readTextFile).not.toHaveBeenCalled();
    expect(store.get(workspacePanesAtom)).toBe(panesBefore);
    expect(store.get(workspaceTabsByIdAtom)).toBe(tabsBefore);
    expect(store.get(openWorkspaceItemsByKeyAtom)).toBe(itemsBefore);
    expect(store.get(fileBuffersByPathAtom)).toBe(buffersBefore);
    expect(store.get(recentFilesAtom)).toEqual([]);
  });
});
