import { expect, test, vi } from "vitest";
import type { FileItem } from "../src/shared/file-item";
import {
  resolveLinkedWorkspaceItem,
  resolveWikiNoteWorkspacePath,
  resolveWorkspaceLinkStatus,
} from "../src/renderer/src/features/files/workspaceFileResolver";

const file = (relativePath: string): FileItem => ({
  id: relativePath,
  path: `/notes/${relativePath}`,
  relativePath,
  filename: relativePath.split("/").at(-1)!,
  isDirectory: false,
  mimeType: relativePath.endsWith(".pdf") ? "application/pdf" : "text/markdown",
});
const tree = [
  file("Drafts/Source.md"),
  file("My Note.md"),
  file("100%25.md"),
  file("100%.md"),
  file("A/Review.md"),
  file("B/Review.markdown"),
  file("Manual.pdf"),
  file("Folder/Dual.md"),
  file("Folder/Dual.markdown"),
];

test("wiki feedback distinguishes missing from ambiguous with navigation's case and path rules", () => {
  expect(resolveWorkspaceLinkStatus("review#Heading", "wiki", tree)).toEqual({
    status: "ambiguous",
    matches: 2,
    target: "review",
  });
  expect(resolveWorkspaceLinkStatus("Missing", "wiki", tree)).toEqual({ status: "missing" });
  for (const target of ["A/Review#Heading", "B/Review.markdown", "My%20Note", "#Heading", "100%25"])
    expect(resolveWorkspaceLinkStatus(target, "wiki", tree).status).toBe("resolved");
  expect(resolveWikiNoteWorkspacePath("Folder/Dual", tree)).toBe("Folder/Dual.markdown");
  expect(resolveWikiNoteWorkspacePath("100%25", tree)).toBe("100%25.md");
  expect(resolveWorkspaceLinkStatus("Manual.pdf", "wiki", tree).status).toBe("missing");
});

test("Markdown feedback shares source-relative, root, encoded, absolute, PDF, and literal hash handling", () => {
  const withHash = [...tree, file("Hash#name.md")];
  for (const target of [
    "../My%20Note.md#Heading",
    "/My%20Note.md",
    "/notes/My Note.md",
    "Manual.pdf#page=2",
    "Hash#name.md",
    "#Local",
  ])
    expect(resolveWorkspaceLinkStatus(target, "markdown", withHash, "/notes/Drafts/Source.md").status).toBe("resolved");
  expect(resolveWorkspaceLinkStatus("Unknown.md#Heading", "markdown", withHash).status).toBe("missing");
  expect(resolveWorkspaceLinkStatus("100%25.md", "markdown", tree).status).toBe("resolved");
  expect(resolveLinkedWorkspaceItem("100%25.md", tree)?.file?.relativePath).toBe("100%25.md");
});

test("root/source collisions preserve tree-order navigation precedence", () => {
  const tree = [file("Reference.md"), file("Drafts/Reference.md"), file("Drafts/Source.md")];
  expect(resolveLinkedWorkspaceItem("Reference.md", tree, "/notes/Drafts/Source.md")?.file?.relativePath).toBe(
    "Drafts/Reference.md",
  );
});

test("metadata index is shared by link lookups and rebuilt for a new tree snapshot", () => {
  const children = vi.fn(() => [file("Known.md")]);
  const directory: FileItem = {
    id: "folder",
    path: "/notes",
    relativePath: "",
    filename: "notes",
    isDirectory: true,
    mimeType: null,
    get children() {
      return children();
    },
  };
  const tree = [directory];
  expect(resolveWorkspaceLinkStatus("Known", "wiki", tree).status).toBe("resolved");
  const callsAfterIndexing = children.mock.calls.length;
  expect(resolveWorkspaceLinkStatus("Known.md", "markdown", tree).status).toBe("resolved");
  expect(resolveWorkspaceLinkStatus("Unknown", "wiki", tree).status).toBe("missing");
  expect(children).toHaveBeenCalledTimes(callsAfterIndexing);
  expect(resolveWorkspaceLinkStatus("Unknown", "wiki", [...tree, file("Unknown.md")]).status).toBe("resolved");
  expect(children.mock.calls.length).toBeGreaterThan(callsAfterIndexing);
});
