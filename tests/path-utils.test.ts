import { test } from "vitest";

import assert from "node:assert/strict";

import {
  getRelativePathFromPath,
  isAbsoluteFsPath,
  isPathWithinBase,
  isValidFilename,
  isValidRelativePath,
  joinFsPath,
  remapPathAfterMove,
} from "../src/shared/pathUtils";

test("filename validation preserves portable names and Unicode", () => {
  assert.equal(isValidFilename("Meeting notes.md"), true);
  assert.equal(isValidFilename("Zażółć gęślą jaźń.md"), true);
});

test("filename validation rejects filesystem-reserved characters and names", () => {
  for (const filename of ["bad/name.md", "bad:name.md", "bad\u0000name.md", "CON.md", "note."]) {
    assert.equal(isValidFilename(filename), false, filename);
  }
});

test("filesystem joins preserve roots and handle empty parts", () => {
  assert.equal(joinFsPath("", "notes/file.md"), "notes/file.md");
  assert.equal(joinFsPath("/", "notes/file.md"), "/notes/file.md");
  assert.equal(joinFsPath("C:\\", "notes\\file.md"), "C:/notes/file.md");
  assert.equal(joinFsPath("/notes-root/", ""), "/notes-root");
});

test("relative path conversion rejects paths outside the base", () => {
  assert.equal(getRelativePathFromPath("C:\\notes\\Archive\\plan.md", "C:\\notes"), "Archive/plan.md");
  assert.equal(isPathWithinBase("/notes-root/file.md", "/notes-root"), true);
  assert.equal(isPathWithinBase("/notes-root-old/file.md", "/notes-root"), false);
  assert.throws(() => getRelativePathFromPath("/notes-root-old/file.md", "/notes-root"), /outside base/);
});

test("relative filesystem paths reject absolute paths and traversal", () => {
  assert.equal(isAbsoluteFsPath("C:\\notes\\file.md"), true);
  assert.equal(isValidRelativePath("attachments/image.png"), true);
  assert.equal(isValidRelativePath("../image.png"), false);
  assert.equal(isValidRelativePath("/attachments/image.png"), false);
  assert.equal(isValidRelativePath("attachments//image.png"), false);
});

test("move path remapping includes directory descendants but not similarly prefixed paths", () => {
  assert.equal(
    remapPathAfterMove("/notes-root/Folder/note.md", "/notes-root/Folder", "/notes-root/Archive/Folder", true),
    "/notes-root/Archive/Folder/note.md",
  );
  assert.equal(
    remapPathAfterMove("/notes-root/Folder-old/note.md", "/notes-root/Folder", "/notes-root/Archive/Folder", true),
    "/notes-root/Folder-old/note.md",
  );
  assert.equal(
    remapPathAfterMove("/notes-root/note.md", "/notes-root/note.md", "/notes-root/Archive/note.md", false),
    "/notes-root/Archive/note.md",
  );
});
