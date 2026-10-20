import { afterEach, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  attachPdfNote,
  createPdfNote,
  getExplorerSnapshot,
  importPdfNotes,
  movePdfWithNotes,
} from "../src/main/explorer-pdf-notes";
import { getPdfNotesGroups } from "../src/shared/explorer-pdf-notes";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const workspace = async (files: Record<string, string>) => {
  const root = await mkdtemp(path.join(tmpdir(), "obim-pdf-notes-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
};

it("pairs exact sibling names while retaining physical paths, arbitrary contents and PDF leaves", async () => {
  const root = await workspace({
    "Paper.PDF": "PDF bytes",
    "Paper.PDF.notes/Summary.md": "text",
    "Paper.PDF.notes/assets/figure.png": "image",
    "Paper.PDF.notes/Inner.pdf": "nested",
    "Paper.PDF.notes/Inner.pdf.notes/Questions.markdown": "nested note",
    "Paper/other.md": "ordinary folder",
  });
  const before = await readdir(root);
  const snapshot = await getExplorerSnapshot(root);
  expect(snapshot.pdfNotesGroups).toHaveLength(2);
  expect(snapshot.pdfNotesGroups).toContainEqual({
    pdfPath: path.join(root, "Paper.PDF"),
    notesDirectoryPath: path.join(root, "Paper.PDF.notes"),
    childPaths: expect.arrayContaining([
      path.join(root, "Paper.PDF.notes/Summary.md"),
      path.join(root, "Paper.PDF.notes/assets"),
    ]),
  });
  const pdf = snapshot.items.find((item) => item.path === path.join(root, "Paper.PDF"));
  expect(pdf).toMatchObject({ isDirectory: false, mimeType: "application/pdf" });
  expect(pdf).not.toHaveProperty("children");
  expect(await readdir(root)).toEqual(before);
  expect(await readFile(path.join(root, "Paper.PDF"), "utf8")).toBe("PDF bytes");
});

it("rebuilds groups from a copied folder and exposes orphan companions after external PDF moves", async () => {
  const root = await workspace({ "Paper.pdf": "pdf", "Paper.pdf.notes/Summary.md": "note" });
  const copy = await workspace({});
  await cp(root, copy, { recursive: true });
  expect((await getExplorerSnapshot(copy)).pdfNotesGroups).toHaveLength(1);
  await rename(path.join(root, "Paper.pdf"), path.join(root, "Moved.pdf"));
  const orphan = await getExplorerSnapshot(root);
  expect(orphan.pdfNotesGroups).toHaveLength(0);
  expect(orphan.items.find((item) => item.path === path.join(root, "Paper.pdf.notes"))?.isDirectory).toBe(true);
  await rename(path.join(root, "Moved.pdf"), path.join(root, "Paper.pdf"));
  expect((await getExplorerSnapshot(root)).pdfNotesGroups).toHaveLength(1);
});

it("keeps empty companions, unpaired PDFs, occupied files and symlinks independent", async () => {
  const root = await workspace({ "Empty.pdf": "pdf", "Leaf.pdf": "pdf", "File.pdf": "pdf", "File.pdf.notes": "file" });
  await mkdir(path.join(root, "Empty.pdf.notes"));
  await symlink(path.join(root, "Empty.pdf.notes"), path.join(root, "Leaf.pdf.notes"));
  const snapshot = await getExplorerSnapshot(root);
  expect(snapshot.pdfNotesGroups).toEqual([
    { pdfPath: path.join(root, "Empty.pdf"), notesDirectoryPath: path.join(root, "Empty.pdf.notes"), childPaths: [] },
  ]);
  const empty = snapshot.items.find((item) => item.path === path.join(root, "Empty.pdf"))!;
  expect(getPdfNotesGroups([...snapshot.items, empty])).toEqual([]);
});

it("creates plain Markdown lazily without changing PDFs and rejects invalid or duplicate names", async () => {
  const root = await workspace({ "Paper.pdf": "pdf bytes" });
  const request = {
    pdfPath: path.join(root, "Paper.pdf"),
    filename: "Summary.md",
    content: "# Notes\n\n[PDF](../Paper.pdf#page=2)",
  };
  const result = await createPdfNote(root, request);
  expect(result).toMatchObject({
    success: true,
    file: {
      path: path.join(root, "Paper.pdf.notes/Summary.md"),
      isDirectory: false,
      version: { sizeBytes: Buffer.byteLength(request.content) },
    },
  });
  expect(await readFile(path.join(root, "Paper.pdf.notes/Summary.md"), "utf8")).toBe(request.content);
  expect(await readFile(request.pdfPath, "utf8")).toBe("pdf bytes");
  expect(await createPdfNote(root, { ...request, content: "replacement" })).toMatchObject({
    success: false,
    errorCode: "conflict",
  });
  for (const filename of ["../bad.md", "bad.txt", "CON.md", "a/b.md"]) {
    expect(await createPdfNote(root, { ...request, filename })).toMatchObject({ success: false });
  }
  expect((await getExplorerSnapshot(root)).revision).toBeGreaterThan(result.revision);
});

it("attaches with normal relative-link repair, numbers collisions, and supports ordinary detachment", async () => {
  const root = await workspace({
    "Paper.pdf": "pdf",
    "Notes/Summary.md": "[PDF](../Paper.pdf#page=3)",
    "outside.md": "[[Notes/Summary]]",
  });
  const first = await attachPdfNote(root, {
    pdfPath: path.join(root, "Paper.pdf"),
    notePath: path.join(root, "Notes/Summary.md"),
  });
  expect(first).toMatchObject({ success: true, output: path.join(root, "Paper.pdf.notes/Summary.md") });
  expect(await readFile(path.join(root, "outside.md"), "utf8")).toBe("[[Paper.pdf.notes/Summary]]");
  expect(await readFile(path.join(root, "Paper.pdf.notes/Summary.md"), "utf8")).toBe("[PDF](../Paper.pdf#page=3)");
  await writeFile(path.join(root, "Notes/Summary.md"), "another");
  expect(
    await attachPdfNote(root, { pdfPath: path.join(root, "Paper.pdf"), notePath: path.join(root, "Notes/Summary.md") }),
  ).toMatchObject({ success: true, output: path.join(root, "Paper.pdf.notes/Summary 1.md") });
  const { moveWorkspaceItemWithLinks } = await import("../src/main/workspace-linked-move");
  await moveWorkspaceItemWithLinks(root, path.join(root, "Paper.pdf.notes/Summary.md"), path.join(root, "Detached.md"));
  expect(await readFile(path.join(root, "outside.md"), "utf8")).toBe("[[Detached]]");
  expect((await getExplorerSnapshot(root)).pdfNotesGroups[0].childPaths).toEqual([
    path.join(root, "Paper.pdf.notes/Summary 1.md"),
  ]);
});

it("moves both roots with one combined mapping, including nested notes, assets and PDF fragments", async () => {
  const fragment = "#page=2&selection=0,0,0,5&color=blue";
  const root = await workspace({
    "Paper.pdf": "PDF untouched",
    "Paper.pdf.notes/Summary.md": `[PDF](../Paper.pdf${fragment}) [Other](../Other.md)`,
    "Paper.pdf.notes/sub/Questions.markdown": "[[Paper.pdf.notes/Summary]]",
    "Paper.pdf.notes/assets/image.png": "asset",
    "Other.md": "[[Paper.pdf.notes/Summary]] [PDF](Paper.pdf#page=1)",
  });
  await mkdir(path.join(root, "Archive"));
  const result = await movePdfWithNotes(root, {
    pdfPath: path.join(root, "Paper.pdf"),
    destinationDirectoryPath: path.join(root, "Archive"),
    newFilename: "New.pdf",
  });
  expect(result).toMatchObject({
    success: true,
    movedRoots: [
      { source: path.join(root, "Paper.pdf"), destination: path.join(root, "Archive/New.pdf") },
      { source: path.join(root, "Paper.pdf.notes"), destination: path.join(root, "Archive/New.pdf.notes") },
    ],
  });
  expect(await readFile(path.join(root, "Archive/New.pdf.notes/Summary.md"), "utf8")).toBe(
    `[PDF](../New.pdf${fragment}) [Other](../../Other.md)`,
  );
  expect(await readFile(path.join(root, "Other.md"), "utf8")).toBe(
    "[[Archive/New.pdf.notes/Summary]] [PDF](Archive/New.pdf#page=1)",
  );
  expect(await readFile(path.join(root, "Archive/New.pdf.notes/sub/Questions.markdown"), "utf8")).toBe(
    "[[Archive/New.pdf.notes/Summary]]",
  );
  expect(await readFile(path.join(root, "Archive/New.pdf"), "utf8")).toBe("PDF untouched");
  expect(await readFile(path.join(root, "Archive/New.pdf.notes/assets/image.png"), "utf8")).toBe("asset");
  expect(await readdir(root)).not.toContain("Paper.pdf.notes");
});

it("chooses one collision suffix for both destinations, even for PDFs without notes", async () => {
  const root = await workspace({
    "Paper.pdf": "pdf",
    "Archive/Paper.pdf.notes/orphan.md": "existing",
    "Archive/Paper 1.pdf": "occupied",
  });
  const result = await movePdfWithNotes(root, {
    pdfPath: path.join(root, "Paper.pdf"),
    destinationDirectoryPath: path.join(root, "Archive"),
  });
  expect(result).toMatchObject({ success: true, output: path.join(root, "Archive/Paper 2.pdf") });
  expect(await readdir(path.join(root, "Archive"))).not.toContain("Paper 2.pdf.notes");
  expect(await readFile(path.join(root, "Archive/Paper.pdf.notes/orphan.md"), "utf8")).toBe("existing");
});

it("supports no-op and case-only renames, including the companion", async () => {
  const root = await workspace({ "Paper.pdf": "pdf", "Paper.pdf.notes/Summary.md": "[PDF](../Paper.pdf)" });
  const request = { pdfPath: path.join(root, "Paper.pdf"), destinationDirectoryPath: root };
  expect(await movePdfWithNotes(root, request)).toMatchObject({ success: true, output: request.pdfPath });
  expect(await movePdfWithNotes(root, { ...request, newFilename: "paper.pdf" })).toMatchObject({
    success: true,
    output: path.join(root, "paper.pdf"),
  });
  expect(await readdir(root)).toContain("paper.pdf.notes");
  expect(await readdir(root)).not.toContain("Paper.pdf.notes");
  expect(await readFile(path.join(root, "paper.pdf.notes/Summary.md"), "utf8")).toBe("[PDF](../paper.pdf)");
});

it("does not change generic file moves or cascade PDF deletion to notes", async () => {
  const root = await workspace({ "Paper.pdf": "pdf", "Paper.pdf.notes/Summary.md": "note" });
  const { moveWorkspaceItemWithLinks } = await import("../src/main/workspace-linked-move");
  await moveWorkspaceItemWithLinks(root, path.join(root, "Paper.pdf"), path.join(root, "Moved.pdf"));
  expect((await getExplorerSnapshot(root)).pdfNotesGroups).toEqual([]);
  await rm(path.join(root, "Moved.pdf"));
  expect(await readFile(path.join(root, "Paper.pdf.notes/Summary.md"), "utf8")).toBe("note");
});

it("rejects malformed requests, non-PDFs, occupied companions, traversal, self-moves and symlinks", async () => {
  const root = await workspace({
    "Paper.pdf": "pdf",
    "Other.pdf": "pdf",
    "Other.pdf.notes": "occupied",
    "Note.md": "note",
  });
  const pdfPath = path.join(root, "Paper.pdf");
  for (const value of [
    null,
    [],
    {},
    { pdfPath, filename: "Note.md", content: 4 },
    { pdfPath: path.join(root, "Note.md"), filename: "Note.md", content: "" },
    { pdfPath: path.join(root, "../escape.pdf"), filename: "Note.md", content: "" },
  ]) {
    expect(await createPdfNote(root, value)).toMatchObject({ success: false });
  }
  expect(
    await createPdfNote(root, { pdfPath: path.join(root, "Other.pdf"), filename: "Note.md", content: "" }),
  ).toMatchObject({ success: false, errorCode: "conflict" });
  await symlink(path.join(root, "Other.pdf.notes"), path.join(root, "Paper.pdf.notes"));
  expect(await createPdfNote(root, { pdfPath, filename: "Note.md", content: "" })).toMatchObject({ success: false });
  await rm(path.join(root, "Paper.pdf.notes"));
  await mkdir(path.join(root, "Paper.pdf.notes"));
  expect(
    await movePdfWithNotes(root, { pdfPath, destinationDirectoryPath: path.join(root, "Paper.pdf.notes") }),
  ).toMatchObject({ success: false });
  expect(
    await movePdfWithNotes(root, { pdfPath, destinationDirectoryPath: root, newFilename: "Other.pdf" }),
  ).toMatchObject({ success: false, errorCode: "conflict" });
  await symlink(pdfPath, path.join(root, "Link.pdf"));
  expect(
    await attachPdfNote(root, { pdfPath: path.join(root, "Link.pdf"), notePath: path.join(root, "Note.md") }),
  ).toMatchObject({ success: false });
  expect(await readFile(path.join(root, "Note.md"), "utf8")).toBe("note");
});

it("rejects hidden move destinations and preserves exact path casing for all ancestors", async () => {
  const root = await workspace({ "Papers/Paper.pdf": "pdf", "Note.md": "note" });
  await mkdir(path.join(root, ".hidden"));
  expect(
    await movePdfWithNotes(root, {
      pdfPath: path.join(root, "Papers/Paper.pdf"),
      destinationDirectoryPath: path.join(root, ".hidden"),
    }),
  ).toMatchObject({ success: false });
  expect(
    await createPdfNote(root, { pdfPath: path.join(root, "papers/Paper.pdf"), filename: "Note.md", content: "" }),
  ).toMatchObject({ success: false });
  expect(
    await attachPdfNote(root, { pdfPath: path.join(root, "Papers/Paper.pdf"), notePath: path.join(root, "note.md") }),
  ).toMatchObject({ success: false });
  expect(await readFile(path.join(root, "Note.md"), "utf8")).toBe("note");
});

it("numbers the PDF and its existing companion together when a destination companion is occupied", async () => {
  const root = await workspace({
    "Paper.pdf": "pdf",
    "Paper.pdf.notes/Summary.md": "[PDF](../Paper.pdf)",
    "Archive/Paper.pdf.notes/orphan.md": "orphan",
  });
  const result = await movePdfWithNotes(root, {
    pdfPath: path.join(root, "Paper.pdf"),
    destinationDirectoryPath: path.join(root, "Archive"),
  });
  expect(result).toMatchObject({
    success: true,
    output: path.join(root, "Archive/Paper 1.pdf"),
    movedRoots: expect.arrayContaining([
      { source: path.join(root, "Paper.pdf.notes"), destination: path.join(root, "Archive/Paper 1.pdf.notes") },
    ]),
  });
  expect(await readFile(path.join(root, "Archive/Paper 1.pdf.notes/Summary.md"), "utf8")).toBe(
    "[PDF](../Paper%201.pdf)",
  );
  expect(await readFile(path.join(root, "Archive/Paper.pdf.notes/orphan.md"), "utf8")).toBe("orphan");
});

it("serializes concurrent note creation without replacing either writer's content", async () => {
  const root = await workspace({ "Paper.pdf": "pdf" });
  const request = { pdfPath: path.join(root, "Paper.pdf"), filename: "Summary.md" };
  const results = await Promise.all([
    createPdfNote(root, { ...request, content: "first" }),
    createPdfNote(root, { ...request, content: "second" }),
  ]);
  expect(results.map((result) => result.success)).toEqual([true, false]);
  expect(results[1]).toMatchObject({ errorCode: "conflict", revision: results[0].revision + 1 });
  expect(await readFile(path.join(root, "Paper.pdf.notes/Summary.md"), "utf8")).toBe("first");
});

it("keeps companion Markdown searchable after index recreation and whole-directory moves", async () => {
  const root = await workspace({ "Paper.pdf": "pdf", "Paper.pdf.notes/Summary.md": "portable research notes" });
  const cache = await workspace({});
  const { WorkspaceIndex } = await import("../src/main/workspace-index");
  const database = path.join(cache, "index.sqlite");
  let index = new WorkspaceIndex(database, root);
  try {
    await index.sync();
    expect(index.searchText("portable").map(({ file }) => file.path)).toEqual([
      path.join(root, "Paper.pdf.notes/Summary.md"),
    ]);
    const groups = (await getExplorerSnapshot(root)).pdfNotesGroups;
    index.close();
    await rm(database);
    index = new WorkspaceIndex(database, root);
    await index.sync();
    expect((await getExplorerSnapshot(root)).pdfNotesGroups).toEqual(groups);
    expect(index.searchText("portable")).toHaveLength(1);
    await rename(path.join(root, "Paper.pdf.notes"), path.join(root, "Archived.pdf.notes"));
    await index.sync();
    expect(index.searchText("portable").map(({ file }) => file.path)).toEqual([
      path.join(root, "Archived.pdf.notes/Summary.md"),
    ]);
    expect((await getExplorerSnapshot(root)).pdfNotesGroups).toEqual([]);
  } finally {
    index.close();
  }
});

it("imports OS notes into a previously unannotated PDF, preserves sources and numbers collisions", async () => {
  const root = await workspace({ "Paper.PDF": "pdf" });
  const outside = await workspace({ "Summary.md": "ordinary markdown" });
  const request = {
    pdfPath: path.join(root, "Paper.PDF"),
    sources: [{ kind: "path", path: path.join(outside, "Summary.md") }],
  };
  const first = await importPdfNotes(root, request);
  expect(first).toEqual({ importedPaths: [path.join(root, "Paper.PDF.notes/Summary.md")], errors: [] });
  const second = await importPdfNotes(root, request);
  expect(second.errors).toEqual([]);
  expect(second.importedPaths).toHaveLength(1);
  expect(second.importedPaths[0]).not.toBe(first.importedPaths[0]);
  expect(await readFile(first.importedPaths[0], "utf8")).toBe("ordinary markdown");
  expect(await readFile(second.importedPaths[0], "utf8")).toBe("ordinary markdown");
  expect(await readFile(path.join(outside, "Summary.md"), "utf8")).toBe("ordinary markdown");
  expect((await getExplorerSnapshot(root)).pdfNotesGroups[0].childPaths).toHaveLength(2);
});

it("rejects invalid PDF imports without creating a companion or falling back to the workspace root", async () => {
  const root = await workspace({ "Paper.pdf": "pdf" });
  const outside = await workspace({ "image.png": "image", "Note.md": "note" });
  await mkdir(path.join(outside, "Folder.md"));
  await symlink(path.join(outside, "Note.md"), path.join(outside, "Link.md"));
  const pdfPath = path.join(root, "Paper.pdf");
  const sources: unknown[] = [
    null,
    [],
    [{ kind: "path", path: path.join(outside, "image.png") }],
    [{ kind: "path", path: path.join(outside, "Folder.md") }],
    [{ kind: "path", path: path.join(outside, "Link.md") }],
    [{ kind: "buffer", name: "Note.md", content: "wrong type" }],
    [{ kind: "buffer", name: "../Note.md", content: new Uint8Array([1]) }],
    [
      { kind: "path", path: path.join(outside, "Note.md") },
      { kind: "path", path: path.join(outside, "image.png") },
    ],
  ];
  for (const value of sources) {
    const result = await importPdfNotes(root, { pdfPath, sources: value });
    expect(result.importedPaths).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(await readdir(root)).toEqual(["Paper.pdf"]);
  }
  await writeFile(`${pdfPath}.notes`, "occupied");
  const failed = await importPdfNotes(root, {
    pdfPath,
    sources: [{ kind: "path", path: path.join(outside, "Note.md") }],
  });
  expect(failed.importedPaths).toEqual([]);
  expect(await readFile(`${pdfPath}.notes`, "utf8")).toBe("occupied");
});
