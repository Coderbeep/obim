import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePaneGrid } from "../src/renderer/src/features/workspace/WorkspacePaneGrid";
import { usePaneWorkspace } from "../src/renderer/src/features/workspace/usePaneWorkspace";
import { ImageViewer } from "../src/renderer/src/features/files/ImageViewer";
import { activePaneIdAtom, workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { openWorkspaceItemsByKeyAtom } from "../src/renderer/src/store/workspaceResourceStore";
import { createFileWorkspaceItem, type WorkspaceItem } from "../src/shared/workspace";
import type { WorkspaceItemViewMap } from "../src/renderer/src/features/workspace/workspaceItemView";

const resolve = (key: string, items: Readonly<Record<string, WorkspaceItem>>) => items[key] ?? null;
const setup = () => {
  const store = createStore();
  const note = createFileWorkspaceItem({
    id: "note",
    filename: "Note",
    relativePath: "note.md",
    path: "/notes/note.md",
    isDirectory: false,
    mimeType: "text/markdown",
  });
  const image = createFileWorkspaceItem({
    id: "image",
    filename: "Image",
    relativePath: "image.png",
    path: "/notes/image.png",
    isDirectory: false,
    mimeType: "image/png",
  });
  store.set(activePaneIdAtom, "note-pane");
  store.set(workspacePanesAtom, [
    { id: "note-pane", tabs: ["note-tab"], activeTabId: "note-tab", size: 1 },
    { id: "image-pane", tabs: ["image-tab"], activeTabId: "image-tab", size: 1 },
  ]);
  store.set(workspaceTabsByIdAtom, {
    "note-tab": createEditorTab("note-tab", note.key),
    "image-tab": createEditorTab("image-tab", image.key),
  });
  store.set(openWorkspaceItemsByKeyAtom, { [note.key]: note, [image.key]: image });
  const views: WorkspaceItemViewMap = {
    file: {
      getTitle: (item) => item.key,
      render: (item) =>
        item.key === image.key ? (
          <>
            <ImageViewer file={image.file as Extract<typeof image.file, { isDirectory: false }>} />
            <input aria-label="Pane-owned control" />
            {createPortal(<input aria-label="Pane-owned popup" />, document.body)}
          </>
        ) : (
          <input aria-label="Note input" />
        ),
    },
  };
  const Grid = () => {
    const workspace = usePaneWorkspace({ openDroppedFile: vi.fn(), resolveWorkspaceItem: resolve, views });
    return (
      <>
        <WorkspacePaneGrid workspace={workspace} views={views} resolveWorkspaceItem={resolve} />
        <button onClick={() => void workspace.closeActiveTab()}>Close active</button>
        <input aria-label="Global dialog" />
      </>
    );
  };
  render(
    <Provider store={store}>
      <Grid />
    </Provider>,
  );
  return store;
};
afterEach(cleanup);

describe("pane content command ownership", () => {
  it("activates the image pane on pointer interaction and closes that pane's tab", async () => {
    const store = setup();
    fireEvent.pointerDown(screen.getByRole("img", { name: "Image" }));
    expect(store.get(activePaneIdAtom)).toBe("image-pane");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close active" })));
    expect(store.get(workspaceTabsByIdAtom)["image-tab"]).toBeUndefined();
    expect(store.get(workspaceTabsByIdAtom)["note-tab"]).toBeDefined();
  });

  it("follows descendant and pane-owned popup focus without stealing it or claiming global dialogs", () => {
    const store = setup();
    for (const name of ["Pane-owned control", "Pane-owned popup"]) {
      store.set(activePaneIdAtom, "note-pane");
      const input = screen.getByRole("textbox", { name });
      act(() => input.focus());
      expect(document.activeElement).toBe(input);
      expect(store.get(activePaneIdAtom)).toBe("image-pane");
    }
    act(() => screen.getByRole("textbox", { name: "Global dialog" }).focus());
    expect(store.get(activePaneIdAtom)).toBe("image-pane");
    act(() => screen.getByRole("textbox", { name: "Note input" }).focus());
    expect(store.get(activePaneIdAtom)).toBe("note-pane");
  });
});
