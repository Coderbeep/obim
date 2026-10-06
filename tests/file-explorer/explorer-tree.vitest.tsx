import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const treeProps = vi.hoisted(() => vi.fn());

vi.mock("@pierre/trees/react", () => ({
  FileTree: (props: React.HTMLAttributes<HTMLDivElement> & { model: unknown }) => {
    treeProps(props);
    const hostProps = { ...props };
    delete hostProps.children;
    delete hostProps.model;
    return <div data-testid="tree" {...hostProps} />;
  },
}));

import { ExplorerTree } from "../../src/renderer/src/features/files/explorer/tree/ExplorerTree";

const createModel = () => {
  const handles = new Map<string, ReturnType<typeof createHandle>>();
  const createItem = (path: string, isDirectory = false) => {
    const handle = createHandle(isDirectory);
    handles.set(path, handle);
    return handle;
  };

  return {
    handles,
    model: {
      getFileTreeContainer: () => null,
      getFocusedPath: vi.fn<() => string | null>(() => "focused"),
      getItem: vi.fn((path: string) => handles.get(path) ?? null),
      getSelectedPaths: vi.fn<() => string[]>(() => []),
    },
    createItem,
  };
};

const createHandle = (isDirectory = false) => {
  const handle = {
    deselect: vi.fn(),
    focus: vi.fn(),
    isDirectory: vi.fn(() => isDirectory),
    select: vi.fn(),
  };
  return isDirectory ? { ...handle, toggle: vi.fn() } : handle;
};

const appendRow = (tree: HTMLElement, path: string) => {
  const row = document.createElement("button");
  row.dataset.type = "item";
  row.dataset.itemPath = path;
  const icon = document.createElement("span");
  icon.dataset.itemSection = "icon";
  const label = document.createElement("span");
  label.textContent = path;
  row.append(icon, label);
  tree.append(row);
  return { icon, label, row };
};

const auxClick = (target: EventTarget, button: number) =>
  target.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button, cancelable: true }));

describe("ExplorerTree", () => {
  afterEach(() => {
    cleanup();
    treeProps.mockClear();
  });

  it("forwards styling and native handlers to Pierre", () => {
    const handlers = {
      onClickCapture: vi.fn(),
      onDrag: vi.fn(),
      onDragEnd: vi.fn(),
      onDragLeave: vi.fn(),
      onDragOver: vi.fn(),
      onDragStart: vi.fn(),
      onDrop: vi.fn(),
    };
    const { model } = createModel();

    render(<ExplorerTree className="extra" itemsByPath={new Map()} model={model as never} {...handlers} />);

    const { onClickCapture, ...nativeHandlers } = handlers;
    expect(treeProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ...nativeHandlers,
        className: "pierre-file-tree extra",
        onClickCapture: expect.any(Function),
      }),
    );
    fireEvent.click(document.querySelector("[data-testid='tree']")!);
    expect(onClickCapture).toHaveBeenCalledTimes(1);
  });

  it("opens a known row only for an unmodified primary click", () => {
    const open = vi.fn();
    const { model, createItem } = createModel();
    createItem("note.md");
    const { getByTestId } = render(
      <ExplorerTree model={model as never} itemsByPath={new Map([["note.md", "note"]])} onOpenItem={open} />,
    );
    const { label, row } = appendRow(getByTestId("tree"), "note.md");

    fireEvent.click(label);
    fireEvent.click(row, { button: 1 });
    fireEvent.click(row, { shiftKey: true });
    fireEvent.click(row, { ctrlKey: true });
    fireEvent.click(row, { metaKey: true });
    fireEvent.click(getByTestId("tree"));

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("note");
  });

  it("focuses and solely selects a toggled directory while keeping file icons actionable", () => {
    const open = vi.fn();
    const { model, createItem } = createModel();
    const folderHandle = createItem("Folder/", true);
    const noteHandle = createItem("note.md", false);
    model.getSelectedPaths.mockReturnValue(["note.md"]);
    const { getByTestId } = render(
      <ExplorerTree
        model={model as never}
        itemsByPath={
          new Map([
            ["Folder/", "folder"],
            ["note.md", "note"],
          ])
        }
        onOpenItem={open}
      />,
    );
    const folder = appendRow(getByTestId("tree"), "Folder/");
    const note = appendRow(getByTestId("tree"), "note.md");

    expect(fireEvent.click(folder.icon)).toBe(false);
    expect(fireEvent.click(folder.label, { ctrlKey: true })).toBe(false);
    expect(fireEvent.click(folder.label, { metaKey: true })).toBe(false);
    expect(fireEvent.click(folder.label, { shiftKey: true })).toBe(false);
    fireEvent.click(note.icon);

    expect("toggle" in folderHandle && folderHandle.toggle).toHaveBeenCalledTimes(1);
    expect(noteHandle.deselect).toHaveBeenCalledOnce();
    expect(folderHandle.focus).toHaveBeenCalledOnce();
    expect(folderHandle.select).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("note");
  });

  it("opens a known row in a new tab once on auxclick, not on middle-button down/up", () => {
    const openInNewTab = vi.fn();
    const { model } = createModel();
    const { getByTestId } = render(
      <ExplorerTree model={model as never} itemsByPath={new Map([["note.md", 0]])} onOpenItemInNewTab={openInNewTab} />,
    );
    const { row } = appendRow(getByTestId("tree"), "note.md");

    expect(fireEvent.mouseDown(row, { button: 1 })).toBe(false);
    expect(fireEvent.mouseUp(row, { button: 1 })).toBe(false);
    expect(auxClick(row, 1)).toBe(false);
    auxClick(row, 2);
    auxClick(getByTestId("tree"), 1);

    expect(openInNewTab).toHaveBeenCalledTimes(1);
    expect(openInNewTab).toHaveBeenCalledWith(0);
  });

  it("does not consume middle-button events when no matching action exists", () => {
    const { model } = createModel();
    const { getByTestId, rerender } = render(<ExplorerTree model={model as never} itemsByPath={new Map()} />);
    const row = appendRow(getByTestId("tree"), "missing.md").row;

    expect(fireEvent.mouseDown(row, { button: 1 })).toBe(true);
    expect(auxClick(row, 1)).toBe(true);

    rerender(<ExplorerTree model={model as never} itemsByPath={new Map()} onOpenItemInNewTab={vi.fn()} />);
    expect(fireEvent.mouseDown(row, { button: 1 })).toBe(true);
    expect(auxClick(row, 1)).toBe(true);
  });

  it("opens the focused payload with Enter and makes it the sole selection", () => {
    const open = vi.fn();
    const { model, createItem } = createModel();
    const old = createItem("old.md");
    const focused = createItem("focused");
    model.getSelectedPaths.mockReturnValue(["old.md"]);
    const { getByTestId } = render(
      <ExplorerTree model={model as never} itemsByPath={new Map([["focused", false]])} onOpenItem={open} />,
    );

    expect(fireEvent.keyDown(getByTestId("tree"), { key: "Enter" })).toBe(false);

    expect(old.deselect).toHaveBeenCalledTimes(1);
    expect(focused.select).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(false);
  });

  it("ignores irrelevant, repeated, unfocused, stale, and unhandled key activation", () => {
    const open = vi.fn();
    const { model } = createModel();
    const { getByTestId, rerender } = render(
      <ExplorerTree model={model as never} itemsByPath={new Map([["focused", "value"]])} onOpenItem={open} />,
    );
    const tree = getByTestId("tree");

    fireEvent.keyDown(tree, { key: "Space" });
    fireEvent.keyDown(tree, { key: "Enter", repeat: true });
    model.getFocusedPath.mockReturnValue(null);
    fireEvent.keyDown(tree, { key: "Enter" });
    model.getFocusedPath.mockReturnValue("stale.md");
    fireEvent.keyDown(tree, { key: "Enter" });
    rerender(<ExplorerTree model={model as never} itemsByPath={new Map([["focused", "value"]])} />);
    model.getFocusedPath.mockReturnValue("focused");
    fireEvent.keyDown(tree, { key: "Enter" });

    expect(open).not.toHaveBeenCalled();
  });
});
