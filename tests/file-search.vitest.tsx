import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, test, vi } from "vitest";

import useFileSearch from "../src/renderer/src/features/search/useFileSearch";
import { searchResultsAtom } from "../src/renderer/src/store/SearchWindowStore";
import { fileTreeAtom } from "../src/renderer/src/store/fileExplorerStore";
import type { FileItem } from "../src/shared/file-item";

const file = (filename: string, mimeType = "text/markdown"): Extract<FileItem, { isDirectory: false }> => ({
  id: filename,
  filename,
  relativePath: `${filename}${mimeType === "image/png" ? ".png" : ".md"}`,
  path: `/notes/${filename}${mimeType === "image/png" ? ".png" : ".md"}`,
  isDirectory: false,
  mimeType,
});

const directory = (path: string, children: FileItem[]): FileItem => ({
  id: path,
  filename: path.split("/").at(-1) ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  isDirectory: true,
  mimeType: null,
  children,
});

const renderSearch = (scope: "files" | "links", files: FileItem[]) => {
  const store = createStore();
  store.set(fileTreeAtom, [directory("/notes/nested", files)]);
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  return { store, ...renderHook(() => useFileSearch(scope), { wrapper }) };
};

beforeEach(() => {
  window.api = { searchWorkspaceText: vi.fn() } as unknown as Window["api"];
});

test("global search merges direct filenames, content, and weak fuzzy matches without duplicates", async () => {
  const directImage = file("Needle diagram", "image/png");
  const contentMatch = file("Unrelated title");
  const weakMatch = file("n-e-e-d-l-e archive");
  vi.mocked(window.api.searchWorkspaceText).mockResolvedValue([
    { file: contentMatch, matchedIn: "content", rank: -2, excerpt: "A sentence containing needle in context." },
    { file: directImage, matchedIn: "content", rank: -1 },
  ]);
  const { result, store } = renderSearch("files", [weakMatch, contentMatch, directImage]);

  act(() => result.current.onQueryChange("needle", { includeContent: true }));

  await waitFor(() =>
    expect(store.get(searchResultsAtom).files.map(({ path }) => path)).toEqual([
      directImage.path,
      contentMatch.path,
      weakMatch.path,
    ]),
  );
  expect(window.api.searchWorkspaceText).toHaveBeenCalledWith({ query: "needle", limit: 30 });
  expect(result.current.matchesByPath.get(contentMatch.path)).toEqual({
    excerpt: "A sentence containing needle in context.",
    matchedIn: "content",
  });
  expect(result.current.isSearching).toBe(false);
});

test("filename results appear immediately while content search is pending", async () => {
  const filenameMatch = file("Needle plan");
  let resolveSearch!: (results: []) => void;
  vi.mocked(window.api.searchWorkspaceText).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
  );
  const { result, store } = renderSearch("files", [filenameMatch]);

  act(() => result.current.onQueryChange("needle", { includeContent: true }));

  expect(store.get(searchResultsAtom).files).toEqual([filenameMatch]);
  expect(result.current.isSearching).toBe(true);

  await act(async () => resolveSearch([]));
  await waitFor(() => expect(result.current.isSearching).toBe(false));
});

test("filename-only search reads the nested file tree without querying note contents", async () => {
  const match = file("Needle plan");
  const { result, store } = renderSearch("links", [match]);

  act(() => result.current.onQueryChange("needle", { filter: "notes", includeContent: true }));

  await waitFor(() => expect(store.get(searchResultsAtom).links).toEqual([match]));
  expect(window.api.searchWorkspaceText).not.toHaveBeenCalled();
});

test("content search failure falls back to in-memory filename ranking", async () => {
  const match = file("Needle plan");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(window.api.searchWorkspaceText).mockRejectedValue(new Error("index unavailable"));
  const { result, store } = renderSearch("files", [match]);

  act(() => result.current.onQueryChange("needle", { includeContent: true }));

  await waitFor(() => expect(store.get(searchResultsAtom).files).toEqual([match]));
  expect(error).toHaveBeenCalled();
});

test("an older content response cannot replace a newer search", async () => {
  const older = file("Older content");
  const newer = file("Newer content");
  let resolveOlder!: (
    results: { file: Extract<FileItem, { isDirectory: false }>; matchedIn: "content"; rank: number }[],
  ) => void;
  let resolveNewer!: (
    results: { file: Extract<FileItem, { isDirectory: false }>; matchedIn: "content"; rank: number }[],
  ) => void;
  vi.mocked(window.api.searchWorkspaceText)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOlder = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNewer = resolve;
        }),
    );
  const { result, store } = renderSearch("files", []);

  act(() => result.current.onQueryChange("older query", { includeContent: true }));
  act(() => result.current.onQueryChange("newer query", { includeContent: true }));
  await act(async () => resolveNewer([{ file: newer, matchedIn: "content", rank: -1 }]));
  await waitFor(() => expect(store.get(searchResultsAtom).files).toEqual([newer]));
  await act(async () => resolveOlder([{ file: older, matchedIn: "content", rank: -1 }]));

  expect(store.get(searchResultsAtom).files).toEqual([newer]);
});

test("image and note filters use the in-memory workspace files", async () => {
  const note = file("Needle note");
  const image = file("Needle image", "image/png");
  const images = renderSearch("links", [note, image]);

  act(() => images.result.current.onQueryChange("needle", { filter: "images", includeContent: true }));
  await waitFor(() => expect(images.store.get(searchResultsAtom).links).toEqual([image]));

  act(() => images.result.current.onQueryChange("needle", { filter: "notes" }));
  await waitFor(() => expect(images.store.get(searchResultsAtom).links).toEqual([note]));
  expect(window.api.searchWorkspaceText).not.toHaveBeenCalled();
});

test("filters completed filenames before ranking and requests filtered content results", async () => {
  const completed = Array.from({ length: 35 }, (_, i) => file(`Needle ${i}`));
  const active = file("Needle remaining");
  vi.mocked(window.api.searchWorkspaceText).mockResolvedValue([]);
  const { result, store } = renderSearch("files", [...completed, active]);
  act(() =>
    result.current.onQueryChange("needle", {
      includeContent: true,
      hideCompletedTasks: true,
      completedPaths: new Set(completed.map((file) => file.path)),
    }),
  );
  await waitFor(() => expect(result.current.isSearching).toBe(false));
  expect(store.get(searchResultsAtom).files).toEqual([active]);
  expect(window.api.searchWorkspaceText).toHaveBeenCalledWith({ query: "needle", limit: 30, hideCompletedTasks: true });
});
