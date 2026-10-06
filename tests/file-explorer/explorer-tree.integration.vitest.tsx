import { FileTree } from "@pierre/trees";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExplorerTree } from "../../src/renderer/src/features/files/explorer/tree/ExplorerTree";

describe("ExplorerTree with Pierre", () => {
  afterEach(cleanup);

  it("keeps pointer, keyboard, and selection ownership on the real model", async () => {
    const model = new FileTree({ paths: ["first.md", "second.md"], initialVisibleRowCount: 2 });
    const open = vi.fn();

    const { container } = render(
      <ExplorerTree
        model={model}
        itemsByPath={
          new Map([
            ["first.md", "first"],
            ["second.md", "second"],
          ])
        }
        onOpenItem={open}
      />,
    );

    const host = container.querySelector("file-tree-container");
    await waitFor(() => expect(host?.shadowRoot?.querySelectorAll("[data-type='item']").length).toBe(2));
    const [firstRow, secondRow] = Array.from(host!.shadowRoot!.querySelectorAll<HTMLElement>("[data-type='item']"));

    firstRow.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(open).toHaveBeenCalledWith("first");
    expect(model.getSelectedPaths()).toEqual(["first.md"]);

    secondRow.focus();
    secondRow.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    expect(open).toHaveBeenLastCalledWith("second");
    expect(model.getSelectedPaths()).toEqual(["second.md"]);

    model.cleanUp();
  });

  it("renders every directory in a compact chain as its own actionable row", async () => {
    const model = new FileTree({
      paths: ["A/", "A/B/", "A/B/C/"],
      flattenEmptyDirectories: false,
      initialExpansion: "open",
      initialVisibleRowCount: 3,
    });

    const { container } = render(
      <ExplorerTree
        model={model}
        itemsByPath={
          new Map([
            ["A/", "A"],
            ["A/B/", "B"],
            ["A/B/C/", "C"],
          ])
        }
      />,
    );

    const host = container.querySelector("file-tree-container");
    await waitFor(() => expect(host?.shadowRoot?.querySelectorAll("[data-type='item']").length).toBe(3));
    const rows = Array.from(host!.shadowRoot!.querySelectorAll<HTMLElement>("[data-type='item']"));
    expect(rows.map((row) => row.dataset.itemPath)).toEqual(["A/", "A/B/", "A/B/C/"]);

    model.cleanUp();
  });

  it("does not activate modifier selections, directory toggles, or repeated Enter presses", async () => {
    const model = new FileTree({
      paths: ["Folder/", "Folder/note.md"],
      flattenEmptyDirectories: false,
      initialExpansion: "open",
      initialVisibleRowCount: 2,
    });
    const open = vi.fn();
    const { container } = render(
      <ExplorerTree
        model={model}
        itemsByPath={
          new Map([
            ["Folder/", "folder"],
            ["Folder/note.md", "note"],
          ])
        }
        onOpenItem={open}
      />,
    );
    const host = container.querySelector("file-tree-container")!;
    await waitFor(() => expect(host.shadowRoot?.querySelectorAll("[data-type='item']").length).toBe(2));
    const [folderRow, noteRow] = Array.from(host.shadowRoot!.querySelectorAll<HTMLElement>("[data-type='item']"));
    const folderIcon = folderRow.querySelector<HTMLElement>("[data-item-section='icon']")!;

    folderIcon.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    noteRow.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, ctrlKey: true }));
    noteRow.focus();
    noteRow.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, composed: true }));

    expect(open).not.toHaveBeenCalled();
    model.cleanUp();
  });

  it("selects and focuses a directory when toggling it", async () => {
    const model = new FileTree({
      paths: ["Destination/child.md", "first.md", "second.md"],
      flattenEmptyDirectories: false,
      initialVisibleRowCount: 4,
    });
    const { container } = render(
      <ExplorerTree
        model={model}
        itemsByPath={
          new Map([
            ["Destination/", "destination"],
            ["Destination/child.md", "child"],
            ["first.md", "first"],
            ["second.md", "second"],
          ])
        }
      />,
    );
    const host = container.querySelector("file-tree-container")!;
    await waitFor(() => expect(host.shadowRoot?.querySelectorAll("[data-type='item']").length).toBe(3));
    const row = (path: string) => host.shadowRoot!.querySelector<HTMLElement>(`[data-item-path='${path}']`)!;

    const destinationRow = row("Destination/");
    destinationRow.focus();
    expect(host.shadowRoot?.activeElement).toBe(destinationRow);
    expect(fireEvent.mouseDown(destinationRow)).toBe(true);
    expect(fireEvent.click(destinationRow)).toBe(false);
    await waitFor(() => expect(row("Destination/child.md")).toBeTruthy());
    expect(model.getFocusedPath()).toBe("Destination/");
    expect(model.getSelectedPaths()).toEqual(["Destination/"]);
    row("first.md").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, ctrlKey: true }));
    row("second.md").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, ctrlKey: true }));

    expect(model.getSelectedPaths()).toEqual(["Destination/", "first.md", "second.md"]);

    row("Destination/").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await waitFor(() => expect(host.shadowRoot?.querySelector("[data-item-path='Destination/child.md']")).toBeNull());
    expect(model.getFocusedPath()).toBe("Destination/");
    expect(model.getSelectedPaths()).toEqual(["Destination/"]);
    model.cleanUp();
  });

  it("opens a file in a new tab exactly once for a complete middle click", async () => {
    const model = new FileTree({ paths: ["note.md"], initialVisibleRowCount: 1 });
    const openInNewTab = vi.fn();
    const { container } = render(
      <ExplorerTree model={model} itemsByPath={new Map([["note.md", "note"]])} onOpenItemInNewTab={openInNewTab} />,
    );
    const host = container.querySelector("file-tree-container")!;
    await waitFor(() => expect(host.shadowRoot?.querySelector("[data-type='item']")).toBeTruthy());
    const row = host.shadowRoot!.querySelector<HTMLElement>("[data-type='item']")!;

    row.dispatchEvent(new MouseEvent("mousedown", { button: 1, bubbles: true, composed: true }));
    row.dispatchEvent(new MouseEvent("mouseup", { button: 1, bubbles: true, composed: true }));
    row.dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true, composed: true }));

    expect(openInNewTab).toHaveBeenCalledTimes(1);
    expect(openInNewTab).toHaveBeenCalledWith("note");
    model.cleanUp();
  });

  it("lets Pierre resolve and complete a drop from the same highlighted target", async () => {
    const onDropComplete = vi.fn();
    const model = new FileTree({
      paths: ["Destination/", "Source/", "Source/note.md"],
      initialExpansion: "open",
      initialVisibleRowCount: 3,
      dragAndDrop: { onDropComplete },
    });
    const onDrop = vi.fn();
    const { container } = render(
      <ExplorerTree
        model={model}
        itemsByPath={new Map()}
        onDrop={onDrop}
      />,
    );
    const host = container.querySelector("file-tree-container")!;
    await waitFor(() => expect(host.shadowRoot?.querySelectorAll("[data-type='item']").length).toBe(3));
    const row = (path: string) => host.shadowRoot!.querySelector<HTMLElement>(`[data-item-path='${path}']`)!;
    const destinationRow = row("Destination/");
    Object.defineProperty(host.shadowRoot, "elementFromPoint", { value: () => row("Destination/") });
    destinationRow.getBoundingClientRect = () => ({
      bottom: 44,
      height: 24,
      left: 0,
      right: 100,
      top: 20,
      width: 100,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
    };

    fireEvent.dragStart(row("Source/note.md"), { clientX: 10, clientY: 10, dataTransfer });
    fireEvent.dragOver(destinationRow, { clientX: 10, clientY: 30, dataTransfer });
    await waitFor(() => expect(destinationRow.dataset.itemDragTarget).toBe("true"));
    fireEvent.drop(destinationRow, { clientX: 10, clientY: 30, dataTransfer });

    expect(onDropComplete).toHaveBeenCalledWith({
      draggedPaths: ["Source/note.md"],
      operation: "move",
      target: {
        directoryPath: "Destination/",
        flattenedSegmentPath: null,
        hoveredPath: "Destination/",
        kind: "directory",
      },
    });
    expect(onDrop).toHaveBeenCalledOnce();
    expect(model.getItem("Destination/note.md")).not.toBeNull();
    model.cleanUp();
  });
});
