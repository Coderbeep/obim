import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const race = vi.hoisted(() => ({
  afterStage: undefined as undefined | (() => Promise<void>),
  linksUnsupported: false,
  injectChild: false,
}));
vi.mock("fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("fs/promises")>();
  return {
    ...fs,
    link: async (...args: Parameters<typeof fs.link>) => {
      if (race.linksUnsupported) throw Object.assign(new Error("links unavailable"), { code: "ENOTSUP" });
      if (race.injectChild && String(args[1]).endsWith("child.md"))
        await fs.writeFile(args[1], "external", { flag: "wx" });
      return fs.link(...args);
    },
    cp: async (...args: Parameters<typeof fs.cp>) => {
      await fs.cp(...args);
      if (String(args[1]).includes(".obim-import-")) await race.afterStage?.();
    },
  };
});
import { importExternalFiles } from "../src/main/file-import";
const roots: string[] = [];
afterEach(async () => {
  race.afterStage = undefined;
  race.linksUnsupported = false;
  race.injectChild = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps exclusive creation when hard links are unsupported", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "obim-import-fallback-"));
  roots.push(root);
  const destination = path.join(root, "destination");
  await mkdir(destination);
  await writeFile(path.join(destination, "Note.md"), "existing");
  await writeFile(path.join(destination, "Note 1.md"), "also existing");
  race.linksUnsupported = true;
  const result = await importExternalFiles(
    [{ kind: "buffer", name: "Note.md", content: Buffer.from("imported") }],
    destination,
  );
  expect(result.errors).toEqual([]);
  expect(await readFile(path.join(destination, "Note.md"), "utf8")).toBe("existing");
  expect(await readFile(path.join(destination, "Note 1.md"), "utf8")).toBe("also existing");
  expect(await readFile(path.join(destination, "Note 2.md"), "utf8")).toBe("imported");
});

it("reports failure and preserves an external child during directory publication", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "obim-import-child-"));
  roots.push(root);
  const source = path.join(root, "bundle");
  const destination = path.join(root, "destination");
  await mkdir(source);
  await mkdir(destination);
  await writeFile(path.join(source, "child.md"), "source");
  race.injectChild = true;
  const result = await importExternalFiles([{ kind: "path", path: source }], destination);
  expect(result.importedPaths).toEqual([]);
  expect(result.errors[0]).toContain("externally changed entries were preserved");
  expect(await readFile(path.join(destination, "bundle", "child.md"), "utf8")).toBe("external");
  expect(await readFile(path.join(source, "child.md"), "utf8")).toBe("source");
});

it.each(["file", "folder"])("F03 preserves an external %s created after staging", async (kind) => {
  const root = await mkdtemp(path.join(tmpdir(), "obim-import-race-"));
  roots.push(root);
  const source = path.join(root, "source", "Note");
  const destination = path.join(root, "destination");
  const desired = path.join(destination, "Note");
  await mkdir(path.dirname(source));
  await mkdir(destination);
  if (kind === "folder") {
    await mkdir(source);
    await writeFile(path.join(source, "child.md"), "imported");
  } else await writeFile(source, "imported");
  race.afterStage = async () => {
    if (kind === "folder") await mkdir(desired);
    else await writeFile(desired, "external");
  };
  const result = await importExternalFiles([{ kind: "path", path: source }], destination);
  expect(result.errors).toEqual([]);
  expect(result.importedPaths).toEqual([`${desired} 1`]);
  if (kind === "folder") {
    expect(await readdir(desired)).toEqual([]);
    expect(await readFile(path.join(result.importedPaths[0], "child.md"), "utf8")).toBe("imported");
  } else {
    expect(await readFile(desired, "utf8")).toBe("external");
    expect(await readFile(result.importedPaths[0], "utf8")).toBe("imported");
  }
  expect((await readdir(destination)).some((name) => name.startsWith(".obim-import-"))).toBe(false);
});
