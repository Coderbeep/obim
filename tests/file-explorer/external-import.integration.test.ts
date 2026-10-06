import { test } from "vitest";

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { importExternalFiles } from "../../src/main/file-import";

const pathSource = (sourcePath: string) => ({ kind: "path" as const, path: sourcePath });

const withTemporaryDirectory = async (run: (rootPath: string) => Promise<void>) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "obim-file-explorer-import-"));
  try {
    await run(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
};

test("concurrent same-name imports keep both source files", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const destination = path.join(rootPath, "notes");
    const firstSource = path.join(rootPath, "first", "report.md");
    const secondSource = path.join(rootPath, "second", "report.md");
    await Promise.all([
      mkdir(path.dirname(firstSource), { recursive: true }),
      mkdir(path.dirname(secondSource), { recursive: true }),
      mkdir(destination),
    ]);
    await Promise.all([writeFile(firstSource, "first"), writeFile(secondSource, "second")]);

    const [firstResult, secondResult] = await Promise.all([
      importExternalFiles([pathSource(firstSource)], destination),
      importExternalFiles([pathSource(secondSource)], destination),
    ]);
    const importedPaths = [...firstResult.importedPaths, ...secondResult.importedPaths];

    assert.equal(importedPaths.length, 2);
    assert.equal(new Set(importedPaths).size, 2);
    assert.deepEqual(
      new Set(await Promise.all(importedPaths.map((item) => readFile(item, "utf8")))),
      new Set(["first", "second"]),
    );
  });
});

test("invalid import sources do not prevent independently valid sources from importing", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const destination = path.join(rootPath, "notes");
    const source = path.join(rootPath, "outside", "valid.md");
    await Promise.all([mkdir(destination), mkdir(path.dirname(source), { recursive: true })]);
    await writeFile(source, "valid");

    const result = await importExternalFiles([pathSource("relative.md"), pathSource(source)], destination);

    assert.deepEqual(result.importedPaths, [path.join(destination, "valid.md")]);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /must be absolute/);
  });
});
