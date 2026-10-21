import type { FileTree } from "@pierre/trees";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Provider, createStore, useAtom, useAtomValue } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileItem } from "../../src/shared/file-item";
import { FileExplorerTree } from "../../src/renderer/src/features/files/explorer/FileExplorerTree";
import {
  buildExplorerTreeLookup,
  getFileTreeMoveIntent,
  getTreeDropTargetFromHoveredPath,
} from "../../src/renderer/src/features/files/explorer/fileExplorerTreeUtils";
import { AppDndProvider } from "../../src/renderer/src/shared/dnd/AppDndProvider";
import {
  expandedDirectoriesAtom,
  explorerSelectionPathsAtom,
  fileExplorerRevealRequestAtom,
  fileTreeAtom,
} from "../../src/renderer/src/store/fileExplorerStore";
import { projectFileMoves, fileMoveRemapper } from "../../src/renderer/src/features/files/optimisticFileMove";
import { remapFileReferencesAtom } from "../../src/renderer/src/store/fileLifecycleStore";
import { notificationsAtom } from "../../src/renderer/src/store/NotificationsStore";
import { explorerSortAtom } from "../../src/renderer/src/store/explorerSortStore";

const state = vi.hoisted(() => ({
  open: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  attach: vi.fn(),
  move: vi.fn(),
  paste: vi.fn(),
  copy: vi.fn(),
  model: null as unknown as FileTree,
}));
vi.mock("@pierre/trees/react", async (original) => {
  const actual = await original<typeof import("@pierre/trees/react")>();
  return {
    ...actual,
    useFileTree: (...args: Parameters<typeof actual.useFileTree>) => {
      const result = actual.useFileTree(...args);
      state.model = result.model;
      return result;
    },
  };
});
vi.mock("@renderer/features/files/fileActions", () => ({
  useFileOpen: () => ({ open: state.open }),
  useFileRemove: () => ({ removeMany: state.remove }),
  useFileRename: () => ({ saveRename: state.rename, stopRenaming: vi.fn() }),
  useFileMove: () => ({ moveManyToDirectory: state.move, attachManyToPdf: state.attach }),
}));
vi.mock("@renderer/features/files/menus/useFileMenu", () => ({ useFileMenu: () => ({ openFileMenuAt: vi.fn() }) }));
vi.mock("@renderer/features/files/menus/useDirectoryMenu", () => ({
  useDirectoryMenu: () => ({ openDirectoryMenuAt: vi.fn(), openRootMenuAt: vi.fn() }),
}));
vi.mock("@renderer/features/files/useFileClipboard", () => ({
  useFileClipboard: () => ({ copyItems: state.copy, pasteClipboardData: state.paste }),
}));

const file = (name: string, mimeType = "text/markdown"): FileItem => ({
  id: `/notes/${name}`,
  path: `/notes/${name}`,
  relativePath: name,
  filename: name.split("/").at(-1)!.replace(/\.md$/, ""),
  isDirectory: false,
  mimeType,
});
const directory = (name: string, children: FileItem[]): FileItem => ({
  id: `/notes/${name}`,
  path: `/notes/${name}`,
  relativePath: name,
  filename: name.split("/").at(-1)!,
  isDirectory: true,
  mimeType: null,
  children,
});
const pdf = file("Paper.pdf", "application/pdf");
const note = file("Paper.pdf.notes/Summary.md");
const companion = directory("Paper.pdf.notes", [
  note,
  directory("Paper.pdf.notes/assets", [file("Paper.pdf.notes/assets/figure.png", "image/png")]),
]);
const files = () => [directory("Folder", []), pdf, companion, file("Alone.pdf", "application/pdf"), file("a.md")];
const row = (container: HTMLElement, key: string) =>
  [
    ...(container
      .querySelector("file-tree-container")
      ?.shadowRoot?.querySelectorAll<HTMLElement>("[data-type='item']") ?? []),
  ].find((element) => element.dataset.itemPath === key);
const rows = (container: HTMLElement) =>
  [
    ...(container
      .querySelector("file-tree-container")
      ?.shadowRoot?.querySelectorAll<HTMLElement>("[data-type='item']") ?? []),
  ].map((element) => element.dataset.itemPath);
const click = (target: Element) =>
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  });
const key = (target: Element, value: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, composed: true }));
  });
const setup = (
  enableFileMove = false,
  onExternalPdfNoteDrop?: (files: File[], pdf: FileItem) => void,
  initialItems = files(),
) => {
  const store = createStore();
  store.set(fileTreeAtom, initialItems);
  const Harness = () => {
    const items = useAtomValue(fileTreeAtom);
    const [expanded, setExpanded] = useAtom(expandedDirectoriesAtom);
    return (
      <FileExplorerTree
        enableFileMove={enableFileMove}
        onExternalPdfNoteDrop={onExternalPdfNoteDrop}
        items={items}
        expandedDirectories={expanded}
        onExpandedDirectoriesChange={setExpanded}
        syncSelection
        gitStatus={[{ path: "Paper.pdf", status: "modified" }]}
      />
    );
  };
  return {
    store,
    ...render(
      <Provider store={store}>
        <AppDndProvider>
          <Harness />
        </AppDndProvider>
      </Provider>,
    ),
  };
};
beforeEach(() => {
  window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
  state.rename.mockResolvedValue({ success: true });
  state.attach.mockResolvedValue({ moved: [], failures: [] });
  state.move.mockResolvedValue({ moved: [], failures: [] });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("expands using Notes, opens using the PDF icon, title or Enter, and opens notes at their real paths", async () => {
  const { container, store } = setup();
  await waitFor(() => expect(row(container, "Paper.pdf.notes/")?.getAttribute("aria-label")).toBe("Paper.pdf"));
  const pdfRow = row(container, "Paper.pdf.notes/")!;
  expect(pdfRow.getAttribute("aria-expanded")).toBe("false");
  expect(row(container, "Paper.pdf")).toBeUndefined();
  expect(row(container, "Paper.pdf.notes/Summary.md")).toBeUndefined();
  expect(store.get(fileTreeAtom).find((item) => item.path === pdf.path)).not.toHaveProperty("children");
  const toggle = pdfRow.querySelector<HTMLElement>("[data-obim-pdf-notes-toggle]")!;
  expect(toggle.textContent).toBe("Notes");
  expect(toggle.title).toBe("Show notes for Paper.pdf");
  expect(pdfRow.getAttribute("aria-description")).toContain("Right Arrow shows notes");
  expect(pdfRow.querySelector("[data-item-section='icon'] [data-obim-pdf-glyph] use")?.getAttribute("href")).toBe(
    "#obim-file-pdf",
  );
  expect(pdfRow.querySelector("[data-item-section='decoration'] [data-obim-pdf-glyph]")).toBeNull();
  click(pdfRow.querySelector("[data-item-section='icon']")!);
  expect(state.open).toHaveBeenLastCalledWith(pdf, { focusEditor: true });
  expect(pdfRow.getAttribute("aria-expanded")).toBe("false");
  click(toggle);
  await waitFor(() => expect(row(container, "Paper.pdf.notes/Summary.md")).toBeDefined());
  expect(state.open).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(toggle.title).toBe("Hide notes for Paper.pdf"));
  await waitFor(() =>
    expect(container.querySelector("file-tree-container")?.shadowRoot?.activeElement?.getAttribute("role")).toBe(
      "tree",
    ),
  );
  expect(store.get(expandedDirectoriesAtom)).toContain("Paper.pdf.notes");
  expect(pdfRow.querySelector("[data-obim-pdf-glyph] use")?.getAttribute("href")).toBe("#obim-file-pdf");
  expect(pdfRow.getAttribute("data-item-git-status")).toBe("modified");
  click(pdfRow.querySelector("[data-item-section='decoration']")!);
  expect(state.open).toHaveBeenLastCalledWith(pdf, { focusEditor: true });
  expect(pdfRow.getAttribute("aria-expanded")).toBe("true");
  expect(store.get(explorerSelectionPathsAtom)).toEqual([pdf.path]);
  act(() => state.model.focusPath("Paper.pdf.notes/"));
  key(pdfRow, "Enter");
  expect(state.open).toHaveBeenCalledTimes(3);
  expect(pdfRow.getAttribute("aria-expanded")).toBe("true");
  click(row(container, "Paper.pdf.notes/Summary.md")!);
  expect(state.open).toHaveBeenLastCalledWith(note, { focusEditor: true });
  expect(store.get(explorerSelectionPathsAtom)).toEqual([note.path]);
  act(() => state.model.focusPath("Paper.pdf.notes/"));
  key(pdfRow, "ArrowLeft");
  await waitFor(() => expect(row(container, "Paper.pdf.notes/Summary.md")).toBeUndefined());
  await waitFor(() => expect(toggle.title).toBe("Show notes for Paper.pdf"));
  key(pdfRow, "ArrowRight");
  await waitFor(() => expect(row(container, "Paper.pdf.notes/Summary.md")).toBeDefined());
});

it("opens a PDF on the first click after an initially empty explorer receives its files", async () => {
  const { container, store } = setup(false, undefined, []);
  act(() => store.set(fileTreeAtom, files()));
  await waitFor(() =>
    expect(row(container, "Paper.pdf.notes/")?.querySelector("[data-obim-pdf-notes-toggle]")).toBeTruthy(),
  );

  click(row(container, "Paper.pdf.notes/")!.querySelector("[data-item-section='icon']")!);

  expect(state.open).toHaveBeenCalledOnce();
  expect(state.open).toHaveBeenCalledWith(pdf, { focusEditor: true });
  expect(row(container, "Paper.pdf.notes/")?.getAttribute("aria-expanded")).toBe("false");
});

it("reveals real note paths, preserves PDF sorting, and exposes an ordinary folder after external PDF deletion", async () => {
  const { container, store } = setup();
  await waitFor(() => expect(row(container, "Paper.pdf.notes/")).toBeDefined());
  act(() => store.set(fileExplorerRevealRequestAtom, { relativePath: note.relativePath }));
  await waitFor(() => expect(store.get(explorerSelectionPathsAtom)).toEqual([note.path]));
  expect(row(container, note.relativePath)).toBeDefined();
  act(() => store.set(explorerSortAtom, { by: "type", direction: "ascending" }));
  await waitFor(() => expect(rows(container).slice(0, 3)).toEqual(["Folder/", "a.md", "Paper.pdf.notes/"]));
  act(() =>
    store.set(
      fileTreeAtom,
      files().filter((item) => item.path !== pdf.path),
    ),
  );
  await waitFor(() => expect(row(container, "Paper.pdf.notes/")?.getAttribute("data-obim-pdf-group")).toBeNull());
  expect(row(container, "Paper.pdf.notes/")?.querySelector("[data-obim-pdf-notes-toggle]")).toBeNull();
  expect(row(container, "Paper.pdf.notes/")?.querySelector("[data-obim-pdf-glyph]")).toBeNull();
  expect(row(container, "Paper.pdf.notes/")?.getAttribute("aria-description")).toBeNull();
  expect(row(container, "Paper.pdf.notes/Summary.md")).toBeDefined();
  expect(row(container, "Paper.pdf.notes/")?.getAttribute("aria-label")).toBe("Paper.pdf.notes");
  expect(store.get(explorerSelectionPathsAtom)).toEqual([note.path]);
});

it("renames the PDF without leaking the companion suffix and deletes only the actual PDF", async () => {
  const { container, store } = setup();
  await waitFor(() => expect(row(container, "Paper.pdf.notes/")).toBeDefined());
  act(() => {
    state.model.focusPath("Paper.pdf.notes/");
    state.model.startRenaming("Paper.pdf.notes/");
  });
  await waitFor(() =>
    expect(row(container, "Paper.pdf.notes/")?.querySelector<HTMLInputElement>("input")?.value).toBe("Paper.pdf"),
  );
  const input = row(container, "Paper.pdf.notes/")!.querySelector<HTMLInputElement>("input")!;
  fireEvent.input(input, { target: { value: "Renamed.pdf" } });
  key(input, "Enter");
  await waitFor(() => expect(state.rename).toHaveBeenCalledWith(pdf.path, "Renamed.pdf"));
  act(() => {
    state.model.getItem("Paper.pdf.notes/")?.select();
    state.model.focusPath("Paper.pdf.notes/");
  });
  key(row(container, "Paper.pdf.notes/")!, "Delete");
  expect(state.remove).toHaveBeenCalledWith([pdf]);
  expect(store.get(fileTreeAtom)).toContain(companion);
});

it("uses actual companion directories as drop targets and rejects moving a PDF into its own notes", () => {
  const lookup = buildExplorerTreeLookup(files());
  const target = getTreeDropTargetFromHoveredPath("Paper.pdf.notes/", lookup);
  const noteElsewhere = file("Elsewhere.md");
  const withNote = buildExplorerTreeLookup([...files(), noteElsewhere]);
  expect(getFileTreeMoveIntent(["Elsewhere.md"], target, withNote, "/notes")).toMatchObject({
    absolutePath: companion.path,
    sourceItems: [noteElsewhere],
  });
  expect(
    getFileTreeMoveIntent(
      ["Paper.pdf.notes/"],
      { kind: "directory", directoryPath: "Paper.pdf.notes/assets/" },
      lookup,
      "/notes",
    ),
  ).toBeNull();
  expect(
    getFileTreeMoveIntent(
      ["Paper.pdf.notes/", note.relativePath],
      { kind: "directory", directoryPath: "Folder/" },
      lookup,
      "/notes",
    )?.sourceItems,
  ).toEqual([pdf]);
});

class TreeDragEvent extends MouseEvent {
  dataTransfer: DataTransfer;
  constructor(type: string, init: MouseEventInit & { dataTransfer: DataTransfer }) {
    super(type, init);
    this.dataTransfer = init.dataTransfer;
  }
}
const transfer = () => {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    setDragImage: vi.fn(),
    files: [],
    items: [],
    effectAllowed: "copyMove",
    dropEffect: "none",
  } as unknown as DataTransfer;
};
const dragEvent = (element: Element, type: string, dataTransfer: DataTransfer) => {
  vi.stubGlobal("DragEvent", TreeDragEvent);
  act(() =>
    element.dispatchEvent(
      new TreeDragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: 10,
        clientY: 25,
        dataTransfer,
      }),
    ),
  );
};
const readyForDrag = () =>
  act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
const hitTarget = (container: HTMLElement, target: HTMLElement) => {
  const shadow = container.querySelector("file-tree-container")!.shadowRoot!;
  Object.defineProperty(shadow, "elementFromPoint", { configurable: true, value: () => target });
  target.getBoundingClientRect = () => ({
    bottom: 40,
    height: 24,
    left: 0,
    right: 260,
    top: 16,
    width: 260,
    x: 0,
    y: 16,
    toJSON: () => ({}),
  });
};

it.each(["Alone.pdf", "Paper.pdf.notes/"])(
  "attaches directly to %s with explicit feedback and no optimistic parent-folder move",
  async (targetKey) => {
    const { container } = setup(true);
    await waitFor(() => expect(row(container, targetKey)).toBeDefined());
    const target = row(container, targetKey)!;
    const source = row(container, "a.md")!;
    const data = transfer();
    hitTarget(container, target);
    await readyForDrag();
    dragEvent(source, "dragstart", data);
    dragEvent(target, "dragover", data);
    expect(target.dataset.pdfNoteDrop).toBe("valid");
    expect(document.body.textContent).toContain(
      `Attach note to ${targetKey === "Alone.pdf" ? "Alone.pdf" : "Paper.pdf"}`,
    );
    expect(row(container, "a.md")).toBeDefined();
    dragEvent(target, "drop", data);
    await waitFor(() =>
      expect(state.attach).toHaveBeenCalledWith(
        [file("a.md")],
        targetKey === "Alone.pdf" ? file("Alone.pdf", "application/pdf") : pdf,
      ),
    );
    expect(state.move).not.toHaveBeenCalled();
    expect(target.hasAttribute("data-pdf-note-drop")).toBe(false);
  },
);

it.each(["Escape", "blur"])("clears PDF feedback on %s and prevents a later canceled drop", async (cancel) => {
  const { container } = setup(true);
  await waitFor(() => expect(row(container, "Alone.pdf")).toBeDefined());
  const target = row(container, "Alone.pdf")!;
  const source = row(container, "a.md")!;
  const data = transfer();
  hitTarget(container, target);
  await readyForDrag();
  dragEvent(source, "dragstart", data);
  dragEvent(target, "dragover", data);
  expect(target.dataset.pdfNoteDrop).toBe("valid");
  act(() =>
    window.dispatchEvent(cancel === "Escape" ? new KeyboardEvent("keydown", { key: "Escape" }) : new Event("blur")),
  );
  expect(target.hasAttribute("data-pdf-note-drop")).toBe(false);
  dragEvent(target, "drop", data);
  expect(state.attach).not.toHaveBeenCalled();
  expect(state.move).not.toHaveBeenCalled();
});

it("rejects mixed note/PDF selections and self-drops without moving anything into the PDF's parent", async () => {
  const { container } = setup(true);
  await waitFor(() => expect(row(container, "Alone.pdf")).toBeDefined());
  const target = row(container, "Paper.pdf.notes/")!;
  const source = row(container, "Alone.pdf")!;
  const data = transfer();
  hitTarget(container, target);
  await readyForDrag();
  dragEvent(source, "dragstart", data);
  dragEvent(target, "dragover", data);
  expect(target.dataset.pdfNoteDrop).toBe("invalid");
  dragEvent(target, "drop", data);
  expect(state.attach).not.toHaveBeenCalled();
  expect(state.move).not.toHaveBeenCalled();
  expect(target.hasAttribute("data-pdf-note-drop")).toBe(false);

  act(() => {
    state.model.getSelectedPaths().forEach((key) => state.model.getItem(key)?.deselect());
    state.model.getItem("a.md")?.select();
    state.model.getItem("Alone.pdf")?.select();
  });
  const mixed = transfer();
  dragEvent(row(container, "a.md")!, "dragstart", mixed);
  dragEvent(target, "dragover", mixed);
  expect(target.dataset.pdfNoteDrop).toBe("invalid");
  dragEvent(target, "drop", mixed);
  const self = transfer();
  dragEvent(target, "dragstart", self);
  dragEvent(target, "dragover", self);
  expect(target.dataset.pdfNoteDrop).toBe("invalid");
  dragEvent(target, "drop", self);
  expect(state.attach).not.toHaveBeenCalled();
  expect(state.move).not.toHaveBeenCalled();
});

it("routes external Markdown to the PDF import operation and rejects non-Markdown files", async () => {
  const imported = vi.fn();
  const { container } = setup(true, imported);
  await waitFor(() => expect(row(container, "Alone.pdf")).toBeDefined());
  const target = row(container, "Alone.pdf")!;
  const note = new File(["note"], "Summary.md", { type: "text/markdown" });
  const data = { ...transfer(), types: ["Files"], files: [note], items: [] } as unknown as DataTransfer;
  dragEvent(target, "dragenter", data);
  dragEvent(target, "dragover", data);
  expect(target.dataset.pdfNoteDrop).toBe("valid");
  expect(data.dropEffect).toBe("copy");
  dragEvent(target, "drop", data);
  expect(imported).toHaveBeenCalledWith([note], file("Alone.pdf", "application/pdf"));
  const image = new File(["image"], "figure.png", { type: "image/png" });
  const invalid = { ...transfer(), types: ["Files"], files: [image], items: [] } as unknown as DataTransfer;
  dragEvent(target, "dragenter", invalid);
  dragEvent(target, "dragover", invalid);
  expect(target.dataset.pdfNoteDrop).toBe("invalid");
  dragEvent(target, "drop", invalid);
  expect(imported).toHaveBeenCalledTimes(1);
  expect(state.move).not.toHaveBeenCalled();
});

it("renders a detached note as ordinary Markdown and removes stale PDF decorations after row updates", async () => {
  const { container, store } = setup();
  await waitFor(() => expect(row(container, "Paper.pdf.notes/")).toBeDefined());
  const standalone = file("Summary.md");
  act(() =>
    store.set(fileTreeAtom, [
      ...files().map((item) => (item === companion && item.isDirectory ? { ...item, children: [] } : item)),
      standalone,
    ]),
  );
  await waitFor(() => expect(row(container, "Summary.md")).toBeDefined());
  const target = row(container, "Summary.md")!;
  act(() => {
    const stale = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    stale.dataset.obimPdfGlyph = "true";
    target.querySelector("[data-item-section='decoration'] > span")!.prepend(stale);
  });
  await waitFor(() => expect(target.querySelector("[data-obim-pdf-glyph]")).toBeNull());
  expect(target.dataset.obimPdfGroup).toBeUndefined();
  expect(target.querySelectorAll("use[href='#file-tree-builtin-text']")).toHaveLength(1);
  expect(target.title).toBe("Summary.md");
});

it("preserves all selected notes while revealing a multi-note attachment", async () => {
  const { container, store } = setup(true);
  await waitFor(() => expect(row(container, "Alone.pdf")).toBeDefined());
  act(() => store.set(expandedDirectoriesAtom, new Set(["Paper.pdf.notes"])));
  await waitFor(() => expect(row(container, note.relativePath)).toBeDefined());
  const source = row(container, "a.md")!;
  const target = row(container, "Alone.pdf")!;
  hitTarget(container, target);
  await readyForDrag();
  act(() => {
    state.model.getItem("a.md")?.select();
    state.model.getItem(note.relativePath)?.select();
  });
  const data = transfer();
  dragEvent(source, "dragstart", data);
  dragEvent(target, "dragover", data);
  expect(document.body.textContent).toContain("Attach 2 notes to Alone.pdf");
  dragEvent(target, "drop", data);
  await waitFor(() =>
    expect(state.attach).toHaveBeenCalledWith(
      expect.arrayContaining([file("a.md"), note]),
      file("Alone.pdf", "application/pdf"),
    ),
  );
  // Finish the mocked drop before publishing the separate simulated filesystem refresh.
  await act(async () => {
    await state.attach.mock.results[0].value;
  });
  const movedA = file("Alone.pdf.notes/a.md");
  const movedSummary = file("Alone.pdf.notes/Summary.md");
  act(() => {
    store.set(fileTreeAtom, [
      ...files()
        .filter((item) => item.relativePath !== "a.md")
        .map((item) =>
          item.isDirectory && item.path === companion.path
            ? { ...item, children: (item.children ?? []).filter((child) => child.path !== note.path) }
            : item,
        ),
      directory("Alone.pdf.notes", [movedA, movedSummary]),
    ]);
    store.set(explorerSelectionPathsAtom, [movedA.path, movedSummary.path]);
    store.set(fileExplorerRevealRequestAtom, { relativePath: movedSummary.relativePath, preserveSelection: true });
  });
  await waitFor(() => expect(row(container, movedA.relativePath)).toBeDefined());
  expect(store.get(explorerSelectionPathsAtom)).toEqual([movedA.path, movedSummary.path]);
  expect(row(container, movedA.relativePath)?.hasAttribute("data-item-selected")).toBe(true);
  expect(row(container, movedSummary.relativePath)?.hasAttribute("data-item-selected")).toBe(true);
});

it("keeps empty companions on disk while their PDFs have no chevron, and still exposes asset-only contents", async () => {
  const empty = directory("Paper.pdf.notes", []);
  const physical = [pdf, empty];
  const lookup = buildExplorerTreeLookup(physical);
  expect(lookup.paths).toEqual(["Paper.pdf"]);
  expect(lookup.directoryTreePaths).toEqual([]);
  expect(physical).toEqual([pdf, empty]);
  const { container, store } = setup(false, undefined, physical);
  await waitFor(() => expect(row(container, "Paper.pdf")).toBeDefined());
  expect(row(container, "Paper.pdf")?.querySelector('[data-icon-name="file-tree-icon-chevron"]')).toBeNull();
  expect(row(container, "Paper.pdf")?.querySelector("[data-obim-pdf-notes-toggle]")).toBeNull();
  expect(row(container, "Paper.pdf.notes/")).toBeUndefined();
  act(() => store.set(fileTreeAtom, [pdf, directory("Paper.pdf.notes", [directory("Paper.pdf.notes/assets", [])])]));
  await waitFor(() => expect(row(container, "Paper.pdf.notes/")).toBeDefined());
  await waitFor(() =>
    expect(row(container, "Paper.pdf.notes/")?.querySelector("[data-obim-pdf-notes-toggle]")).toBeTruthy(),
  );
  click(row(container, "Paper.pdf.notes/")!.querySelector("[data-obim-pdf-notes-toggle]")!);
  await waitFor(() => expect(row(container, "Paper.pdf.notes/assets/")).toBeDefined());
});

it("retains real keyboard focus and selection through the first attachment and last detachment", async () => {
  const source = file("a.md");
  const moved = file("Paper.pdf.notes/a.md");
  const empty = directory("Paper.pdf.notes", []);
  const { container, store } = setup(true, undefined, [pdf, empty, source]);
  state.attach.mockImplementation(async () => {
    store.set(fileTreeAtom, [pdf, directory("Paper.pdf.notes", [moved])]);
    return { moved: [{ file: source, movedPath: moved.path }], failures: [] };
  });
  state.move.mockImplementation(async () => {
    store.set(fileTreeAtom, [pdf, empty, source]);
    return { moved: [{ file: moved, movedPath: source.path }], failures: [] };
  });
  await waitFor(() => expect(row(container, "Paper.pdf")).toBeDefined());
  await readyForDrag();
  const target = row(container, "Paper.pdf")!;
  const from = row(container, "a.md")!;
  hitTarget(container, target);
  act(() => from.focus());
  const data = transfer();
  dragEvent(from, "dragstart", data);
  dragEvent(target, "dragover", data);
  dragEvent(target, "drop", data);
  await waitFor(() => expect(row(container, moved.relativePath)?.getRootNode()).toBeDefined());
  const shadow = container.querySelector("file-tree-container")!.shadowRoot!;
  await waitFor(() => expect(shadow.activeElement).toBe(row(container, moved.relativePath)));
  expect(state.model.getFocusedPath()).toBe(moved.relativePath);
  expect(state.model.getSelectedPaths()).toEqual([moved.relativePath]);
  expect(store.get(explorerSelectionPathsAtom)).toEqual([moved.path]);
  key(row(container, moved.relativePath)!, "ArrowUp");
  await waitFor(() => expect(state.model.getFocusedPath()).toBe("Paper.pdf.notes/"));
  const child = row(container, moved.relativePath)!;
  act(() => child.focus());
  const root = shadow.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll='true']")!;
  const out = transfer();
  dragEvent(child, "dragstart", out);
  dragEvent(root, "drop", out);
  await waitFor(() => expect(shadow.activeElement).toBe(row(container, source.relativePath)));
  expect(state.model.getSelectedPaths()).toEqual([source.relativePath]);
  expect(store.get(explorerSelectionPathsAtom)).toEqual([source.path]);
  expect(row(container, "Paper.pdf.notes/")).toBeUndefined();
  expect(row(container, "Paper.pdf")?.querySelector('[data-icon-name="file-tree-icon-chevron"]')).toBeNull();
  expect(store.get(fileTreeAtom)).toContain(empty);
});

it("keeps a late attachment selected without taking focus from another control", async () => {
  const source = file("a.md");
  const moved = file("Paper.pdf.notes/a.md");
  const { container, store } = setup(true, undefined, [pdf, source]);
  let complete!: () => void;
  state.attach.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = () => {
          store.set(fileTreeAtom, [pdf, directory("Paper.pdf.notes", [moved])]);
          resolve({ moved: [{ file: source, movedPath: moved.path }], failures: [] });
        };
      }),
  );
  await waitFor(() => expect(row(container, "Paper.pdf")).toBeDefined());
  await readyForDrag();
  const from = row(container, "a.md")!;
  const target = row(container, "Paper.pdf")!;
  hitTarget(container, target);
  act(() => from.focus());
  const data = transfer();
  dragEvent(from, "dragstart", data);
  dragEvent(target, "drop", data);
  await waitFor(() => expect(state.attach).toHaveBeenCalledOnce());
  const button = document.createElement("button");
  button.textContent = "Another control";
  document.body.append(button);
  act(() => button.focus());
  await act(async () => complete());
  await waitFor(() => expect(state.model.getSelectedPaths()).toEqual([moved.relativePath]));
  await waitFor(() => expect(store.get(fileExplorerRevealRequestAtom)).toBeNull());
  expect(document.activeElement).toBe(button);
  button.remove();
});

it("preserves the original row's focus and selection when attachment fails", async () => {
  const source = file("a.md");
  const { container, store } = setup(true, undefined, [pdf, source]);
  state.attach.mockResolvedValue({ moved: [], failures: [{ file: source, error: "Conflict" }] });
  await waitFor(() => expect(row(container, "Paper.pdf")).toBeDefined());
  await readyForDrag();
  const from = row(container, "a.md")!;
  const target = row(container, "Paper.pdf")!;
  hitTarget(container, target);
  act(() => from.focus());
  const data = transfer();
  dragEvent(from, "dragstart", data);
  dragEvent(target, "drop", data);
  const shadow = container.querySelector("file-tree-container")!.shadowRoot!;
  await waitFor(() => expect(store.get(fileExplorerRevealRequestAtom)).toBeNull());
  expect(shadow.activeElement).toBe(row(container, "a.md"));
  expect(state.model.getSelectedPaths()).toEqual(["a.md"]);
  expect(store.get(explorerSelectionPathsAtom)).toEqual([source.path]);
});

it("focuses a moved note when the drag also includes a note already attached to the destination", async () => {
  const source = file("a.md");
  const moved = file("Paper.pdf.notes/a.md");
  const { container, store } = setup(true, undefined, [pdf, directory("Paper.pdf.notes", [note]), source]);
  state.attach.mockImplementation(async () => {
    store.set(fileTreeAtom, [pdf, directory("Paper.pdf.notes", [note, moved])]);
    return { moved: [{ file: source, movedPath: moved.path }], failures: [] };
  });
  act(() => store.set(expandedDirectoriesAtom, new Set(["Paper.pdf.notes"])));
  await waitFor(() => expect(row(container, note.relativePath)).toBeDefined());
  await readyForDrag();
  const from = row(container, note.relativePath)!;
  const target = row(container, "Paper.pdf.notes/")!;
  hitTarget(container, target);
  act(() => {
    state.model.getSelectedPaths().forEach((path) => state.model.getItem(path)?.deselect());
    state.model.getItem(note.relativePath)?.select();
    state.model.getItem(source.relativePath)?.select();
    from.focus();
  });
  const data = transfer();
  dragEvent(from, "dragstart", data);
  dragEvent(target, "drop", data);
  await waitFor(() => expect(state.attach).toHaveBeenCalledWith([source], pdf));
  const shadow = container.querySelector("file-tree-container")!.shadowRoot!;
  await waitFor(() => expect(shadow.activeElement).toBe(row(container, moved.relativePath)));
  expect(store.get(explorerSelectionPathsAtom)).toEqual([moved.path]);
});

it.each([false, true])("keeps a moved PDF's expansion when expanded=%s", async (expanded) => {
  const { container, store } = setup(true);
  if (expanded) act(() => store.set(expandedDirectoriesAtom, new Set(["Paper.pdf.notes"])));
  const movedPdf = file("Folder/Paper.pdf", "application/pdf");
  const roots = [
    { source: pdf.path, destination: movedPdf.path, directory: false },
    { source: companion.path, destination: `${movedPdf.path}.notes`, directory: true },
  ];
  state.move.mockImplementation(async () => {
    const next = projectFileMoves(store.get(fileTreeAtom), roots, "/notes");
    store.set(remapFileReferencesAtom, { notesDirectoryPath: "/notes", remapPath: fileMoveRemapper(roots) });
    store.set(fileTreeAtom, next);
    return { moved: [{ file: pdf, movedPath: movedPdf.path }], failures: [] };
  });
  await waitFor(() => expect(row(container, "Paper.pdf.notes/")?.getAttribute("aria-expanded")).toBe(String(expanded)));
  await readyForDrag();
  const from = row(container, "Paper.pdf.notes/")!;
  const target = row(container, "Folder/")!;
  hitTarget(container, target);
  act(() => from.focus());
  const data = transfer();
  dragEvent(from, "dragstart", data);
  dragEvent(target, "dragover", data);
  dragEvent(target, "drop", data);
  await waitFor(() => expect(state.move).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(row(container, "Folder/Paper.pdf.notes/")?.getAttribute("aria-expanded")).toBe(String(expanded)),
  );
  await waitFor(() => expect(store.get(fileExplorerRevealRequestAtom)).toBeNull());
  expect(store.get(expandedDirectoriesAtom).has("Folder/Paper.pdf.notes")).toBe(expanded);
  expect(Boolean(row(container, "Folder/Paper.pdf.notes/Summary.md"))).toBe(expanded);
  expect(state.open).not.toHaveBeenCalled();
});

it.each([true, false])(
  "does not restore an older attachment's focus after a new gesture (success=%s)",
  async (success) => {
    const source = file("a.md");
    const next = file("b.md");
    const moved = file("Paper.pdf.notes/a.md");
    const { container, store } = setup(true, undefined, [pdf, source, next]);
    let complete!: () => void;
    state.attach.mockImplementation(() => {
      const roots = [{ source: source.path, destination: moved.path, directory: false }];
      store.set(remapFileReferencesAtom, { notesDirectoryPath: "/notes", remapPath: fileMoveRemapper(roots) });
      store.set(fileTreeAtom, [pdf, directory("Paper.pdf.notes", [moved]), next]);
      return new Promise((resolve) => {
        complete = () => {
          if (!success) store.set(fileTreeAtom, [pdf, source, next]);
          resolve(
            success
              ? { moved: [{ file: source, movedPath: moved.path }], failures: [] }
              : { moved: [], failures: [{ file: source, error: "Conflict" }] },
          );
        };
      });
    });
    await waitFor(() => expect(row(container, "Paper.pdf")).toBeDefined());
    await readyForDrag();
    const from = row(container, "a.md")!;
    const target = row(container, "Paper.pdf")!;
    hitTarget(container, target);
    act(() => from.focus());
    const data = transfer();
    dragEvent(from, "dragstart", data);
    dragEvent(target, "drop", data);
    const shadow = container.querySelector("file-tree-container")!.shadowRoot!;
    await waitFor(() => expect(shadow.activeElement).toBe(row(container, moved.relativePath)));
    act(() => {
      row(container, "b.md")!.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
      row(container, "b.md")!.focus();
      store.set(explorerSelectionPathsAtom, [next.path]);
    });
    await act(async () => complete());
    expect(store.get(explorerSelectionPathsAtom)).toEqual([next.path]);
    expect(shadow.activeElement).toBe(row(container, "b.md"));
    expect(store.get(fileExplorerRevealRequestAtom)).toBeNull();
    if (!success) expect(store.get(notificationsAtom).at(-1)?.message).toContain("Conflict");
  },
);
