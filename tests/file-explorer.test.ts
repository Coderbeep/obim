import { test } from "vitest";

import assert from "node:assert/strict";

import {
  getRenamingItemTreePath,
  getRenameEventDestinationName,
  getRenameEventSourceTreePath,
} from "../src/renderer/src/features/files/explorer/fileExplorerTreeUtils";
import { addRecentFile } from "../src/renderer/src/store/fileExplorerStore";
import type { FileItem } from "../src/shared/file-item";
import { MAX_WORKSPACE_SESSION_RECENT_FILES } from "../src/shared/workspace-session";

test("file rename source path keeps file tree key unchanged", () => {
  assert.equal(getRenameEventSourceTreePath({ isFolder: false, sourcePath: "Notes/today.md" }), "Notes/today.md");
});

test("directory rename source path matches obim directory tree keys", () => {
  assert.equal(getRenameEventSourceTreePath({ isFolder: true, sourcePath: "Projects" }), "Projects/");
  assert.equal(getRenameEventSourceTreePath({ isFolder: true, sourcePath: "Projects/Current" }), "Projects/Current/");
});

test("directory rename guard path matches obim directory tree keys", () => {
  assert.equal(getRenamingItemTreePath({ isFolder: true, path: "Projects" }), "Projects/");
});

test("directory rename destination name handles canonical and bare paths", () => {
  assert.equal(getRenameEventDestinationName({ destinationPath: "Projects/Archive" }), "Archive");
  assert.equal(getRenameEventDestinationName({ destinationPath: "Projects/Archive/" }), "Archive");
});

test("recent files are unique, newest first, capped by default, and optionally capped further", () => {
  const file = (path: string): FileItem => ({
    id: path,
    filename: path,
    relativePath: path,
    path,
    isDirectory: false,
    mimeType: "text/markdown",
  });
  const files = [file("a.md"), file("b.md"), file("c.md")];

  assert.deepEqual(
    addRecentFile(files, file("b.md"), 3).map((item) => item.path),
    ["b.md", "a.md", "c.md"],
  );
  assert.deepEqual(
    addRecentFile(files, file("d.md"), 3).map((item) => item.path),
    ["d.md", "a.md", "b.md"],
  );
  const fullRecentList = Array.from({ length: MAX_WORKSPACE_SESSION_RECENT_FILES }, (_, index) => file(`${index}.md`));
  const bounded = addRecentFile(fullRecentList, file("new.md"));
  assert.equal(bounded.length, MAX_WORKSPACE_SESSION_RECENT_FILES);
  assert.equal(bounded[0].path, "new.md");
  assert.equal(bounded.at(-1)?.path, "98.md");
});
