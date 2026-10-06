import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InspectorSidebar,
  InspectorSidebarProvider,
  LeftSidebar,
  useInspectorSidebarControls,
} from "../src/renderer/src/app/AppSidebars";
import { SidebarResizer } from "../src/renderer/src/app/SidebarResizer";
import { APP_THEME_STORAGE_KEY } from "../src/renderer/src/app/theme";
import { WindowTitleBar } from "../src/renderer/src/app/WindowTitleBar";
import { versionHistoryOpenRequestAtom } from "../src/renderer/src/store/appSessionStore";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { fileTreeAtom } from "../src/renderer/src/store/fileExplorerStore";
import { fileSaveStatesByPathAtom } from "../src/renderer/src/store/fileSaveStore";
import { openWorkspaceItemsByKeyAtom } from "../src/renderer/src/store/workspaceResourceStore";
import { createTaskBoardWorkspaceItem } from "../src/shared/workspace";

vi.mock("@renderer/features/workspace/usePaneWorkspace", () => ({
  usePaneTabActivation: () => ({ activateResource: vi.fn() }),
}));

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

beforeAll(() => vi.stubGlobal("PointerEvent", TestPointerEvent));
afterAll(() => vi.unstubAllGlobals());

let showWindowControls = true;
let setShowWindowControls: ReturnType<typeof vi.fn>;
let exportWorkspaceBackup: ReturnType<typeof vi.fn>;
let appTheme: "dark" | "light" | null;
let setTheme: ReturnType<typeof vi.fn>;
let sidebarPlacement: "explorer-left" | "explorer-right";
let setSidebarPlacement: ReturnType<typeof vi.fn>;
let getGitFileStatus: ReturnType<typeof vi.fn>;
let getGitRemoteConfiguration: ReturnType<typeof vi.fn>;
let getGitRemoteSyncStatus: ReturnType<typeof vi.fn>;
let getGitAutoSyncSettings: ReturnType<typeof vi.fn>;
let setGitAutoSyncSettings: ReturnType<typeof vi.fn>;
let getGitIgnoreSettings: ReturnType<typeof vi.fn>;
let updateGitIgnoreSettings: ReturnType<typeof vi.fn>;
let initializeGitRepository: ReturnType<typeof vi.fn>;
let removeGitRemote: ReturnType<typeof vi.fn>;
let setGitRemoteUrl: ReturnType<typeof vi.fn>;
let fetchGitRemote: ReturnType<typeof vi.fn>;
let pullGitRemote: ReturnType<typeof vi.fn>;
let pushGitRemote: ReturnType<typeof vi.fn>;
let beginGitRemoteReconciliation: ReturnType<typeof vi.fn>;
let resolveGitConflict: ReturnType<typeof vi.fn>;
let abortGitRemoteReconciliation: ReturnType<typeof vi.fn>;
let openTextFile: ReturnType<typeof vi.fn>;
let stageGitPaths: ReturnType<typeof vi.fn>;
let unstageGitPaths: ReturnType<typeof vi.fn>;
let revertGitPaths: ReturnType<typeof vi.fn>;
let commitGitChanges: ReturnType<typeof vi.fn>;
let saveFile: ReturnType<typeof vi.fn>;
let getConfigValue: ReturnType<typeof vi.fn>;
let updateConfig: ReturnType<typeof vi.fn>;
let removeRecentWorkspace: ReturnType<typeof vi.fn>;
let gitFileStatusChanged: ((event: { treeMayHaveChanged: boolean }) => void) | undefined;

beforeEach(() => {
  showWindowControls = true;
  setShowWindowControls = vi.fn(async (visible: boolean) => {
    showWindowControls = visible;
  });
  exportWorkspaceBackup = vi.fn(async () => ({ status: "created" as const, path: "/backups/Obim Backup" }));
  appTheme = null;
  setTheme = vi.fn(async (theme: "dark" | "light") => {
    appTheme = theme;
  });
  sidebarPlacement = "explorer-left";
  setSidebarPlacement = vi.fn(async (placement: "explorer-left" | "explorer-right") => {
    sidebarPlacement = placement;
  });
  getGitFileStatus = vi.fn(async () => ({ status: "not-repository" as const, changes: [] as const }));
  getGitRemoteConfiguration = vi.fn(async () => ({ status: "not-repository" as const }));
  getGitRemoteSyncStatus = vi.fn(async () => ({ status: "not-configured" as const }));
  getGitAutoSyncSettings = vi.fn(async () => ({ conflictResolution: "keep-local" as const, intervalMinutes: 0 }));
  setGitAutoSyncSettings = vi.fn(async (settings) => settings);
  getGitIgnoreSettings = vi.fn(async () => ({ status: "ready" as const, settings: { patterns: "" } }));
  updateGitIgnoreSettings = vi.fn(async (patterns: string) => ({
    status: "succeeded" as const,
    settings: { patterns },
    snapshot: { status: "ready" as const, branch: "main", changes: [], repositoryScope: "workspace" as const },
    untrackedPaths: [],
  }));
  gitFileStatusChanged = undefined;
  initializeGitRepository = vi.fn(async () => ({
    status: "succeeded" as const,
    snapshot: {
      status: "ready" as const,
      changes: [],
      repositoryScope: "workspace" as const,
    },
  }));
  stageGitPaths = vi.fn(async () => ({
    status: "succeeded" as const,
    snapshot: { status: "ready" as const, branch: "main", changes: [], repositoryScope: "workspace" as const },
  }));
  unstageGitPaths = vi.fn(async () => ({
    status: "succeeded" as const,
    snapshot: { status: "ready" as const, branch: "main", changes: [], repositoryScope: "workspace" as const },
  }));
  revertGitPaths = vi.fn(async () => ({
    status: "succeeded" as const,
    snapshot: { status: "ready" as const, branch: "main", changes: [], repositoryScope: "workspace" as const },
  }));
  commitGitChanges = vi.fn(async () => ({
    status: "succeeded" as const,
    snapshot: { status: "ready" as const, branch: "main", changes: [], repositoryScope: "workspace" as const },
  }));
  saveFile = vi.fn(async (_path, content: string) => ({
    success: true as const,
    version: { id: "note-file", mtimeMs: 20, sizeBytes: content.length },
  }));
  getConfigValue = vi.fn(async (key: string) => {
    if (key === "taskCreationDirectory") return "Tasks";
    if (key === "clippedNoteCreationDirectory") return "Research notes";
    if (key === "dailyNoteCreationDirectory") return "";
    throw new Error(`Missing config value: ${key}`);
  });
  updateConfig = vi.fn(async () => undefined);
  removeRecentWorkspace = vi.fn(async () => ["/notes"]);
  setGitRemoteUrl = vi.fn(async (url: string) => ({
    status: "succeeded" as const,
    configuration: {
      status: "ready" as const,
      remote: { fetchUrl: url, name: "origin" as const },
      repositoryScope: "workspace" as const,
    },
  }));
  removeGitRemote = vi.fn(async () => ({
    status: "succeeded" as const,
    configuration: {
      status: "ready" as const,
      repositoryScope: "workspace" as const,
    },
  }));
  const defaultSyncSnapshot = {
    status: "ready" as const,
    ahead: 0,
    behind: 0,
    branch: "main",
    remote: { fetchUrl: "git@github.com:example/notes.git", name: "origin" as const },
    state: "unpublished" as const,
  };
  fetchGitRemote = vi.fn(async () => ({
    status: "succeeded" as const,
    action: "fetched" as const,
    snapshot: { status: "ready" as const, branch: "main", changes: [], repositoryScope: "workspace" as const },
    sync: defaultSyncSnapshot,
  }));
  pullGitRemote = vi.fn(async () => ({
    status: "succeeded" as const,
    action: "up-to-date" as const,
    snapshot: { status: "ready" as const, branch: "main", changes: [], repositoryScope: "workspace" as const },
    sync: { ...defaultSyncSnapshot, state: "up-to-date" as const },
  }));
  pushGitRemote = vi.fn(async () => ({
    status: "succeeded" as const,
    action: "pushed" as const,
    snapshot: { status: "ready" as const, branch: "main", changes: [], repositoryScope: "workspace" as const },
    sync: { ...defaultSyncSnapshot, state: "up-to-date" as const },
  }));
  beginGitRemoteReconciliation = vi.fn();
  resolveGitConflict = vi.fn();
  abortGitRemoteReconciliation = vi.fn();
  openTextFile = vi.fn(async () => ({
    content: "remote text",
    version: { id: "note-file", mtimeMs: 30, sizeBytes: 11 },
  }));
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024, writable: true });
  Object.defineProperty(window, "config", {
    configurable: true,
    value: {
      isMacOS: true,
      getShowWindowControlsSync: () => showWindowControls,
      setShowWindowControls,
      getThemeSync: () => appTheme,
      setTheme,
      getSidebarPlacementSync: () => sidebarPlacement,
      setSidebarPlacement,
      getWorkspaceStatusSync: () => ({ status: "ready" as const, path: "/notes" }),
      getMainDirectoryPathSync: () => "/notes",
      getRecentWorkspacesSync: () => ["/notes", "/archive"],
      initializeConfig: vi.fn(async () => ({ status: "cancelled" as const })),
      selectRecentWorkspace: vi.fn(async () => ({ status: "cancelled" as const })),
      removeRecentWorkspace,
      exportWorkspaceBackup,
      getConfigValue,
      updateConfig,
    },
  });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      getGitFileStatus,
      getGitRemoteConfiguration,
      getGitRemoteSyncStatus,
      getGitAutoSyncSettings,
      setGitAutoSyncSettings,
      getGitIgnoreSettings,
      updateGitIgnoreSettings,
      initializeGitRepository,
      removeGitRemote,
      setGitRemoteUrl,
      fetchGitRemote,
      pullGitRemote,
      pushGitRemote,
      beginGitRemoteReconciliation,
      resolveGitConflict,
      abortGitRemoteReconciliation,
      openTextFile,
      stageGitPaths,
      unstageGitPaths,
      revertGitPaths,
      saveFile,
      commitGitChanges,
      onGitFileStatusChanged: vi.fn((listener: (event: { treeMayHaveChanged: boolean }) => void) => {
        gitFileStatusChanged = listener;
        return vi.fn();
      }),
      revealInSystemFileManager: vi.fn(async () => ({ success: true })),
    },
  });
});

afterEach(() => {
  cleanup();
  document.body.classList.remove("pane-resizing");
  document.documentElement.classList.remove("dark");
  delete document.documentElement.dataset.sidebarPlacement;
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024, writable: true });
});

const InspectorToggle = () => {
  const { isSidebarCollapsed, toggleSidebar } = useInspectorSidebarControls();
  return (
    <button type="button" onClick={toggleSidebar}>
      {isSidebarCollapsed ? "Expand inspector" : "Collapse inspector"}
    </button>
  );
};

describe("application sidebars", () => {
  it("opens Version History when another surface requests it", async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <LeftSidebar>Files content</LeftSidebar>
      </Provider>,
    );

    act(() => store.set(versionHistoryOpenRequestAtom, (requestNumber) => requestNumber + 1));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Version History" }).getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("shows the Task Board launcher with open and active indicators", () => {
    const store = createStore();
    const taskBoard = createTaskBoardWorkspaceItem();
    const tab = createEditorTab("task-board-tab", taskBoard.key);
    store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }]);
    store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
    store.set(openWorkspaceItemsByKeyAtom, { [taskBoard.key]: taskBoard });

    render(
      <Provider store={store}>
        <LeftSidebar>Files content</LeftSidebar>
      </Provider>,
    );

    const filesButton = screen.getByRole("button", { name: "Files" });
    const taskBoardButton = screen.getByRole("button", { name: "Show Task Board in workspace" });
    expect(filesButton.getAttribute("aria-pressed")).toBe("true");
    expect(taskBoardButton.getAttribute("aria-current")).toBe("page");
    expect(taskBoardButton.querySelector(".sidebar-workspace-open-indicator")?.getAttribute("data-current")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Version History" }));
    expect(screen.getByRole("button", { name: "Version History" }).getAttribute("aria-pressed")).toBe("true");
    expect(taskBoardButton.getAttribute("aria-current")).toBe("page");
  });

  it("preserves the resized sidebar width while switching between Files and Source Control", () => {
    const { container } = render(<LeftSidebar data-testid="navigation-sidebar">Files content</LeftSidebar>);

    fireEvent.pointerDown(container.querySelector(".sidebar-resize-handle")!, {
      button: 0,
      clientX: 300,
      pointerId: 13,
    });
    fireEvent.pointerMove(window, { clientX: 380, pointerId: 13 });
    fireEvent.pointerUp(window, { pointerId: 13 });

    expect(screen.getByTestId("navigation-sidebar").style.width).toBe("calc(380px + var(--sidebar-action-rail-width))");
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));
    expect(screen.getByRole("button", { name: "Version History" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("navigation-sidebar").style.width).toBe("calc(380px + var(--sidebar-action-rail-width))");

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByText("Files content")).toBeTruthy();
    expect(screen.getByTestId("navigation-sidebar").style.width).toBe("calc(380px + var(--sidebar-action-rail-width))");
  });

  it("collapses the explorer from the final dragged width and restores its prior width", () => {
    const { container } = render(
      <LeftSidebar data-testid="explorer" className="custom-explorer">
        <input aria-label="Explorer filter" defaultValue="draft" />
      </LeftSidebar>,
    );

    expect(screen.getByTestId("explorer").classList.contains("undefined")).toBe(false);
    expect(screen.getByTestId("explorer").classList.contains("custom-explorer")).toBe(true);

    fireEvent.pointerDown(container.querySelector(".sidebar-resize-handle")!, {
      button: 0,
      clientX: 300,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(screen.getByRole("button", { name: "Expand left sidebar" })).toBeTruthy();
    expect(screen.getByTestId("explorer").style.width).toBe("var(--sidebar-action-rail-width)");
    expect(screen.getByLabelText("Explorer filter")).toBeTruthy();
    expect(screen.getByLabelText("Explorer filter").closest(".sidebar-inner")?.hasAttribute("inert")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Expand left sidebar" }));

    expect(screen.getByTestId("explorer").style.width).toBe("calc(400px + var(--sidebar-action-rail-width))");
    expect(screen.getByLabelText("Explorer filter").closest(".sidebar-inner")?.hasAttribute("inert")).toBe(false);
  });

  it("gives the inspector matching collapse behavior without unmounting its contents", () => {
    const { container } = render(
      <InspectorSidebarProvider>
        <InspectorToggle />
        <InspectorSidebar data-testid="inspector" className="custom-inspector">
          <input aria-label="Inspector field" defaultValue="preserved" />
        </InspectorSidebar>
      </InspectorSidebarProvider>,
    );

    const field = screen.getByLabelText<HTMLInputElement>("Inspector field");
    field.value = "edited";
    expect(screen.getByTestId("inspector").classList.contains("undefined")).toBe(false);
    expect(screen.getByTestId("inspector").classList.contains("custom-inspector")).toBe(true);

    fireEvent.pointerDown(container.querySelector(".sidebar-resize-divider-left .sidebar-resize-handle")!, {
      button: 0,
      clientX: 0,
      pointerId: 2,
    });
    fireEvent.pointerMove(window, { clientX: 150, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    expect(screen.getByRole("button", { name: "Expand inspector" })).toBeTruthy();
    expect(screen.getByTestId("inspector").style.width).toBe("0px");
    expect(screen.getByTestId("inspector").dataset.collapsed).toBe("true");
    expect(screen.getByLabelText("Inspector field")).toBe(field);
    expect(field.value).toBe("edited");
    expect(field.closest(".right-sidebar-inner")?.hasAttribute("inert")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Expand inspector" }));

    expect(screen.getByTestId("inspector").style.width).toBe("320px");
    expect(screen.getByTestId("inspector").dataset.collapsed).toBeUndefined();
    expect(field.closest(".right-sidebar-inner")?.hasAttribute("inert")).toBe(false);
  });

  it("restores sidebar widths after the component is mounted again", () => {
    const first = render(<LeftSidebar data-testid="explorer">Explorer</LeftSidebar>);
    fireEvent.pointerDown(first.container.querySelector(".sidebar-resize-handle")!, {
      button: 0,
      clientX: 300,
      pointerId: 8,
    });
    fireEvent.pointerMove(window, { clientX: 420, pointerId: 8 });
    fireEvent.pointerUp(window, { pointerId: 8 });
    expect(screen.getByTestId("explorer").style.width).toBe("calc(420px + var(--sidebar-action-rail-width))");
    first.unmount();

    render(<LeftSidebar data-testid="restored-explorer">Explorer</LeftSidebar>);
    expect(screen.getByTestId("restored-explorer").style.width).toBe("calc(420px + var(--sidebar-action-rail-width))");
  });

  it("automatically makes room for content by collapsing the inspector in narrow windows", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900, writable: true });
    render(
      <InspectorSidebarProvider>
        <InspectorToggle />
        <InspectorSidebar data-testid="responsive-inspector">Inspector</InspectorSidebar>
      </InspectorSidebarProvider>,
    );

    expect(screen.getByTestId("responsive-inspector").style.width).toBe("0px");
    expect(screen.getByTestId("responsive-inspector").dataset.collapsed).toBe("true");
    expect(screen.getByRole("button", { name: "Expand inspector" })).toBeTruthy();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200, writable: true });
    fireEvent(window, new Event("resize"));
    expect(screen.getByTestId("responsive-inspector").style.width).toBe("320px");
    expect(screen.getByTestId("responsive-inspector").dataset.collapsed).toBeUndefined();
  });

  it("keeps a manually opened inspector open while resizing within a narrow window", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900, writable: true });
    const { container } = render(
      <InspectorSidebarProvider>
        <InspectorToggle />
        <InspectorSidebar data-testid="responsive-inspector">Inspector</InspectorSidebar>
      </InspectorSidebarProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand inspector" }));
    const handle = container.querySelector(".sidebar-resize-handle")!;
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 42 });
    fireEvent.pointerMove(window, { clientX: 470, pointerId: 42 });
    expect(screen.getByTestId("responsive-inspector").style.width).toBe("350px");
    fireEvent.pointerUp(window, { pointerId: 42 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 880, writable: true });
    fireEvent(window, new Event("resize"));
    expect(screen.getByTestId("responsive-inspector").style.width).toBe("350px");
    expect(screen.getByTestId("responsive-inspector").dataset.collapsed).toBeUndefined();
  });

  it("opens settings from the bottom-left rail and persists the selected theme", async () => {
    render(<LeftSidebar>Explorer</LeftSidebar>);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe("dark");
    await waitFor(() => expect(setTheme).toHaveBeenCalledWith("dark"));

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe("light");
    await waitFor(() => expect(setTheme).toHaveBeenLastCalledWith("light"));
  });

  it("keeps general display controls in Appearance without an empty Editor page", () => {
    render(<LeftSidebar>Explorer</LeftSidebar>);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));

    expect(screen.getByRole("region", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByText("Zoom")).toBeTruthy();
    expect(screen.getByText("Panel layout")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset layout" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editor" })).toBeNull();
  });

  it("navigates settings preference choices with arrows and keeps one tab stop", async () => {
    render(<LeftSidebar>Explorer</LeftSidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    const light = screen.getByRole("radio", { name: "Light" });
    expect(light.tabIndex).toBe(0);
    fireEvent.keyDown(light, { key: "ArrowRight" });
    const dark = screen.getByRole("radio", { name: "Dark" });
    expect(document.activeElement).toBe(dark);
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(light.tabIndex).toBe(-1);
    await waitFor(() => expect(setTheme).toHaveBeenCalledWith("dark"));
  });

  it("keeps task opening preferences available without task archive controls", async () => {
    render(<LeftSidebar>Explorer</LeftSidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Task Board" }));

    const hoverWindow = await screen.findByRole("radio", { name: "Hover window" });
    expect(screen.queryByText("Completed tasks")).toBeNull();
    expect(screen.queryByText(/archive completed tasks/i)).toBeNull();
    fireEvent.click(hoverWindow);
    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith("taskBoardOpenMode", "hover"));
    await waitFor(() => expect(hoverWindow.getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(screen.getByRole("radio", { name: "New tab" }));
    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith("taskBoardOpenMode", "tab"));
  });

  it("selects existing workspace folders for daily notes and new tasks without clipping settings", async () => {
    const store = createStore();
    const user = userEvent.setup();
    store.set(fileTreeAtom, [
      {
        id: "/notes/Planning",
        filename: "Planning",
        relativePath: "Planning",
        path: "/notes/Planning",
        isDirectory: true,
        mimeType: null,
        children: [],
      },
      {
        id: "/notes/Notes",
        filename: "Notes",
        relativePath: "Notes",
        path: "/notes/Notes",
        isDirectory: true,
        mimeType: null,
        children: [
          {
            id: "/notes/Notes/PDF clips",
            filename: "PDF clips",
            relativePath: "Notes/PDF clips",
            path: "/notes/Notes/PDF clips",
            isDirectory: true,
            mimeType: null,
            children: [],
          },
        ],
      },
    ]);

    render(
      <Provider store={store}>
        <LeftSidebar>Explorer</LeftSidebar>
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    const dailyNoteFolder = await screen.findByRole("button", { name: "Folder for daily notes" });
    const taskFolder = await screen.findByRole("button", { name: "Default folder for new tasks" });
    const clippedNoteFolder = screen.queryByRole("button", { name: "Default folder for new clipped notes" });

    expect(clippedNoteFolder).toBeNull();
    await user.click(dailyNoteFolder);
    await user.click(screen.getByRole("menuitemradio", { name: /Planning.*Workspace root/u }));

    await user.click(taskFolder);
    const taskSearch = await screen.findByRole("searchbox", {
      name: "Search folders for default folder for new tasks",
    });
    expect(screen.getByRole("menuitemradio", { name: /Workspace root.*Top level/u })).toBeTruthy();
    await user.type(taskSearch, "plan");
    expect(screen.queryByRole("menuitemradio", { name: /PDF clips/u })).toBeNull();
    await user.click(screen.getByRole("menuitemradio", { name: /Planning.*Workspace root/u }));

    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith("dailyNoteCreationDirectory", "Planning");
      expect(updateConfig).toHaveBeenCalledWith("taskCreationDirectory", "Planning");
    });
  });

  it("removes a saved workspace without touching its files", async () => {
    render(<LeftSidebar>Explorer</LeftSidebar>);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.getByText("/archive")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove archive from recent workspaces" }));

    await waitFor(() => expect(removeRecentWorkspace).toHaveBeenCalledWith("/archive"));
    expect(screen.queryByText("/archive")).toBeNull();
    expect(screen.getByText(/Its files remain on disk/u)).toBeTruthy();
  });

  it("shows a clear warning if the selected theme cannot be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setTheme.mockRejectedValueOnce(new Error("Disk unavailable"));
    render(<LeftSidebar>Explorer</LeftSidebar>);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    expect((await screen.findByRole("alert")).textContent).toContain("couldn't be saved");
  });

  it("moves the navigation sidebar right and the widget inspector left from Appearance settings", async () => {
    render(
      <InspectorSidebarProvider>
        <main className="root-layout">
          <LeftSidebar data-testid="explorer">Explorer</LeftSidebar>
          <div className="content">Editor</div>
          <InspectorSidebar data-testid="inspector">Widgets</InspectorSidebar>
        </main>
      </InspectorSidebarProvider>,
    );

    expect(screen.getByTestId("explorer").dataset.side).toBe("left");
    expect(screen.getByTestId("inspector").dataset.side).toBe("right");
    expect(screen.getByTestId("explorer").querySelector(".sidebar-resize-divider")?.classList).not.toContain(
      "sidebar-resize-divider-left",
    );
    expect(screen.getByTestId("inspector").querySelector(".sidebar-resize-divider")?.classList).toContain(
      "sidebar-resize-divider-left",
    );

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Sidebar right" }));

    await waitFor(() => expect(setSidebarPlacement).toHaveBeenCalledWith("explorer-right"));
    expect(document.documentElement.dataset.sidebarPlacement).toBe("explorer-right");
    expect(screen.getByTestId("explorer").dataset.side).toBe("right");
    expect(screen.getByTestId("inspector").dataset.side).toBe("left");
    expect(screen.getByTestId("explorer").querySelector(".sidebar-resize-divider")?.classList).toContain(
      "sidebar-resize-divider-left",
    );
    expect(screen.getByTestId("inspector").querySelector(".sidebar-resize-divider")?.classList).not.toContain(
      "sidebar-resize-divider-left",
    );
    expect(screen.getByRole("radio", { name: "Sidebar right" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());

    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize left sidebar" }), {
      button: 0,
      clientX: 300,
      pointerId: 11,
    });
    fireEvent.pointerMove(window, { clientX: 200, pointerId: 11 });
    fireEvent.pointerUp(window, { pointerId: 11 });
    expect(screen.getByTestId("explorer").style.width).toBe("calc(400px + var(--sidebar-action-rail-width))");

    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize file inspector" }), {
      button: 0,
      clientX: 0,
      pointerId: 12,
    });
    fireEvent.pointerMove(window, { clientX: 100, pointerId: 12 });
    fireEvent.pointerUp(window, { pointerId: 12 });
    expect(screen.getByTestId("inspector").style.width).toBe("420px");
  });

  it("updates native macOS window controls from appearance settings", async () => {
    render(
      <>
        <WindowTitleBar />
        <LeftSidebar>Explorer</LeftSidebar>
      </>,
    );

    expect(screen.getByRole("banner", { name: "Window title bar" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(screen.getByRole("radio", { name: "Integrated" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Hidden" }));

    await waitFor(() => expect(setShowWindowControls).toHaveBeenCalledWith(false));
    expect(screen.getByRole("radio", { name: "Hidden" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("banner", { name: "Window title bar" })).toBeNull();
  });

  it("shows workspace location, recent folders, and backup completion in settings", async () => {
    render(<LeftSidebar>Explorer</LeftSidebar>);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    expect(screen.getByText("/notes")).toBeTruthy();
    expect(screen.getByText("archive")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Backup & export" }));
    fireEvent.click(screen.getByRole("button", { name: "Create backup" }));

    await waitFor(() => expect(exportWorkspaceBackup).toHaveBeenCalledOnce());
    expect(screen.getByText("Backup created at /backups/Obim Backup")).toBeTruthy();
  });

  it("filters settings pages and opens a search result", () => {
    render(<LeftSidebar>Explorer</LeftSidebar>);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "keyboard" } });
    expect(screen.getByRole("button", { name: "Shortcuts" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Appearance" })).toBeNull();

    fireEvent.change(search, { target: { value: "no matching page" } });
    expect(screen.getByText("No matching settings pages")).toBeTruthy();

    fireEvent.change(search, { target: { value: "keyboard" } });
    fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
    expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeTruthy();
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Appearance" })).toBeTruthy();
  });

  it("reports Git status and initializes repository metadata from Git settings", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LeftSidebar>Explorer</LeftSidebar>);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));

    const versionHistoryPage = screen.getByRole("region", { name: "Version history" });
    expect(versionHistoryPage.classList.contains("settings-page")).toBe(true);
    expect(versionHistoryPage.querySelector(".settings-group-card")).toBeTruthy();
    expect(await screen.findByText("Off")).toBeTruthy();
    expect(getGitFileStatus).toHaveBeenCalledOnce();
    let finishRefresh!: (snapshot: { status: "not-repository"; changes: [] }) => void;
    getGitFileStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    fireEvent.click(refreshButton);
    await waitFor(() => expect(getGitFileStatus).toHaveBeenCalledTimes(2));
    expect(refreshButton.textContent).toBe("Refresh");
    expect(refreshButton.getAttribute("data-refreshing")).toBe("true");
    expect(refreshButton.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Refreshing…")).toBeNull();
    await act(async () => finishRefresh({ status: "not-repository", changes: [] }));
    await waitFor(() => expect(refreshButton.hasAttribute("data-refreshing")).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(initializeGitRepository).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("private local Git repository"));
    expect(screen.getByText("On for this workspace")).toBeTruthy();
    expect(screen.getByText("Local versions enabled.")).toBeTruthy();
  });

  it("connects, updates, and disconnects the origin remote from Git settings", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes: [],
      repositoryScope: "workspace",
    });
    getGitRemoteConfiguration.mockResolvedValue({
      status: "ready",
      repositoryScope: "workspace",
    });

    render(<LeftSidebar>Explorer</LeftSidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));

    const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Repository URL" });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "git@github.com:example/notes.git" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(setGitRemoteUrl).toHaveBeenCalledWith("git@github.com:example/notes.git"));
    await waitFor(() => expect(fetchGitRemote).toHaveBeenCalledOnce());
    expect(await screen.findByText("Remote connected.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(removeGitRemote).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("will not be deleted"));
    expect(await screen.findByText("Remote disconnected.")).toBeTruthy();
  });

  it("saves managed ignore patterns and automatic sync preferences", async () => {
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes: [],
      repositoryScope: "workspace",
    });
    getGitRemoteConfiguration.mockResolvedValue({
      status: "ready",
      repositoryScope: "workspace",
      remote: { fetchUrl: "https://github.com/example/notes.git", name: "origin" },
    });

    render(<LeftSidebar>Explorer</LeftSidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));

    await screen.findByText("On for this workspace");
    const patterns = await screen.findByRole("textbox", { name: ".gitignore patterns" });
    fireEvent.change(patterns, { target: { value: "Private/\n*.tmp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save patterns" }));
    await waitFor(() => expect(updateGitIgnoreSettings).toHaveBeenCalledWith("Private/\n*.tmp"));

    fireEvent.click(screen.getByRole("switch", { name: "Auto-sync" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Interval" }), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("radio", { name: /Use Remote Changes/u }));
    fireEvent.click(screen.getByRole("button", { name: "Save auto-sync" }));
    await waitFor(() =>
      expect(setGitAutoSyncSettings).toHaveBeenCalledWith({
        conflictResolution: "use-remote",
        intervalMinutes: 30,
      }),
    );
  });

  it("explains when an origin URL is saved but authentication fails", async () => {
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes: [],
      repositoryScope: "workspace",
    });
    getGitRemoteConfiguration.mockResolvedValue({ status: "ready", repositoryScope: "workspace" });
    fetchGitRemote.mockResolvedValueOnce({
      status: "failed",
      error: "Authentication failed. For HTTPS, configure a system Git credential helper.",
    });

    render(<LeftSidebar>Explorer</LeftSidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));
    const input = await screen.findByRole("textbox", { name: "Repository URL" });
    fireEvent.change(input, { target: { value: "https://github.com/example/private-notes.git" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(
      await screen.findByText(
        "Remote URL was saved, but the connection failed: Authentication failed. For HTTPS, configure a system Git credential helper.",
      ),
    ).toBeTruthy();
  });

  it("warns instead of suggesting Push when a connected origin has divergent history", async () => {
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes: [],
      repositoryScope: "workspace",
    });
    getGitRemoteConfiguration.mockResolvedValue({ status: "ready", repositoryScope: "workspace" });
    fetchGitRemote.mockResolvedValueOnce({
      status: "succeeded",
      action: "fetched",
      snapshot: { status: "ready", branch: "main", changes: [], repositoryScope: "workspace" },
      sync: {
        status: "ready",
        ahead: 1,
        behind: 1,
        branch: "main",
        remote: { fetchUrl: "https://github.com/example/notes.git", name: "origin" },
        state: "diverged",
      },
    });

    render(<LeftSidebar>Explorer</LeftSidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Repository URL" }), {
      target: { value: "https://github.com/example/notes.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(
      await screen.findByText("Remote connected. Local and remote history differ; resolve them in Version History."),
    ).toBeTruthy();
  });

  it("keeps watcher-driven Git refreshes silent and coalesces them while a read is pending", async () => {
    render(<LeftSidebar>Explorer</LeftSidebar>);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));
    expect(await screen.findByText("Off")).toBeTruthy();

    let resolveStatus!: (value: { status: "not-repository"; changes: [] }) => void;
    getGitFileStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );

    act(() => {
      gitFileStatusChanged?.({ treeMayHaveChanged: false });
      gitFileStatusChanged?.({ treeMayHaveChanged: false });
    });

    expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText("Refreshing…")).toBeNull();
    expect(getGitFileStatus).toHaveBeenCalledTimes(2);

    await act(async () => resolveStatus({ status: "not-repository", changes: [] }));
    await waitFor(() => expect(getGitFileStatus).toHaveBeenCalledTimes(3));
  });

  it("shows the Version History interface immediately while repository status loads", async () => {
    let resolveStatus!: (value: { status: "ready"; branch: string; changes: []; repositoryScope: "workspace" }) => void;
    let resolveRemote!: (value: { status: "not-configured" }) => void;
    getGitFileStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    getGitRemoteSyncStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRemote = resolve;
        }),
    );

    render(<LeftSidebar>Explorer content</LeftSidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));

    const messageInput = screen.getByRole("textbox", { name: "Commit message" });
    const commitButton = screen.getByRole("button", { name: "Commit staged changes" });
    const refreshButton = screen.getByRole("button", { name: "Refresh Version History" });
    expect(messageInput.hasAttribute("disabled")).toBe(false);
    expect(commitButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Changes")).toBeTruthy();
    expect(screen.queryByText("Checking repository…")).toBeNull();
    expect(refreshButton.getAttribute("data-refreshing")).toBe("true");

    await act(async () =>
      resolveStatus({ status: "ready", branch: "main", changes: [], repositoryScope: "workspace" }),
    );
    expect(await screen.findByText("Working tree is clean")).toBeTruthy();
    expect(refreshButton.getAttribute("data-refreshing")).toBe("true");

    await act(async () => resolveRemote({ status: "not-configured" }));
    await waitFor(() => expect(refreshButton.hasAttribute("data-refreshing")).toBe(false));

    let resolveWatcherRefresh!: (value: {
      status: "ready";
      branch: string;
      changes: [];
      repositoryScope: "workspace";
    }) => void;
    getGitFileStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWatcherRefresh = resolve;
        }),
    );
    act(() => gitFileStatusChanged?.({ treeMayHaveChanged: false }));
    expect(refreshButton.hasAttribute("data-refreshing")).toBe(false);
    await act(async () =>
      resolveWatcherRefresh({ status: "ready", branch: "main", changes: [], repositoryScope: "workspace" }),
    );
  });

  it("switches the left rail to Source Control and stages and commits changes", async () => {
    const unstagedChange = {
      conflicted: false,
      kind: "modified" as const,
      path: "modified.md",
      staged: false,
      workingTreeChanged: true,
    };
    const stagedChange = {
      conflicted: false,
      kind: "added" as const,
      path: "staged.md",
      staged: true,
      workingTreeChanged: false,
    };
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes: [stagedChange, unstagedChange],
      repositoryScope: "workspace",
    });
    stageGitPaths.mockResolvedValue({
      status: "succeeded",
      snapshot: {
        status: "ready",
        branch: "main",
        changes: [stagedChange, { ...unstagedChange, staged: true, workingTreeChanged: false }],
        repositoryScope: "workspace",
      },
    });

    const store = createStore();
    store.set(fileTreeAtom, [
      {
        id: "modified-file",
        filename: "modified",
        isDirectory: false,
        mimeType: "text/markdown",
        path: "/notes/modified.md",
        relativePath: "modified.md",
        sizeBytes: 12,
        version: { id: "modified-file", mtimeMs: 10, sizeBytes: 12 },
      },
    ]);
    render(
      <Provider store={store}>
        <LeftSidebar>Explorer content</LeftSidebar>
      </Provider>,
    );
    expect(screen.getByText("Explorer content")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Version History" }));
    const commitMessageInput = await screen.findByRole("textbox", { name: "Commit message" });
    expect(commitMessageInput).toBeTruthy();
    expect(screen.queryByText("main")).toBeNull();
    expect(screen.getByText("Explorer content").closest<HTMLElement>(".sidebar-view-content")?.hidden).toBe(true);
    expect(await screen.findByText("Staged Changes")).toBeTruthy();
    expect(screen.getByText("Changes")).toBeTruthy();

    expect(screen.getByRole("button", { name: "View history for modified.md" })).toBeTruthy();
    const revertButton = screen.getByRole("button", { name: "Revert changes to modified.md" });
    const changeRow = revertButton.closest(".source-control-change");
    expect(revertButton.className).toContain("hover:bg-[var(--surface-hover)]");
    expect(revertButton.className).not.toContain("hover:bg-[var(--chip-danger)]");
    expect(changeRow?.lastElementChild).toBe(changeRow?.querySelector(".source-control-change-status"));

    fireEvent.click(screen.getByRole("button", { name: "Stage modified.md" }));
    await waitFor(() => expect(stageGitPaths).toHaveBeenCalledWith(["modified.md"]));
    expect(screen.getByText("Changes")).toBeTruthy();
    expect(screen.getByText("No unstaged changes")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "Save notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit staged changes" }));
    await waitFor(() => expect(commitGitChanges).toHaveBeenCalledWith("Save notes"));
    expect(await screen.findByText("Commit created locally.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByText("Explorer content")).toBeTruthy();
    expect(screen.getByText("Explorer content").closest<HTMLElement>(".sidebar-view-content")?.hidden).toBe(false);
    expect(document.body.contains(commitMessageInput)).toBe(true);
    expect(commitMessageInput.closest<HTMLElement>(".sidebar-view-content")?.hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Version History" }));
    expect(screen.getByRole("textbox", { name: "Commit message" })).toBe(commitMessageInput);
    expect(getGitFileStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps an edited note visible while Git catches up with a completed save", async () => {
    const cleanSnapshot = {
      status: "ready" as const,
      branch: "main",
      changes: [],
      repositoryScope: "workspace" as const,
    };
    const modifiedSnapshot = {
      ...cleanSnapshot,
      changes: [
        {
          conflicted: false,
          kind: "modified" as const,
          path: "total.md",
          staged: false,
          workingTreeChanged: true,
        },
      ],
    };
    let finishPostSaveStatus!: (snapshot: typeof modifiedSnapshot) => void;
    getGitFileStatus.mockResolvedValueOnce(cleanSnapshot).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPostSaveStatus = resolve;
        }),
    );
    const store = createStore();
    const version = { id: "total-file", mtimeMs: 10, sizeBytes: 8 };
    store.set(fileBuffersByPathAtom, {
      "/notes/total.md": { editorText: "original", savedText: "original", version },
    });
    store.set(fileTreeAtom, [
      {
        id: "total-file",
        filename: "total",
        isDirectory: false,
        mimeType: "text/markdown",
        path: "/notes/total.md",
        relativePath: "total.md",
        sizeBytes: 8,
        version,
      },
    ]);

    render(
      <Provider store={store}>
        <LeftSidebar>Explorer content</LeftSidebar>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));
    expect(await screen.findByText("Working tree is clean")).toBeTruthy();

    act(() => {
      store.set(fileBuffersByPathAtom, {
        "/notes/total.md": { editorText: "changed", savedText: "original", version },
      });
      store.set(fileSaveStatesByPathAtom, { "/notes/total.md": { phase: "dirty" } });
    });
    expect(await screen.findByRole("button", { name: "View history for total.md" })).toBeTruthy();

    act(() => {
      store.set(fileSaveStatesByPathAtom, { "/notes/total.md": { phase: "saving" } });
      store.set(fileBuffersByPathAtom, {
        "/notes/total.md": { editorText: "changed", savedText: "changed", version },
      });
      store.set(fileSaveStatesByPathAtom, {
        "/notes/total.md": { phase: "saved", savedAt: Date.now() },
      });
    });

    await waitFor(() => expect(getGitFileStatus).toHaveBeenLastCalledWith(true));
    expect(screen.getByRole("button", { name: "View history for total.md" })).toBeTruthy();
    expect(getGitRemoteSyncStatus).toHaveBeenCalledOnce();

    await act(async () => finishPostSaveStatus(modifiedSnapshot));
    expect(screen.getByRole("button", { name: "View history for total.md" })).toBeTruthy();
  });

  it("changes the primary action from Commit to Push after creating a local commit", async () => {
    const stagedChange = {
      conflicted: false,
      kind: "modified" as const,
      path: "note.md",
      staged: true,
      workingTreeChanged: false,
    };
    const cleanSnapshot = {
      status: "ready" as const,
      branch: "main",
      changes: [],
      repositoryScope: "workspace" as const,
    };
    const upToDateSync = {
      status: "ready" as const,
      ahead: 0,
      behind: 0,
      branch: "main",
      remote: { fetchUrl: "git@github.com:example/notes.git", name: "origin" as const },
      state: "up-to-date" as const,
    };
    getGitFileStatus.mockResolvedValue({ ...cleanSnapshot, changes: [stagedChange] });
    commitGitChanges.mockResolvedValue({ status: "succeeded", snapshot: cleanSnapshot });
    getGitRemoteSyncStatus.mockResolvedValueOnce(upToDateSync).mockResolvedValueOnce({
      ...upToDateSync,
      ahead: 1,
      state: "ahead",
    });

    render(<LeftSidebar>Explorer content</LeftSidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));

    fireEvent.change(await screen.findByRole("textbox", { name: "Commit message" }), {
      target: { value: "Update note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit staged changes" }));

    await waitFor(() => expect(commitGitChanges).toHaveBeenCalledWith("Update note"));
    expect(await screen.findByRole("button", { name: "Push changes" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Remote repository" })).toBeNull();
  });

  it("publishes the current branch from the primary action without showing the remote block", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes: [],
      repositoryScope: "workspace",
    });
    const unpublishedSync = {
      status: "ready",
      ahead: 0,
      behind: 0,
      branch: "main",
      remote: { fetchUrl: "git@github.com:example/notes.git", name: "origin" },
      state: "unpublished",
    } as const;
    getGitRemoteSyncStatus.mockResolvedValue(unpublishedSync);
    let finishRefresh!: (result: {
      status: "succeeded";
      action: "fetched";
      snapshot: { status: "ready"; branch: string; changes: []; repositoryScope: "workspace" };
      sync: typeof unpublishedSync;
    }) => void;
    fetchGitRemote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );

    render(<LeftSidebar>Explorer content</LeftSidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));

    expect(await screen.findByRole("button", { name: "Push changes" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Remote repository" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check remote" })).toBeNull();
    expect(fetchGitRemote).not.toHaveBeenCalled();
    const refreshButton = screen.getByRole("button", { name: "Refresh Version History" });
    fireEvent.click(refreshButton);
    await waitFor(() => expect(fetchGitRemote).toHaveBeenCalledOnce());
    expect(refreshButton.getAttribute("data-refreshing")).toBe("true");
    expect(refreshButton.getAttribute("aria-busy")).toBe("true");
    await act(async () =>
      finishRefresh({
        status: "succeeded",
        action: "fetched",
        snapshot: { status: "ready", branch: "main", changes: [], repositoryScope: "workspace" },
        sync: unpublishedSync,
      }),
    );
    await waitFor(() => expect(refreshButton.hasAttribute("data-refreshing")).toBe(false));
    expect(pushGitRemote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Push changes" }));

    await waitFor(() => expect(pushGitRemote).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Only committed versions will be uploaded"));
    expect(await screen.findByText("Committed versions were pushed to origin.")).toBeTruthy();
  });

  it("asks a stale application window to restart instead of showing an IPC error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes: [],
      repositoryScope: "workspace",
    });
    getGitRemoteSyncStatus.mockRejectedValue(new Error("No handler registered for 'get-git-remote-sync-status'"));

    render(<LeftSidebar>Explorer content</LeftSidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));

    expect(await screen.findByText("Restart Obim to finish loading remote sync.")).toBeTruthy();
    expect(screen.queryByText(/No handler registered/iu)).toBeNull();
  });

  it("blocks Pull while an editor contains unsaved text", async () => {
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes: [],
      repositoryScope: "workspace",
    });
    getGitRemoteSyncStatus.mockResolvedValue({
      status: "ready",
      ahead: 0,
      behind: 1,
      branch: "main",
      remote: { fetchUrl: "git@github.com:example/notes.git", name: "origin" },
      state: "behind",
    });
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      "/notes/note.md": {
        editorText: "unsaved text",
        savedText: "saved text",
        version: { id: "note-file", mtimeMs: 10, sizeBytes: 10 },
      },
    });

    render(
      <Provider store={store}>
        <LeftSidebar>Explorer content</LeftSidebar>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pull" }));

    expect(await screen.findByText("Save or discard editor changes before pulling from the remote.")).toBeTruthy();
    expect(pullGitRemote).not.toHaveBeenCalled();
  });

  it("reloads a clean open note after a fast-forward Pull", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes: [],
      repositoryScope: "workspace",
    });
    const behindSync = {
      status: "ready" as const,
      ahead: 0,
      behind: 1,
      branch: "main",
      remote: { fetchUrl: "git@github.com:example/notes.git", name: "origin" as const },
      state: "behind" as const,
    };
    getGitRemoteSyncStatus.mockResolvedValue(behindSync);
    pullGitRemote.mockResolvedValue({
      status: "succeeded",
      action: "pulled",
      changedPaths: [{ kind: "modified", path: "note.md" }],
      snapshot: { status: "ready", branch: "main", changes: [], repositoryScope: "workspace" },
      sync: { ...behindSync, behind: 0, state: "up-to-date" },
    });
    const store = createStore();
    const version = { id: "note-file", mtimeMs: 10, sizeBytes: 8 };
    store.set(fileBuffersByPathAtom, {
      "/notes/note.md": { editorText: "old text", savedText: "old text", version },
    });
    store.set(fileTreeAtom, [
      {
        id: "note-file",
        filename: "note",
        isDirectory: false,
        mimeType: "text/markdown",
        path: "/notes/note.md",
        relativePath: "note.md",
        sizeBytes: 8,
        version,
      },
    ]);

    render(
      <Provider store={store}>
        <LeftSidebar>Explorer content</LeftSidebar>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pull" }));

    await waitFor(() => expect(pullGitRemote).toHaveBeenCalledOnce());
    await waitFor(() => expect(store.get(fileBuffersByPathAtom)["/notes/note.md"]?.editorText).toBe("remote text"));
    expect(await screen.findByText("Remote commits were pulled with a fast-forward update.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Remote repository" })).toBeNull();
  });

  it("lists divergent files in a Conflicts section and opens reconciliation as a workspace item", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const divergedSync = {
      status: "ready" as const,
      ahead: 1,
      behind: 1,
      branch: "main",
      remote: { fetchUrl: "git@github.com:example/notes.git", name: "origin" as const },
      state: "diverged" as const,
    };
    const conflict = {
      conflict: { localExists: true, remoteExists: true },
      conflicted: true,
      kind: "conflicted" as const,
      path: "note.md",
      staged: false,
      workingTreeChanged: true,
    };
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes: [],
      repositoryScope: "workspace",
    });
    getGitRemoteSyncStatus.mockResolvedValue(divergedSync);
    beginGitRemoteReconciliation.mockResolvedValue({
      status: "succeeded",
      action: "reconciliation-started",
      changedPaths: [{ kind: "modified", path: "note.md" }],
      snapshot: {
        status: "ready",
        branch: "main",
        changes: [conflict],
        mergeInProgress: true,
        remoteReconciliationInProgress: true,
        repositoryScope: "workspace",
      },
      sync: divergedSync,
    });
    abortGitRemoteReconciliation.mockResolvedValue({
      status: "succeeded",
      changedPaths: [],
      snapshot: {
        status: "ready",
        branch: "main",
        changes: [],
        repositoryScope: "workspace",
      },
    });
    const store = createStore();
    render(
      <Provider store={store}>
        <LeftSidebar>Explorer content</LeftSidebar>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resolve differences" }));

    await waitFor(() => expect(beginGitRemoteReconciliation).toHaveBeenCalledOnce());
    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByRole("region", { name: "Reconciliation in progress" })).toBeTruthy();
    expect(screen.getByText("Resolve conflicts")).toBeTruthy();
    expect(screen.getByText("1 file needs a choice")).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Conflicts" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Remote repository" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Changes" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Commit message" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep local" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile note.md" }));

    await waitFor(() =>
      expect(Object.values(store.get(openWorkspaceItemsByKeyAtom))).toContainEqual(
        expect.objectContaining({ kind: "git-conflict", path: "/notes/note.md", relativePath: "note.md" }),
      ),
    );
    expect(resolveGitConflict).not.toHaveBeenCalled();
    expect(stageGitPaths).not.toHaveBeenCalled();
    expect(pushGitRemote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(abortGitRemoteReconciliation).toHaveBeenCalledOnce());
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does not replace a completed reconciliation with an older watcher refresh", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const cleanSnapshot = {
      status: "ready" as const,
      branch: "main",
      changes: [],
      repositoryScope: "workspace" as const,
    };
    const divergedSync = {
      status: "ready" as const,
      ahead: 1,
      behind: 1,
      branch: "main",
      remote: { fetchUrl: "git@github.com:example/notes.git", name: "origin" as const },
      state: "diverged" as const,
    };
    const conflict = {
      conflict: { localExists: true, remoteExists: true },
      conflicted: true,
      kind: "conflicted" as const,
      path: "note.md",
      staged: false,
      workingTreeChanged: true,
    };
    const reconciliationResult = {
      status: "succeeded" as const,
      action: "reconciliation-started" as const,
      changedPaths: [{ kind: "modified" as const, path: "note.md" }],
      snapshot: {
        ...cleanSnapshot,
        changes: [conflict],
        mergeInProgress: true,
        remoteReconciliationInProgress: true,
      },
      sync: divergedSync,
    };
    getGitFileStatus.mockResolvedValue(cleanSnapshot);
    getGitRemoteSyncStatus.mockResolvedValue(divergedSync);

    let finishReconciliation!: (result: typeof reconciliationResult) => void;
    beginGitRemoteReconciliation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReconciliation = resolve;
        }),
    );
    render(
      <Provider store={createStore()}>
        <LeftSidebar>Explorer content</LeftSidebar>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resolve differences" }));
    await waitFor(() => expect(beginGitRemoteReconciliation).toHaveBeenCalledOnce());

    let finishOlderRemoteRefresh!: (result: typeof divergedSync) => void;
    getGitRemoteSyncStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOlderRemoteRefresh = resolve;
        }),
    );
    act(() => gitFileStatusChanged?.({ treeMayHaveChanged: true }));
    await waitFor(() => expect(getGitFileStatus).toHaveBeenCalledTimes(2));

    await act(async () => finishReconciliation(reconciliationResult));
    expect(await screen.findByRole("region", { name: "Reconciliation in progress" })).toBeTruthy();
    await act(async () => finishOlderRemoteRefresh(divergedSync));

    expect(screen.getByRole("region", { name: "Reconciliation in progress" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Conflicts" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Remote repository" })).toBeNull();
  });

  it("persists unsaved editor text only when the user explicitly stages it", async () => {
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes: [],
      repositoryScope: "workspace",
    });
    stageGitPaths.mockResolvedValue({
      status: "succeeded",
      snapshot: {
        status: "ready",
        branch: "main",
        changes: [
          {
            conflicted: false,
            kind: "modified",
            path: "note.md",
            staged: true,
            workingTreeChanged: false,
          },
        ],
        repositoryScope: "workspace",
      },
    });
    const version = { id: "note-file", mtimeMs: 10, sizeBytes: 8 };
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      "/notes/note.md": { editorText: "new text", savedText: "old text", version },
    });

    render(
      <Provider store={store}>
        <LeftSidebar>Explorer content</LeftSidebar>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));

    const stageButton = await screen.findByRole("button", { name: "Stage note.md" });
    expect(stageGitPaths).not.toHaveBeenCalled();
    fireEvent.click(stageButton);

    await waitFor(() => expect(saveFile).toHaveBeenCalledWith("/notes/note.md", "new text", version));
    await waitFor(() => expect(stageGitPaths).toHaveBeenCalledWith(["note.md"]));
    expect(saveFile.mock.invocationCallOrder[0]).toBeLessThan(stageGitPaths.mock.invocationCallOrder[0]);
  });

  it("groups application-owned metadata and reverts it as one configuration item", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const changes = [
      {
        conflicted: false,
        kind: "modified" as const,
        path: ".obim/bookmarks.json",
        staged: false,
        workingTreeChanged: true,
      },
      {
        conflicted: false,
        kind: "modified" as const,
        path: ".todo/taskboard.json",
        staged: false,
        workingTreeChanged: true,
      },
      { conflicted: false, kind: "modified" as const, path: "note.md", staged: false, workingTreeChanged: true },
    ];
    getGitFileStatus.mockResolvedValue({
      status: "ready",
      branch: "main",
      changes,
      repositoryScope: "workspace",
    });
    revertGitPaths.mockResolvedValue({
      status: "succeeded",
      snapshot: { status: "ready", branch: "main", changes, repositoryScope: "workspace" },
    });

    render(<LeftSidebar>Explorer content</LeftSidebar>);
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));

    expect(await screen.findByText("Application configuration")).toBeTruthy();
    expect(screen.getByText("2 application-managed files")).toBeTruthy();
    expect(screen.queryByText("bookmarks.json")).toBeNull();
    expect(screen.queryByText("taskboard.json")).toBeNull();
    expect(screen.queryByRole("button", { name: "View history for note.md" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Revert application configuration changes" }));
    await waitFor(() => expect(revertGitPaths).toHaveBeenCalledWith([".obim/bookmarks.json", ".todo/taskboard.json"]));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("restores the last committed version"));
  });

  it("restores the prior window-controls selection when persistence fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setShowWindowControls.mockRejectedValueOnce(new Error("write failed"));
    render(<LeftSidebar>Explorer</LeftSidebar>);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Hidden" }));

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Integrated" }).getAttribute("aria-checked")).toBe("true"),
    );
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not offer macOS window controls on other platforms", () => {
    Object.defineProperty(window, "config", {
      configurable: true,
      value: { isMacOS: false },
    });
    render(<LeftSidebar>Explorer</LeftSidebar>);

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(screen.queryByRole("radiogroup", { name: "Window controls" })).toBeNull();
  });
});

describe("SidebarResizer", () => {
  it("reports bounded pointer widths, receives focus, and cleans up every terminal path", () => {
    const onWidthChange = vi.fn();
    const onResizeEnd = vi.fn();
    const { container, unmount } = render(
      <SidebarResizer
        aria-label="Resize test pane"
        width={300}
        maxWidth={600}
        onWidthChange={onWidthChange}
        onResizeEnd={onResizeEnd}
      />,
    );
    const handle = container.querySelector(".sidebar-resize-handle")!;
    const separator = screen.getByRole("separator", { name: "Resize test pane" });

    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 3 });
    expect(document.activeElement).toBe(separator);
    fireEvent.pointerMove(window, { clientX: 1_000, pointerId: 3 });
    expect(onWidthChange).toHaveBeenLastCalledWith(600);
    fireEvent.pointerMove(window, { clientX: 425, pointerId: 3 });
    expect(document.body.classList.contains("pane-resizing")).toBe(true);

    fireEvent.blur(window);

    expect(document.body.classList.contains("pane-resizing")).toBe(false);
    expect(onResizeEnd).toHaveBeenLastCalledWith(425);

    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 4 });
    fireEvent.pointerMove(window, { clientX: -1_000, pointerId: 4 });
    fireEvent.pointerCancel(window, { pointerId: 4 });
    expect(onWidthChange).toHaveBeenLastCalledWith(0);
    expect(onResizeEnd).toHaveBeenLastCalledWith(0);
    expect(document.body.classList.contains("pane-resizing")).toBe(false);

    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 5 });
    expect(document.body.classList.contains("pane-resizing")).toBe(true);
    unmount();
    expect(document.body.classList.contains("pane-resizing")).toBe(false);
  });

  it("supports keyboard resizing and exposes its current range", () => {
    const onResizeEnd = vi.fn();

    const Harness = ({ edge, label }: { edge?: "left" | "right"; label: string }) => {
      const [width, setWidth] = useState(300);
      return (
        <SidebarResizer
          aria-label={label}
          edge={edge}
          width={width}
          maxWidth={600}
          onWidthChange={setWidth}
          onResizeEnd={onResizeEnd}
        />
      );
    };

    render(
      <>
        <Harness label="Resize right-edge pane" />
        <Harness edge="left" label="Resize left-edge pane" />
      </>,
    );
    const rightEdgeSeparator = screen.getByRole("separator", { name: "Resize right-edge pane" });
    const leftEdgeSeparator = screen.getByRole("separator", { name: "Resize left-edge pane" });

    expect(leftEdgeSeparator.getAttribute("tabindex")).toBe("0");
    expect(leftEdgeSeparator.getAttribute("aria-valuemin")).toBe("0");
    expect(leftEdgeSeparator.getAttribute("aria-valuemax")).toBe("600");
    expect(leftEdgeSeparator.getAttribute("aria-valuenow")).toBe("300");

    fireEvent.keyDown(rightEdgeSeparator, { key: "ArrowRight" });
    expect(rightEdgeSeparator.getAttribute("aria-valuenow")).toBe("310");
    expect(onResizeEnd).toHaveBeenLastCalledWith(310);

    fireEvent.keyDown(leftEdgeSeparator, { key: "ArrowLeft" });
    expect(leftEdgeSeparator.getAttribute("aria-valuenow")).toBe("310");
    expect(onResizeEnd).toHaveBeenLastCalledWith(310);

    fireEvent.keyDown(leftEdgeSeparator, { key: "Home" });
    expect(leftEdgeSeparator.getAttribute("aria-valuenow")).toBe("0");
    expect(onResizeEnd).toHaveBeenLastCalledWith(0);

    fireEvent.keyDown(leftEdgeSeparator, { key: "End" });
    expect(leftEdgeSeparator.getAttribute("aria-valuenow")).toBe("600");
    expect(onResizeEnd).toHaveBeenLastCalledWith(600);
  });

  it("resets a resized divider on double click", () => {
    const onReset = vi.fn();
    render(
      <SidebarResizer
        aria-label="Resize resettable pane"
        width={410}
        maxWidth={600}
        onWidthChange={vi.fn()}
        onReset={onReset}
      />,
    );

    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize resettable pane" }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
