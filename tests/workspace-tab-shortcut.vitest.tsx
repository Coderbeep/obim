import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePaneWorkspace } from "../src/renderer/src/features/workspace/usePaneWorkspace";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { openWorkspaceItemsByKeyAtom } from "../src/renderer/src/store/workspaceResourceStore";
import type { FileItem } from "../src/shared/file-item";
import { createFileWorkspaceItem } from "../src/shared/workspace";

const hadApi = "api" in window;
const originalApi = window.api;

afterEach(() => {
  if (hadApi) window.api = originalApi;
  else Reflect.deleteProperty(window, "api");
});

describe("workspace tab shortcut", () => {
  it("closes the active tab even while an editable control has focus", async () => {
    let triggerClose!: () => void;
    const removeListener = vi.fn();
    window.api = {
      onCloseCurrentTabShortcut: vi.fn((callback) => {
        triggerClose = callback;
        return removeListener;
      }),
    } as unknown as Window["api"];

    const store = createStore();
    const file: FileItem = {
      id: "/notes/Note.md",
      filename: "Note",
      relativePath: "Note.md",
      path: "/notes/Note.md",
      isDirectory: false,
      mimeType: "text/markdown",
    };
    const item = createFileWorkspaceItem(file);
    const tab = createEditorTab("active-tab", item.key);
    store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }]);
    store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
    store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
    const editor = document.body.appendChild(document.createElement("textarea"));
    editor.focus();

    const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
    const hook = renderHook(
      () =>
        usePaneWorkspace({
          openDroppedFile: vi.fn(async () => true),
          resolveWorkspaceItem: (key, openItems) => openItems[key] ?? null,
          views: { file: { getTitle: () => "Note", render: () => null } },
        }),
      { wrapper },
    );

    act(() => triggerClose());

    await waitFor(() => expect(store.get(workspacePanesAtom)[0].tabs).toEqual([]));
    hook.unmount();
    editor.remove();
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it("reopens the latest closed tab when the native shortcut is received", async () => {
    let triggerReopen!: () => void;
    const removeListener = vi.fn();
    window.api = {
      onReopenLastClosedTabShortcut: vi.fn((callback) => {
        triggerReopen = callback;
        return removeListener;
      }),
    } as unknown as Window["api"];

    const store = createStore();
    const file: FileItem = {
      id: "/notes/Note.md",
      filename: "Note",
      relativePath: "Note.md",
      path: "/notes/Note.md",
      isDirectory: false,
      mimeType: "text/markdown",
    };
    const item = createFileWorkspaceItem(file);
    const initialTab = createEditorTab("initial-tab", item.key);
    store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [initialTab.id], activeTabId: initialTab.id, size: 1 }]);
    store.set(workspaceTabsByIdAtom, { [initialTab.id]: initialTab });
    store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });

    const openDroppedFile = vi.fn(async (_file: FileItem, { paneId }: { openInNewTab: true; paneId: string }) => {
      const reopenedTab = createEditorTab("reopened-tab", item.key);
      store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
      store.set(workspaceTabsByIdAtom, { [reopenedTab.id]: reopenedTab });
      store.set(workspacePanesAtom, (panes) =>
        panes.map((pane) =>
          pane.id === paneId ? { ...pane, tabs: [reopenedTab.id], activeTabId: reopenedTab.id } : pane,
        ),
      );
      return true;
    });
    const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
    const hook = renderHook(
      () =>
        usePaneWorkspace({
          openDroppedFile,
          resolveWorkspaceItem: (key, openItems) => openItems[key] ?? null,
          views: { file: { getTitle: () => "Note", render: () => null } },
        }),
      { wrapper },
    );

    await act(() => hook.result.current.closeTab("pane-1", "initial-tab"));
    expect(hook.result.current.canReopenClosedTab).toBe(true);

    act(() => triggerReopen());

    await waitFor(() => expect(store.get(workspacePanesAtom)[0].tabs).toEqual(["reopened-tab"]));
    expect(openDroppedFile).toHaveBeenCalledWith(file, { openInNewTab: true, paneId: "pane-1" });
    await waitFor(() => expect(hook.result.current.canReopenClosedTab).toBe(false));

    hook.unmount();
    expect(removeListener).toHaveBeenCalledOnce();
  });
});
