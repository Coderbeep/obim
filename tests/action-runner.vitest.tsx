import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = ReturnType<typeof createStore>;

const actions = vi.hoisted(() => ({
  addBookmark: vi.fn(),
  copyManyToDirectory: vi.fn(),
  createDirectory: vi.fn(),
  createTask: vi.fn(),
  createNewFile: vi.fn(),
  openFile: vi.fn(),
  createResearchFile: vi.fn(),
  fingerprintWorkspaceFile: vi.fn(),
  loadDocuments: vi.fn(),
  moveManyToDirectory: vi.fn(),
  openFileHistory: vi.fn(),
  readTextFile: vi.fn(),
  removeBookmark: vi.fn(),
  removeFile: vi.fn(),
  revealFile: vi.fn(),
  saveFile: vi.fn(),
  startRenaming: vi.fn(),
}));

vi.mock("@renderer/features/task-board/useTaskBoard", () => ({
  useTaskBoard: () => ({
    hasLoaded: true,
    projects: [{ name: "Research", colorId: "blue" }],
    taskActions: {
      loadTags: async () => [],
      createTask: actions.createTask,
    },
  }),
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useDirectoryCreate: () => ({ createDirectory: actions.createDirectory }),
  useFileCopy: () => ({ copyManyToDirectory: actions.copyManyToDirectory }),
  useFileCreate: () => ({ createNewFile: actions.createNewFile }),
  useFileOpen: () => ({ open: actions.openFile }),
  useFileMove: () => ({ moveManyToDirectory: actions.moveManyToDirectory }),
  useFileRemove: () => ({ remove: actions.removeFile }),
  useFileRename: () => ({ startRenaming: actions.startRenaming }),
  useManageFileBookmark: () => ({ addBookmark: actions.addBookmark, removeBookmark: actions.removeBookmark }),
}));

vi.mock("@renderer/features/files/workspaceFileService", () => ({
  createFile: actions.createResearchFile,
  fingerprintWorkspaceFile: actions.fingerprintWorkspaceFile,
  readTextFile: actions.readTextFile,
  revealInSystemFileManager: actions.revealFile,
  saveFile: actions.saveFile,
}));

vi.mock("@renderer/features/workspace/workspaceIndexOverlay", () => ({
  loadCurrentWorkspaceDocuments: actions.loadDocuments,
}));

vi.mock("@renderer/features/git/useFileHistoryOpen", () => ({
  useFileHistoryOpen: () => ({ openFileHistory: actions.openFileHistory }),
}));

import { SettingsDialog } from "../src/renderer/src/app/SettingsDialog";
import ActionRunner from "../src/renderer/src/features/actions/ActionRunner";
import { getMoveDestinations } from "../src/renderer/src/features/actions/moveToFolder";
import { dailyNoteFilename } from "../src/renderer/src/features/daily-notes/dailyNotes";
import { actionRunnerRequestAtom } from "../src/renderer/src/store/actionRunnerStore";
import {
  settingsDialogOpenRequestAtom,
  shortcutHelpOpenAtom,
  versionHistoryOpenRequestAtom,
} from "../src/renderer/src/store/appSessionStore";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { fileTreeAtom } from "../src/renderer/src/store/fileExplorerStore";
import { notePdfExportRequestAtom } from "../src/renderer/src/store/notePdfExportStore";
import { openWorkspaceItemsByKeyAtom } from "../src/renderer/src/store/workspaceResourceStore";
import type { FileItem } from "../src/shared/file-item";
import { createFileWorkspaceItem } from "../src/shared/workspace";

const note = (path: string, relativePath = path.replace("/notes/", "")): Extract<FileItem, { isDirectory: false }> => ({
  id: path,
  filename: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
  relativePath,
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const directory = (path: string, relativePath: string, children: FileItem[] = []): FileItem => ({
  id: path,
  filename: path.split("/").at(-1) ?? path,
  relativePath,
  path,
  isDirectory: true,
  mimeType: null,
  children,
});

const pdf = (path: string, relativePath = path.replace("/notes/", "")): Extract<FileItem, { isDirectory: false }> => ({
  id: path,
  filename: path.split("/").at(-1) ?? path,
  relativePath,
  path,
  isDirectory: false,
  mimeType: "application/pdf",
});

const selectCurrentFile = (store: Store, file: FileItem) => {
  const item = createFileWorkspaceItem(file);
  const tab = createEditorTab("tab-current", item.key);
  store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }]);
  store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
  store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
};

const renderRunner = (store: Store) =>
  render(
    <Provider store={store}>
      <ActionRunner />
    </Provider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  actions.createTask.mockResolvedValue(true);
  Object.defineProperty(window, "config", {
    configurable: true,
    value: { getMainDirectoryPathSync: () => "/notes", isMacOS: false },
  });
  actions.moveManyToDirectory.mockResolvedValue({ moved: [], failures: [] });
  actions.loadDocuments.mockResolvedValue([]);
  actions.fingerprintWorkspaceFile.mockResolvedValue({ success: true, fingerprint: "sha256:memory" });
  actions.createResearchFile.mockImplementation(async (directoryPath: string, filename: string) => ({
    success: true,
    file: note(`${directoryPath}/${filename}`, `Research Library/sources/${filename}`),
  }));
  actions.readTextFile.mockResolvedValue({
    success: true,
    content:
      "---\ntype: pdf-source\npdf: Papers/Memory.pdf\nfingerprint: sha256:memory\npdf-status: unread\n---\n# Memory\n",
    version: { id: "source", mtimeMs: 1, sizeBytes: 100 },
  });
  actions.saveFile.mockResolvedValue({
    success: true,
    version: { id: "linked", mtimeMs: 2, sizeBytes: 200 },
  });
  Object.defineProperty(window, "api", {
    configurable: true,
    writable: true,
    value: {
      getGitFileStatus: vi.fn(async () => ({ status: "not-repository" as const, changes: [] as const })),
      onGitFileStatusChanged: vi.fn(() => vi.fn()),
    },
  });
});

afterEach(() => cleanup());

describe("action runner", () => {
  it("opens today's daily note from the action menu using the configured directory", async () => {
    window.config.getConfigValue = vi.fn().mockResolvedValue("Journal");
    const store = createStore();
    const today = note(`/notes/Journal/${dailyNoteFilename(new Date())}`);
    store.set(fileTreeAtom, [directory("/notes/Journal", "Journal", [today])]);
    store.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(store);
    const search = screen.getByRole("combobox", { name: "Search actions" });
    fireEvent.change(search, { target: { value: "today" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(actions.openFile).toHaveBeenCalledWith(today, {
        focusEditor: true,
        openInNewTab: true,
      }),
    );
    expect(store.get(actionRunnerRequestAtom)).toBeNull();
  });

  it("opens the import-article dialog from the action menu", async () => {
    const store = createStore();
    store.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(store);
    const search = screen.getByRole("combobox", { name: "Search actions" });
    fireEvent.change(search, { target: { value: "Import article" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(await screen.findByRole("dialog", { name: "Import article" })).toBeTruthy();
    expect(store.get(actionRunnerRequestAtom)).toEqual({ view: "import-article", returnToCommands: true });
  });

  it("downloads an article PDF from the import dialog into the workspace", async () => {
    const importedPdf = pdf("/notes/imported.pdf", "imported.pdf");
    const importPdfArticle = vi.fn(async () => ({ success: true as const, file: importedPdf }));
    window.api = { ...window.api, importPdfArticle };
    const store = createStore();
    store.set(actionRunnerRequestAtom, { view: "import-article", returnToCommands: false });
    renderRunner(store);
    const user = userEvent.setup();

    const input = await screen.findByRole("textbox", { name: "DOI or arXiv article to download" });
    await user.type(input, "10.1000/example");
    await user.click(screen.getByRole("button", { name: "Download PDF" }));

    await waitFor(() => expect(importPdfArticle).toHaveBeenCalledWith("10.1000/example"));
    await waitFor(() => expect(store.get(actionRunnerRequestAtom)).toBeNull());
  });

  it("opens the shared task form and creates a task from the action menu", async () => {
    const store = createStore();
    store.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(store);
    fireEvent.change(screen.getByRole("combobox", { name: "Search actions" }), { target: { value: "create task" } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search actions" }), { key: "Enter" });
    const name = await screen.findByPlaceholderText("Task name");
    fireEvent.change(name, { target: { value: "Review forecast" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Choose project" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Research" }));
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() =>
      expect(actions.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ taskName: "Review forecast", project: "Research" }),
      ),
    );
    await waitFor(() => expect(store.get(actionRunnerRequestAtom)).toBeNull());
  });

  it("keeps a failed task draft and allows cancellation without creating another task", async () => {
    actions.createTask.mockResolvedValue(false);
    const store = createStore();
    store.set(actionRunnerRequestAtom, { view: "create-task", returnToCommands: true });
    renderRunner(store);
    const name = await screen.findByPlaceholderText("Task name");
    fireEvent.change(name, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(actions.createTask).toHaveBeenCalledTimes(1));
    expect((screen.getByPlaceholderText("Task name") as HTMLInputElement).value).toBe("Keep this draft");
    fireEvent.keyDown(name, { key: "Escape" });
    await waitFor(() => expect(store.get(actionRunnerRequestAtom)).toBeNull());
    expect(actions.createTask).toHaveBeenCalledTimes(1);
  });

  it("groups standardized commands and uses the active file as command context", () => {
    const store = createStore();
    const active = note("/notes/Inbox/Plan.md", "Inbox/Plan.md");
    selectCurrentFile(store, active);
    store.set(actionRunnerRequestAtom, { view: "commands" });

    renderRunner(store);

    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toContain("Search files");
    expect(within(screen.getByRole("group", { name: "Workspace" })).getAllByRole("option")).toHaveLength(3);
    expect(within(screen.getByRole("group", { name: "Tasks" })).getByText("New task")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Link note to PDF/ })).toBeNull();
    const fileActions = within(screen.getByRole("group", { name: "Files" }));
    expect(fileActions.getByText("New folder")).toBeTruthy();
    expect(fileActions.getByText("Open in new pane")).toBeTruthy();
    expect(fileActions.getByText("Duplicate")).toBeTruthy();
    expect(fileActions.getByText("Rename")).toBeTruthy();
    expect(fileActions.getByText("Add bookmark")).toBeTruthy();
    expect(fileActions.getByText("Show in file manager")).toBeTruthy();
    expect(fileActions.getByText("Move to Trash")).toBeTruthy();
    expect(fileActions.getByText("Import article")).toBeTruthy();
    expect(fileActions.getByText("Move to folder").closest("button")?.textContent).toContain("Inbox/Plan.md");
    const versionHistoryActions = within(screen.getByRole("group", { name: "Version history" })).getAllByRole("option");
    expect(versionHistoryActions).toHaveLength(5);
    expect(versionHistoryActions.some((action) => action.textContent?.startsWith("Sync:"))).toBe(false);
    for (const purpose of ["Workspace", "Files", "Notes", "Tasks", "Version history"]) {
      const sectionActions = within(screen.getByRole("group", { name: purpose })).getAllByRole("option");
      const sectionIcons = sectionActions.map((action) => action.querySelector(".search-panel-file-icon")?.innerHTML);
      expect(new Set(sectionIcons).size).toBe(1);
    }
    const searchInput = screen.getByRole("combobox", { name: "Search actions" });
    const queryRow = searchInput.closest(".search-panel-query-row");
    expect(queryRow).not.toBeNull();
    expect(within(queryRow as HTMLElement).getByText("Actions")).toBeTruthy();
    expect(within(queryRow as HTMLElement).getByText("Plan")).toBeTruthy();
    expect(screen.queryByText("Available actions")).toBeNull();
    expect(screen.queryByText(/\d+ actions/)).toBeNull();
    expect(document.activeElement).toBe(searchInput);
    fireEvent.keyDown(searchInput, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].textContent).toContain("Open settings");
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
  });

  it("opens settings and closes the action menu", async () => {
    const store = createStore();
    const requestNumber = store.get(settingsDialogOpenRequestAtom);
    store.set(actionRunnerRequestAtom, { view: "commands" });
    render(
      <Provider store={store}>
        <ActionRunner />
        <SettingsDialog />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("option", { name: /Open settings/ }));

    expect(store.get(actionRunnerRequestAtom)).toBeNull();
    await waitFor(() => expect(store.get(settingsDialogOpenRequestAtom)).toBe(requestNumber + 1));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeTruthy();
  });

  it("opens PDF export for the active Markdown note from the action menu", () => {
    const store = createStore();
    const active = note("/notes/Inbox/Plan.md", "Inbox/Plan.md");
    selectCurrentFile(store, active);
    store.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(store);

    fireEvent.click(screen.getByRole("option", { name: /Export as PDF/ }));

    expect(store.get(actionRunnerRequestAtom)).toBeNull();
    expect(store.get(notePdfExportRequestAtom)).toEqual(active);
  });

  it("shows keyboard shortcut help and closes the action menu", async () => {
    const store = createStore();
    store.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(store);

    fireEvent.click(screen.getByRole("option", { name: /Show keyboard shortcuts/ }));

    expect(store.get(actionRunnerRequestAtom)).toBeNull();
    await waitFor(() => expect(store.get(shortcutHelpOpenAtom)).toBe(true));
  });

  it("opens the Task Board workspace view", () => {
    const taskStore = createStore();
    taskStore.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(taskStore);
    fireEvent.click(screen.getByRole("option", { name: /Open Task Board/ }));
    expect(Object.values(taskStore.get(openWorkspaceItemsByKeyAtom))).toContainEqual(
      expect.objectContaining({ kind: "taskboard" }),
    );
  });

  it("creates a workspace folder from the action menu", () => {
    const store = createStore();
    store.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(store);

    fireEvent.click(screen.getByRole("option", { name: /New folder/ }));

    expect(actions.createDirectory).toHaveBeenCalledWith();
    expect(store.get(actionRunnerRequestAtom)).toBeNull();
  });

  it("duplicates and trashes the active file with the same operations as its context menu", async () => {
    const active = note("/notes/Inbox/Plan.md", "Inbox/Plan.md");
    const duplicateStore = createStore();
    selectCurrentFile(duplicateStore, active);
    duplicateStore.set(actionRunnerRequestAtom, { view: "commands" });
    const duplicateRender = renderRunner(duplicateStore);
    fireEvent.click(screen.getByRole("option", { name: /Duplicate/ }));
    expect(actions.copyManyToDirectory).toHaveBeenCalledWith([active], "/notes/Inbox");
    duplicateRender.unmount();

    const trashStore = createStore();
    selectCurrentFile(trashStore, active);
    trashStore.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(trashStore);
    fireEvent.click(screen.getByRole("option", { name: /Move to Trash/ }));
    expect(actions.removeFile).toHaveBeenCalledWith(active);
  });

  it("searches command labels, descriptions, and keywords", () => {
    const store = createStore();
    const active = note("/notes/Inbox/Plan.md", "Inbox/Plan.md");
    selectCurrentFile(store, active);
    store.set(actionRunnerRequestAtom, { view: "commands" });

    renderRunner(store);
    fireEvent.change(screen.getByRole("combobox", { name: "Search actions" }), {
      target: { value: "open file history" },
    });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("File history");
    expect(screen.queryByRole("group", { name: "Version history" })).toBeNull();
  });

  it("ranks a command whose label contains the searched phrase first", () => {
    const store = createStore();
    store.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(store);

    fireEvent.change(screen.getByRole("combobox", { name: "Search actions" }), {
      target: { value: "Task Board" },
    });

    expect(screen.getAllByRole("option")[0].textContent).toContain("Open Task Board");
  });

  it("saves and stages the current file", async () => {
    const active = note("/notes/Inbox/Plan.md", "Inbox/Plan.md");
    const readySnapshot = {
      status: "ready" as const,
      branch: "main",
      repositoryScope: "workspace" as const,
      changes: [
        {
          conflicted: false,
          kind: "modified" as const,
          path: active.relativePath,
          staged: false,
          workingTreeChanged: true,
        },
      ],
    };
    const getGitFileStatus = vi.fn(async () => readySnapshot);
    const stageGitPaths = vi.fn(async () => ({
      status: "succeeded" as const,
      snapshot: { ...readySnapshot, changes: [{ ...readySnapshot.changes[0], staged: true }] },
    }));
    window.api = { ...window.api, getGitFileStatus, stageGitPaths } as Window["api"];
    const store = createStore();
    selectCurrentFile(store, active);
    store.set(fileBuffersByPathAtom, {
      [active.path]: {
        editorText: "# Plan\n\nNew text\n",
        savedText: "# Plan\n",
        version: { id: "original", mtimeMs: 1, sizeBytes: 7 },
      },
    });
    store.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(store);

    const stage = screen.getByRole("option", { name: /Stage file/ });
    await waitFor(() => expect(stage.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(stage);

    await waitFor(() => expect(stageGitPaths).toHaveBeenCalledWith([active.relativePath]));
    expect(actions.saveFile).toHaveBeenCalledWith(
      active.path,
      "# Plan\n\nNew text\n",
      expect.objectContaining({ id: "original" }),
    );
    expect(store.get(fileBuffersByPathAtom)[active.path]).toMatchObject({
      editorText: "# Plan\n\nNew text\n",
      savedText: "# Plan\n\nNew text\n",
    });
    expect(store.get(actionRunnerRequestAtom)).toBeNull();
  });

  it("opens the Version History sidebar from the action menu", async () => {
    const store = createStore();
    const requestNumber = store.get(versionHistoryOpenRequestAtom);
    store.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(store);

    fireEvent.click(screen.getByRole("option", { name: /Open version history/ }));

    await waitFor(() => expect(store.get(versionHistoryOpenRequestAtom)).toBe(requestNumber + 1));
    expect(store.get(actionRunnerRequestAtom)).toBeNull();
  });

  it("confirms and discards disk and editor changes for the active file", async () => {
    const active = note("/notes/Inbox/Plan.md", "Inbox/Plan.md");
    const readySnapshot = {
      status: "ready" as const,
      branch: "main",
      repositoryScope: "workspace" as const,
      changes: [
        {
          conflicted: false,
          kind: "modified" as const,
          path: active.relativePath,
          staged: true,
          workingTreeChanged: true,
        },
      ],
    };
    const getGitFileStatus = vi.fn(async () => readySnapshot);
    const revertGitPaths = vi.fn(async () => ({
      status: "succeeded" as const,
      snapshot: { ...readySnapshot, changes: [] },
    }));
    const openTextFile = vi.fn(async () => ({
      content: "# Committed plan\n",
      version: { id: "restored", mtimeMs: 3, sizeBytes: 17 },
    }));
    window.api = { ...window.api, getGitFileStatus, openTextFile, revertGitPaths } as Window["api"];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const store = createStore();
    selectCurrentFile(store, active);
    store.set(fileBuffersByPathAtom, {
      [active.path]: {
        editorText: "# Unsaved plan\n",
        savedText: "# Saved plan\n",
        version: { id: "saved", mtimeMs: 2, sizeBytes: 13 },
      },
    });
    store.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(store);

    const discard = screen.getByRole("option", { name: /Discard file changes/ });
    await waitFor(() => expect(discard.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(discard);

    await waitFor(() => expect(revertGitPaths).toHaveBeenCalledWith([active.relativePath]));
    await waitFor(() =>
      expect(store.get(fileBuffersByPathAtom)[active.path]).toMatchObject({
        editorText: "# Committed plan\n",
        savedText: "# Committed plan\n",
        version: expect.objectContaining({ id: "restored" }),
      }),
    );
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("cannot be undone"));
    confirm.mockRestore();
  });

  it("fetches and pushes ahead commits with Sync now", async () => {
    const localSnapshot = {
      status: "ready" as const,
      branch: "main",
      repositoryScope: "workspace" as const,
      changes: [],
    };
    const aheadSync = {
      status: "ready" as const,
      ahead: 2,
      behind: 0,
      branch: "main",
      remote: { fetchUrl: "git@example.com:notes.git", name: "origin" as const },
      state: "ahead" as const,
    };
    const getGitFileStatus = vi.fn(async () => localSnapshot);
    const fetchGitRemote = vi.fn(async () => ({
      status: "succeeded" as const,
      action: "fetched" as const,
      snapshot: localSnapshot,
      sync: aheadSync,
    }));
    const pushGitRemote = vi.fn(async () => ({
      status: "succeeded" as const,
      action: "pushed" as const,
      snapshot: localSnapshot,
      sync: { ...aheadSync, ahead: 0, state: "up-to-date" as const },
    }));
    window.api = { ...window.api, fetchGitRemote, getGitFileStatus, pushGitRemote } as Window["api"];
    const store = createStore();
    store.set(actionRunnerRequestAtom, { view: "commands" });
    renderRunner(store);

    const sync = screen.getByRole("option", { name: /Sync now/ });
    await waitFor(() => expect(sync.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(sync);

    await waitFor(() => expect(fetchGitRemote).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pushGitRemote).toHaveBeenCalledTimes(1));
    expect(store.get(actionRunnerRequestAtom)).toBeNull();
  });

  it("drills into searchable folders and moves the contextual active file", async () => {
    const store = createStore();
    const active = note("/notes/Inbox/Plan.md", "Inbox/Plan.md");
    const archive = directory("/notes/Archive", "Archive");
    const inbox = directory("/notes/Inbox", "Inbox");
    selectCurrentFile(store, active);
    store.set(fileTreeAtom, [inbox, archive]);
    store.set(actionRunnerRequestAtom, { view: "commands" });
    actions.moveManyToDirectory.mockResolvedValue({
      moved: [{ file: active, movedPath: "/notes/Archive/Plan.md" }],
      failures: [],
    });

    renderRunner(store);
    fireEvent.click(screen.getByRole("option", { name: /Move to folder/ }));

    const folderSearch = await screen.findByRole("combobox", { name: "Search destination folders" });
    fireEvent.change(folderSearch, { target: { value: "archive" } });
    fireEvent.click(screen.getByRole("option", { name: /Archive/ }));

    await waitFor(() => expect(actions.moveManyToDirectory).toHaveBeenCalledWith([active], "/notes/Archive"));
    expect(store.get(actionRunnerRequestAtom)).toBeNull();
  });

  it("returns to actions with Escape when a move was started from the action list", async () => {
    const store = createStore();
    const active = note("/notes/Inbox/Plan.md", "Inbox/Plan.md");
    selectCurrentFile(store, active);
    store.set(fileTreeAtom, [directory("/notes/Archive", "Archive")]);
    store.set(actionRunnerRequestAtom, { view: "commands" });

    renderRunner(store);
    fireEvent.click(screen.getByRole("option", { name: /Move to folder/ }));
    const folderSearch = await screen.findByRole("combobox", { name: "Search destination folders" });
    fireEvent.keyDown(folderSearch, { key: "Escape" });

    expect(store.get(actionRunnerRequestAtom)).toEqual({ view: "commands" });
    expect(await screen.findByRole("combobox", { name: "Search actions" })).toBeTruthy();
  });
});

describe("move destination filtering", () => {
  it("hides a selected folder, its descendants, and a destination where nothing would move", () => {
    const child = directory("/notes/Projects/Child", "Projects/Child");
    const projects = directory("/notes/Projects", "Projects", [child]);
    const archive = directory("/notes/Archive", "Archive");

    const destinations = getMoveDestinations([projects, archive], "/notes", [projects], "");

    expect(destinations.map((item) => item.path)).toEqual(["/notes/Archive"]);
  });
});
