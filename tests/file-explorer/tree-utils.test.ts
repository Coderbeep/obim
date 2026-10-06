import { test } from "vitest";

import assert from "node:assert/strict";

import {
  buildTreeLookup,
  getDirectoryTreePathChain,
  getFileTreeMoveIntent,
  getMarkdownExplorerName,
  getMovableTreePaths,
  getParentTreePath,
  getRenameEventDestinationName,
  getRenameEventSourceTreePath,
  getRenamingItemTreePath,
  getTreePathName,
  getUniqueTreeMovePath,
  getTreeDropDestination,
  getTreeDropTargetFromHoveredPath,
  isTreeDirectoryHandle,
  normalizeTreePath,
  normalizeDraggedTreePaths,
  sameStringArray,
  sameStringSet,
  toDirectoryTreePath,
  toRelativeDirectoryPath,
  toTreePath,
} from "../../src/renderer/src/features/files/explorer/fileExplorerTreeUtils";
import type { FileItem } from "../../src/shared/file-item";
import { getRelativePathFromPath } from "../../src/shared/pathUtils";

const file = (
  path: string,
  relativePath = path.replace("/notes-root/", ""),
): Extract<FileItem, { isDirectory: false }> => ({
  id: path,
  filename:
    path
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/, "") ?? path,
  path,
  relativePath,
  isDirectory: false,
  mimeType: "text/markdown",
});

const directory = (
  path: string,
  children: FileItem[] = [],
  relativePath = path.replace("/notes-root/", ""),
): FileItem => ({
  id: path,
  filename: path.split("/").at(-1) ?? path,
  path,
  relativePath,
  isDirectory: true,
  children,
  mimeType: null,
});

const tree = [
  directory("/notes-root/Projects", [
    directory("/notes-root/Projects/Archive", [file("/notes-root/Projects/Archive/plan.md")]),
    file("/notes-root/Projects/plan.md"),
  ]),
  directory("/notes-root/Personal", [file("/notes-root/Personal/plan.md")]),
  file("/notes-root/Loose.md"),
];

test("tree paths preserve directory identity, Unicode, and duplicate display names", () => {
  const lookup = buildTreeLookup([...tree, file("/notes-root/🚀 Notes/zażółć.md", "🚀 Notes\\zażółć.md")]);

  assert.equal(toDirectoryTreePath("Projects"), "Projects/");
  assert.equal(toTreePath(tree[0]), "Projects/");
  assert.equal(lookup.byTreePath.get("Projects/plan.md")?.path, "/notes-root/Projects/plan.md");
  assert.equal(lookup.byTreePath.get("Personal/plan.md")?.path, "/notes-root/Personal/plan.md");
  assert.equal(lookup.byTreePath.get("🚀 Notes/zażółć.md")?.path, "/notes-root/🚀 Notes/zażółć.md");
});

test("tree path conversion normalizes platform separators and root paths", () => {
  assert.equal(normalizeTreePath("\\\\Projects\\Specs\\plan.md"), "Projects/Specs/plan.md");
  assert.equal(toDirectoryTreePath("/Projects/Specs///"), "Projects/Specs/");
  assert.equal(toDirectoryTreePath("///"), "");
  assert.equal(toRelativeDirectoryPath("/Projects/Specs///"), "Projects/Specs");
  assert.equal(toTreePath(directory("/notes-root/Empty", [], "Empty\\Nested")), "Empty/Nested/");
  assert.equal(toTreePath(file("/notes-root/readme", "readme")), "readme");
});

test("parent and name helpers handle root items, directories, and repeated trailing separators", () => {
  assert.equal(getParentTreePath("note.md"), "");
  assert.equal(getParentTreePath("Projects/"), "");
  assert.equal(getParentTreePath("Projects/Specs///"), "Projects/");
  assert.equal(getParentTreePath(""), "");
  assert.equal(getTreePathName("Projects/Specs///"), "Specs");
  assert.equal(getTreePathName("note.md"), "note.md");
});

test("optimistic move paths use the same numbered collision names for files and directories", () => {
  assert.equal(
    getUniqueTreeMovePath(
      "attachments/Untitled 1.md",
      "Tasks/",
      new Set(["Tasks/Untitled 1.md", "Tasks/Untitled 1 1.md"]),
    ),
    "Tasks/Untitled 1 2.md",
  );
  assert.equal(getUniqueTreeMovePath("attachments/Folder/", "Tasks/", new Set(["Tasks/Folder/"])), "Tasks/Folder 1/");
  assert.equal(
    getUniqueTreeMovePath("attachments/Folder.txt/", "Tasks/", new Set(["Tasks/Folder.txt/"])),
    "Tasks/Folder 1.txt/",
  );
  assert.equal(getUniqueTreeMovePath("attachments/.env", "Tasks/", new Set(["Tasks/.env"])), "Tasks/.env 1");
});

test("markdown explorer names omit only their final extension", () => {
  assert.equal(getMarkdownExplorerName(file("/notes-root/note.backup.md")), "note.backup");
  assert.equal(getMarkdownExplorerName(file("/notes-root/README.markdown")), "README");
  assert.equal(getMarkdownExplorerName({ ...file("/notes-root/data.json"), mimeType: "application/json" }), null);
  assert.equal(getMarkdownExplorerName(directory("/notes-root/Folder")), null);
});

test("directory chains include every ancestor exactly once", () => {
  assert.deepEqual(getDirectoryTreePathChain("Projects/Specs/API/"), [
    "Projects/",
    "Projects/Specs/",
    "Projects/Specs/API/",
  ]);
  assert.deepEqual(getDirectoryTreePathChain(""), []);
  assert.deepEqual(getDirectoryTreePathChain("///"), []);
});

test("string collection comparisons preserve their intended ordering semantics", () => {
  assert.equal(sameStringArray(["a", "b"], ["a", "b"]), true);
  assert.equal(sameStringArray(["a", "b"], ["b", "a"]), false);
  assert.equal(sameStringArray(["a"], ["a", "b"]), false);
  assert.equal(sameStringSet(new Set(["a", "b"]), new Set(["b", "a"])), true);
  assert.equal(sameStringSet(new Set(["a"]), new Set(["a", "b"])), false);
  assert.equal(sameStringSet(new Set(["a", "b"]), new Set(["a", "c"])), false);
});

test("drag normalization removes duplicate descendants while retaining independent nodes", () => {
  assert.deepEqual(normalizeDraggedTreePaths(["Projects/Archive/plan.md", "Projects/", "Loose.md", "Projects/"]), [
    "Projects/",
    "Loose.md",
  ]);
});

test("drag normalization is stable and does not confuse sibling prefixes with ancestors", () => {
  const input = ["Notes 2/file.md", "Notes/", "Notes/file.md", "Notes 2/file.md", "Loose.md"];
  assert.deepEqual(normalizeDraggedTreePaths(input), ["Notes 2/file.md", "Notes/", "Loose.md"]);
  assert.deepEqual(input, ["Notes 2/file.md", "Notes/", "Notes/file.md", "Notes 2/file.md", "Loose.md"]);
});

test("drag normalization preserves empty input and top-level siblings", () => {
  assert.deepEqual(normalizeDraggedTreePaths([]), []);
  assert.deepEqual(normalizeDraggedTreePaths(["A/", "AB/", "A-file.md", "AB/file.md"]), ["A/", "AB/", "A-file.md"]);
});

test("internal movement rejects stale paths, same-parent drops, and circular directory moves", () => {
  const lookup = buildTreeLookup(tree);

  assert.deepEqual(getMovableTreePaths(["Projects/", "Projects/Archive/plan.md"], "Projects/Archive/", lookup), []);
  assert.deepEqual(getMovableTreePaths(["Loose.md"], "", lookup), []);
  assert.deepEqual(getMovableTreePaths(["missing.md", "Loose.md"], "Projects/Archive/", lookup), ["Loose.md"]);
  assert.equal(getParentTreePath("Projects/Archive/plan.md"), "Projects/Archive/");
});

test("internal movement keeps independent valid sources when other selected paths are invalid", () => {
  const lookup = buildTreeLookup(tree);

  assert.deepEqual(
    getMovableTreePaths(["missing.md", "Projects/plan.md", "Personal/plan.md"], "Projects/Archive/", lookup),
    ["Projects/plan.md", "Personal/plan.md"],
  );
  assert.deepEqual(getMovableTreePaths(["Projects/Archive/"], "Projects/Archive/", lookup), []);
  assert.deepEqual(getMovableTreePaths(["Projects/Archive/"], "Projects/Archive/plan.md", lookup), []);
});

test("one drop intent owns destination, validity, preview label, and execution sources", () => {
  const lookup = buildTreeLookup(tree);
  const target = getTreeDropTargetFromHoveredPath("Personal/plan.md", lookup);
  const destination = getTreeDropDestination(target, lookup, "/notes-root");
  const intent = getFileTreeMoveIntent(["Projects/plan.md"], target, lookup, "/notes-root");

  assert.equal(destination?.treePath, "Personal/");
  assert.equal(destination?.absolutePath, "/notes-root/Personal");
  assert.equal(intent?.directory?.filename, "Personal");
  assert.deepEqual(intent?.sourceTreePaths, ["Projects/plan.md"]);
  assert.equal(intent?.sourceItems[0].path, "/notes-root/Projects/plan.md");
  assert.equal(getFileTreeMoveIntent(["Personal/plan.md"], target, lookup, "/notes-root"), null);
});

test("drop resolution rejects stale directories and maps top-level files to the root", () => {
  const lookup = buildTreeLookup(tree);
  const rootTarget = { directoryPath: null, kind: "root" } as const;

  assert.deepEqual(getTreeDropTargetFromHoveredPath(null, lookup), rootTarget);
  assert.deepEqual(getTreeDropTargetFromHoveredPath("Loose.md", lookup), rootTarget);
  assert.deepEqual(getTreeDropTargetFromHoveredPath("Projects/plan.md", lookup), {
    directoryPath: "Projects/",
    kind: "directory",
  });
  assert.deepEqual(getTreeDropDestination(rootTarget, lookup, "/notes-root"), {
    absolutePath: "/notes-root",
    directory: null,
    treePath: "",
  });
  assert.equal(getTreeDropDestination({ directoryPath: null, kind: "directory" }, lookup, "/notes-root"), null);
  assert.equal(getTreeDropDestination({ directoryPath: "Missing/", kind: "directory" }, lookup, "/notes-root"), null);
  assert.equal(getFileTreeMoveIntent([], { directoryPath: null, kind: "root" }, lookup, "/notes-root"), null);
  assert.equal(
    getFileTreeMoveIntent(
      ["Projects/plan.md"],
      { directoryPath: "Missing/", kind: "directory" },
      lookup,
      "/notes-root",
    ),
    null,
  );
});

test("move intent filters invalid sources without reordering the valid selection", () => {
  const lookup = buildTreeLookup(tree);
  const intent = getFileTreeMoveIntent(
    ["missing.md", "Personal/plan.md", "Projects/plan.md", "Personal/plan.md"],
    { directoryPath: "Projects/Archive/", kind: "directory" },
    lookup,
    "/notes-root",
  );

  assert.deepEqual(intent?.sourceTreePaths, ["Personal/plan.md", "Projects/plan.md"]);
  assert.deepEqual(
    intent?.sourceItems.map((item) => item.path),
    ["/notes-root/Personal/plan.md", "/notes-root/Projects/plan.md"],
  );
});

test("lookup construction is depth-first, skips empty identities, and keeps the first duplicate tree path", () => {
  const first = file("/notes-root/first.md", "duplicate.md");
  const second = file("/elsewhere/second.md", "duplicate.md");
  const empty = file("/notes-root", "");
  const lookup = buildTreeLookup([
    directory("/notes-root/Folder", [file("/notes-root/Folder/child.md")]),
    first,
    second,
    empty,
  ]);

  assert.deepEqual(lookup.paths, ["Folder/", "Folder/child.md", "duplicate.md"]);
  assert.deepEqual(lookup.directoryTreePaths, ["Folder/"]);
  assert.equal(lookup.byTreePath.get("duplicate.md"), first);
  assert.equal(lookup.byAbsolutePath.get(second.path), undefined);
  assert.equal(lookup.byTreePath.has(""), false);
});

test("rename helpers preserve file and directory identity", () => {
  assert.equal(getTreePathName("Projects/Specs/"), "Specs");
  assert.equal(getRenamingItemTreePath({ isFolder: true, path: "Projects\\Specs" }), "Projects/Specs/");
  assert.equal(getRenamingItemTreePath({ isFolder: false, path: "Projects\\plan.md" }), "Projects/plan.md");
  assert.equal(getRenameEventSourceTreePath({ isFolder: true, sourcePath: "Projects/Specs" }), "Projects/Specs/");
  assert.equal(getRenameEventDestinationName({ destinationPath: "Projects/Renamed.md" }), "Renamed.md");
});

test("directory handle detection is null-safe and delegates to the model identity", () => {
  assert.equal(isTreeDirectoryHandle(null), false);
  assert.equal(isTreeDirectoryHandle({ isDirectory: () => false } as never), false);
  assert.equal(isTreeDirectoryHandle({ isDirectory: () => true } as never), true);
});

test("moved directory paths remain relative when Windows separators are returned", () => {
  assert.equal(
    toDirectoryTreePath(getRelativePathFromPath("C:\\notes\\Archive\\Projects", "C:\\notes")),
    "Archive/Projects/",
  );
});
