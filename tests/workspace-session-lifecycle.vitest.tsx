import { taskBoardPreferencesAtom } from "../src/renderer/src/store/taskBoardPreferencesStore";
import { fileLoadStatesByPathAtom } from "../src/renderer/src/store/fileLoadStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceSession } from "../src/renderer/src/app/useWorkspaceSession";
import { fileTreeAtom, fileTreeLoadStateAtom } from "../src/renderer/src/store/fileExplorerStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { openWorkspaceResourceAtom } from "../src/renderer/src/store/workspaceActionStore";
import { createFileWorkspaceItem, createTaskBoardWorkspaceItem } from "../src/shared/workspace";
import type { WorkspaceSession } from "../src/shared/workspace-session";
const service = vi.hoisted(() => ({ readTextFile: vi.fn() }));
vi.mock("@renderer/features/files/workspaceFileService", async (original) => ({
  ...(await original<typeof import("../src/renderer/src/features/files/workspaceFileService")>()),
  ...service,
}));
const note = createFileWorkspaceItem({
  id: "note",
  filename: "Note",
  path: "/notes/note.md",
  relativePath: "note.md",
  isDirectory: false,
  mimeType: "text/markdown",
});
const session = {
  version: 1,
  activePaneId: "restored-pane",
  panes: [{ id: "restored-pane", tabs: ["restored-tab"], activeTabId: "restored-tab", size: 1 }],
  tabs: [createEditorTab("restored-tab", note.key)],
  expandedDirectories: [],
  fileAccesses: {},
  recentFilePaths: [],
  explorerSections: { bookmarks: true, files: true, recent: false },
  explorerSectionSizes: { bookmarks: 1, files: 2, recent: 1 },
  taskBoard: {
    selectedProject: "Research",
    activeSavedFilterId: null,
    collapsedSubtaskPaths: [],
    dueDateEndFilter: "",
    dueDateFilter: "",
    dueFilter: "all",
    lifecycleView: "active",
    priorityFilters: [],
    savedFilters: [],
    searchQuery: "",
    sortRules: [],
    tagFilters: [],
  },
} satisfies WorkspaceSession;
const deferred = () => {
  let resolve!: (value: WorkspaceSession | null) => void;
  const promise = new Promise<WorkspaceSession | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const setup = () => {
  const store = createStore();
  store.set(fileTreeAtom, [note.file]);
  store.set(fileTreeLoadStateAtom, "ready");
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  return { store, ...renderHook(() => useWorkspaceSession(), { wrapper }) };
};
beforeEach(() => {
  service.readTextFile
    .mockReset()
    .mockResolvedValue({ success: true, content: "loaded note", version: { id: "one", mtimeMs: 1, sizeBytes: 11 } });
  window.config = {
    getMainDirectoryPathSync: () => "/notes",
    readWorkspaceSession: vi.fn().mockResolvedValue(session),
    saveWorkspaceSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as Window["config"];
});
afterEach(cleanup);

describe("workspace restoration lifetime", () => {
  it("restores the selected project and saves later selections", async () => {
    const { store } = setup();
    await waitFor(() => expect(store.get(taskBoardPreferencesAtom).selectedProject).toBe("Research"));
    act(() => store.set(taskBoardPreferencesAtom, (current) => ({ ...current, selectedProject: "Writing" })));
    await waitFor(() =>
      expect(vi.mocked(window.config.saveWorkspaceSession).mock.lastCall?.[0].taskBoard.selectedProject).toBe(
        "Writing",
      ),
    );
  });

  it("survives tree refresh during restoration and enables later session persistence", async () => {
    const load = deferred();
    vi.mocked(window.config.readWorkspaceSession).mockReturnValue(load.promise);
    const { store } = setup();
    act(() => {
      store.set(fileTreeLoadStateAtom, "loading");
      store.set(fileTreeAtom, [{ ...note.file }]);
      store.set(fileTreeLoadStateAtom, "ready");
    });
    await act(async () => {
      load.resolve(session);
      await load.promise;
    });
    await waitFor(() => expect(store.get(workspaceTabsByIdAtom)["restored-tab"]).toBeDefined());
    act(() => store.set(openWorkspaceResourceAtom, { item: createTaskBoardWorkspaceItem(), openInNewTab: true }));
    await waitFor(() => expect(window.config.saveWorkspaceSession).toHaveBeenCalled());
    expect(vi.mocked(window.config.saveWorkspaceSession).mock.lastCall?.[0].tabs).toHaveLength(2);
    expect(window.config.readWorkspaceSession).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite navigation performed while saved-session reading is pending", async () => {
    const load = deferred();
    vi.mocked(window.config.readWorkspaceSession).mockReturnValue(load.promise);
    const { store } = setup();
    const board = createTaskBoardWorkspaceItem();
    act(() => store.set(openWorkspaceResourceAtom, { item: board }));
    const userTabs = store.get(workspaceTabsByIdAtom);
    await act(async () => {
      load.resolve(session);
      await load.promise;
    });
    expect(store.get(workspaceTabsByIdAtom)).toBe(userTabs);
    await waitFor(() => expect(window.config.saveWorkspaceSession).toHaveBeenCalled());
  });

  it("ignores an old workspace response after the hook starts restoring a different root", async () => {
    const oldLoad = deferred(),
      newLoad = deferred();
    vi.mocked(window.config.readWorkspaceSession)
      .mockReturnValueOnce(oldLoad.promise)
      .mockReturnValueOnce(newLoad.promise);
    const { store, rerender } = setup();
    const nextNote = createFileWorkspaceItem({
      ...note.file,
      id: "other",
      path: "/other/other.md",
      relativePath: "other.md",
    });
    window.config.getMainDirectoryPathSync = () => "/other";
    act(() => {
      store.set(fileTreeAtom, [nextNote.file]);
      rerender();
    });
    await act(async () => {
      oldLoad.resolve(session);
      await oldLoad.promise;
    });
    expect(store.get(workspaceTabsByIdAtom)["restored-tab"]).toBeUndefined();
    const nextSession = { ...session, tabs: [createEditorTab("restored-tab", nextNote.key)] };
    await act(async () => {
      newLoad.resolve(nextSession);
      await newLoad.promise;
    });
    expect(store.get(workspaceTabsByIdAtom)["restored-tab"].currentResourceKey).toBe(nextNote.key);
  });

  it("can remount after cancellation without the cancelled attempt overwriting the new restore", async () => {
    const load = deferred();
    vi.mocked(window.config.readWorkspaceSession).mockReturnValueOnce(load.promise).mockResolvedValue(session);
    const { store, unmount } = setup();
    unmount();
    const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
    renderHook(() => useWorkspaceSession(), { wrapper });
    await waitFor(() => expect(store.get(workspaceTabsByIdAtom)["restored-tab"]).toBeDefined());
    const restoredTabs = store.get(workspaceTabsByIdAtom);
    await act(async () => {
      load.resolve(session);
      await load.promise;
    });
    expect(store.get(workspaceTabsByIdAtom)).toBe(restoredTabs);
    expect(window.config.readWorkspaceSession).toHaveBeenCalledTimes(2);
  });

  it("keeps failed restored-note reads explicit and retryable instead of silently showing a blank editor", async () => {
    service.readTextFile.mockResolvedValue({ success: false, error: "EACCES: permission denied" });
    const { store } = setup();
    await waitFor(() => expect(store.get(workspaceTabsByIdAtom)["restored-tab"]).toBeDefined());
    expect(store.get(fileBuffersByPathAtom)[note.file.path]).toBeUndefined();
    expect(store.get(fileLoadStatesByPathAtom)[note.file.path]).toEqual({
      phase: "error",
      message: "EACCES: permission denied",
    });
  });

  it.each([null, new Error("unreadable session")])(
    "enables future persistence after missing/failed session read: %s",
    async (outcome) => {
      if (outcome instanceof Error) vi.mocked(window.config.readWorkspaceSession).mockRejectedValue(outcome);
      else vi.mocked(window.config.readWorkspaceSession).mockResolvedValue(outcome);
      const { store } = setup();
      await act(async () => {
        await Promise.resolve();
      });
      act(() => store.set(openWorkspaceResourceAtom, { item: createTaskBoardWorkspaceItem() }));
      await waitFor(() => expect(window.config.saveWorkspaceSession).toHaveBeenCalled());
      expect(store.get(workspacePanesAtom)[0].tabs).toHaveLength(1);
    },
  );
});
