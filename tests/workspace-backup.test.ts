import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";

import { createWorkspaceBackup } from "../src/main/workspace-backup";

let rootPath: string;
let workspacePath: string;
let destinationPath: string;

beforeEach(async () => {
  rootPath = await mkdtemp(path.join(tmpdir(), "obim-workspace-backup-"));
  workspacePath = path.join(rootPath, "workspace");
  destinationPath = path.join(rootPath, "backups");
  await mkdir(path.join(workspacePath, "projects"), { recursive: true });
  await writeFile(path.join(workspacePath, "note.md"), "# Note\n", "utf8");
  await writeFile(path.join(workspacePath, "projects", "task.todo"), "open", "utf8");
});

afterEach(async () => {
  await rm(rootPath, { force: true, recursive: true });
});

test("stages a complete files-only snapshot before publishing a backup directory", async () => {
  const result = await createWorkspaceBackup(workspacePath, destinationPath, new Date(2026, 7, 25, 14, 30, 5));

  assert.equal(result.status, "created");
  if (result.status !== "created") return;
  assert.equal(path.basename(result.path), "Obim Backup 2026-08-25 143005");
  assert.equal(await readFile(path.join(result.path, "note.md"), "utf8"), "# Note\n");
  assert.equal(await readFile(path.join(result.path, "projects", "task.todo"), "utf8"), "open");
  assert.deepEqual(
    (await readdir(destinationPath)).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("uses a unique folder name when a backup already exists", async () => {
  const now = new Date(2026, 7, 25, 14, 30, 5);
  const first = await createWorkspaceBackup(workspacePath, destinationPath, now);
  const second = await createWorkspaceBackup(workspacePath, destinationPath, now);

  assert.equal(first.status, "created");
  assert.equal(second.status, "created");
  if (second.status === "created") assert.equal(path.basename(second.path), "Obim Backup 2026-08-25 143005 2");
});

test("rejects a backup destination inside the workspace", async () => {
  const result = await createWorkspaceBackup(workspacePath, path.join(workspacePath, "backups"));

  assert.deepEqual(result, { status: "error", error: "Choose a backup destination outside the current workspace." });
});

test("stops instead of following symbolic links out of the workspace", async () => {
  await symlink(destinationPath, path.join(workspacePath, "linked-folder"));

  const result = await createWorkspaceBackup(workspacePath, destinationPath);

  assert.equal(result.status, "error");
  if (result.status === "error") assert.match(result.error, /symbolic link/i);
});

test("F02 backs up the real directory behind a root link independently", async () => {
  const linkedRoot = path.join(rootPath, "linked-workspace");
  await symlink(workspacePath, linkedRoot);
  const result = await createWorkspaceBackup(linkedRoot, destinationPath);
  assert.equal(result.status, "created");
  if (result.status !== "created") return;
  assert.equal((await lstat(result.path)).isSymbolicLink(), false);
  await writeFile(path.join(workspacePath, "note.md"), "changed original");
  await rename(workspacePath, `${workspacePath}-unavailable`);
  assert.equal(await readFile(path.join(result.path, "note.md"), "utf8"), "# Note\n");
});

test("F02 rejects a destination reached through a link into the real source", async () => {
  const alias = path.join(rootPath, "workspace-alias");
  await symlink(workspacePath, alias);
  const result = await createWorkspaceBackup(workspacePath, path.join(alias, "new-backups"));
  assert.equal(result.status, "error");
  if (result.status === "error") assert.match(result.error, /outside the current workspace/);
  assert.equal((await readdir(workspacePath)).includes("new-backups"), false);
});

test("F02 allows a destination with a safe symlinked ancestor", async () => {
  const external = path.join(rootPath, "external");
  const alias = path.join(rootPath, "external-alias");
  await mkdir(external);
  await symlink(external, alias);
  const result = await createWorkspaceBackup(workspacePath, path.join(alias, "backups"));
  assert.equal(result.status, "created");
  if (result.status !== "created") return;
  assert.equal((await lstat(result.path)).isDirectory(), true);
  assert.equal(await readFile(path.join(result.path, "note.md"), "utf8"), "# Note\n");
});
