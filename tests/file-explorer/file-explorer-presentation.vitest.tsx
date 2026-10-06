import { Provider, createStore } from "jotai";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fileBuffersByPathAtom } from "../../src/renderer/src/store/fileBufferStore";
import { stageExternalFileEditAtom } from "../../src/renderer/src/store/fileLifecycleStore";
import { notificationsAtom } from "../../src/renderer/src/store/NotificationsStore";

const state = vi.hoisted(() => ({
  createDirectory: vi.fn(),
  createNewFile: vi.fn(),
  openSearchWindow: vi.fn(),
}));

vi.mock("@renderer/shared/ui/IconButton", () => ({
  IconButton: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button onClick={onClick}>{label}</button>
  ),
}));

vi.mock("@pierre/icons", () => ({
  IconCheck: () => null,
  IconChevron: () => null,
  IconChevronsClose: () => null,
  IconExpandAll: () => null,
  IconEllipsisSm: () => null,
  IconFilePlus: () => null,
  IconFolder: () => null,
  IconFolderOpen: () => null,
  IconFolderPlus: () => null,
  IconSearch: () => null,
  IconTrash: () => null,
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useDirectoryCreate: () => ({ createDirectory: state.createDirectory }),
  useFileCreate: () => ({ createNewFile: state.createNewFile }),
}));

import {
  FileExplorerActions,
  FileExplorerHeader,
} from "../../src/renderer/src/features/files/explorer/FileExplorerTreeHeader";

describe("file explorer presentation components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.config = {
      getRecentWorkspacesSync: vi.fn(() => ["/notes", "/archive", "/projects/client-notes"]),
      initializeConfig: vi.fn(async () => ({ status: "cancelled" as const })),
      selectRecentWorkspace: vi.fn(async (path: string) => ({ status: "selected" as const, path })),
      removeRecentWorkspace: vi.fn(async () => ["/notes", "/projects/client-notes"]),
    } as unknown as Window["config"];
    window.api = {
      saveFile: vi.fn(),
    } as unknown as Window["api"];
  });
  afterEach(cleanup);

  it("connects every stable header command", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();
    const { rerender } = render(
      <>
        <FileExplorerHeader onSearch={state.openSearchWindow} />
        <FileExplorerActions allDirectoriesExpanded={false} onToggleAllDirectories={toggle} />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search files" }));
    await user.click(screen.getByRole("button", { name: "New note" }));
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.click(screen.getByRole("button", { name: "Expand all directories" }));
    expect(state.openSearchWindow).toHaveBeenCalledTimes(1);
    expect(state.createNewFile).toHaveBeenCalledWith();
    expect(state.createDirectory).toHaveBeenCalledWith();
    expect(toggle).toHaveBeenCalledTimes(1);

    rerender(
      <>
        <FileExplorerHeader onSearch={state.openSearchWindow} />
        <FileExplorerActions allDirectoriesExpanded onToggleAllDirectories={toggle} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Collapse all directories" }));
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it("lists recent workspaces, marks the current one, and switches directly", async () => {
    const user = userEvent.setup();
    const onWorkspaceSelected = vi.fn();
    render(
      <FileExplorerHeader
        onSearch={state.openSearchWindow}
        onWorkspaceSelected={onWorkspaceSelected}
        workspaceName="notes"
        workspacePath="/notes"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Switch workspace. Current workspace: notes" }));

    expect(screen.getByRole("menuitemradio", { name: "notes /notes" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("menuitemradio", { name: "archive /archive" }));

    await waitFor(() => expect(window.config.selectRecentWorkspace).toHaveBeenCalledWith("/archive"));
    expect(onWorkspaceSelected).toHaveBeenCalledTimes(1);
  });

  it("removes a saved workspace without switching and preserves the active workspace", async () => {
    const user = userEvent.setup();
    const onWorkspaceSelected = vi.fn();
    vi.mocked(window.config.removeRecentWorkspace).mockImplementation(async () => {
      vi.mocked(window.config.getRecentWorkspacesSync).mockReturnValue(["/notes", "/projects/client-notes"]);
      return ["/notes", "/projects/client-notes"];
    });
    render(
      <FileExplorerHeader
        onSearch={state.openSearchWindow}
        onWorkspaceSelected={onWorkspaceSelected}
        workspaceName="notes"
        workspacePath="/notes"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Switch workspace. Current workspace: notes" });
    await user.click(trigger);
    expect(screen.queryByRole("menuitem", { name: "Remove notes from workspace list" })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "Remove archive from workspace list" }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(window.config.removeRecentWorkspace).toHaveBeenCalledWith("/archive");
    expect(window.config.selectRecentWorkspace).not.toHaveBeenCalled();
    expect(onWorkspaceSelected).not.toHaveBeenCalled();
    await user.click(trigger);
    expect(screen.queryByRole("menuitemradio", { name: "archive /archive" })).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: "notes /notes" }).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps a workspace listed when removal fails and reports the failure", async () => {
    const user = userEvent.setup();
    const store = createStore();
    vi.mocked(window.config.removeRecentWorkspace).mockRejectedValueOnce(new Error("Settings disk unavailable"));
    render(
      <Provider store={store}>
        <FileExplorerHeader onSearch={state.openSearchWindow} workspaceName="notes" workspacePath="/notes" />
      </Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Switch workspace. Current workspace: notes" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove archive from workspace list" }));
    await waitFor(() =>
      expect(store.get(notificationsAtom).map((n) => n.message)).toContain("Settings disk unavailable"),
    );
    expect(screen.getByRole("menuitemradio", { name: "archive /archive" })).toBeTruthy();
    expect(window.config.selectRecentWorkspace).not.toHaveBeenCalled();
  });

  it("allows keyboard removal and blocks workspace selection while removal is pending", async () => {
    const user = userEvent.setup();
    let finish!: (paths: string[]) => void;
    vi.mocked(window.config.removeRecentWorkspace).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<FileExplorerHeader onSearch={state.openSearchWindow} workspaceName="notes" workspacePath="/notes" />);
    const trigger = screen.getByRole("button", { name: "Switch workspace. Current workspace: notes" });
    await user.click(trigger);
    screen.getByRole("menuitem", { name: "Remove archive from workspace list" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(window.config.removeRecentWorkspace).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("menuitemradio", { name: "client-notes /projects/client-notes" }).getAttribute("data-disabled"),
    ).not.toBeNull();
    await user.click(screen.getByRole("menuitemradio", { name: "client-notes /projects/client-notes" }));
    expect(window.config.selectRecentWorkspace).not.toHaveBeenCalled();
    finish(["/notes", "/projects/client-notes"]);
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("offers the system folder chooser without changing the workspace when it is cancelled", async () => {
    const user = userEvent.setup();
    const onWorkspaceSelected = vi.fn();
    render(
      <FileExplorerHeader
        onSearch={state.openSearchWindow}
        onWorkspaceSelected={onWorkspaceSelected}
        workspaceName="notes"
        workspacePath="/notes"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Switch workspace. Current workspace: notes" }));
    await user.click(screen.getByRole("menuitem", { name: "Choose another folder…" }));

    await waitFor(() => expect(window.config.initializeConfig).toHaveBeenCalledTimes(1));
    expect(onWorkspaceSelected).not.toHaveBeenCalled();
  });

  it("rejects edits throughout a pending workspace selection and releases on cancellation", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const path = "/notes/draft.md";
    store.set(fileBuffersByPathAtom, { [path]: { savedText: "saved", editorText: "saved" } });
    let finish!: (value: { status: "cancelled" }) => void;
    vi.mocked(window.config.selectRecentWorkspace).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <Provider store={store}>
        <FileExplorerHeader
          onSearch={state.openSearchWindow}
          onWorkspaceSelected={vi.fn()}
          workspaceName="notes"
          workspacePath="/notes"
        />
      </Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Switch workspace. Current workspace: notes" }));
    await user.click(screen.getByRole("menuitemradio", { name: "archive /archive" }));
    await waitFor(() => expect(window.config.selectRecentWorkspace).toHaveBeenCalledTimes(1));
    const accepted = store.set(stageExternalFileEditAtom, { path, expectedText: "saved", nextText: "late mutation" });
    finish({ status: "cancelled" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Switch workspace. Current workspace: notes" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(accepted).toBe(false);
    expect(store.get(fileBuffersByPathAtom)[path].editorText).toBe("saved");
    expect(store.set(stageExternalFileEditAtom, { path, expectedText: "saved", nextText: "after cancel" })).toBe(true);
  });

  it("keeps the current workspace open when a dirty note cannot be saved", async () => {
    const user = userEvent.setup();
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      "/notes/draft.md": {
        savedText: "Saved text",
        editorText: "Unsaved text",
        version: { id: "opened", mtimeMs: 100, sizeBytes: 10 },
      },
    });
    vi.mocked(window.api.saveFile).mockResolvedValue({
      success: false,
      errorCode: "conflict",
      error: "The note changed on disk.",
    });

    render(
      <Provider store={store}>
        <FileExplorerHeader onSearch={state.openSearchWindow} workspaceName="notes" workspacePath="/notes" />
      </Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Switch workspace. Current workspace: notes" }));
    await user.click(screen.getByRole("menuitemradio", { name: "archive /archive" }));

    await waitFor(() => expect(window.api.saveFile).toHaveBeenCalledTimes(1));
    expect(window.config.selectRecentWorkspace).not.toHaveBeenCalled();
    expect(store.get(notificationsAtom).map(({ title }) => title)).toContain("Note changed on disk");
  });
});
