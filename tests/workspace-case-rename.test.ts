import { afterEach, expect, it } from "vitest";
import { link, lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { moveWorkspaceItem } from "../src/main/workspace-mutations";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const fixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "obim-case-rename-"));
  roots.push(root);
  return root;
};

it.each(["file", "folder"])("F07 updates the directory spelling of a %s", async (kind) => {
  const root = await fixture();
  const source = path.join(root, kind === "file" ? "Note.md" : "Notes");
  const destination = path.join(root, kind === "file" ? "note.md" : "notes");
  if (kind === "folder") {
    await mkdir(source);
    await writeFile(path.join(source, "child.md"), "draft");
  } else await writeFile(source, "draft");
  expect(await moveWorkspaceItem(source, destination)).toBe(true);
  expect(await readdir(root)).toEqual([path.basename(destination)]);
  expect(await readFile(kind === "file" ? destination : path.join(destination, "child.md"), "utf8")).toBe("draft");
});

it("rejects distinct hard-link directory entries even when inode identity matches", async () => {
  const root = await fixture();
  const source = path.join(root, "Note.md");
  const destination = path.join(root, "Other.md");
  await writeFile(source, "draft");
  await link(source, destination);
  expect((await lstat(source)).ino).toBe((await lstat(destination)).ino);
  expect(await moveWorkspaceItem(source, destination)).toBe(false);
  expect((await readdir(root)).sort()).toEqual(["Note.md", "Other.md"]);
});
