import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  fingerprintWorkspaceFile,
  getWorkspaceDirectoryEntries,
  getWorkspaceFileTree,
} from "../src/main/workspace-files";

const withWorkspace = async (run: (workspacePath: string) => Promise<void>) => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "obim-workspace-files-"));
  try {
    await run(workspacePath);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
};

test("directory reads exclude Finder metadata without hiding user dotfiles", async () => {
  await withWorkspace(async (workspacePath) => {
    await Promise.all([
      writeFile(path.join(workspacePath, ".DS_Store"), "finder metadata"),
      writeFile(path.join(workspacePath, ".env"), "USER_SETTING=true"),
      writeFile(path.join(workspacePath, "note.md"), "# Note\n"),
    ]);

    const entries = await getWorkspaceDirectoryEntries(workspacePath, workspacePath);

    assert.deepEqual(entries.map(({ relativePath }) => relativePath).sort(), [".env", "note.md"]);
  });
});

test("recursive workspace trees exclude nested Finder metadata", async () => {
  await withWorkspace(async (workspacePath) => {
    const folderPath = path.join(workspacePath, "Folder");
    await mkdir(folderPath);
    await Promise.all([
      writeFile(path.join(workspacePath, ".DS_Store"), "root metadata"),
      writeFile(path.join(folderPath, ".DS_Store"), "nested metadata"),
      writeFile(path.join(folderPath, "note.md"), "# Note\n"),
    ]);

    const tree = await getWorkspaceFileTree(workspacePath, workspacePath);

    assert.deepEqual(
      tree.map(({ relativePath }) => relativePath),
      ["Folder"],
    );
    assert.deepEqual(
      tree[0]?.children?.map(({ relativePath }) => relativePath),
      ["Folder/note.md"],
    );
  });
});

test("workspace fingerprints are portable SHA-256 content identities", async () => {
  await withWorkspace(async (workspacePath) => {
    const filePath = path.join(workspacePath, "report.pdf");
    await writeFile(filePath, "research-pdf");

    assert.equal(
      await fingerprintWorkspaceFile(filePath),
      "sha256:177761a43c1f61ef2a0651df6c0597985ca198d3cf5597d1d6981744e03bb589",
    );
  });
});
