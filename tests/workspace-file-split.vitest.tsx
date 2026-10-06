import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import { usePaneWorkspace } from "../src/renderer/src/features/workspace/usePaneWorkspace";
import { AppDndProvider, useAppDndActions } from "../src/renderer/src/shared/dnd/AppDndProvider";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { fileTreeAtom } from "../src/renderer/src/store/fileExplorerStore";
import type { FileItem } from "../src/shared/file-item";
import { FILE_DRAG_DATA_MIME } from "../src/shared/drag-data";
import { createFileWorkspaceItem } from "../src/shared/workspace";

const note: FileItem = {
  id: "/notes/Note.md",
  filename: "Note",
  relativePath: "Note.md",
  path: "/notes/Note.md",
  isDirectory: false,
  mimeType: "text/markdown",
};

const fileDropEvent = () =>
  ({
    dataTransfer: {
      getData: (type: string) =>
        type === FILE_DRAG_DATA_MIME
          ? JSON.stringify({
              filename: note.filename,
              mimeType: note.mimeType,
              path: note.path,
              relativePath: note.relativePath,
            })
          : "",
      types: [FILE_DRAG_DATA_MIME],
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as unknown as React.DragEvent<HTMLElement>;

const setup = (openSucceeds: boolean) => {
  const store = createStore();
  store.set(fileTreeAtom, [note]);
  const item = createFileWorkspaceItem(note);
  const openDroppedFile = vi.fn(async (_file: FileItem, { paneId }: { openInNewTab: true; paneId: string }) => {
    if (!openSucceeds) return false;
    const tab = createEditorTab("opened-tab", item.key);
    store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
    store.set(workspacePanesAtom, (panes) =>
      panes.map((pane) => (pane.id === paneId ? { ...pane, activeTabId: tab.id, tabs: [tab.id] } : pane)),
    );
    return true;
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <Provider store={store}>
      <AppDndProvider>{children}</AppDndProvider>
    </Provider>
  );
  let startDrag: ReturnType<typeof useAppDndActions>["startDrag"];
  const hook = renderHook(
    () => {
      startDrag = useAppDndActions().startDrag;
      return usePaneWorkspace({
        openDroppedFile,
        resolveWorkspaceItem: () => null,
        views: {},
      });
    },
    { wrapper },
  );
  act(() =>
    startDrag({
      entity: { kind: "explorer-item", id: note.relativePath },
      event: { clientX: 0, clientY: 0 },
      preview: { text: note.filename },
    }),
  );
  return { hook, openDroppedFile, store };
};

describe("Explorer file pane splitting", () => {
  it.each(["left", "right"] as const)(
    "creates a %s pane beside the only empty pane and opens the file",
    async (side) => {
      const { hook, openDroppedFile, store } = setup(true);

      await act(() => hook.result.current.onPaneSplitDrop(fileDropEvent(), "pane-1", side));

      const panes = store.get(workspacePanesAtom);
      expect(panes).toHaveLength(2);
      expect(panes[side === "left" ? 0 : 1].tabs).toEqual(["opened-tab"]);
      expect(panes[side === "left" ? 1 : 0].tabs).toEqual([]);
      expect(openDroppedFile).toHaveBeenCalledWith(note, {
        openInNewTab: true,
        paneId: panes[side === "left" ? 0 : 1].id,
      });
    },
  );

  it("removes the provisional pane when opening the dropped file fails", async () => {
    const { hook, store } = setup(false);

    await act(() => hook.result.current.onPaneSplitDrop(fileDropEvent(), "pane-1", "right"));

    expect(store.get(workspacePanesAtom)).toEqual([{ id: "pane-1", tabs: [], activeTabId: null, size: 1 }]);
  });
});
