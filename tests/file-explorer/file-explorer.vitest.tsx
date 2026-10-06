import { Provider, createStore } from "jotai";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "../../src/renderer/src/features/notifications/notifications";
import { bookmarksAtom } from "../../src/renderer/src/store/bookmarkStore";
import {
  expandedDirectoriesAtom,
  explorerSectionSizesAtom,
  explorerSectionsAtom,
  recentFilesAtom,
  reloadRevisionAtom,
} from "../../src/renderer/src/store/fileExplorerStore";
import { notificationsAtom } from "../../src/renderer/src/store/NotificationsStore";
import { workspacePanesAtom } from "../../src/renderer/src/store/editorPaneStore";
import { workspaceTabsByIdAtom } from "../../src/renderer/src/store/editorTabStore";
import { openWorkspaceItemsByKeyAtom } from "../../src/renderer/src/store/workspaceResourceStore";
import { createFileWorkspaceItem } from "../../src/shared/workspace";
import { createEditorTab } from "../../src/renderer/src/store/editorTabStore";
import type { FileItem } from "../../src/shared/file-item";

type Store = ReturnType<typeof createStore>;

const state = vi.hoisted(() => ({
  actionsProps: vi.fn(),
  importExternalFiles: vi.fn(),
  layoutProps: vi.fn(),
  open: vi.fn(),
  openBookmarkMenu: vi.fn(),
  openFileMenu: vi.fn(),
  setLayout: vi.fn(),
  toggleAllDirectories: vi.fn(),
  treeProps: vi.fn(),
  gitStatusChanged: null as null | Parameters<Window["api"]["onGitFileStatusChanged"]>[0],
  unsubscribeGitStatus: vi.fn(),
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children, className, ...props }: { children: React.ReactNode; className?: string }) => {
    state.layoutProps(props);
    return <div className={className}>{children}</div>;
  },
  Panel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Separator: ({
    "aria-label": ariaLabel,
    className,
    disabled,
  }: {
    "aria-label"?: string;
    className?: string;
    disabled?: boolean;
  }) => (
    <div
      role="separator"
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      className={className}
      data-separator={disabled ? "disabled" : "vertical"}
    />
  ),
  useGroupRef: () => ({ current: { setLayout: state.setLayout } }),
}));

vi.mock("../../src/renderer/src/features/files/explorer/FileExplorerTreeHeader", () => ({
  FileExplorerHeader: () => <div data-testid="file-explorer-header" />,
  FileExplorerActions: (props: { allDirectoriesExpanded: boolean; onToggleAllDirectories: () => void }) => {
    state.actionsProps(props);
    return (
      <button data-testid="file-explorer-actions" onClick={props.onToggleAllDirectories}>
        Toggle
      </button>
    );
  },
}));

vi.mock("../../src/renderer/src/features/files/explorer/FileExplorerTree", () => ({
  FileExplorerTree: forwardRef(function MockFileExplorerTree(props: { items: FileItem[] }, ref) {
    state.treeProps(props);
    useImperativeHandle(ref, () => ({ toggleAllDirectories: state.toggleAllDirectories }), []);
    return <output data-testid="file-tree">{props.items.map((item) => item.path).join(",")}</output>;
  }),
}));

vi.mock("@renderer/features/files/fileActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/renderer/src/features/files/fileActions")>()),
  useFileOpen: () => ({ open: state.open }),
}));

vi.mock("@renderer/features/files/menus/useBookmarkMenu", () => ({
  useBookmarkMenu: () => ({ openBookmarkMenu: state.openBookmarkMenu }),
}));

vi.mock("@renderer/features/files/menus/useFileMenu", () => ({
  useFileMenu: () => ({ openFileMenu: state.openFileMenu }),
}));

vi.mock("@renderer/features/files/workspaceFileService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/renderer/src/features/files/workspaceFileService")>()),
  importExternalFiles: state.importExternalFiles,
}));

import { FileExplorer } from "../../src/renderer/src/features/files/explorer/FileExplorer";

const file = (path: string, overrides: Partial<FileItem> = {}): FileItem =>
  ({
    id: path,
    filename: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
    relativePath: path.replace("/notes-root/", ""),
    path,
    isDirectory: false,
    mimeType: "text/markdown",
    ...overrides,
  }) as FileItem;

const directory = (path: string, children: FileItem[] = []): FileItem => ({
  id: path,
  filename: path.split("/").at(-1) ?? path,
  relativePath: path.replace("/notes-root/", ""),
  path,
  isDirectory: true,
  mimeType: null,
  children,
});

const renderExplorer = (store: Store = createStore()) => ({
  store,
  ...render(
    <Provider store={store}>
      <FileExplorer onSearch={vi.fn()} />
    </Provider>,
  ),
});

const requestReload = (store: Store) => store.set(reloadRevisionAtom, (revision) => revision + 1);

const selectCurrentFile = (store: Store, file: FileItem) => {
  const item = createFileWorkspaceItem(file);
  const tab = createEditorTab("current-file-tab", item.key);
  store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }]);
  store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
  store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
};

const latestTreeProps = () =>
  state.treeProps.mock.lastCall?.[0] as {
    gitStatus: readonly { path: string; status: string }[];
    items: FileItem[];
    onExternalFileDrop: (files: File[], directory: FileItem | null) => void;
  };

const auxClick = (target: EventTarget, button: number) =>
  target.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button, cancelable: true }));

describe("FileExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.importExternalFiles.mockResolvedValue({ importedPaths: [], errors: [] });
    window.config = { getMainDirectoryPathSync: () => "/notes-root" } as Window["config"];
    window.api = {
      doesFileExist: vi.fn().mockResolvedValue(false),
      getFilesRecursiveAsTree: vi.fn().mockResolvedValue({ revision: 0, items: [] }),
      getGitFileStatus: vi.fn().mockResolvedValue({ status: "not-repository", changes: [] }),
      onGitFileStatusChanged: vi.fn((callback) => {
        state.gitStatusChanged = callback;
        return state.unsubscribeGitStatus;
      }),
      openFile: vi.fn(),
      upsertFile: vi.fn().mockResolvedValue(true),
    } as unknown as Window["api"];
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads IPC tree data and forwards the complete tree contract", async () => {
    const loaded = directory("/notes-root/notes", [
      file("/notes-root/notes/first.md"),
      file("/notes-root/notes/second.md"),
    ]);
    vi.mocked(window.api.getFilesRecursiveAsTree).mockResolvedValue({ revision: 4, items: [loaded] });

    renderExplorer();

    await waitFor(() => expect(screen.getByTestId("file-tree").textContent).toContain(loaded.path));
    expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledWith("/notes-root");
    expect(window.api.upsertFile).not.toHaveBeenCalled();
    expect(screen.getByText("2")).toBeTruthy();
    expect(state.treeProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enableFileMove: true,
        items: [loaded],
        syncSelection: true,
      }),
    );
  });

  it("loads Git changes without duplicating their count and forwards only native Pierre file statuses", async () => {
    const note = file("/notes-root/Folder/note.md");
    const folder = directory("/notes-root/Folder", [note]);
    vi.mocked(window.api.getFilesRecursiveAsTree).mockResolvedValue({ revision: 1, items: [folder] });
    vi.mocked(window.api.getGitFileStatus).mockResolvedValue({
      status: "ready",
      changes: [
        {
          conflicted: false,
          kind: "modified",
          path: "Folder/note.md",
          staged: false,
          workingTreeChanged: true,
        },
      ],
      repositoryScope: "workspace",
    });

    const { container } = renderExplorer();

    await waitFor(() => expect(latestTreeProps().gitStatus).toEqual([{ path: "Folder/note.md", status: "modified" }]));
    expect(container.querySelector(".file-explorer-section-count")?.textContent).toBe("1");
    expect(container.querySelector(".file-explorer-git-count")).toBeNull();
    expect(latestTreeProps().gitStatus.some((entry) => entry.path === "Folder" || entry.path === "Folder/")).toBe(
      false,
    );
  });

  it("refreshes indicators for Git metadata and reloads the tree for possible worktree shape changes", async () => {
    renderExplorer();
    await waitFor(() => expect(window.api.getGitFileStatus).toHaveBeenCalledOnce());
    expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledOnce();

    state.gitStatusChanged?.({ treeMayHaveChanged: false });
    await waitFor(() => expect(window.api.getGitFileStatus).toHaveBeenCalledTimes(2));
    expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledOnce();

    state.gitStatusChanged?.({ treeMayHaveChanged: true });
    await waitFor(() => expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledTimes(2));
    expect(window.api.getGitFileStatus).toHaveBeenCalledTimes(3);
  });

  it("does not rebuild the tree when an atomic save replaces an existing note", async () => {
    const note = file("/notes-root/note.md");
    vi.mocked(window.api.getFilesRecursiveAsTree).mockResolvedValue({ revision: 1, items: [note] });
    vi.mocked(window.api.doesFileExist).mockResolvedValue(true);
    renderExplorer();
    await screen.findByText(note.path);
    await waitFor(() => expect(window.api.getGitFileStatus).toHaveBeenCalledOnce());

    state.gitStatusChanged?.({ treeMayHaveChanged: true, paths: ["note.md"] });

    await waitFor(() => expect(window.api.getGitFileStatus).toHaveBeenCalledTimes(2));
    expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledOnce();
  });

  it("reloads once for a refresh burst without losing the request", async () => {
    const first = file("/notes-root/first.md");
    const second = file("/notes-root/second.md");
    vi.mocked(window.api.getFilesRecursiveAsTree)
      .mockResolvedValueOnce({ revision: 0, items: [first] })
      .mockResolvedValueOnce({ revision: 1, items: [second] });

    const { store } = renderExplorer();
    await screen.findByText(first.path);
    requestReload(store);
    requestReload(store);

    await waitFor(() => expect(screen.getByTestId("file-tree").textContent).toContain(second.path));
    expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledTimes(2);
  });

  it("accepts a changed snapshot at the same revision", async () => {
    const first = file("/notes-root/first.md");
    const replacement = file("/notes-root/replacement.md");
    vi.mocked(window.api.getFilesRecursiveAsTree)
      .mockResolvedValueOnce({ revision: 8, items: [first] })
      .mockResolvedValueOnce({ revision: 8, items: [replacement] });
    const { store } = renderExplorer();
    await screen.findByText(first.path);

    requestReload(store);

    await waitFor(() => expect(screen.getByTestId("file-tree").textContent).toContain(replacement.path));
  });

  it("keeps the existing tree identity for a recursively equal snapshot", async () => {
    const child = file("/notes-root/Folder/note.md");
    const first = directory("/notes-root/Folder", [child]);
    const equalClone = directory("/notes-root/Folder", [{ ...child }]);
    vi.mocked(window.api.getFilesRecursiveAsTree)
      .mockResolvedValueOnce({ revision: 1, items: [first] })
      .mockResolvedValueOnce({ revision: 2, items: [equalClone] });
    const { store } = renderExplorer();
    await screen.findByText(first.path);
    const originalItems = latestTreeProps().items;

    requestReload(store);
    await waitFor(() => expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledTimes(2));

    expect(latestTreeProps().items).toBe(originalItems);
  });

  it("ignores a late snapshot older than the tree already rendered", async () => {
    const current = file("/notes-root/current.md");
    const stale = file("/notes-root/stale.md");
    let resolveStale!: (snapshot: { revision: number; items: FileItem[] }) => void;
    vi.mocked(window.api.getFilesRecursiveAsTree)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValueOnce({ revision: 2, items: [current] });

    const { store } = renderExplorer();
    requestReload(store);
    await waitFor(() => expect(screen.getByTestId("file-tree").textContent).toContain(current.path));
    resolveStale({ revision: 1, items: [stale] });
    await Promise.resolve();

    expect(screen.getByTestId("file-tree").textContent).toContain(current.path);
    expect(screen.getByTestId("file-tree").textContent).not.toContain(stale.path);
  });

  it("keeps rendering after failure and clears the alert after a successful refresh", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(window.api.getFilesRecursiveAsTree)
      .mockRejectedValueOnce(new Error("Workspace unavailable"))
      .mockResolvedValueOnce({ revision: 1, items: [file("/notes-root/recovered.md")] });
    renderExplorer();

    expect((await screen.findByRole("alert")).textContent).toContain("Files couldn't be refreshed");
    expect(screen.getByTestId("file-tree")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await screen.findByText("/notes-root/recovered.md");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a pending load and later refresh state after unmount", async () => {
    let resolve!: (snapshot: { revision: number; items: FileItem[] }) => void;
    vi.mocked(window.api.getFilesRecursiveAsTree).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { store, unmount } = renderExplorer();
    unmount();
    resolve({ revision: 1, items: [file("/notes-root/late.md")] });
    requestReload(store);
    await Promise.resolve();

    expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledTimes(1);
  });

  it("stacks independently collapsible files, bookmarks, and recent sections with shortcut semantics", async () => {
    const recent = file("/notes-root/Folder/recent.md");
    const pinned = file("/notes-root/pinned.md", { mimeType: null });
    const store = createStore();
    store.set(recentFilesAtom, [recent]);
    store.set(bookmarksAtom, [pinned]);
    vi.mocked(window.api.doesFileExist).mockResolvedValue(true);
    vi.mocked(window.api.openFile).mockResolvedValue(
      JSON.stringify({ items: [{ type: "file", path: pinned.relativePath }] }),
    );
    vi.mocked(window.api.getFilesRecursiveAsTree).mockResolvedValue({ revision: 0, items: [recent, pinned] });
    selectCurrentFile(store, recent);
    renderExplorer(store);

    const filesSection = screen.getByRole("button", { name: "Files section" });
    const bookmarksSection = screen.getByRole("button", { name: "Bookmarks section" });
    const recentSection = screen.getByRole("button", { name: "Recent section" });
    expect(screen.queryByRole("tab")).toBeNull();
    expect(filesSection.getAttribute("aria-expanded")).toBe("true");
    expect(bookmarksSection.getAttribute("aria-expanded")).toBe("true");
    expect(recentSection.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("region", { name: "Bookmarks" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Recent" })).toBeNull();

    fireEvent.click(recentSection);
    const recentButton = screen.getByRole("button", { name: "recent.md" });
    expect(screen.getByRole("region", { name: "Recent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recent section" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Bookmarks" })).toBeTruthy();
    expect(recentButton.getAttribute("title")).toBe("Folder/recent.md");
    expect(recentButton.getAttribute("aria-current")).toBe("page");

    fireEvent.click(recentButton);
    const pinnedButton = screen.getByRole("button", { name: "pinned.md" });
    expect(pinnedButton.getAttribute("aria-current")).toBeNull();
    auxClick(pinnedButton, 0);
    auxClick(pinnedButton, 1);
    expect(state.open.mock.calls).toEqual([
      [recent, { focusEditor: true }],
      [pinned, { openInNewTab: true }],
    ]);

    fireEvent.contextMenu(pinnedButton, { clientX: 12, clientY: 24 });
    expect(state.openBookmarkMenu).toHaveBeenCalledWith(expect.anything(), pinned);
    expect(state.openFileMenu).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Bookmarks section" }));
    expect(screen.getByRole("button", { name: "Bookmarks section" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "Bookmarks" })).toBeNull();
    expect(screen.getByRole("region", { name: "Recent" })).toBeTruthy();
  });

  it("keeps resized proportional section sizes in workspace state", async () => {
    const store = createStore();
    store.set(explorerSectionsAtom, { bookmarks: true, files: true, recent: true });
    renderExplorer(store);
    await waitFor(() => expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledOnce());

    expect(screen.getByRole("separator", { name: "Resize Files and Bookmarks sections" })).toBeTruthy();
    const onLayoutChanged = state.layoutProps.mock.lastCall?.[0].onLayoutChanged as (
      layout: { [id: string]: number },
      meta: { isUserInteraction: boolean },
    ) => void;
    act(() => {
      onLayoutChanged(
        {
          "file-explorer-bookmarks": 20,
          "file-explorer-files": 50,
          "file-explorer-recent": 30,
        },
        { isUserInteraction: true },
      );
    });

    expect(store.get(explorerSectionSizesAtom)).toEqual({ bookmarks: 0.8, files: 2, recent: 1.2 });
    expect(state.layoutProps.mock.lastCall?.[0].defaultLayout).toEqual({
      "file-explorer-files": 2,
      "file-explorer-bookmarks": 0.8,
      "file-explorer-recent": 1.2,
    });
  });

  it("preserves hidden section proportions when a section is collapsed", async () => {
    const store = createStore();
    store.set(explorerSectionsAtom, { bookmarks: true, files: true, recent: true });
    renderExplorer(store);
    await waitFor(() => expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledOnce());

    state.setLayout.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Recent section" }));
    await waitFor(() =>
      expect(state.setLayout).toHaveBeenLastCalledWith({
        "file-explorer-files": 2,
        "file-explorer-bookmarks": 1,
        "file-explorer-recent": 1,
      }),
    );
    const onLayoutChanged = state.layoutProps.mock.lastCall?.[0].onLayoutChanged as (
      layout: { [id: string]: number },
      meta: { isUserInteraction: boolean },
    ) => void;
    act(() => {
      onLayoutChanged(
        {
          "file-explorer-bookmarks": 32,
          "file-explorer-files": 64,
          "file-explorer-recent": 4,
        },
        { isUserInteraction: true },
      );
    });

    expect(store.get(explorerSectionSizesAtom)).toEqual({ bookmarks: 1, files: 2, recent: 1 });
  });

  it.each(["Files", "Bookmarks", "Recent"])(
    "restores %s after its expanded constraints have updated",
    async (title) => {
      const store = createStore();
      const sizes = { files: 2, bookmarks: 0.8, recent: 1.2 };
      store.set(explorerSectionsAtom, { files: true, bookmarks: true, recent: true });
      store.set(explorerSectionSizesAtom, sizes);
      renderExplorer(store);
      await waitFor(() => expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledOnce());

      fireEvent.click(screen.getByRole("button", { name: `${title} section` }));
      await waitFor(() => expect(state.setLayout).toHaveBeenCalled());
      state.setLayout.mockClear();

      fireEvent.click(screen.getByRole("button", { name: `${title} section` }));
      expect(state.setLayout).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(state.setLayout).toHaveBeenLastCalledWith({
          "file-explorer-files": 2,
          "file-explorer-bookmarks": 0.8,
          "file-explorer-recent": 1.2,
        }),
      );
      expect(store.get(explorerSectionSizesAtom)).toEqual(sizes);
    },
  );

  it("does not persist layout changes caused by restore or constraint recalculation", async () => {
    const store = createStore();
    store.set(explorerSectionsAtom, { bookmarks: true, files: true, recent: true });
    store.set(explorerSectionSizesAtom, { bookmarks: 1, files: 2, recent: 1 });
    renderExplorer(store);
    await waitFor(() => expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledOnce());

    const onLayoutChanged = state.layoutProps.mock.lastCall?.[0].onLayoutChanged as (
      layout: { [id: string]: number },
      meta: { isUserInteraction: boolean },
    ) => void;
    const constrainedLayout = {
      "file-explorer-bookmarks": 18,
      "file-explorer-files": 54,
      "file-explorer-recent": 28,
    };

    act(() => {
      onLayoutChanged(constrainedLayout, { isUserInteraction: false });
      onLayoutChanged(constrainedLayout, { isUserInteraction: false });
    });

    expect(store.get(explorerSectionSizesAtom)).toEqual({ bookmarks: 1, files: 2, recent: 1 });
  });

  it("applies restored workspace section sizes to an already mounted group", async () => {
    const { store } = renderExplorer();
    await waitFor(() => expect(window.api.getFilesRecursiveAsTree).toHaveBeenCalledOnce());
    state.setLayout.mockClear();

    act(() => store.set(explorerSectionSizesAtom, { bookmarks: 2, files: 5, recent: 3 }));

    await waitFor(() =>
      expect(state.setLayout).toHaveBeenLastCalledWith({
        "file-explorer-files": 5,
        "file-explorer-bookmarks": 2,
        "file-explorer-recent": 3,
      }),
    );
  });

  it("offers expand for a partial tree, collapse for a fully expanded tree, and delegates the command", async () => {
    const loaded = directory("/notes-root/A", [directory("/notes-root/A/B")]);
    vi.mocked(window.api.getFilesRecursiveAsTree).mockResolvedValue({ revision: 1, items: [loaded] });
    const store = createStore();
    store.set(expandedDirectoriesAtom, new Set(["A"]));
    renderExplorer(store);

    await waitFor(() =>
      expect(state.actionsProps).toHaveBeenLastCalledWith(expect.objectContaining({ allDirectoriesExpanded: false })),
    );
    store.set(expandedDirectoriesAtom, new Set(["A", "A/B"]));
    await waitFor(() =>
      expect(state.actionsProps).toHaveBeenLastCalledWith(expect.objectContaining({ allDirectoriesExpanded: true })),
    );
    fireEvent.click(screen.getByTestId("file-explorer-actions"));
    expect(state.toggleAllDirectories).toHaveBeenCalledTimes(1);
  });

  it("imports into the supplied directory and emits success plus summarized error notifications", async () => {
    state.importExternalFiles.mockResolvedValue({
      importedPaths: ["/notes-root/inbox/one.md", "/notes-root/inbox/two.md"],
      errors: ["denied", "collision", "unreadable"],
    });
    const target = directory("/notes-root/inbox");
    const { store } = renderExplorer();

    latestTreeProps().onExternalFileDrop([new File(["one"], "one.md")], target);
    await waitFor(() => expect(store.get(notificationsAtom)).toHaveLength(2));

    const notifications: Notification[] = store.get(notificationsAtom);
    expect(state.importExternalFiles).toHaveBeenCalledWith(expect.any(Array), target.path);
    expect(notifications.map((item) => item.title)).toEqual(["Imported 2 items", "File import failed"]);
    expect(notifications[1].message).toBe("denied (+2 more)");
  });

  it("uses the workspace root and reports single and thrown import failures", async () => {
    state.importExternalFiles.mockResolvedValueOnce({ importedPaths: [], errors: ["single failure"] });
    const { store } = renderExplorer();

    latestTreeProps().onExternalFileDrop([new File([], "bad.md")], null);
    await waitFor(() => expect(store.get(notificationsAtom).at(-1)?.message).toBe("single failure"));
    expect(state.importExternalFiles).toHaveBeenLastCalledWith(expect.any(Array), "/notes-root");

    state.importExternalFiles.mockRejectedValueOnce("bridge offline");
    latestTreeProps().onExternalFileDrop([new File([], "bad.md")], null);
    await waitFor(() => expect(store.get(notificationsAtom).at(-1)?.message).toBe("bridge offline"));

    state.importExternalFiles.mockRejectedValueOnce(new Error("permission revoked"));
    latestTreeProps().onExternalFileDrop([new File([], "bad.md")], null);
    await waitFor(() => expect(store.get(notificationsAtom).at(-1)?.message).toBe("permission revoked"));
  });
});
