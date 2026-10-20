import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CreatePdfNoteResult, ExplorerSnapshot, MovePdfNotesResult } from "../src/shared/explorer-pdf-notes";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request?: unknown) => Promise<unknown>>(),
}));
vi.mock("../src/main/trusted-ipc", () => ({
  trustedIpcMain: {
    handle: (name: string, callback: (event: unknown, request?: unknown) => Promise<unknown>) =>
      state.handlers.set(name, callback),
  },
}));
import { registerExplorerPdfNotesIpc } from "../src/main/explorer-pdf-notes-ipc";
const roots: string[] = [];
afterEach(async () => {
  state.handlers.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("registers separate commands against the active workspace and returns versioned disk results", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "obim-pdf-ipc-"));
  roots.push(root);
  await writeFile(path.join(root, "Paper.pdf"), "pdf");
  await writeFile(path.join(root, "Note.md"), "[PDF](Paper.pdf)");
  await mkdir(path.join(root, "Archive"));
  const getWorkspace = vi.fn(async () => root);
  registerExplorerPdfNotesIpc(getWorkspace);
  expect([...state.handlers.keys()]).toEqual([
    "get-explorer-snapshot",
    "create-pdf-note",
    "attach-pdf-note",
    "import-pdf-notes",
    "move-pdf-with-notes",
  ]);
  const invoke = (name: string, request?: unknown) => state.handlers.get(name)!({}, request);
  const created = (await invoke("create-pdf-note", {
    pdfPath: path.join(root, "Paper.pdf"),
    filename: "Summary.md",
    content: "summary",
  })) as CreatePdfNoteResult;
  expect(created).toMatchObject({ success: true, file: { version: { sizeBytes: 7 } } });
  const attached = (await invoke("attach-pdf-note", {
    pdfPath: path.join(root, "Paper.pdf"),
    notePath: path.join(root, "Note.md"),
  })) as MovePdfNotesResult;
  expect(attached).toMatchObject({ success: true, output: path.join(root, "Paper.pdf.notes/Note.md") });
  expect(
    await invoke("import-pdf-notes", {
      pdfPath: path.join(root, "Paper.pdf"),
      sources: [{ kind: "buffer", name: "Imported.md", content: new Uint8Array([110, 111, 116, 101]) }],
    }),
  ).toMatchObject({ importedPaths: [path.join(root, "Paper.pdf.notes/Imported.md")], errors: [] });
  const moved = (await invoke("move-pdf-with-notes", {
    pdfPath: path.join(root, "Paper.pdf"),
    destinationDirectoryPath: path.join(root, "Archive"),
  })) as MovePdfNotesResult;
  expect(moved).toMatchObject({ success: true, movedRoots: expect.any(Array) });
  const snapshot = (await invoke("get-explorer-snapshot")) as ExplorerSnapshot;
  expect(snapshot.revision).toBe(moved.revision);
  expect(snapshot.pdfNotesGroups[0].pdfPath).toBe(path.join(root, "Archive/Paper.pdf"));
  expect(await readFile(path.join(root, "Archive/Paper.pdf.notes/Note.md"), "utf8")).toBe("[PDF](Archive/Paper.pdf)");
  expect(await invoke("create-pdf-note", null)).toMatchObject({ success: false });
  expect(getWorkspace).toHaveBeenCalledTimes(6);
});
