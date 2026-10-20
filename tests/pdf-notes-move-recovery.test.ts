import { afterEach, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({
  writes: 0,
  failWrite: 0,
  externalWrite: "",
  linkAction: undefined as undefined | ((source: string, destination: string) => Promise<void>),
  unlinkAction: undefined as undefined | ((source: string) => Promise<void>),
}));
vi.mock("fs/promises", async (original) => {
  const fs = await original<typeof import("fs/promises")>();
  return {
    ...fs,
    link: async (source: string, destination: string) => {
      await state.linkAction?.(source, destination);
      return fs.link(source, destination);
    },
    unlink: async (source: string) => {
      await state.unlinkAction?.(source);
      return fs.unlink(source);
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]).includes(".obim-write-")) {
        state.writes++;
        if (state.writes === state.failWrite) {
          if (state.externalWrite) await fs.writeFile(state.externalWrite, "external edits");
          throw new Error("simulated write failure");
        }
      }
      return fs.open(...args);
    },
  };
});
import { getExplorerSnapshot, movePdfWithNotes } from "../src/main/explorer-pdf-notes";
const roots: string[] = [];
afterEach(async () => {
  state.writes = 0;
  state.failWrite = 0;
  state.externalWrite = "";
  state.linkAction = undefined;
  state.unlinkAction = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const workspace = async (withNotes = true) => {
  const root = await mkdtemp(path.join(tmpdir(), "obim-pdf-recovery-"));
  roots.push(root);
  await writeFile(path.join(root, "Paper.pdf"), "pdf bytes");
  if (withNotes) {
    await mkdir(path.join(root, "Paper.pdf.notes"));
    await writeFile(path.join(root, "Paper.pdf.notes/Summary.md"), "[PDF](../Paper.pdf#page=2)");
  }
  await writeFile(path.join(root, "a.md"), "[PDF](Paper.pdf#page=1)");
  await writeFile(path.join(root, "b.md"), "[PDF](Paper.pdf#page=1)");
  return root;
};
const move = (root: string) =>
  movePdfWithNotes(root, {
    pdfPath: path.join(root, "Paper.pdf"),
    destinationDirectoryPath: root,
    newFilename: "New.pdf",
  });

it("restores both roots and earlier link writes when a later rewrite fails", async () => {
  const root = await workspace();
  state.failWrite = 2;
  const result = await move(root);
  expect(result).toMatchObject({ success: false, error: "simulated write failure", linkUpdates: expect.any(Array) });
  expect(await readFile(path.join(root, "Paper.pdf"), "utf8")).toBe("pdf bytes");
  expect(await readFile(path.join(root, "Paper.pdf.notes/Summary.md"), "utf8")).toBe("[PDF](../Paper.pdf#page=2)");
  expect(await readFile(path.join(root, "a.md"), "utf8")).toBe("[PDF](Paper.pdf#page=1)");
  expect(await readdir(root)).not.toContain("New.pdf");
  expect((await getExplorerSnapshot(root)).revision).toBe(result.revision);
});

it("preserves external note edits that prevent complete link rollback and reports affected paths", async () => {
  const root = await workspace();
  state.failWrite = 3;
  state.externalWrite = path.join(root, "a.md");
  const result = await move(root);
  expect(result).toMatchObject({
    success: false,
    errorCode: "partial",
    recoveryPaths: expect.arrayContaining([
      {
        source: path.join(root, "a.md"),
        destination: path.join(root, "a.md"),
        sourceExists: true,
        destinationExists: true,
      },
    ]),
  });
  expect(await readFile(state.externalWrite, "utf8")).toBe("external edits");
  expect(await readFile(path.join(root, "Paper.pdf"), "utf8")).toBe("pdf bytes");
});

it("never overwrites a destination appearing after preflight", async () => {
  const root = await workspace();
  state.linkAction = async (_source, destination) => {
    state.linkAction = undefined;
    await writeFile(destination, "external destination", { flag: "wx" });
  };
  expect(await move(root)).toMatchObject({ success: false, errorCode: "conflict" });
  expect(await readFile(path.join(root, "Paper.pdf"), "utf8")).toBe("pdf bytes");
  expect(await readFile(path.join(root, "New.pdf"), "utf8")).toBe("external destination");
  expect(await readFile(path.join(root, "Paper.pdf.notes/Summary.md"), "utf8")).toBe("[PDF](../Paper.pdf#page=2)");
});

it("preserves a racing companion folder and rolls back the already published PDF", async () => {
  const root = await workspace();
  state.linkAction = async () => {
    state.linkAction = undefined;
    await mkdir(path.join(root, "New.pdf.notes"));
    await writeFile(path.join(root, "New.pdf.notes/external.md"), "external");
  };
  expect(await move(root)).toMatchObject({ success: false, errorCode: "conflict" });
  expect(await readFile(path.join(root, "New.pdf.notes/external.md"), "utf8")).toBe("external");
  expect(await readdir(root)).not.toContain("New.pdf");
  expect(await readFile(path.join(root, "Paper.pdf"), "utf8")).toBe("pdf bytes");
});

it("reserves the absent companion and restores the PDF if an external writer populates it", async () => {
  const root = await workspace(false);
  state.linkAction = async () => {
    state.linkAction = undefined;
    await writeFile(path.join(root, "New.pdf.notes/external.md"), "external");
  };
  expect(await move(root)).toMatchObject({ success: false, errorCode: "partial" });
  expect(await readFile(path.join(root, "New.pdf.notes/external.md"), "utf8")).toBe("external");
  expect(await readdir(root)).not.toContain("New.pdf");
  expect(await readFile(path.join(root, "Paper.pdf"), "utf8")).toBe("pdf bytes");
});

it("fails safely on filesystems without exclusive hard links", async () => {
  const root = await workspace();
  state.linkAction = async () => {
    throw Object.assign(new Error("Cross-device links unavailable"), { code: "EXDEV" });
  };
  expect(await move(root)).toMatchObject({ success: false, error: "Cross-device links unavailable" });
  expect(await readdir(root)).not.toContain("New.pdf");
  expect(await readFile(path.join(root, "Paper.pdf"), "utf8")).toBe("pdf bytes");
});

it("restores sources after a later unlink fails", async () => {
  const root = await workspace();
  let calls = 0;
  state.unlinkAction = async () => {
    if (++calls === 2) throw new Error("unlink failure");
  };
  expect(await move(root)).toMatchObject({ success: false, error: "unlink failure" });
  expect(await readFile(path.join(root, "Paper.pdf"), "utf8")).toBe("pdf bytes");
  expect(await readFile(path.join(root, "Paper.pdf.notes/Summary.md"), "utf8")).toBe("[PDF](../Paper.pdf#page=2)");
  expect(await readdir(root)).not.toContain("New.pdf");
});

it("preserves both an externally occupied source and original data when rollback cannot restore a source", async () => {
  const root = await workspace();
  let calls = 0;
  state.unlinkAction = async () => {
    if (++calls === 2) {
      await writeFile(path.join(root, "Paper.pdf"), "external replacement", { flag: "wx" });
      throw new Error("unlink failure");
    }
  };
  expect(await move(root)).toMatchObject({
    success: false,
    errorCode: "partial",
    recoveryPaths: expect.arrayContaining([
      {
        source: path.join(root, "Paper.pdf"),
        destination: path.join(root, "New.pdf"),
        sourceExists: true,
        destinationExists: true,
      },
    ]),
  });
  expect(await readFile(path.join(root, "Paper.pdf"), "utf8")).toBe("external replacement");
  expect(await readFile(path.join(root, "New.pdf"), "utf8")).toBe("pdf bytes");
});

it("retains external source edits detected after publication", async () => {
  const root = await workspace();
  state.linkAction = async (source) => {
    if (source.endsWith("Summary.md")) {
      state.linkAction = undefined;
      await writeFile(source, "external source edit");
    }
  };
  expect(await move(root)).toMatchObject({ success: false, error: "A move source changed externally." });
  expect(await readFile(path.join(root, "Paper.pdf.notes/Summary.md"), "utf8")).toBe("external source edit");
  await expect(access(path.join(root, "New.pdf"))).rejects.toThrow();
});

it("retains original bytes if a published destination is replaced before source removal", async () => {
  const root = await workspace();
  state.linkAction = async (source) => {
    if (source.endsWith("Summary.md")) {
      state.linkAction = undefined;
      await rm(path.join(root, "New.pdf"));
      await writeFile(path.join(root, "New.pdf"), "external destination replacement");
    }
  };
  expect(await move(root)).toMatchObject({ success: false, errorCode: "partial" });
  expect(await readFile(path.join(root, "Paper.pdf"), "utf8")).toBe("pdf bytes");
  expect(await readFile(path.join(root, "New.pdf"), "utf8")).toBe("external destination replacement");
  expect(await readFile(path.join(root, "Paper.pdf.notes/Summary.md"), "utf8")).toBe("[PDF](../Paper.pdf#page=2)");
});

it("restores actual directory spelling after a failed case-only grouped rename", async () => {
  const root = await workspace();
  state.failWrite = 2;
  expect(
    await movePdfWithNotes(root, {
      pdfPath: path.join(root, "Paper.pdf"),
      destinationDirectoryPath: root,
      newFilename: "paper.pdf",
    }),
  ).toMatchObject({ success: false, error: "simulated write failure" });
  const entries = await readdir(root);
  expect(entries).toContain("Paper.pdf");
  expect(entries).toContain("Paper.pdf.notes");
  expect(entries).not.toContain("paper.pdf");
  expect(await readFile(path.join(root, "Paper.pdf.notes/Summary.md"), "utf8")).toBe("[PDF](../Paper.pdf#page=2)");
});
