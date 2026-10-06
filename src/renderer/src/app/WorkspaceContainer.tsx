import { IconFilePlus, IconSearch, IconSidebar, IconSidebarOpen } from "@pierre/icons";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useMemo } from "react";

import { useInspectorSidebarControls } from "@renderer/app/AppSidebars";
import { getWorkspacePath } from "@renderer/config";
import { WorkspacePaneHeader } from "@renderer/features/workspace/WorkspacePaneHeader";
import { useFileCreate, useFileOpen } from "@renderer/features/files/fileActions";
import { useNoteTabMenu } from "@renderer/features/files/menus/useNoteTabMenu";
import { resolveWorkspaceItemFromState } from "@renderer/features/files/workspaceFileResolver";
import { WorkspacePaneGrid } from "@renderer/features/workspace/WorkspacePaneGrid";
import { usePaneWorkspace } from "@renderer/features/workspace/usePaneWorkspace";
import type { WorkspaceItemViewMap } from "@renderer/features/workspace/workspaceItemView";
import { Button } from "@renderer/shared/ui/button";
import { fileTreeAtom, recentFilesAtom } from "@renderer/store/fileExplorerStore";
import { isVisibleAtom } from "@renderer/store/SearchWindowStore";
import { activateWorkspacePaneAtom } from "@renderer/store/workspaceActionStore";
import { isFileWorkspaceItem } from "@shared/workspace";
import { WORKSPACE_ITEM_KINDS } from "@shared/workspace";

import { createWorkspaceItemViews } from "./workspaceItemViews";
import { useSidebarPlacement } from "./sidebarPlacement";

const InspectorToggle = ({ side }: { side: "left" | "right" }) => {
  const { isSidebarCollapsed, toggleSidebar } = useInspectorSidebarControls();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="motion-panel-toggle"
      onClick={toggleSidebar}
      aria-label={isSidebarCollapsed ? "Expand file inspector" : "Collapse file inspector"}
      title={isSidebarCollapsed ? "Expand inspector" : "Collapse inspector"}
    >
      <span className={side === "left" ? "inline-flex -scale-x-100" : "inline-flex"}>
        {isSidebarCollapsed ? <IconSidebarOpen size={16} /> : <IconSidebar size={16} />}
      </span>
    </Button>
  );
};

export const WorkspaceContainer = () => {
  const store = useStore();
  const workspacePath = getWorkspacePath();
  const sidebarPlacement = useSidebarPlacement();
  useAtomValue(fileTreeAtom);
  const recentFiles = useAtomValue(recentFilesAtom);
  const setSearchVisible = useSetAtom(isVisibleAtom);
  const activatePane = useSetAtom(activateWorkspacePaneAtom);
  const { open, openLinkedFile, openWorkspaceItem } = useFileOpen();
  const { createNewFile } = useFileCreate();

  const resolveWorkspaceItem = useCallback(
    (workspaceItemKey: string, openItemsByKey: Parameters<typeof resolveWorkspaceItemFromState>[1]) =>
      resolveWorkspaceItemFromState(workspaceItemKey, openItemsByKey, store.get(fileTreeAtom), workspacePath),
    [store, workspacePath],
  );

  const baseViews = useMemo(
    () =>
      createWorkspaceItemViews({
        openWorkspaceItem,
        openLinkedFile: async (path, sourceFilePath) => {
          await openLinkedFile(path, sourceFilePath);
        },
        resolveWorkspaceItem,
      }),
    [openLinkedFile, openWorkspaceItem, resolveWorkspaceItem],
  );
  const workspace = usePaneWorkspace({ openDroppedFile: open, resolveWorkspaceItem, views: baseViews });
  const { getNoteTabMenuEntries } = useNoteTabMenu();
  const views = useMemo<WorkspaceItemViewMap>(
    () => ({
      ...baseViews,
      [WORKSPACE_ITEM_KINDS.file]: {
        ...baseViews[WORKSPACE_ITEM_KINDS.file],
        getTabMenuEntries: (item) => (isFileWorkspaceItem(item) ? getNoteTabMenuEntries(item.file) : []),
      },
    }),
    [baseViews, getNoteTabMenuEntries],
  );

  return (
    <WorkspacePaneGrid
      views={views}
      resolveWorkspaceItem={resolveWorkspaceItem}
      workspace={workspace}
      renderEmptyPaneContent={(paneId) => {
        const recent = recentFiles[0];
        return (
          <div className="pane-empty-state">
            <div className="pane-empty-state-copy">
              <strong>Start writing</strong>
              <span>Create a note, find an existing one, or drop a file into this pane.</span>
            </div>
            <div className="pane-empty-state-actions">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  activatePane(paneId);
                  void createNewFile();
                }}
              >
                <IconFilePlus size={16} aria-hidden="true" />
                New note
                <kbd>{window.config.isMacOS ? "⌘N" : "Ctrl+N"}</kbd>
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setSearchVisible(true)}>
                <IconSearch size={16} aria-hidden="true" />
                Search files
                <kbd>{window.config.isMacOS ? "⌘P" : "Ctrl+P"}</kbd>
              </Button>
            </div>
            {recent ? (
              <button
                type="button"
                className="pane-empty-recent"
                onClick={() => void open(recent, { paneId, focusEditor: true })}
                title={recent.relativePath}
              >
                Reopen <span>{recent.filename}</span>
              </button>
            ) : null}
          </div>
        );
      }}
      renderEmptyPaneHeader={(paneId) => (
        <WorkspacePaneHeader
          paneId={paneId}
          openWorkspaceItem={openWorkspaceItem}
          resolveWorkspaceItem={resolveWorkspaceItem}
          views={views}
        />
      )}
      tabBarEndContent={sidebarPlacement === "explorer-left" ? <InspectorToggle side="right" /> : undefined}
      tabBarStartContent={sidebarPlacement === "explorer-right" ? <InspectorToggle side="left" /> : undefined}
    />
  );
};
