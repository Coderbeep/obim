import { beforeEach, expect, test, vi } from "vitest";

import {
  BOOKMARKS_RELATIVE_PATH,
  loadBookmarks,
  saveBookmarks,
} from "../src/renderer/src/features/files/bookmarkPersistence";
import type { FileItem } from "../src/shared/file-item";

const file = (path: string): FileItem => ({
  id: path,
  filename:
    path
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/, "") ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const directory = (path: string, children: FileItem[]): FileItem => ({
  ...file(path),
  isDirectory: true,
  mimeType: null,
  children,
});

beforeEach(() => {
  window.api = {
    doesFileExist: vi.fn().mockResolvedValue(true),
    openFile: vi.fn(),
    upsertFile: vi.fn().mockResolvedValue(true),
  } as unknown as Window["api"];
});

test("hydrates ordered workspace-relative paths and prunes missing files", async () => {
  const renamed = file("/notes/renamed.md");
  const second = file("/notes/nested/second.md");
  vi.mocked(window.api.openFile).mockResolvedValue(
    JSON.stringify({
      items: [
        { type: "file", path: "nested/second.md" },
        { type: "file", path: "deleted.md" },
        { type: "file", path: "renamed.md" },
        { type: "file", path: "nested/second.md" },
      ],
    }),
  );

  const bookmarks = await loadBookmarks([renamed, directory("/notes/nested", [second])]);
  await saveBookmarks(bookmarks);

  expect(bookmarks).toEqual([second, renamed]);
  expect(window.api.upsertFile).toHaveBeenCalledWith(
    BOOKMARKS_RELATIVE_PATH,
    `${JSON.stringify(
      {
        items: [
          { type: "file", path: "nested/second.md" },
          { type: "file", path: "renamed.md" },
        ],
      },
      null,
      2,
    )}\n`,
  );
});

test("returns no bookmarks when the workspace file does not exist", async () => {
  vi.mocked(window.api.doesFileExist).mockResolvedValue(false);

  expect(await loadBookmarks([file("/notes/note.md")])).toEqual([]);
  expect(window.api.openFile).not.toHaveBeenCalled();
});

test("treats malformed bookmark files as empty", async () => {
  vi.mocked(window.api.openFile).mockResolvedValue("{broken");

  expect(await loadBookmarks([file("/notes/note.md")])).toEqual([]);
});

test("reports workspace write failures to its caller", async () => {
  vi.mocked(window.api.upsertFile).mockResolvedValue(false);

  await expect(saveBookmarks([file("/notes/note.md")])).rejects.toThrow(`Could not write ${BOOKMARKS_RELATIVE_PATH}`);
});
