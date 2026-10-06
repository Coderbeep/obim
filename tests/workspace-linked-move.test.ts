import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const state = vi.hoisted(() => ({ failWrite: 0, writes: 0, externalPath: "" }));
vi.mock("fs/promises", async (original) => {
  const fs = await original<typeof import("fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]).includes(".obim-write-")) {
        state.writes++;
        if (state.writes === state.failWrite) throw new Error("simulated write failure");
        if (state.writes === 2 && state.externalPath) await fs.writeFile(state.externalPath, "external edits");
      }
      return fs.open(...args);
    },
  };
});
import { moveWorkspaceItemWithLinks, RestoredLinkMoveError } from "../src/main/workspace-linked-move";
const roots: string[] = [];
afterEach(async () => {
  state.failWrite = 0;
  state.writes = 0;
  state.externalPath = "";
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const workspace = async (files: Record<string, string>) => {
  const root = await mkdtemp(path.join(tmpdir(), "obim-link-move-"));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
  }
  return root;
};
describe("workspace moves with link updates", () => {
  it("updates incoming links, the moved note's self-links, and persisted versions", async () => {
    const root = await workspace({
      "Old.md": "[[Old]]",
      "source.md": "[[Old#Heading|Alias]] [Old](Old.md)",
      ".obim/ignored.md": "[[Old]]",
    });
    const result = await moveWorkspaceItemWithLinks(root, path.join(root, "Old.md"), path.join(root, "New.md"));
    expect(await readFile(path.join(root, "New.md"), "utf8")).toBe("[[New]]");
    expect(await readFile(path.join(root, "source.md"), "utf8")).toBe("[[New#Heading|Alias]] [Old](New.md)");
    expect(await readFile(path.join(root, ".obim/ignored.md"), "utf8")).toBe("[[Old]]");
    expect(result?.linkUpdates).toHaveLength(2);
    expect(result?.updatedLinkCount).toBe(3);
    expect(result?.linkMove).toEqual({ beforePaths: ["Old.md", "source.md"], afterPaths: ["New.md", "source.md"] });
    expect(result?.linkUpdates[0].version.sizeBytes).toBeGreaterThan(0);
  });
  it("updates folder-qualified and outgoing relative links when a directory moves", async () => {
    const root = await workspace({
      "Old/sub/Note.md": "[Other](../../Other.md)",
      "Other.md": "[[Old/sub/Note]] [[Note]]",
    });
    await mkdir(path.join(root, "Archive"));
    await moveWorkspaceItemWithLinks(root, path.join(root, "Old"), path.join(root, "Archive/New"));
    expect(await readFile(path.join(root, "Other.md"), "utf8")).toBe("[[Archive/New/sub/Note]] [[Note]]");
    expect(await readFile(path.join(root, "Archive/New/sub/Note.md"), "utf8")).toBe("[Other](../../../Other.md)");
  });
  it("uses the actual numbered destination after a collision", async () => {
    const root = await workspace({ "A/Note.md": "", "B/Note.md": "existing", "source.md": "[[A/Note]]" });
    const result = await moveWorkspaceItemWithLinks(
      root,
      path.join(root, "A/Note.md"),
      path.join(root, "B/Note.md"),
      true,
    );
    expect(result?.output).toBe(path.join(root, "B/Note 1.md"));
    expect(await readFile(path.join(root, "source.md"), "utf8")).toBe("[[B/Note 1]]");
    expect(await readFile(path.join(root, "B/Note.md"), "utf8")).toBe("existing");
  });
  it("rejects occupied rename destinations without changing notes", async () => {
    const root = await workspace({ "Old.md": "old", "New.md": "new", "source.md": "[[Old]]" });
    expect(await moveWorkspaceItemWithLinks(root, path.join(root, "Old.md"), path.join(root, "New.md"))).toBeNull();
    expect(await readFile(path.join(root, "source.md"), "utf8")).toBe("[[Old]]");
  });
  it("rolls back the move and already written links if a later write fails", async () => {
    const root = await workspace({ "Old.md": "", "a.md": "[[Old]]", "b.md": "[[Old]]" });
    state.failWrite = 2;
    const failure = await moveWorkspaceItemWithLinks(root, path.join(root, "Old.md"), path.join(root, "New.md")).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RestoredLinkMoveError);
    expect((failure as RestoredLinkMoveError).message).toBe("simulated write failure");
    expect((failure as RestoredLinkMoveError).linkUpdates).toMatchObject([
      { path: path.join(root, "a.md"), content: "[[Old]]", previousContent: "[[Old]]" },
    ]);
    expect(await readFile(path.join(root, "a.md"), "utf8")).toBe("[[Old]]");
    expect(await readFile(path.join(root, "b.md"), "utf8")).toBe("[[Old]]");
    await access(path.join(root, "Old.md"));
    await expect(access(path.join(root, "New.md"))).rejects.toThrow();
  });
  it("preserves external edits discovered during a link write and rolls back earlier changes", async () => {
    const root = await workspace({ "Old.md": "", "a.md": "[[Old]]", "b.md": "[[Old]]" });
    state.externalPath = path.join(root, "b.md");
    await expect(
      moveWorkspaceItemWithLinks(root, path.join(root, "Old.md"), path.join(root, "New.md")),
    ).rejects.toThrow("changed on disk");
    expect(await readFile(path.join(root, "a.md"), "utf8")).toBe("[[Old]]");
    expect(await readFile(path.join(root, "b.md"), "utf8")).toBe("external edits");
    await access(path.join(root, "Old.md"));
  });
});
