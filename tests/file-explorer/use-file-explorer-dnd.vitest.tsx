import { Provider, createStore } from "jotai";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { explorerSelectionPathsAtom, reloadRevisionAtom } from "../../src/renderer/src/store/fileExplorerStore";
import { notificationsAtom } from "../../src/renderer/src/store/NotificationsStore";
import type { FileItem } from "../../src/shared/file-item";
import { FILE_DRAG_DATA_MIME } from "../../src/shared/drag-data";
import { buildTreeLookup } from "../../src/renderer/src/features/files/explorer/fileExplorerTreeUtils";

const state = vi.hoisted(() => ({
  explorerDndOptions: vi.fn(),
  moveManyToDirectory: vi.fn(),
  updateTarget: vi.fn(),
}));

vi.mock("../../src/renderer/src/shared/dnd/AppDndProvider", () => ({
  useAppDndActions: () => ({
    canCommit: () => true,
    complete: vi.fn(),
    getActiveEntity: () => ({ kind: "explorer-item", id: "Source/note.md" }),
    updateTarget: state.updateTarget,
  }),
}));

vi.mock("../../src/renderer/src/features/files/explorer/tree/useExplorerTreeDnd", () => ({
  useExplorerTreeDnd: (options: unknown) => {
    state.explorerDndOptions(options);
    return { clearDragPreview: vi.fn(), dragSourceTreePathRef: { current: null } };
  },
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useFileMove: () => ({ moveManyToDirectory: state.moveManyToDirectory }),
}));

import { useFileExplorerDnd } from "../../src/renderer/src/features/files/explorer/useFileExplorerTreeDnd";

const file = (path: string, relativePath = path.replace("/notes-root/", ""), filename?: string): FileItem => ({
  id: path,
  filename: filename ?? path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
  relativePath,
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const directory = (path: string, children: FileItem[] = []): FileItem => ({
  id: path,
  filename: path.split("/").at(-1) ?? path,
  relativePath: path.replace("/notes-root/", ""),
  path,
  isDirectory: true,
  mimeType: null,
  children,
});

const source = file("/notes-root/Source/note.md");
const destination = directory("/notes-root/Destination");
const sourceDirectory = directory("/notes-root/Source", [source]);
const lookup = buildTreeLookup([sourceDirectory, destination, file("/notes-root/root.md")]);

const makeModel = () => {
  const host = document.createElement("div");
  document.body.append(host);
  return {
    host,
    model: {
      getFileTreeContainer: vi.fn(() => host),
      getSelectedPaths: vi.fn(() => ["Source/note.md"]),
      resetPaths: vi.fn(),
    },
  };
};

const renderDnd = (enabled = true) => {
  const store = createStore();
  const lookupRef = { current: lookup };
  const onDropCompleteRef = { current: vi.fn() };
  const { host, model } = makeModel();
  const view = renderHook(
    () =>
      useFileExplorerDnd({
        enabled,
        expandedTreePaths: ["Source/"],
        lookupRef,
        model: model as never,
        onDropCompleteRef,
      }),
    { wrapper: ({ children }) => <Provider store={store}>{children}</Provider> },
  );
  const options = state.explorerDndOptions.mock.lastCall?.[0] as {
    enabled: boolean;
    getDraggedItemPreviewData: (event: DragEvent, target: { clickedIcon: boolean; rowPath: string }) => unknown;
    onTreeDragOver: (event: DragEvent, target: { rowPath: string } | null) => void;
  };
  return { ...view, host, lookupRef, model, onDropCompleteRef, options, store };
};

const drop = (draggedPaths: string[], directoryPath: string | null, kind: "directory" | "root" = "directory") => ({
  draggedPaths,
  operation: "move" as const,
  target: { directoryPath, flattenedSegmentPath: null, hoveredPath: directoryPath, kind },
});

describe("useFileExplorerDnd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.moveManyToDirectory.mockResolvedValue({ moved: [], failures: [] });
    window.config = { getMainDirectoryPathSync: () => "/notes-root" } as Window["config"];
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it("publishes the current completion callback and disables all execution when requested", async () => {
    const { onDropCompleteRef, options, model, store } = renderDnd(false);
    expect(options.enabled).toBe(false);

    await act(() => onDropCompleteRef.current(drop(["Source/note.md"], "Destination/") as never));

    expect(state.moveManyToDirectory).not.toHaveBeenCalled();
    expect(model.resetPaths).not.toHaveBeenCalled();
    expect(store.get(reloadRevisionAtom)).toBe(0);
  });

  it("rolls Pierre back for an invalid or stale drop without mutating files", async () => {
    const { onDropCompleteRef, model, store } = renderDnd();

    await act(() => onDropCompleteRef.current(drop(["Source/note.md", "missing.md"], "Source/") as never));

    expect(model.resetPaths).toHaveBeenCalledWith(lookup.paths, { initialExpandedPaths: ["Source/"] });
    expect(state.moveManyToDirectory).not.toHaveBeenCalled();
    expect(store.get(explorerSelectionPathsAtom)).toEqual([]);
    expect(store.get(reloadRevisionAtom)).toBe(0);
  });

  it("moves every valid source and restores its selection without owning refresh state", async () => {
    state.moveManyToDirectory.mockResolvedValue({
      moved: [{ file: source, movedPath: "/notes-root/Destination/note.md" }],
      failures: [],
    });
    const { onDropCompleteRef, model, store } = renderDnd();

    await act(() => onDropCompleteRef.current(drop(["missing.md", "Source/note.md"], "Destination/") as never));

    expect(store.get(explorerSelectionPathsAtom)).toEqual(["/notes-root/Destination/note.md"]);
    expect(model.resetPaths).not.toHaveBeenCalled();
    expect(state.moveManyToDirectory).toHaveBeenCalledWith([source], destination.path);
    expect(store.get(reloadRevisionAtom)).toBe(0);
  });

  it("announces aggregate move failures without owning refresh state", async () => {
    state.moveManyToDirectory.mockResolvedValue({
      moved: [{ file: source, movedPath: "/notes-root/Destination/note.md" }],
      failures: [{ file: file("/notes-root/Source/fail.md"), error: "Permission denied" }],
    });
    const { onDropCompleteRef, model, store } = renderDnd();

    await act(() => onDropCompleteRef.current(drop(["Source/note.md"], "Destination/") as never));

    expect(store.get(notificationsAtom)).toEqual([
      expect.objectContaining({
        level: "error",
        message: "1 moved successfully. Permission denied",
        title: "Could not move 1 item",
      }),
    ]);
    expect(model.resetPaths).toHaveBeenCalledWith(lookup.paths, { initialExpandedPaths: ["Source/"] });
    expect(store.get(reloadRevisionAtom)).toBe(0);
  });

  it("writes native file drag data and distinguishes file and directory effects", () => {
    const { options } = renderDnd();
    const setData = vi.fn();
    const fileTransfer = { effectAllowed: "none", setData };
    const filePreview = options.getDraggedItemPreviewData({ dataTransfer: fileTransfer } as unknown as DragEvent, {
      clickedIcon: false,
      rowPath: "Source/note.md",
    });

    expect(fileTransfer.effectAllowed).toBe("copyMove");
    expect(setData).toHaveBeenCalledWith("text/plain", source.path);
    expect(setData).toHaveBeenCalledWith(
      FILE_DRAG_DATA_MIME,
      JSON.stringify({
        filename: source.filename,
        mimeType: source.mimeType,
        path: source.path,
        relativePath: source.relativePath,
      }),
    );
    expect(filePreview).toEqual({ fileName: source.filename, isDirectory: false });

    setData.mockClear();
    const directoryTransfer = { effectAllowed: "none", setData };
    const directoryPreview = options.getDraggedItemPreviewData(
      { dataTransfer: directoryTransfer } as unknown as DragEvent,
      { clickedIcon: true, rowPath: "Destination/" },
    );
    expect(directoryTransfer.effectAllowed).toBe("move");
    expect(setData).toHaveBeenCalledTimes(1);
    expect(directoryPreview).toEqual({ fileName: "Destination", isDirectory: true });
  });

  it("rejects stale preview identities and missing data transfer, with a path-name filename fallback", () => {
    const nameless = file("/notes-root/Source/fallback.md", "Source/fallback.md", "");
    const customLookup = buildTreeLookup([sourceDirectory, nameless]);
    const { options, lookupRef } = renderDnd();
    lookupRef.current = customLookup;

    expect(
      options.getDraggedItemPreviewData({ dataTransfer: null } as DragEvent, {
        clickedIcon: false,
        rowPath: "Source/fallback.md",
      }),
    ).toBeNull();
    expect(
      options.getDraggedItemPreviewData({ dataTransfer: { setData: vi.fn() } } as unknown as DragEvent, {
        clickedIcon: false,
        rowPath: "missing.md",
      }),
    ).toBeNull();
    expect(
      options.getDraggedItemPreviewData(
        { dataTransfer: { effectAllowed: "none", setData: vi.fn() } } as unknown as DragEvent,
        { clickedIcon: false, rowPath: "Source/fallback.md" },
      ),
    ).toEqual(expect.objectContaining({ fileName: "fallback.md" }));
  });

  it("wires tree hover to the Pierre destination resolver", () => {
    const { options, model } = renderDnd();
    options.onTreeDragOver({} as DragEvent, { rowPath: "Destination/" });
    expect(state.updateTarget).toHaveBeenLastCalledWith({
      key: "explorer:Destination/",
      valid: true,
      label: "Move to Destination",
    });
    model.getSelectedPaths.mockReturnValue(["Destination/"]);
    options.onTreeDragOver({} as DragEvent, { rowPath: "Destination/" });
    expect(state.updateTarget).toHaveBeenLastCalledWith(expect.objectContaining({ valid: false }));
  });
});
