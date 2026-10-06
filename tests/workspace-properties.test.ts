import assert from "node:assert/strict";

import { test, vi } from "vitest";

import type {
  FrontmatterScalar,
  IndexedDocument,
  WorkspaceIndexFile,
  WorkspacePropertyMatch,
  WorkspacePropertyQuery,
} from "../src/shared/workspace-index";
import {
  loadCurrentWorkspaceDocuments,
  loadCurrentWorkspaceFrontmatterFields,
  loadCurrentWorkspacePropertySuggestions,
  queryWorkspacePropertyMatches,
  readIndexedDocuments,
} from "../src/renderer/src/features/workspace/workspaceIndexOverlay";

const file = (path: string): WorkspaceIndexFile => ({
  id: path,
  filename: path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const indexedDocument = (path: string, source = ""): IndexedDocument => ({
  file: file(path),
  source,
});

const text = (value: string): FrontmatterScalar => ({ type: "string", value });

type IndexedPropertyFixture = {
  file: WorkspaceIndexFile;
  properties: { key: string; values: FrontmatterScalar[] }[];
};

const normalizedValue = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

const scalarMatches = (actual: FrontmatterScalar, expected: FrontmatterScalar) => {
  if (actual.type !== expected.type) return false;
  if (actual.type === "null" || expected.type === "null") return true;
  if ((actual.type === "string" || actual.type === "date") && (expected.type === "string" || expected.type === "date"))
    return normalizedValue(actual.value) === normalizedValue(expected.value);
  return actual.value === expected.value;
};

const propertyQueryMock = (fixtures: readonly IndexedPropertyFixture[]) =>
  vi.fn(async (request: WorkspacePropertyQuery): Promise<WorkspacePropertyMatch[]> => {
    const { key, value, limit = 100, offset = 0 } = request;
    const matches = fixtures.flatMap<WorkspacePropertyMatch>((fixture) => {
      const properties = fixture.properties.filter((property) => property.key === key);
      const values = properties.flatMap((property) => property.values);
      if (!properties.length || (value && !values.some((item) => scalarMatches(item, value)))) return [];
      return [{ file: fixture.file, values }];
    });
    return matches.slice(offset, offset + limit);
  });

const propertyFixture = (path: string, key: string, values: FrontmatterScalar[]): IndexedPropertyFixture => ({
  file: file(path),
  properties: [{ key, values }],
});

test("property queries page by 100 while preserving exact key and value intent", async () => {
  const fixtures = [
    ...Array.from({ length: 201 }, (_, index) =>
      propertyFixture(`/notes/Match-${index}.md`, "Status", [text("  Open  ")]),
    ),
    propertyFixture("/notes/Wrong-key.md", "status", [text("Open")]),
    propertyFixture("/notes/Wrong-value.md", "Status", [text("Closed")]),
  ];
  const queryPage = propertyQueryMock(fixtures);
  const value = text("open");

  const matches = await queryWorkspacePropertyMatches({ key: "Status", value }, queryPage);

  assert.equal(matches.length, 201);
  assert.deepEqual(
    queryPage.mock.calls.map(([request]) => request),
    [0, 100, 200].map((offset) => ({
      key: "Status",
      value,
      limit: 100,
      offset,
    })),
  );
});

test("an exact 100-result property page triggers a final empty-page request", async () => {
  const queryPage = propertyQueryMock(
    Array.from({ length: 100 }, (_, index) => propertyFixture(`/notes/Match-${index}.md`, "tags", [text("one")])),
  );

  const matches = await queryWorkspacePropertyMatches({ key: "tags" }, queryPage);

  assert.equal(matches.length, 100);
  assert.deepEqual(
    queryPage.mock.calls.map(([request]) => request.offset),
    [0, 100],
  );
  assert.equal((await queryPage.mock.results[1]!.value).length, 0);
});

test("indexed documents are deduplicated and read in batches of 100", async () => {
  const paths = Array.from({ length: 205 }, (_, index) => `/notes/${index}.md`);
  const readDocuments = vi.fn(async (batch: string[]) => batch.map((path) => indexedDocument(path)));

  const documents = await readIndexedDocuments([...paths, paths[0]!, paths[204]!], readDocuments);

  assert.deepEqual(
    readDocuments.mock.calls.map(([batch]) => batch.length),
    [100, 100, 5],
  );
  assert.equal(readDocuments.mock.calls[0]![0][0], paths[0]);
  assert.equal(readDocuments.mock.calls[1]![0][0], paths[100]);
  assert.equal(readDocuments.mock.calls[2]![0][0], paths[200]);
  assert.deepEqual(
    documents.map(({ file }) => file.path),
    paths,
  );
});

test("current workspace documents union indexed candidates with open buffers", async () => {
  const indexedPath = "/notes/Indexed.md";
  const editedPath = "/notes/Edited.md";
  const newPath = "/notes/New.md";
  const queryPage = propertyQueryMock([
    propertyFixture(indexedPath, "type", [text("task")]),
    propertyFixture(editedPath, "type", [text("task")]),
  ]);
  const readDocuments = vi.fn(async (paths: string[]) =>
    paths.flatMap((path) => (path === newPath ? [] : [indexedDocument(path, `disk:${path}`)])),
  );

  const documents = await loadCurrentWorkspaceDocuments({
    fileBuffersByPath: {
      [editedPath]: { editorText: "edited source" },
      [newPath]: { editorText: "new source" },
    },
    query: { key: "type", value: text("task") },
    queryPage,
    readDocuments,
    workspacePath: "/notes",
  });
  const byPath = new Map(documents.map((document) => [document.file.path, document]));

  assert.equal(byPath.get(indexedPath)?.source, `disk:${indexedPath}`);
  assert.equal(byPath.get(editedPath)?.source, "edited source");
  assert.equal(byPath.get(newPath)?.source, "new source");
  assert.equal(byPath.get(newPath)?.file.filename, "New");
  assert.equal(byPath.get(newPath)?.file.relativePath, "New.md");
  assert.deepEqual(readDocuments.mock.calls[0]![0], [indexedPath, editedPath, newPath]);
});

test("buffer values replace stale, deleted, and invalid indexed values and include new values", async () => {
  const diskPath = "/notes/Disk.md";
  const editedPath = "/notes/Edited.md";
  const deletedPath = "/notes/Deleted.md";
  const invalidPath = "/notes/Invalid.md";
  const newPath = "/notes/New.md";
  const queryPage = propertyQueryMock([
    propertyFixture(diskPath, "Author", [text("Ada")]),
    propertyFixture(editedPath, "Author", [text("stale")]),
    propertyFixture(deletedPath, "Author", [text("deleted")]),
    propertyFixture(invalidPath, "Author", [text("invalid")]),
  ]);

  const values = await loadCurrentWorkspacePropertySuggestions({
    fileBuffersByPath: {
      [editedPath]: { editorText: "---\nAuthor: Grace\n---\n" },
      [deletedPath]: { editorText: "---\nTitle: No author\n---\n" },
      [invalidPath]: { editorText: "---\nAuthor: [broken\n---\n" },
      [newPath]: { editorText: "---\nauthor: Lin\n---\n" },
    },
    query: { key: "Author" },
    queryPage,
  });

  assert.deepEqual(values, ["Ada", "Grace"]);
  assert.deepEqual(queryPage.mock.calls[0]![0], {
    key: "Author",
    limit: 100,
    offset: 0,
  });
});

test("value discovery always distinguishes exact authored keys", async () => {
  const queryPage = propertyQueryMock([
    {
      file: file("/notes/Colliding.md"),
      properties: [
        { key: "Author", values: [text("Ada")] },
        { key: "author", values: [text("Grace")] },
      ],
    },
  ]);

  assert.deepEqual(
    await loadCurrentWorkspacePropertySuggestions({
      fileBuffersByPath: {},
      query: { key: "author" },
      queryPage,
    }),
    ["Grace"],
  );
  assert.deepEqual(
    await loadCurrentWorkspacePropertySuggestions({
      fileBuffersByPath: {},
      query: { key: "AUTHOR" },
      queryPage,
    }),
    [],
  );
});

test("live overlays ignore non-Markdown editor buffers", async () => {
  const markdownPath = "/notes/Real.md";
  const textPath = "/notes/Fake.txt";
  const fileBuffersByPath = {
    [markdownPath]: { editorText: "---\nAuthor: Ada\n---\n" },
    [textPath]: { editorText: "---\nAuthor: Wrong\n---\n" },
  };

  const documents = await loadCurrentWorkspaceDocuments({
    fileBuffersByPath,
    query: { key: "Author" },
    queryPage: async () => [],
    readDocuments: async () => [],
    workspacePath: "/notes",
  });
  const suggestions = await loadCurrentWorkspacePropertySuggestions({
    fileBuffersByPath,
    query: { key: "Author" },
    queryPage: async () => [],
  });

  assert.deepEqual(
    documents.map(({ file }) => file.path),
    [markdownPath],
  );
  assert.deepEqual(suggestions, ["Ada"]);
});

test("field observations replace indexed types with unsaved exact-key types", async () => {
  const path = "/notes/Open.md";
  const observations = await loadCurrentWorkspaceFrontmatterFields({
    fileBuffersByPath: { [path]: { editorText: "---\nAuthor: [Ada]\nauthor: Grace\n---\n" } },
    listFields: async () => [
      { key: "Author", type: "text", count: 1 },
      { key: "author", type: "text", count: 1 },
    ],
    readDocuments: async () => [indexedDocument(path, "---\nAuthor: Ada\nauthor: Grace\n---\n")],
  });

  assert.deepEqual(observations, [
    { key: "Author", type: "list", count: 1 },
    { key: "author", type: "text", count: 1 },
  ]);
});
