import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, test } from "vitest";

import { removeLegacyWorkspaceFieldSchema } from "../src/main/workspace-migrations";

describe("legacy workspace field schema cleanup", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "obim-fields-"));
  });

  afterEach(async () => {
    await rm(workspacePath, { force: true, recursive: true });
  });

  test("removes only .obim/fields.json", async () => {
    const metadataPath = path.join(workspacePath, ".obim");
    const schemaPath = path.join(metadataPath, "fields.json");
    const siblingPath = path.join(metadataPath, "bookmarks.json");
    await mkdir(metadataPath);
    await writeFile(schemaPath, "legacy");
    await writeFile(siblingPath, "keep");

    assert.equal(await removeLegacyWorkspaceFieldSchema(workspacePath), true);
    await assert.rejects(lstat(schemaPath), { code: "ENOENT" });
    assert.equal(await readFile(siblingPath, "utf8"), "keep");
    assert.equal((await lstat(metadataPath)).isDirectory(), true);
  });

  test("does nothing when the metadata directory or target file is absent", async () => {
    assert.equal(await removeLegacyWorkspaceFieldSchema(""), false);
    assert.equal(await removeLegacyWorkspaceFieldSchema(workspacePath), false);
    await mkdir(path.join(workspacePath, ".obim"));
    assert.equal(await removeLegacyWorkspaceFieldSchema(workspacePath), false);
  });

  test("does not remove a directory-shaped fields.json target", async () => {
    const schemaPath = path.join(workspacePath, ".obim", "fields.json");
    await mkdir(schemaPath, { recursive: true });

    assert.equal(await removeLegacyWorkspaceFieldSchema(workspacePath), false);
    assert.equal((await lstat(schemaPath)).isDirectory(), true);
  });

  test("does not follow a symlinked metadata directory", async () => {
    const realMetadataPath = path.join(workspacePath, "real-obim");
    const schemaPath = path.join(realMetadataPath, "fields.json");
    await mkdir(realMetadataPath);
    await writeFile(schemaPath, "keep");
    await symlink(realMetadataPath, path.join(workspacePath, ".obim"), "dir");

    assert.equal(await removeLegacyWorkspaceFieldSchema(workspacePath), false);
    assert.equal(await readFile(schemaPath, "utf8"), "keep");
  });

  test("unlinks a symlinked fields.json without touching its target", async () => {
    const metadataPath = path.join(workspacePath, ".obim");
    const outsidePath = path.join(workspacePath, "outside.json");
    await mkdir(metadataPath);
    await writeFile(outsidePath, "keep");
    await symlink(outsidePath, path.join(metadataPath, "fields.json"), "file");

    assert.equal(await removeLegacyWorkspaceFieldSchema(workspacePath), true);
    await assert.rejects(lstat(path.join(metadataPath, "fields.json")), { code: "ENOENT" });
    assert.equal(await readFile(outsidePath, "utf8"), "keep");
  });
});
