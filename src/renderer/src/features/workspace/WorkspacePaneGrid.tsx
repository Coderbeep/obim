import { useSetAtom } from "jotai";
import { activateWorkspacePaneAtom } from "@renderer/store/workspaceActionStore";
import { Fragment, useLayoutEffect, useRef } from "react";
import type { DragEvent, ReactNode } from "react";

import { useAppDndActions } from "@renderer/shared/dnd/AppDndProvider";
import { useAppDropZone } from "@renderer/shared/dnd/useAppDropZone";
import { SplitDropIndicator } from "@renderer/shared/dnd/DropIndicator";
import type { WorkspacePaneState } from "@renderer/store/editorPaneStore";
import { getWorkspacePaneMoveBoundary, getWorkspacePaneMoveIndex } from "@renderer/store/workspaceTransitions";
import { FILE_DRAG_DATA_MIME } from "@shared/drag-data";

import { PaneTabs } from "./PaneTabs";
import { getPaneSplitTarget, normalizePaneSize } from "./paneLayout";
import { usePaneResize } from "./usePaneResize";
import type { usePaneWorkspace } from "./usePaneWorkspace";
import type { WorkspaceItemResolver } from "./workspaceItemOperations";
import { getWorkspaceItemView, type WorkspaceItemViewMap } from "./workspaceItemView";

interface WorkspaceSplitIntent {
  insertIndex: number;
  label: string;
  operation: "move-pane" | "split";
  side: "left" | "right";
  targetPaneId: string;
  valid: boolean;
}

interface WorkspaceSplitTargetProps {
  className: string;
  insertIndex: number;
  resolve: (event: DragEvent<HTMLDivElement>, insertIndex: number) => WorkspaceSplitIntent | null;
  onHover: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, intent: WorkspaceSplitIntent) => void;
}

/** Renders a permanent hit target centered on a workspace pane boundary. */
const WorkspaceSplitTarget = ({ className, insertIndex, resolve, onHover, onDrop }: WorkspaceSplitTargetProps) => {
  const zone = useAppDropZone<HTMLDivElement, WorkspaceSplitIntent>({
    domMarker: true,
    accepts: (entity) => entity.kind === "workspace-tab" || entity.kind === "explorer-item",
    resolve: (event) => {
      const intent = resolve(event, insertIndex);
      return intent
        ? {
            key: `workspace:${intent.operation}:${intent.targetPaneId}:${intent.side}`,
            valid: intent.valid,
            label: intent.label,
            operation: intent,
          }
        : null;
    },
    onHover,
    onDrop,
  });
  return (
    <div
      aria-hidden="true"
      className={`pane-workspace-split-target ${className}`}
      data-workspace-split-index={insertIndex}
      {...zone.handlers}
    >
      <SplitDropIndicator className="pane-workspace-split-indicator" orientation="vertical" />
    </div>
  );
};

interface WorkspacePaneProps {
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
  isOnly: boolean;
  pane: WorkspacePaneState;
  renderEmptyPaneHeader?: (paneId: string) => ReactNode;
  renderEmptyPaneContent?: (paneId: string) => ReactNode;
  resolveWorkspaceItem: WorkspaceItemResolver;
  tabBarEndContent?: ReactNode;
  tabBarStartContent?: ReactNode;
  views: WorkspaceItemViewMap;
  workspace: ReturnType<typeof usePaneWorkspace>;
}

const WorkspacePane = ({
  isActive,
  isFirst,
  isLast,
  isOnly,
  pane,
  renderEmptyPaneHeader,
  renderEmptyPaneContent,
  resolveWorkspaceItem,
  tabBarEndContent,
  tabBarStartContent,
  views,
  workspace,
}: WorkspacePaneProps) => {
  const activatePane = useSetAtom(activateWorkspacePaneAtom);
  const {
    activateTab,
    canReopenClosedTab,
    closeOtherTabs,
    closeTab,
    movePane,
    moveTab,
    moveTabToNewPane,
    onPaneDragOver,
    onPaneDrop,
    onTabDragStart,
    openWorkspaceItemsByKey,
    panes,
    reopenLastClosedTab,
    tabsById,
  } = workspace;
  const activeItemKey = pane.activeTabId ? tabsById[pane.activeTabId]?.currentResourceKey : null;
  const item = activeItemKey ? resolveWorkspaceItem(activeItemKey, openWorkspaceItemsByKey) : null;
  const view = getWorkspaceItemView(views, item);
  const isEditorContent = Boolean(item && view?.isEditorContent?.(item));
  const managesOwnOverflow = Boolean(item && view?.managesOwnOverflow?.(item));
  const contentZone = useAppDropZone<HTMLDivElement, string>({
    accepts: (entity) => entity.kind === "workspace-tab" || entity.kind === "explorer-item",
    resolve: (event, entity) => {
      if (entity.kind === "explorer-item" && !event.dataTransfer.types.includes(FILE_DRAG_DATA_MIME)) return null;
      return { key: `workspace:pane:${pane.id}`, valid: true, label: "Open in this pane", operation: pane.id };
    },
    onHover: onPaneDragOver,
    onDrop: (event, paneId) => onPaneDrop(event, paneId),
  });

  return (
    <div
      onPointerDownCapture={() => activatePane(pane.id)}
      onFocusCapture={() => activatePane(pane.id)}
      className={`pane-column ${isActive ? "pane-column-active" : ""}`}
      style={{ flex: `${isOnly ? 1 : normalizePaneSize(pane.size)} 1 0%` }}
    >
      <PaneTabs
        pane={pane}
        isActive={isActive}
        tabsById={tabsById}
        openWorkspaceItemsByKey={openWorkspaceItemsByKey}
        activateTab={activateTab}
        canReopenClosedTab={canReopenClosedTab}
        closeOtherTabs={(paneId, tabId) => void closeOtherTabs(paneId, tabId)}
        closeTab={(paneId, tabId) => void closeTab(paneId, tabId)}
        movePane={movePane}
        moveTab={moveTab}
        moveTabToNewPane={moveTabToNewPane}
        panes={panes}
        reopenLastClosedTab={() => void reopenLastClosedTab()}
        onTabDragStart={onTabDragStart}
        onPaneDragOver={onPaneDragOver}
        onPaneDrop={onPaneDrop}
        resolveWorkspaceItem={resolveWorkspaceItem}
        views={views}
        tabBarEndContent={isLast ? tabBarEndContent : undefined}
        tabBarStartContent={isFirst ? tabBarStartContent : undefined}
      />
      <section className={`pane-card ${isActive ? "pane-card-active" : ""}`}>
        {item && view?.renderHeader
          ? view.renderHeader(item, pane.id)
          : !item
            ? renderEmptyPaneHeader?.(pane.id)
            : null}
        <div
          className="pane-card-body"
          data-pane-empty={pane.tabs.length === 0 ? "true" : undefined}
          {...contentZone.handlers}
        >
          <div
            className={`pane-card-content${isEditorContent ? " pane-card-content-editor" : ""}${
              managesOwnOverflow ? " pane-card-content-managed-overflow" : ""
            }`}
          >
            {!item
              ? (renderEmptyPaneContent?.(pane.id) ?? (
                  <div className="pane-placeholder">Open a note to start editing in this pane.</div>
                ))
              : view?.render(item, pane.id)}
          </div>
        </div>
      </section>
    </div>
  );
};

interface WorkspacePaneGridProps {
  renderEmptyPaneContent?: (paneId: string) => ReactNode;
  renderEmptyPaneHeader?: (paneId: string) => ReactNode;
  resolveWorkspaceItem: WorkspaceItemResolver;
  tabBarEndContent?: ReactNode;
  tabBarStartContent?: ReactNode;
  views: WorkspaceItemViewMap;
  workspace: ReturnType<typeof usePaneWorkspace>;
}

/** Renders the workspace pane grid and coordinates resizing, splitting, and tab drag previews. */
export const WorkspacePaneGrid = ({
  renderEmptyPaneContent,
  renderEmptyPaneHeader,
  resolveWorkspaceItem,
  tabBarEndContent,
  tabBarStartContent,
  views,
  workspace,
}: WorkspacePaneGridProps) => {
  const { activePaneId, onPaneDragOver, onPaneSplitDrop, panes, resizePanePair } = workspace;
  const appDnd = useAppDndActions();
  const paneGridRef = useRef<HTMLDivElement | null>(null);
  const handlePaneResizeStart = usePaneResize(panes, paneGridRef, resizePanePair);

  const resolveSplitIntent = (event: DragEvent<HTMLElement>, insertIndex: number): WorkspaceSplitIntent | null => {
    const sourceEntity = appDnd.getActiveEntity();
    const isTab = sourceEntity?.kind === "workspace-tab";
    const isFile = sourceEntity?.kind === "explorer-item" && event.dataTransfer.types.includes(FILE_DRAG_DATA_MIME);
    if (!isTab && !isFile) return null;

    const target = getPaneSplitTarget(panes, insertIndex);
    if (!target) return null;
    const sourcePane =
      isTab && sourceEntity?.kind === "workspace-tab"
        ? panes.find((pane) => pane.id === sourceEntity.sourcePaneId)
        : null;
    const sourcePaneIndex = sourcePane ? panes.indexOf(sourcePane) : -1;
    const movingPane = Boolean(isTab && sourcePane?.tabs.length === 1);
    const moveIndex = movingPane ? getWorkspacePaneMoveIndex(panes, sourcePane!.id, insertIndex) : null;
    const moveBoundary = movingPane ? getWorkspacePaneMoveBoundary(panes, sourcePane!.id, insertIndex) : null;
    const operationTarget = moveBoundary === null ? target : (getPaneSplitTarget(panes, moveBoundary) ?? target);
    const canPlaceTab = !isTab || Boolean(sourcePane && (!movingPane || moveIndex !== sourcePaneIndex));
    const valid = canPlaceTab;
    const label = valid
      ? movingPane
        ? "Move pane here"
        : "Split into a new pane"
      : isTab && !sourcePane
        ? "Cannot identify the dragged tab"
        : movingPane
          ? "Pane is already at this position"
          : "Cannot create this split";
    return {
      insertIndex,
      label,
      operation: movingPane ? "move-pane" : "split",
      side: operationTarget.side,
      targetPaneId: operationTarget.paneId,
      valid,
    };
  };

  useLayoutEffect(() => {
    const grid = paneGridRef.current;
    if (!grid) return;
    const positionOuterTargets = () => {
      const bounds = grid.getBoundingClientRect();
      const start = grid.querySelector<HTMLElement>(".pane-workspace-split-target-start");
      const end = grid.querySelector<HTMLElement>(".pane-workspace-split-target-end");
      if (start)
        Object.assign(start.style, { height: `${bounds.height}px`, left: `${bounds.left}px`, top: `${bounds.top}px` });
      if (end)
        Object.assign(end.style, { height: `${bounds.height}px`, left: `${bounds.right}px`, top: `${bounds.top}px` });
    };
    positionOuterTargets();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(positionOuterTargets);
    observer?.observe(grid);
    window.addEventListener("resize", positionOuterTargets);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", positionOuterTargets);
    };
  }, [panes.length]);

  return (
    <div className="pane-workspace" ref={paneGridRef}>
      <WorkspaceSplitTarget
        className="pane-workspace-split-target-edge pane-workspace-split-target-start"
        insertIndex={0}
        resolve={resolveSplitIntent}
        onHover={onPaneDragOver}
        onDrop={(event, intent) => void onPaneSplitDrop(event, intent.targetPaneId, intent.side)}
      />
      {panes.map((pane, index) => (
        <Fragment key={pane.id}>
          <WorkspacePane
            isActive={pane.id === activePaneId}
            isFirst={index === 0}
            isLast={index === panes.length - 1}
            isOnly={panes.length === 1}
            pane={pane}
            renderEmptyPaneContent={renderEmptyPaneContent}
            renderEmptyPaneHeader={renderEmptyPaneHeader}
            resolveWorkspaceItem={resolveWorkspaceItem}
            tabBarEndContent={tabBarEndContent}
            tabBarStartContent={tabBarStartContent}
            views={views}
            workspace={workspace}
          />
          {index < panes.length - 1 ? (
            <div className="pane-resize-divider" role="separator" aria-orientation="vertical">
              <div
                className="pane-resize-handle"
                onMouseDown={(event) => handlePaneResizeStart(event, pane.id, panes[index + 1].id)}
              />
              <WorkspaceSplitTarget
                className="pane-workspace-split-target-internal"
                insertIndex={index + 1}
                resolve={resolveSplitIntent}
                onHover={onPaneDragOver}
                onDrop={(event, intent) => void onPaneSplitDrop(event, intent.targetPaneId, intent.side)}
              />
            </div>
          ) : null}
        </Fragment>
      ))}
      <WorkspaceSplitTarget
        className="pane-workspace-split-target-edge pane-workspace-split-target-end"
        insertIndex={panes.length}
        resolve={resolveSplitIntent}
        onHover={onPaneDragOver}
        onDrop={(event, intent) => void onPaneSplitDrop(event, intent.targetPaneId, intent.side)}
      />
    </div>
  );
};
