import { afterEach, test, vi } from "vitest";

import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const fsMockState = vi.hoisted(() => ({ failAtomicWrite: false }));

vi.mock("fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (!fsMockState.failAtomicWrite || !String(args[0]).includes(".obim-write-")) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === "writeFile") return async () => Promise.reject(new Error("simulated atomic write failure"));
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import {
  createWorkspaceFile,
  createWorkspaceFileUniquely,
  getWorkspaceSnapshot,
  moveWorkspaceItem,
  moveWorkspaceItemUniquely,
  overwriteWorkspaceFile,
  overwriteWorkspaceFileIfVersion,
  trashWorkspaceItem,
  upsertWorkspaceFile,
} from "../src/main/workspace-mutations";
import { readWorkspaceTextFile } from "../src/main/workspace-files";

afterEach(() => {
  fsMockState.failAtomicWrite = false;
});

const withTemporaryDirectory = async (run: (rootPath: string) => Promise<void>) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "obim-workspace-mutations-"));
  try {
    await run(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
};

test("concurrent moves cannot overwrite an existing destination", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const firstSource = path.join(rootPath, "first", "note.md");
    const secondSource = path.join(rootPath, "second", "note.md");
    const destination = path.join(rootPath, "archive", "note.md");
    await Promise.all([
      mkdir(path.dirname(firstSource), { recursive: true }),
      mkdir(path.dirname(secondSource), { recursive: true }),
      mkdir(path.dirname(destination), { recursive: true }),
    ]);
    await Promise.all([writeFile(firstSource, "first"), writeFile(secondSource, "second")]);

    assert.deepEqual(
      await Promise.all([moveWorkspaceItem(firstSource, destination), moveWorkspaceItem(secondSource, destination)]),
      [true, false],
    );
    assert.equal(await readFile(destination, "utf8"), "first");
    assert.equal(await readFile(secondSource, "utf8"), "second");
  });
});

test("colliding moves receive consecutive numbered names without overwriting", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const firstSource = path.join(rootPath, "first", "Note.md");
    const secondSource = path.join(rootPath, "second", "Note.md");
    const destinationDirectory = path.join(rootPath, "Tasks");
    const desiredDestination = path.join(destinationDirectory, "Note.md");
    await Promise.all([
      mkdir(path.dirname(firstSource), { recursive: true }),
      mkdir(path.dirname(secondSource), { recursive: true }),
      mkdir(destinationDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(firstSource, "first"),
      writeFile(secondSource, "second"),
      writeFile(desiredDestination, "existing"),
    ]);

    const movedPaths = await Promise.all([
      moveWorkspaceItemUniquely(firstSource, desiredDestination),
      moveWorkspaceItemUniquely(secondSource, desiredDestination),
    ]);

    assert.deepEqual(movedPaths, [
      path.join(destinationDirectory, "Note 1.md"),
      path.join(destinationDirectory, "Note 2.md"),
    ]);
    assert.equal(await readFile(desiredDestination, "utf8"), "existing");
    assert.equal(await readFile(movedPaths[0], "utf8"), "first");
    assert.equal(await readFile(movedPaths[1], "utf8"), "second");
  });
});

test("directory move collisions use the same numbered naming", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const source = path.join(rootPath, "source", "Note");
    const destinationDirectory = path.join(rootPath, "Tasks");
    const desiredDestination = path.join(destinationDirectory, "Note");
    await Promise.all([mkdir(source, { recursive: true }), mkdir(desiredDestination, { recursive: true })]);
    await writeFile(path.join(source, "child.md"), "content");

    const movedPath = await moveWorkspaceItemUniquely(source, desiredDestination);

    assert.equal(movedPath, path.join(destinationDirectory, "Note 1"));
    assert.equal(await readFile(path.join(movedPath, "child.md"), "utf8"), "content");
  });
});

test("a colliding name that already ends in a number gets another numbered suffix", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const source = path.join(rootPath, "attachments", "Untitled 1.md");
    const destinationDirectory = path.join(rootPath, "Tasks");
    const desiredDestination = path.join(destinationDirectory, "Untitled 1.md");
    await Promise.all([
      mkdir(path.dirname(source), { recursive: true }),
      mkdir(destinationDirectory, { recursive: true }),
    ]);
    await Promise.all([writeFile(source, "moved"), writeFile(desiredDestination, "existing")]);

    const movedPath = await moveWorkspaceItemUniquely(source, desiredDestination);

    assert.equal(movedPath, path.join(destinationDirectory, "Untitled 1 1.md"));
    assert.equal(await readFile(movedPath, "utf8"), "moved");
    assert.equal(await readFile(desiredDestination, "utf8"), "existing");
  });
});

test("concurrent creates cannot overwrite an existing file", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const destination = path.join(rootPath, "note.md");

    assert.deepEqual(
      await Promise.all([createWorkspaceFile(destination, "first"), createWorkspaceFile(destination, "second")]),
      [true, false],
    );
    assert.equal(await readFile(destination, "utf8"), "first");
  });
});

test("unique binary creates preserve existing files and choose a numbered PDF name", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const desiredPath = path.join(rootPath, "Papers", "Example.pdf");
    await mkdir(path.dirname(desiredPath), { recursive: true });
    await writeFile(desiredPath, new Uint8Array([1, 2, 3]));

    const createdPath = await createWorkspaceFileUniquely(desiredPath, new Uint8Array([4, 5, 6]));

    assert.equal(createdPath, path.join(rootPath, "Papers", "Example 1.pdf"));
    assert.deepEqual(await readFile(desiredPath), Buffer.from([1, 2, 3]));
    assert.deepEqual(await readFile(createdPath), Buffer.from([4, 5, 6]));
  });
});

test("a stale save cannot recreate a path after it was moved", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const source = path.join(rootPath, "note.md");
    const destination = path.join(rootPath, "archive.md");
    await writeFile(source, "before");

    assert.equal(await moveWorkspaceItem(source, destination), true);
    assert.equal(await overwriteWorkspaceFile(source, "stale edit"), false);
    assert.equal(await readFile(destination, "utf8"), "before");
  });
});

test("overwriting an existing file replaces old trailing content", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const filePath = path.join(rootPath, "note.md");
    await writeFile(filePath, "long previous content");
    if (process.platform !== "win32") await chmod(filePath, 0o640);

    assert.equal(await overwriteWorkspaceFile(filePath, "short"), true);
    assert.equal(await readFile(filePath, "utf8"), "short");
    if (process.platform !== "win32") assert.equal((await stat(filePath)).mode & 0o777, 0o640);
  });
});

test("a conditional save publishes content and returns the replacement version", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const filePath = path.join(rootPath, "note.md");
    await writeFile(filePath, "original");
    const opened = await readWorkspaceTextFile(filePath);

    const result = await overwriteWorkspaceFileIfVersion(filePath, "updated content", opened.version);

    assert.equal(result.success, true);
    assert.equal(await readFile(filePath, "utf8"), "updated content");
    if (result.success) {
      assert.notDeepEqual(result.version, opened.version);
      assert.deepEqual((await readWorkspaceTextFile(filePath)).version, result.version);
    }
  });
});

test("a conditional save rejects an externally changed file without overwriting it", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const filePath = path.join(rootPath, "note.md");
    await writeFile(filePath, "original");
    const opened = await readWorkspaceTextFile(filePath);
    await writeFile(filePath, "external replacement");

    const result = await overwriteWorkspaceFileIfVersion(filePath, "stale editor draft", opened.version);

    assert.deepEqual(result, {
      success: false,
      error: "File changed on disk before it could be saved",
      errorCode: "conflict",
    });
    assert.equal(await readFile(filePath, "utf8"), "external replacement");
  });
});

test("a conditional save detects an mtime-only external change", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const filePath = path.join(rootPath, "note.md");
    await writeFile(filePath, "same size");
    const opened = await readWorkspaceTextFile(filePath);
    const changedTime = new Date(opened.version.mtimeMs + 60_000);
    await utimes(filePath, changedTime, changedTime);

    const result = await overwriteWorkspaceFileIfVersion(filePath, "new value", opened.version);

    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.errorCode, "conflict");
    assert.equal(await readFile(filePath, "utf8"), "same size");
  });
});

test("a failed atomic replacement preserves the original and removes its temporary file", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const filePath = path.join(rootPath, "note.md");
    await writeFile(filePath, "original content");
    fsMockState.failAtomicWrite = true;

    await assert.rejects(overwriteWorkspaceFile(filePath, "replacement content"), /simulated atomic write failure/);

    assert.equal(await readFile(filePath, "utf8"), "original content");
    assert.deepEqual(
      (await readdir(rootPath)).filter((filename) => filename.startsWith(".obim-write-")),
      [],
    );
  });
});

test("metadata upserts publish complete content without leaving a temporary file", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const filePath = path.join(rootPath, ".obim", "task-board.json");
    const content = JSON.stringify({ sections: ["Todo", "Done"], version: 1 });

    assert.equal(await upsertWorkspaceFile(filePath, content), true);
    assert.equal(await readFile(filePath, "utf8"), content);
    assert.deepEqual(
      (await readdir(path.dirname(filePath))).filter((filename) => filename.startsWith(".obim-write-")),
      [],
    );
  });
});

test("an identical metadata upsert is write-free", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const filePath = path.join(rootPath, ".obim", "bookmarks.json");
    const content = `${JSON.stringify({ items: [] })}\n`;
    await upsertWorkspaceFile(filePath, content);
    const first = await stat(filePath);

    await upsertWorkspaceFile(filePath, content);
    const second = await stat(filePath);

    assert.equal(second.ino, first.ino);
    assert.equal(second.mtimeMs, first.mtimeMs);
    assert.equal(await readFile(filePath, "utf8"), content);
  });
});

test("workspace snapshots carry the revision of preceding mutations", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const before = await getWorkspaceSnapshot(async () => [] as string[]);
    await createWorkspaceFile(path.join(rootPath, "note.md"), "content");
    const after = await getWorkspaceSnapshot(async () => ["note.md"]);

    assert.ok(after.revision > before.revision);
    assert.deepEqual(after.value, ["note.md"]);
  });
});

test("trash delegates to the operating-system operation and propagates refusal", async () => {
  const calls: string[] = [];
  await trashWorkspaceItem("/notes/task.md", async (filePath) => {
    calls.push(filePath);
  });
  assert.deepEqual(calls, ["/notes/task.md"]);

  await assert.rejects(
    trashWorkspaceItem("/notes/refused.md", async () => {
      throw new Error("Trash unavailable");
    }),
    /Trash unavailable/,
  );
});
