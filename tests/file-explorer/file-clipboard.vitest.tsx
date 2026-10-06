import { Provider, createStore } from "jotai";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FILE_EXPLORER_CLIPBOARD_MIME, useFileClipboard } from "../../src/renderer/src/features/files/useFileClipboard";
import { copiedWorkspaceFilePathsAtom, fileTreeAtom } from "../../src/renderer/src/store/fileExplorerStore";
import { notificationsAtom } from "../../src/renderer/src/store/NotificationsStore";
import type { FileItem } from "../../src/shared/file-item";

const state = vi.hoisted(() => ({
  copyManyToDirectory: vi.fn(),
  importExternalFiles: vi.fn(),
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useExternalFileImport: () => ({ importExternalFiles: state.importExternalFiles }),
  useFileCopy: () => ({ copyManyToDirectory: state.copyManyToDirectory }),
}));

const file = (path: string, relativePath: string): FileItem => ({
  id: path,
  filename: relativePath.split("/").at(-1)?.replace(/\.md$/, "") ?? "",
  relativePath,
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const folder = (path: string, relativePath: string, children: FileItem[]): FileItem => ({
  id: path,
  filename: relativePath.split("/").at(-1) ?? "",
  relativePath,
  path,
  isDirectory: true,
  mimeType: null,
  children,
});

const transfer = ({
  files = [],
  marked = "",
  plainText = "",
}: {
  files?: File[];
  marked?: string;
  plainText?: string;
} = {}) => {
  const values = new Map<string, string>();
  if (marked) values.set(FILE_EXPLORER_CLIPBOARD_MIME, marked);
  if (plainText) values.set("text/plain", plainText);
  return {
    files,
    items: files.map((value) => ({ getAsFile: () => value, kind: "file" })),
    getData: vi.fn((type: string) => values.get(type) ?? ""),
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
  } as unknown as DataTransfer;
};

const clipboardItem = (values: Record<string, Blob>) =>
  ({
    getType: vi.fn((type: string) => Promise.resolve(values[type])),
    types: Object.keys(values),
  }) as unknown as ClipboardItem;

const textBlob = (value: string) =>
  Object.assign(new Blob([value], { type: "text/plain" }), {
    text: () => Promise.resolve(value),
  });

const renderClipboard = (store: ReturnType<typeof createStore>) =>
  renderHook(() => useFileClipboard(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });

describe("file explorer clipboard", () => {
  let read: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;
  let note: FileItem;
  let second: FileItem;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    window.config = { getMainDirectoryPathSync: () => "/notes-root" } as Window["config"];
    read = vi.fn().mockResolvedValue([]);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { read, writeText },
    });
    note = file("/notes-root/Folder/note.md", "Folder/note.md");
    second = file("/notes-root/second.md", "second.md");
    store = createStore();
    store.set(fileTreeAtom, [folder("/notes-root/Folder", "Folder", [note]), second]);
  });

  afterEach(() => cleanup());

  it("writes the internal marker and absolute plain text for native Copy", () => {
    const data = transfer();
    const { result } = renderClipboard(store);

    expect(result.current.copyItems([note, second], data)).toBe(true);

    expect(data.setData).toHaveBeenCalledWith(FILE_EXPLORER_CLIPBOARD_MIME, JSON.stringify([note.path, second.path]));
    expect(data.setData).toHaveBeenCalledWith("text/plain", `${note.path}\n${second.path}`);
    expect(store.get(copiedWorkspaceFilePathsAtom)).toEqual([note.path, second.path]);
  });

  it("stores context Copy and writes absolute text to the system clipboard", async () => {
    const { result } = renderClipboard(store);
    act(() => {
      result.current.copyItems([note]);
    });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(note.path));
    expect(store.get(copiedWorkspaceFilePathsAtom)).toEqual([note.path]);
  });

  it("copies absolute and relative path lists and clears file-copy state", async () => {
    const { result } = renderClipboard(store);
    store.set(copiedWorkspaceFilePathsAtom, [note.path]);

    await act(() => result.current.copyAbsolutePaths([note, second]));
    expect(writeText).toHaveBeenLastCalledWith(`${note.path}\n${second.path}`);
    expect(store.get(copiedWorkspaceFilePathsAtom)).toBeNull();

    store.set(copiedWorkspaceFilePathsAtom, [note.path]);
    await act(() => result.current.copyRelativePaths([note, second]));
    expect(writeText).toHaveBeenLastCalledWith("Folder/note.md\nsecond.md");
    expect(store.get(copiedWorkspaceFilePathsAtom)).toBeNull();
  });

  it("resolves current tree items immediately before an internal paste and filters stale paths", () => {
    const { result } = renderClipboard(store);
    const latestNote = { ...note, filename: "latest" };
    store.set(fileTreeAtom, [folder("/notes-root/Folder", "Folder", [latestNote])]);
    store.set(copiedWorkspaceFilePathsAtom, ["/notes-root/deleted.md", note.path]);

    expect(
      result.current.pasteClipboardData(
        transfer({ marked: JSON.stringify(["/notes-root/deleted.md", note.path]) }),
        "/notes-root/target",
      ),
    ).toBe(true);
    expect(state.copyManyToDirectory).toHaveBeenCalledWith([latestNote], "/notes-root/target");
  });

  it("clears an entirely stale copy and reports why it cannot paste", () => {
    const { result } = renderClipboard(store);
    store.set(copiedWorkspaceFilePathsAtom, ["/notes-root/deleted.md"]);

    expect(
      result.current.pasteClipboardData(
        transfer({ marked: JSON.stringify(["/notes-root/deleted.md"]) }),
        "/notes-root",
      ),
    ).toBe(false);
    expect(store.get(copiedWorkspaceFilePathsAtom)).toBeNull();
    expect(store.get(notificationsAtom).at(-1)?.title).toBe("File copy failed");
  });

  it("prioritizes external files, clears internal state, and forwards pathless web images", () => {
    const image = new File([Uint8Array.from([1, 2, 3])], "clipboard.png", { type: "image/png" });
    const data = transfer({
      files: [image],
      marked: JSON.stringify([note.path]),
      plainText: note.path,
    });
    const { result } = renderClipboard(store);
    store.set(copiedWorkspaceFilePathsAtom, [note.path]);

    expect(result.current.pasteClipboardData(data, "/notes-root/images")).toBe(true);
    expect(state.importExternalFiles).toHaveBeenCalledWith([image], "/notes-root/images");
    expect(state.copyManyToDirectory).not.toHaveBeenCalled();
    expect(store.get(copiedWorkspaceFilePathsAtom)).toBeNull();
  });

  it("reads a web image for context-menu Paste and falls back to internal items", async () => {
    const image = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" });
    read.mockResolvedValueOnce([clipboardItem({ "image/png": image })]);
    const { result } = renderClipboard(store);

    expect(await result.current.pasteSystemClipboard("/notes-root/images")).toBe(true);
    expect(state.importExternalFiles).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "clipboard.png", type: "image/png" })],
      "/notes-root/images",
    );

    store.set(copiedWorkspaceFilePathsAtom, [note.path]);
    read.mockResolvedValueOnce([clipboardItem({ "text/plain": textBlob(note.path) })]);
    expect(await result.current.pasteSystemClipboard("/notes-root/target")).toBe(true);
    expect(state.copyManyToDirectory).toHaveBeenCalledWith([note], "/notes-root/target");
  });

  it("enables context Paste only for supported images or matching, current internal items", async () => {
    const { result } = renderClipboard(store);
    store.set(copiedWorkspaceFilePathsAtom, [note.path]);
    read.mockResolvedValueOnce([clipboardItem({ "text/plain": textBlob("unrelated text") })]);

    expect(await result.current.reconcilePasteAvailability()).toBe(false);
    expect(store.get(copiedWorkspaceFilePathsAtom)).toBeNull();

    read.mockResolvedValueOnce([clipboardItem({ "image/png": new Blob(["image"], { type: "image/png" }) })]);
    expect(await result.current.reconcilePasteAvailability()).toBe(true);

    store.set(copiedWorkspaceFilePathsAtom, [note.path]);
    read.mockResolvedValueOnce([clipboardItem({ "text/plain": textBlob(note.path) })]);
    expect(await result.current.reconcilePasteAvailability()).toBe(true);

    store.set(fileTreeAtom, []);
    read.mockResolvedValueOnce([clipboardItem({ "text/plain": textBlob(note.path) })]);
    expect(await result.current.reconcilePasteAvailability()).toBe(false);
    expect(store.get(copiedWorkspaceFilePathsAtom)).toBeNull();
  });

  it("reports unsupported content and clipboard read failures when Paste is revalidated", async () => {
    const { result } = renderClipboard(store);
    read.mockResolvedValueOnce([clipboardItem({ "text/plain": textBlob("ordinary text") })]);

    expect(await result.current.pasteSystemClipboard("/notes-root")).toBe(false);
    expect(store.get(notificationsAtom).at(-1)?.title).toBe("Nothing to paste");

    read.mockRejectedValueOnce(new Error("denied"));
    expect(await result.current.pasteSystemClipboard("/notes-root")).toBe(false);
    expect(store.get(notificationsAtom).at(-1)?.title).toBe("Clipboard unavailable");
  });

  it("accepts marked or exactly matching internal text and ignores unrelated text", () => {
    const { result } = renderClipboard(store);
    store.set(copiedWorkspaceFilePathsAtom, [note.path]);

    expect(
      result.current.pasteClipboardData(transfer({ marked: JSON.stringify([note.path]) }), "/notes-root/marked"),
    ).toBe(true);
    expect(result.current.pasteClipboardData(transfer({ plainText: note.path }), "/notes-root/plain")).toBe(true);
    expect(result.current.pasteClipboardData(transfer({ plainText: "unrelated text" }), "/notes-root")).toBe(false);
    expect(state.copyManyToDirectory).toHaveBeenCalledTimes(2);
  });

  it("keeps internal Copy usable and reports a failed system clipboard write", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const { result } = renderClipboard(store);

    act(() => {
      result.current.copyItems([note]);
    });

    await waitFor(() => expect(store.get(notificationsAtom).at(-1)?.title).toBe("Clipboard unavailable"));
    expect(store.get(copiedWorkspaceFilePathsAtom)).toEqual([note.path]);
  });

  it("preserves a previous file copy when copying path text fails", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const { result } = renderClipboard(store);
    store.set(copiedWorkspaceFilePathsAtom, [note.path]);

    expect(await result.current.copyAbsolutePaths([second])).toBe(false);
    expect(store.get(copiedWorkspaceFilePathsAtom)).toEqual([note.path]);
  });
});
