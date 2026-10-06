import { act, cleanup, render } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceItemResolver } from "../src/renderer/src/features/workspace/workspaceItemOperations";
import type { WorkspaceItemViewMap } from "../src/renderer/src/features/workspace/workspaceItemView";
import type { FileItem } from "../src/shared/file-item";
import type { WorkspaceItem } from "../src/shared/workspace";

const workspaceContainerState = vi.hoisted(() => ({
  createNewFile: vi.fn(),
  getNoteTabMenuEntries: vi.fn<(file: FileItem) => []>(() => []),
  open: vi.fn(),
  openLinkedFile: vi.fn(),
  openWorkspaceItem: vi.fn(),
  editorProps: [] as Array<{ openResource(path: string): unknown }>,
  item: null as WorkspaceItem | null,
  renders: [] as Array<{ resolveWorkspaceItem: WorkspaceItemResolver; views: WorkspaceItemViewMap }>,
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useFileCreate: () => ({ createNewFile: workspaceContainerState.createNewFile }),
  useFileOpen: () => ({
    open: workspaceContainerState.open,
    openLinkedFile: workspaceContainerState.openLinkedFile,
    openWorkspaceItem: workspaceContainerState.openWorkspaceItem,
  }),
}));

vi.mock("@renderer/features/files/menus/useNoteTabMenu", () => ({
  useNoteTabMenu: () => ({
    getNoteTabMenuEntries: (file: FileItem) => workspaceContainerState.getNoteTabMenuEntries(file),
  }),
}));

vi.mock("@renderer/features/workspace/usePaneWorkspace", () => ({
  usePaneWorkspace: () => ({}),
}));

vi.mock("@renderer/features/workspace/WorkspacePaneGrid", () => ({
  WorkspacePaneGrid: ({
    resolveWorkspaceItem,
    views,
  }: {
    resolveWorkspaceItem: WorkspaceItemResolver;
    views: WorkspaceItemViewMap;
  }) => {
    workspaceContainerState.renders.push({ resolveWorkspaceItem, views });
    return workspaceContainerState.item ? views.file.render(workspaceContainerState.item, "pane-1") : null;
  },
}));

vi.mock("@renderer/features/editor/editorLoader", () => ({
  LazyObimEditor: (props: { openResource(path: string): unknown }) => {
    workspaceContainerState.editorProps.push(props);
    return null;
  },
}));

vi.mock("@renderer/features/files/FileBufferBoundary", () => ({
  FileBufferBoundary: ({ children }: { children: unknown }) => children,
}));

vi.mock("@renderer/app/AppSidebars", () => ({
  useInspectorSidebarControls: () => ({ isSidebarCollapsed: false, toggleSidebar: vi.fn() }),
}));

vi.mock("../src/renderer/src/app/sidebarPlacement", () => ({
  useSidebarPlacement: () => "explorer-left",
}));

vi.mock("@renderer/config", () => ({
  getWorkspacePath: () => "/notes",
}));

import { WorkspaceContainer } from "../src/renderer/src/app/WorkspaceContainer";
import { fileTreeAtom } from "../src/renderer/src/store/fileExplorerStore";
import { createFileWorkspaceItem, createFileWorkspaceItemKey } from "../src/shared/workspace";

const file = (versionId: string): Extract<FileItem, { isDirectory: false }> => ({
  id: "/notes/note.md",
  filename: "note.md",
  relativePath: "note.md",
  path: "/notes/note.md",
  sizeBytes: 4,
  isDirectory: false,
  mimeType: "text/markdown",
  version: { id: versionId, mtimeMs: versionId === "opened" ? 100 : 200, sizeBytes: 4 },
});

beforeEach(() => {
  workspaceContainerState.editorProps.length = 0;
  workspaceContainerState.item = createFileWorkspaceItem(file("opened"));
  workspaceContainerState.renders.length = 0;
});

afterEach(cleanup);

describe("WorkspaceContainer lifecycle", () => {
  it("keeps editor resource callbacks stable while resolving against a refreshed file tree", () => {
    const store = createStore();
    store.set(fileTreeAtom, [file("opened")]);
    render(
      <Provider store={store}>
        <WorkspaceContainer />
      </Provider>,
    );
    const first = workspaceContainerState.renders.at(-1)!;
    const firstEditorProps = workspaceContainerState.editorProps.at(-1)!;

    act(() => store.set(fileTreeAtom, [file("saved")]));

    const refreshed = workspaceContainerState.renders.at(-1)!;
    const refreshedEditorProps = workspaceContainerState.editorProps.at(-1)!;
    expect(refreshed.resolveWorkspaceItem).toBe(first.resolveWorkspaceItem);
    expect(refreshed.views.file.render).toBe(first.views.file.render);
    expect(refreshedEditorProps.openResource).toBe(firstEditorProps.openResource);
    expect(refreshed.resolveWorkspaceItem(createFileWorkspaceItemKey("/notes/note.md"), {})).toMatchObject({
      file: { version: { id: "saved" } },
    });
  });
});
