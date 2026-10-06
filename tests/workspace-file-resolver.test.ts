import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { openLinkedFile } from "@renderer/features/files/fileActions";
import {
  canonicalWikiNoteTarget,
  resolveWikiImageWorkspaceFile,
  resolveWikiNoteWorkspacePath,
} from "@renderer/features/files/workspaceFileResolver";
import type { FileItem } from "@shared/file-item";

const file = (path: string, relativePath: string): Extract<FileItem, { isDirectory: false }> => ({
  id: path,
  filename: relativePath.split("/").at(-1) ?? relativePath,
  relativePath,
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const directory = (path: string, relativePath: string, children: FileItem[]): FileItem => ({
  id: path,
  filename: relativePath.split("/").at(-1) ?? relativePath,
  relativePath,
  path,
  isDirectory: true,
  mimeType: null,
  children,
});

describe("linked workspace file resolution", () => {
  const source = file("/notes/Projects/Drafts/Source.md", "Projects/Drafts/Source.md");
  const sibling = file("/notes/Projects/Reference.md", "Projects/Reference.md");
  const encoded = file("/notes/Folder/My Note.md", "Folder/My Note.md");
  const fileTree = [
    directory("/notes/Projects", "Projects", [
      directory("/notes/Projects/Drafts", "Projects/Drafts", [source]),
      sibling,
    ]),
    directory("/notes/Folder", "Folder", [encoded]),
  ];
  const openResource = vi.fn(async () => true);
  const notify = vi.fn();
  const open = (path: string, sourceFilePath?: string) =>
    openLinkedFile({ path, sourceFilePath, fileTree, openResource, notify });

  beforeEach(() => {
    openResource.mockClear();
    notify.mockClear();
    vi.stubGlobal("crypto", { randomUUID: () => "missing-file-notification" });
  });

  afterEach(() => vi.unstubAllGlobals());

  test("decodes and opens nested workspace-relative paths", async () => {
    await expect(open("Folder/My%20Note.md")).resolves.toBe(true);
    expect(openResource).toHaveBeenCalledWith(expect.objectContaining({ file: encoded }));
    expect(notify).not.toHaveBeenCalled();
  });

  test("opens paths relative to the note containing the link", async () => {
    await expect(open("../Reference.md", source.path)).resolves.toBe(true);
    expect(openResource).toHaveBeenCalledWith(expect.objectContaining({ file: sibling }));
    expect(notify).not.toHaveBeenCalled();
  });

  test("opens an absolute path already present in the workspace tree", async () => {
    await expect(open(encoded.path, source.path)).resolves.toBe(true);
    expect(openResource).toHaveBeenCalledWith(expect.objectContaining({ file: encoded }));
  });

  test("resolves file paths that carry a PDF page fragment", async () => {
    await expect(open("Folder/My%20Note.md#page=7&annotation=clip-1")).resolves.toBe(true);
    expect(openResource).toHaveBeenCalledWith(expect.objectContaining({ file: encoded }));
  });

  test("opens an encoded filename and requests the heading only after opening succeeds", async () => {
    const special = file("/notes/Thesis - 1.md", "Thesis - 1.md");
    const requestHeading = vi.fn();
    const opened = vi.fn(async () => {
      expect(requestHeading).not.toHaveBeenCalled();
      return true;
    });
    expect(
      await openLinkedFile({
        path: "Thesis%20-%201.md#methods",
        fileTree: [special],
        openResource: opened,
        notify,
        requestHeading,
      }),
    ).toBe(true);
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ file: special }));
    expect(requestHeading).toHaveBeenCalledWith(special.path, "#methods");
    requestHeading.mockClear();
    expect(
      await openLinkedFile({
        path: "Thesis%20-%201.md#methods",
        fileTree: [special],
        openResource: async () => false,
        notify,
        requestHeading,
      }),
    ).toBe(false);
    expect(requestHeading).not.toHaveBeenCalled();
  });

  test("rejects section links to hash filenames but allows whole-note links", async () => {
    const special = file("/notes/Thesis - #1.md", "Thesis - #1.md");
    const requestHeading = vi.fn();
    await openLinkedFile({
      path: "#methods",
      sourceFilePath: special.path,
      fileTree: [special],
      openResource,
      notify,
      requestHeading,
    });
    expect(requestHeading).not.toHaveBeenCalled();
    expect(openResource).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Section links unavailable" }));
    expect(await openLinkedFile({ path: "Thesis%20-%20%231.md", fileTree: [special], openResource, notify })).toBe(
      true,
    );
    expect(openResource).toHaveBeenCalledWith(expect.objectContaining({ file: special }));
  });

  test("opens readable hash filenames as whole notes without interpreting them as anchors", async () => {
    const special = file("/notes/Thesis - #1.md", "Thesis - #1.md");
    const requestHeading = vi.fn();
    expect(
      await openLinkedFile({ path: special.relativePath, fileTree: [special], openResource, notify, requestHeading }),
    ).toBe(true);
    expect(openResource).toHaveBeenCalledWith(expect.objectContaining({ file: special }));
    expect(requestHeading).not.toHaveBeenCalled();
  });

  test.each(["Folder/Missing.md", "%invalid-URI"])("reports a missing destination for %s", async (path) => {
    await expect(open(path)).resolves.toBe(false);
    expect(openResource).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warning",
        title: "File not found",
        message: `No note exists at "${path}"`,
      }),
    );
  });
});

describe("Obsidian wiki image resolution", () => {
  const image = (relativePath: string): FileItem => ({
    id: relativePath,
    filename:
      relativePath
        .split("/")
        .at(-1)
        ?.replace(/\.[^.]+$/, "") ?? relativePath,
    relativePath,
    path: `/notes/${relativePath}`,
    isDirectory: false,
    mimeType: "image/png",
  });
  const note = file("/notes/01 - Engineering Thesis/Architectures.md", "01 - Engineering Thesis/Architectures.md");
  const noteSibling = image("01 - Engineering Thesis/local.png");
  const rootImage = image("root.png");
  const suppliedImage = image("Third Semester/Pasted image 20251213114150.png");
  const shallowDuplicate = image("A/duplicate.png");
  const deepDuplicate = image("A/B/duplicate.png");
  const lexicalDuplicate = image("B/duplicate.png");
  const encodedLiteral = image("Third Semester/literal%20name.png");
  const encodedDecoded = image("Third Semester/decoded name.png");
  const tree = [
    note,
    noteSibling,
    rootImage,
    suppliedImage,
    deepDuplicate,
    lexicalDuplicate,
    shallowDuplicate,
    encodedDecoded,
    encodedLiteral,
  ];

  test("finds the supplied bare image filename anywhere in the workspace", () => {
    expect(resolveWikiImageWorkspaceFile("Pasted image 20251213114150.png", tree, note.path)).toBe(suppliedImage);
  });

  test("prefers the note directory and workspace root before the basename fallback", () => {
    expect(resolveWikiImageWorkspaceFile("local.png", tree, note.path)).toBe(noteSibling);
    expect(resolveWikiImageWorkspaceFile("root.png", tree, note.path)).toBe(rootImage);
  });

  test("resolves explicit paths workspace-relative before note-relative", () => {
    expect(resolveWikiImageWorkspaceFile("Third Semester/Pasted image 20251213114150.png", tree, note.path)).toBe(
      suppliedImage,
    );
    expect(resolveWikiImageWorkspaceFile("../Third Semester/Pasted image 20251213114150.png", tree, note.path)).toBe(
      suppliedImage,
    );
  });

  test("chooses the shallowest then lexically first duplicate basename", () => {
    expect(resolveWikiImageWorkspaceFile("duplicate.png", tree, note.path)).toBe(shallowDuplicate);
    expect(resolveWikiImageWorkspaceFile("DUPLICATE.PNG", tree, note.path)).toBe(shallowDuplicate);
  });

  test("prefers literal percent filenames before decoded compatibility paths", () => {
    expect(resolveWikiImageWorkspaceFile("literal%20name.png", tree, note.path)).toBe(encodedLiteral);
    expect(resolveWikiImageWorkspaceFile("decoded%20name.png", tree, note.path)).toBe(encodedDecoded);
  });

  test("rejects unsupported and missing targets", () => {
    expect(resolveWikiImageWorkspaceFile("Architectures.md", tree, note.path)).toBeNull();
    expect(resolveWikiImageWorkspaceFile("missing.png", tree, note.path)).toBeNull();
  });
});

describe("Writer-style wiki note resolution", () => {
  const architecture = file(
    "/notes/01 - Engineering Thesis/Architectures.md",
    "01 - Engineering Thesis/Architectures.md",
  );
  const unique = file("/notes/Third Semester/RCAN.markdown", "Third Semester/RCAN.markdown");
  const duplicateA = file("/notes/A/Review.md", "A/Review.md");
  const duplicateB = file("/notes/B/Review.md", "B/Review.md");
  const encoded = file("/notes/My Note.md", "My Note.md");
  const nonMarkdown: FileItem = {
    ...file("/notes/RCAN.pdf", "RCAN.pdf"),
    mimeType: "application/pdf",
  };
  const tree = [architecture, unique, duplicateA, duplicateB, encoded, nonMarkdown];

  test("resolves explicit extensionless workspace paths and preserves fragments", () => {
    expect(resolveWikiNoteWorkspacePath("01 - Engineering Thesis/Architectures#rcan", tree)).toBe(
      "01 - Engineering Thesis/Architectures.md#rcan",
    );
    expect(resolveWikiNoteWorkspacePath("Third Semester/RCAN.markdown", tree)).toBe("Third Semester/RCAN.markdown");
  });

  test("resolves a unique bare note stem case-insensitively", () => {
    expect(resolveWikiNoteWorkspacePath("rcan", tree)).toBe("Third Semester/RCAN.markdown");
    expect(resolveWikiNoteWorkspacePath("My%20Note", tree)).toBe("My Note.md");
  });

  test("leaves ambiguous, missing, and non-Markdown bare targets unresolved", () => {
    expect(resolveWikiNoteWorkspacePath("Review", tree)).toBeNull();
    expect(resolveWikiNoteWorkspacePath("Missing", tree)).toBeNull();
    expect(resolveWikiNoteWorkspacePath("RCAN.pdf", tree)).toBeNull();
  });

  test("keeps a fragment-only target for current-note navigation", () => {
    expect(resolveWikiNoteWorkspacePath("#attention", tree)).toBe("#attention");
  });

  test("writes a bare target for unique stems and a path for duplicates", () => {
    expect(canonicalWikiNoteTarget("Third Semester/RCAN.markdown", tree)).toBe("RCAN");
    expect(canonicalWikiNoteTarget("A/Review.md#summary", tree)).toBe("A/Review#summary");
    expect(canonicalWikiNoteTarget("#attention", tree)).toBe("#attention");
  });
});
