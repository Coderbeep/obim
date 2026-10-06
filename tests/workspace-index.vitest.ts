import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, truncate, unlink, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { test } from "vitest";

import { mapWithConcurrency } from "../src/main/async-pool";
import type { WorkspacePropertyQuery } from "../src/shared/workspace-index";

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 24 || nodeMajor === 25)
  throw new Error("Workspace index tests require Node ^24 or >=26 because they exercise node:sqlite with FTS5.");
const OVERSIZED_TEST_BYTES = 100 * 1024 * 1024;
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

type WorkspaceIndexInstance = InstanceType<(typeof import("../src/main/workspace-index"))["WorkspaceIndex"]>;

const filenames = (matches: ReturnType<WorkspaceIndexInstance["queryProperty"]>) =>
  matches.map(({ file }) => file.filename);

const withWorkspaceIndex = async (
  prefix: string,
  files: Record<string, string>,
  run: (index: WorkspaceIndexInstance, workspacePath: string) => void | Promise<void>,
  databaseFilename = ":memory:",
) => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), prefix));
  await Promise.all(
    Object.entries(files).map(async ([filename, source]) => {
      const filePath = path.join(workspacePath, filename);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, source);
    }),
  );
  const { WorkspaceIndex } = await import("../src/main/workspace-index");
  const index = new WorkspaceIndex(
    databaseFilename === ":memory:" ? databaseFilename : path.join(workspacePath, databaseFilename),
    workspacePath,
  );
  try {
    await index.sync();
    await run(index, workspacePath);
  } finally {
    index.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
};

test("indexes PDF references and replaces them after note edits or deletion", async () => {
  await withWorkspaceIndex(
    "obim-pdf-links-",
    {
      "Notes/one.md": "[First](../Papers/W12.pdf#page=4&selection=2,13,2,24&color=blue)\n\n`[Code](W12.pdf#page=9)`",
      "Notes/two.md": "[Other](W12.pdf#page=2)",
    },
    async (index, workspacePath) => {
      expectPdfRefs(index.queryPdfReferences("w12.PDF"), ["First", "Other"]);
      const firstPath = path.join(workspacePath, "Notes/one.md");
      await writeFile(firstPath, "[Updated](../Papers/W12.pdf#page=5&color=red)");
      await index.refreshPath(firstPath);
      expectPdfRefs(index.queryPdfReferences("W12.pdf"), ["Updated", "Other"]);
      await unlink(firstPath);
      index.deletePath(firstPath);
      expectPdfRefs(index.queryPdfReferences("W12.pdf"), ["Other"]);
    },
  );
});

const expectPdfRefs = (references: ReturnType<WorkspaceIndexInstance["queryPdfReferences"]>, labels: string[]) =>
  assert.deepEqual(references.map((reference) => reference.label).sort(), [...labels].sort());

test("reads and reopens the current index while another connection holds a write transaction", async () => {
  await withWorkspaceIndex(
    "obim-index-reader-lock-",
    { "task.md": "---\ntype: task\ntask-status: open\n---\n" },
    async (index, workspacePath) => {
      const databasePath = path.join(workspacePath, "index.sqlite");
      const writer = new DatabaseSync(databasePath);
      let reopened: WorkspaceIndexInstance | undefined;
      try {
        writer.exec("BEGIN EXCLUSIVE");
        assert.deepEqual(index.queryProperty({ key: "task-status" })[0]?.values, [{ type: "string", value: "open" }]);
        // A read-triggered reconciliation with no file changes must not request a writer lock.
        await index.sync();
        const { WorkspaceIndex } = await import("../src/main/workspace-index");
        reopened = new WorkspaceIndex(databasePath, workspacePath);
        assert.deepEqual(filenames(reopened.queryProperty({ key: "type" })), ["task"]);
      } finally {
        reopened?.close();
        writer.exec("ROLLBACK");
        writer.close();
      }
    },
    "index.sqlite",
  );
});

test("refreshes a task moved to Done after a transient writer lock releases", async () => {
  await withWorkspaceIndex(
    "obim-index-done-lock-",
    { "task.md": "---\ntype: task\ntask-status: open\n---\n" },
    async (index, workspacePath) => {
      await writeFile(
        path.join(workspacePath, "task.md"),
        "---\ntype: task\ntask-status: done\ntask-closed: 2026-09-27\n---\n",
      );
      // Release on a separate thread: the main thread is inside SQLite's synchronous lock wait.
      const writer = new Worker(
        `const { parentPort, workerData } = require('node:worker_threads');
         const { DatabaseSync } = require('node:sqlite');
         const database = new DatabaseSync(workerData);
         database.exec('BEGIN IMMEDIATE');
         parentPort.once('message', () => setTimeout(() => {
           database.exec('COMMIT');
           database.close();
           parentPort.close();
         }, 200));
         parentPort.postMessage('locked');`,
        { eval: true, workerData: path.join(workspacePath, "index.sqlite") },
      );
      try {
        await once(writer, "message");
        const exited = once(writer, "exit");
        writer.postMessage("release");
        await index.sync();
        assert.deepEqual(
          filenames(index.queryProperty({ key: "task-status", value: { type: "string", value: "done" } })),
          ["task"],
        );
        assert.equal(
          index
            .readDocuments([path.join(workspacePath, "task.md").replaceAll("\\", "/")])[0]
            ?.source.includes("task-status: done"),
          true,
        );
        assert.deepEqual(await exited, [0]);
      } finally {
        await writer.terminate();
      }
    },
    "index.sqlite",
  );
});

test("a persistent schema migration lock leaves the healthy database intact and can be retried", async () => {
  await withWorkspaceIndex(
    "obim-index-migration-lock-",
    { "task.md": "---\ntype: task\ntask-status: done\n---\n" },
    async (_index, workspacePath) => {
      const databasePath = path.join(workspacePath, "index.sqlite");
      const writer = new DatabaseSync(databasePath);
      const { WorkspaceIndex } = await import("../src/main/workspace-index");
      let reopened: WorkspaceIndexInstance | undefined;
      try {
        writer.exec("PRAGMA user_version = 0; BEGIN IMMEDIATE");
        assert.throws(() => {
          reopened = new WorkspaceIndex(databasePath, workspacePath);
        }, /database is locked/);
        assert.equal(
          (await readdir(workspacePath)).some((name) => name.endsWith(".corrupt")),
          false,
        );
        assert.deepEqual(filenames(_index.queryProperty({ key: "type" })), ["task"]);
      } finally {
        reopened?.close();
        writer.exec("ROLLBACK");
        writer.close();
      }
      const recovered = new WorkspaceIndex(databasePath, workspacePath);
      try {
        await recovered.sync();
        assert.deepEqual(
          filenames(recovered.queryProperty({ key: "task-status", value: { type: "string", value: "done" } })),
          ["task"],
        );
      } finally {
        recovered.close();
      }
    },
    "index.sqlite",
  );
});

test("preserves genuinely corrupt index bytes before rebuilding from Markdown", async () => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "obim-index-corrupt-"));
  const databasePath = path.join(workspacePath, "index.sqlite");
  await writeFile(databasePath, "not a SQLite database");
  await writeFile(path.join(workspacePath, "task.md"), "---\ntype: task\ntask-status: done\n---\n");
  let index: WorkspaceIndexInstance | undefined;
  try {
    const { WorkspaceIndex } = await import("../src/main/workspace-index");
    index = new WorkspaceIndex(databasePath, workspacePath);
    await index.sync();
    assert.deepEqual(filenames(index.queryProperty({ key: "type" })), ["task"]);
    const quarantined = (await readdir(workspacePath)).filter((name) => name.endsWith(".corrupt"));
    assert.equal(quarantined.length, 1);
    assert.equal(await readFile(path.join(workspacePath, quarantined[0]), "utf8"), "not a SQLite database");
  } finally {
    index?.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("indexes hidden Research Library source records for shared tag queries", async () => {
  await withWorkspaceIndex(
    "obim-research-library-index-",
    {
      "Research Library/sources/source-id.md":
        "---\ntype: pdf-source\npdf: Papers/report.pdf\nfingerprint: sha256:report\ntags: [Climate, review]\n---\n# report\n",
      "ordinary.md": "---\ntags: [project-wide]\n---\n# Ordinary note\n",
    },
    (index) => {
      assert.deepEqual(
        filenames(
          index.queryProperty({
            key: "type",
            value: { type: "string", value: "pdf-source" },
          }),
        ),
        ["source-id"],
      );
      assert.deepEqual(
        index.queryProperty({ key: "tags" }).flatMap(({ values }) => values.map(({ value }) => value)),
        ["project-wide", "Climate", "review"],
      );
    },
  );
});

test("bounds async work and preserves result order", async () => {
  let active = 0;
  let peak = 0;
  const release: Array<() => void> = [];
  const work = mapWithConcurrency([0, 1, 2, 3, 4], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => release.push(resolve));
    active -= 1;
    return value * 2;
  });

  await Promise.resolve();
  assert.equal(active, 2);
  while (release.length) {
    release.shift()?.();
    await Promise.resolve();
  }
  assert.deepEqual(await work, [0, 2, 4, 6, 8]);
  assert.equal(peak, 2);
});

test("indexes documents, FTS text, and typed frontmatter incrementally", async () => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "obim-index-"));
  const taskPath = path.join(workspacePath, "task.md");
  const notePath = path.join(workspacePath, "needle-filename.md");
  await writeFile(
    taskPath,
    "---\ntype: task\ntags: [ML, reading]\npriority: 3\ncompleted: false\ndue: 2026-07-23\n---\nMachine-learning notes.\n",
  );
  await writeFile(
    notePath,
    "---\ntags: [reference]\nempty: []\ndetails: { room: 204 }\n---\nExact searchable fragment.\n",
  );

  const { WorkspaceIndex } = await import("../src/main/workspace-index");
  const index = new WorkspaceIndex(":memory:", workspacePath);
  try {
    await index.sync();
    assert.deepEqual(
      filenames(
        index.queryProperty({
          key: "type",
          value: { type: "string", value: " TASK " },
        }),
      ),
      ["task"],
    );
    assert.deepEqual(
      filenames(
        index.queryProperty({
          key: "completed",
          value: { type: "boolean", value: false },
        }),
      ),
      ["task"],
    );
    assert.equal(index.queryProperty({ key: "tags" }).flatMap(({ values }) => values).length, 3);
    assert.deepEqual(
      index.searchText("learning").map(({ file }) => file.filename),
      ["task"],
    );
    assert.equal(index.searchText("needle")[0]?.matchedIn, "filename");
    const contentResult = index.searchText("searchable fragment")[0];
    assert.equal(contentResult?.matchedIn, "content");
    assert.match(contentResult?.excerpt ?? "", /Exact searchable fragment/);
    const indexedTask = index.readDocuments([taskPath.replace(/\\/g, "/")])[0];
    assert.equal(indexedTask?.source.includes("Machine-learning"), true);
    assert.equal(indexedTask?.file.sizeBytes, Number((await stat(taskPath)).size));
    assert.equal(index.readDocuments([notePath.replace(/\\/g, "/")])[0]?.source.includes("details"), true);

    await writeFile(notePath, "# Ordinary\nReplacement searchable text with a different size.\n");
    await index.refreshPath(notePath);
    assert.deepEqual(index.searchText("searchable fragment"), []);
    assert.deepEqual(
      index.searchText("replacement searchable").map(({ file }) => file.filename),
      ["needle-filename"],
    );

    await unlink(taskPath);
    await index.refreshPath(taskPath);
    assert.deepEqual(index.queryProperty({ key: "type" }), []);
  } finally {
    index.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("indexes valid and malformed task candidates without including ordinary notes", async () => {
  await withWorkspaceIndex(
    "obim-task-candidates-",
    {
      "valid.md": "---\ntype: task\n---\n",
      "broken.md": "---\ntype: task\nbroken: [\n---\n",
      "quoted-broken.md": '---\ntype: "task" # keep\nbroken: [\n---\n',
      "ordinary.md": "---\ntype: note\n---\ntype: task\n",
    },
    (index) => {
      assert.deepEqual(
        filenames(
          index.queryProperty({
            key: "type",
            value: { type: "string", value: "task" },
            includeInvalidTaskCandidates: true,
          }),
        ),
        ["broken", "quoted-broken", "valid"],
      );
      assert.deepEqual(filenames(index.queryProperty({ key: "type", value: { type: "string", value: "task" } })), [
        "valid",
      ]);
    },
  );
});

test("aggregates authored field spellings and semantic types deterministically", async () => {
  await withWorkspaceIndex(
    "obim-field-observations-",
    {
      "one.md": "---\nAuthor: Ada\npublished: 2026-07-31\n---\n",
      "two.md": "---\nauthor: [Grace]\npublished: 2026-07-31T12:00:00Z\n---\n",
      "three.md": "---\nAuthor: Lin\nempty:\n---\n",
    },
    (index) => {
      assert.deepEqual(index.listFrontmatterFields(), [
        { key: "Author", type: "text", count: 2 },
        { key: "author", type: "list", count: 1 },
        { key: "empty", type: "unsupported", count: 1 },
        { key: "published", type: "date", count: 1 },
        { key: "published", type: "datetime", count: 1 },
      ]);
    },
  );
});

test("uses exact matching consistently across collisions and authored value order", async () => {
  await withWorkspaceIndex(
    "obim-property-identity-",
    {
      "01-collision.md": ["---", "Author: [Ada, Grace]", "author: Lin", "Topic: First", "State: open", "---", ""].join(
        "\n",
      ),
      "02-title.md": ["---", "Author: [Byron]", "topic: Second", "State: [open]", "---", ""].join("\n"),
      "03-lower.md": ["---", "author: Hopper", "Topic: Third", "State: closed", "---", ""].join("\n"),
    },
    async (index, workspacePath) => {
      const exactTitle = index.queryProperty({ key: "Author" });
      assert.deepEqual(filenames(exactTitle), ["01-collision", "02-title"]);
      assert.deepEqual(exactTitle[0]?.values, [
        { type: "string", value: "Ada" },
        { type: "string", value: "Grace" },
      ]);

      const exactLower = index.queryProperty({ key: "author" });
      assert.deepEqual(filenames(exactLower), ["01-collision", "03-lower"]);
      assert.deepEqual(exactLower[0]?.values, [{ type: "string", value: "Lin" }]);
      assert.deepEqual(index.queryProperty({ key: "AUTHOR" }), []);

      await index.refreshPath(path.join(workspacePath, "01-collision.md"));
    },
  );
});

test("returns documents and list values in authored order and preserves authored date source", async () => {
  await withWorkspaceIndex(
    "obim-property-order-",
    {
      "Z-last.md": "---\npublished: 2026-07-16T00:00:00Z\nsteps: [z-first, z-second]\n---\n",
      "a-first.md": "---\npublished: 2026-07-14T00:00:00+02:00\nsteps: [a-first, a-second, a-third]\n---\n",
      "middle.md": "---\npublished: 2026-07-15T00:00:00Z\nsteps: [middle-first, middle-second]\n---\n",
    },
    (index) => {
      const dates = index.queryProperty({ key: "published" });
      assert.deepEqual(filenames(dates), ["a-first", "middle", "Z-last"]);
      assert.deepEqual(dates[0]?.values, [{ type: "date", value: "2026-07-14T00:00:00+02:00" }]);
      assert.deepEqual(
        filenames(
          index.queryProperty({
            key: "published",
            value: { type: "date", value: " 2026-07-14T00:00:00+02:00 " },
          }),
        ),
        ["a-first"],
      );
      assert.deepEqual(index.queryProperty({ key: "steps" })[0]?.values, [
        { type: "string", value: "a-first" },
        { type: "string", value: "a-second" },
        { type: "string", value: "a-third" },
      ]);
    },
  );
});

test("pages property matches at 99, 100, 101, and 201 documents", async () => {
  const filenamesByPosition = Array.from({ length: 201 }, (_, index) => `note-${String(index + 1).padStart(3, "0")}`);
  const files = Object.fromEntries(
    filenamesByPosition.map((filename, index) => {
      const position = index + 1;
      const keys = [
        ...(position <= 99 ? ["group-99: true"] : []),
        ...(position <= 100 ? ["group-100: true"] : []),
        ...(position <= 101 ? ["group-101: true"] : []),
        "group-201: true",
      ];
      return [`${filename}.md`, `---\n${keys.join("\n")}\n---\n`];
    }),
  );

  await withWorkspaceIndex("obim-property-pages-", files, (index) => {
    const page = (key: string, offset = 0) => filenames(index.queryProperty({ key, limit: 100, offset }));

    assert.deepEqual(page("group-99"), filenamesByPosition.slice(0, 99));
    assert.deepEqual(page("group-99", 100), []);

    assert.deepEqual(page("group-100"), filenamesByPosition.slice(0, 100));
    assert.deepEqual(page("group-100", 100), []);

    assert.deepEqual(page("group-101"), filenamesByPosition.slice(0, 100));
    assert.deepEqual(page("group-101", 100), filenamesByPosition.slice(100, 101));

    assert.deepEqual(page("group-201"), filenamesByPosition.slice(0, 100));
    assert.deepEqual(page("group-201", 100), filenamesByPosition.slice(100, 200));
    assert.deepEqual(page("group-201", 200), filenamesByPosition.slice(200));
  });
});

test("keeps oversized notes filename-only while retaining indexed field evidence", async () => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "obim-large-index-"));
  const notePath = path.join(workspacePath, "oversized-note.md");
  const rendererPath = notePath.replace(/\\/g, "/");
  await writeFile(notePath, "---\ntype: oversized\ntags: [one, two]\npriority: 2\n---\nsecret body phrase\n");
  await truncate(notePath, OVERSIZED_TEST_BYTES);

  const { WorkspaceIndex } = await import("../src/main/workspace-index");
  const index = new WorkspaceIndex(":memory:", workspacePath);
  try {
    await index.sync();
    assert.equal(index.searchText("oversized")[0]?.matchedIn, "filename");
    assert.deepEqual(index.searchText("secret body"), []);
    assert.deepEqual(index.queryProperty({ key: "type" })[0]?.values, []);
    const oversized = index.readDocuments([rendererPath])[0];
    assert.equal(oversized?.source, "");
    assert.equal(oversized?.file.sizeBytes, OVERSIZED_TEST_BYTES);
    assert.deepEqual(
      index.listFrontmatterFields(),
      [
        { key: "priority", type: "number" },
        { key: "tags", type: "list" },
        { key: "type", type: "text" },
      ].map((field) => ({ ...field, count: 1 })),
    );

    await writeFile(notePath, "---\ntype: small\n---\nnow indexed body\n");
    await index.refreshPath(notePath);
    assert.equal(index.searchText("indexed body")[0]?.matchedIn, "content");
    assert.equal(index.queryProperty({ key: "type" })[0]?.values[0]?.value, "small");

    await truncate(notePath, OVERSIZED_TEST_BYTES);
    await index.refreshPath(notePath);
    assert.deepEqual(index.searchText("indexed body"), []);
    assert.deepEqual(index.queryProperty({ key: "type" })[0]?.values, []);
    assert.deepEqual(index.listFrontmatterFields(), [{ key: "type", type: "text", count: 1 }]);
  } finally {
    index.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("validates workspace property requests without weakening the query contract", async () => {
  const { parseWorkspacePropertyQueryRequest } = await import("../src/main/workspace-index");
  const request: unknown = {
    key: "completed",
    value: { type: "boolean", value: false },
    limit: 99,
    offset: 201,
  };
  const query: WorkspacePropertyQuery | null = parseWorkspacePropertyQueryRequest(request);

  assert.deepEqual(query, request);
  [
    null,
    {},
    { key: "" },
    { key: "type", value: { type: "number", value: Number.NaN } },
    { key: "type", limit: 0 },
    { key: "type", limit: 101 },
    { key: "type", offset: -1 },
    { key: "type", includeInvalidTaskCandidates: "yes" },
    { key: "tags", includeInvalidTaskCandidates: true },
  ].forEach((request) => assert.equal(parseWorkspacePropertyQueryRequest(request), null));
});

test("completed task filtering happens before the text search limit without unindexing notes", async () => {
  await withWorkspaceIndex(
    "obim-completed-search-",
    {
      "done.md": "---\ntype: task\ntask-status: done\n---\nneedle",
      "open.md": "---\ntype: task\n---\nneedle",
      "ordinary.md": "---\ntask-status: done\n---\nneedle",
      "cancelled.md": "---\ntype: task\ntask-status: cancelled\n---\nneedle",
      "list-type.md": "---\ntype: [task]\ntask-status: done\n---\nneedle",
    },
    (index) => {
      const all = index.searchText("needle");
      assert.equal(all.length, 5);
      const filtered = index.searchText("needle", 30, true);
      assert.equal(filtered.length, 4);
      assert(!filtered.some((result) => result.file.filename === "done"));
      assert(index.searchText("needle", 1, true).length === 1);
      assert(index.searchText("needle").some((result) => result.file.filename === "done"));
    },
  );
});

test("scalar property queries do not classify YAML lists as task metadata", async () => {
  await withWorkspaceIndex(
    "obim-scalar-task-search-",
    {
      "task.md": "---\ntype: task\ntask-status: done\n---\n",
      "list.md": "---\ntype: [task]\ntask-status: [done]\n---\n",
    },
    (index) => {
      assert.deepEqual(
        filenames(index.queryProperty({ key: "type", value: { type: "string", value: "task" }, scalarOnly: true })),
        ["task"],
      );
      assert.deepEqual(filenames(index.queryProperty({ key: "task-status", scalarOnly: true })), ["task"]);
      assert.equal(index.queryProperty({ key: "type", value: { type: "string", value: "task" } }).length, 2);
    },
  );
});
