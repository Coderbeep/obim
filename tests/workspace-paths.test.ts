import { test } from "vitest";

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveWorkspacePath } from "../src/main/workspace-paths";

const withTemporaryDirectory = async (run: (rootPath: string) => Promise<void>) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "obim-workspace-paths-"));
  try {
    await run(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
};

test("workspace paths allow new files below the workspace root", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const workspacePath = path.join(rootPath, "notes");
    await mkdir(workspacePath);

    assert.equal(
      resolveWorkspacePath(workspacePath, "drafts/today.md"),
      path.join(workspacePath, "drafts", "today.md"),
    );
  });
});

test("workspace paths reject symbolic links inside the workspace", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const workspacePath = path.join(rootPath, "notes");
    const externalPath = path.join(rootPath, "external");
    await mkdir(workspacePath);
    await mkdir(externalPath);
    await writeFile(path.join(externalPath, "secret.md"), "secret");
    await symlink(externalPath, path.join(workspacePath, "linked"));

    assert.throws(() => resolveWorkspacePath(workspacePath, "linked/secret.md"), /Symbolic links are not supported/);
  });
});

test("workspace paths reject lexical traversal", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const workspacePath = path.join(rootPath, "notes");
    await mkdir(workspacePath);

    assert.throws(() => resolveWorkspacePath(workspacePath, "../outside.md"), /outside the notes directory/);
  });
});
