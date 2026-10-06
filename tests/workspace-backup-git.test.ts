import { execFile } from "node:child_process";
import { devNull, tmpdir } from "node:os";
import { promisify } from "node:util";
import { access, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createWorkspaceBackup } from "../src/main/workspace-backup";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const git = (cwd: string, ...args: string[]) =>
  exec(
    "git",
    ["-c", "user.name=Backup Test", "-c", "user.email=backup@example.invalid", "-c", "commit.gpgSign=false", ...args],
    {
      cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1" },
    },
  );

it.each([false, true])(
  "G05 exports a files-only snapshot independently of Git metadata (linked=%s)",
  async (linked) => {
    const root = await mkdtemp(path.join(tmpdir(), "obim-git-backup-"));
    roots.push(root);
    const repository = path.join(root, "repository");
    await mkdir(repository);
    await git(repository, "init", "-b", "main");
    await writeFile(path.join(repository, "note.md"), "committed");
    await git(repository, "add", "--", "note.md");
    await git(repository, "commit", "-m", "baseline");
    const workspace = linked ? path.join(root, "worktree") : repository;
    if (linked) await git(repository, "worktree", "add", "-b", "notes", workspace);
    await writeFile(path.join(workspace, "note.md"), "dirty tracked contents");
    await writeFile(path.join(workspace, "new.md"), "untracked contents");
    const result = await createWorkspaceBackup(workspace, path.join(root, "backups"));
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    await expect(access(path.join(result.path, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
    await rename(repository, `${repository}-unavailable`);
    if (linked) await rename(workspace, `${workspace}-unavailable`);
    // Restoring a files-only export consists of selecting this independent directory.
    expect(await readFile(path.join(result.path, "note.md"), "utf8")).toBe("dirty tracked contents");
    expect(await readFile(path.join(result.path, "new.md"), "utf8")).toBe("untracked contents");
  },
);
