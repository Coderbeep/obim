import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileOpen } from "../src/renderer/src/features/files/fileActions";
import { useWorkspaceTabNavigation } from "../src/renderer/src/features/workspace/useWorkspaceTabNavigation";
import { activePaneIdAtom, workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { activateWorkspaceTabAtom, closeWorkspaceTabAtom } from "../src/renderer/src/store/workspaceActionStore";
import { openWorkspaceItemsByKeyAtom } from "../src/renderer/src/store/workspaceResourceStore";
import { createFileWorkspaceItem, type WorkspaceItem } from "../src/shared/workspace";

const service = vi.hoisted(() => ({ readTextFile: vi.fn(), saveFile: vi.fn() }));
vi.mock("@renderer/features/files/workspaceFileService", async (original) => ({
  ...(await original<typeof import("../src/renderer/src/features/files/workspaceFileService")>()),
  ...service,
}));
const note = (name: string) =>
  createFileWorkspaceItem({
    id: name,
    filename: name,
    path: `/notes/${name}.md`,
    relativePath: `${name}.md`,
    isDirectory: false,
    mimeType: "text/markdown",
  });
const [a, b, c, d] = ["a", "b", "c", "d"].map(note);
const version = { id: "one", mtimeMs: 1, sizeBytes: 3 };
const loaded = { success: true, content: "loaded", version };
const deferred = () => {
  let resolve!: (value: typeof loaded) => void;
  const promise = new Promise<typeof loaded>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const resolveItem = (key: string, items: Readonly<Record<string, WorkspaceItem>>) => items[key] ?? null;
const setup = () => {
  const store = createStore();
  store.set(activePaneIdAtom, "pane-1");
  store.set(workspacePanesAtom, [{ id: "pane-1", tabs: ["tab-a", "tab-b"], activeTabId: "tab-a", size: 1 }]);
  store.set(workspaceTabsByIdAtom, {
    "tab-a": createEditorTab("tab-a", a.key),
    "tab-b": createEditorTab("tab-b", b.key),
  });
  store.set(openWorkspaceItemsByKeyAtom, Object.fromEntries([a, b, c, d].map((item) => [item.key, item])));
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  const hook = renderHook(
    () => {
      const open = useFileOpen();
      return {
        ...open,
        ...useWorkspaceTabNavigation({ openWorkspaceItem: open.openWorkspaceItem, resolveWorkspaceItem: resolveItem }),
      };
    },
    { wrapper },
  );
  return { store, ...hook };
};
beforeEach(() => {
  service.readTextFile.mockReset().mockResolvedValue(loaded);
  service.saveFile.mockReset().mockResolvedValue({ success: true, version });
  window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
});

describe("ordered per-tab navigation", () => {
  it("finishes an ordinary slow open in the initiating tab when another tab becomes active", async () => {
    const { store, result } = setup();
    const load = deferred();
    service.readTextFile.mockReturnValueOnce(load.promise);
    const opening = result.current.openWorkspaceItem(c, { skipSave: true });
    store.set(activateWorkspaceTabAtom, { paneId: "pane-1", tabId: "tab-b" });
    load.resolve(loaded);
    expect(await act(() => opening)).toBe(true);
    expect(store.get(workspaceTabsByIdAtom)["tab-a"].currentResourceKey).toBe(c.key);
    expect(store.get(workspaceTabsByIdAtom)["tab-b"].currentResourceKey).toBe(b.key);
    expect(store.get(workspacePanesAtom)[0].activeTabId).toBe("tab-b");
  });

  it("prevents pending Back from overwriting a newer ordinary open or its history", async () => {
    const { store, result } = setup();
    store.set(workspaceTabsByIdAtom, (tabs) => ({
      ...tabs,
      "tab-a": { ...tabs["tab-a"], currentResourceKey: b.key, backStack: [a.key, b.key] },
    }));
    const load = deferred();
    service.readTextFile.mockImplementation((path) => (path === a.file.path ? load.promise : Promise.resolve(loaded)));
    act(() => {
      void result.current.goBackward("pane-1");
    });
    await vi.waitFor(() => expect(service.readTextFile).toHaveBeenCalledWith(a.file.path));
    await act(() => result.current.openWorkspaceItem(c));
    await act(async () => {
      load.resolve(loaded);
      await load.promise;
    });
    expect(store.get(workspaceTabsByIdAtom)["tab-a"]).toMatchObject({
      currentResourceKey: c.key,
      backStack: [a.key, b.key, c.key],
      forwardStack: [],
    });
  });

  it("commits Back and Forward atomically and leaves history untouched after failure", async () => {
    const { store, result } = setup();
    store.set(workspaceTabsByIdAtom, (tabs) => ({
      ...tabs,
      "tab-a": { ...tabs["tab-a"], currentResourceKey: b.key, backStack: [a.key, b.key] },
    }));
    await act(async () => {
      await result.current.goBackward("pane-1");
    });
    expect(store.get(workspaceTabsByIdAtom)["tab-a"]).toMatchObject({
      currentResourceKey: a.key,
      backStack: [a.key],
      forwardStack: [b.key],
    });
    await act(async () => {
      await result.current.goForward("pane-1");
    });
    const before = store.get(workspaceTabsByIdAtom)["tab-a"];
    expect(before).toMatchObject({ currentResourceKey: b.key, backStack: [a.key, b.key], forwardStack: [] });
    service.readTextFile.mockResolvedValueOnce({ success: false, error: "permission denied" });
    expect(await act(() => result.current.openWorkspaceItem(d))).toBe(false);
    expect(store.get(workspaceTabsByIdAtom)["tab-a"]).toBe(before);
  });

  it("invalidates a delayed open after the workspace changes", async () => {
    const { store, result } = setup();
    const load = deferred();
    service.readTextFile.mockReturnValueOnce(load.promise);
    const opening = result.current.openWorkspaceItem(c, { skipSave: true });
    window.config = { getMainDirectoryPathSync: () => "/other" } as Window["config"];
    load.resolve(loaded);
    expect(await act(() => opening)).toBe(false);
    expect(store.get(workspaceTabsByIdAtom)["tab-a"].currentResourceKey).toBe(a.key);
  });

  it("does not recreate a target tab that closed while reading", async () => {
    const { store, result } = setup();
    const load = deferred();
    service.readTextFile.mockReturnValueOnce(load.promise);
    const opening = result.current.openWorkspaceItem(c, { skipSave: true });
    store.set(closeWorkspaceTabAtom, { paneId: "pane-1", tabId: "tab-a" });
    load.resolve(loaded);
    expect(await act(() => opening)).toBe(false);
    expect(Object.keys(store.get(workspaceTabsByIdAtom))).toEqual(["tab-b"]);
  });

  it("allows independent explicit target tabs to finish in either order", async () => {
    const { store, result } = setup();
    const loadC = deferred(),
      loadD = deferred();
    service.readTextFile.mockImplementation((path) => (path === c.file.path ? loadC.promise : loadD.promise));
    const first = result.current.openWorkspaceItem(c, { targetTabId: "tab-a", skipSave: true });
    const second = result.current.openWorkspaceItem(d, { targetTabId: "tab-b", skipSave: true });
    loadD.resolve(loaded);
    expect(await act(() => second)).toBe(true);
    loadC.resolve(loaded);
    expect(await act(() => first)).toBe(true);
    expect(store.get(workspaceTabsByIdAtom)["tab-a"].currentResourceKey).toBe(c.key);
    expect(store.get(workspaceTabsByIdAtom)["tab-b"].currentResourceKey).toBe(d.key);
  });
});
