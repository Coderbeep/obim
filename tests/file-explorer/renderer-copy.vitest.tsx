import { Provider, createStore } from "jotai";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFileCopy } from "../../src/renderer/src/features/files/fileActions";
import { reloadRevisionAtom } from "../../src/renderer/src/store/fileExplorerStore";
import { notificationsAtom } from "../../src/renderer/src/store/NotificationsStore";
import type { FileItem } from "../../src/shared/file-item";

const state = vi.hoisted(() => ({
  copyWorkspaceItems: vi.fn(),
}));

vi.mock("@renderer/features/files/workspaceFileService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/renderer/src/features/files/workspaceFileService")>()),
  copyWorkspaceItems: state.copyWorkspaceItems,
}));

const file = (path: string): FileItem => ({
  id: path,
  filename: path.split("/").at(-1)?.replace(/\.md$/, "") ?? "",
  relativePath: path.replace("/notes-root/", ""),
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

describe("workspace copy renderer action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.config = { getMainDirectoryPathSync: () => "/notes-root" } as Window["config"];
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("refreshes once and reports both copied items and summarized partial failures", async () => {
    state.copyWorkspaceItems.mockResolvedValue({
      copiedPaths: ["/notes-root/Target/one.md", "/notes-root/Target/two.md"],
      errors: ["denied", "unreadable", "outside workspace"],
    });
    const store = createStore();
    const { result } = renderHook(() => useFileCopy(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
    const files = [file("/notes-root/one.md"), file("/notes-root/two.md")];

    await act(() => result.current.copyManyToDirectory(files, "/notes-root/Target"));

    expect(state.copyWorkspaceItems).toHaveBeenCalledOnce();
    expect(state.copyWorkspaceItems).toHaveBeenCalledWith(
      files.map((item) => item.path),
      "/notes-root/Target",
      expect.objectContaining({ commit: expect.any(Function), release: expect.any(Function) }),
    );
    expect(store.get(reloadRevisionAtom)).toBe(1);
    expect(store.get(notificationsAtom).map((notification) => notification.title)).toEqual([
      "Copied 2 items",
      "File copy failed",
    ]);
    expect(store.get(notificationsAtom).at(-1)?.message).toBe("denied (+2 more)");
  });

  it("does not refresh when every item fails", async () => {
    state.copyWorkspaceItems.mockResolvedValue({ copiedPaths: [], errors: ["outside workspace"] });
    const store = createStore();
    const { result } = renderHook(() => useFileCopy(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await act(() => result.current.copyManyToDirectory([file("/notes-root/one.md")], "/notes-root/Target"));

    expect(store.get(reloadRevisionAtom)).toBe(0);
    expect(store.get(notificationsAtom).at(-1)).toMatchObject({
      title: "File copy failed",
      message: "outside workspace",
    });
  });

  it("shows a delayed persistent paste indicator and removes it on completion", async () => {
    vi.useFakeTimers();
    let finish!: (result: { copiedPaths: string[]; errors: string[] }) => void;
    state.copyWorkspaceItems.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const store = createStore();
    const { result } = renderHook(() => useFileCopy(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
    let operation!: Promise<void>;

    act(() => {
      operation = result.current.copyManyToDirectory([file("/notes-root/one.md")], "/notes-root/Target");
    });
    await act(() => vi.advanceTimersByTimeAsync(249));
    expect(store.get(notificationsAtom)).toEqual([]);

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(store.get(notificationsAtom).at(-1)).toMatchObject({
      busy: true,
      message: "Destination: Target",
      timeout: 0,
      title: "Pasting 1 item…",
    });

    await act(async () => {
      finish({ copiedPaths: ["/notes-root/Target/one.md"], errors: [] });
      await operation;
    });
    expect(store.get(notificationsAtom).map(({ title }) => title)).toEqual(["Copied 1 item"]);
  });

  it("rejects an overlapping paste and cleans up the indicator before a later paste", async () => {
    vi.useFakeTimers();
    const finishes: ((result: { copiedPaths: string[]; errors: string[] }) => void)[] = [];
    state.copyWorkspaceItems.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve);
        }),
    );
    const store = createStore();
    const { result } = renderHook(() => useFileCopy(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
    let first!: Promise<void>;
    let second!: Promise<void>;

    act(() => {
      first = result.current.copyManyToDirectory([file("/notes-root/one.md")], "/notes-root/First");
      second = result.current.copyManyToDirectory([file("/notes-root/two.md")], "/notes-root/Second");
    });
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(state.copyWorkspaceItems).toHaveBeenCalledTimes(1);
    expect(store.get(notificationsAtom).filter(({ busy }) => busy)).toHaveLength(1);
    expect(store.get(notificationsAtom).find(({ title }) => title === "File copy failed")?.message).toContain(
      "Wait for the workspace operation",
    );
    await second;

    await act(async () => {
      finishes[0]({ copiedPaths: [], errors: [] });
      await first;
    });
    expect(store.get(notificationsAtom).filter(({ busy }) => busy)).toHaveLength(0);

    act(() => {
      second = result.current.copyManyToDirectory([file("/notes-root/two.md")], "/notes-root/Second");
    });
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(state.copyWorkspaceItems).toHaveBeenCalledTimes(2);
    expect(store.get(notificationsAtom).filter(({ busy }) => busy)).toHaveLength(1);
    await act(async () => {
      finishes[1]({ copiedPaths: [], errors: [] });
      await second;
    });
    expect(store.get(notificationsAtom).filter(({ busy }) => busy)).toHaveLength(0);
  });
});
