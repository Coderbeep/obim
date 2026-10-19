import type { FileTree } from "@pierre/trees";
import { Provider, createStore } from "jotai";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExplorerSortMenu } from "../../src/renderer/src/features/files/explorer/ExplorerSortMenu";
import { useFileExplorerModel } from "../../src/renderer/src/features/files/explorer/useFileExplorerModel";
import { isTreeDirectoryHandle } from "../../src/renderer/src/features/files/explorer/fileExplorerTreeUtils";
import { ExplorerTree } from "../../src/renderer/src/features/files/explorer/tree/ExplorerTree";
import { EXPLORER_SORT_STORAGE_KEY, explorerSortAtom } from "../../src/renderer/src/store/explorerSortStore";
import { explorerSelectionPathsAtom } from "../../src/renderer/src/store/fileExplorerStore";
import type { FileItem } from "../../src/shared/file-item";

vi.mock("@renderer/features/files/fileActions", () => ({
  useFileRename: () => ({ saveRename: vi.fn(), stopRenaming: vi.fn() }),
}));

const file = (relativePath: string, mimeType: string): FileItem => ({
  id: `/notes/${relativePath}`,
  path: `/notes/${relativePath}`,
  relativePath,
  filename: relativePath.split("/").at(-1)!,
  mimeType,
  isDirectory: false,
});
const items: FileItem[] = [
  file("a.png", "image/png"),
  file("z.jpg", "image/jpeg"),
  file("m.pdf", "application/pdf"),
  file("c.zip", "application/zip"),
  file("b.md", "text/markdown"),
  {
    id: "/notes/Docs",
    path: "/notes/Docs",
    relativePath: "Docs",
    filename: "Docs",
    isDirectory: true,
    mimeType: null,
    children: [file("Docs/c.png", "image/png"), file("Docs/a.pdf", "application/pdf")],
  },
];
const expansion = new Set(["Docs"]);
const getRows = (container: HTMLElement) =>
  Array.from(
    container.querySelector("file-tree-container")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-type='item']") ??
      [],
  ).map((row) => row.dataset.itemPath);

describe("sorting through the real explorer model", () => {
  beforeEach(() => {
    localStorage.removeItem(EXPLORER_SORT_STORAGE_KEY);
    window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
  });
  afterEach(() => {
    cleanup();
    localStorage.removeItem(EXPLORER_SORT_STORAGE_KEY);
  });

  it("reorders siblings live from the toolbar while retaining selection, focus, expansion and model identity", async () => {
    const user = userEvent.setup();
    const store = createStore();
    let liveModel: FileTree | undefined;
    const Harness = () => {
      const { model, lookupRef } = useFileExplorerModel({
        enableFileMove: false,
        items,
        expandedDirectories: expansion,
        syncSelection: true,
      });
      liveModel = model;
      return (
        <>
          <ExplorerSortMenu />
          <ExplorerTree model={model} itemsByPath={lookupRef.current.byTreePath} />
        </>
      );
    };
    const { container } = render(
      <Provider store={store}>
        <Harness />
      </Provider>,
    );
    await waitFor(() =>
      expect(getRows(container)).toEqual([
        "Docs/",
        "Docs/a.pdf",
        "Docs/c.png",
        "a.png",
        "b.md",
        "c.zip",
        "m.pdf",
        "z.jpg",
      ]),
    );
    const model = liveModel!;
    act(() => {
      model.getItem("z.jpg")!.select();
      model.focusPath("a.png");
    });
    expect(store.get(explorerSelectionPathsAtom)).toEqual(["/notes/z.jpg"]);
    await user.click(screen.getByRole("button", { name: "Sort files" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Type, then name" }));
    await waitFor(() =>
      expect(getRows(container)).toEqual([
        "Docs/",
        "Docs/c.png",
        "Docs/a.pdf",
        "c.zip",
        "a.png",
        "z.jpg",
        "b.md",
        "m.pdf",
      ]),
    );
    expect(liveModel).toBe(model);
    expect(model.getSelectedPaths()).toEqual(["z.jpg"]);
    expect(model.getFocusedPath()).toBe("a.png");
    expect(store.get(explorerSelectionPathsAtom)).toEqual(["/notes/z.jpg"]);
    expect(expansion).toEqual(new Set(["Docs"]));

    act(() => store.set(explorerSortAtom, (current) => ({ ...current, direction: "descending" })));
    await waitFor(() =>
      expect(getRows(container)).toEqual([
        "Docs/",
        "Docs/a.pdf",
        "Docs/c.png",
        "m.pdf",
        "b.md",
        "z.jpg",
        "a.png",
        "c.zip",
      ]),
    );
    const folderAfterSort = model.getItem("Docs/");
    expect(folderAfterSort?.isDirectory()).toBe(true);
    if (isTreeDirectoryHandle(folderAfterSort)) expect(folderAfterSort.isExpanded()).toBe(true);
    expect(model.getFocusedPath()).toBe("a.png");
    expect(model.getSelectedPaths()).toEqual(["z.jpg"]);
  });

  it("keeps type sorting through optimistic additions, renames, and refreshed file metadata", async () => {
    const store = createStore();
    store.set(explorerSortAtom, { by: "type", direction: "ascending" });
    let model: FileTree | undefined;
    const Harness = ({ files }: { files: FileItem[] }) => {
      const state = useFileExplorerModel({ enableFileMove: false, items: files, syncSelection: false });
      model = state.model;
      return <ExplorerTree model={state.model} itemsByPath={state.lookupRef.current.byTreePath} />;
    };
    const initial = [file("z.jpg", "image/jpeg"), file("a.pdf", "application/pdf")];
    const { container, rerender } = render(
      <Provider store={store}>
        <Harness files={initial} />
      </Provider>,
    );
    await waitFor(() => expect(getRows(container)).toEqual(["z.jpg", "a.pdf"]));
    const original = model!;
    act(() => original.add("b.webp"));
    await waitFor(() => expect(getRows(container)).toEqual(["b.webp", "z.jpg", "a.pdf"]));
    act(() => original.move("b.webp", "b.zip"));
    await waitFor(() => expect(getRows(container)).toEqual(["b.zip", "z.jpg", "a.pdf"]));
    rerender(
      <Provider store={store}>
        <Harness files={[...initial, file("b.zip", "application/zip")]} />
      </Provider>,
    );
    await waitFor(() => expect(getRows(container)).toEqual(["b.zip", "z.jpg", "a.pdf"]));
    expect(model).toBe(original);
  });
  it("re-sorts when a refresh discovers new kinds without changing paths", async () => {
    const store = createStore();
    store.set(explorerSortAtom, { by: "type", direction: "ascending" });
    const Harness = ({ files }: { files: FileItem[] }) => {
      const { model, lookupRef } = useFileExplorerModel({ enableFileMove: false, items: files, syncSelection: false });
      return <ExplorerTree model={model} itemsByPath={lookupRef.current.byTreePath} />;
    };
    const { container, rerender } = render(
      <Provider store={store}>
        <Harness files={[file("A", "application/octet-stream"), file("Z", "application/pdf")]} />
      </Provider>,
    );
    await waitFor(() => expect(getRows(container)).toEqual(["A", "Z"]));
    rerender(
      <Provider store={store}>
        <Harness files={[file("A", "image/png"), file("Z", "application/zip")]} />
      </Provider>,
    );
    await waitFor(() => expect(getRows(container)).toEqual(["Z", "A"]));
  });
});
