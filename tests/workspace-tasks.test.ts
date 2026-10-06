import assert from "node:assert/strict";
import { test } from "vitest";

import { discoverWorkspaceTaskFiles } from "../src/renderer/src/features/task-board/taskBoardFiles";
import type { IndexedDocument, WorkspaceIndexFile } from "../src/shared/workspace-index";

const workspacePath = "/notes";

const note = (path: string): WorkspaceIndexFile => ({
  id: path,
  filename:
    path
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/, "") ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const task = (title: string, properties = "") =>
  `---\ntype: task\n${properties ? `${properties}\n` : ""}---\n# ${title}\n`;

const entry = (path: string, taskSource?: string): IndexedDocument => ({
  file: note(path),
  source: taskSource ?? "",
});

test("discovers indexed tasks in snapshot order", () => {
  const root = { ...entry("/notes/root.md", task("Root", "tags: [One, Two]")), modifiedAtMs: 1234 };
  const nested = entry(
    "/notes/projects/nested.markdown",
    task("Nested", "task-project: Research\nmetadata:\n  owner: Ada"),
  );
  const ordinary = entry("/notes/projects/ordinary.md");
  const completed = entry("/notes/projects/completed.md", task("Done", "task-status: done"));

  const tasks = discoverWorkspaceTaskFiles({
    documents: [root, ordinary, nested, completed],
    fileBuffersByPath: {},
    workspacePath,
  });

  assert.deepEqual(
    tasks.map(({ path, title, project }) => ({ path, title, project })),
    [
      { path: root.file.path, title: "root", project: undefined },
      { path: nested.file.path, title: "nested", project: "Research" },
      { path: completed.file.path, title: "completed", project: undefined },
    ],
  );
  assert.equal(tasks[0]?.modifiedAtMs, 1234);
});

test("includes completed task files for metadata-preserving section edits", () => {
  const active = entry("/notes/active.md", task("Active", "task-project: Research"));
  const completed = entry("/notes/completed.md", task("Done", "task-project: Research\ntask-status: done"));
  const documents = [active, completed, entry("/notes/ordinary.md")];

  assert.deepEqual(
    discoverWorkspaceTaskFiles({ documents, fileBuffersByPath: {}, workspacePath }).map(({ path }) => path),
    [active.file.path, completed.file.path],
  );
});

test("open buffers can promote unmatched notes or suppress indexed tasks", () => {
  const promoted = entry("/notes/promoted.md");
  const emptied = entry("/notes/emptied.md", task("Disk task"));

  const tasks = discoverWorkspaceTaskFiles({
    documents: [emptied],
    fileBuffersByPath: {
      [promoted.file.path]: { editorText: task("Promoted from buffer") },
      [emptied.file.path]: { editorText: "" },
      "/notes/not-markdown.txt": { editorText: task("Not Markdown") },
    },
    workspacePath,
  });

  assert.deepEqual(
    tasks.map(({ path, title }) => ({ path, title })),
    [{ path: promoted.file.path, title: "promoted" }],
  );
});

test("isolates invalid indexed task sources", () => {
  const invalid = entry("/notes/invalid.md", "---\ntype: [task\n---\n# Broken\n");
  const valid = entry("/notes/valid.md", task("Valid"));

  assert.deepEqual(
    discoverWorkspaceTaskFiles({ documents: [invalid, valid], fileBuffersByPath: {}, workspacePath }).map(
      ({ path }) => path,
    ),
    [valid.file.path],
  );
});
