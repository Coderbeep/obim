import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";

import {
  abortGitRemoteReconciliation,
  autoSyncGitRemote,
  beginGitRemoteReconciliation,
  commitGitChanges,
  fetchGitRemote,
  initializeGitRepository,
  parseGitFileStatus,
  pullGitRemote,
  pushGitRemote,
  readGitConflictPreview,
  readGitFileStatus,
  readGitIgnoreSettings,
  readGitRemoteConfiguration,
  removeGitRemote,
  resolveGitConflict,
  revertGitPaths,
  setGitRemoteUrl,
  stageGitPaths,
  unstageGitPaths,
  updateGitIgnoreSettings,
} from "../src/main/git-file-status";
import { readGitFileHistory, readGitFileRevision, restoreGitFileRevision } from "../src/main/git-file-history";
import { toWorkspaceFileVersion } from "../src/main/workspace-files";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const localRemoteTestOptions = { allowUrlRewriteForTests: true } as const;
const inheritedGitConfig = {
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
};

beforeAll(() => {
  // Temporary repositories must not inherit user identities, filters, or helpers from the host.
  process.env.GIT_CONFIG_GLOBAL = os.devNull;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});

afterAll(() => {
  for (const [key, value] of Object.entries(inheritedGitConfig)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "obim-git-status-"));
  temporaryDirectories.push(directory);
  return directory;
};

const git = (cwd: string, args: string[]) =>
  execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });

const initializeRepository = async (directory: string) => {
  await git(directory, ["init", "-b", "main"]);
  await git(directory, ["config", "user.name", "Obim Test"]);
  await git(directory, ["config", "user.email", "obim-test@example.invalid"]);
};

const createBareRemote = async () => {
  const remote = await createTemporaryDirectory();
  await git(remote, ["init", "--bare", "-b", "main"]);
  return remote;
};

const configureTestRemote = async (repository: string, remote: string, name = "notes") => {
  const remoteUrl = `https://obim-test.invalid/${name}.git`;
  await git(repository, ["config", "--local", `url.${pathToFileURL(remote).href}.insteadOf`, remoteUrl]);
  const configured = await setGitRemoteUrl(repository, remoteUrl);
  assert.equal(configured.status, "succeeded", JSON.stringify(configured));
  return remoteUrl;
};

const cloneTestRemote = async (remote: string) => {
  const parent = await createTemporaryDirectory();
  const clone = path.join(parent, "writer");
  await git(parent, ["clone", "--quiet", remote, clone]);
  await git(clone, ["config", "user.name", "Remote Writer"]);
  await git(clone, ["config", "user.email", "remote-writer@example.invalid"]);
  return clone;
};

const createDivergedNoteRepository = async (name: string, baseFiles: Record<string, string> = {}) => {
  const repository = await createTemporaryDirectory();
  const remote = await createBareRemote();
  const emptyHooksDirectory = await createTemporaryDirectory();
  await initializeRepository(repository);
  await writeFile(path.join(repository, "note.md"), "base\n");
  for (const [filePath, content] of Object.entries(baseFiles))
    await writeFile(path.join(repository, filePath), content);
  await git(repository, ["add", "--all"]);
  await git(repository, ["commit", "-m", "Base"]);
  await configureTestRemote(repository, remote, name);
  assert.equal((await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");

  const writer = await cloneTestRemote(remote);
  await writeFile(path.join(repository, "note.md"), "local version\n");
  await git(repository, ["commit", "-am", "Local note version"]);
  await writeFile(path.join(writer, "note.md"), "remote version\n");
  await git(writer, ["commit", "-am", "Remote note version"]);
  await git(writer, ["push", "--quiet", "origin", "main"]);
  assert.equal((await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");

  return { emptyHooksDirectory, remote, repository, writer };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("Git file status", () => {
  it("parses stable NUL-delimited status records and preserves conflict state", () => {
    const output = Buffer.from(
      " M modified.md\0A  added.md\0 D deleted.md\0R  renamed.md\0old name.md\0UU conflict.md\0?? new file.md\0",
    );

    assert.deepEqual(parseGitFileStatus(output), [
      { conflicted: false, kind: "modified", path: "modified.md", staged: false, workingTreeChanged: true },
      { conflicted: false, kind: "added", path: "added.md", staged: true, workingTreeChanged: false },
      { conflicted: false, kind: "deleted", path: "deleted.md", staged: false, workingTreeChanged: true },
      {
        conflicted: false,
        kind: "renamed",
        originalPath: "old name.md",
        path: "renamed.md",
        staged: true,
        workingTreeChanged: false,
      },
      { conflicted: true, kind: "conflicted", path: "conflict.md", staged: false, workingTreeChanged: true },
      { conflicted: false, kind: "untracked", path: "new file.md", staged: false, workingTreeChanged: true },
    ]);
  });

  it("reads an exact-root repository without mutating its index", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "tracked.md"), "before\n");
    await writeFile(path.join(repository, "deleted.md"), "delete me\n");
    await writeFile(path.join(repository, "old.md"), "rename me\n");
    await git(repository, ["add", "--", "tracked.md", "deleted.md", "old.md"]);
    await git(repository, ["commit", "-m", "Initial"]);

    await writeFile(path.join(repository, "tracked.md"), "after\n");
    await rm(path.join(repository, "deleted.md"));
    await git(repository, ["mv", "--", "old.md", "renamed.md"]);
    await writeFile(path.join(repository, "new note.md"), "new\n");

    const result = await readGitFileStatus(repository);
    assert.equal(result.snapshot.status, "ready");
    if (result.snapshot.status !== "ready") return;
    assert.equal(result.snapshot.repositoryScope, "workspace");
    assert.deepEqual(
      result.snapshot.changes.map(({ kind, path: filePath }) => [filePath, kind]),
      [
        ["deleted.md", "deleted"],
        ["renamed.md", "renamed"],
        ["tracked.md", "modified"],
        ["new note.md", "untracked"],
      ],
    );

    const staged = await git(repository, ["diff", "--cached", "--name-only"]);
    assert.equal(staged.stdout.trim(), "renamed.md");
  });

  it("scopes an ancestor repository to the selected workspace", async () => {
    const repository = await createTemporaryDirectory();
    const workspace = path.join(repository, "Notes");
    await mkdir(workspace);
    await initializeRepository(repository);
    await writeFile(path.join(workspace, "inside.md"), "before\n");
    await writeFile(path.join(repository, "outside.md"), "before\n");
    await git(repository, ["add", "--", "Notes/inside.md", "outside.md"]);
    await git(repository, ["commit", "-m", "Initial"]);
    await writeFile(path.join(workspace, "inside.md"), "after\n");
    await writeFile(path.join(repository, "outside.md"), "after\n");

    const result = await readGitFileStatus(workspace);
    assert.deepEqual(result.snapshot, {
      status: "ready",
      branch: "main",
      changes: [{ conflicted: false, kind: "modified", path: "inside.md", staged: false, workingTreeChanged: true }],
      repositoryScope: "ancestor",
    });

    const mutation = await stageGitPaths(workspace, ["inside.md"]);
    assert.deepEqual(mutation, {
      status: "failed",
      error: "Source Control actions are disabled because this workspace is inside a parent repository.",
    });
    assert.deepEqual(await setGitRemoteUrl(workspace, "https://github.com/example/notes.git"), {
      status: "failed",
      error: "Source Control actions are disabled because this workspace is inside a parent repository.",
    });
    assert.equal((await git(repository, ["diff", "--cached", "--name-only"])).stdout, "");
  });

  it("returns a neutral state for a folder that is not a repository", async () => {
    const directory = await createTemporaryDirectory();
    assert.deepEqual((await readGitFileStatus(directory)).snapshot, { status: "not-repository", changes: [] });
  });

  it("starts local history without staging or committing workspace files", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(path.join(directory, "note.md"), "local note\n");

    const initialized = await initializeGitRepository(directory);
    assert.equal(initialized.status, "succeeded");
    if (initialized.status !== "succeeded") return;
    assert.equal(initialized.snapshot.status, "ready");
    assert.deepEqual(initialized.snapshot.changes, [
      { conflicted: false, kind: "untracked", path: "note.md", staged: false, workingTreeChanged: true },
    ]);
    assert.equal((await git(directory, ["diff", "--cached", "--name-only"])).stdout, "");
    await assert.rejects(git(directory, ["rev-parse", "--verify", "HEAD"]));

    const repeated = await initializeGitRepository(directory);
    assert.equal(repeated.status, "succeeded");
    if (repeated.status === "succeeded") assert.deepEqual(repeated.snapshot, initialized.snapshot);
  });

  it("stores managed ignore rules, preserves manual rules, and stops tracking ignored files", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);
    await mkdir(path.join(repository, "Private"));
    await writeFile(path.join(repository, ".gitignore"), "*.manual\n");
    await writeFile(path.join(repository, "Private", "secret.md"), "keep on disk\n");
    await writeFile(path.join(repository, "note.md"), "tracked\n");
    await git(repository, ["add", "--", ".gitignore", "Private/secret.md", "note.md"]);
    await git(repository, ["commit", "-m", "Initial"]);

    assert.deepEqual(await readGitIgnoreSettings(repository), { status: "ready", settings: { patterns: "" } });
    const updated = await updateGitIgnoreSettings(repository, "Private/\n*.tmp");
    assert.equal(updated.status, "succeeded");
    if (updated.status !== "succeeded") return;
    assert.deepEqual(updated.untrackedPaths, ["Private/secret.md"]);
    assert.equal(await readFile(path.join(repository, "Private", "secret.md"), "utf8"), "keep on disk\n");
    assert.equal((await git(repository, ["ls-files", "--", "Private/secret.md"])).stdout, "");
    assert.equal(
      await readFile(path.join(repository, ".gitignore"), "utf8"),
      "*.manual\n\n# Obim managed ignores — edit in Settings\nPrivate/\n*.tmp\n# End Obim managed ignores\n",
    );
    assert.deepEqual(await readGitIgnoreSettings(repository), {
      status: "ready",
      settings: { patterns: "Private/\n*.tmp" },
    });
  });

  it("reads, connects, updates, and removes the origin remote without contacting it", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);

    assert.deepEqual(await readGitRemoteConfiguration(repository), {
      status: "ready",
      repositoryScope: "workspace",
    });

    const connected = await setGitRemoteUrl(repository, "https://github.com/example/notes.git");
    assert.deepEqual(connected, {
      status: "succeeded",
      configuration: {
        status: "ready",
        remote: {
          fetchUrl: "https://github.com/example/notes.git",
          name: "origin",
        },
        repositoryScope: "workspace",
      },
    });
    assert.equal(
      (await git(repository, ["config", "--local", "--get", "remote.origin.url"])).stdout.trim(),
      "https://github.com/example/notes.git",
    );

    await git(repository, ["config", "--local", "remote.origin.pushurl", "git@github.com:example/notes-write.git"]);
    assert.deepEqual(await readGitRemoteConfiguration(repository), {
      status: "ready",
      remote: {
        fetchUrl: "https://github.com/example/notes.git",
        name: "origin",
        pushUrl: "git@github.com:example/notes-write.git",
      },
      repositoryScope: "workspace",
    });
    await git(repository, ["config", "--local", "--add", "remote.origin.url", "https://mirror.invalid/notes.git"]);

    const updated = await setGitRemoteUrl(repository, "git@github.com:example/notes.git");
    assert.equal(updated.status, "succeeded");
    assert.equal(
      (await git(repository, ["config", "--local", "--get-all", "remote.origin.url"])).stdout.trim(),
      "git@github.com:example/notes.git",
    );
    await assert.rejects(git(repository, ["config", "--local", "--get", "remote.origin.pushurl"]));
    assert.deepEqual(await readGitRemoteConfiguration(repository), {
      status: "ready",
      remote: {
        fetchUrl: "git@github.com:example/notes.git",
        name: "origin",
      },
      repositoryScope: "workspace",
    });

    assert.deepEqual(await removeGitRemote(repository), {
      status: "succeeded",
      configuration: {
        status: "ready",
        repositoryScope: "workspace",
      },
    });
    assert.equal((await git(repository, ["remote"])).stdout.trim(), "");
  });

  it("allows only credential-free HTTPS and SSH remote URLs and redacts legacy credentials", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);

    for (const invalidUrl of [
      "https://token:secret@github.com/example/notes.git",
      "https://github.com/example/notes.git?access_token=secret",
      "ssh://git@github.com/example/notes.git#secret",
      "git@github.com:example/notes.git?access_token=secret",
      "http://github.com/example/notes.git",
      "file:///tmp/notes.git",
      "ext::sh -c exploit",
      "../notes.git",
    ]) {
      const result = await setGitRemoteUrl(repository, invalidUrl);
      assert.equal(result.status, "failed");
    }
    assert.equal((await git(repository, ["remote"])).stdout.trim(), "");

    await git(repository, [
      "remote",
      "add",
      "origin",
      "https://token:secret@github.com/example/notes.git?access_token=secret#credential",
    ]);
    assert.deepEqual(await readGitRemoteConfiguration(repository), {
      status: "ready",
      remote: {
        fetchUrl: "https://github.com/example/notes.git",
        name: "origin",
      },
      repositoryScope: "workspace",
    });
  });

  it("publishes only committed content to an empty remote and leaves working changes local", async () => {
    const repository = await createTemporaryDirectory();
    const remote = await createBareRemote();
    const emptyHooksDirectory = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "note.md"), "committed\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Initial note"]);
    await configureTestRemote(repository, remote, "empty-publish");
    await writeFile(path.join(repository, "note.md"), "uncommitted editor save\n");

    const prePushHook = path.join(repository, ".git", "hooks", "pre-push");
    await writeFile(prePushHook, "#!/bin/sh\ntouch hook-ran\n");
    await chmod(prePushHook, 0o755);
    const checked = await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(checked.status, "succeeded");
    if (checked.status !== "succeeded") return;
    assert.equal(checked.sync.state, "unpublished");

    const pushed = await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(pushed.status, "succeeded");
    if (pushed.status !== "succeeded") return;
    assert.equal(pushed.action, "pushed");
    assert.equal(pushed.sync.state, "up-to-date");
    assert.equal((await git(remote, ["show", "main:note.md"])).stdout, "committed\n");
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "uncommitted editor save\n");
    assert.equal((await git(repository, ["diff", "--cached", "--name-only"])).stdout, "");
    await assert.rejects(access(path.join(repository, "hook-ran")));
  });

  it("refuses hidden Git URL rewrites before contacting or changing their destination", async () => {
    const repository = await createTemporaryDirectory();
    const redirectedRemote = await createBareRemote();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "note.md"), "committed\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Initial note"]);
    await configureTestRemote(repository, redirectedRemote, "hidden-redirect");

    const checked = await fetchGitRemote(repository, await createTemporaryDirectory());
    assert.equal(checked.status, "failed");
    if (checked.status === "failed") assert.match(checked.error, /hidden URL rewrites/u);
    assert.equal((await git(redirectedRemote, ["for-each-ref", "--format=%(refname)", "refs/heads"])).stdout, "");
  });

  it("fetches and applies only clean fast-forward remote updates", async () => {
    const repository = await createTemporaryDirectory();
    const remote = await createBareRemote();
    const emptyHooksDirectory = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "note.md"), "first\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Initial"]);
    await configureTestRemote(repository, remote, "fast-forward");
    assert.equal((await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");

    const writer = await cloneTestRemote(remote);
    await writeFile(path.join(writer, "note.md"), "from remote\n");
    await git(writer, ["commit", "-am", "Remote note update"]);
    await git(writer, ["push", "--quiet", "origin", "main"]);

    const checked = await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(checked.status, "succeeded");
    if (checked.status !== "succeeded") return;
    assert.equal(checked.sync.state, "behind");
    assert.equal(checked.sync.behind, 1);

    await writeFile(path.join(repository, "note.md"), "local draft\n");
    assert.deepEqual(await pullGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions), {
      status: "failed",
      error: "Commit, revert, or remove all local changes before pulling from the remote.",
    });
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "local draft\n");
    await writeFile(path.join(repository, "note.md"), "first\n");

    const pulled = await pullGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(pulled.status, "succeeded");
    if (pulled.status !== "succeeded") return;
    assert.equal(pulled.action, "pulled");
    assert.deepEqual(pulled.changedPaths, [{ kind: "modified", path: "note.md" }]);
    assert.equal(pulled.sync.state, "up-to-date");
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "from remote\n");
  });

  it("refuses ordinary push and pull actions to overwrite divergent histories", async () => {
    const repository = await createTemporaryDirectory();
    const remote = await createBareRemote();
    const emptyHooksDirectory = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "note.md"), "base\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Base"]);
    await configureTestRemote(repository, remote, "diverged");
    assert.equal((await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");
    const writer = await cloneTestRemote(remote);

    await writeFile(path.join(repository, "local.md"), "local\n");
    await git(repository, ["add", "--", "local.md"]);
    await git(repository, ["commit", "-m", "Local commit"]);
    const localHead = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(writer, "remote.md"), "remote\n");
    await git(writer, ["add", "--", "remote.md"]);
    await git(writer, ["commit", "-m", "Remote commit"]);
    await git(writer, ["push", "--quiet", "origin", "main"]);
    const remoteHead = (await git(remote, ["rev-parse", "refs/heads/main"])).stdout.trim();

    const pushed = await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(pushed.status, "failed");
    if (pushed.status === "failed") assert.match(pushed.error, /diverged|force-push/u);
    const pulled = await pullGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(pulled.status, "failed");
    if (pulled.status === "failed") assert.match(pulled.error, /Resolve differences/u);
    assert.equal((await git(repository, ["rev-parse", "HEAD"])).stdout.trim(), localHead);
    assert.equal((await git(remote, ["rev-parse", "refs/heads/main"])).stdout.trim(), remoteHead);
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "base\n");
  });

  it("keeps the local note during explicit reconciliation and preserves both histories", async () => {
    const { emptyHooksDirectory, remote, repository } = await createDivergedNoteRepository("keep-local");
    const localHead = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    const remoteHead = (await git(remote, ["rev-parse", "refs/heads/main"])).stdout.trim();

    const started = await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(started.status, "succeeded");
    if (started.status !== "succeeded") return;
    assert.equal(started.action, "reconciliation-started");
    assert.equal(started.snapshot.mergeInProgress, true);
    assert.equal(started.snapshot.remoteReconciliationInProgress, true);
    assert.deepEqual(
      started.snapshot.changes.map((change) => ({ conflict: change.conflict, path: change.path })),
      [{ conflict: { localExists: true, remoteExists: true }, path: "note.md" }],
    );
    assert.deepEqual(await readGitConflictPreview(repository, "note.md"), {
      status: "ready",
      base: { status: "ready", content: "base\n", sizeBytes: 5 },
      local: { status: "ready", content: "local version\n", sizeBytes: 14 },
      remote: { status: "ready", content: "remote version\n", sizeBytes: 15 },
    });

    const resolved = await resolveGitConflict(repository, "note.md", "keep-local");
    assert.equal(resolved.status, "succeeded");
    if (resolved.status !== "succeeded") return;
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "local version\n");
    assert.equal(resolved.snapshot.mergeInProgress, true);
    assert.equal(resolved.snapshot.remoteReconciliationInProgress, true);
    assert.equal(
      resolved.snapshot.changes.some((change) => change.conflicted),
      false,
    );
    assert.equal((await git(repository, ["diff", "--cached", "--name-only"])).stdout, "");

    const committed = await commitGitChanges(repository, "Combine note histories", emptyHooksDirectory);
    assert.equal(committed.status, "succeeded");
    const mergeCommit = (await git(repository, ["rev-list", "--parents", "-n", "1", "HEAD"])).stdout.trim().split(" ");
    assert.equal(mergeCommit.length, 3);
    assert.deepEqual(new Set(mergeCommit.slice(1)), new Set([localHead, remoteHead]));

    const pushed = await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(pushed.status, "succeeded");
    assert.equal((await git(remote, ["show", "main:note.md"])).stdout, "local version\n");
  });

  it("opens fetched differences without contacting the remote again", async () => {
    const { emptyHooksDirectory, remote, repository } = await createDivergedNoteRepository("cached-review");
    await rm(remote, { force: true, recursive: true });

    const started = await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions);

    assert.equal(started.status, "succeeded");
    if (started.status !== "succeeded") return;
    assert.equal(started.action, "reconciliation-started");
    assert.equal(started.snapshot.remoteReconciliationInProgress, true);
    assert.deepEqual(
      started.snapshot.changes.map((change) => change.path),
      ["note.md"],
    );
  });

  it("uses the remote note during explicit reconciliation", async () => {
    const { emptyHooksDirectory, repository } = await createDivergedNoteRepository("use-remote");

    const started = await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(started.status, "succeeded");
    const resolved = await resolveGitConflict(repository, "note.md", "use-remote");
    assert.equal(resolved.status, "succeeded");
    if (resolved.status !== "succeeded") return;
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "remote version\n");
    assert.equal(
      resolved.snapshot.changes.some((change) => change.conflicted),
      false,
    );
    assert.deepEqual(
      resolved.snapshot.changes.map((change) => [change.path, change.staged, change.workingTreeChanged]),
      [["note.md", false, true]],
    );
    assert.equal((await git(repository, ["diff", "--cached", "--name-only"])).stdout, "");
    assert.equal((await commitGitChanges(repository, "Use remote note", emptyHooksDirectory)).status, "failed");
    assert.equal((await stageGitPaths(repository, ["note.md"])).status, "succeeded");
    assert.equal((await commitGitChanges(repository, "Use remote note", emptyHooksDirectory)).status, "succeeded");
  });

  it("auto-sync resolves divergent edits with the selected remote policy and pushes the merge", async () => {
    const { emptyHooksDirectory, remote, repository } = await createDivergedNoteRepository("auto-use-remote");
    await writeFile(path.join(repository, "draft.md"), "included automatically\n");

    const synced = await autoSyncGitRemote(repository, "use-remote", emptyHooksDirectory, localRemoteTestOptions);

    assert.equal(synced.status, "succeeded");
    if (synced.status !== "succeeded") return;
    assert.equal(synced.action, "reconciled");
    assert.equal(synced.localCommitCreated, true);
    assert.equal(synced.sync.state, "up-to-date");
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "remote version\n");
    assert.equal((await git(remote, ["show", "main:note.md"])).stdout, "remote version\n");
    assert.equal((await git(remote, ["show", "main:draft.md"])).stdout, "included automatically\n");
    assert.equal((await git(repository, ["status", "--porcelain"])).stdout, "");
  }, 15_000);

  it("preserves a file edited during reconciliation before restoring the local branch", async () => {
    const { emptyHooksDirectory, repository } = await createDivergedNoteRepository("edited-during-review");
    assert.equal(
      (await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions)).status,
      "succeeded",
    );

    await writeFile(path.join(repository, "note.md"), "new edit made during review\n");
    const resolved = await resolveGitConflict(repository, "note.md", "use-remote");
    assert.equal(resolved.status, "failed");
    if (resolved.status !== "failed") return;
    assert.match(resolved.error, /changed after reconciliation began/u);
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "new edit made during review\n");

    const cancelled = await abortGitRemoteReconciliation(repository);
    assert.equal(cancelled.status, "succeeded");
    if (cancelled.status !== "succeeded") return;
    assert.deepEqual(cancelled.recoveryPaths, ["note — reconciliation edit.md"]);
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "local version\n");
    assert.equal(
      await readFile(path.join(repository, "note — reconciliation edit.md"), "utf8"),
      "new edit made during review\n",
    );
    assert.equal(
      cancelled.snapshot.changes.some(
        (change) => change.path === "note — reconciliation edit.md" && change.kind === "untracked",
      ),
      true,
    );
  });

  it("refuses repository-configured merge or file conversion commands", async () => {
    const { emptyHooksDirectory, repository } = await createDivergedNoteRepository("custom-merge-command");
    await git(repository, ["config", "--local", "merge.obim.driver", "false"]);

    const started = await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.deepEqual(started, {
      status: "failed",
      error:
        "This repository configures executable Git merge or file-conversion commands. Obim will not run them; remove that local Git configuration or complete this operation outside Obim.",
    });
    const status = await readGitFileStatus(repository);
    assert.equal(status.snapshot.status, "unavailable");
    await assert.rejects(git(repository, ["rev-parse", "--verify", "MERGE_HEAD"]));
  });

  it("ignores environment-injected Git commands during reconciliation", async () => {
    const { emptyHooksDirectory, repository } = await createDivergedNoteRepository("environment-merge-command");
    const markerDirectory = await createTemporaryDirectory();
    const commandMarker = path.join(markerDirectory, "driver-ran");
    await writeFile(path.join(repository, ".git", "info", "attributes"), "note.md merge=obim\n");
    const injectedVariables = {
      GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
      GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
      GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
    };
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "merge.obim.driver";
    process.env.GIT_CONFIG_VALUE_0 = `touch ${commandMarker}; false`;

    const started = await (async () => {
      try {
        return await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions);
      } finally {
        for (const [key, value] of Object.entries(injectedVariables)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    })();

    assert.equal(started.status, "succeeded");
    await assert.rejects(access(commandMarker));
    assert.equal((await abortGitRemoteReconciliation(repository)).status, "succeeded");
  });

  it("does not execute repository-configured filters during explicit staging", async () => {
    const { emptyHooksDirectory, repository } = await createDivergedNoteRepository("custom-stage-filter");
    assert.equal(
      (await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions)).status,
      "succeeded",
    );
    assert.equal((await resolveGitConflict(repository, "note.md", "use-remote")).status, "succeeded");
    await git(repository, ["config", "--local", "filter.obim.clean", "false"]);

    assert.deepEqual(await stageGitPaths(repository, ["note.md"]), {
      status: "failed",
      error:
        "This repository configures executable Git merge or file-conversion commands. Obim will not run them; remove that local Git configuration or complete this operation outside Obim.",
    });
    assert.equal((await git(repository, ["diff", "--cached", "--name-only"])).stdout, "");
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "remote version\n");
  });

  it("keeps an active reconciliation identifiable if the remote advances externally", async () => {
    const { emptyHooksDirectory, repository, writer } = await createDivergedNoteRepository("advancing-remote");
    assert.equal(
      (await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions)).status,
      "succeeded",
    );

    await writeFile(path.join(writer, "later.md"), "later remote note\n");
    await git(writer, ["add", "--", "later.md"]);
    await git(writer, ["commit", "-m", "Later remote note"]);
    await git(writer, ["push", "--quiet", "origin", "main"]);
    assert.deepEqual(await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions), {
      status: "failed",
      error: "Finish or cancel the current merge before changing or contacting the remote.",
    });

    await git(repository, ["fetch", "--quiet", "origin"]);
    const status = await readGitFileStatus(repository);
    assert.equal(status.snapshot.status, "ready");
    if (status.snapshot.status !== "ready") return;
    assert.equal(status.snapshot.remoteReconciliationInProgress, true);
    const resolved = await resolveGitConflict(repository, "note.md", "use-remote");
    assert.equal(resolved.status, "succeeded");
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "remote version\n");
    assert.equal((await abortGitRemoteReconciliation(repository)).status, "succeeded");
  });

  it("handles a local deletion without offering an impossible save-both result", async () => {
    const repository = await createTemporaryDirectory();
    const remote = await createBareRemote();
    const emptyHooksDirectory = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "note.md"), "base\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Base"]);
    await configureTestRemote(repository, remote, "delete-modify");
    assert.equal((await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");
    const writer = await cloneTestRemote(remote);

    await rm(path.join(repository, "note.md"));
    await git(repository, ["commit", "-am", "Delete local note"]);
    await writeFile(path.join(writer, "note.md"), "remote version\n");
    await git(writer, ["commit", "-am", "Update remote note"]);
    await git(writer, ["push", "--quiet", "origin", "main"]);
    assert.equal((await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");

    const started = await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(started.status, "succeeded");
    if (started.status !== "succeeded") return;
    assert.deepEqual(started.snapshot.changes[0]?.conflict, { localExists: false, remoteExists: true });
    assert.deepEqual(await readGitConflictPreview(repository, "note.md"), {
      status: "ready",
      base: { status: "ready", content: "base\n", sizeBytes: 5 },
      local: { status: "deleted" },
      remote: { status: "ready", content: "remote version\n", sizeBytes: 15 },
    });
    assert.deepEqual(await resolveGitConflict(repository, "note.md", "save-both"), {
      status: "failed",
      error: "Save both is unavailable because one side deleted this file. Choose Keep local or Use remote.",
    });
    const keptLocal = await resolveGitConflict(repository, "note.md", "keep-local");
    assert.equal(keptLocal.status, "succeeded");
    await assert.rejects(access(path.join(repository, "note.md")));
    assert.equal((await commitGitChanges(repository, "Keep local deletion", emptyHooksDirectory)).status, "succeeded");
  });

  it("prepares a remote deletion as an unstaged choice", async () => {
    const repository = await createTemporaryDirectory();
    const remote = await createBareRemote();
    const emptyHooksDirectory = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "note.md"), "base\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Base"]);
    await configureTestRemote(repository, remote, "modify-delete");
    assert.equal((await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");
    const writer = await cloneTestRemote(remote);

    await writeFile(path.join(repository, "note.md"), "local version\n");
    await git(repository, ["commit", "-am", "Update local note"]);
    await rm(path.join(writer, "note.md"));
    await git(writer, ["commit", "-am", "Delete remote note"]);
    await git(writer, ["push", "--quiet", "origin", "main"]);
    assert.equal((await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");

    const started = await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(started.status, "succeeded");
    if (started.status !== "succeeded") return;
    assert.deepEqual(started.snapshot.changes[0]?.conflict, { localExists: true, remoteExists: false });
    const resolved = await resolveGitConflict(repository, "note.md", "use-remote");
    assert.equal(resolved.status, "succeeded");
    if (resolved.status !== "succeeded") return;
    assert.deepEqual(
      resolved.snapshot.changes.map((change) => [change.path, change.kind, change.staged, change.workingTreeChanged]),
      [["note.md", "deleted", false, true]],
    );
    await assert.rejects(access(path.join(repository, "note.md")));
    assert.equal((await commitGitChanges(repository, "Use remote deletion", emptyHooksDirectory)).status, "failed");
    assert.equal((await stageGitPaths(repository, ["note.md"])).status, "succeeded");
    assert.equal((await commitGitChanges(repository, "Use remote deletion", emptyHooksDirectory)).status, "succeeded");
  });

  it("saves local and remote note versions as separate notes without overwriting either", async () => {
    const { emptyHooksDirectory, repository } = await createDivergedNoteRepository("save-both");

    const started = await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(started.status, "succeeded");
    const resolved = await resolveGitConflict(repository, "note.md", "save-both");
    assert.equal(resolved.status, "succeeded");
    if (resolved.status !== "succeeded") return;
    assert.equal(resolved.savedBothPath, "note — remote.md");
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "local version\n");
    assert.equal(await readFile(path.join(repository, "note — remote.md"), "utf8"), "remote version\n");
    assert.deepEqual(
      resolved.snapshot.changes.map((change) => [change.path, change.staged, change.workingTreeChanged]),
      [["note — remote.md", false, true]],
    );
    assert.equal((await git(repository, ["diff", "--cached", "--name-only"])).stdout, "");
    assert.equal((await commitGitChanges(repository, "Keep both notes", emptyHooksDirectory)).status, "failed");
    assert.equal((await stageGitPaths(repository, ["note — remote.md"])).status, "succeeded");
    assert.equal((await commitGitChanges(repository, "Keep both notes", emptyHooksDirectory)).status, "succeeded");
  });

  it("saves Task Board configuration versions as ordinary text files", async () => {
    const repository = await createTemporaryDirectory();
    const remote = await createBareRemote();
    const emptyHooksDirectory = await createTemporaryDirectory();
    await initializeRepository(repository);
    await mkdir(path.join(repository, ".todo"));
    const configPath = path.join(repository, ".todo", "taskboard.json");
    const taskBoardSource = (config: unknown) => `${JSON.stringify(config)}\n`;
    const baseConfig = {
      sections: [{ name: "Research", colorId: "blue" }],
      taskOrder: ["one.md", "two.md"],
    };
    await writeFile(configPath, taskBoardSource(baseConfig));
    await git(repository, ["add", "--", ".todo/taskboard.json"]);
    await git(repository, ["commit", "-m", "Base Task Board"]);
    await configureTestRemote(repository, remote, "task-board-reconciliation");
    assert.equal((await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");
    const writer = await cloneTestRemote(remote);

    await writeFile(configPath, taskBoardSource({ ...baseConfig, sections: [{ name: "Research", colorId: "rose" }] }));
    await git(repository, ["commit", "-am", "Change local section color"]);
    await writeFile(
      path.join(writer, ".todo", "taskboard.json"),
      taskBoardSource({ ...baseConfig, taskOrder: ["two.md", "one.md"] }),
    );
    await git(writer, ["commit", "-am", "Change remote task order"]);
    await git(writer, ["push", "--quiet", "origin", "main"]);
    assert.equal((await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");
    assert.equal(
      (await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions)).status,
      "succeeded",
    );

    const resolved = await resolveGitConflict(repository, ".todo/taskboard.json", "save-both");
    assert.equal(resolved.status, "succeeded", JSON.stringify(resolved));
    if (resolved.status !== "succeeded") return;
    assert.equal(resolved.savedBothPath, ".todo/taskboard — remote.json");
    assert.equal(
      await readFile(configPath, "utf8"),
      taskBoardSource({ ...baseConfig, sections: [{ name: "Research", colorId: "rose" }] }),
    );
    assert.equal(
      await readFile(path.join(repository, ".todo", "taskboard — remote.json"), "utf8"),
      taskBoardSource({ ...baseConfig, taskOrder: ["two.md", "one.md"] }),
    );
    assert.equal((await git(repository, ["diff", "--cached", "--name-only"])).stdout, "");
  });

  it("cancels reconciliation and restores the exact local branch and files", async () => {
    const { emptyHooksDirectory, remote, repository } = await createDivergedNoteRepository("cancel");
    const localHead = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    const remoteHead = (await git(remote, ["rev-parse", "refs/heads/main"])).stdout.trim();

    assert.equal(
      (await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions)).status,
      "succeeded",
    );
    const resolved = await resolveGitConflict(repository, "note.md", "save-both");
    assert.equal(resolved.status, "succeeded");
    assert.equal((await stageGitPaths(repository, ["note — remote.md"])).status, "succeeded");
    const cancelled = await abortGitRemoteReconciliation(repository);
    assert.equal(cancelled.status, "succeeded");
    if (cancelled.status !== "succeeded") return;
    assert.deepEqual(cancelled.changedPaths, [
      { kind: "modified", path: "note.md" },
      { kind: "deleted", path: "note — remote.md" },
    ]);

    assert.equal((await git(repository, ["rev-parse", "HEAD"])).stdout.trim(), localHead);
    assert.equal((await git(remote, ["rev-parse", "refs/heads/main"])).stdout.trim(), remoteHead);
    assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "local version\n");
    await assert.rejects(access(path.join(repository, "note — remote.md")));
    assert.equal((await git(repository, ["status", "--porcelain"])).stdout, "");
    assert.equal(cancelled.snapshot.mergeInProgress, undefined);
  });

  it("prepares non-conflicting divergent notes but still waits for a local commit", async () => {
    const repository = await createTemporaryDirectory();
    const remote = await createBareRemote();
    const emptyHooksDirectory = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "base.md"), "base\n");
    await git(repository, ["add", "--", "base.md"]);
    await git(repository, ["commit", "-m", "Base"]);
    await configureTestRemote(repository, remote, "clean-reconciliation");
    assert.equal((await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");
    const writer = await cloneTestRemote(remote);

    await writeFile(path.join(repository, "local.md"), "local\n");
    await git(repository, ["add", "--", "local.md"]);
    await git(repository, ["commit", "-m", "Local note"]);
    await writeFile(path.join(writer, "remote.md"), "remote\n");
    await git(writer, ["add", "--", "remote.md"]);
    await git(writer, ["commit", "-m", "Remote note"]);
    await git(writer, ["push", "--quiet", "origin", "main"]);
    assert.equal((await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");

    const started = await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(started.status, "succeeded");
    if (started.status !== "succeeded") return;
    assert.equal(started.snapshot.remoteReconciliationInProgress, true);
    assert.equal(
      started.snapshot.changes.some((change) => change.conflicted),
      false,
    );
    assert.equal(
      (await git(repository, ["rev-parse", "HEAD"])).stdout.trim(),
      (await git(repository, ["rev-parse", "ORIG_HEAD"])).stdout.trim(),
    );
    assert.equal(await readFile(path.join(repository, "local.md"), "utf8"), "local\n");
    assert.equal(await readFile(path.join(repository, "remote.md"), "utf8"), "remote\n");
    assert.deepEqual(
      started.snapshot.changes.map((change) => [change.path, change.staged, change.workingTreeChanged]),
      [["remote.md", false, true]],
    );
    assert.equal((await git(repository, ["diff", "--cached", "--name-only"])).stdout, "");
    assert.equal((await commitGitChanges(repository, "Combine separate notes", emptyHooksDirectory)).status, "failed");
    assert.equal((await stageGitPaths(repository, ["remote.md"])).status, "succeeded");
    assert.equal(
      (await commitGitChanges(repository, "Combine separate notes", emptyHooksDirectory)).status,
      "succeeded",
    );
  });

  it("protects ignored local files and rejects remote symlinks during pull", async () => {
    const repository = await createTemporaryDirectory();
    const remote = await createBareRemote();
    const emptyHooksDirectory = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, ".gitignore"), "private/\n");
    await writeFile(path.join(repository, "note.md"), "base\n");
    await git(repository, ["add", "--", ".gitignore", "note.md"]);
    await git(repository, ["commit", "-m", "Base"]);
    await configureTestRemote(repository, remote, "unsafe-incoming");
    assert.equal((await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");
    const writer = await cloneTestRemote(remote);

    await mkdir(path.join(repository, "private"));
    await writeFile(path.join(repository, "private", "local.txt"), "keep local\n");
    await mkdir(path.join(writer, "private"));
    await writeFile(path.join(writer, "private", "local.txt"), "remote replacement\n");
    await git(writer, ["add", "--force", "--", "private/local.txt"]);
    await git(writer, ["commit", "-m", "Add colliding ignored file"]);
    await git(writer, ["push", "--quiet", "origin", "main"]);

    const collision = await pullGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(collision.status, "failed");
    if (collision.status === "failed") assert.match(collision.error, /overwrite.*ignored path/u);
    assert.equal(await readFile(path.join(repository, "private", "local.txt"), "utf8"), "keep local\n");

    await rm(path.join(repository, "private", "local.txt"));
    await symlink("../outside", path.join(writer, "unsafe-link"));
    await git(writer, ["add", "--", "unsafe-link"]);
    await git(writer, ["commit", "-m", "Add symlink"]);
    await git(writer, ["push", "--quiet", "origin", "main"]);
    const symlinkResult = await pullGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(symlinkResult.status, "failed");
    if (symlinkResult.status === "failed") assert.match(symlinkResult.error, /symlinks or submodules/u);
    await assert.rejects(access(path.join(repository, "unsafe-link")));
  });

  it("refuses to publish a surprise branch when the remote already has other history", async () => {
    const remoteOwner = await createTemporaryDirectory();
    const remote = await createBareRemote();
    await initializeRepository(remoteOwner);
    await writeFile(path.join(remoteOwner, "remote.md"), "remote main\n");
    await git(remoteOwner, ["add", "--", "remote.md"]);
    await git(remoteOwner, ["commit", "-m", "Remote main"]);
    await git(remoteOwner, ["remote", "add", "origin", remote]);
    await git(remoteOwner, ["push", "--quiet", "origin", "main"]);

    const repository = await createTemporaryDirectory();
    const emptyHooksDirectory = await createTemporaryDirectory();
    await git(repository, ["init", "-b", "notes"]);
    await git(repository, ["config", "user.name", "Obim Test"]);
    await git(repository, ["config", "user.email", "obim-test@example.invalid"]);
    await writeFile(path.join(repository, "note.md"), "local notes\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Local notes"]);
    await configureTestRemote(repository, remote, "branch-mismatch");

    const checked = await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(checked.status, "succeeded");
    if (checked.status !== "succeeded") return;
    assert.equal(checked.sync.state, "branch-missing");
    const pushed = await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(pushed.status, "failed");
    if (pushed.status === "failed") assert.match(pushed.error, /other branches|unexpected branch/u);
    await assert.rejects(git(remote, ["rev-parse", "refs/heads/notes"]));
  });

  it("refuses to overwrite an independently initialized matching remote branch", async () => {
    const remoteOwner = await createTemporaryDirectory();
    const remote = await createBareRemote();
    await initializeRepository(remoteOwner);
    await writeFile(path.join(remoteOwner, "README.md"), "remote readme\n");
    await git(remoteOwner, ["add", "--", "README.md"]);
    await git(remoteOwner, ["commit", "-m", "Remote initialization"]);
    await git(remoteOwner, ["remote", "add", "origin", remote]);
    await git(remoteOwner, ["push", "--quiet", "origin", "main"]);
    const remoteHead = (await git(remote, ["rev-parse", "refs/heads/main"])).stdout.trim();

    const repository = await createTemporaryDirectory();
    const emptyHooksDirectory = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "note.md"), "local notes\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Local initialization"]);
    await configureTestRemote(repository, remote, "independent-main");

    const checked = await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(checked.status, "succeeded");
    if (checked.status !== "succeeded") return;
    assert.equal(checked.sync.state, "diverged");

    const pushed = await pushGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions);
    assert.equal(pushed.status, "failed");
    if (pushed.status === "failed") assert.match(pushed.error, /diverged|force-push/u);
    assert.equal((await git(remote, ["rev-parse", "refs/heads/main"])).stdout.trim(), remoteHead);
    await assert.rejects(git(remote, ["cat-file", "-e", `${remoteHead}:note.md`]));
  });

  it("returns a useful error when the configured remote cannot be reached", async () => {
    const repository = await createTemporaryDirectory();
    const missingRemote = path.join(await createTemporaryDirectory(), "missing.git");
    await initializeRepository(repository);
    await writeFile(path.join(repository, "note.md"), "note\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Note"]);
    const remoteUrl = "https://obim-test.invalid/missing.git";
    await git(repository, ["config", "--local", `url.${pathToFileURL(missingRemote).href}.insteadOf`, remoteUrl]);
    assert.equal((await setGitRemoteUrl(repository, remoteUrl)).status, "succeeded");

    const checked = await fetchGitRemote(repository, await createTemporaryDirectory(), localRemoteTestOptions);
    assert.equal(checked.status, "failed");
    if (checked.status === "failed") assert.match(checked.error, /not found|access was denied/u);
  });

  it("stages, unstages, and commits workspace changes without changing file contents", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "tracked.md"), "before\n");
    await git(repository, ["add", "--", "tracked.md"]);
    await git(repository, ["commit", "-m", "Initial"]);
    await writeFile(path.join(repository, "tracked.md"), "after\n");
    await writeFile(path.join(repository, "new.md"), "new\n");

    const staged = await stageGitPaths(repository, ["tracked.md", "new.md"]);
    assert.equal(staged.status, "succeeded");
    if (staged.status !== "succeeded") return;
    assert.deepEqual(
      staged.snapshot.changes.map(({ path: filePath, staged: isStaged, workingTreeChanged }) => [
        filePath,
        isStaged,
        workingTreeChanged,
      ]),
      [
        ["new.md", true, false],
        ["tracked.md", true, false],
      ],
    );

    const unstaged = await unstageGitPaths(repository, ["new.md"]);
    assert.equal(unstaged.status, "succeeded");
    if (unstaged.status !== "succeeded") return;
    assert.deepEqual(
      unstaged.snapshot.changes.map(({ path: filePath, staged: isStaged, workingTreeChanged }) => [
        filePath,
        isStaged,
        workingTreeChanged,
      ]),
      [
        ["tracked.md", true, false],
        ["new.md", false, true],
      ],
    );

    assert.equal((await stageGitPaths(repository, ["new.md"])).status, "succeeded");
    const repositoryHook = path.join(repository, ".git", "hooks", "post-commit");
    await writeFile(repositoryHook, "#!/bin/sh\ntouch hook-ran\n");
    await chmod(repositoryHook, 0o755);
    const emptyHooksDirectory = path.join(repository, "empty-hooks");
    await mkdir(emptyHooksDirectory);
    const committed = await commitGitChanges(repository, "Save workspace changes", emptyHooksDirectory);
    assert.equal(committed.status, "succeeded");
    if (committed.status !== "succeeded") return;
    assert.deepEqual(committed.snapshot.changes, []);
    assert.equal((await git(repository, ["log", "-1", "--pretty=%s"])).stdout.trim(), "Save workspace changes");
    assert.equal(await readFile(path.join(repository, "tracked.md"), "utf8"), "after\n");
    await assert.rejects(access(path.join(repository, "hook-ran")));
  });

  it("uses an application identity when Git has no configured author", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "note.md"), "first\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Initial"]);
    await git(repository, ["config", "--unset", "user.name"]);
    await git(repository, ["config", "--unset", "user.email"]);
    await git(repository, ["config", "user.useConfigOnly", "true"]);
    await writeFile(path.join(repository, "note.md"), "second\n");
    assert.equal((await stageGitPaths(repository, ["note.md"])).status, "succeeded");

    const isolatedGlobalConfig = path.join(repository, "isolated-global-git-config");
    await writeFile(isolatedGlobalConfig, "[user]\n\tuseConfigOnly = true\n");
    const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = isolatedGlobalConfig;
    let committed: Awaited<ReturnType<typeof commitGitChanges>>;
    try {
      committed = await commitGitChanges(repository, "Save without configured identity");
    } finally {
      if (previousGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
    }
    assert.equal(committed.status, "succeeded");
    assert.equal((await git(repository, ["log", "-1", "--pretty=%an <%ae>"])).stdout.trim(), "Obim <obim@localhost>");
  });

  it("blocks staging and committing unresolved merge conflicts", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "note.md"), "base\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Base"]);
    await git(repository, ["checkout", "-b", "other"]);
    await writeFile(path.join(repository, "note.md"), "other\n");
    await git(repository, ["commit", "-am", "Other"]);
    await git(repository, ["checkout", "main"]);
    await writeFile(path.join(repository, "note.md"), "main\n");
    await git(repository, ["commit", "-am", "Main"]);
    await assert.rejects(git(repository, ["merge", "other"]));
    const headBefore = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();

    const status = await readGitFileStatus(repository);
    assert.equal(status.snapshot.status, "ready");
    if (status.snapshot.status !== "ready") return;
    assert.deepEqual(
      status.snapshot.changes.map(({ conflicted, kind, path: filePath }) => [filePath, kind, conflicted]),
      [["note.md", "conflicted", true]],
    );
    assert.deepEqual(await stageGitPaths(repository, ["note.md"]), {
      status: "failed",
      error: "Resolve merge conflicts before staging this file.",
    });
    assert.deepEqual(await commitGitChanges(repository, "Do not save markers"), {
      status: "failed",
      error: "Resolve merge conflicts before committing.",
    });
    assert.equal((await git(repository, ["rev-parse", "HEAD"])).stdout.trim(), headBefore);
    assert.match(await readFile(path.join(repository, "note.md"), "utf8"), /<<<<<<< HEAD/u);
  });

  it("reverts tracked staged and working-tree changes without deleting new files", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "tracked.md"), "committed\n");
    await writeFile(path.join(repository, "deleted.md"), "restore me\n");
    await writeFile(path.join(repository, "old name.md"), "rename me\n");
    await git(repository, ["add", "--", "tracked.md", "deleted.md", "old name.md"]);
    await git(repository, ["commit", "-m", "Initial"]);

    await writeFile(path.join(repository, "tracked.md"), "staged\n");
    await git(repository, ["add", "--", "tracked.md"]);
    await writeFile(path.join(repository, "tracked.md"), "working tree\n");
    await rm(path.join(repository, "deleted.md"));
    await git(repository, ["mv", "--", "old name.md", "new name.md"]);

    const reverted = await revertGitPaths(repository, ["tracked.md", "deleted.md", "new name.md"]);
    assert.equal(reverted.status, "succeeded");
    if (reverted.status !== "succeeded") return;
    assert.deepEqual(reverted.snapshot.changes, []);
    assert.equal(await readFile(path.join(repository, "tracked.md"), "utf8"), "committed\n");
    assert.equal(await readFile(path.join(repository, "deleted.md"), "utf8"), "restore me\n");
    assert.equal(await readFile(path.join(repository, "old name.md"), "utf8"), "rename me\n");
    await assert.rejects(access(path.join(repository, "new name.md")));

    await writeFile(path.join(repository, "new.md"), "do not delete\n");
    assert.deepEqual(await revertGitPaths(repository, ["new.md"]), {
      status: "failed",
      error: "New files cannot be reverted because they do not have a committed version.",
    });
    assert.equal(await readFile(path.join(repository, "new.md"), "utf8"), "do not delete\n");
  });
});

describe("Git file history", () => {
  it("follows file renames, paginates, and reads historical content", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "old note.md"), "# First version\n");
    await git(repository, ["add", "--", "old note.md"]);
    await git(repository, ["commit", "-m", "Initial note"]);
    const initialRevision = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();

    await git(repository, ["mv", "--", "old note.md", "note.md"]);
    await git(repository, ["commit", "-m", "Rename note"]);
    await writeFile(path.join(repository, "note.md"), "# Second version\n\nMore detail.\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Automatic checkpoint"]);

    const firstPage = await readGitFileHistory(repository, path.join(repository, "note.md"), undefined, 2);
    assert.equal(firstPage.status, "ready");
    if (firstPage.status !== "ready") return;
    assert.equal(firstPage.entries.length, 2);
    assert.equal(firstPage.entries[0].subject, "Automatic checkpoint");
    assert.deepEqual(firstPage.entries[1], {
      author: "Obim Test",
      changeKind: "renamed",
      committedAt: firstPage.entries[1].committedAt,
      pathAtRevision: "note.md",
      previousPath: "old note.md",
      revisionId: firstPage.entries[1].revisionId,
      restoreToken: firstPage.entries[1].restoreToken,
      subject: "Rename note",
    });
    assert.ok(firstPage.nextCursor);

    const secondPage = await readGitFileHistory(repository, path.join(repository, "note.md"), firstPage.nextCursor, 2);
    assert.equal(secondPage.status, "ready");
    if (secondPage.status !== "ready") return;
    assert.equal(secondPage.entries.length, 1);
    assert.equal(secondPage.entries[0].revisionId, initialRevision);
    assert.equal(secondPage.entries[0].pathAtRevision, "old note.md");
    assert.equal(secondPage.nextCursor, undefined);

    assert.deepEqual(
      await readGitFileRevision(repository, {
        filePath: path.join(repository, "note.md"),
        pathAtRevision: "old note.md",
        revisionId: initialRevision,
        restoreToken: secondPage.entries[0].restoreToken,
      }),
      {
        status: "ready",
        content: "# First version\n",
        revisionId: initialRevision,
        sizeBytes: 16,
      },
    );
  });

  it("restores a historical note atomically as a local change", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);
    const notePath = path.join(repository, "note.md");
    await writeFile(notePath, "one\ntwo\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "First version"]);
    const revisionId = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(notePath, "one\nchanged\nthree\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "Second version"]);
    const history = await readGitFileHistory(repository, notePath);
    assert.equal(history.status, "ready");
    if (history.status !== "ready") return;
    const firstVersion = history.entries.find((entry) => entry.revisionId === revisionId);
    assert.ok(firstVersion);

    const restored = await restoreGitFileRevision(repository, {
      expectedVersion: toWorkspaceFileVersion(await lstat(notePath)),
      filePath: notePath,
      pathAtRevision: "note.md",
      revisionId,
      restoreToken: firstVersion.restoreToken,
    });
    assert.equal(restored.status, "succeeded");
    assert.equal(await readFile(notePath, "utf8"), "one\ntwo\n");
    if (restored.status === "succeeded") {
      assert.ok(restored.recoveryPath);
      assert.equal(await readFile(restored.recoveryPath!, "utf8"), "one\nchanged\nthree\n");
    }
    assert.equal((await git(repository, ["status", "--porcelain", "--", "note.md"])).stdout.trim(), "M note.md");
  });

  it("rejects stale restore versions", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);
    const notePath = path.join(repository, "note.md");
    await writeFile(notePath, "before\n");
    await git(repository, ["add", "--", "note.md"]);
    await git(repository, ["commit", "-m", "First version"]);
    const revisionId = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    const staleVersion = toWorkspaceFileVersion(await lstat(notePath));
    await writeFile(notePath, "changed externally\n");
    const history = await readGitFileHistory(repository, notePath);
    assert.equal(history.status, "ready");
    if (history.status !== "ready") return;

    assert.deepEqual(
      await restoreGitFileRevision(repository, {
        expectedVersion: staleVersion,
        filePath: notePath,
        pathAtRevision: "note.md",
        revisionId,
        restoreToken: history.entries[0].restoreToken,
      }),
      {
        status: "failed",
        error: "The file changed before it could be restored.",
        errorCode: "conflict",
      },
    );
  });

  it("rejects a history capability reused to read or restore another file", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);
    const firstPath = path.join(repository, "first.md");
    await writeFile(firstPath, "first secret\n");
    await writeFile(path.join(repository, "second.md"), "second secret\n");
    await git(repository, ["add", "--", "first.md", "second.md"]);
    await git(repository, ["commit", "-m", "Initial"]);
    const firstHistory = await readGitFileHistory(repository, firstPath);
    assert.equal(firstHistory.status, "ready");
    if (firstHistory.status !== "ready") return;
    const entry = firstHistory.entries[0];
    const forgedRequest = {
      filePath: firstPath,
      pathAtRevision: "second.md",
      revisionId: entry.revisionId,
      restoreToken: entry.restoreToken,
    };

    const preview = await readGitFileRevision(repository, forgedRequest);
    assert.equal(preview.status, "failed");
    if (preview.status === "failed") assert.match(preview.error, /no longer valid/u);
    const restored = await restoreGitFileRevision(repository, {
      ...forgedRequest,
      expectedVersion: toWorkspaceFileVersion(await lstat(firstPath)),
    });
    assert.equal(restored.status, "failed");
    assert.equal(await readFile(firstPath, "utf8"), "first secret\n");
  });
});

describe("literal Git filenames (G01)", () => {
  it.each(["note[ab].md", "wild*.md", ":(glob)*.md", "-option.md", "spaced żółw.md", "question?.md"])(
    "stages, unstages, reverts and reads history only for the literal filename %s",
    async (selectedName) => {
      const repository = await createTemporaryDirectory();
      await initializeRepository(repository);
      const names = [
        "note[ab].md",
        "notea.md",
        "noteb.md",
        "wild*.md",
        "wild-neighbor.md",
        ":(glob)*.md",
        "-option.md",
        "spaced żółw.md",
        "question?.md",
        "questionx.md",
      ];
      for (const name of names) await writeFile(path.join(repository, name), `original ${name}\n`);
      await git(repository, ["--literal-pathspecs", "add", "--", ...names]);
      await git(repository, ["commit", "-m", "Original files"]);
      for (const name of names) await writeFile(path.join(repository, name), `edited ${name}\n`);
      {
        const name = selectedName;
        const staged = await stageGitPaths(repository, [name]);
        assert.equal(staged.status, "succeeded", JSON.stringify(staged));
        assert.equal((await git(repository, ["diff", "--cached", "--name-only", "-z"])).stdout, `${name}\0`);
        assert.equal((await unstageGitPaths(repository, [name])).status, "succeeded");
        assert.equal((await git(repository, ["diff", "--cached", "--name-only", "-z"])).stdout, "");
        assert.equal((await revertGitPaths(repository, [name])).status, "succeeded");
        assert.equal(await readFile(path.join(repository, name), "utf8"), `original ${name}\n`);
        const history = await readGitFileHistory(repository, name);
        assert.equal(history.status, "ready");
        assert.equal(history.entries.length, 1);
        assert.equal(history.entries[0]?.pathAtRevision, name);
      }
      for (const name of names.filter((name) => name !== selectedName)) {
        assert.equal(await readFile(path.join(repository, name), "utf8"), `edited ${name}\n`);
      }
    },
  );
});

describe("Git execution preflight (G02)", () => {
  it("blocks included clean-filter commands before automatic status and history", async () => {
    const repository = await createTemporaryDirectory();
    await initializeRepository(repository);
    await writeFile(path.join(repository, "note.md"), "before\n");
    await writeFile(path.join(repository, ".gitattributes"), "*.md filter=marker\n");
    await git(repository, ["add", "--all"]);
    await git(repository, ["commit", "-m", "Initial"]);
    const marker = path.join(repository, "executed-marker");
    const included = path.join(repository, ".git", "included-config");
    await writeFile(included, `[filter "marker"]\n clean = "touch '${marker}'; cat"\n`);
    await git(repository, ["config", "--local", "include.path", included]);
    await writeFile(path.join(repository, "note.md"), "edited\n");
    for (let refresh = 0; refresh < 2; refresh += 1) {
      const status = await readGitFileStatus(repository);
      await assert.rejects(access(marker), { code: "ENOENT" });
      assert.equal(status.snapshot.status, "unavailable");
      assert.match("error" in status.snapshot ? status.snapshot.error : "", /executable Git/);
      const history = await readGitFileHistory(repository, "note.md");
      assert.equal(history.status, "unavailable");
      await assert.rejects(access(marker), { code: "ENOENT" });
    }
    assert.equal((await stageGitPaths(repository, ["note.md"])).status, "failed");
    await assert.rejects(access(marker), { code: "ENOENT" });
  });
});

it("suppresses inherited Git command options and repository hooks on ordinary file operations", async () => {
  const repository = await createTemporaryDirectory();
  await initializeRepository(repository);
  await writeFile(path.join(repository, "note.md"), "before\n");
  await writeFile(path.join(repository, ".gitattributes"), "*.md filter=marker\n");
  await git(repository, ["add", "--all"]);
  await git(repository, ["commit", "-m", "Initial"]);
  const marker = path.join(repository, "executed-marker");
  const hook = path.join(repository, ".git", "hooks", "post-index-change");
  await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`);
  await chmod(hook, 0o755);
  await writeFile(path.join(repository, "note.md"), "edited\n");
  const injected = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "filter.marker.clean",
    GIT_CONFIG_VALUE_0: `touch '${marker}'; cat`,
    GIT_EXTERNAL_DIFF: `touch '${marker}'`,
    GIT_GLOB_PATHSPECS: "1",
  };
  const previous = Object.fromEntries(Object.keys(injected).map((key) => [key, process.env[key]]));
  Object.assign(process.env, injected);
  try {
    assert.equal((await readGitFileStatus(repository)).snapshot.status, "ready");
    assert.equal((await readGitFileHistory(repository, "note.md")).status, "ready");
    assert.equal((await stageGitPaths(repository, ["note.md"])).status, "succeeded");
    await assert.rejects(access(marker), { code: "ENOENT" });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

it("rejects included diff commands at the shared execution boundary", async () => {
  const repository = await createTemporaryDirectory();
  await initializeRepository(repository);
  await writeFile(path.join(repository, "note.md"), "before\n");
  await git(repository, ["add", "--all"]);
  await git(repository, ["commit", "-m", "Initial"]);
  const marker = path.join(repository, "executed-marker");
  await git(repository, ["config", "diff.external", `touch '${marker}'`]);
  const { runGit } = await import("../src/main/git-command");
  await assert.rejects(runGit(repository, ["diff", "HEAD", "--", "note.md"]), /executable Git/);
  await assert.rejects(access(marker), { code: "ENOENT" });
});

it("cancels chosen remote content and all non-conflicting additions/deletions back to the clean local baseline (G04)", async () => {
  const { emptyHooksDirectory, repository, writer } = await createDivergedNoteRepository("cancel-full-baseline", {
    "deleted-remotely.md": "local retained\n",
    "nonconflicting.md": "local nonconflicting\n",
  });
  await writeFile(path.join(writer, "nonconflicting.md"), "remote nonconflicting\n");
  await rm(path.join(writer, "deleted-remotely.md"));
  await writeFile(path.join(writer, "remote-added.md"), "remote addition\n");
  await git(writer, ["add", "--all"]);
  await git(writer, ["commit", "-m", "Remote addition and deletion"]);
  await git(writer, ["push", "--quiet", "origin", "main"]);
  assert.equal((await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");
  const originalIndex = (await git(repository, ["ls-files", "--stage", "-z"])).stdout;
  const originalHead = (await git(repository, ["rev-parse", "HEAD"])).stdout;
  assert.equal(
    (await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions)).status,
    "succeeded",
  );
  assert.equal((await resolveGitConflict(repository, "note.md", "use-remote")).status, "succeeded");
  const cancelled = await abortGitRemoteReconciliation(repository);
  assert.equal(cancelled.status, "succeeded", JSON.stringify(cancelled));
  assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "local version\n");
  assert.equal(await readFile(path.join(repository, "deleted-remotely.md"), "utf8"), "local retained\n");
  assert.equal(await readFile(path.join(repository, "nonconflicting.md"), "utf8"), "local nonconflicting\n");
  await assert.rejects(access(path.join(repository, "remote-added.md")), { code: "ENOENT" });
  assert.equal((await git(repository, ["ls-files", "--stage", "-z"])).stdout, originalIndex);
  assert.equal((await git(repository, ["rev-parse", "HEAD"])).stdout, originalHead);
  assert.equal((await git(repository, ["status", "--porcelain"])).stdout, "");
});

it("retains the recorded baseline when a new deletion pauses cancellation, then retries without losing the newer edit", async () => {
  const { emptyHooksDirectory, repository } = await createDivergedNoteRepository("cancel-deletion-retry");
  assert.equal(
    (await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions)).status,
    "succeeded",
  );
  await rm(path.join(repository, "note.md"));
  const paused = await abortGitRemoteReconciliation(repository);
  assert.equal(paused.status, "failed");
  if (paused.status === "failed") assert.match(paused.error, /note.md was deleted during reconciliation/);
  await assert.rejects(access(path.join(repository, "note.md")), { code: "ENOENT" });
  assert.equal((await readGitFileStatus(repository)).snapshot.status, "ready");
  const statePath = path.join(repository, ".git", "OBIM_RECONCILIATION_STATE");
  const baseline = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(baseline.localHead, (await git(repository, ["rev-parse", "HEAD"])).stdout.trim());
  await writeFile(path.join(repository, "note.md"), "newer restored edit\n");
  const retried = await abortGitRemoteReconciliation(repository);
  assert.equal(retried.status, "succeeded", JSON.stringify(retried));
  assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "local version\n");
  assert.equal(await readFile(path.join(repository, "note — reconciliation edit.md"), "utf8"), "newer restored edit\n");
  await assert.rejects(access(statePath), { code: "ENOENT" });
});

it("retains a partially cancelled session when Git refuses index restoration and can retry", async () => {
  const { emptyHooksDirectory, repository } = await createDivergedNoteRepository("cancel-index-retry");
  assert.equal(
    (await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions)).status,
    "succeeded",
  );
  assert.equal((await resolveGitConflict(repository, "note.md", "use-remote")).status, "succeeded");
  const lockPath = path.join(repository, ".git", "index.lock");
  await writeFile(lockPath, "held by test\n", { flag: "wx" });
  const failed = await abortGitRemoteReconciliation(repository);
  assert.equal(failed.status, "failed");
  assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "remote version\n");
  const statePath = path.join(repository, ".git", "OBIM_RECONCILIATION_STATE");
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).cancelling, true);
  await rm(lockPath);
  const retried = await abortGitRemoteReconciliation(repository);
  assert.equal(retried.status, "succeeded", JSON.stringify(retried));
  assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "local version\n");
  assert.equal((await git(repository, ["status", "--porcelain"])).stdout, "");
});

it("scopes conflict resolution to a literal bracketed path", async () => {
  const { emptyHooksDirectory, repository, writer } = await createDivergedNoteRepository("literal-conflict", {
    "file[ab].md": "base\n",
    "filea.md": "base\n",
  });
  for (const name of ["file[ab].md", "filea.md"]) {
    await writeFile(path.join(repository, name), `local ${name}\n`);
    await writeFile(path.join(writer, name), `remote ${name}\n`);
  }
  await git(repository, ["commit", "-am", "Local bracketed edits"]);
  await git(writer, ["commit", "-am", "Remote bracketed edits"]);
  await git(writer, ["push", "--quiet", "origin", "main"]);
  assert.equal((await fetchGitRemote(repository, emptyHooksDirectory, localRemoteTestOptions)).status, "succeeded");
  assert.equal(
    (await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions)).status,
    "succeeded",
  );
  const neighborBefore = await readFile(path.join(repository, "filea.md"), "utf8");
  const resolved = await resolveGitConflict(repository, "file[ab].md", "use-remote");
  assert.equal(resolved.status, "succeeded", JSON.stringify(resolved));
  assert.equal(await readFile(path.join(repository, "file[ab].md"), "utf8"), "remote file[ab].md\n");
  assert.equal(await readFile(path.join(repository, "filea.md"), "utf8"), neighborBefore);
  if (resolved.status === "succeeded")
    assert.equal(resolved.snapshot.changes.find((change) => change.path === "filea.md")?.conflicted, true);
  assert.equal((await abortGitRemoteReconciliation(repository)).status, "succeeded");
  assert.equal(await readFile(path.join(repository, "file[ab].md"), "utf8"), "local file[ab].md\n");
});

it("restores the exact clean working-tree bytes and file mode across Git newline conversion", async () => {
  const { emptyHooksDirectory, repository } = await createDivergedNoteRepository("cancel-crlf");
  await git(repository, ["config", "core.autocrlf", "true"]);
  await rm(path.join(repository, "note.md"));
  await git(repository, ["checkout", "--", "note.md"]);
  await chmod(path.join(repository, "note.md"), 0o640);
  const baseline = await readFile(path.join(repository, "note.md"));
  assert.equal(baseline.toString("utf8"), "local version\r\n");
  assert.equal((await git(repository, ["status", "--porcelain"])).stdout, "");
  assert.equal(
    (await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions)).status,
    "succeeded",
  );
  assert.equal((await resolveGitConflict(repository, "note.md", "use-remote")).status, "succeeded");
  const cancelled = await abortGitRemoteReconciliation(repository);
  assert.equal(cancelled.status, "succeeded", JSON.stringify(cancelled));
  assert.deepEqual(await readFile(path.join(repository, "note.md")), baseline);
  assert.equal((await lstat(path.join(repository, "note.md"))).mode & 0o777, 0o640);
});

it("retains a preparation baseline when an index lock prevents both merge and rollback", async () => {
  const { emptyHooksDirectory, repository } = await createDivergedNoteRepository("prepare-index-retry");
  const lockPath = path.join(repository, ".git", "index.lock");
  await writeFile(lockPath, "held by test\n", { flag: "wx" });
  const failed = await beginGitRemoteReconciliation(repository, emptyHooksDirectory, localRemoteTestOptions);
  assert.equal(failed.status, "failed");
  if (failed.status === "failed") assert.match(failed.error, /baseline was retained/);
  await access(path.join(repository, ".git", "OBIM_RECONCILIATION_STATE"));
  await rm(lockPath);
  const retried = await abortGitRemoteReconciliation(repository);
  assert.equal(retried.status, "succeeded", JSON.stringify(retried));
  assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "local version\n");
  assert.equal((await git(repository, ["status", "--porcelain"])).stdout, "");
});

it("validates automatic-sync destination before creating any local commit", async () => {
  const repository = await createTemporaryDirectory();
  await initializeRepository(repository);
  await writeFile(path.join(repository, "draft.md"), "still local\n");
  const result = await autoSyncGitRemote(repository, "keep-local");
  assert.equal(result.status, "failed");
  await assert.rejects(git(repository, ["rev-parse", "--verify", "HEAD"]));
  assert.equal((await git(repository, ["ls-files", "--stage"])).stdout, "");
  assert.equal(await readFile(path.join(repository, "draft.md"), "utf8"), "still local\n");
});

it("keeps a local save during fetch and refuses to apply a stale pull", async () => {
  const { emptyHooksDirectory, repository, writer } = await createDivergedNoteRepository("delayed-pull");
  // Make the local branch match the remote, then create one newer remote version.
  await git(repository, ["reset", "--hard", "refs/remotes/origin/main"]);
  await writeFile(path.join(writer, "note.md"), "remote next\n");
  await git(writer, ["commit", "-am", "Remote next"]);
  await git(writer, ["push", "--quiet", "origin", "main"]);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { queueWorkspaceMutation } = await import("../src/main/workspace-mutations");
  const pulling = pullGitRemote(repository, emptyHooksDirectory, {
    ...localRemoteTestOptions,
    runLocal: queueWorkspaceMutation,
    beforeNetworkForTests: async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  });
  await pending;
  await queueWorkspaceMutation(() => writeFile(path.join(repository, "note.md"), "saved while remote waits\n"));
  release();
  const result = await pulling;
  assert.equal(result.status, "failed");
  assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "saved while remote waits\n");
});

it("pushes only its captured commit while later changes remain local", async () => {
  const repository = await createTemporaryDirectory();
  const remote = await createBareRemote();
  const emptyHooksDirectory = await createTemporaryDirectory();
  await initializeRepository(repository);
  await writeFile(path.join(repository, "note.md"), "captured\n");
  await git(repository, ["add", "--all"]);
  await git(repository, ["commit", "-m", "Captured"]);
  const captured = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  await configureTestRemote(repository, remote, "captured-push");
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pushing = pushGitRemote(repository, emptyHooksDirectory, {
    ...localRemoteTestOptions,
    beforeNetworkForTests: async (phase) => {
      if (phase === "push") {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    },
  });
  await pending;
  await writeFile(path.join(repository, "note.md"), "later committed edit\n");
  await git(repository, ["commit", "-am", "Later local commit"]);
  release();
  const result = await pushing;
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  assert.equal(result.uploadedRevision, captured);
  assert.equal((await git(remote, ["rev-parse", "refs/heads/main"])).stdout.trim(), captured);
  assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "later committed edit\n");
  if (result.status === "succeeded") assert.equal(result.sync.state, "ahead");
});

it("cancels an owned Git process promptly", async () => {
  const repository = await createTemporaryDirectory();
  await initializeRepository(repository);
  const { runGit } = await import("../src/main/git-command");
  const controller = new AbortController();
  const started = Date.now();
  const command = runGit(repository, ["-c", "alias.obim-wait=!sleep 30", "obim-wait"], { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 100);
  await assert.rejects(command, /cancelled/);
  clearTimeout(timer);
  assert.ok(Date.now() - started < 2_000);
});

it.each(["head", "branch"])("refuses a pull when the local %s changes during fetch", async (change) => {
  const { emptyHooksDirectory, repository } = await createDivergedNoteRepository(`changed-${change}`);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pulling = pullGitRemote(repository, emptyHooksDirectory, {
    ...localRemoteTestOptions,
    beforeNetworkForTests: async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  });
  await pending;
  if (change === "head") await git(repository, ["commit", "--allow-empty", "-m", "New local history"]);
  else await git(repository, ["switch", "-c", "another-local-branch"]);
  const head = (await git(repository, ["rev-parse", "HEAD"])).stdout;
  release();
  const result = await pulling;
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.match(result.error, /history or destination changed/);
  assert.equal((await git(repository, ["rev-parse", "HEAD"])).stdout, head);
  assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "local version\n");
});

it("never uploads an automatic commit to a destination replaced while the push waits", async () => {
  const repository = await createTemporaryDirectory();
  const remote = await createBareRemote();
  const replacement = await createBareRemote();
  await initializeRepository(repository);
  await writeFile(path.join(repository, "note.md"), "local automatic content\n");
  await configureTestRemote(repository, remote, "original-consent");
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const syncing = autoSyncGitRemote(repository, "keep-local", undefined, {
    ...localRemoteTestOptions,
    beforeNetworkForTests: async (phase) => {
      if (phase !== "push") return;
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  });
  await pending;
  await configureTestRemote(repository, replacement, "replacement-consent");
  release();
  const result = await syncing;
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.match(result.error, /destination changed/);
  assert.equal(result.localCommitCreated, true);
  await assert.rejects(git(remote, ["rev-parse", "--verify", "refs/heads/main"]));
  await assert.rejects(git(replacement, ["rev-parse", "--verify", "refs/heads/main"]));
  assert.equal(await readFile(path.join(repository, "note.md"), "utf8"), "local automatic content\n");
});
