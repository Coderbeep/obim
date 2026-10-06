import { test } from "vitest";

import assert from "node:assert/strict";

import { resolveContextTargets } from "../../src/renderer/src/features/files/menus/fileMenuTargets";
import type { FileItem } from "../../src/shared/file-item";

const file = (path: string): FileItem => ({
  id: path,
  filename: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
  relativePath: path.replace("/notes-root/", ""),
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const first = file("/notes-root/first.md");
const second = file("/notes-root/second.md");

test("an unselected context-menu target only operates on itself", () => {
  assert.deepEqual(resolveContextTargets(second, [first.path], [first, second]), [second]);
});

test("a selected context-menu target operates on the current multi-selection only", () => {
  assert.deepEqual(resolveContextTargets(second, [first.path, second.path], [first, second]), [first, second]);
});

test("stale selected paths cannot replace a valid context-menu target", () => {
  assert.deepEqual(resolveContextTargets(second, ["/notes-root/deleted.md", second.path], [second]), [second]);
});
