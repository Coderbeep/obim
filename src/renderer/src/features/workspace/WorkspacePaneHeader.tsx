import { IconChevron, IconEllipsisSm } from "@pierre/icons";
import { useAtomValue } from "jotai";

import { FileBreadcrumbTitle } from "@renderer/features/files/FileBreadcrumbTitle";
import { useFileHeaderMenu } from "@renderer/features/files/menus/useFileHeaderMenu";
import { IconButton } from "@renderer/shared/ui/IconButton";
import { activePaneIdAtom, workspacePanesAtom } from "@renderer/store/editorPaneStore";
import { workspaceTabsByIdAtom } from "@renderer/store/editorTabStore";
import { isFileWorkspaceItem, type WorkspaceItem } from "@shared/workspace";

import { useWorkspaceTabNavigation } from "./useWorkspaceTabNavigation";
import type { OpenWorkspaceItem, WorkspaceItemResolver } from "./workspaceItemOperations";
import { getWorkspaceItemTitle, type WorkspaceItemViewMap } from "./workspaceItemView";

type WorkspacePaneHeaderProps = {
  item?: WorkspaceItem | null;
  openWorkspaceItem: OpenWorkspaceItem;
  paneId: string;
  resolveWorkspaceItem: WorkspaceItemResolver;
  views: WorkspaceItemViewMap;
};

export const WorkspacePaneHeader = ({
  item,
  openWorkspaceItem,
  paneId,
  resolveWorkspaceItem,
  views,
}: WorkspacePaneHeaderProps) => {
  const activePaneId = useAtomValue(activePaneIdAtom);
  const panes = useAtomValue(workspacePanesAtom);
  const tabsById = useAtomValue(workspaceTabsByIdAtom);
  const activeTabId = panes.find((pane) => pane.id === paneId)?.activeTabId ?? null;
  const activeTab = activeTabId ? tabsById[activeTabId] : null;
  const currentWorkspaceItemKey = activeTab?.currentResourceKey;
  const currentFile = isFileWorkspaceItem(item) ? item.file : null;
  const currentTitle = getWorkspaceItemTitle(views, item, currentWorkspaceItemKey);
  const { goBackward, goForward } = useWorkspaceTabNavigation({
    openWorkspaceItem,
    resolveWorkspaceItem,
  });
  const { openFileHeaderMenu } = useFileHeaderMenu();

  return (
    <div className="pane-card-header">
      <div className="flex items-center gap-2 shrink-0">
        <IconButton
          icon={IconChevron}
          iconClassName="rotate-90"
          label="Go back"
          onClick={() => goBackward(paneId)}
          disabled={(activeTab?.backStack.length ?? 0) <= 1}
        />
        <IconButton
          icon={IconChevron}
          iconClassName="-rotate-90"
          label="Go forward"
          onClick={() => goForward(paneId)}
          disabled={(activeTab?.forwardStack.length ?? 0) === 0}
        />
      </div>
      <div className="pane-card-title-wrap">
        <div className="pane-card-title">
          {currentFile ? (
            <FileBreadcrumbTitle key={currentFile.path} file={currentFile} isPaneActive={paneId === activePaneId} />
          ) : item ? (
            currentTitle
          ) : (
            "No item open"
          )}
        </div>
      </div>
      <div className="relative z-10 shrink-0">
        <IconButton
          icon={IconEllipsisSm}
          label="Current file options"
          disabled={!currentFile}
          className={`text-muted-foreground disabled:text-muted-foreground${
            paneId !== activePaneId ? " opacity-80" : ""
          }`}
          onClick={(event) => {
            if (!currentFile || !activeTabId) return;
            event.stopPropagation();
            openFileHeaderMenu(event, currentFile, { paneId, tabId: activeTabId });
          }}
        />
      </div>
    </div>
  );
};
