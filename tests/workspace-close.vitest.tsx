import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveFileTracked } from "../src/renderer/src/features/files/dirtyFileBuffers";
import { useAppCloseGuard, useCloseTabAction } from "../src/renderer/src/features/workspace/usePaneWorkspace";
import type { WorkspaceItemViewMap } from "../src/renderer/src/features/workspace/workspaceItemView";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { notificationsAtom } from "../src/renderer/src/store/NotificationsStore";
import { closeWorkspaceTabAtom } from "../src/renderer/src/store/workspaceActionStore";
import { openWorkspaceItemsByKeyAtom } from "../src/renderer/src/store/workspaceResourceStore";
import { trackWorkspaceActivity } from "../src/renderer/src/store/workspaceTransitionStore";
import type { FileItem } from "../src/shared/file-item";
import { createFileWorkspaceItem, type WorkspaceItem } from "../src/shared/workspace";

type Store = ReturnType<typeof createStore>;

const saveFileMock = vi.hoisted(() => vi.fn());
const openedVersion = { id: "opened", mtimeMs: 100, sizeBytes: 5 };
const savedVersion = { id: "saved", mtimeMs: 200, sizeBytes: 5 };

vi.mock("@renderer/features/files/workspaceFileService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/renderer/src/features/files/workspaceFileService")>()),
  saveFile: saveFileMock,
}));

let requestAppClose!: (requestId: number) => void | Promise<void>;
let reportAppCloseTimeout!: () => void;
const respondToAppClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  saveFileMock.mockResolvedValue({ success: true, version: savedVersion });
  window.api = {
    onAppCloseRequested: vi.fn((callback) => {
      requestAppClose = callback;
      return vi.fn();
    }),
    respondToAppClose,
    onAppCloseTimeout: vi.fn((callback) => {
      reportAppCloseTimeout = callback;
      return vi.fn();
    }),
  } as unknown as Window["api"];
});

const note = (path: string): FileItem => ({
  id: path,
  filename: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const resolveWorkspaceItem = (workspaceItemKey: string, openItems: Readonly<Record<string, WorkspaceItem>>) =>
  openItems[workspaceItemKey] ?? null;

const createViews = (): WorkspaceItemViewMap => ({
  file: {
    getTitle: () => "Note",
    render: () => null,
  },
});

const createWorkspace = (tabIds = ["tab-current"]) => {
  const store = createStore();
  const file = note("/notes/current.md");
  const item = createFileWorkspaceItem(file);
  const tabs = Object.fromEntries(tabIds.map((tabId) => [tabId, createEditorTab(tabId, item.key)]));
  store.set(workspacePanesAtom, [{ id: "pane-1", tabs: tabIds, activeTabId: tabIds[0], size: 1 }]);
  store.set(workspaceTabsByIdAtom, tabs);
  store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
  store.set(fileBuffersByPathAtom, {
    [file.path]: { savedText: "saved", editorText: "draft", version: openedVersion },
  });
  return { file, item, store };
};

const renderCloseAction = (store: Store) => {
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  return renderHook(() => useCloseTabAction({ resolveWorkspaceItem, views: createViews() }), {
    wrapper,
  });
};

const renderAppCloseGuard = (store: Store) => {
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  return renderHook(() => useAppCloseGuard(), { wrapper });
};

describe("workspace close action", () => {
  it("leaves the tab, resource, and dirty buffer intact when saving fails", async () => {
    const { file, item, store } = createWorkspace();
    saveFileMock.mockResolvedValue({ success: false, error: "disk full" });
    const { result } = renderCloseAction(store);

    const closed = await act(() => result.current.closeTab("pane-1", "tab-current"));

    expect(closed).toBe(false);
    expect(store.get(workspacePanesAtom)[0].tabs).toEqual(["tab-current"]);
    expect(store.get(workspaceTabsByIdAtom)["tab-current"]).toBeDefined();
    expect(store.get(openWorkspaceItemsByKeyAtom)[item.key]).toEqual(item);
    expect(store.get(fileBuffersByPathAtom)[file.path]).toEqual({
      savedText: "saved",
      editorText: "draft",
      version: openedVersion,
    });
  });

  it("aborts closing when the file changes while its save is pending", async () => {
    const { file, item, store } = createWorkspace();
    let finishSave!: (result: { success: true; version: typeof savedVersion }) => void;
    saveFileMock.mockReturnValue(
      new Promise((resolve) => {
        finishSave = resolve;
      }),
    );
    const { result } = renderCloseAction(store);

    let closePromise!: Promise<boolean>;
    act(() => {
      closePromise = result.current.closeTab("pane-1", "tab-current");
    });
    await act(async () => {
      await vi.waitFor(() => expect(saveFileMock).toHaveBeenCalledTimes(1));
    });
    store.set(fileBuffersByPathAtom, {
      [file.path]: { savedText: "saved", editorText: "newer draft", version: openedVersion },
    });
    finishSave({ success: true, version: savedVersion });
    const closed = await act(() => closePromise);

    expect(closed).toBe(false);
    expect(store.get(workspaceTabsByIdAtom)["tab-current"]).toBeDefined();
    expect(store.get(openWorkspaceItemsByKeyAtom)[item.key]).toEqual(item);
    expect(store.get(fileBuffersByPathAtom)[file.path]).toEqual({
      savedText: "draft",
      editorText: "newer draft",
      version: savedVersion,
    });
  });

  it("marks the saved buffer before closing a successfully saved tab", async () => {
    const { file, store } = createWorkspace(["tab-current", "tab-other"]);
    const { result } = renderCloseAction(store);

    const closed = await act(() => result.current.closeTab("pane-1", "tab-current"));

    expect(closed).toBe(true);
    expect(saveFileMock).toHaveBeenCalledWith(file.path, "draft", openedVersion);
    expect(store.get(workspaceTabsByIdAtom)["tab-current"]).toBeUndefined();
    expect(store.get(workspacePanesAtom)[0].tabs).toEqual(["tab-other"]);
    expect(store.get(fileBuffersByPathAtom)[file.path]).toEqual({
      savedText: "draft",
      editorText: "draft",
      version: savedVersion,
    });
  });

  it("waits for writes even when the current buffer compares clean", async () => {
    const { file, store } = createWorkspace();
    store.set(fileBuffersByPathAtom, {
      [file.path]: { savedText: "draft", editorText: "draft", version: openedVersion },
    });
    let finish!: (value: { success: true; version: typeof savedVersion }) => void;
    const writing = saveFileTracked(
      file.path,
      "draft",
      openedVersion,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderCloseAction(store);
    let closing!: Promise<boolean>;
    act(() => {
      closing = result.current.closeTab("pane-1", "tab-current");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.get(workspaceTabsByIdAtom)["tab-current"]).toBeDefined();
    finish({ success: true, version: savedVersion });
    await writing;
    expect(await act(() => closing)).toBe(true);
  });

  it("does not prune an unpreserved dirty buffer when its last UI owner disappears", () => {
    const { file, store } = createWorkspace();
    store.set(closeWorkspaceTabAtom, { paneId: "pane-1", tabId: "tab-current" });
    expect(store.get(fileBuffersByPathAtom)[file.path]?.editorText).toBe("draft");
  });
});

describe("save queue versions", () => {
  it("passes a queued save the version returned by the preceding save", async () => {
    const nextVersion = { id: "next", mtimeMs: 150, sizeBytes: 6 };
    let finishFirst!: (result: { success: true; version: typeof nextVersion }) => void;
    saveFileMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ success: true, version: savedVersion });

    const first = saveFileTracked("/notes/current.md", "first", openedVersion, saveFileMock);
    const second = saveFileTracked("/notes/current.md", "second", openedVersion, saveFileMock);
    finishFirst({ success: true, version: nextVersion });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, version: nextVersion },
      { success: true, version: savedVersion },
    ]);
    expect(saveFileMock).toHaveBeenNthCalledWith(1, "/notes/current.md", "first", openedVersion);
    expect(saveFileMock).toHaveBeenNthCalledWith(2, "/notes/current.md", "second", nextVersion);
  });
});

describe("app close guard", () => {
  it("saves dirty buffers before allowing the window to close", async () => {
    const { file, store } = createWorkspace();
    renderAppCloseGuard(store);

    await act(() => requestAppClose(7));

    expect(saveFileMock).toHaveBeenCalledWith(file.path, "draft", openedVersion);
    expect(saveFileMock.mock.invocationCallOrder[0]).toBeLessThan(respondToAppClose.mock.invocationCallOrder[0]);
    expect(respondToAppClose).toHaveBeenCalledWith(7, true);
    expect(store.get(fileBuffersByPathAtom)[file.path]).toEqual({
      savedText: "draft",
      editorText: "draft",
      version: savedVersion,
    });
  });

  it("cancels a pending Git sync before draining work for quit", async () => {
    const { store } = createWorkspace();
    let finish!: () => void;
    const activity = trackWorkspaceActivity(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    window.api.cancelGitSync = vi.fn(async () => {
      finish();
      return true;
    });
    renderAppCloseGuard(store);
    await act(() => requestAppClose(10));
    await activity;
    expect(window.api.cancelGitSync).toHaveBeenCalledOnce();
    expect(respondToAppClose).toHaveBeenCalledWith(10, true);
  });

  it("keeps the window open and the buffer dirty when saving fails", async () => {
    const { file, store } = createWorkspace();
    saveFileMock.mockResolvedValue({ success: false, error: "disk full" });
    renderAppCloseGuard(store);

    await act(() => requestAppClose(8));

    expect(respondToAppClose).toHaveBeenCalledWith(8, false);
    expect(store.get(fileBuffersByPathAtom)[file.path]).toEqual({
      savedText: "saved",
      editorText: "draft",
      version: openedVersion,
    });
    expect(store.get(notificationsAtom).at(-1)).toMatchObject({
      title: "Could not save note",
      path: file.path,
      message: "disk full",
    });
  });

  it("waits for an in-flight autosave before deciding whether to close", async () => {
    const { file, store } = createWorkspace();
    let finishAutosave!: (result: { success: true }) => void;
    saveFileMock
      .mockReturnValueOnce(new Promise((resolve) => (finishAutosave = resolve)))
      .mockResolvedValueOnce({ success: true, version: savedVersion });
    const autosave = saveFileTracked(file.path, "draft", saveFileMock);
    renderAppCloseGuard(store);
    let closeRequest!: Promise<void>;

    act(() => {
      closeRequest = Promise.resolve(requestAppClose(9));
    });
    await act(() => Promise.resolve());
    expect(respondToAppClose).not.toHaveBeenCalled();

    await act(async () => {
      finishAutosave({ success: true });
      await autosave;
      await closeRequest;
    });

    expect(saveFileMock).toHaveBeenCalledTimes(2);
    expect(respondToAppClose).toHaveBeenCalledWith(9, true);
  });

  it("shows why a timed-out close request was denied", () => {
    const { store } = createWorkspace();
    renderAppCloseGuard(store);

    act(() => reportAppCloseTimeout());

    expect(store.get(notificationsAtom).at(-1)).toMatchObject({
      title: "Could not close app",
      message: expect.stringContaining("window stayed open"),
    });
  });
});
