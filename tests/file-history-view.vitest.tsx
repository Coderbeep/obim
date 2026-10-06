import { Provider, createStore } from "jotai";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileHistoryView } from "../src/renderer/src/features/git/FileHistoryView";
import { createWorkspaceItemViews } from "../src/renderer/src/app/workspaceItemViews";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { reloadRevisionAtom } from "../src/renderer/src/store/fileExplorerStore";
import { createFileHistoryWorkspaceItem, WORKSPACE_ITEM_KINDS } from "../src/shared/workspace";
import type { FileItem } from "../src/shared/file-item";

const revisionId = "a".repeat(40);
const restoreToken = "restore-token";
const version = { id: "file-1", mtimeMs: 10, sizeBytes: 8 };
const file: FileItem = {
  id: "file-1",
  filename: "note",
  isDirectory: false,
  mimeType: "text/markdown",
  path: "/notes/note.md",
  relativePath: "note.md",
  sizeBytes: 8,
  version,
};

describe("file version history view", () => {
  const getGitFileHistory = vi.fn();
  const getGitFileRevision = vi.fn();
  const restoreGitFileRevision = vi.fn();
  let repositoryChanged:
    ((event: { historyMayHaveChanged?: boolean; treeMayHaveChanged: boolean }) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryChanged = undefined;
    getGitFileHistory.mockResolvedValue({
      status: "ready",
      entries: [
        {
          author: "Obim Test",
          changeKind: "modified",
          committedAt: 1_700_000_000_000,
          pathAtRevision: "note.md",
          revisionId,
          restoreToken,
          subject: "Clarify the note",
        },
      ],
      repositoryScope: "workspace",
    });
    getGitFileRevision.mockResolvedValue({
      status: "ready",
      content: "historical note\n",
      revisionId,
      sizeBytes: 16,
    });
    restoreGitFileRevision.mockResolvedValue({
      status: "succeeded",
      content: "historical note\n",
      created: false,
      recoveryPath: "/notes/note — before restore.md",
      version: { ...version, mtimeMs: 20, sizeBytes: 16 },
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        getGitFileHistory,
        getGitFileRevision,
        openTextFile: vi.fn(async () => ({ content: "current note\n", version })),
        restoreGitFileRevision,
        onGitFileStatusChanged: vi.fn(
          (listener: (event: { historyMayHaveChanged?: boolean; treeMayHaveChanged: boolean }) => void) => {
            repositoryChanged = listener;
            return vi.fn();
          },
        ),
      },
    });
  });

  afterEach(() => cleanup());

  it("uses its own toolbar instead of the generic workspace navigation header", () => {
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    const historyItem = createFileHistoryWorkspaceItem(file);
    expect(views[WORKSPACE_ITEM_KINDS.fileHistory].getTitle(historyItem)).toBe("Versions · note");
    expect(views[WORKSPACE_ITEM_KINDS.fileHistory].renderHeader).toBeUndefined();
    expect(views[WORKSPACE_ITEM_KINDS.file].renderHeader).toBeTypeOf("function");
  });

  it("opens historical document content, refreshes deliberately, and restores as a local change", async () => {
    const store = createStore();
    const initialReloadRevision = store.get(reloadRevisionAtom);
    const { container } = render(
      <Provider store={store}>
        <FileHistoryView item={createFileHistoryWorkspaceItem(file)} />
      </Provider>,
    );

    await screen.findByRole("option", { name: /Clarify the note/ });
    expect(await screen.findByText("historical note")).toBeTruthy();
    expect(await screen.findByText("current note")).toBeTruthy();
    expect(screen.getByText("Version history")).toBeTruthy();
    expect(screen.queryByText("Saved version")).toBeNull();
    expect(container.querySelector(".file-history-toolbar-title svg")).toBeNull();
    expect(container.querySelector(".file-history-timeline-heading")?.classList).toContain(
      "file-history-section-toolbar",
    );
    expect(container.querySelector(".file-history-inspector-toolbar")?.classList).toContain(
      "file-history-section-toolbar",
    );
    expect(getGitFileHistory).toHaveBeenCalledTimes(1);
    expect(getGitFileRevision).toHaveBeenCalledWith({
      filePath: file.path,
      pathAtRevision: "note.md",
      revisionId,
      restoreToken,
    });
    expect(screen.queryByRole("button", { name: "Changes" })).toBeNull();

    act(() => repositoryChanged?.({ historyMayHaveChanged: true, treeMayHaveChanged: false }));
    await waitFor(() => expect(getGitFileHistory).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore as new change" }));
    await screen.findByText("Version restored. Your previous contents are in note — before restore.md.");

    expect(restoreGitFileRevision).toHaveBeenCalledWith({
      expectedVersion: version,
      filePath: file.path,
      pathAtRevision: "note.md",
      revisionId,
      restoreToken,
    });
    expect(store.get(fileBuffersByPathAtom)[file.path]).toMatchObject({
      editorText: "historical note\n",
      savedText: "historical note\n",
      version: { mtimeMs: 20, sizeBytes: 16 },
    });
    expect(store.get(reloadRevisionAtom)).toBe(initialReloadRevision + 1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh version history" }));
    await waitFor(() => expect(getGitFileHistory.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(screen.getAllByText("historical note").length).toBeGreaterThan(0);
    expect(getGitFileRevision).toHaveBeenCalledTimes(1);
  });
});
