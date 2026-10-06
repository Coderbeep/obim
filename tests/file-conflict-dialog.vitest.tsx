import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  createFile: vi.fn(),
  readTextFile: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock("../src/renderer/src/features/files/workspaceFileService", () => service);

import { FileConflictDialog } from "../src/renderer/src/features/files/FileConflictDialog";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { reloadRevisionAtom } from "../src/renderer/src/store/fileExplorerStore";
import { fileConflictReviewRequestAtom, fileSaveStatesByPathAtom } from "../src/renderer/src/store/fileSaveStore";
import { notificationsAtom } from "../src/renderer/src/store/NotificationsStore";

const filePath = "/notes/note.md";
const openedVersion = { id: "opened", mtimeMs: 100, sizeBytes: 5 };
const diskVersion = { id: "disk", mtimeMs: 200, sizeBytes: 8 };
const savedVersion = { id: "saved", mtimeMs: 300, sizeBytes: 5 };

const renderConflict = () => {
  const store = createStore();
  store.set(fileBuffersByPathAtom, {
    [filePath]: { savedText: "saved", editorText: "my draft", version: openedVersion },
  });
  store.set(fileSaveStatesByPathAtom, { [filePath]: { phase: "conflict" } });
  store.set(fileConflictReviewRequestAtom, { path: filePath });
  render(
    <Provider store={store}>
      <FileConflictDialog />
    </Provider>,
  );
  return store;
};

beforeEach(() => {
  service.readTextFile.mockReset().mockResolvedValue({
    success: true,
    content: "disk update",
    version: diskVersion,
  });
  service.saveFile.mockReset().mockResolvedValue({ success: true, version: savedVersion });
  service.createFile.mockReset();
});

afterEach(cleanup);

describe("file conflict review", () => {
  it("shows both versions and only applies the disk version after confirmation", async () => {
    const store = renderConflict();

    expect(await screen.findByText("Your edits")).toBeTruthy();
    expect(screen.getByText("my draft")).toBeTruthy();
    expect(screen.getByText("disk update")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use disk version" }));

    expect(store.get(fileBuffersByPathAtom)[filePath]).toEqual({
      savedText: "disk update",
      editorText: "disk update",
      version: diskVersion,
    });
    expect(store.get(fileSaveStatesByPathAtom)[filePath]?.phase).toBe("saved");
    expect(store.get(fileConflictReviewRequestAtom)).toBeNull();
  });

  it("safely overwrites the reviewed disk version when keeping editor changes", async () => {
    const store = renderConflict();
    await screen.findByText("Version on disk");

    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));

    await waitFor(() => expect(service.saveFile).toHaveBeenCalledWith(filePath, "my draft", diskVersion));
    expect(store.get(fileBuffersByPathAtom)[filePath]).toEqual({
      savedText: "my draft",
      editorText: "my draft",
      version: savedVersion,
    });
    expect(store.get(fileConflictReviewRequestAtom)).toBeNull();
  });

  it.each(["ENOENT: no such file or directory", "EACCES: permission denied"])(
    "exports the in-memory draft when the original cannot be read: %s",
    async (error) => {
      service.readTextFile.mockResolvedValue({ success: false, error });
      service.createFile
        .mockResolvedValueOnce({ success: false, error: "disk full" })
        .mockResolvedValueOnce({ success: false, error: "Destination file already exists" })
        .mockResolvedValueOnce({ success: true, file: { path: "/notes/note — conflict copy 2.md" } });
      const store = renderConflict();
      await screen.findByRole("alert");
      expect(screen.getByText("my draft")).toBeTruthy();
      const copy = screen.getByRole("button", { name: "Save my edits as a copy" });
      expect((copy as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole("button", { name: "Use disk version" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(copy);
      await screen.findByText("disk full");
      expect(store.get(fileConflictReviewRequestAtom)).toEqual({ path: filePath });
      expect(store.get(fileBuffersByPathAtom)[filePath].editorText).toBe("my draft");
      fireEvent.click(copy);
      await waitFor(() =>
        expect(service.createFile).toHaveBeenLastCalledWith("/notes", "note — conflict copy 2.md", "my draft"),
      );
      expect(store.get(fileBuffersByPathAtom)[filePath].editorText).toBe("my draft");
      expect(service.saveFile).not.toHaveBeenCalled();
      expect(store.get(notificationsAtom).at(-1)?.title).toBe("Saved a conflict copy");
    },
  );

  it("can preserve editor changes in a copy before restoring the disk version", async () => {
    const store = renderConflict();
    service.createFile.mockResolvedValue({
      success: true,
      file: {
        id: "copy",
        filename: "note — conflict copy.md",
        relativePath: "note — conflict copy.md",
        path: "/notes/note — conflict copy.md",
        sizeBytes: 8,
        isDirectory: false,
        mimeType: "text/markdown",
      },
    });
    await screen.findByText("Version on disk");

    fireEvent.click(screen.getByRole("button", { name: "Save my edits as a copy" }));

    await waitFor(() =>
      expect(service.createFile).toHaveBeenCalledWith("/notes", "note — conflict copy.md", "my draft"),
    );
    expect(store.get(fileBuffersByPathAtom)[filePath]?.editorText).toBe("disk update");
    expect(store.get(reloadRevisionAtom)).toBe(1);
    expect(store.get(notificationsAtom).at(-1)?.title).toBe("Saved a conflict copy");
  });
});
