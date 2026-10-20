import { expect, it } from "vitest";
import type { FileItem } from "../../src/shared/file-item";
import {
  flattenFileTree,
  predictFileMove,
  predictPdfNotesMove,
  projectFileMoves,
} from "../../src/renderer/src/features/files/optimisticFileMove";

const file = (root: string, name: string): FileItem => ({
  id: `${root}/${name}`,
  path: `${root}/${name}`,
  relativePath: name,
  filename: name.split("/").at(-1)!,
  isDirectory: false,
  mimeType: name.endsWith(".pdf") ? "application/pdf" : "text/markdown",
});
const dir = (root: string, name: string, children: FileItem[] = []): FileItem => ({
  ...file(root, name),
  isDirectory: true,
  mimeType: null,
  children,
});

it.each(["/notes", "C:/notes"])(
  "reparents a folder and its PDF companions without mutating the disk snapshot under %s",
  (root) => {
    const pdf = file(root, "Reading/Paper.pdf");
    const notes = dir(root, "Reading/Paper.pdf.notes", [file(root, "Reading/Paper.pdf.notes/Summary.md")]);
    const folder = dir(root, "Reading", [pdf, notes]);
    const original = [folder, dir(root, "Archive")];
    const before = structuredClone(original);
    const preview = projectFileMoves(original, predictFileMove(original, folder, `${root}/Archive`), `${root}/`);
    expect(original).toEqual(before);
    expect(preview.map((item) => item.relativePath)).toEqual(["Archive"]);
    const moved = preview[0].children![0];
    expect(moved.relativePath).toBe("Archive/Reading");
    expect(moved.children?.map((item) => item.path)).toEqual([
      `${root}/Archive/Reading/Paper.pdf`,
      `${root}/Archive/Reading/Paper.pdf.notes`,
    ]);
    expect(moved.children?.[0].isDirectory).toBe(false);
    expect(moved.children?.[0].children).toBeUndefined();
    expect(moved.children?.[1].children?.[0].relativePath).toBe("Archive/Reading/Paper.pdf.notes/Summary.md");
  },
);

it("reserves both PDF names and companion names, including orphan folders, when predicting collisions", () => {
  const root = "/notes";
  const pdf = file(root, "Paper.pdf");
  const notes = dir(root, "Paper.pdf.notes", [file(root, "Paper.pdf.notes/Summary.md")]);
  const items = [
    pdf,
    notes,
    dir(root, "Archive", [dir(root, "Archive/Paper.pdf.notes"), file(root, "Archive/Paper 1.pdf")]),
  ];
  const moves = predictPdfNotesMove(items, { pdfPath: pdf.path, destinationDirectoryPath: "/notes/Archive" });
  const preview = projectFileMoves(items, moves, root);
  expect(flattenFileTree(preview).map((item) => item.relativePath)).toEqual(
    expect.arrayContaining([
      "Archive/Paper.pdf.notes",
      "Archive/Paper 1.pdf",
      "Archive/Paper 2.pdf",
      "Archive/Paper 2.pdf.notes/Summary.md",
    ]),
  );
});
