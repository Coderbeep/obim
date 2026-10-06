import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { saveDirtyFileBuffer } from "../src/renderer/src/features/files/dirtyFileBuffers";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { remapFileReferencesAtom } from "../src/renderer/src/store/fileLifecycleStore";
import { fileSaveStatesByPathAtom } from "../src/renderer/src/store/fileSaveStore";

const path = "/notes/note.md";
const opened = { id: "opened", mtimeMs: 1, sizeBytes: 3 };
const written = { id: "written", mtimeMs: 2, sizeBytes: 5 };
const seed = () => {
  const store = createStore();
  store.set(fileBuffersByPathAtom, { [path]: { savedText: "old", editorText: "draft", version: opened } });
  return store;
};

describe("persisted buffer snapshots", () => {
  it("records the completed write while retaining a newer dirty draft and its next expected version", async () => {
    const store = seed();
    let finish!: (value: { success: true; version: typeof written }) => void;
    const save = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValueOnce({ success: true, version: { ...written, id: "newer" } });
    const saving = saveDirtyFileBuffer(store, path, "draft", save);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    store.set(fileBuffersByPathAtom, (buffers) => ({ ...buffers, [path]: { ...buffers[path], editorText: "newer" } }));
    finish({ success: true, version: written });
    expect((await saving).success).toBe(false);
    expect(store.get(fileBuffersByPathAtom)[path]).toEqual({
      savedText: "draft",
      editorText: "newer",
      version: written,
    });
    expect(store.get(fileSaveStatesByPathAtom)[path].phase).toBe("dirty");
    expect((await saveDirtyFileBuffer(store, path, "newer", save)).success).toBe(true);
    expect(save).toHaveBeenLastCalledWith(path, "newer", written);
  });

  it("records a completed snapshot at its remapped buffer path", async () => {
    const store = seed();
    let finish!: (value: { success: true; version: typeof written }) => void;
    const save = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const saving = saveDirtyFileBuffer(store, path, "draft", save);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const renamed = "/notes/renamed.md";
    store.set(remapFileReferencesAtom, {
      notesDirectoryPath: "/notes",
      remapPath: (value) => (value === path ? renamed : value),
    });
    finish({ success: true, version: written });
    await saving;
    expect(store.get(fileBuffersByPathAtom)[renamed]).toEqual({
      savedText: "draft",
      editorText: "draft",
      version: written,
    });
    expect(store.get(fileBuffersByPathAtom)[path]).toBeUndefined();
  });

  it("keeps a genuine external conflict dirty without adopting an unwritten snapshot", async () => {
    const store = seed();
    const save = vi.fn().mockResolvedValue({ success: false, error: "changed externally", errorCode: "conflict" });
    expect((await saveDirtyFileBuffer(store, path, "draft", save)).success).toBe(false);
    expect(store.get(fileBuffersByPathAtom)[path]).toEqual({ savedText: "old", editorText: "draft", version: opened });
    expect(store.get(fileSaveStatesByPathAtom)[path].phase).toBe("conflict");
  });
});
