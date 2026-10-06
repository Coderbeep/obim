import assert from "node:assert/strict";
import { test } from "vitest";

import {
  filterTopLevelItems,
  findDirectoryNode,
  findItemNode,
  generateNumberedName,
} from "../../src/renderer/src/features/files/fileTreeUtils";
import type { FileItem } from "../../src/shared/file-item";

const file = (path: string): FileItem => ({
  id: path,
  filename:
    path
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/, "") ?? path,
  path,
  relativePath: path.replace("/notes-root/", ""),
  isDirectory: false,
  mimeType: "text/markdown",
});

const directory = (path: string, children: FileItem[] = []): FileItem => ({
  id: path,
  filename: path.split("/").at(-1) ?? path,
  path,
  relativePath: path.replace("/notes-root/", ""),
  isDirectory: true,
  children,
  mimeType: null,
});

test("tree lookup finds nested items and restricts directory results", () => {
  const note = file("/notes-root/Projects/spec.md");
  const projects = directory("/notes-root/Projects", [note]);
  const tree = [projects];

  assert.equal(findItemNode(tree, note.path), note);
  assert.equal(findDirectoryNode(tree, projects.path), projects);
  assert.equal(findDirectoryNode(tree, note.path), null);
  assert.equal(findItemNode(tree, "/notes-root/missing.md"), null);
});

test("numbered names avoid display-name and basename collisions", () => {
  const files = [file("/notes-root/Untitled 1.md"), directory("/notes-root/Untitled 2")];

  assert.equal(generateNumberedName(files, "Untitled", ".md"), "Untitled 3.md");
  assert.equal(generateNumberedName(files, "Untitled"), "Untitled 3");
});

test("top-level filtering removes duplicates and descendants of selected directories", () => {
  const note = file("/notes-root/Projects/spec.md");
  const projects = directory("/notes-root/Projects", [note]);
  const loose = file("/notes-root/loose.md");

  assert.deepEqual(filterTopLevelItems([note, projects, note, loose]), [projects, loose]);
});
