import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { useFileCreate, useFileMove, useFileRename } from "../../src/renderer/src/features/files/fileActions";
import { attachPdfNote, createPdfNote, getExplorerSnapshot, movePdfWithNotes } from "../../src/main/explorer-pdf-notes";
import { moveWorkspaceItemWithLinks } from "../../src/main/workspace-linked-move";
import { readWorkspaceTextFile } from "../../src/main/workspace-files";
import { overwriteWorkspaceFileIfVersion } from "../../src/main/workspace-mutations";
import { WorkspaceTransitionStatus } from "../../src/renderer/src/app/WorkspaceTransitionStatus";
import {
  beginWorkspaceTransition,
  workspaceTransitionAtom,
} from "../../src/renderer/src/store/workspaceTransitionStore";
import { buildExplorerTreeLookup } from "../../src/renderer/src/features/files/explorer/fileExplorerTreeUtils";
import { fileBuffersByPathAtom } from "../../src/renderer/src/store/fileBufferStore";
import { bookmarksAtom } from "../../src/renderer/src/store/bookmarkStore";
import {
  expandedDirectoriesAtom,
  explorerSelectionPathsAtom,
  fileExplorerRevealRequestAtom,
  fileTreeAtom,
  pendingFileRenameAtom,
  pendingFileMoveIntentsAtom,
  recentFilesAtom,
} from "../../src/renderer/src/store/fileExplorerStore";
import { workspacePanesAtom } from "../../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../../src/renderer/src/store/editorTabStore";
import { currentFilePathAtom, openWorkspaceItemsByKeyAtom } from "../../src/renderer/src/store/workspaceResourceStore";
import { createFileWorkspaceItem } from "../../src/shared/workspace";
import { notificationsAtom } from "../../src/renderer/src/store/NotificationsStore";
import type { FileItem } from "../../src/shared/file-item";
const state = vi.hoisted(() => ({ taskMoves: vi.fn(async () => true), bookmarks: vi.fn(async () => {}) }));
vi.mock("@renderer/features/workspace/taskBoardConfig", () => ({
  remapTaskBoardOrderAfterFileMoves: state.taskMoves,
  remapTaskBoardOrderAfterFileMove: vi.fn(async () => true),
}));
vi.mock("@renderer/features/files/bookmarkPersistence", () => ({ saveBookmarks: state.bookmarks }));
const roots: string[] = [];
const originalApi = window.api;
afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  window.api = originalApi;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
beforeEach(() => {
  state.taskMoves.mockResolvedValue(true);
});
const flatten = (items: FileItem[]): FileItem[] =>
  items.flatMap((item) => [item, ...(item.isDirectory ? flatten(item.children ?? []) : [])]);
const setup = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "obim-pdf-renderer-"));
  roots.push(root);
  await mkdir(path.join(root, "Paper.pdf.notes"));
  await mkdir(path.join(root, "Archive"));
  await writeFile(path.join(root, "Paper.pdf"), "PDF bytes");
  await writeFile(path.join(root, "Paper.pdf.notes/Summary.md"), "[PDF](../Paper.pdf#page=2)");
  await writeFile(path.join(root, "outside.md"), "[[Paper.pdf.notes/Summary]]");
  const store = createStore();
  const snapshot = await getExplorerSnapshot(root);
  store.set(fileTreeAtom, snapshot.items);
  const all = flatten(snapshot.items);
  const pdf = all.find((item) => item.path.endsWith("/Paper.pdf"))!;
  const note = all.find((item) => item.path.endsWith("/Summary.md"))!;
  const noteResource = createFileWorkspaceItem(note);
  const pdfResource = createFileWorkspaceItem(pdf);
  const noteTab = createEditorTab("note", noteResource.key);
  const pdfTab = createEditorTab("pdf", pdfResource.key);
  store.set(workspacePanesAtom, [{ id: "pane-1", size: 1, tabs: [noteTab.id, pdfTab.id], activeTabId: pdfTab.id }]);
  store.set(workspaceTabsByIdAtom, { note: noteTab, pdf: pdfTab });
  store.set(openWorkspaceItemsByKeyAtom, { [noteResource.key]: noteResource, [pdfResource.key]: pdfResource });
  const opened = await readWorkspaceTextFile(note.path);
  store.set(fileBuffersByPathAtom, {
    [note.path]: { savedText: opened.content, editorText: `${opened.content}\nMy draft`, version: opened.version },
  });
  store.set(bookmarksAtom, [note]);
  store.set(recentFilesAtom, [note, pdf]);
  store.set(explorerSelectionPathsAtom, [pdf.path, note.path]);
  store.set(expandedDirectoriesAtom, new Set(["Paper.pdf.notes"]));
  window.config = { getMainDirectoryPathSync: () => root, isMacOS: true } as Window["config"];
  window.api = {
    ...originalApi,
    getExplorerSnapshot: vi.fn(() => getExplorerSnapshot(root)),
    movePdfWithNotes: vi.fn((request) => movePdfWithNotes(root, request)),
    attachPdfNote: vi.fn((request) => attachPdfNote(root, request)),
    moveFile: vi.fn<Window["api"]["moveFile"]>(async (source, directory) => {
      const moved = await moveWorkspaceItemWithLinks(root, source, path.join(directory, path.basename(source)));
      return moved ? { success: true, ...moved } : { success: false, error: "Destination exists" };
    }),
    renameFile: vi.fn<Window["api"]["renameFile"]>(async (source, filename) => {
      const moved = await moveWorkspaceItemWithLinks(root, source, path.join(path.dirname(source), filename));
      return moved ? { success: true, ...moved } : { success: false, error: "Destination exists" };
    }),
    createPdfNote: vi.fn((request) => createPdfNote(root, request)),
    openTextFile: vi.fn((filePath) => readWorkspaceTextFile(filePath)),
    saveFile: vi.fn((filePath, content, version) => overwriteWorkspaceFileIfVersion(filePath, content, version)),
  };
  return {
    root,
    store,
    pdf,
    note,
    wrapper: ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>,
  };
};

it("saves drafts before grouped renames and remaps buffers, tabs, bookmarks, selection and expansion together", async () => {
  const { root, store, pdf, note, wrapper } = await setup();
  const { result } = renderHook(() => useFileRename({ withPdfNotes: true }), { wrapper });
  let outcome: Awaited<ReturnType<typeof result.current.saveRename>>;
  await act(async () => {
    outcome = await result.current.saveRename(pdf.path, "Renamed.pdf");
  });
  expect(outcome!).toMatchObject({ success: true, newPath: path.join(root, "Renamed.pdf") });
  const movedNote = path.join(root, "Renamed.pdf.notes/Summary.md");
  expect(await readFile(movedNote, "utf8")).toBe("[PDF](../Renamed.pdf#page=2)\nMy draft");
  expect(await readFile(path.join(root, "outside.md"), "utf8")).toBe("[[Renamed.pdf.notes/Summary]]");
  expect(window.api.saveFile).toHaveBeenCalledWith(
    note.path,
    "[PDF](../Paper.pdf#page=2)\nMy draft",
    expect.any(Object),
  );
  expect(store.get(fileBuffersByPathAtom)[movedNote]).toMatchObject({
    editorText: "[PDF](../Renamed.pdf#page=2)\nMy draft",
    savedText: "[PDF](../Renamed.pdf#page=2)\nMy draft",
  });
  expect(store.get(fileBuffersByPathAtom)[note.path]).toBeUndefined();
  expect(store.get(bookmarksAtom)[0].path).toBe(movedNote);
  expect(store.get(recentFilesAtom).map((file) => file.path)).toEqual([movedNote, path.join(root, "Renamed.pdf")]);
  expect(store.get(explorerSelectionPathsAtom)).toEqual([path.join(root, "Renamed.pdf"), movedNote]);
  expect(store.get(expandedDirectoriesAtom)).toContain("Renamed.pdf.notes");
  expect(Object.keys(store.get(openWorkspaceItemsByKeyAtom))).toContain(
    createFileWorkspaceItem({ ...note, path: movedNote }).key,
  );
  expect(state.taskMoves).toHaveBeenCalledWith(
    expect.arrayContaining([
      { fromPath: path.join(root, "Paper.pdf.notes"), toPath: path.join(root, "Renamed.pdf.notes"), directory: true },
    ]),
  );
  expect(store.get(pendingFileRenameAtom)).toBe(false);
});

it("does not call the grouped backend if a dirty note conflicts while saving", async () => {
  const { store, pdf, note, wrapper } = await setup();
  await writeFile(note.path, "external edits");
  const { result } = renderHook(() => useFileRename({ withPdfNotes: true }), { wrapper });
  await act(async () => {
    expect(await result.current.saveRename(pdf.path, "Renamed.pdf")).toMatchObject({ success: false });
  });
  expect(window.api.movePdfWithNotes).not.toHaveBeenCalled();
  expect(await readFile(pdf.path, "utf8")).toBe("PDF bytes");
  expect(store.get(fileBuffersByPathAtom)[note.path].editorText).toContain("My draft");
  expect(store.get(pendingFileRenameAtom)).toBe(false);
});

it("moves a PDF and its notes once when both it and a child are selected", async () => {
  const { root, store, pdf, note, wrapper } = await setup();
  const { result } = renderHook(() => useFileMove({ withPdfNotes: true }), { wrapper });
  await act(async () => {
    expect(await result.current.moveManyToDirectory([pdf, note], path.join(root, "Archive"))).toMatchObject({
      moved: [{ file: pdf, movedPath: path.join(root, "Archive/Paper.pdf") }],
      failures: [],
    });
  });
  expect(window.api.movePdfWithNotes).toHaveBeenCalledTimes(1);
  expect(store.get(fileBuffersByPathAtom)[path.join(root, "Archive/Paper.pdf.notes/Summary.md")].editorText).toContain(
    "My draft",
  );
  expect(store.get(expandedDirectoriesAtom)).toContain("Archive/Paper.pdf.notes");
});

it("creates a real note, expands its PDF and opens the note while preserving the existing PDF", async () => {
  const { root, store, pdf, wrapper } = await setup();
  const { result } = renderHook(() => useFileCreate(), { wrapper });
  await act(async () => {
    await result.current.createPdfNote(pdf);
  });
  const created = path.join(root, "Paper.pdf.notes/Untitled 1.md");
  expect(await readFile(created, "utf8")).toBe("");
  expect(await readFile(pdf.path, "utf8")).toBe("PDF bytes");
  expect(store.get(expandedDirectoriesAtom)).toContain("Paper.pdf.notes");
  expect(store.get(fileExplorerRevealRequestAtom)).toEqual({ relativePath: "Paper.pdf.notes/Untitled 1.md" });
  expect(store.get(currentFilePathAtom)).toBe(created);
  expect(store.get(notificationsAtom).some((entry) => entry.level === "error")).toBe(false);
});

it("reconciles only observed missing-source paths after a partial move and retains the error", async () => {
  const { root, store, pdf, note, wrapper } = await setup();
  const realMove = window.api.movePdfWithNotes;
  window.api.movePdfWithNotes = vi.fn<Window["api"]["movePdfWithNotes"]>(async (request) => {
    const moved = await realMove(request);
    if (!moved.success) throw new Error(moved.error);
    return {
      success: false,
      error: "Partial restoration",
      errorCode: "partial",
      revision: moved.revision,
      recoveryPaths: moved.movedRoots.map((entry) => ({ ...entry, sourceExists: false, destinationExists: true })),
    };
  });
  const { result } = renderHook(() => useFileRename({ withPdfNotes: true }), { wrapper });
  await act(async () => {
    expect(await result.current.saveRename(pdf.path, "Renamed.pdf")).toMatchObject({ success: false });
  });
  const destination = path.join(root, "Renamed.pdf.notes/Summary.md");
  expect(store.get(fileBuffersByPathAtom)[destination].editorText).toBe(await readFile(destination, "utf8"));
  expect(store.get(fileBuffersByPathAtom)[note.path]).toBeUndefined();
  expect(store.get(notificationsAtom).at(-1)?.message).toBe("Partial restoration");
});

it("does not guess a move when both original and destination paths survive", async () => {
  const { root, store, pdf, note, wrapper } = await setup();
  await writeFile(path.join(root, "Renamed.pdf"), "external PDF");
  window.api.movePdfWithNotes = vi.fn<Window["api"]["movePdfWithNotes"]>(async () => ({
    success: false,
    error: "Both paths survived",
    errorCode: "partial",
    revision: 1,
    recoveryPaths: [
      { source: pdf.path, destination: path.join(root, "Renamed.pdf"), sourceExists: true, destinationExists: true },
    ],
  }));
  const { result } = renderHook(() => useFileRename({ withPdfNotes: true }), { wrapper });
  await act(async () => {
    expect(await result.current.saveRename(pdf.path, "Another.pdf")).toMatchObject({ success: false });
  });
  expect(store.get(fileBuffersByPathAtom)[note.path].editorText).toContain("My draft");
  expect(store.get(bookmarksAtom)[0].path).toBe(note.path);
  expect(await readFile(path.join(root, "Renamed.pdf"), "utf8")).toBe("external PDF");
});

it("keeps a successfully created note open if the subsequent tree refresh fails", async () => {
  const { root, store, pdf, wrapper } = await setup();
  window.api.getExplorerSnapshot = vi.fn().mockRejectedValue(new Error("disconnected"));
  const { result } = renderHook(() => useFileCreate(), { wrapper });
  await act(async () => {
    await result.current.createPdfNote(pdf);
  });
  expect(store.get(currentFilePathAtom)).toBe(path.join(root, "Paper.pdf.notes/Untitled 1.md"));
  expect(await readFile(path.join(root, "Paper.pdf.notes/Untitled 1.md"), "utf8")).toBe("");
  expect(store.get(notificationsAtom).at(-1)?.title).toBe("Note created");
});

it("retains single-file rename behavior outside the explorer", async () => {
  const { root, pdf, wrapper } = await setup();
  const { result } = renderHook(() => useFileRename(), { wrapper });
  await act(async () => {
    expect(await result.current.saveRename(pdf.path, "Renamed.pdf")).toMatchObject({ success: true });
  });
  expect(window.api.movePdfWithNotes).not.toHaveBeenCalled();
  expect(await readFile(path.join(root, "Paper.pdf.notes/Summary.md"), "utf8")).toContain("My draft");
  expect((await getExplorerSnapshot(root)).pdfNotesGroups).toEqual([]);
});

it("attaches to a leaf PDF without Add note, saves drafts, repairs links and reveals the real destination", async () => {
  const { root, store, note, wrapper } = await setup();
  const pdfPath = path.join(root, "Fresh.pdf");
  await writeFile(pdfPath, "another PDF");
  const snapshot = await getExplorerSnapshot(root);
  store.set(fileTreeAtom, snapshot.items);
  const pdf = snapshot.items.find((file) => file.path === pdfPath)!;
  const { result } = renderHook(() => useFileMove({ withPdfNotes: true }), { wrapper });
  const destination = `${pdfPath}.notes/Summary.md`;
  await act(async () => {
    expect(await result.current.attachManyToPdf([note], pdf)).toMatchObject({
      moved: [{ file: note, movedPath: destination }],
      failures: [],
    });
  });
  expect(window.api.createPdfNote).not.toHaveBeenCalled();
  expect(window.api.attachPdfNote).toHaveBeenCalledWith({ pdfPath, notePath: note.path });
  expect(window.api.saveFile).toHaveBeenCalledBefore(vi.mocked(window.api.attachPdfNote));
  expect(await readFile(destination, "utf8")).toBe("[PDF](../Paper.pdf#page=2)\nMy draft");
  expect(await readFile(path.join(root, "outside.md"), "utf8")).toBe("[[Fresh.pdf.notes/Summary]]");
  expect(store.get(fileBuffersByPathAtom)[destination]?.editorText).toContain("My draft");
  expect(store.get(bookmarksAtom)[0].path).toBe(destination);
  expect(store.get(expandedDirectoriesAtom)).toContain("Fresh.pdf.notes");
  expect(store.get(fileExplorerRevealRequestAtom)).toEqual({
    relativePath: "Fresh.pdf.notes/Summary.md",
    preserveSelection: true,
  });
  expect(
    (await getExplorerSnapshot(root)).pdfNotesGroups.find((group) => group.pdfPath === pdfPath)?.childPaths,
  ).toEqual([destination]);
});

it("detaches a note physically and reattaches it with collision numbering and ordinary Markdown identity", async () => {
  const { root, store, note, pdf, wrapper } = await setup();
  const { result } = renderHook(() => useFileMove({ withPdfNotes: true }), { wrapper });
  const detached = path.join(root, "Summary.md");
  await act(async () => {
    expect(await result.current.moveToDirectory(note, root)).toMatchObject({ moved: true, movedPath: detached });
  });
  expect(await readFile(detached, "utf8")).toBe("[PDF](Paper.pdf#page=2)\nMy draft");
  const after = await getExplorerSnapshot(root);
  expect(after.pdfNotesGroups[0].childPaths).toEqual([]);
  expect(after.items.find((file) => file.path === detached)).toMatchObject({
    mimeType: "text/markdown",
    isDirectory: false,
  });
  expect(store.get(fileBuffersByPathAtom)[detached]?.editorText).toContain("My draft");
  expect(store.get(fileBuffersByPathAtom)[note.path]).toBeUndefined();
  await writeFile(note.path, "existing note");
  const detachedFile = after.items.find((file) => file.path === detached)!;
  let attached: Awaited<ReturnType<typeof result.current.attachManyToPdf>>;
  await act(async () => {
    attached = await result.current.attachManyToPdf([detachedFile], pdf);
  });
  expect(attached!.failures).toEqual([]);
  expect(attached!.moved[0].movedPath).not.toBe(note.path);
  expect(await readFile(note.path, "utf8")).toBe("existing note");
  expect(await readFile(attached!.moved[0].movedPath, "utf8")).toBe("[PDF](Paper.pdf#page=2)\nMy draft");
  expect(store.get(bookmarksAtom)[0].path).toBe(attached!.moved[0].movedPath);
});

it("refuses attachment when saving a draft conflicts, leaving the PDF unannotated", async () => {
  const { root, store, note, wrapper } = await setup();
  const pdfPath = path.join(root, "Fresh.pdf");
  await writeFile(pdfPath, "pdf");
  const items = (await getExplorerSnapshot(root)).items;
  store.set(fileTreeAtom, items);
  await writeFile(note.path, "external edit");
  const { result } = renderHook(() => useFileMove({ withPdfNotes: true }), { wrapper });
  await act(async () => {
    const outcome = await result.current.attachManyToPdf(
      [note],
      items.find((file) => file.path === pdfPath)!,
    );
    expect(outcome.moved).toEqual([]);
    expect(outcome.failures).toHaveLength(1);
  });
  expect(window.api.attachPdfNote).not.toHaveBeenCalled();
  expect((await getExplorerSnapshot(root)).items.some((file) => file.path === `${pdfPath}.notes`)).toBe(false);
  expect(store.get(fileBuffersByPathAtom)[note.path]?.editorText).toContain("My draft");
});

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

it.each(["rename", "move"])(
  "updates a grouped PDF %s immediately, stays quiet and preserves typing during saves and link repair",
  async (kind) => {
    const { root, store, pdf, note, wrapper } = await setup();
    render(<WorkspaceTransitionStatus />, { wrapper });
    const saveGate = gate();
    const moveGate = gate();
    const realSave = window.api.saveFile;
    const realMove = window.api.movePdfWithNotes;
    window.api.saveFile = vi.fn<Window["api"]["saveFile"]>(async (...args) => {
      await saveGate.promise;
      return realSave(...args);
    });
    window.api.movePdfWithNotes = vi.fn(async (request) => {
      await moveGate.promise;
      return realMove(request);
    });
    const { result } = renderHook(
      () => ({ rename: useFileRename({ withPdfNotes: true }), move: useFileMove({ withPdfNotes: true }) }),
      { wrapper },
    );
    const destination = path.join(root, kind === "rename" ? "Renamed.pdf" : "Archive/Paper.pdf");
    const movedNote = `${destination}.notes/Summary.md`;
    let operation!: Promise<unknown>;
    act(() => {
      operation =
        kind === "rename"
          ? result.current.rename.saveRename(pdf.path, "Renamed.pdf")
          : result.current.move.moveToDirectory(pdf, path.join(root, "Archive"));
    });
    expect(store.get(workspaceTransitionAtom)?.background).toBe(true);
    expect(flatten(store.get(fileTreeAtom)).map((item) => item.path)).toContain(movedNote);
    expect(flatten(store.get(fileTreeAtom)).map((item) => item.path)).not.toContain(note.path);
    expect(store.get(bookmarksAtom)[0].path).toBe(movedNote);
    expect(store.get(explorerSelectionPathsAtom)).toEqual([destination, movedNote]);
    expect(await readFile(pdf.path, "utf8")).toBe("PDF bytes");
    const type = (suffix: string) =>
      act(() => {
        store.set(fileBuffersByPathAtom, (buffers) => ({
          ...buffers,
          [movedNote]: { ...buffers[movedNote], editorText: buffers[movedNote].editorText + suffix },
        }));
      });
    await act(async () => {
      await Promise.resolve();
    });
    type("\nDuring save");
    await act(async () => {
      saveGate.release();
    });
    await waitFor(() => expect(window.api.movePdfWithNotes).toHaveBeenCalledOnce());
    type("\nDuring link repair");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(store.get(notificationsAtom)).toEqual([]);
    await act(async () => {
      moveGate.release();
      await operation;
    });
    const link = kind === "rename" ? "[PDF](../Renamed.pdf#page=2)" : "[PDF](../Paper.pdf#page=2)";
    // The link remains relative to the note's new physical folder.
    expect(store.get(fileBuffersByPathAtom)[movedNote].editorText).toBe(
      `${link}\nMy draft\nDuring save\nDuring link repair`,
    );
    expect(store.get(fileBuffersByPathAtom)[movedNote].savedText).toBe(await readFile(movedNote, "utf8"));
    expect(store.get(workspaceTransitionAtom)).toBeNull();
    expect(store.get(notificationsAtom)).toEqual([]);
    if (kind === "move") {
      const archive = store.get(fileTreeAtom).find((item) => item.relativePath === "Archive");
      expect(archive?.children?.map((item) => item.path)).toEqual(
        expect.arrayContaining([destination, `${destination}.notes`]),
      );
    }
  },
);

it("shows the first attached note immediately, then reconciles a collision that appears on disk", async () => {
  const { root, store, note, wrapper } = await setup();
  const pdfPath = path.join(root, "Fresh.pdf");
  await writeFile(pdfPath, "PDF");
  const items = (await getExplorerSnapshot(root)).items;
  store.set(fileTreeAtom, items);
  const pdf = items.find((file) => file.path === pdfPath)!;
  store.set(explorerSelectionPathsAtom, [note.path]);
  store.set(fileExplorerRevealRequestAtom, {
    relativePath: note.relativePath,
    preserveSelection: true,
    restoreFocus: true,
  });
  const pending = gate();
  const realAttach = window.api.attachPdfNote;
  window.api.attachPdfNote = vi.fn(async (request) => {
    await pending.promise;
    return realAttach(request);
  });
  const { result } = renderHook(() => useFileMove({ withPdfNotes: true }), { wrapper });
  const predicted = `${pdfPath}.notes/Summary.md`;
  let operation!: ReturnType<typeof result.current.attachManyToPdf>;
  await act(async () => {
    operation = result.current.attachManyToPdf([note], pdf);
  });
  const tree = store.get(fileTreeAtom);
  expect(tree.find((item) => item.path === `${pdfPath}.notes`)?.children?.map((item) => item.path)).toEqual([
    predicted,
  ]);
  expect(buildExplorerTreeLookup(tree).paths).toContain("Fresh.pdf.notes/Summary.md");
  expect(store.get(explorerSelectionPathsAtom)).toEqual([predicted]);
  expect(store.get(fileExplorerRevealRequestAtom)).toMatchObject({
    relativePath: "Fresh.pdf.notes/Summary.md",
    restoreFocus: true,
  });
  expect(store.get(notificationsAtom)).toEqual([]);
  expect(store.get(workspaceTransitionAtom)?.background).toBe(true);
  await mkdir(`${pdfPath}.notes`);
  await writeFile(predicted, "external note");
  act(() =>
    store.set(fileBuffersByPathAtom, (buffers) => ({
      ...buffers,
      [predicted]: { ...buffers[predicted], editorText: buffers[predicted].editorText + "\nNew typing" },
    })),
  );
  let movedPath!: string;
  await act(async () => {
    pending.release();
    movedPath = (await operation).moved[0].movedPath;
  });
  expect(movedPath).toBe(`${pdfPath}.notes/Summary 1.md`);
  expect(await readFile(predicted, "utf8")).toBe("external note");
  expect(store.get(fileBuffersByPathAtom)[movedPath].editorText).toContain("New typing");
  expect(store.get(fileBuffersByPathAtom)[predicted]).toBeUndefined();
  expect(store.get(bookmarksAtom)[0].path).toBe(movedPath);
  expect(store.get(explorerSelectionPathsAtom)).toEqual([movedPath]);
  expect(flatten(store.get(fileTreeAtom)).filter((item) => item.path.startsWith(`${pdfPath}.notes/`))).toHaveLength(2);
});

it.each([true, false])(
  "detaches immediately without an empty PDF chevron and preserves typing when success=%s",
  async (success) => {
    const { root, store, note, wrapper } = await setup();
    render(<WorkspaceTransitionStatus />, { wrapper });
    store.set(explorerSelectionPathsAtom, [note.path]);
    const pending = gate();
    const realMove = window.api.moveFile;
    window.api.moveFile = vi.fn<Window["api"]["moveFile"]>(async (...args) => {
      await pending.promise;
      return success ? realMove(...args) : { success: false, error: "Permission denied" };
    });
    const { result } = renderHook(() => useFileMove({ withPdfNotes: true }), { wrapper });
    const detached = path.join(root, "Summary.md");
    let operation!: ReturnType<typeof result.current.moveToDirectory>;
    await act(async () => {
      operation = result.current.moveToDirectory(note, root);
    });
    expect(store.get(fileTreeAtom).some((item) => item.path === detached)).toBe(true);
    expect(store.get(fileTreeAtom).find((item) => item.relativePath === "Paper.pdf.notes")?.children).toEqual([]);
    expect(buildExplorerTreeLookup(store.get(fileTreeAtom)).paths).toContain("Paper.pdf");
    expect(buildExplorerTreeLookup(store.get(fileTreeAtom)).paths).not.toContain("Paper.pdf.notes/");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(store.get(notificationsAtom)).toEqual([]);
    act(() =>
      store.set(fileBuffersByPathAtom, (buffers) => ({
        ...buffers,
        [detached]: { ...buffers[detached], editorText: buffers[detached].editorText + "\nNew typing" },
      })),
    );
    await act(async () => {
      pending.release();
      expect(await operation).toMatchObject({ moved: success });
    });
    const finalPath = success ? detached : note.path;
    expect(store.get(fileBuffersByPathAtom)[finalPath].editorText).toContain("New typing");
    expect(store.get(explorerSelectionPathsAtom)).toEqual([finalPath]);
    if (!success)
      expect(store.get(fileTreeAtom).find((item) => item.relativePath === "Paper.pdf.notes")?.children?.[0].path).toBe(
        note.path,
      );
    expect(store.get(workspaceTransitionAtom)).toBeNull();
  },
);

it.each([true, false])(
  "accepts consecutive attachments while the first is pending, including first success=%s",
  async (firstSucceeds) => {
    const { root, store, pdf, wrapper } = await setup();
    const names = ["one.md", "two.md", "three.md"];
    for (const name of names) await writeFile(path.join(root, name), name);
    const snapshot = await getExplorerSnapshot(root);
    store.set(fileTreeAtom, snapshot.items);
    const notes = names.map((name) => snapshot.items.find((file) => file.relativePath === name)!);
    const first = gate();
    const realAttach = window.api.attachPdfNote;
    window.api.attachPdfNote = vi.fn<Window["api"]["attachPdfNote"]>(async (request) => {
      if (request.notePath === notes[0].path) {
        await first.promise;
        if (!firstSucceeds) return { success: false, error: "Permission denied", revision: 0 };
      }
      return realAttach(request);
    });
    const { result } = renderHook(() => useFileMove({ withPdfNotes: true }), { wrapper });
    let operations!: ReturnType<typeof result.current.attachManyToPdf>[];
    await act(async () => {
      operations = notes.map((note) => result.current.attachManyToPdf([note], pdf));
    });
    await waitFor(() => expect(window.api.attachPdfNote).toHaveBeenCalledOnce());
    expect(store.get(notificationsAtom)).toEqual([]);
    let outcomes!: Awaited<(typeof operations)[number]>[];
    await act(async () => {
      first.release();
      outcomes = await Promise.all(operations);
    });
    expect(outcomes.map((outcome) => outcome.moved.length)).toEqual([Number(firstSucceeds), 1, 1]);
    expect(vi.mocked(window.api.attachPdfNote).mock.calls.map(([request]) => request.notePath)).toEqual(
      notes.map((note) => note.path),
    );
    expect(store.get(notificationsAtom).some((n) => n.message?.includes("Wait for the workspace operation"))).toBe(
      false,
    );
    for (const note of notes.slice(firstSucceeds ? 0 : 1))
      expect(await readFile(`${pdf.path}.notes/${path.basename(note.path)}`, "utf8")).toBe(path.basename(note.path));
    expect(store.get(workspaceTransitionAtom)).toBeNull();
  },
);

it("cancels a queued attachment if its workspace changes before execution", async () => {
  const { store, root, pdf, note, wrapper } = await setup();
  const before = store.get(fileTreeAtom);
  const lease = beginWorkspaceTransition(store, "Updating note links…", true)!;
  const { result } = renderHook(() => useFileMove({ withPdfNotes: true }), { wrapper });
  let operation!: ReturnType<typeof result.current.attachManyToPdf>;
  act(() => {
    operation = result.current.attachManyToPdf([note], pdf);
  });
  window.config = { ...window.config, getMainDirectoryPathSync: () => `${root}-other` };
  await act(async () => {
    lease.release();
    expect((await operation).failures[0].error).toContain("Workspace changed");
  });
  expect(window.api.attachPdfNote).not.toHaveBeenCalled();
  expect(store.get(fileTreeAtom)).toBe(before);
});

it("rebases a queued drag from a provisional path after collision correction", async () => {
  const { root, store, note, wrapper } = await setup();
  const pdfPath = path.join(root, "Fresh.pdf");
  await writeFile(pdfPath, "PDF");
  const items = (await getExplorerSnapshot(root)).items;
  store.set(fileTreeAtom, items);
  const pdf = items.find((item) => item.path === pdfPath)!;
  const pending = gate();
  const realAttach = window.api.attachPdfNote;
  window.api.attachPdfNote = vi.fn(async (request) => {
    await pending.promise;
    return realAttach(request);
  });
  const { result } = renderHook(() => useFileMove({ withPdfNotes: true }), { wrapper });
  let first!: ReturnType<typeof result.current.attachManyToPdf>;
  await act(async () => {
    first = result.current.attachManyToPdf([note], pdf);
  });
  const predicted = flatten(store.get(fileTreeAtom)).find((item) => item.path === `${pdfPath}.notes/Summary.md`)!;
  let second!: ReturnType<typeof result.current.moveManyToDirectory>;
  act(() => {
    second = result.current.moveManyToDirectory([predicted], path.join(root, "Archive"));
  });
  await mkdir(`${pdfPath}.notes`);
  await writeFile(predicted.path, "external note");
  await act(async () => {
    pending.release();
    await first;
    expect((await second).failures).toEqual([]);
  });
  expect(await readFile(predicted.path, "utf8")).toBe("external note");
  expect(await readFile(path.join(root, "Archive/Summary 1.md"), "utf8")).toContain("My draft");
  expect(window.api.moveFile).toHaveBeenCalledWith(`${pdfPath}.notes/Summary 1.md`, path.join(root, "Archive"));
  expect(store.get(pendingFileMoveIntentsAtom)).toEqual({});
});
