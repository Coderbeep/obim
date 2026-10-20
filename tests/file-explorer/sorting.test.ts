import { prepareFileTreeInput, type FileTreeSortEntry } from "@pierre/trees";
import { describe, expect, it } from "vitest";

import { buildExplorerTreeLookup } from "../../src/renderer/src/features/files/explorer/fileExplorerTreeUtils";
import { compareExplorerEntries } from "../../src/renderer/src/features/files/explorer/fileExplorerSorting";
import type { ExplorerSortPreference } from "../../src/renderer/src/store/explorerSortStore";
import type { FileItem } from "../../src/shared/file-item";

const defaults: ExplorerSortPreference = { by: "name", direction: "ascending" };
const entry = (path: string): FileTreeSortEntry => {
  const segments = path.replace(/\/$/, "").split("/");
  return { path, segments, basename: segments.at(-1)!, depth: segments.length - 1, isDirectory: path.endsWith("/") };
};
const sort = (paths: string[], preference = defaults, files = new Map<string, FileItem>()) =>
  paths
    .map(entry)
    .sort((left, right) => compareExplorerEntries(left, right, preference, files))
    .map((item) => item.path);

describe("file explorer sorting", () => {
  it("keeps the existing folder, hidden-item and case-insensitive default order without mutating input", () => {
    const paths = ["z.md", "B.md", "alpha.md", ".hidden", "Zebra/", ".settings/", "Assets/"];
    const original = [...paths];
    expect(sort(paths)).toEqual([".settings/", "Assets/", "Zebra/", ".hidden", "alpha.md", "B.md", "z.md"]);
    expect(paths).toEqual(original);
  });

  it("matches the existing tree's natural default for numbers, case, punctuation and nested paths", () => {
    const paths = [
      "10.md",
      "2.md",
      "file10.md",
      "file2.md",
      "file02.md",
      "a.md",
      "A.md",
      "_note.md",
      ".hidden",
      "!note.md",
      "é.md",
      "Z/",
      "Z/note10.md",
      "Z/note2.md",
      "A/",
      "A/deep/file.md",
    ];
    expect(sort(paths)).toEqual([...prepareFileTreeInput(paths, { flattenEmptyDirectories: false }).paths]);
  });

  it("keeps entire subtrees together with folders first in descending type order", () => {
    const paths = ["z.pdf", "Docs/", "Docs/z.png", "Docs/a.pdf", "b.jpg", "a.zip"];
    expect(sort(paths, { ...defaults, by: "type", direction: "descending" })).toEqual([
      "Docs/",
      "Docs/a.pdf",
      "Docs/z.png",
      "z.pdf",
      "b.jpg",
      "a.zip",
    ]);
  });

  it("combines image and archive formats into kinds and then sorts names inside each kind", () => {
    const paths = ["a.pdf", "z.webp", "m.JPG", "A.PNG", "b.md", "z.markdown", "b.zip", "a.TAR.GZ", "z/"];
    expect(sort(paths, { ...defaults, by: "type" })).toEqual([
      "z/",
      "a.TAR.GZ",
      "b.zip",
      "A.PNG",
      "m.JPG",
      "z.webp",
      "b.md",
      "z.markdown",
      "a.pdf",
    ]);
    expect(sort(paths, { ...defaults, by: "type", direction: "descending" })).toEqual([
      "z/",
      "a.pdf",
      "z.markdown",
      "b.md",
      "z.webp",
      "m.JPG",
      "A.PNG",
      "b.zip",
      "a.TAR.GZ",
    ]);
  });

  it("always keeps folders first in both sort modes and directions", () => {
    const paths = ["a.md", "b/", "c.pdf", "d/"];
    expect(sort(paths)).toEqual(["b/", "d/", "a.md", "c.pdf"]);
    expect(sort(paths, { ...defaults, direction: "descending" })).toEqual(["d/", "b/", "c.pdf", "a.md"]);
    expect(sort(paths, { ...defaults, by: "type" })).toEqual(["b/", "d/", "a.md", "c.pdf"]);
    expect(sort(paths, { ...defaults, by: "type", direction: "descending" })).toEqual(["d/", "b/", "c.pdf", "a.md"]);
  });

  it("uses MIME metadata for extensionless files and keeps other kinds distinct", () => {
    const file = (path: string, mimeType: string): FileItem => ({
      id: path,
      path,
      relativePath: path,
      filename: path,
      mimeType,
      isDirectory: false,
    });
    const items = [
      file("Photo", "image/tiff"),
      file("Document", "application/pdf"),
      file("Bundle", "application/x-7z-compressed"),
      file("Memo", "text/markdown"),
      file("Readme", "text/plain"),
      file("Recording", "audio/wav"),
      file("Clip", "video/mp4"),
      file("Unknown", "application/octet-stream"),
    ];
    const metadata = new Map(items.map((item) => [item.path, item]));
    expect(
      sort(
        items.map((item) => item.path),
        { ...defaults, by: "type" },
        metadata,
      ),
    ).toEqual(["Bundle", "Recording", "Photo", "Memo", "Unknown", "Document", "Readme", "Clip"]);
    expect(sort(["new.tiff", "a.pdf", "new.7Z", "memo.MDX"], { ...defaults, by: "type" })).toEqual([
      "new.7Z",
      "new.tiff",
      "memo.MDX",
      "a.pdf",
    ]);
  });
});

it.each(["ascending", "descending"] as const)(
  "places PDFs with contents before plain and empty PDFs in %s type order",
  (direction) => {
    const pdf = (name: string): Extract<FileItem, { isDirectory: false }> => ({
      id: name,
      path: `/notes/${name}`,
      relativePath: name,
      filename: name,
      isDirectory: false,
      mimeType: "application/pdf",
    });
    const folder = (name: string, children: FileItem[] = []): FileItem => ({
      ...pdf(name),
      isDirectory: true,
      mimeType: null,
      children,
    });
    const items = [
      pdf("A2.pdf"),
      folder("A2.pdf.notes"),
      pdf("A10.pdf"),
      pdf("Z2.pdf"),
      pdf("Z10.pdf"),
      folder("Z2.pdf.notes", [{ ...pdf("Z2.pdf.notes/n.md"), mimeType: "text/markdown" }]),
      folder("Z10.pdf.notes", [{ ...pdf("Z10.pdf.notes/image.png"), mimeType: "image/png" }]),
      folder("Folder"),
    ];
    const lookup = buildExplorerTreeLookup(items);
    const roots = (by: "type" | "name") =>
      sort([...lookup.paths], { by, direction }, lookup.byTreePath).filter(
        (path) => !path.replace(/\/$/, "").includes("/"),
      );
    expect(roots("type")).toEqual(
      direction === "ascending"
        ? ["Folder/", "Z2.pdf.notes/", "Z10.pdf.notes/", "A2.pdf", "A10.pdf"]
        : ["Folder/", "Z10.pdf.notes/", "Z2.pdf.notes/", "A10.pdf", "A2.pdf"],
    );
    expect(roots("name")).toEqual(
      direction === "ascending"
        ? ["Folder/", "A2.pdf", "A10.pdf", "Z2.pdf.notes/", "Z10.pdf.notes/"]
        : ["Folder/", "Z10.pdf.notes/", "Z2.pdf.notes/", "A10.pdf", "A2.pdf"],
    );
  },
);
