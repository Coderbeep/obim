import assert from "node:assert/strict";
import { test } from "vitest";

import { rankFiles } from "../src/renderer/src/features/search/fileRanking";
import type { FileItem } from "../src/shared/file-item";

const file = (filename: string, relativePath: string): FileItem => ({
  id: relativePath,
  filename,
  relativePath,
  path: `/notes/${relativePath}`,
  isDirectory: false,
  mimeType: "text/markdown",
});

test("rankFiles preserves fuzzy filename and path ranking", () => {
  const files = [
    file("Notes", "projects/Notes.md"),
    file("Project plan", "archive/Project plan.md"),
    file("Daily journal", "Daily journal.md"),
  ];

  assert.deepEqual(
    rankFiles(files, "proj").map((result) => result.relativePath),
    ["archive/Project plan.md", "projects/Notes.md"],
  );
});

test("bounded ranking returns the same leading results without sorting the full result set", () => {
  const files = Array.from({ length: 200 }, (_, index) =>
    file(`Project note ${index}`, `areas/${index % 12}/Project note ${index}.md`),
  );

  assert.deepEqual(rankFiles(files, "project", 12), rankFiles(files, "project").slice(0, 12));
  assert.deepEqual(rankFiles(files, "", 12), files.slice(0, 12));
});
