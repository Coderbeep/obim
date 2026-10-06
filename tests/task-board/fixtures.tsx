import { cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { type PropsWithChildren } from "react";
import { vi } from "vitest";
import * as taskBoardHook from "../../src/renderer/src/features/task-board/useTaskBoard";
import { getFrontmatterProperty, parseFrontmatter, type FrontmatterValue } from "../../src/shared/frontmatter";
import type { ContextMenuAction, ContextMenuEntry } from "../../src/renderer/src/shared/contextMenu";
import type { FileItem } from "../../src/shared/file-item";
import type { FrontmatterScalar, IndexedDocument, WorkspacePropertyQuery } from "../../src/shared/workspace-index";

export const fixtures = { sources: {} as Record<string, string>, configExists: false, configSource: "" };

type Store = ReturnType<typeof createStore>;

const boundaryMocks = vi.hoisted(() => ({
  createMarkdownFile: vi.fn(),
  open: vi.fn(),
  readTextFile: vi.fn(),
  remove: vi.fn(),
  saveRename: vi.fn(),
  saveFile: vi.fn(),
  startRenaming: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  doesFileExist: vi.fn(),
  queryWorkspaceProperty: vi.fn(),
  readIndexedDocuments: vi.fn(),
  openFile: vi.fn(),
  upsertFile: vi.fn(),
}));

vi.mock("@renderer/features/files/workspaceFileService", () => ({
  readTextFile: boundaryMocks.readTextFile,
  saveFile: boundaryMocks.saveFile,
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useFileCreate: () => ({ createMarkdownFile: boundaryMocks.createMarkdownFile }),
  useFileOpen: () => ({ open: boundaryMocks.open }),
  useFileRemove: () => ({ remove: boundaryMocks.remove }),
  useFileRename: () => ({ saveRename: boundaryMocks.saveRename, startRenaming: boundaryMocks.startRenaming }),
}));

export const note = (path: string): Extract<FileItem, { isDirectory: false }> => ({
  id: path,
  filename: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

export const openedVersion = { id: "opened", mtimeMs: 100, sizeBytes: 10 };

export const savedVersion = { id: "saved", mtimeMs: 200, sizeBytes: 20 };

export const taskSource = (title: string, project = "Research", completed = false) =>
  [
    "---",
    "type: task",
    ...(project ? [`task-project: ${project}`] : []),
    ...(completed ? ["task-status: done"] : []),
    "---",
    `# ${title}`,
    "",
  ].join("\n");

export const renderBoard = (store: Store = createStore()) => {
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  return { store, ...renderHook(() => taskBoardHook.useTaskBoard(), { wrapper }) };
};

export const frontmatterString = (source: string, key: string) => {
  const value = getFrontmatterProperty(parseFrontmatter(source), key)?.value;
  return value?.kind === "string" ? value.value : undefined;
};

const scalarValues = (value: FrontmatterValue): FrontmatterScalar[] => {
  if (value.kind === "list") return value.value.flatMap(scalarValues);
  if (value.kind === "unsupported") return [];
  if (value.kind === "date") return [{ type: "date", value: value.source }];
  if (value.kind === "string") return [{ type: "string", value: value.value }];
  if (value.kind === "number") return [{ type: "number", value: value.value }];
  if (value.kind === "boolean") return [{ type: "boolean", value: value.value }];
  return [{ type: "null", value: null }];
};

export const isContextMenuAction = (entry: ContextMenuEntry): entry is ContextMenuAction => entry.kind === "action";

const scalarMatches = (actual: FrontmatterScalar, expected: FrontmatterScalar) =>
  actual.type === expected.type &&
  (actual.type === "string" || actual.type === "date"
    ? String(actual.value).trim().toLocaleLowerCase() === String(expected.value).trim().toLocaleLowerCase()
    : actual.value === expected.value);

const propertyMatchesFromSources = (request: WorkspacePropertyQuery) => {
  const matches = Object.entries(fixtures.sources).flatMap(([path, source]) => {
    const frontmatter = parseFrontmatter(source);
    if (
      request.includeInvalidTaskCandidates &&
      frontmatter.kind === "invalid" &&
      /^type:[ \t]+(?:task|"task"|'task')[ \t]*(?:#.*)?$/m.test(source)
    )
      return [{ file: note(path), values: [] }];
    if (frontmatter.kind !== "valid") return [];
    const properties = frontmatter.properties.filter(({ key }) => key === request.key);
    const values = properties.flatMap(({ value }) => scalarValues(value));
    return properties.length && (!request.value || values.some((value) => scalarMatches(value, request.value!)))
      ? [{ file: note(path), values }]
      : [];
  });
  const offset = request.offset ?? 0;
  return matches.slice(offset, offset + (request.limit ?? 100));
};

const indexedDocument = (path: string): IndexedDocument | undefined => {
  const source = fixtures.sources[path];
  if (source === undefined) return undefined;
  return {
    file: note(path),
    source,
  };
};

export const resetTaskBoardFixtures = () => {
  fixtures.sources = {};
  fixtures.configExists = false;
  fixtures.configSource = "";

  window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
  window.api = {
    doesFileExist: apiMocks.doesFileExist,
    queryWorkspaceProperty: apiMocks.queryWorkspaceProperty,
    readIndexedDocuments: apiMocks.readIndexedDocuments,
    openFile: apiMocks.openFile,
    upsertFile: apiMocks.upsertFile,
  } as unknown as Window["api"];

  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
  vi.spyOn(window, "confirm").mockReturnValue(true);

  apiMocks.doesFileExist.mockImplementation(async () => fixtures.configExists);
  apiMocks.queryWorkspaceProperty.mockImplementation(async (request: WorkspacePropertyQuery) =>
    propertyMatchesFromSources(request),
  );
  apiMocks.readIndexedDocuments.mockImplementation(async (paths: string[]) =>
    paths.flatMap((path) => {
      const document = indexedDocument(path);
      return document ? [document] : [];
    }),
  );
  apiMocks.openFile.mockImplementation(async () => fixtures.configSource);
  apiMocks.upsertFile.mockImplementation(async (_path: string, content: string) => {
    fixtures.configExists = true;
    fixtures.configSource = content;
    return true;
  });
  boundaryMocks.createMarkdownFile.mockResolvedValue(null);
  boundaryMocks.open.mockResolvedValue(undefined);
  boundaryMocks.remove.mockReset().mockResolvedValue(true);
  boundaryMocks.saveRename.mockReset().mockResolvedValue({ success: false, error: "rename failed" });
  boundaryMocks.startRenaming.mockReset();
  boundaryMocks.readTextFile.mockImplementation(async (path: string) =>
    path in fixtures.sources
      ? { success: true, content: fixtures.sources[path], version: openedVersion }
      : { success: false, error: `Missing fixture: ${path}` },
  );
  boundaryMocks.saveFile.mockImplementation(async (path: string, content: string) => {
    fixtures.sources[path] = content;
    return { success: true, version: savedVersion };
  });
};

export const cleanupTaskBoardFixtures = () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
};

export { boundaryMocks, apiMocks };
