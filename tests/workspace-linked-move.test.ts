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

  it("renames PDF references without rewriting the PDF bytes or its annotation fragment", async () => {
    const passage = "#page=3&selection=0,2,1,9&color=blue";
    const root = await workspace({
      "Papers/Old.pdf": "",
      "Notes/source.md": `[Original label](../Papers/Old.pdf${passage})`,
      "root.md": `[Original label](Papers/Old.pdf${passage})\n\n\`[example](Papers/Old.pdf${passage})\``,
    });
    const bytes = new Uint8Array([37, 80, 68, 70, 0, 255, 128]);
    await writeFile(path.join(root, "Papers/Old.pdf"), bytes);
    const result = await moveWorkspaceItemWithLinks(
      root,
      path.join(root, "Papers/Old.pdf"),
      path.join(root, "Papers/Final report.pdf"),
    );
    expect(await readFile(path.join(root, "Papers/Final report.pdf"))).toEqual(Buffer.from(bytes));
    expect(await readFile(path.join(root, "Notes/source.md"), "utf8")).toBe(
      `[Original label](../Papers/Final%20report.pdf${passage})`,
    );
    expect(await readFile(path.join(root, "root.md"), "utf8")).toBe(
      `[Original label](Papers/Final%20report.pdf${passage})\n\n\`[example](Papers/Old.pdf${passage})\``,
    );
    expect(result?.updatedLinkCount).toBe(2);
    expect(result?.linkUpdates.map((update) => update.path)).toEqual([
      path.join(root, "Notes/source.md"),
      path.join(root, "root.md"),
    ]);
    expect(result?.linkMove?.afterPaths).toContain("Papers/Final report.pdf");
  });

  it("repairs relative PDF links when a note moves while retaining workspace-root links", async () => {
    const passage = "#page=2&selection=1,0,1,8&color=green";
    const root = await workspace({
      "Papers/report.pdf": "PDF bytes",
      "Notes/source.md": `[Relative](../Papers/report.pdf${passage}) [Root](Papers/report.pdf${passage})`,
    });
    await mkdir(path.join(root, "Archive/Deep"), { recursive: true });
    await moveWorkspaceItemWithLinks(
      root,
      path.join(root, "Notes/source.md"),
      path.join(root, "Archive/Deep/source.md"),
    );
    expect(await readFile(path.join(root, "Archive/Deep/source.md"), "utf8")).toBe(
      `[Relative](../../Papers/report.pdf${passage}) [Root](Papers/report.pdf${passage})`,
    );
    expect(await readFile(path.join(root, "Papers/report.pdf"), "utf8")).toBe("PDF bytes");
  });

  it("moves notes and PDFs together in a folder while preserving their relative references", async () => {
    const root = await workspace({
      "Old/report.pdf": "PDF bytes",
      "Old/sub/source.md": "[Local](../report.pdf#page=1) [Root](Old/report.pdf#page=1) [[source]]",
      "outside.md": "[PDF](Old/report.pdf#page=1&selection=0,0,0,5) [[Old/sub/source]]",
    });
    await mkdir(path.join(root, "Archive"));
    await moveWorkspaceItemWithLinks(root, path.join(root, "Old"), path.join(root, "Archive/New"));
    expect(await readFile(path.join(root, "Archive/New/sub/source.md"), "utf8")).toBe(
      "[Local](../report.pdf#page=1) [Root](Archive/New/report.pdf#page=1) [[source]]",
    );
    expect(await readFile(path.join(root, "outside.md"), "utf8")).toBe(
      "[PDF](Archive/New/report.pdf#page=1&selection=0,0,0,5) [[Archive/New/sub/source]]",
    );
  });

  it("uses the numbered PDF destination when moving into a folder with the same filename", async () => {
    const root = await workspace({
      "A/report.pdf": "moving PDF",
      "B/report.pdf": "existing PDF",
      "source.md": "[Moving](A/report.pdf#page=1) [Existing](B/report.pdf#page=2)",
    });
    await moveWorkspaceItemWithLinks(root, path.join(root, "A/report.pdf"), path.join(root, "B/report.pdf"), true);
    expect(await readFile(path.join(root, "source.md"), "utf8")).toBe(
      "[Moving](B/report%201.pdf#page=1) [Existing](B/report.pdf#page=2)",
    );
    expect(await readFile(path.join(root, "B/report.pdf"), "utf8")).toBe("existing PDF");
    expect(await readFile(path.join(root, "B/report 1.pdf"), "utf8")).toBe("moving PDF");
  });

  it("restores a PDF and rewritten references when a later note write fails", async () => {
    const reference = "[Passage](Old.pdf#page=1&selection=0,0,0,5&color=red)";
    const root = await workspace({ "Old.pdf": "PDF bytes", "a.md": reference, "b.md": reference });
    state.failWrite = 2;
    await expect(
      moveWorkspaceItemWithLinks(root, path.join(root, "Old.pdf"), path.join(root, "New.pdf")),
    ).rejects.toBeInstanceOf(RestoredLinkMoveError);
    expect(await readFile(path.join(root, "Old.pdf"), "utf8")).toBe("PDF bytes");
    await expect(access(path.join(root, "New.pdf"))).rejects.toThrow();
    expect(await readFile(path.join(root, "a.md"), "utf8")).toBe(reference);
    expect(await readFile(path.join(root, "b.md"), "utf8")).toBe(reference);
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
