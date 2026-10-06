import { NoteFileTypeSync } from "@renderer/features/files/NoteFileTypeSync";
import { getFileGlyph } from "@renderer/shared/icons/FileGlyphs";
import { noteFileTreeIconCss } from "@renderer/shared/icons/noteFileTreeIcons";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { fileTreeAtom, fileTreeLoadStateAtom } from "@renderer/store/fileExplorerStore";
import { indexedNoteFileTypesAtom, noteFileTypesAtom } from "@renderer/store/noteFileTypeStore";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);
it("uses full paths and immediately follows type edits and removal", () => {
  window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
  const store = createStore();
  store.set(indexedNoteFileTypesAtom, { "/notes/a/same.md": "task", "/notes/b/same.md": "task" });
  render(
    <Provider store={store}>
      <span data-testid="a">{getFileGlyph("a/same.md")}</span>
      <span data-testid="b">{getFileGlyph("/notes/b/same.md")}</span>
    </Provider>,
  );
  expect(screen.getByTestId("a").querySelector('[data-icon="task"]')).toBeTruthy();
  expect(screen.getByTestId("b").querySelector('[data-icon="task"]')).toBeTruthy();
  act(() =>
    store.set(fileBuffersByPathAtom, {
      "/notes/a/same.md": { savedText: "", editorText: "---\ntype: clipped-note\n---\n" },
    }),
  );
  expect(screen.getByTestId("a").querySelector('use[href="#file-tree-builtin-text"]')).toBeTruthy();
  act(() => store.set(fileBuffersByPathAtom, { "/notes/a/same.md": { savedText: "", editorText: "Ordinary note" } }));
  expect(screen.getByTestId("a").querySelector('use[href="#file-tree-builtin-text"]')).toBeTruthy();
});
it("keeps the icon map stable during ordinary typing", () => {
  const store = createStore();
  store.set(fileBuffersByPathAtom, { "/notes/a.md": { savedText: "", editorText: "---\ntype: task\n---\nA" } });
  const before = store.get(noteFileTypesAtom);
  store.set(fileBuffersByPathAtom, { "/notes/a.md": { savedText: "", editorText: "---\ntype: task\n---\nAB" } });
  expect(store.get(noteFileTypesAtom)).toBe(before);
});
it("loads types from the index without reading individual notes", async () => {
  const file = {
    id: "a",
    filename: "a",
    path: "/notes/a.md",
    relativePath: "a.md",
    mimeType: "text/markdown",
    isDirectory: false as const,
  };
  window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
  const queryWorkspaceProperty = vi.fn(async () => [{ file, values: [{ type: "string", value: "task" }] }]);
  window.api = { queryWorkspaceProperty } as unknown as Window["api"];
  const store = createStore();
  store.set(fileTreeAtom, [file]);
  store.set(fileTreeLoadStateAtom, "ready");
  render(
    <Provider store={store}>
      <NoteFileTypeSync />
    </Provider>,
  );
  await waitFor(() => expect(store.get(noteFileTypesAtom)).toEqual({ "/notes/a.md": "task" }));
  expect(queryWorkspaceProperty).toHaveBeenCalledWith(expect.objectContaining({ key: "type", scalarOnly: true }));
});
it("targets exact explorer paths, including quotes, rather than basenames", () => {
  const css = noteFileTreeIconCss([
    ["a/same.md", "task"],
    ['b/quote".md', "task"],
  ]);
  expect(css).toContain('[data-item-path="a/same.md"]');
  expect(css).toContain('[data-item-path="b/quote\\".md"]');
  expect(css).toContain("mask-image:");
  expect(noteFileTreeIconCss([]).trim()).toBe("");
});
