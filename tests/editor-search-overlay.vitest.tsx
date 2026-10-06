import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";

const search = vi.hoisted(() => ({ onQueryChange: vi.fn(), readFile: vi.fn() }));

vi.mock("@renderer/features/files/workspaceFileService", () => ({ readFile: search.readFile }));

vi.mock("@renderer/features/search/useFileSearch", () => ({
  useFileSearch: () => ({
    isSearching: false,
    matchesByPath: new Map(),
    onQueryChange: search.onQueryChange,
    searchError: null,
  }),
}));

import { EditorSearchOverlay } from "../src/renderer/src/features/search/EditorSearchOverlay";
import { editorOverlayRequestAtom } from "../src/renderer/src/store/editorOverlayStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { fileTreeAtom } from "../src/renderer/src/store/fileExplorerStore";
import { searchResultsAtom } from "../src/renderer/src/store/SearchWindowStore";
import type { FileItem } from "../src/shared/file-item";

afterEach(() => {
  cleanup();
  search.onQueryChange.mockClear();
});

it("uses the shared search result and shortcut presentation for editor link insertion", () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });

  const store = createStore();
  const select = vi.fn();
  const file: FileItem = {
    id: "project-plan",
    filename: "Project plan",
    relativePath: "projects/Project plan.md",
    path: "/notes/projects/Project plan.md",
    isDirectory: false,
    mimeType: "text/markdown",
  };
  store.set(searchResultsAtom, { files: [], images: [], links: [file] });
  store.set(editorOverlayRequestAtom, {
    owner: "link",
    scope: "links",
    source: "proj",
    anchor: { left: 20, top: 40 },
    select,
    close: vi.fn(),
    hotkey: null,
  });

  const { container, getByRole } = render(
    <Provider store={store}>
      <EditorSearchOverlay />
    </Provider>,
  );

  expect(container.querySelector(".search-panel-inline")).not.toBeNull();
  expect(container.querySelector(".search-panel-result.search-panel-inline-result")).not.toBeNull();
  expect(container.querySelectorAll(".search-panel-key")).toHaveLength(3);
  expect(container.querySelector(".search-panel-highlight")?.textContent).toBe("Proj");

  fireEvent.click(getByRole("option"));
  expect(select).toHaveBeenCalledWith("projects/Project plan.md");
});

it("shows image suggestions for an empty wiki-image target", () => {
  const store = createStore();
  const image: FileItem = {
    id: "project-map",
    filename: "Project map",
    relativePath: "attachments/Project map.png",
    path: "/notes/attachments/Project map.png",
    isDirectory: false,
    mimeType: "image/png",
  };
  store.set(searchResultsAtom, { files: [], images: [image], links: [] });
  store.set(editorOverlayRequestAtom, {
    owner: "wiki-image",
    scope: "images",
    source: "",
    anchor: { left: 20, top: 40 },
    select: vi.fn(),
    close: vi.fn(),
    hotkey: null,
  });

  const { container, getByRole } = render(
    <Provider store={store}>
      <EditorSearchOverlay />
    </Provider>,
  );

  expect(container.querySelector(".search-panel-inline")).not.toBeNull();
  expect(getByRole("option").textContent).toContain("Project map");
  expect(search.onQueryChange).toHaveBeenCalledWith("", { filter: "images", debounceMs: 120 });
});

const defaultSectionFile: FileItem = {
  id: "section-note",
  filename: "Research 1",
  relativePath: "Research 1.md",
  path: "/notes/Research 1.md",
  isDirectory: false,
  mimeType: "text/markdown",
};

function renderSections(source: string, sectionFileOverride?: FileItem) {
  const sectionFile = sectionFileOverride ?? defaultSectionFile;
  const store = createStore();
  const select = vi.fn();
  store.set(fileTreeAtom, [sectionFile]);
  store.set(fileBuffersByPathAtom, {
    [sectionFile.path]: { savedText: "# Old", editorText: "# Introduction\n## Tasks\n## Tasks\n## Żółć" },
  });
  store.set(searchResultsAtom, { files: [], images: [], links: [sectionFile] });
  store.set(editorOverlayRequestAtom, {
    owner: "link",
    scope: "links",
    source,
    notePath: sectionFile.path,
    anchor: { left: 0, top: 0 },
    select,
    close: vi.fn(),
    hotkey: null,
  });
  return {
    ...render(
      <Provider store={store}>
        <EditorSearchOverlay />
      </Provider>,
    ),
    select,
    store,
  };
}

it("searches current headings from the edited buffer and inserts an encoded note path with an unambiguous duplicate anchor", async () => {
  const view = renderSections("Research%201.md#tasks");
  await waitFor(() => expect(view.getAllByRole("option")).toHaveLength(2));
  expect(search.onQueryChange).toHaveBeenCalledWith("Research 1.md", expect.anything());
  fireEvent.click(view.getAllByRole("option")[1]);
  expect(view.select).toHaveBeenCalledWith("Research 1.md#tasks-1");
});

it("supports current-note sections and unicode queries without adding a note path", async () => {
  const view = renderSections("#%C5%BC%C3%B3%C5%82%C4%87");
  await waitFor(() => expect(view.getAllByRole("option")).toHaveLength(1));
  fireEvent.click(view.getByRole("option"));
  expect(view.select).toHaveBeenCalledWith("#%C5%BC%C3%B3%C5%82%C4%87");
});

it("loads headings for unopened notes and does not allow a slow old query to replace new matches", async () => {
  const view = renderSections("Research%201.md#tasks");
  await waitFor(() => expect(view.getAllByRole("option")).toHaveLength(2));
  let finishOld: (result: { success: true; content: string }) => void = () => {};
  search.readFile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  await act(async () => {
    view.store.set(fileBuffersByPathAtom, {});
  });
  expect(search.readFile).toHaveBeenCalledWith(defaultSectionFile.path);
  search.readFile.mockResolvedValue({ success: true, content: "# New section" });
  await act(async () => {
    const request = view.store.get(editorOverlayRequestAtom)!;
    view.store.set(editorOverlayRequestAtom, { ...request, source: "Research%201.md#new" });
  });
  await waitFor(() => expect(view.getByRole("option").textContent).toContain("New section"));
  await act(async () => finishOld({ success: true, content: "# Tasks" }));
  expect(view.getByRole("option").textContent).toContain("New section");
});

it("excludes reserved filenames from section suggestions and explains how to enable them", async () => {
  const view = renderSections("Research%20%231.md#tasks", {
    ...defaultSectionFile,
    filename: "Research #1",
    path: "/notes/Research #1.md",
    relativePath: "Research #1.md",
  });
  await waitFor(() => expect(view.getByText("Section links unavailable")).toBeTruthy());
  expect(view.queryAllByRole("option")).toHaveLength(0);
  expect(view.getByText(/Rename the note/)).toBeTruthy();
});
