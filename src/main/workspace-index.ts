/**
 * Maintains a disposable SQLite index of workspace Markdown files for full-text
 * search, frontmatter queries, field discovery, and indexed document reads.
 */
import crypto from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as NativeDatabase } from "node:sqlite";

import { parseFrontmatter, type FrontmatterValue } from "@shared/frontmatter";
import { markdownPdfReferenceLinks } from "@shared/pdf-reference-links";
import { frontmatterFieldType, type FrontmatterFieldType } from "@shared/frontmatter-fields";
import { MAX_FULL_TEXT_EDITOR_BYTES } from "@shared/large-files";
import { isMarkdownFile } from "@shared/mime-types";
import { getFilenameNoExtFromPath, getRelativePathFromPath } from "@shared/pathUtils";
import { isIgnoredWorkspaceEntry } from "@shared/workspace-entry";
import {
  normalizeWorkspacePropertyText,
  WORKSPACE_INDEX_PAGE_SIZE,
  type FrontmatterScalar,
  type IndexedDocument,
  type IndexedPdfReference,
  type WorkspaceIndexFile,
  type WorkspaceFrontmatterFieldObservation,
  type WorkspacePropertyMatch,
  type WorkspacePropertyQuery,
  type WorkspaceTextSearchResult,
} from "@shared/workspace-index";
import { lookup } from "mime-types";
import { mapWithConcurrency } from "./async-pool";
import { readLargeTextPreview } from "./large-file";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const SCHEMA_VERSION = 9;
export const WORKSPACE_INDEX_FILE_CONCURRENCY = 16;

// Database records ------------------------------------------------------------

type DocumentRow = {
  id: number;
  file_id: string;
  filename: string;
  mime_type: string;
  mtime_ms: number;
  path: string;
  relative_path: string;
  size: number;
  source: string;
  task_candidate: number;
};
type FingerprintRow = Pick<DocumentRow, "id" | "file_id" | "path"> & { mtime_ms: number; size: number };
type FrontmatterValueRow = {
  boolean_value: number | null;
  item_ordinal: number | null;
  number_value: number | null;
  property_ordinal: number | null;
  text_value: string | null;
  value_type: FrontmatterScalar["type"] | null;
};
type MarkdownFileEntry = { file: WorkspaceIndexFile; fsPath: string; mtimeMs: number; size: number };
type ProjectedFrontmatterKey = {
  key: string;
  ordinal: number;
  type: FrontmatterFieldType;
};
type ProjectedFrontmatterValue = {
  booleanValue: number | null;
  itemOrdinal: number;
  key: string;
  normalizedText: string | null;
  numberValue: number | null;
  propertyOrdinal: number;
  textValue: string | null;
  type: FrontmatterScalar["type"];
};

// Shared conversions ----------------------------------------------------------

const toRendererPath = (value: string) => value.replace(/\\/g, "/");
const asDatabaseRow = <T>(row: Record<string, unknown>): T => row as T;
const createFileId = (filePath: string, stats: Awaited<ReturnType<typeof lstat>>) =>
  stats.ino > 0 && stats.dev >= 0
    ? `${stats.dev}-${stats.ino}`
    : crypto.createHash("sha1").update(filePath).digest("hex");

const SEARCH_EXCERPT_LENGTH = 156;

/** Builds a compact, single-line context preview around the first matching phrase. */
export const createSearchExcerpt = (source: string, query: string, maxLength = SEARCH_EXCERPT_LENGTH) => {
  const text = source.replace(/\s+/g, " ").trim();
  if (!text) return undefined;

  const normalizedText = text.toLocaleLowerCase();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const queryIndex = normalizedText.indexOf(normalizedQuery);
  const firstToken = normalizedQuery.split(/\s+/).find(Boolean) ?? "";
  const matchIndex = queryIndex >= 0 ? queryIndex : normalizedText.indexOf(firstToken);
  if (text.length <= maxLength) return text;

  const targetStart = Math.max(0, matchIndex - Math.floor((maxLength - normalizedQuery.length) / 2));
  const firstSpace = targetStart > 0 ? text.indexOf(" ", targetStart) : 0;
  const start = firstSpace >= 0 && firstSpace - targetStart < 24 ? firstSpace + 1 : targetStart;
  const targetEnd = Math.min(text.length, start + maxLength);
  const lastSpace = targetEnd < text.length ? text.lastIndexOf(" ", targetEnd) : text.length;
  const end = lastSpace > start ? lastSpace : targetEnd;

  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
};

// Frontmatter projection ------------------------------------------------------

/**
 * Projects one parsed scalar into the typed columns used by SQLite. Lists are
 * expanded by `projectFrontmatter` and are therefore ignored here.
 */
const projectScalarValue = (
  key: string,
  value: FrontmatterValue,
  propertyOrdinal: number,
  itemOrdinal: number,
): ProjectedFrontmatterValue | null => {
  if (value.kind === "list" || value.kind === "unsupported") return null;
  if (value.kind === "null")
    return {
      key,
      propertyOrdinal,
      itemOrdinal,
      type: "null",
      textValue: null,
      normalizedText: null,
      numberValue: null,
      booleanValue: null,
    };
  if (value.kind === "number")
    return {
      key,
      propertyOrdinal,
      itemOrdinal,
      type: "number",
      textValue: value.source,
      normalizedText: null,
      numberValue: value.value,
      booleanValue: null,
    };
  if (value.kind === "boolean")
    return {
      key,
      propertyOrdinal,
      itemOrdinal,
      type: "boolean",
      textValue: String(value.value),
      normalizedText: null,
      numberValue: null,
      booleanValue: value.value ? 1 : 0,
    };
  const textValue = value.kind === "date" ? value.source : value.value;
  return {
    key,
    propertyOrdinal,
    itemOrdinal,
    type: value.kind,
    textValue,
    normalizedText: normalizeWorkspacePropertyText(textValue),
    numberValue: null,
    booleanValue: null,
  };
};

/**
 * Converts valid frontmatter into separately indexed property keys and scalar
 * values while preserving authored property and list-item ordering.
 */
const projectFrontmatter = (
  source: string,
): { keys: ProjectedFrontmatterKey[]; values: ProjectedFrontmatterValue[] } => {
  const parsed = parseFrontmatter(source);
  if (parsed.kind !== "valid") return { keys: [], values: [] };
  return {
    keys: parsed.properties.map(({ key, value }, ordinal) => ({
      key,
      ordinal,
      type: frontmatterFieldType(value),
    })),
    values: parsed.properties.flatMap(({ key, value }, propertyOrdinal) => {
      return value.kind === "list"
        ? value.value.flatMap((item, itemOrdinal) => projectScalarValue(key, item, propertyOrdinal, itemOrdinal) ?? [])
        : (projectScalarValue(key, value, propertyOrdinal, 0) ?? []);
    }),
  };
};

/** Returns the scalar frontmatter values that would be stored for a document. */
export const projectFrontmatterValues = (source: string): ProjectedFrontmatterValue[] =>
  projectFrontmatter(source).values;

// Database row mapping --------------------------------------------------------

const fileFromRow = (row: DocumentRow): WorkspaceIndexFile => ({
  id: row.file_id,
  filename: row.filename,
  relativePath: row.relative_path,
  path: row.path,
  sizeBytes: Number(row.size),
  isDirectory: false,
  mimeType: row.mime_type,
});

const scalarFromRow = (row: FrontmatterValueRow): FrontmatterScalar => {
  if (row.value_type === null) throw new Error("Cannot decode an absent property value.");
  if (row.value_type === "null") return { type: "null", value: null };
  if (row.value_type === "number") return { type: "number", value: Number(row.number_value) };
  if (row.value_type === "boolean") return { type: "boolean", value: Boolean(row.boolean_value) };
  return { type: row.value_type, value: row.text_value ?? "" };
};

// Request validation ----------------------------------------------------------

const isValidPropertyScalar = (value: unknown): value is FrontmatterScalar => {
  if (!value || typeof value !== "object") return false;
  const scalar = value as { type?: unknown; value?: unknown };
  return (
    (scalar.type === "null" && scalar.value === null) ||
    ((scalar.type === "string" || scalar.type === "date") && typeof scalar.value === "string") ||
    (scalar.type === "number" && typeof scalar.value === "number" && Number.isFinite(scalar.value)) ||
    (scalar.type === "boolean" && typeof scalar.value === "boolean")
  );
};

/**
 * Validates an untrusted renderer request and returns the typed property query
 * accepted by the index, or `null` when any field is invalid.
 */
export const parseWorkspacePropertyQueryRequest = (request: unknown): WorkspacePropertyQuery | null => {
  if (!request || typeof request !== "object") return null;
  const { key, value, limit, offset, includeInvalidTaskCandidates, scalarOnly } = request as Record<string, unknown>;
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 256 ||
    (value !== undefined && !isValidPropertyScalar(value)) ||
    (limit !== undefined &&
      (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > WORKSPACE_INDEX_PAGE_SIZE)) ||
    (offset !== undefined && (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0)) ||
    (scalarOnly !== undefined && typeof scalarOnly !== "boolean") ||
    (includeInvalidTaskCandidates !== undefined && typeof includeInvalidTaskCandidates !== "boolean") ||
    (includeInvalidTaskCandidates === true &&
      (key !== "type" || !isValidPropertyScalar(value) || value.type !== "string" || value.value !== "task"))
  )
    return null;
  return {
    key,
    ...(value === undefined ? {} : { value }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
    ...(includeInvalidTaskCandidates === undefined ? {} : { includeInvalidTaskCandidates }),
    ...(scalarOnly === undefined ? {} : { scalarOnly }),
  };
};

// Workspace index -------------------------------------------------------------

/**
 * Owns the SQLite representation of one workspace and keeps its searchable
 * documents and frontmatter metadata synchronized with the filesystem.
 */
export class WorkspaceIndex {
  private database: NativeDatabase;
  private syncPromise: Promise<void> | null = null;

  constructor(
    private readonly databasePath: string,
    private readonly workspacePath: string,
  ) {
    this.database = this.openDatabase();
  }

  // Database lifecycle --------------------------------------------------------

  /** Opens the disposable index, quarantining and rebuilding a broken database. */
  private openDatabase() {
    const open = () => {
      const database = new DatabaseSync(this.databasePath);
      try {
        // Multiple app instances can share this cache. Wait briefly for writers;
        // WAL lets property/search readers continue during another connection's write.
        database.exec("PRAGMA busy_timeout = 1000");
        database.exec("PRAGMA foreign_keys = ON");
        database.exec("PRAGMA journal_mode = WAL");
        const integrity = database.prepare("PRAGMA integrity_check").all();
        if (integrity.some((row) => row.integrity_check !== "ok"))
          throw Object.assign(new Error("Workspace index integrity check failed."), { errcode: 11 });
        this.initializeSchema(database);
        return database;
      } catch (error) {
        // Cleanup must not replace the error that explains why opening failed.
        try {
          database.close();
        } catch {
          // The original error is reported below.
        }
        throw error;
      }
    };
    try {
      return open();
    } catch (error) {
      const code = (error as { errcode?: number } | null)?.errcode;
      // SQLITE_CORRUPT / SQLITE_NOTADB, including their extended result codes.
      if (this.databasePath === ":memory:" || typeof code !== "number" || ![11, 26].includes(code & 0xff)) throw error;
      const quarantinePath = `${this.databasePath}.${Date.now()}.corrupt`;
      for (const suffix of ["", "-wal", "-shm", "-journal"]) {
        const source = `${this.databasePath}${suffix}`;
        if (existsSync(source)) renameSync(source, `${quarantinePath}${suffix}`);
      }
      return open();
    }
  }

  /** Creates the current schema, rebuilding the index when its version changed. */
  private initializeSchema(database: NativeDatabase) {
    if (Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0) === SCHEMA_VERSION) return;
    database.exec("BEGIN IMMEDIATE");
    try {
      // A competing opener may have upgraded while this connection waited.
      const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
      if (version !== SCHEMA_VERSION) {
        database.exec(`
          DROP TABLE IF EXISTS frontmatter_keys;
          DROP TABLE IF EXISTS frontmatter_values;
          DROP TABLE IF EXISTS pdf_reference_links;
          DROP TABLE IF EXISTS documents_fts;
          DROP TABLE IF EXISTS workspace_notes;
          DROP TABLE IF EXISTS documents;
        `);
      }
      database.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY,
          file_id TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          relative_path TEXT NOT NULL,
          filename TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          mtime_ms REAL NOT NULL,
          size INTEGER NOT NULL,
          source TEXT NOT NULL,
          task_candidate INTEGER NOT NULL,
          indexed_at_ms INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS documents_file_id ON documents(file_id);
        CREATE INDEX IF NOT EXISTS documents_task_candidate ON documents(task_candidate);
        CREATE INDEX IF NOT EXISTS documents_relative_path_nocase
          ON documents(relative_path COLLATE NOCASE);
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
          filename, source, content='documents', content_rowid='id', tokenize='trigram'
        );
        CREATE TABLE IF NOT EXISTS frontmatter_keys (
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          field_type TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          PRIMARY KEY (document_id, ordinal)
        );
        CREATE INDEX IF NOT EXISTS frontmatter_key_exact ON frontmatter_keys(key);
        CREATE TABLE IF NOT EXISTS frontmatter_values (
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          property_ordinal INTEGER NOT NULL,
          item_ordinal INTEGER NOT NULL,
          value_type TEXT NOT NULL CHECK (value_type IN ('null','string','number','boolean','date')),
          text_value TEXT,
          normalized_text TEXT,
          number_value REAL,
          boolean_value INTEGER,
          PRIMARY KEY (document_id, property_ordinal, item_ordinal)
        );
        CREATE INDEX IF NOT EXISTS frontmatter_key_text ON frontmatter_values(key, normalized_text);
        CREATE INDEX IF NOT EXISTS frontmatter_key_number ON frontmatter_values(key, number_value);
        CREATE INDEX IF NOT EXISTS frontmatter_key_boolean ON frontmatter_values(key, boolean_value);
        CREATE TABLE IF NOT EXISTS pdf_reference_links (
          document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL,
          target_basename TEXT NOT NULL,
          destination TEXT NOT NULL,
          label TEXT NOT NULL,
          line INTEGER NOT NULL,
          PRIMARY KEY (document_id, ordinal)
        );
        CREATE INDEX IF NOT EXISTS pdf_reference_target ON pdf_reference_links(target_basename);
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Closes the underlying SQLite connection. */
  close() {
    this.database.close();
  }

  /**
   * Reconciles the complete workspace once. Concurrent callers share the same
   * in-flight synchronization.
   */
  sync(): Promise<void> {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.reconcileWorkspace().finally(() => (this.syncPromise = null));
    return this.syncPromise;
  }

  // Targeted updates ----------------------------------------------------------

  /** Refreshes one changed path, removing it when it is no longer an indexable Markdown file. */
  async refreshPath(filePath: string) {
    const fsPath = path.resolve(filePath);
    try {
      const stats = await lstat(fsPath);
      if (stats.isSymbolicLink() || !stats.isFile() || !isMarkdownFile(null, fsPath)) return this.deletePath(fsPath);
      const note = this.createMarkdownFileEntry(fsPath, stats);
      const content = await this.readContent(note);
      this.transaction(() => this.upsert(note, content.source, content.keySource));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") this.deletePath(fsPath);
      else {
        console.warn(`Could not index ${fsPath}:`, error);
        throw error;
      }
    }
  }

  /** Removes the indexed document at an absolute filesystem path. */
  deletePath(filePath: string) {
    const renderer = toRendererPath(path.resolve(filePath));
    this.transaction(() => {
      const row = this.database.prepare("SELECT id FROM documents WHERE path = ?").get(renderer);
      if (row) this.deleteDocument(Number(row.id));
    });
  }

  // Queries -------------------------------------------------------------------

  /** Searches indexed filenames and document content using SQLite trigram FTS. */
  searchText(query: string, limit = 30, hideCompletedTasks = false): WorkspaceTextSearchResult[] {
    const value = query.trim();
    if (value.length < 3) return [];
    const literal = `"${value.replace(/"/g, '""')}"`;
    const normalizedValue = value.toLocaleLowerCase();
    return this.database
      .prepare(
        `SELECT d.*, bm25(documents_fts, 8.0, 1.0) AS rank
           FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid
          WHERE documents_fts MATCH ?
          ${
            hideCompletedTasks
              ? `AND NOT (
            EXISTS (SELECT 1 FROM frontmatter_values v JOIN frontmatter_keys k
              ON k.document_id = v.document_id AND k.ordinal = v.property_ordinal
              WHERE v.document_id = d.id AND v.key = 'type' AND k.field_type = 'text'
                AND v.value_type = 'string' AND v.text_value = 'task')
            AND EXISTS (SELECT 1 FROM frontmatter_values v JOIN frontmatter_keys k
              ON k.document_id = v.document_id AND k.ordinal = v.property_ordinal
              WHERE v.document_id = d.id AND v.key = 'task-status' AND k.field_type = 'text'
                AND v.value_type = 'string' AND v.text_value = 'done')
          )`
              : ""
          }
          ORDER BY rank, d.relative_path COLLATE NOCASE
          LIMIT ?`,
      )
      .all(literal, limit)
      .map((raw) => {
        const row = asDatabaseRow<DocumentRow & { rank: number }>(raw);
        const filenameMatch = row.filename.toLocaleLowerCase().includes(normalizedValue);
        const sourceMatch = row.source.toLocaleLowerCase().includes(normalizedValue);
        return {
          file: fileFromRow(row),
          rank: Number(row.rank),
          matchedIn: filenameMatch ? (sourceMatch ? "both" : "filename") : "content",
          ...(sourceMatch ? { excerpt: createSearchExcerpt(row.source, value) } : {}),
        };
      });
  }

  /** Finds documents containing a property key and, optionally, a matching scalar value. */
  queryProperty({
    key,
    value,
    limit = WORKSPACE_INDEX_PAGE_SIZE,
    offset = 0,
    includeInvalidTaskCandidates,
    scalarOnly,
  }: WorkspacePropertyQuery): WorkspacePropertyMatch[] {
    if (includeInvalidTaskCandidates) {
      return this.database
        .prepare(
          `SELECT * FROM documents
            WHERE task_candidate = 1
            ORDER BY relative_path COLLATE NOCASE, relative_path
            LIMIT ? OFFSET ?`,
        )
        .all(limit, offset)
        .map((row) => ({ file: fileFromRow(asDatabaseRow<DocumentRow>(row)), values: [] }));
    }
    const candidateTable = value ? "frontmatter_values" : "frontmatter_keys";
    const params: Array<string | number | null> = [key];
    let valuePredicate = "";
    if (value) {
      valuePredicate = " AND candidate.value_type = ?";
      params.push(value.type);
      if (value.type === "string" || value.type === "date") {
        valuePredicate += " AND candidate.normalized_text = ?";
        params.push(normalizeWorkspacePropertyText(value.value));
      } else if (value.type === "number") {
        valuePredicate += " AND candidate.number_value = ?";
        params.push(value.value);
      } else if (value.type === "boolean") {
        valuePredicate += " AND candidate.boolean_value = ?";
        params.push(value.value ? 1 : 0);
      }
    }
    params.push(limit, offset, key);
    const rows = this.database
      .prepare(
        `WITH matching_documents AS (
           SELECT d.id
             FROM documents d
             JOIN ${candidateTable} candidate ON candidate.document_id = d.id
            WHERE candidate.key = ?${valuePredicate}
            ${
              scalarOnly
                ? `AND EXISTS (SELECT 1 FROM frontmatter_keys field
              WHERE field.document_id = d.id AND field.ordinal = candidate.${value ? "property_ordinal" : "ordinal"}
                AND field.field_type != 'list')`
                : ""
            }
            GROUP BY d.id
            ORDER BY MIN(d.relative_path) COLLATE NOCASE, MIN(d.relative_path)
            LIMIT ? OFFSET ?
         )
         SELECT d.*, value.value_type, value.text_value, value.number_value,
                value.boolean_value, value.property_ordinal, value.item_ordinal
           FROM matching_documents match
           JOIN documents d ON d.id = match.id
           LEFT JOIN frontmatter_values value
             ON value.document_id = d.id AND value.key = ?
          ORDER BY d.relative_path COLLATE NOCASE, d.relative_path,
                   value.property_ordinal, value.item_ordinal`,
      )
      .all(...params)
      .map((row) => asDatabaseRow<DocumentRow & FrontmatterValueRow>(row));
    const matches = new Map<number, WorkspacePropertyMatch>();
    rows.forEach((row) => {
      const match = matches.get(row.id) ?? { file: fileFromRow(row), values: [] };
      if (row.value_type !== null) match.values.push(scalarFromRow(row));
      matches.set(row.id, match);
    });
    return [...matches.values()];
  }

  /** Aggregates authored frontmatter keys and their observed semantic types. */
  listFrontmatterFields(): WorkspaceFrontmatterFieldObservation[] {
    return this.database
      .prepare(
        `SELECT key, field_type, COUNT(*) AS count
           FROM frontmatter_keys
          GROUP BY key, field_type
          ORDER BY key COLLATE NOCASE, key, field_type`,
      )
      .all()
      .map((row) => ({
        key: String(row.key),
        type: row.field_type as FrontmatterFieldType,
        count: Number(row.count),
      }));
  }

  /** Reads indexed source for selected document paths. */
  readDocuments(paths: readonly string[]): IndexedDocument[] {
    if (!paths.length) return [];
    return this.database
      .prepare(
        `SELECT * FROM documents
          WHERE path IN (${paths.map(() => "?").join(",")})
          ORDER BY relative_path COLLATE NOCASE, relative_path`,
      )
      .all(...paths)
      .map((row) => {
        const document = asDatabaseRow<DocumentRow>(row);
        return { file: fileFromRow(document), modifiedAtMs: Number(document.mtime_ms), source: document.source };
      });
  }

  /** Looks up authored Markdown links to a PDF by its basename. */
  queryPdfReferences(basename: string): IndexedPdfReference[] {
    return this.database
      .prepare(
        `
      SELECT d.path AS note_path, d.relative_path AS note_relative_path,
             r.destination, r.label, r.line
        FROM pdf_reference_links r JOIN documents d ON d.id = r.document_id
       WHERE r.target_basename = ?
       ORDER BY d.relative_path COLLATE NOCASE, r.line, r.ordinal
    `,
      )
      .all(basename.toLocaleLowerCase())
      .map((row) => {
        const item = asDatabaseRow<{
          note_path: string;
          note_relative_path: string;
          destination: string;
          label: string;
          line: number;
        }>(row);
        return {
          notePath: item.note_path,
          noteRelativePath: item.note_relative_path,
          destination: item.destination,
          label: item.label,
          line: item.line,
        };
      });
  }

  // Persistence ---------------------------------------------------------------

  /** Runs an index mutation atomically. */
  private transaction(operation: () => void) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      operation();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  /** Removes a document and its external-content FTS row. */
  private deleteDocument(id: number) {
    this.database.prepare("DELETE FROM documents_fts WHERE rowid = ?").run(id);
    this.database.prepare("DELETE FROM documents WHERE id = ?").run(id);
  }

  /** Replaces one document together with its FTS and frontmatter records. */
  private upsert(note: MarkdownFileEntry, source: string, keySource = source) {
    const previous = this.database.prepare("SELECT id FROM documents WHERE path = ?").get(note.file.path);
    if (previous) this.deleteDocument(Number(previous.id));
    const inserted = this.database
      .prepare(
        `INSERT INTO documents
         (file_id,path,relative_path,filename,mime_type,mtime_ms,size,source,task_candidate,indexed_at_ms)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        note.file.id,
        note.file.path,
        note.file.relativePath,
        note.file.filename,
        note.file.mimeType,
        note.mtimeMs,
        note.size,
        source,
        this.isTaskCandidate(source) ? 1 : 0,
        Date.now(),
      );
    const id = Number(inserted.lastInsertRowid);
    this.database
      .prepare("INSERT INTO documents_fts(rowid,filename,source) VALUES(?,?,?)")
      .run(id, note.file.filename, source);
    const frontmatter = projectFrontmatter(source);
    const keys = keySource === source ? frontmatter.keys : projectFrontmatter(keySource).keys;
    const insertKey = this.database.prepare(
      "INSERT INTO frontmatter_keys(document_id,key,field_type,ordinal) VALUES(?,?,?,?)",
    );
    for (const key of keys) insertKey.run(id, key.key, key.type, key.ordinal);
    const insertValue = this.database.prepare(
      `INSERT INTO frontmatter_values
       (document_id,key,property_ordinal,item_ordinal,value_type,
        text_value,normalized_text,number_value,boolean_value)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    );
    for (const value of frontmatter.values)
      insertValue.run(
        id,
        value.key,
        value.propertyOrdinal,
        value.itemOrdinal,
        value.type,
        value.textValue,
        value.normalizedText,
        value.numberValue,
        value.booleanValue,
      );
    const insertReference = this.database.prepare(
      "INSERT INTO pdf_reference_links(document_id,ordinal,target_basename,destination,label,line) VALUES(?,?,?,?,?,?)",
    );
    markdownPdfReferenceLinks(source).forEach((reference, ordinal) =>
      insertReference.run(
        id,
        ordinal,
        reference.targetBasename,
        reference.destination,
        reference.label,
        reference.line,
      ),
    );
  }

  // Filesystem synchronization ------------------------------------------------

  /** Reconciles indexed fingerprints with the complete set of workspace Markdown files. */
  private async reconcileWorkspace() {
    const files = await this.scanMarkdownFiles(this.workspacePath);
    const existing = this.database
      .prepare("SELECT id,file_id,path,mtime_ms,size FROM documents")
      .all()
      .map((row) => asDatabaseRow<FingerprintRow>(row));
    const byPath = new Map(existing.map((row) => [row.path, row]));
    const currentPaths = new Set(files.map(({ file }) => file.path));
    const changed = await mapWithConcurrency(files, WORKSPACE_INDEX_FILE_CONCURRENCY, async (note) => {
      const current = byPath.get(note.file.path);
      if (
        current?.file_id === note.file.id &&
        Number(current.mtime_ms) === note.mtimeMs &&
        Number(current.size) === note.size
      )
        return null;
      try {
        return { note, ...(await this.readContent(note)) };
      } catch (error) {
        console.warn(`Could not index ${note.file.path}:`, error);
        return null;
      }
    });
    const removed = existing.filter((row) => !currentPaths.has(row.path));
    if (!removed.length && !changed.some(Boolean)) return;
    this.transaction(() => {
      for (const row of removed) this.deleteDocument(row.id);
      for (const item of changed) if (item) this.upsert(item.note, item.source, item.keySource);
    });
  }

  /**
   * Reads complete source for normal files. Large files contribute only enough
   * leading content to discover frontmatter keys and are excluded from FTS.
   */
  private async readContent(note: MarkdownFileEntry) {
    if (note.size <= MAX_FULL_TEXT_EDITOR_BYTES) {
      const source = await readFile(note.fsPath, "utf8");
      return { source, keySource: source };
    }
    return { source: "", keySource: (await readLargeTextPreview(note.fsPath)).content };
  }

  /** Converts filesystem metadata into the document representation stored by the index. */
  private createMarkdownFileEntry(fsPath: string, stats: Awaited<ReturnType<typeof lstat>>): MarkdownFileEntry {
    return {
      fsPath,
      mtimeMs: Number(stats.mtimeMs),
      size: Number(stats.size),
      file: {
        id: createFileId(fsPath, stats),
        filename: getFilenameNoExtFromPath(fsPath),
        relativePath: getRelativePathFromPath(fsPath, this.workspacePath),
        path: toRendererPath(fsPath),
        sizeBytes: Number(stats.size),
        isDirectory: false,
        mimeType: lookup(fsPath) || "text/markdown",
      },
    };
  }

  /** Includes valid task metadata and the renderer's malformed-frontmatter recovery marker. */
  private isTaskCandidate(source: string) {
    const parsed = parseFrontmatter(source);
    if (parsed.kind === "valid") {
      const type = parsed.properties.find(({ key }) => key === "type")?.value;
      return type?.kind === "string" && type.value === "task";
    }
    if (parsed.kind !== "invalid" || !parsed.envelope) return false;
    return /^type:[ \t]+(?:task|"task"|'task')[ \t]*(?:#.*)?$/m.test(
      source.slice(parsed.envelope.bodyRange.from, parsed.envelope.bodyRange.to),
    );
  }

  /** Recursively discovers Markdown files while skipping hidden directories and symbolic links. */
  private async scanMarkdownFiles(directoryPath: string): Promise<MarkdownFileEntry[]> {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      console.warn(`Could not scan ${directoryPath}:`, error);
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const files: MarkdownFileEntry[] = [];
    const markdownPaths: string[] = [];
    for (const entry of entries) {
      if (isIgnoredWorkspaceEntry(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const fsPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) files.push(...(await this.scanMarkdownFiles(fsPath)));
      } else if (entry.isFile() && isMarkdownFile(null, fsPath)) {
        markdownPaths.push(fsPath);
      }
    }
    files.push(
      ...(await mapWithConcurrency(markdownPaths, WORKSPACE_INDEX_FILE_CONCURRENCY, async (fsPath) =>
        this.createMarkdownFileEntry(fsPath, await lstat(fsPath)),
      )),
    );
    return files;
  }
}
