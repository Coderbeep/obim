import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { StatusBar } from "../src/renderer/src/app/StatusBar";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { openWorkspaceItemsByKeyAtom } from "../src/renderer/src/store/workspaceResourceStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { fileSaveStatesByPathAtom } from "../src/renderer/src/store/fileSaveStore";
import { actionRunnerRequestAtom } from "../src/renderer/src/store/actionRunnerStore";
import { shortcutHelpOpenAtom } from "../src/renderer/src/store/appSessionStore";
import { createFileWorkspaceItem } from "../src/shared/workspace";
import type { GitFileStatusSnapshot } from "../src/shared/git";
const oldApi = window.api;
const oldConfig = window.config;
afterEach(() => {
  cleanup();
  window.api = oldApi;
  window.config = oldConfig;
});
function setup(snapshot: GitFileStatusSnapshot = { status: "not-repository", changes: [] }) {
  const unsubscribe = vi.fn();
  let changed = () => {};
  const getGitFileStatus = vi.fn().mockResolvedValue(snapshot);
  window.api = {
    ...oldApi,
    getGitFileStatus,
    onGitFileStatusChanged: (callback) => {
      changed = () => callback({ treeMayHaveChanged: false });
      return unsubscribe;
    },
  };
  window.config = { ...oldConfig, isMacOS: false };
  const store = createStore();
  const item = createFileWorkspaceItem({
    id: "note",
    path: "/notes/note.md",
    relativePath: "note.md",
    filename: "note",
    isDirectory: false,
    mimeType: "text/markdown",
  });
  const tab = createEditorTab("tab", item.key);
  store.set(workspacePanesAtom, [{ id: "pane", tabs: [tab.id], activeTabId: tab.id, size: 1 }]);
  store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
  store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
  store.set(fileBuffersByPathAtom, { "/notes/note.md": { editorText: "Hello world", savedText: "Hello world" } });
  const view = render(
    <Provider store={store}>
      <StatusBar />
    </Provider>,
  );
  return { ...view, store, unsubscribe, changed: () => changed(), getGitFileStatus };
}
it("shows live note counts, save state, and functional shortcut hints", async () => {
  const { store } = setup();
  expect(screen.getByText("2 words")).toBeTruthy();
  expect(screen.getByText("11 characters")).toBeTruthy();
  expect(screen.getByText("Saved")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Commands/ }));
  expect(store.get(actionRunnerRequestAtom)).toEqual({ view: "commands" });
  fireEvent.click(screen.getByRole("button", { name: /Shortcuts/ }));
  expect(store.get(shortcutHelpOpenAtom)).toBe(true);
  act(() =>
    store.set(fileBuffersByPathAtom, {
      "/notes/note.md": { editorText: "Hello lovely world", savedText: "Hello world" },
    }),
  );
  expect(screen.getByText("Unsaved")).toBeTruthy();
  await waitFor(() => expect(screen.getByText("3 words")).toBeTruthy());
  act(() => store.set(fileSaveStatesByPathAtom, { "/notes/note.md": { phase: "error", message: "Disk full" } }));
  expect(screen.getByText("Save failed").title).toBe("Disk full");
});
it("updates Git through status events and cleans up its subscription", async () => {
  const view = setup({ status: "ready", branch: "main", changes: [], repositoryScope: "workspace" });
  await screen.findByText("Clean");
  expect(screen.queryByText("main")).toBeNull();
  expect(screen.getByText("Clean")).toBeTruthy();
  view.getGitFileStatus.mockResolvedValue({ status: "not-repository", changes: [] });
  act(() => view.changed());
  await waitFor(() => expect(screen.queryByText("Clean")).toBeNull());
  view.unmount();
  expect(view.unsubscribe).toHaveBeenCalledOnce();
});
