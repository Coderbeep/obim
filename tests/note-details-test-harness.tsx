import { cleanup, render } from "@testing-library/react";
import { createStore, getDefaultStore, Provider, useStore } from "jotai";
import { useRef, useState } from "react";
import { vi } from "vitest";

import { NoteDetailsEditor } from "../src/renderer/src/features/editor/note-details";
import { fileBuffersByPathAtom, type FileBufferState } from "../src/renderer/src/store/fileBufferStore";
import { editFrontmatterSource, parseFrontmatter, type FrontmatterEdit } from "../src/shared/frontmatter";
import type { FrontmatterFieldType } from "../src/shared/frontmatter-fields";

export const DEFAULT_NOTE_DETAILS_FILE_PATH = "/workspace/notes/current.md";

type ApiOverrides = Partial<Window["api"]>;
type TestStore = ReturnType<typeof createStore>;

const trackedStores = new Set<TestStore>();
let previousApi: Window["api"] | undefined;
let previousConfig: Window["config"] | undefined;
let hadApi = false;
let hadConfig = false;
let setupActive = false;

export const createNoteDetailsApi = (overrides: ApiOverrides = {}): Window["api"] =>
  ({
    getFiles: vi.fn(async () => []),
    openFile: vi.fn(async () => ""),
    readLargeTextPreview: vi.fn(async () => ({
      content: "",
      previewBytes: 0,
      sizeBytes: 0,
      truncated: false,
    })),
    searchWorkspaceText: vi.fn(async () => []),
    queryWorkspaceProperty: vi.fn(async () => []),
    listWorkspaceFrontmatterFields: vi.fn(async () => []),
    readIndexedDocuments: vi.fn(async () => []),
    doesFileExist: vi.fn(async () => false),
    saveFile: vi.fn<Window["api"]["saveFile"]>(async () => ({ success: false, error: "Not configured" })),
    upsertFile: vi.fn(async () => false),
    createFile: vi.fn<Window["api"]["createFile"]>(async () => ({ success: false, error: "Not configured" })),
    saveBinaryFile: vi.fn(async () => false),
    createDirectory: vi.fn<Window["api"]["createDirectory"]>(async () => ({ success: false, error: "Not configured" })),
    getFilesRecursiveAsTree: vi.fn(async () => ({ revision: 0, items: [] })),
    importExternalFiles: vi.fn(async () => ({ importedPaths: [], errors: [] })),
    hasClipboardImageFiles: vi.fn(() => false),
    importClipboardImages: vi.fn(async () => ({ importedPaths: [], errors: [] })),
    copyWorkspaceItems: vi.fn(async () => ({ copiedPaths: [], errors: [] })),
    renameFile: vi.fn<Window["api"]["renameFile"]>(async () => ({ success: false, error: "Not configured" })),
    moveFile: vi.fn<Window["api"]["moveFile"]>(async () => ({ success: false, error: "Not configured" })),
    trashFile: vi.fn<Window["api"]["trashFile"]>(async () => ({ success: false, error: "Not configured" })),
    revealInSystemFileManager: vi.fn<Window["api"]["revealInSystemFileManager"]>(async () => ({
      success: false,
      error: "Not configured",
    })),
    openInDefaultApp: vi.fn<Window["api"]["openInDefaultApp"]>(async () => ({
      success: false,
      error: "Not configured",
    })),
    openExternalLink: vi.fn<Window["api"]["openExternalLink"]>(async () => ({
      success: false,
      error: "Not configured",
    })),
    onCloseCurrentTabShortcut: vi.fn(() => () => {}),
    onReopenLastClosedTabShortcut: vi.fn(() => () => {}),
    ...overrides,
  }) satisfies Partial<Window["api"]> as Window["api"];

export const overrideNoteDetailsApi = (overrides: ApiOverrides): Window["api"] => {
  window.api = { ...createNoteDetailsApi(), ...window.api, ...overrides };
  return window.api;
};

export const setWorkspaceFields = (fields: Record<string, string>) => {
  overrideNoteDetailsApi({
    listWorkspaceFrontmatterFields: async () =>
      Object.entries(fields).map(([key, type]) => ({ key, type: type as FrontmatterFieldType, count: 1 })),
  });
};

export const setupNoteDetailsTestHarness = (overrides: ApiOverrides = {}) => {
  if (!setupActive) {
    hadApi = "api" in window;
    hadConfig = "config" in window;
    previousApi = window.api;
    previousConfig = window.config;
    setupActive = true;
  }
  window.api = createNoteDetailsApi(overrides);
  window.config = { getMainDirectoryPathSync: () => "/workspace" } as Window["config"];
  getDefaultStore().set(fileBuffersByPathAtom, {});
};

export const cleanupNoteDetailsTestHarness = () => {
  cleanup();
  getDefaultStore().set(fileBuffersByPathAtom, {});
  for (const store of trackedStores) store.set(fileBuffersByPathAtom, {});
  trackedStores.clear();

  if (setupActive) {
    if (hadApi) window.api = previousApi!;
    else Reflect.deleteProperty(window, "api");
    if (hadConfig) window.config = previousConfig!;
    else Reflect.deleteProperty(window, "config");
  }
  previousApi = undefined;
  previousConfig = undefined;
  hadApi = false;
  hadConfig = false;
  setupActive = false;
};

export type RenderNoteDetailsOptions = {
  buffers?: Record<string, FileBufferState>;
  filePath?: string;
  initialSource: string;
  onReturnToEditor?: () => void;
  onUndo?: () => void;
  onSourceChange?: (source: string) => void;
  store?: TestStore;
};

export const NoteDetailsHarness = ({
  initialSource,
  onReturnToEditor,
  onSourceChange,
  onUndo,
}: RenderNoteDetailsOptions) => {
  trackedStores.add(useStore());
  const [source, setSource] = useState(initialSource);
  const sourceRef = useRef(source);
  const frontmatter = parseFrontmatter(source);
  const properties = frontmatter.kind === "valid" ? frontmatter.properties : [];

  const edit = (change: FrontmatterEdit) => {
    const result = editFrontmatterSource(sourceRef.current, change);
    if (!result.success) return result.error;
    sourceRef.current = result.source;
    setSource(result.source);
    onSourceChange?.(result.source);
    return null;
  };

  return (
    <NoteDetailsEditor properties={properties} onEdit={edit} onReturnToEditor={onReturnToEditor} onUndo={onUndo} />
  );
};

export const renderNoteDetails = ({
  buffers = {},
  filePath = DEFAULT_NOTE_DETAILS_FILE_PATH,
  initialSource,
  onReturnToEditor,
  onSourceChange,
  store = createStore(),
}: RenderNoteDetailsOptions) => {
  store.set(fileBuffersByPathAtom, buffers);
  trackedStores.add(store);
  const result = render(
    <Provider store={store}>
      <NoteDetailsHarness
        filePath={filePath}
        initialSource={initialSource}
        onReturnToEditor={onReturnToEditor}
        onSourceChange={onSourceChange}
      />
    </Provider>,
  );
  return { ...result, store };
};
