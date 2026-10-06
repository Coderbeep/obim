import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceItemViews } from "../src/renderer/src/app/workspaceItemViews";
import { GitConflictResolutionView } from "../src/renderer/src/features/git/GitConflictResolutionView";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { createGitConflictWorkspaceItem, WORKSPACE_ITEM_KINDS } from "../src/shared/workspace";

const item = createGitConflictWorkspaceItem("/notes/note.md", "note.md");
const conflict = {
  conflict: { localExists: true, remoteExists: true },
  conflicted: true,
  kind: "conflicted" as const,
  path: "note.md",
  staged: false,
  workingTreeChanged: true,
};
const conflictSnapshot = {
  status: "ready" as const,
  branch: "main",
  changes: [conflict],
  mergeInProgress: true,
  remoteReconciliationInProgress: true,
  repositoryScope: "workspace" as const,
};

describe("Git conflict reconciliation view", () => {
  const getGitConflictPreview = vi.fn();
  const getGitFileStatus = vi.fn();
  const onGitFileStatusChanged = vi.fn();
  const openTextFile = vi.fn();
  const resolveGitConflict = vi.fn();
  const stageGitPaths = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getGitFileStatus.mockResolvedValue(conflictSnapshot);
    getGitConflictPreview.mockResolvedValue({
      status: "ready",
      base: { status: "ready", content: "base note\n", sizeBytes: 10 },
      local: { status: "ready", content: "local note\n", sizeBytes: 11 },
      remote: { status: "ready", content: "remote note\n", sizeBytes: 12 },
    });
    onGitFileStatusChanged.mockImplementation(() => vi.fn());
    openTextFile.mockResolvedValue({
      content: "selected note\n",
      version: { id: "note", mtimeMs: 20, sizeBytes: 14 },
    });
    resolveGitConflict.mockImplementation(async ({ resolution }: { resolution: string }) => ({
      status: "succeeded" as const,
      changedPaths:
        resolution === "save-both"
          ? [
              { kind: "modified" as const, path: "note.md" },
              { kind: "added" as const, path: "note — remote.md" },
            ]
          : [{ kind: "modified" as const, path: "note.md" }],
      ...(resolution === "save-both" ? { savedBothPath: "note — remote.md" } : {}),
      snapshot: {
        ...conflictSnapshot,
        changes:
          resolution === "save-both"
            ? [
                {
                  conflicted: false,
                  kind: "untracked" as const,
                  path: "note — remote.md",
                  staged: false,
                  workingTreeChanged: true,
                },
              ]
            : [],
      },
    }));
    Object.defineProperty(window, "config", {
      configurable: true,
      value: { getMainDirectoryPathSync: () => "/notes" },
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        getGitConflictPreview,
        getGitFileStatus,
        onGitFileStatusChanged,
        openTextFile,
        resolveGitConflict,
        stageGitPaths,
      },
    });
  });

  afterEach(() => cleanup());

  it("registers as a dedicated two-pane workspace view", () => {
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    expect(views[WORKSPACE_ITEM_KINDS.gitConflict].getTitle(item)).toBe("Resolve · note.md");
    expect(views[WORKSPACE_ITEM_KINDS.gitConflict].managesOwnOverflow?.(item)).toBe(true);
  });

  it("explains that an existing window must restart when the comparison API is stale", async () => {
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        ...window.api,
        getGitConflictPreview: undefined,
      },
    });

    render(<GitConflictResolutionView item={item} />);

    expect(await screen.findByText("Comparison unavailable")).toBeTruthy();
    expect(
      screen.getByText("Restart Obim to finish loading the conflict comparison feature, then open this file again."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(getGitConflictPreview).not.toHaveBeenCalled();
  });

  it.each([
    ["Keep local", "keep-local"],
    ["Keep remote", "use-remote"],
    ["Keep both", "save-both"],
  ] as const)("compares both versions and applies %s without staging", async (buttonLabel, resolution) => {
    const store = createStore();
    render(
      <Provider store={store}>
        <GitConflictResolutionView item={item} />
      </Provider>,
    );

    expect(await screen.findByText("local note")).toBeTruthy();
    expect(await screen.findByText("remote note")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Local version" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Remote version" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: buttonLabel }));

    await waitFor(() => expect(resolveGitConflict).toHaveBeenCalledWith({ path: "note.md", resolution }));
    expect(await screen.findByText("This file no longer has a conflict")).toBeTruthy();
    expect(stageGitPaths).not.toHaveBeenCalled();
  });

  it("blocks a choice when the same note has unsaved editor text", async () => {
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      "/notes/note.md": { savedText: "saved", editorText: "unsaved" },
    });
    render(
      <Provider store={store}>
        <GitConflictResolutionView item={item} />
      </Provider>,
    );

    await screen.findByText("local note");
    fireEvent.click(screen.getByRole("button", { name: "Keep remote" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Save or discard editor changes to note.md before choosing a version.",
    );
    expect(resolveGitConflict).not.toHaveBeenCalled();
  });

  it("shows deletion conflicts and disables Keep both", async () => {
    getGitConflictPreview.mockResolvedValue({
      status: "ready",
      base: { status: "ready", content: "base note\n", sizeBytes: 10 },
      local: { status: "deleted" },
      remote: { status: "ready", content: "remote note\n", sizeBytes: 12 },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GitConflictResolutionView item={item} />);

    expect(await screen.findByText("Deleted on this side")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep both" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Keep local" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(resolveGitConflict).not.toHaveBeenCalled();
  });

  it("shows Task Board configuration as the same raw text comparison used for notes", async () => {
    const configItem = createGitConflictWorkspaceItem("/notes/.todo/taskboard.json", ".todo/taskboard.json");
    getGitFileStatus.mockResolvedValue({
      ...conflictSnapshot,
      changes: [{ ...conflict, path: ".todo/taskboard.json" }],
    });
    getGitConflictPreview.mockResolvedValue({
      status: "ready",
      base: {
        status: "ready",
        content: JSON.stringify({
          sections: [{ name: "Research", colorId: "blue" }],
          taskOrder: ["one.md", "two.md"],
        }),
        sizeBytes: 100,
      },
      local: {
        status: "ready",
        content: JSON.stringify({
          sections: [{ name: "Research", colorId: "rose" }],
          taskOrder: ["one.md", "two.md"],
        }),
        sizeBytes: 100,
      },
      remote: {
        status: "ready",
        content: JSON.stringify({
          sections: [{ name: "Research", colorId: "blue" }],
          taskOrder: ["two.md", "one.md"],
        }),
        sizeBytes: 100,
      },
    });

    render(<GitConflictResolutionView item={configItem} />);

    expect(await screen.findByText("Resolve conflict")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Local version" }).textContent).toContain('"colorId":"rose"');
    expect(screen.getByRole("region", { name: "Remote version" }).textContent).toContain(
      '"taskOrder":["two.md","one.md"]',
    );
    expect(screen.getByRole("button", { name: "Keep both" }).hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Keep remote" }));
    await waitFor(() =>
      expect(resolveGitConflict).toHaveBeenCalledWith({ path: ".todo/taskboard.json", resolution: "use-remote" }),
    );
  });

  it("shows bookmark configuration as raw text with the standard choices", async () => {
    const bookmarksItem = createGitConflictWorkspaceItem("/notes/.obim/bookmarks.json", ".obim/bookmarks.json");
    getGitFileStatus.mockResolvedValue({
      ...conflictSnapshot,
      changes: [{ ...conflict, path: ".obim/bookmarks.json" }],
    });
    const bookmarkSource = (paths: string[]) =>
      JSON.stringify({ items: paths.map((path) => ({ type: "file", path })) });
    getGitConflictPreview.mockResolvedValue({
      status: "ready",
      base: { status: "ready", content: bookmarkSource(["base.md"]), sizeBytes: 50 },
      local: { status: "ready", content: bookmarkSource(["base.md", "local.md"]), sizeBytes: 75 },
      remote: { status: "ready", content: bookmarkSource(["base.md", "remote.md"]), sizeBytes: 76 },
    });

    render(<GitConflictResolutionView item={bookmarksItem} />);

    expect(await screen.findByText("Resolve conflict")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Local version" }).textContent).toContain('"path":"local.md"');
    expect(screen.getByRole("region", { name: "Remote version" }).textContent).toContain('"path":"remote.md"');
    expect(screen.getByRole("button", { name: "Keep local" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep remote" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep both" })).toBeTruthy();
  });
});
