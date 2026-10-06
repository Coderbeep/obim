import assert from "node:assert/strict";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { readLargeTextPreview } from "../src/main/large-file";
import { isLargeTextFile, LARGE_TEXT_PREVIEW_BYTES, MAX_FULL_TEXT_EDITOR_BYTES } from "../src/shared/large-files";
import type { FileItem } from "../src/shared/file-item";

const withTempDirectory = async (run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(path.join(tmpdir(), "obim-large-file-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
const SMOKE_TEST_FILE_BYTES = 100 * 1024 * 1024;

test("reads a complete file below the preview limit", () =>
  withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "small.md");
    await writeFile(filePath, "small note");

    assert.deepEqual(await readLargeTextPreview(filePath), {
      content: "small note",
      previewBytes: 10,
      sizeBytes: 10,
      truncated: false,
    });
  }));

test("reads no more than the preview limit from a larger file", () =>
  withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "large.md");
    await writeFile(filePath, "preview");
    await truncate(filePath, SMOKE_TEST_FILE_BYTES);

    const preview = await readLargeTextPreview(filePath);
    assert.equal(preview.previewBytes, LARGE_TEXT_PREVIEW_BYTES);
    assert.equal(preview.sizeBytes, SMOKE_TEST_FILE_BYTES);
    assert.equal(preview.truncated, true);
  }));

test("does not truncate a file at the exact preview limit", () =>
  withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "exact.md");
    await writeFile(filePath, Buffer.alloc(LARGE_TEXT_PREVIEW_BYTES, 97));

    const preview = await readLargeTextPreview(filePath);
    assert.equal(preview.content.length, LARGE_TEXT_PREVIEW_BYTES);
    assert.equal(preview.previewBytes, LARGE_TEXT_PREVIEW_BYTES);
    assert.equal(preview.truncated, false);
  }));

test("drops an incomplete UTF-8 sequence at the preview boundary", () =>
  withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "utf8.md");
    const prefix = Buffer.alloc(LARGE_TEXT_PREVIEW_BYTES - 1, 97);
    await writeFile(filePath, Buffer.concat([prefix, Buffer.from("€tail")]));

    const preview = await readLargeTextPreview(filePath);
    assert.equal(preview.content.length, LARGE_TEXT_PREVIEW_BYTES - 1);
    assert.equal(preview.content.endsWith("�"), false);
    assert.equal(preview.previewBytes, LARGE_TEXT_PREVIEW_BYTES);
    assert.equal(preview.truncated, true);
  }));

test("rejects directories and missing files", () =>
  withTempDirectory(async (directory) => {
    await assert.rejects(readLargeTextPreview(directory), /regular file/);
    await assert.rejects(readLargeTextPreview(path.join(directory, "missing.md")), /ENOENT/);
  }));

test("routes only editable files above the full-editor threshold", () => {
  const file: FileItem = {
    id: "note",
    filename: "note",
    relativePath: "note.md",
    path: "/notes/note.md",
    sizeBytes: MAX_FULL_TEXT_EDITOR_BYTES,
    isDirectory: false,
    mimeType: "text/markdown",
  };

  assert.equal(isLargeTextFile(file), false);
  assert.equal(isLargeTextFile({ ...file, sizeBytes: MAX_FULL_TEXT_EDITOR_BYTES + 1 }), true);
  assert.equal(
    isLargeTextFile({ ...file, path: "/notes/archive.zip", mimeType: "application/zip", sizeBytes: 20 * 1024 * 1024 }),
    false,
  );
});
