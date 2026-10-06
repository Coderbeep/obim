import { Provider, createStore } from "jotai";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspacePaneHeader } from "../src/renderer/src/features/workspace/WorkspacePaneHeader";
import { activePaneIdAtom, workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import type { FileItem } from "../src/shared/file-item";
import { createFileWorkspaceItem, createTaskBoardWorkspaceItem } from "../src/shared/workspace";
import type { WorkspaceItemViewMap } from "../src/renderer/src/features/workspace/workspaceItemView";

const state = vi.hoisted(() => ({
  goBackward: vi.fn(),
  goForward: vi.fn(),
  openFileHeaderMenu: vi.fn(),
}));

vi.mock("@renderer/features/files/FileBreadcrumbTitle", () => ({
  FileBreadcrumbTitle: ({ file }: { file: FileItem }) => <span data-testid="file-breadcrumb">{file.path}</span>,
}));

vi.mock("@renderer/features/files/menus/useFileHeaderMenu", () => ({
  useFileHeaderMenu: () => ({ openFileHeaderMenu: state.openFileHeaderMenu }),
}));

vi.mock("@renderer/features/workspace/useWorkspaceTabNavigation", () => ({
  useWorkspaceTabNavigation: () => ({
    goBackward: state.goBackward,
    goForward: state.goForward,
  }),
}));

const note: FileItem = {
  id: "/notes/note.md",
  filename: "note",
  relativePath: "note.md",
  path: "/notes/note.md",
  isDirectory: false,
  mimeType: "text/markdown",
};

const views: WorkspaceItemViewMap = {
  file: {
    getTitle: () => "Note",
    render: () => null,
  },
  taskboard: {
    getTitle: () => "Task Board",
    render: () => null,
  },
};

const openWorkspaceItem = vi.fn();
const resolveWorkspaceItem = vi.fn();

const renderHeader = (item?: ReturnType<typeof createFileWorkspaceItem | typeof createTaskBoardWorkspaceItem>) => {
  const store = createStore();
  const tab = createEditorTab("tab-1", item?.key ?? "file:missing");
  tab.backStack = ["file:older", tab.currentResourceKey];
  tab.forwardStack = ["file:newer"];
  store.set(activePaneIdAtom, "pane-1");
  store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }]);
  store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
  store.set(fileBuffersByPathAtom, { [note.path]: { editorText: "draft", savedText: "saved" } });

  return {
    store,
    ...render(
      <Provider store={store}>
        <WorkspacePaneHeader
          item={item}
          openWorkspaceItem={openWorkspaceItem}
          paneId="pane-1"
          resolveWorkspaceItem={resolveWorkspaceItem}
          views={views}
        />
      </Provider>,
    ),
  };
};

describe("WorkspacePaneHeader", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("uses the supplied file item and routes navigation and menu actions", () => {
    const item = createFileWorkspaceItem(note);
    renderHeader(item);

    expect(screen.getByTestId("file-breadcrumb").textContent).toBe(note.path);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    fireEvent.click(screen.getByRole("button", { name: "Go forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Current file options" }));

    expect(state.goBackward).toHaveBeenCalledWith("pane-1");
    expect(state.goForward).toHaveBeenCalledWith("pane-1");
    expect(state.openFileHeaderMenu).toHaveBeenCalledWith(expect.anything(), note, {
      paneId: "pane-1",
      tabId: "tab-1",
    });
    expect(resolveWorkspaceItem).not.toHaveBeenCalled();
  });

  it("renders non-file and empty pane titles without file actions", () => {
    const taskBoard = createTaskBoardWorkspaceItem();
    const { rerender, store } = renderHeader(taskBoard);

    expect(screen.getByText("Task Board")).toBeTruthy();
    const fileOptions = screen.getByRole("button", { name: "Current file options" }) as HTMLButtonElement;
    expect(fileOptions.disabled).toBe(true);
    expect(fileOptions.className).toContain("disabled:text-muted-foreground");

    rerender(
      <Provider store={store}>
        <WorkspacePaneHeader
          openWorkspaceItem={openWorkspaceItem}
          paneId="pane-1"
          resolveWorkspaceItem={resolveWorkspaceItem}
          views={views}
        />
      </Provider>,
    );

    expect(screen.getByText("No item open")).toBeTruthy();
  });
});
