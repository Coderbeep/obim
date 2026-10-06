/**
 * Builds renderer-facing workspace views from the disposable disk index while
 * treating unsaved Markdown editor buffers as the authoritative current state.
 */
import { frontmatterFieldType, type FrontmatterFieldType } from "@shared/frontmatter-fields";
import { parseFrontmatter, type FrontmatterValue } from "@shared/frontmatter";
import { isMarkdownFile } from "@shared/mime-types";
import type {
  FrontmatterScalar,
  IndexedDocument,
  WorkspacePropertyMatch,
  WorkspacePropertyQuery,
  WorkspaceFrontmatterFieldObservation,
} from "@shared/workspace-index";
import {
  createBufferedWorkspaceIndexFile,
  normalizeWorkspacePropertyText,
  WORKSPACE_INDEX_PAGE_SIZE,
} from "@shared/workspace-index";

type FileBuffers = Readonly<Record<string, { readonly editorText: string } | undefined>>;
type PropertyQuery = Omit<WorkspacePropertyQuery, "limit" | "offset">;

const compareText = (left: string, right: string) =>
  left.localeCompare(right, "en", { sensitivity: "base" }) ||
  left.localeCompare(right, "en", { sensitivity: "variant" });

/** Returns open Markdown buffers eligible to overlay the Markdown-only index. */
const markdownBuffers = (fileBuffersByPath: FileBuffers) =>
  Object.entries(fileBuffersByPath).filter(
    (entry): entry is [string, { readonly editorText: string }] => Boolean(entry[1]) && isMarkdownFile(null, entry[0]),
  );

/**
 * Reads every page for a property query. Pagination remains internal so callers
 * receive one complete, ordered result set.
 */
export const queryWorkspacePropertyMatches = async (
  query: PropertyQuery,
  queryPage: (request: WorkspacePropertyQuery) => Promise<WorkspacePropertyMatch[]> = window.api.queryWorkspaceProperty,
) => {
  const readPage = async (offset: number, matches: WorkspacePropertyMatch[]): Promise<WorkspacePropertyMatch[]> => {
    const page = await queryPage({ ...query, limit: WORKSPACE_INDEX_PAGE_SIZE, offset });
    matches.push(...page);
    if (page.length < WORKSPACE_INDEX_PAGE_SIZE) return matches;
    return readPage(offset + WORKSPACE_INDEX_PAGE_SIZE, matches);
  };
  return readPage(0, []);
};

/** Reads unique indexed documents in IPC-sized batches while preserving path order. */
export const readIndexedDocuments = async (
  paths: readonly string[],
  readBatch: (paths: string[]) => Promise<IndexedDocument[]> = window.api.readIndexedDocuments,
) => {
  const uniquePaths = [...new Set(paths)];
  const batches: string[][] = [];
  for (let index = 0; index < uniquePaths.length; index += WORKSPACE_INDEX_PAGE_SIZE) {
    batches.push(uniquePaths.slice(index, index + WORKSPACE_INDEX_PAGE_SIZE));
  }
  const documents = await Promise.all(batches.map((batch) => readBatch(batch)));
  return documents.flat();
};

/**
 * Loads documents matching an indexed query and overlays every open Markdown
 * buffer. A buffer replaces indexed source for its path; a not-yet-indexed
 * buffer receives transient file metadata rooted at `workspacePath`.
 */
export const loadCurrentWorkspaceDocuments = async ({
  fileBuffersByPath,
  query,
  queryPage,
  readDocuments,
  workspacePath,
}: {
  fileBuffersByPath: FileBuffers;
  query: PropertyQuery;
  queryPage?: (request: WorkspacePropertyQuery) => Promise<WorkspacePropertyMatch[]>;
  readDocuments?: (paths: string[]) => Promise<IndexedDocument[]>;
  workspacePath: string;
}) => {
  const buffers = markdownBuffers(fileBuffersByPath);
  const matches = await queryWorkspacePropertyMatches(query, queryPage);
  const paths = [...matches.map(({ file }) => file.path), ...buffers.map(([path]) => path)];
  const indexed = await readIndexedDocuments(paths, readDocuments);
  const documents = new Map(indexed.map((document) => [document.file.path, document]));

  for (const [path, buffer] of buffers) {
    const current = documents.get(path);
    documents.set(path, {
      file: current?.file ?? createBufferedWorkspaceIndexFile(path, workspacePath),
      ...(current?.modifiedAtMs === undefined ? {} : { modifiedAtMs: current.modifiedAtMs }),
      source: buffer.editorText,
    });
  }
  return [...documents.values()];
};

const propertyMatches = (key: string, query: Pick<WorkspacePropertyQuery, "key">) => key === query.key;

const scalarMatches = (value: FrontmatterValue, expected: FrontmatterScalar) => {
  if (value.kind !== expected.type) return false;
  if (value.kind === "null") return true;
  if (value.kind === "string")
    return normalizeWorkspacePropertyText(value.value) === normalizeWorkspacePropertyText(String(expected.value));
  if (value.kind === "date")
    return normalizeWorkspacePropertyText(value.source) === normalizeWorkspacePropertyText(String(expected.value));
  return value.value === expected.value;
};

/**
 * Extracts textual values from valid frontmatter after applying the same key
 * and optional scalar-value criteria as the workspace index.
 */
const propertyValues = (source: string, query: PropertyQuery): string[] => {
  const parsed = parseFrontmatter(source);
  if (parsed.kind !== "valid") return [];
  const properties = parsed.properties.filter(({ key }) => propertyMatches(key, query));
  if (
    query.value &&
    !properties.some(({ value }) =>
      value.kind === "list"
        ? value.value.some((item) => scalarMatches(item, query.value!))
        : scalarMatches(value, query.value!),
    )
  )
    return [];
  return properties.flatMap(({ value }) => {
    const values = value.kind === "list" ? value.value : [value];
    return values.flatMap((item) =>
      item.kind === "string" ? [item.value] : item.kind === "date" ? [item.source] : [],
    );
  });
};

/**
 * Returns normalized, deduplicated suggestions from indexed values, caller
 * values, and unsaved Markdown buffers. Buffered values replace stale indexed
 * values for the same path.
 */
export const loadCurrentWorkspacePropertySuggestions = async ({
  currentValues = [],
  fileBuffersByPath,
  query,
  queryPage,
}: {
  currentValues?: readonly string[];
  fileBuffersByPath: FileBuffers;
  query: PropertyQuery;
  queryPage?: (request: WorkspacePropertyQuery) => Promise<WorkspacePropertyMatch[]>;
}) => {
  const buffers = markdownBuffers(fileBuffersByPath);
  const matches = await queryWorkspacePropertyMatches(query, queryPage);
  const values = [...currentValues];
  const matchedPaths = new Set<string>();

  for (const match of matches) {
    const { path } = match.file;
    matchedPaths.add(path);
    const buffer = isMarkdownFile(null, path) ? fileBuffersByPath[path] : undefined;
    if (buffer) values.push(...propertyValues(buffer.editorText, query));
    else
      values.push(
        ...match.values.flatMap((value) => (value.type === "string" || value.type === "date" ? [value.value] : [])),
      );
  }
  for (const [path, buffer] of buffers) {
    if (!matchedPaths.has(path)) values.push(...propertyValues(buffer.editorText, query));
  }

  const byIdentity = new Map<string, string>();
  for (const value of values) {
    const display = value.trim();
    const identity = normalizeWorkspacePropertyText(display);
    if (identity && !byIdentity.has(identity)) byIdentity.set(identity, display);
  }
  return [...byIdentity.values()].sort(compareText);
};

/** Overlays unsaved buffers on exact-key field observations from the disposable index. */
export const loadCurrentWorkspaceFrontmatterFields = async ({
  fileBuffersByPath,
  listFields = window.api.listWorkspaceFrontmatterFields,
  readDocuments,
}: {
  fileBuffersByPath: FileBuffers;
  listFields?: () => Promise<WorkspaceFrontmatterFieldObservation[]>;
  readDocuments?: (paths: string[]) => Promise<IndexedDocument[]>;
}) => {
  const counts = new Map<string, Map<FrontmatterFieldType, number>>();
  const change = (key: string, type: FrontmatterFieldType, amount: number) => {
    const byType = counts.get(key) ?? new Map<FrontmatterFieldType, number>();
    byType.set(type, (byType.get(type) ?? 0) + amount);
    counts.set(key, byType);
  };
  for (const observation of await listFields()) change(observation.key, observation.type, observation.count);

  const buffers = markdownBuffers(fileBuffersByPath);
  const indexed = await readIndexedDocuments(
    buffers.map(([path]) => path),
    readDocuments,
  );
  for (const document of indexed) {
    const parsed = parseFrontmatter(document.source);
    if (parsed.kind === "valid")
      for (const property of parsed.properties) change(property.key, frontmatterFieldType(property.value), -1);
  }
  for (const [, buffer] of buffers) {
    const parsed = parseFrontmatter(buffer.editorText);
    if (parsed.kind === "valid")
      for (const property of parsed.properties) change(property.key, frontmatterFieldType(property.value), 1);
  }

  return [...counts].flatMap(([key, byType]) =>
    [...byType].flatMap(([type, count]) => (count > 0 ? [{ key, type, count }] : [])),
  );
};
