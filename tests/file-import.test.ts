import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { importExternalFiles } from "../src/main/file-import";

const pathSource = (sourcePath: string) => ({ kind: "path" as const, path: sourcePath });

const withTemporaryDirectory = async (run: (rootPath: string) => Promise<void>) => {
  const rootPath = await mkdtemp(path.join(tmpdir(), "obim-file-import-"));
  try {
    await run(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
};

test("imports without overwriting an existing file", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const sourceDirectory = path.join(rootPath, "outside");
    const destinationDirectory = path.join(rootPath, "notes");
    const sourcePath = path.join(sourceDirectory, "report.pdf");
    await mkdir(sourceDirectory);
    await mkdir(destinationDirectory);
    await writeFile(sourcePath, "new report");
    await writeFile(path.join(destinationDirectory, "report.pdf"), "existing report");

    const result = await importExternalFiles([pathSource(sourcePath)], destinationDirectory);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.importedPaths, [path.join(destinationDirectory, "report 1.pdf")]);
    assert.equal(await readFile(path.join(destinationDirectory, "report.pdf"), "utf-8"), "existing report");
    assert.equal(await readFile(result.importedPaths[0], "utf-8"), "new report");
  });
});

test("imports every independently dropped file", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const sourceDirectory = path.join(rootPath, "outside");
    const destinationDirectory = path.join(rootPath, "notes");
    const firstSourcePath = path.join(sourceDirectory, "first.txt");
    const secondSourcePath = path.join(sourceDirectory, "second.txt");
    await mkdir(sourceDirectory);
    await mkdir(destinationDirectory);
    await writeFile(firstSourcePath, "first");
    await writeFile(secondSourcePath, "second");

    const result = await importExternalFiles(
      [pathSource(firstSourcePath), pathSource(secondSourcePath)],
      destinationDirectory,
    );

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.importedPaths, [
      path.join(destinationDirectory, "first.txt"),
      path.join(destinationDirectory, "second.txt"),
    ]);
    assert.equal(await readFile(result.importedPaths[0], "utf-8"), "first");
    assert.equal(await readFile(result.importedPaths[1], "utf-8"), "second");
  });
});

test("imports a directory once when both it and a child are dropped", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const sourceDirectory = path.join(rootPath, "outside", "bundle");
    const nestedDirectory = path.join(sourceDirectory, "nested");
    const destinationDirectory = path.join(rootPath, "notes");
    const nestedFile = path.join(nestedDirectory, "data.json");
    await mkdir(nestedDirectory, { recursive: true });
    await mkdir(destinationDirectory);
    await writeFile(nestedFile, "{}");

    const result = await importExternalFiles(
      [pathSource(sourceDirectory), pathSource(nestedFile)],
      destinationDirectory,
    );

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.importedPaths, [path.join(destinationDirectory, "bundle")]);
    assert.equal(await readFile(path.join(destinationDirectory, "bundle", "nested", "data.json"), "utf-8"), "{}");
  });
});

test("ignores Finder metadata from path, directory, and clipboard imports", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const sourceRoot = path.join(rootPath, "outside");
    const sourceDirectory = path.join(sourceRoot, "bundle");
    const destinationDirectory = path.join(rootPath, "notes");
    const directMetadataPath = path.join(sourceRoot, ".DS_Store");
    await mkdir(sourceDirectory, { recursive: true });
    await mkdir(destinationDirectory);
    await Promise.all([
      writeFile(directMetadataPath, "root metadata"),
      writeFile(path.join(sourceDirectory, ".DS_Store"), "nested metadata"),
      writeFile(path.join(sourceDirectory, "note.md"), "# Note\n"),
    ]);

    const result = await importExternalFiles(
      [
        pathSource(sourceDirectory),
        pathSource(directMetadataPath),
        { kind: "buffer", name: ".DS_Store", content: Uint8Array.from([1, 2, 3]) },
      ],
      destinationDirectory,
    );

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.importedPaths, [path.join(destinationDirectory, "bundle")]);
    assert.deepEqual(await readdir(result.importedPaths[0]), ["note.md"]);
  });
});

test("continues importing valid files when a symbolic link is included", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const sourceDirectory = path.join(rootPath, "outside");
    const destinationDirectory = path.join(rootPath, "notes");
    const sourcePath = path.join(sourceDirectory, "note.txt");
    const symlinkPath = path.join(sourceDirectory, "note-link.txt");
    await mkdir(sourceDirectory);
    await mkdir(destinationDirectory);
    await writeFile(sourcePath, "note");
    await symlink(sourcePath, symlinkPath);

    const result = await importExternalFiles([pathSource(sourcePath), pathSource(symlinkPath)], destinationDirectory);

    assert.deepEqual(result.importedPaths, [path.join(destinationDirectory, "note.txt")]);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Symbolic links cannot be imported/);
  });
});

test("rejects importing a folder into one of its own descendants", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const sourceDirectory = path.join(rootPath, "outside");
    const destinationDirectory = path.join(sourceDirectory, "notes");
    await mkdir(destinationDirectory, { recursive: true });

    const result = await importExternalFiles([pathSource(sourceDirectory)], destinationDirectory);

    assert.deepEqual(result.importedPaths, []);
    assert.deepEqual(result.errors, ["outside: a folder cannot be imported into itself."]);
  });
});

test("imports buffered clipboard files byte-for-byte with collision-safe names", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const destinationDirectory = path.join(rootPath, "notes");
    const content = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    await mkdir(destinationDirectory);
    await writeFile(path.join(destinationDirectory, "clipboard.png"), "existing");

    const result = await importExternalFiles(
      [{ kind: "buffer", name: "clipboard.png", content }],
      destinationDirectory,
    );

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.importedPaths, [path.join(destinationDirectory, "clipboard 1.png")]);
    assert.deepEqual(await readFile(result.importedPaths[0]), Buffer.from(content));
    assert.equal(await readFile(path.join(destinationDirectory, "clipboard.png"), "utf8"), "existing");
  });
});

test("continues a mixed path and buffered import when another buffer name is invalid", async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const destinationDirectory = path.join(rootPath, "notes");
    const sourcePath = path.join(rootPath, "outside", "note.md");
    await mkdir(destinationDirectory);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "note");

    const result = await importExternalFiles(
      [
        pathSource(sourcePath),
        { kind: "buffer", name: "image.png", content: Uint8Array.from([1, 2, 3]) },
        { kind: "buffer", name: "", content: Uint8Array.from([4]) },
      ],
      destinationDirectory,
    );

    assert.deepEqual(result.importedPaths, [
      path.join(destinationDirectory, "note.md"),
      path.join(destinationDirectory, "image.png"),
    ]);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Filename is not portable/);
  });
});
