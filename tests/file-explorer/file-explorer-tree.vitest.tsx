import { Provider, createStore } from "jotai";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileItem } from "../../src/shared/file-item";
import { FILE_DRAG_DATA_MIME } from "../../src/shared/drag-data";
import { AppDndProvider } from "../../src/renderer/src/shared/dnd/AppDndProvider";

const state = vi.hoisted(() => ({
  dndOptions: vi.fn(),
  modelOptions: vi.fn(),
  dragSourceTreePathRef: { current: null as string | null },
  explorerProps: vi.fn(),
  focusedPath: "A/" as string | null,
  lookupRef: {
    current: {
      byAbsolutePath: new Map<string, string>(),
      byTreePath: new Map<string, FileItem>(),
      directoryTreePaths: [] as string[],
      paths: [] as string[],
    },
  },
  model: null as unknown as {
    batch: ReturnType<typeof vi.fn>;
    getFileTreeContainer: () => HTMLElement | null;
    getFocusedPath: () => string | null;
    getItem: (
      path: string,
    ) => { deselect: () => void; isDirectory: () => boolean; select: () => void; toggle?: () => void } | null;
    getSelectedPaths: () => string[];
  },
  copyItems: vi.fn(() => true),
  open: vi.fn(),
  openDirectoryMenuAt: vi.fn(),
  openFileMenuAt: vi.fn(),
  openRootMenuAt: vi.fn(),
  pasteClipboardData: vi.fn(() => true),
  removeMany: vi.fn(),
  toggleDirectory: vi.fn(),
  toggleAllDirectories: vi.fn(),
}));

vi.mock("../../src/renderer/src/features/files/explorer/tree/ExplorerTree", () => ({
  ExplorerTree: (props: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => {
    state.explorerProps(props);
    return (
      <div
        data-testid="tree"
        onDragEnd={props.onDragEnd as React.DragEventHandler<HTMLDivElement>}
        onDragLeave={props.onDragLeave as React.DragEventHandler<HTMLDivElement>}
        onDragOver={props.onDragOver as React.DragEventHandler<HTMLDivElement>}
        onDrop={props.onDrop as React.DragEventHandler<HTMLDivElement>}
        onDropCapture={props.onDropCapture as React.DragEventHandler<HTMLDivElement>}
      >
        <div data-item-path="A/" data-type="item">
          A
        </div>
        <div data-item-path="A/B/" data-type="item">
          B
        </div>
        <div data-item-path="A/file.md" data-type="item">
          file
        </div>
      </div>
    );
  },
}));

vi.mock("../../src/renderer/src/features/files/explorer/useFileExplorerModel", () => ({
  useFileExplorerModel: (options: unknown) => {
    state.modelOptions(options);
    return {
      expandedTreePaths: ["A/"],
      lookupRef: state.lookupRef,
      model: state.model,
      onDropCompleteRef: { current: () => {} },
      toggleAllDirectories: state.toggleAllDirectories,
    };
  },
}));

vi.mock("../../src/renderer/src/features/files/explorer/useFileExplorerTreeDnd", () => ({
  useFileExplorerDnd: (options: unknown) => {
    state.dndOptions(options);
    return { dragPreview: null, dragSourceTreePathRef: state.dragSourceTreePathRef };
  },
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useFileOpen: () => ({ open: state.open }),
  useFileRemove: () => ({ removeMany: state.removeMany }),
}));

vi.mock("@renderer/features/files/menus/useDirectoryMenu", () => ({
  useDirectoryMenu: () => ({
    openDirectoryMenuAt: state.openDirectoryMenuAt,
    openRootMenuAt: state.openRootMenuAt,
  }),
}));

vi.mock("@renderer/features/files/menus/useFileMenu", () => ({
  useFileMenu: () => ({ openFileMenuAt: state.openFileMenuAt }),
}));

vi.mock("@renderer/features/files/useFileClipboard", () => ({
  useFileClipboard: () => ({
    copyItems: state.copyItems,
    pasteClipboardData: state.pasteClipboardData,
  }),
}));

import {
  FileExplorerTree,
  type FileExplorerTreeHandle,
} from "../../src/renderer/src/features/files/explorer/FileExplorerTree";

const directory = (path: string, relativePath: string): FileItem => ({
  id: path,
  filename: relativePath.split("/").at(-1) ?? "",
  relativePath,
  path,
  isDirectory: true,
  mimeType: null,
  children: [],
});

const file = (path: string, relativePath: string): FileItem => ({
  id: path,
  filename: relativePath.split("/").at(-1)?.replace(/\.md$/, "") ?? "",
  relativePath,
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const externalTransfer = (files: File[] = [new File(["note"], "note.md")], types = ["Files"]) => ({
  dropEffect: "none",
  files,
  types,
});

const internalTransfer = (path: string) => ({
  dropEffect: "move",
  files: [],
  getData: (type: string) => (type === "text/plain" ? path : ""),
  types: ["text/plain"],
});

const clipboardEvent = (type: "copy" | "paste", clipboardData: Record<string, unknown>) => {
  const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  return event;
};

const renderTree = (props: React.ComponentProps<typeof FileExplorerTree> = { items: [] }) =>
  render(
    <Provider store={createStore()}>
      <AppDndProvider>
        <FileExplorerTree {...props} />
      </AppDndProvider>
    </Provider>,
  );

describe("FileExplorerTree", () => {
  let host: HTMLElement;
  let shadowRows: Map<string, HTMLElement>;

  beforeEach(() => {
    vi.clearAllMocks();
    state.dragSourceTreePathRef.current = null;
    window.config = { getMainDirectoryPathSync: () => "/notes-root" } as Window["config"];
    host = document.createElement("div");
    host.getBoundingClientRect = () => ({
      bottom: 200,
      height: 200,
      left: 10,
      right: 210,
      top: 0,
      width: 200,
      x: 10,
      y: 0,
      toJSON: () => ({}),
    });
    const shadowRoot = host.attachShadow({ mode: "open" });
    const scroll = document.createElement("div");
    scroll.dataset.fileTreeVirtualizedScroll = "true";
    shadowRoot.append(scroll);
    shadowRows = new Map();
    for (const path of ["A/", "A/B/", "A/file.md"]) {
      const row = document.createElement("div");
      row.dataset.type = "item";
      row.dataset.itemPath = path;
      scroll.append(row);
      shadowRows.set(path, row);
    }
    document.body.append(host);
    let selectedPaths = ["A/"];
    state.model = {
      batch: vi.fn(),
      getFileTreeContainer: () => host,
      getFocusedPath: () => state.focusedPath,
      getItem: (path) =>
        state.lookupRef.current.byTreePath.has(path)
          ? {
              deselect: () => {
                selectedPaths = selectedPaths.filter((selectedPath) => selectedPath !== path);
              },
              isDirectory: () => path.endsWith("/"),
              select: () => {
                selectedPaths = selectedPaths.includes(path) ? selectedPaths : [...selectedPaths, path];
              },
              toggle: path === "A/B/" ? state.toggleDirectory : undefined,
            }
          : null,
      getSelectedPaths: () => selectedPaths,
    };
    state.lookupRef.current = {
      byAbsolutePath: new Map([
        ["/notes-root/A", "A/"],
        ["/notes-root/A/B", "A/B/"],
        ["/notes-root/A/file.md", "A/file.md"],
      ]),
      byTreePath: new Map([
        ["A/", directory("/notes-root/A", "A")],
        ["A/B/", directory("/notes-root/A/B", "A/B")],
        ["A/file.md", file("/notes-root/A/file.md", "A/file.md")],
      ]),
      directoryTreePaths: ["A/", "A/B/"],
      paths: ["A/", "A/B/", "A/file.md"],
    };
    state.focusedPath = "A/";
  });

  afterEach(() => {
    cleanup();
    host.remove();
  });

  it("wires model state, drag-and-drop, and its imperative aggregate toggle", () => {
    const ref = createRef<FileExplorerTreeHandle>();
    render(
      <Provider store={createStore()}>
        <FileExplorerTree ref={ref} items={[]} enableFileMove />
      </Provider>,
    );

    expect(state.dndOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        expandedTreePaths: ["A/"],
        lookupRef: state.lookupRef,
        model: state.model,
      }),
    );
    act(() => ref.current?.toggleAllDirectories());
    expect(state.toggleAllDirectories).toHaveBeenCalledTimes(1);
  });

  it("opens files in the requested tab mode and toggles activated directories", () => {
    renderTree();
    const props = state.explorerProps.mock.lastCall?.[0];
    const note = state.lookupRef.current.byTreePath.get("A/file.md")!;
    const folder = state.lookupRef.current.byTreePath.get("A/B/")!;

    props.onOpenItem(note);
    props.onOpenItem(folder);
    props.onOpenItemInNewTab(note);
    props.onOpenItemInNewTab(folder);

    expect(state.open.mock.calls).toEqual([
      [note, { focusEditor: true }],
      [note, { openInNewTab: true }],
    ]);
    expect(state.toggleDirectory).toHaveBeenCalledOnce();
  });

  it("routes native tree context menus through the sole file menu host and updates selection", () => {
    renderTree();
    const folder = state.lookupRef.current.byTreePath.get("A/B/")!;
    const folderRow = shadowRows.get("A/B/")!;
    const folderEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 1000,
      clientY: 760,
      composed: true,
    });
    folderRow.dispatchEvent(folderEvent);

    expect(folderEvent.defaultPrevented).toBe(true);
    expect(state.model.getSelectedPaths()).toEqual(["A/B/"]);
    expect(state.openDirectoryMenuAt).toHaveBeenCalledWith(folder, {
      anchor: folderRow,
      x: 1000,
      y: 760,
    });

    const note = state.lookupRef.current.byTreePath.get("A/file.md")!;
    const fileRow = shadowRows.get("A/file.md")!;
    fileRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 42, clientY: 24, composed: true }));
    expect(state.openFileMenuAt).toHaveBeenCalledWith(note, { anchor: fileRow, x: 42, y: 24 });
  });

  it("opens the root menu from blank scroll space, clears selection, and ignores Pierre triggers", () => {
    renderTree();
    const scroll = host.shadowRoot!.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll='true']")!;

    const rootEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 12,
      clientY: 34,
      composed: true,
    });
    scroll.dispatchEvent(rootEvent);

    expect(rootEvent.defaultPrevented).toBe(true);
    expect(state.model.getSelectedPaths()).toEqual([]);
    expect(state.openRootMenuAt).toHaveBeenCalledWith({ anchor: null, x: 12, y: 34 });

    const trigger = document.createElement("button");
    trigger.dataset.type = "context-menu-trigger";
    scroll.append(trigger);
    trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, composed: true }));
    expect(state.openRootMenuAt).toHaveBeenCalledOnce();
  });

  it("copies selected items and pastes into the focused directory, file parent, or root", () => {
    renderTree();
    const clipboardData = { files: [], getData: vi.fn(), items: [], setData: vi.fn() };

    const copy = clipboardEvent("copy", clipboardData);
    host.shadowRoot!.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    expect(state.copyItems).toHaveBeenCalledWith([state.lookupRef.current.byTreePath.get("A/")], clipboardData);

    state.focusedPath = "A/B/";
    host.shadowRoot!.dispatchEvent(clipboardEvent("paste", clipboardData));
    expect(state.pasteClipboardData).toHaveBeenLastCalledWith(clipboardData, "/notes-root/A/B");

    state.focusedPath = "A/file.md";
    host.shadowRoot!.dispatchEvent(clipboardEvent("paste", clipboardData));
    expect(state.pasteClipboardData).toHaveBeenLastCalledWith(clipboardData, "/notes-root/A");

    shadowRows.get("A/B/")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    state.focusedPath = null;
    host.shadowRoot!.dispatchEvent(clipboardEvent("paste", clipboardData));
    expect(state.pasteClipboardData).toHaveBeenLastCalledWith(clipboardData, "/notes-root/A/B");

    host.shadowRoot!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", composed: true }));
    state.focusedPath = null;
    host.shadowRoot!.dispatchEvent(clipboardEvent("paste", clipboardData));
    expect(state.pasteClipboardData).toHaveBeenLastCalledWith(clipboardData, "/notes-root");
  });

  it("leaves native clipboard events alone when obim does not handle them", () => {
    state.copyItems.mockReturnValueOnce(false);
    state.pasteClipboardData.mockReturnValueOnce(false);
    renderTree();
    const clipboardData = { files: [], getData: vi.fn(), items: [], setData: vi.fn() };
    const copy = clipboardEvent("copy", clipboardData);
    const paste = clipboardEvent("paste", clipboardData);

    host.shadowRoot!.dispatchEvent(copy);
    host.shadowRoot!.dispatchEvent(paste);

    expect(copy.defaultPrevented).toBe(false);
    expect(paste.defaultPrevented).toBe(false);
  });

  it("deletes selected explorer items with Delete but leaves rename inputs alone", () => {
    renderTree();
    const remove = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "Delete",
    });

    host.shadowRoot!.dispatchEvent(remove);
    expect(remove.defaultPrevented).toBe(true);
    expect(state.removeMany).toHaveBeenCalledWith([state.lookupRef.current.byTreePath.get("A/")]);

    const renameInput = document.createElement("input");
    shadowRows.get("A/")!.append(renameInput);
    renameInput.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, key: "Delete" }),
    );
    expect(state.removeMany).toHaveBeenCalledOnce();
  });

  it("hides markdown extensions while editing and restores them only when committing", async () => {
    renderTree();
    const row = shadowRows.get("A/file.md")!;

    await waitFor(() => expect(row.dataset.obimMarkdownFile).toBe("true"));
    expect(row.getAttribute("aria-label")).toBe("file");

    const input = document.createElement("input");
    input.dataset.itemRenameInput = "";
    input.value = "file.md";
    row.append(input);

    await waitFor(() => expect(input.value).toBe("file"));
    expect(input.getAttribute("aria-label")).toBe("Rename file");

    input.value = "renamed";
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true, key: "Enter" }));
    expect(input.value).toBe("renamed.md");

    input.remove();
    const blurredInput = document.createElement("input");
    blurredInput.dataset.itemRenameInput = "";
    blurredInput.value = "file.md";
    row.append(blurredInput);
    await waitFor(() => expect(blurredInput.value).toBe("file"));

    blurredInput.value = "clicked-away";
    blurredInput.dispatchEvent(new FocusEvent("blur", { composed: true }));
    expect(blurredInput.value).toBe("clicked-away.md");
  });

  it("delegates file-only Git statuses to Pierre without custom row attributes", async () => {
    const gitStatus = [{ path: "A/file.md", status: "modified" as const }];
    renderTree({
      items: [],
      gitStatus,
    });

    const directoryRow = shadowRows.get("A/")!;
    const fileRow = shadowRows.get("A/file.md")!;
    await waitFor(() => expect(fileRow.dataset.obimMarkdownFile).toBe("true"));

    expect(state.modelOptions).toHaveBeenCalledWith(expect.objectContaining({ gitStatus }));
    expect(directoryRow.dataset.obimGitStatus).toBeUndefined();
    expect(fileRow.dataset.obimGitStatus).toBeUndefined();
    expect(fileRow.getAttribute("aria-label")).toBe("file");
  });

  it("waits for the Pierre host before attaching native context-menu handling", () => {
    let attachFrame: FrameRequestCallback | undefined;
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      attachFrame = callback;
      return 17;
    });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    state.model.getFileTreeContainer = () => null;

    const { unmount } = renderTree();
    expect(requestFrame).toHaveBeenCalledOnce();

    state.model.getFileTreeContainer = () => host;
    act(() => attachFrame?.(0));
    const fileRow = shadowRows.get("A/file.md")!;
    fileRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, composed: true }));
    expect(state.openFileMenuAt).toHaveBeenCalledOnce();

    unmount();
    expect(cancelFrame).toHaveBeenCalledWith(17);
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it("ignores non-row and stale native context-menu events", () => {
    const lightDomHost = document.createElement("div");
    document.body.append(lightDomHost);
    state.model.getFileTreeContainer = () => lightDomHost;
    const { unmount } = renderTree();

    lightDomHost.dispatchEvent(new Event("contextmenu", { bubbles: true }));
    lightDomHost.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

    const staleRow = document.createElement("div");
    staleRow.dataset.type = "item";
    staleRow.dataset.itemPath = "missing.md";
    lightDomHost.append(staleRow);
    staleRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, composed: true }));

    const detachedPierreRow = document.createElement("div");
    detachedPierreRow.dataset.type = "item";
    detachedPierreRow.dataset.itemPath = "A/file.md";
    lightDomHost.append(detachedPierreRow);
    detachedPierreRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, composed: true }));

    expect(state.openDirectoryMenuAt).not.toHaveBeenCalled();
    expect(state.openFileMenuAt).not.toHaveBeenCalled();
    unmount();
    lightDomHost.remove();
  });

  it("imports into a hovered directory and owns the external-copy highlight", () => {
    const onExternalFileDrop = vi.fn();
    const { getByText } = renderTree({ items: [], onExternalFileDrop });
    const dataTransfer = externalTransfer();

    fireEvent.dragEnter(getByText("B"), { dataTransfer });
    fireEvent.dragOver(getByText("B"), { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(shadowRows.get("A/B/")?.classList.contains("obim-external-drop-target")).toBe(true);
    expect(host.classList.contains("obim-external-drop-root")).toBe(false);
    fireEvent.dragOver(getByText("B"), { dataTransfer });
    expect(shadowRows.get("A/B/")?.classList.contains("obim-external-drop-target")).toBe(true);
    fireEvent.dragOver(getByText("A"), { dataTransfer });
    expect(shadowRows.get("A/B/")?.classList.contains("obim-external-drop-target")).toBe(false);
    expect(shadowRows.get("A/")?.classList.contains("obim-external-drop-target")).toBe(true);

    fireEvent.drop(getByText("B"), { dataTransfer });
    expect(onExternalFileDrop).toHaveBeenCalledWith(dataTransfer.files, state.lookupRef.current.byTreePath.get("A/B/"));
    expect(shadowRows.get("A/")?.classList.contains("obim-external-drop-target")).toBe(false);
  });

  it("uses a file's parent directory and the workspace root as external destinations", () => {
    const onExternalFileDrop = vi.fn();
    const { getByTestId, getByText } = renderTree({ items: [], onExternalFileDrop });
    const fileTransfer = externalTransfer([new File(["x"], "x.md")]);
    fireEvent.dragEnter(getByText("file"), { dataTransfer: fileTransfer });
    fireEvent.drop(getByText("file"), { dataTransfer: fileTransfer });
    expect(onExternalFileDrop).toHaveBeenLastCalledWith(
      fileTransfer.files,
      state.lookupRef.current.byTreePath.get("A/"),
    );

    const rootTransfer = externalTransfer([new File(["y"], "y.md")]);
    fireEvent.dragEnter(getByTestId("tree"), { dataTransfer: rootTransfer });
    fireEvent.dragOver(getByTestId("tree"), { dataTransfer: rootTransfer });
    expect(host.classList.contains("obim-external-drop-root")).toBe(true);
    fireEvent.drop(getByTestId("tree"), { dataTransfer: rootTransfer });
    expect(onExternalFileDrop).toHaveBeenLastCalledWith(rootTransfer.files, null);
    expect(host.classList.contains("obim-external-drop-root")).toBe(false);
  });

  it("moves an internal item to the root from the empty tree background", () => {
    const { getByTestId } = renderTree({ enableFileMove: true, items: [] });
    const onDropCompleteRef = state.dndOptions.mock.lastCall?.[0].onDropCompleteRef as {
      current: ReturnType<typeof vi.fn>;
    };
    onDropCompleteRef.current = vi.fn();
    state.dragSourceTreePathRef.current = "A/file.md";
    const tree = getByTestId("tree");
    const dataTransfer = internalTransfer("/notes-root/A/file.md");

    fireEvent.dragOver(tree, { dataTransfer });
    expect(host.classList.contains("obim-internal-drop-root")).toBe(false);
    fireEvent.drop(tree, { dataTransfer });

    expect(onDropCompleteRef.current).toHaveBeenCalledWith({
      draggedPaths: ["A/file.md"],
      operation: "move",
      target: {
        directoryPath: null,
        flattenedSegmentPath: null,
        hoveredPath: null,
        kind: "root",
      },
    });
  });

  it("ignores internal drags, non-file drags, missing handlers, and empty drops", () => {
    const onExternalFileDrop = vi.fn();
    const { getByTestId, getByText, rerender } = renderTree({ items: [], onExternalFileDrop });
    const tree = getByTestId("tree");

    fireEvent.dragOver(getByText("B"), { dataTransfer: externalTransfer([], ["Files", FILE_DRAG_DATA_MIME]) });
    fireEvent.drop(getByText("B"), { dataTransfer: externalTransfer([], ["Files", FILE_DRAG_DATA_MIME]) });
    fireEvent.dragOver(tree, { dataTransfer: externalTransfer([], ["text/plain"]) });
    fireEvent.drop(tree, { dataTransfer: externalTransfer([], ["text/plain"]) });
    fireEvent.dragOver(tree, { dataTransfer: { ...externalTransfer(), types: undefined } });
    fireEvent.drop(tree, { dataTransfer: externalTransfer([]) });
    expect(onExternalFileDrop).not.toHaveBeenCalled();

    rerender(
      <Provider store={createStore()}>
        <AppDndProvider>
          <FileExplorerTree items={[]} />
        </AppDndProvider>
      </Provider>,
    );
    fireEvent.dragOver(tree, { dataTransfer: externalTransfer() });
    fireEvent.drop(tree, { dataTransfer: externalTransfer() });
    expect(host.classList.contains("obim-external-drop-root")).toBe(false);
  });

  it("retains highlights while the pointer is inside and clears them on leave, drag end, and unmount", () => {
    const { getByText } = renderTree({ items: [], onExternalFileDrop: vi.fn() });
    const transfer = externalTransfer();
    const tree = screen.getByTestId("tree");
    fireEvent.dragEnter(getByText("B"), { dataTransfer: transfer });
    fireEvent.dragOver(getByText("B"), { dataTransfer: transfer });

    tree.dispatchEvent(new MouseEvent("dragleave", { bubbles: true, clientX: 50, clientY: 50 }));
    expect(shadowRows.get("A/B/")?.classList.contains("obim-external-drop-target")).toBe(true);
    tree.dispatchEvent(new MouseEvent("dragleave", { bubbles: true, clientX: 500, clientY: 500 }));
    expect(shadowRows.get("A/B/")?.classList.contains("obim-external-drop-target")).toBe(false);

    fireEvent.dragOver(getByText("B"), { dataTransfer: transfer });
    fireEvent.dragEnd(tree, { dataTransfer: transfer });
    expect(shadowRows.get("A/B/")?.classList.contains("obim-external-drop-target")).toBe(false);

    fireEvent.dragOver(getByText("B"), { dataTransfer: transfer });
    cleanup();
    expect(shadowRows.get("A/B/")?.classList.contains("obim-external-drop-target")).toBe(false);
    expect(host.classList.contains("obim-external-drop-root")).toBe(false);
  });
});
