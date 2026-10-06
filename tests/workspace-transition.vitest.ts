import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { switchWorkspaceSafely } from "../src/renderer/src/features/files/workspaceTransition";
import { workspaceMutationApi } from "../src/renderer/src/features/files/workspaceMutationApi";
import { saveFile } from "../src/renderer/src/features/files/workspaceFileService";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import {
  beginWorkspaceTransition,
  isWorkspaceTransitionActive,
  trackWorkspaceActivity,
  workspaceTransitionAtom,
} from "../src/renderer/src/store/workspaceTransitionStore";

const version = { id: "one", mtimeMs: 1, sizeBytes: 3 };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const seed = () => {
  const store = createStore();
  store.set(fileBuffersByPathAtom, {
    "/old/a.md": { savedText: "old", editorText: "draft a", version },
    "/old/b.md": { savedText: "old", editorText: "draft b", version },
  });
  window.api = {
    saveFile: vi.fn().mockResolvedValue({ success: true, version: { ...version, id: "two" } }),
  } as unknown as Window["api"];
  return store;
};

describe("workspace transition boundary", () => {
  it("drains pending activities then saves every accepted draft before committing the root", async () => {
    const store = seed();
    const importing = deferred<void>();
    const pending = trackWorkspaceActivity(() => importing.promise);
    const select = vi.fn().mockResolvedValue({ status: "selected", path: "/new" });
    const reload = vi.fn(() => expect(isWorkspaceTransitionActive()).toBe(true));
    const switching = switchWorkspaceSafely(store, select, reload, false);
    expect(isWorkspaceTransitionActive()).toBe(true);
    expect(select).not.toHaveBeenCalled();
    store.set(fileBuffersByPathAtom, (buffers) => ({
      ...buffers,
      "/old/a.md": { ...buffers["/old/a.md"], editorText: "late typing" },
    }));
    expect(store.get(fileBuffersByPathAtom)["/old/a.md"].editorText).toBe("draft a");
    importing.resolve();
    await pending;
    expect((await switching).status).toBe("selected");
    expect(window.api.saveFile).toHaveBeenNthCalledWith(1, "/old/a.md", "draft a", version);
    expect(window.api.saveFile).toHaveBeenNthCalledWith(2, "/old/b.md", "draft b", version);
    expect(select.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(window.api.saveFile).mock.invocationCallOrder[1],
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isWorkspaceTransitionActive()).toBe(false);
  });

  it("cancels the old workspace's Git sync before draining tracked work", async () => {
    const store = seed();
    const sync = deferred<void>();
    const pending = trackWorkspaceActivity(() => sync.promise);
    window.api.cancelGitSync = vi.fn(async () => {
      sync.resolve();
      return true;
    });
    const switching = switchWorkspaceSafely(store, vi.fn().mockResolvedValue({ status: "cancelled" }), vi.fn());
    await Promise.resolve();
    expect(window.api.cancelGitSync).toHaveBeenCalledOnce();
    sync.resolve();
    await pending;
    expect((await switching).status).toBe("cancelled");
  });

  it("refuses concurrent selection, cancels before commit, and retains all buffers", async () => {
    const store = seed();
    const pending = deferred<void>();
    const activity = trackWorkspaceActivity(() => pending.promise);
    const select = vi.fn();
    const first = switchWorkspaceSafely(store, select, vi.fn());
    expect((await switchWorkspaceSafely(store, select, vi.fn())).status).toBe("error");
    store.get(workspaceTransitionAtom)?.cancel();
    pending.resolve();
    await activity;
    expect((await first).status).toBe("cancelled");
    expect(select).not.toHaveBeenCalled();
    expect(isWorkspaceTransitionActive()).toBe(false);
    expect(store.get(fileBuffersByPathAtom)["/old/a.md"].editorText).toBe("draft a");
  });

  it("keeps the old workspace editable after a save conflict or selector failure", async () => {
    const store = seed();
    const select = vi.fn().mockRejectedValue(new Error("selection failed"));
    vi.mocked(window.api.saveFile).mockResolvedValueOnce({ success: false, error: "conflict", errorCode: "conflict" });
    expect((await switchWorkspaceSafely(store, select, vi.fn())).status).toBe("error");
    expect(select).not.toHaveBeenCalled();
    expect(isWorkspaceTransitionActive()).toBe(false);
    expect((await switchWorkspaceSafely(store, select, vi.fn())).status).toBe("error");
    expect(isWorkspaceTransitionActive()).toBe(false);
  });

  it("blocks all mutating bridge operations while allowing the owning save drain", async () => {
    const store = seed();
    const operations = [
      "upsertFile",
      "importPdfResearchDoi",
      "resolveGitConflict",
      "restoreGitFileRevision",
      "createFile",
      "copyWorkspaceItems",
      "renameFile",
      "trashFile",
    ] as const;
    for (const name of operations) Object.assign(window.api, { [name]: vi.fn().mockResolvedValue(true) });
    const lease = beginWorkspaceTransition(store, "Preparing");
    try {
      for (const name of operations) {
        await expect(Reflect.apply(workspaceMutationApi[name], workspaceMutationApi, [])).rejects.toThrow(
          "Wait for the workspace operation",
        );
        expect(window.api[name]).not.toHaveBeenCalled();
      }
      expect((await saveFile("/old/a.md", "draft a", version)).success).toBe(false);
      expect((await saveFile("/old/a.md", "draft a", version, lease!)).success).toBe(true);
    } finally {
      lease?.release();
    }
  });
});
