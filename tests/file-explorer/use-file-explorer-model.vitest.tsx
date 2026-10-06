import { indexedNoteFileTypesAtom } from "@renderer/store/noteFileTypeStore";
import { Provider, createStore } from "jotai";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileItem } from "../../src/shared/file-item";
import {
  expandedDirectoriesAtom,
  explorerSelectionPathsAtom,
  fileExplorerRevealRequestAtom,
  reloadRevisionAtom,
  renamingRequestAtom,
} from "../../src/renderer/src/store/fileExplorerStore";
import { workspacePanesAtom } from "../../src/renderer/src/store/editorPaneStore";
import { workspaceTabsByIdAtom } from "../../src/renderer/src/store/editorTabStore";
import { openWorkspaceItemsByKeyAtom } from "../../src/renderer/src/store/workspaceResourceStore";
import { createFileWorkspaceItem } from "../../src/shared/workspace";
import { createEditorTab } from "../../src/renderer/src/store/editorTabStore";
import { OPEN_FILE_STYLE_ID } from "../../src/renderer/src/features/files/explorer/tree/explorerTreeConfig";
import { FILE_GLYPH_ICONS, FILE_GLYPH_SIZE } from "../../src/renderer/src/shared/icons/FileGlyphs";

const state = vi.hoisted(() => ({
  saveRename: vi.fn(),
  stopRenaming: vi.fn(),
  useFileTreeOptions: vi.fn(),
  model: null as unknown,
}));

vi.mock("@pierre/trees/react", () => ({
  useFileTree: (options: unknown) => {
    state.useFileTreeOptions(options);
    return { model: state.model };
  },
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useFileRename: () => ({ saveRename: state.saveRename, stopRenaming: state.stopRenaming }),
}));

import { useFileExplorerModel } from "../../src/renderer/src/features/files/explorer/useFileExplorerModel";

const file = (path: string, relativePath = path.replace("/notes-root/", "")): FileItem => ({
  id: path,
  filename: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
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

const selectCurrentFile = (store: ReturnType<typeof createStore>, file: FileItem) => {
  const item = createFileWorkspaceItem(file);
  const tab = createEditorTab("current-file-tab", item.key);
  store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }]);
  store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
  store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
};

type Handle = ReturnType<typeof createHandle>;

const createHandle = (path: string, isDirectory: boolean, selected: Set<string>, expanded = false) => {
  let isExpanded = expanded;
  return {
    collapse: vi.fn(() => {
      isExpanded = false;
    }),
    deselect: vi.fn(() => selected.delete(path)),
    expand: vi.fn(() => {
      isExpanded = true;
    }),
    isDirectory: vi.fn(() => isDirectory),
    isExpanded: vi.fn(() => isExpanded),
    select: vi.fn(() => selected.add(path)),
    setExpanded: (value: boolean) => {
      isExpanded = value;
    },
  };
};

const createModel = () => {
  const host = document.createElement("div");
  const shadowRoot = host.attachShadow({ mode: "open" });
  document.body.append(host);
  const selected = new Set<string>();
  const handles = new Map<string, Handle>();
  let focusedPath: string | null = null;
  let subscriber: (() => void) | null = null;
  const unsubscribe = vi.fn();
  const model = {
    getFileTreeContainer: vi.fn(() => host),
    getFocusedPath: vi.fn(() => focusedPath),
    getItem: vi.fn((path: string) => handles.get(path) ?? null),
    getSelectedPaths: vi.fn(() => Array.from(selected)),
    focusPath: vi.fn((path: string) => {
      focusedPath = path;
    }),
    batch: vi.fn(),
    resetPaths: vi.fn(),
    scrollToPath: vi.fn(),
    setGitStatus: vi.fn(),
    startRenaming: vi.fn(() => true),
    subscribe: vi.fn((callback: () => void) => {
      subscriber = callback;
      return unsubscribe;
    }),
  };

  return {
    add(path: string, isDirectory: boolean, expanded = false) {
      const handle = createHandle(path, isDirectory, selected, expanded);
      handles.set(path, handle);
      return handle;
    },
    emit: () => subscriber?.(),
    handles,
    host,
    model,
    selected,
    setFocusedPath: (path: string | null) => {
      focusedPath = path;
    },
    shadowRoot,
    unsubscribe,
  };
};

const appendRow = (modelState: ReturnType<typeof createModel>, path: string) => {
  const row = document.createElement("div");
  row.dataset.type = "item";
  row.dataset.itemPath = path;
  const content = document.createElement("div");
  content.dataset.itemSection = "content";
  const animate = vi.fn();
  Object.defineProperty(content, "animate", { value: animate });
  row.append(content);
  modelState.shadowRoot.append(row);
  return { animate, content };
};

type HookProps = Parameters<typeof useFileExplorerModel>[0];

const renderModel = (modelState: ReturnType<typeof createModel>, overrides: Partial<HookProps> = {}) => {
  const store = createStore();
  const props: HookProps = {
    enableFileMove: false,
    items: [],
    syncSelection: false,
    ...overrides,
  };
  state.model = modelState.model;
  const view = renderHook((nextProps: HookProps) => useFileExplorerModel(nextProps), {
    initialProps: props,
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
  return { ...view, props, store };
};

type CapturedFileTreeOptions = {
  dragAndDrop:
    | false
    | {
        canDrag: (paths: string[]) => boolean;
        canDrop: (event: {
          draggedPaths: string[];
          target: { directoryPath: string | null; kind: "directory" | "root" };
        }) => boolean;
        onDropComplete: (event: unknown) => void;
        onDropError: (
          error: string,
          event: {
            draggedPaths: string[];
            target: { directoryPath: string | null; kind: "directory" | "root" };
          },
        ) => void;
        openOnDropDelay: number;
      };
  flattenEmptyDirectories: boolean;
  gitStatus?: readonly { path: string; status: string }[];
  icons: { byFileExtension: Record<string, string> };
  initialExpansion: string;
  itemHeight: number;
  onSelectionChange: (paths: string[]) => void;
  overscan: number;
  paths: string[];
  renderRowDecoration: (context: { item: { path: string } }) => { text: string } | null;
  renaming: {
    canRename: (item: { isFolder: boolean; path: string }) => boolean;
    onError: (error: string) => void;
    onRename: (event: { destinationPath: string; isFolder: boolean; sourcePath: string }) => Promise<void>;
  };
  unsafeCSS: string;
};

const latestOptions = () => state.useFileTreeOptions.mock.lastCall?.[0] as CapturedFileTreeOptions;

describe("useFileExplorerModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.saveRename.mockResolvedValue({ success: true });
    window.config = { getMainDirectoryPathSync: () => "/notes-root" } as Window["config"];
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("applies delayed restored expansion to an unchanged live model and preserves a later user collapse", () => {
    const modelState = createModel();
    const folder = modelState.add("Folder/", true);
    const nested = modelState.add("Folder/Nested/", true);
    const items = [directory("/notes-root/Folder", [directory("/notes-root/Folder/Nested")])];
    let persisted = new Set<string>();
    const onExpandedDirectoriesChange = vi.fn((next: Set<string>) => {
      persisted = next;
    });
    const { rerender, props } = renderModel(modelState, {
      items,
      expandedDirectories: persisted,
      onExpandedDirectoriesChange,
    });
    persisted = new Set(["Folder", "Folder/Nested"]);
    rerender({ ...props, expandedDirectories: persisted });
    expect(folder.isExpanded()).toBe(true);
    expect(nested.isExpanded()).toBe(true);
    modelState.setFocusedPath("Folder/");
    folder.setExpanded(false);
    act(() => modelState.emit());
    expect(persisted.has("Folder")).toBe(false);
    rerender({ ...props, items: [...items], expandedDirectories: persisted });
    expect(folder.isExpanded()).toBe(false);
    expect(folder.expand).toHaveBeenCalledTimes(1);
  });

  it("keeps missing expansion pending until its folder appears without publishing partial state", () => {
    const modelState = createModel();
    const folder = modelState.add("Folder/", true);
    const onChange = vi.fn();
    folder.expand.mockImplementation(() => {
      folder.setExpanded(true);
      modelState.emit();
    });
    modelState.setFocusedPath("Folder/");
    const { rerender, props } = renderModel(modelState, {
      items: [directory("/notes-root/Folder")],
      expandedDirectories: new Set<string>(),
      onExpandedDirectoriesChange: onChange,
    });
    const restored = new Set(["Folder", "Folder/Nested", "Missing"]);
    rerender({ ...props, expandedDirectories: restored });
    expect(folder.isExpanded()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    const nested = modelState.add("Folder/Nested/", true);
    rerender({
      ...props,
      expandedDirectories: restored,
      items: [directory("/notes-root/Folder", [directory("/notes-root/Folder/Nested")])],
    });
    expect(nested.isExpanded()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards expansion from the previous workspace until the new workspace supplies its own state", () => {
    const modelState = createModel();
    const folder = modelState.add("Folder/", true);
    modelState.model.resetPaths.mockImplementation((_paths: unknown, options: { initialExpandedPaths: string[] }) => {
      folder.setExpanded(options.initialExpandedPaths.includes("Folder/"));
    });
    const oldExpansion = new Set(["Folder"]);
    const { rerender, props } = renderModel(modelState, {
      items: [directory("/notes-root/Folder")],
      expandedDirectories: oldExpansion,
    });
    expect(folder.isExpanded()).toBe(true);
    window.config = { getMainDirectoryPathSync: () => "/second-root" } as Window["config"];
    const nextItems = [{ ...directory("/second-root/Folder"), relativePath: "Folder" }];
    rerender({ ...props, items: nextItems });
    expect(folder.isExpanded()).toBe(false);
    rerender({ ...props, items: [...nextItems] });
    expect(folder.isExpanded()).toBe(false);
    rerender({ ...props, items: nextItems, expandedDirectories: new Set(["Folder"]) });
    expect(folder.isExpanded()).toBe(true);
  });

  it("updates note icons in the existing shadow tree when indexed types change", () => {
    const note = file("/notes-root/Folder/note.md");
    const modelState = createModel();
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    modelState.model.getFileTreeContainer.mockReturnValue(host);
    const { store, unmount } = renderModel(modelState, { items: [directory("/notes-root/Folder", [note])] });
    act(() => store.set(indexedNoteFileTypesAtom, { [note.path]: "task" }));
    expect(shadow.querySelector("style[data-note-file-icons]")?.textContent).toContain(
      '[data-item-path="Folder/note.md"]',
    );
    expect(shadow.querySelectorAll("style[data-note-file-icons]").length).toBe(1);
    act(() => store.set(indexedNoteFileTypesAtom, {}));
    expect(shadow.querySelector("style[data-note-file-icons]")).toBeNull();
    unmount();
  });

  it("configures Pierre with canonical identity, icons, density, rename, and optional movement", () => {
    const note = file("/notes-root/Folder/note.md");
    const folder = directory("/notes-root/Folder", [note]);
    const modelState = createModel();
    modelState.add("Folder/", true);
    modelState.add("Folder/note.md", false);
    const { result } = renderModel(modelState, { enableFileMove: true, items: [folder] });
    const options = latestOptions();

    expect(options).toEqual(
      expect.objectContaining({
        flattenEmptyDirectories: false,
        initialExpansion: "closed",
        itemHeight: 24,
        overscan: 8,
        paths: [],
      }),
    );
    expect(options.icons).toBe(FILE_GLYPH_ICONS);
    expect(options.unsafeCSS).toContain(`--trees-icon-width-override: ${FILE_GLYPH_SIZE}px`);
    expect(options.unsafeCSS).toContain("--trees-padding-inline-override: 0px");
    expect(options.unsafeCSS).toContain("--trees-git-lane-width-override: var(--git-status-marker-width)");
    expect(options.unsafeCSS).toContain("--trees-git-added-color-override: var(--git-status-added)");
    expect(options.unsafeCSS).toContain("--trees-git-deleted-color-override: var(--git-status-deleted)");
    expect(options.unsafeCSS).toContain("--trees-git-modified-color-override: var(--git-status-modified)");
    expect(options.unsafeCSS).toContain("--trees-git-renamed-color-override: var(--git-status-renamed)");
    expect(options.unsafeCSS).toContain("--trees-git-untracked-color-override: var(--git-status-untracked)");
    expect(options.unsafeCSS).toContain(`width: ${FILE_GLYPH_SIZE}px`);
    expect(options.unsafeCSS).toContain(`height: ${FILE_GLYPH_SIZE}px`);
    expect(options.unsafeCSS).toContain("[data-item-section='icon']");
    expect(options.unsafeCSS).toContain("color: var(--muted-foreground) !important");
    expect(options.unsafeCSS).toContain("[data-item-rename-input]");
    expect(options.unsafeCSS).toContain("caret-color: var(--editor-caret)");
    expect(options.unsafeCSS).not.toContain("transition: background-color");
    expect(options.unsafeCSS).toContain("[data-obim-markdown-file='true']");
    expect(options.unsafeCSS).toContain("background-color: var(--surface-selected)");
    expect(options.unsafeCSS).toContain("box-shadow: inset 0 0 0 1px var(--focus-ring) !important");
    expect(options.unsafeCSS).toContain("[data-item-type='folder'][data-item-focused='true']");
    expect(options.unsafeCSS).toContain("box-shadow: none !important");
    expect(options.unsafeCSS).not.toContain("[data-item-type='folder'][data-item-drag-target='true']");
    expect(options.unsafeCSS).toContain("[data-type='item'].obim-external-drop-target");
    expect(options.unsafeCSS).not.toContain(":host(.obim-internal-drop-root)");
    expect(options.unsafeCSS).toContain("[data-item-focused='true']::before");
    expect(options.unsafeCSS).toContain("outline: none !important");
    expect(options.unsafeCSS).toContain("[data-item-type='folder'][data-item-contains-git-change='true']");
    expect(options.unsafeCSS).toContain("visibility: hidden");
    expect(options.unsafeCSS).toContain("[data-item-git-status] > [data-item-section='content']");
    expect(options.unsafeCSS).toContain("[data-item-git-status] > [data-item-section='decoration']");
    expect(options.unsafeCSS).toContain(":where(:not([data-icon-name='file-tree-icon-chevron']))");
    expect(options.unsafeCSS).toContain("color: inherit !important");
    expect(options.unsafeCSS).toContain("font-size: var(--git-status-marker-font-size) !important");
    expect(options.unsafeCSS).toContain("font-weight: var(--git-status-marker-font-weight) !important");
    expect(options.unsafeCSS).not.toContain("data-obim-git-status");
    expect(options.dragAndDrop).not.toBe(false);
    if (!options.dragAndDrop) throw new Error("Expected drag-and-drop configuration");
    expect(options.dragAndDrop.openOnDropDelay).toBe(500);
    expect(options.dragAndDrop.canDrag(["missing.md", "Folder/note.md"])).toBe(true);
    expect(options.dragAndDrop.canDrag(["missing.md"])).toBe(false);
    expect(
      options.dragAndDrop.canDrop({
        draggedPaths: ["Folder/note.md"],
        target: { directoryPath: null, kind: "root" },
      }),
    ).toBe(true);
    expect(
      options.dragAndDrop.canDrop({
        draggedPaths: ["Folder/note.md"],
        target: { directoryPath: "Folder/", kind: "directory" },
      }),
    ).toBe(false);
    expect(options.renaming.canRename({ isFolder: true, path: "Folder" })).toBe(true);
    expect(options.renaming.canRename({ isFolder: false, path: "missing.md" })).toBe(false);
    expect(options.renderRowDecoration({ item: { path: "Folder/note.md" } })).toEqual({ text: "note" });
    expect(options.renderRowDecoration({ item: { path: "missing.md" } })).toBeNull();

    const completed = vi.fn();
    result.current.onDropCompleteRef.current = completed;
    options.dragAndDrop.onDropComplete({ draggedPaths: [], target: { kind: "root" } });
    expect(completed).toHaveBeenCalledTimes(1);

    options.dragAndDrop.onDropError("collision", {
      draggedPaths: ["Folder/note.md"],
      target: { directoryPath: null, kind: "root" },
    });
    expect(modelState.model.batch).toHaveBeenCalledWith([{ from: "Folder/note.md", to: "note.md", type: "move" }]);
    expect(completed).toHaveBeenLastCalledWith({
      draggedPaths: ["Folder/note.md"],
      operation: "move",
      target: { directoryPath: null, kind: "root" },
    });
  });

  it("updates Pierre's native Git status surface without creating directory entries", () => {
    const modelState = createModel();
    const gitStatus = [{ path: "Folder/note.md", status: "modified" as const }];
    const { rerender, props } = renderModel(modelState, { gitStatus });

    expect(latestOptions().gitStatus).toBe(gitStatus);
    expect(modelState.model.setGitStatus).toHaveBeenCalledWith(gitStatus);

    const nextGitStatus = [{ path: "new.md", status: "untracked" as const }];
    rerender({ ...props, gitStatus: nextGitStatus });
    expect(modelState.model.setGitStatus).toHaveBeenLastCalledWith(nextGitStatus);
    expect(nextGitStatus.some((entry) => entry.path.endsWith("/"))).toBe(false);
  });

  it("turns movement off without weakening rename support and shakes validation failures", async () => {
    const modelState = createModel();
    const { animate } = appendRow(modelState, "note.md");
    modelState.setFocusedPath("note.md");
    renderModel(modelState);
    expect(latestOptions().dragAndDrop).toBe(false);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    latestOptions().renaming.onError("rename failed");
    expect(error).toHaveBeenCalledWith("Unable to rename file:", "rename failed");
    await waitFor(() => expect(animate).toHaveBeenCalledOnce());
    expect(animate).toHaveBeenCalledWith(expect.any(Array), { duration: 450, easing: "ease-in-out" });
  });

  it("resets changed paths while preserving controlled expansion and valid external selection", async () => {
    const note = file("/notes-root/Folder/note.md");
    const folder = directory("/notes-root/Folder", [note]);
    const modelState = createModel();
    const folderHandle = modelState.add("Folder/", true);
    const noteHandle = modelState.add("Folder/note.md", false);
    const store = createStore();
    store.set(explorerSelectionPathsAtom, [note.path, "/notes-root/stale.md"]);
    state.model = modelState.model;
    const props: HookProps = {
      enableFileMove: false,
      expandedDirectories: new Set(["Folder"]),
      items: [folder],
      syncSelection: true,
    };
    const view = renderHook((nextProps: HookProps) => useFileExplorerModel(nextProps), {
      initialProps: props,
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    expect(modelState.model.resetPaths).toHaveBeenCalledWith(["Folder/", "Folder/note.md"], {
      initialExpandedPaths: ["Folder/"],
    });
    expect(noteHandle.select).toHaveBeenCalledTimes(1);
    expect(modelState.model.focusPath).toHaveBeenCalledWith("Folder/note.md");
    await waitFor(() => expect(store.get(explorerSelectionPathsAtom)).toEqual([note.path]));

    modelState.model.resetPaths.mockClear();
    view.rerender({ ...props, items: [folder] });
    expect(modelState.model.resetPaths).not.toHaveBeenCalled();

    folderHandle.setExpanded(true);
    const second = file("/notes-root/second.md");
    modelState.add("second.md", false);
    view.rerender({ ...props, items: [folder, second], expandedDirectories: new Set() });
    expect(modelState.model.resetPaths).toHaveBeenCalledWith(["Folder/", "Folder/note.md", "second.md"], {
      initialExpandedPaths: ["Folder/"],
    });
  });

  it("restores focus to a moved selection instead of retaining the reset fallback row", () => {
    const attachments = directory("/notes-root/attachments");
    const moved = file("/notes-root/Tasks/New task.md");
    const tasks = directory("/notes-root/Tasks", [moved]);
    const modelState = createModel();
    modelState.add("attachments/", true);
    modelState.add("Tasks/", true, true);
    modelState.add("Tasks/New task.md", false);
    modelState.setFocusedPath("attachments/");
    const store = createStore();
    store.set(explorerSelectionPathsAtom, [moved.path]);
    state.model = modelState.model;

    renderHook(
      () =>
        useFileExplorerModel({
          enableFileMove: true,
          items: [attachments, tasks],
          syncSelection: true,
        }),
      { wrapper: ({ children }) => <Provider store={store}>{children}</Provider> },
    );

    expect(modelState.model.focusPath).toHaveBeenCalledWith("Tasks/New task.md");
    expect(modelState.model.getFocusedPath()).toBe("Tasks/New task.md");
  });

  it("maps Pierre selection to absolute paths, drops stale rows, and can opt out of synchronization", () => {
    const note = file("/notes-root/note.md");
    const modelState = createModel();
    modelState.add("note.md", false);
    const { store, rerender, props } = renderModel(modelState, { items: [note], syncSelection: true });
    const onSelectionChange = latestOptions().onSelectionChange;

    act(() => onSelectionChange(["note.md", "stale.md"]));
    expect(store.get(explorerSelectionPathsAtom)).toEqual([note.path]);
    const selectedReference = store.get(explorerSelectionPathsAtom);
    act(() => onSelectionChange(["note.md"]));
    expect(store.get(explorerSelectionPathsAtom)).toBe(selectedReference);

    rerender({ ...props, items: [note], syncSelection: false });
    act(() => latestOptions().onSelectionChange([]));
    expect(store.get(explorerSelectionPathsAtom)).toEqual([note.path]);
  });

  it("persists only focused directory expansion transitions and unsubscribes", () => {
    const note = file("/notes-root/Folder/note.md");
    const folder = directory("/notes-root/Folder", [note]);
    const modelState = createModel();
    const folderHandle = modelState.add("Folder/", true);
    modelState.add("Folder/note.md", false);
    const onExpandedDirectoriesChange = vi.fn();
    const { unmount } = renderModel(modelState, {
      expandedDirectories: new Set(),
      items: [folder],
      onExpandedDirectoriesChange,
    });

    modelState.emit();
    modelState.setFocusedPath("Folder/note.md");
    modelState.emit();
    modelState.setFocusedPath("Folder/");
    folderHandle.setExpanded(true);
    modelState.emit();
    expect(Array.from(onExpandedDirectoriesChange.mock.lastCall?.[0] ?? [])).toEqual(["Folder"]);

    onExpandedDirectoriesChange.mockClear();
    modelState.emit();
    expect(onExpandedDirectoriesChange).not.toHaveBeenCalled();
    folderHandle.setExpanded(false);
    modelState.emit();
    expect(Array.from(onExpandedDirectoriesChange.mock.lastCall?.[0] ?? [])).toEqual([]);

    unmount();
    expect(modelState.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps an unavailable reveal pending, then expands, scrolls, selects, and consumes it when it appears", () => {
    const modelState = createModel();
    const existing = modelState.add("old.md", false);
    modelState.selected.add("old.md");
    const onExpandedDirectoriesChange = vi.fn();
    const { store, rerender, props } = renderModel(modelState, {
      items: [file("/notes-root/old.md")],
      onExpandedDirectoriesChange,
      syncSelection: true,
    });
    act(() => store.set(fileExplorerRevealRequestAtom, { relativePath: "A/B" }));
    expect(store.get(fileExplorerRevealRequestAtom)).toEqual({ relativePath: "A/B" });
    expect(modelState.model.scrollToPath).not.toHaveBeenCalled();

    const targetFile = directory("/notes-root/A", [directory("/notes-root/A/B")]);
    const a = modelState.add("A/", true);
    const b = modelState.add("A/B/", true);
    rerender({ ...props, items: [file("/notes-root/old.md"), targetFile] });

    expect(a.expand).toHaveBeenCalledTimes(1);
    expect(b.expand).toHaveBeenCalledTimes(1);
    expect(modelState.model.scrollToPath).toHaveBeenCalledWith("A/B/", { focus: false, offset: "nearest" });
    expect(existing.deselect).toHaveBeenCalled();
    expect(b.select).toHaveBeenCalled();
    expect(store.get(explorerSelectionPathsAtom)).toEqual(["/notes-root/A/B"]);
    expect(store.get(fileExplorerRevealRequestAtom)).toBeNull();
    expect(Array.from(store.get(expandedDirectoriesAtom))).toEqual(["A", "A/B"]);
    expect(onExpandedDirectoriesChange).not.toHaveBeenCalled();
  });

  it("honors the rename target and consumes only a rename mode Pierre accepts", () => {
    const note = file("/notes-root/note.md");
    const modelState = createModel();
    modelState.add("note.md", false);
    const { store } = renderModel(modelState, { items: [note] });

    act(() => store.set(renamingRequestAtom, { filePath: note.path, target: "file-header" }));
    expect(modelState.model.startRenaming).not.toHaveBeenCalled();
    act(() => store.set(renamingRequestAtom, { filePath: "/notes-root/missing.md", target: "explorer" }));
    expect(modelState.model.startRenaming).not.toHaveBeenCalled();
    modelState.model.startRenaming.mockReturnValueOnce(false);
    act(() => store.set(renamingRequestAtom, { filePath: note.path, target: "explorer" }));
    expect(state.stopRenaming).not.toHaveBeenCalled();

    act(() => store.set(renamingRequestAtom, null));
    act(() => store.set(renamingRequestAtom, { filePath: note.path, target: "explorer" }));
    expect(modelState.model.startRenaming).toHaveBeenLastCalledWith("note.md");
    expect(state.stopRenaming).toHaveBeenCalledWith(note.path);
  });

  it("saves valid renames and reloads for stale sources or rejected persistence", async () => {
    const note = file("/notes-root/note.md");
    const modelState = createModel();
    modelState.add("note.md", false);
    const { animate } = appendRow(modelState, "note.md");
    modelState.setFocusedPath("note.md");
    const { store } = renderModel(modelState, { items: [note] });
    const onRename = latestOptions().renaming.onRename;

    await act(() => onRename({ sourcePath: "note.md", destinationPath: "renamed.md", isFolder: false }));
    expect(state.saveRename).toHaveBeenCalledWith(note.path, "renamed.md");
    expect(animate).not.toHaveBeenCalled();
    expect(store.get(reloadRevisionAtom)).toBe(0);

    await act(() => onRename({ sourcePath: "missing.md", destinationPath: "x.md", isFolder: false }));
    await waitFor(() => expect(animate).toHaveBeenCalledOnce());
    expect(store.get(reloadRevisionAtom)).toBe(1);

    state.saveRename.mockResolvedValueOnce({ success: false, error: "collision" });
    await act(() => onRename({ sourcePath: "note.md", destinationPath: "collision.md", isFolder: false }));
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(2));
    expect(store.get(reloadRevisionAtom)).toBe(2);
  });

  it("expands a partial tree and collapses a fully expanded tree", () => {
    const nested = directory("/notes-root/A", [directory("/notes-root/A/B")]);
    const modelState = createModel();
    modelState.add("A/", true);
    modelState.add("A/B/", true);
    const onExpandedDirectoriesChange = vi.fn();
    const { result } = renderModel(modelState, {
      expandedDirectories: new Set(["A"]),
      items: [nested],
      onExpandedDirectoriesChange,
    });
    modelState.model.resetPaths.mockClear();

    act(() => result.current.toggleAllDirectories());
    expect(modelState.model.resetPaths).toHaveBeenLastCalledWith(["A/", "A/B/"], {
      initialExpandedPaths: ["A/", "A/B/"],
    });
    expect(Array.from(onExpandedDirectoriesChange.mock.lastCall?.[0] ?? [])).toEqual(["A", "A/B"]);

    act(() => result.current.toggleAllDirectories());
    expect(modelState.model.resetPaths).toHaveBeenLastCalledWith(["A/", "A/B/"], { initialExpandedPaths: [] });
    expect(Array.from(onExpandedDirectoriesChange.mock.lastCall?.[0] ?? [])).toEqual([]);
  });

  it("restores nontrivial scroll state after reset and highlights the current file safely", () => {
    const note = file('/notes-root/quote"note.md', 'quote"note.md');
    const modelState = createModel();
    modelState.add('quote"note.md', false);
    const scroll = document.createElement("div");
    scroll.dataset.fileTreeVirtualizedScroll = "true";
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    });
    scroll.scrollTop = 70;
    scroll.scrollLeft = 9;
    modelState.shadowRoot.append(scroll);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      scroll.scrollTop = 0;
      scroll.scrollLeft = 0;
      callback(0);
      return 1;
    });
    const store = createStore();
    selectCurrentFile(store, note);
    state.model = modelState.model;

    renderHook(() => useFileExplorerModel({ enableFileMove: false, items: [note], syncSelection: false }), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    expect(scroll.scrollTop).toBe(70);
    expect(scroll.scrollLeft).toBe(9);
    const style = modelState.shadowRoot.getElementById(OPEN_FILE_STYLE_ID);
    expect(style?.textContent).toContain('quote\\"note.md');
    expect(modelState.shadowRoot.querySelectorAll(`#${OPEN_FILE_STYLE_ID}`)).toHaveLength(1);
  });

  it("keeps a reader pinned to the bottom when a reset changes the scroll range", () => {
    const note = file("/notes-root/note.md");
    const modelState = createModel();
    modelState.add("note.md", false);
    const scroll = document.createElement("div");
    scroll.dataset.fileTreeVirtualizedScroll = "true";
    let scrollHeight = 500;
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    });
    scroll.scrollTop = 380;
    scroll.scrollLeft = 4;
    modelState.shadowRoot.append(scroll);
    modelState.model.resetPaths.mockImplementation(() => {
      scrollHeight = 700;
      scroll.scrollTop = 0;
      scroll.scrollLeft = 0;
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    renderModel(modelState, { items: [note] });

    expect(scroll.scrollTop).toBe(600);
    expect(scroll.scrollLeft).toBe(4);
  });

  it.each([
    ["horizontal position", 100, 7],
    ["long scroll range", 200, 0],
  ])("restores scroll state triggered only by %s", (_case, scrollHeight, scrollLeft) => {
    const note = file("/notes-root/note.md");
    const modelState = createModel();
    modelState.add("note.md", false);
    const scroll = document.createElement("div");
    scroll.dataset.fileTreeVirtualizedScroll = "true";
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: scrollHeight },
    });
    scroll.scrollTop = 0;
    scroll.scrollLeft = scrollLeft;
    modelState.shadowRoot.append(scroll);
    modelState.model.resetPaths.mockImplementation(() => {
      scroll.scrollTop = 99;
      scroll.scrollLeft = 99;
    });
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    renderModel(modelState, { items: [note] });

    expect(request).toHaveBeenCalledTimes(1);
    expect(scroll.scrollTop).toBe(0);
    expect(scroll.scrollLeft).toBe(scrollLeft);
  });

  it("abandons delayed scroll restoration when Pierre removes its scroll element", () => {
    const note = file("/notes-root/note.md");
    const modelState = createModel();
    modelState.add("note.md", false);
    const scroll = document.createElement("div");
    scroll.dataset.fileTreeVirtualizedScroll = "true";
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 200 },
    });
    scroll.scrollTop = 40;
    modelState.shadowRoot.append(scroll);
    let restore: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      restore = callback;
      return 1;
    });

    renderModel(modelState, { items: [note] });
    scroll.remove();

    expect(restore).not.toBeNull();
    expect(() => restore?.(0)).not.toThrow();
  });

  it("works with an empty lookup and a Pierre host that has no open shadow root", () => {
    const host = document.createElement("div");
    const modelState = createModel();
    modelState.model.getFileTreeContainer.mockReturnValue(host);
    const { result } = renderModel(modelState);

    expect(result.current.lookup.paths).toEqual([]);
    expect(modelState.model.resetPaths).not.toHaveBeenCalled();
    expect(host.querySelector(`#${OPEN_FILE_STYLE_ID}`)).toBeNull();
  });
});
