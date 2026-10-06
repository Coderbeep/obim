import { IconCheck, IconChevron, IconClockArrow, IconFileText, IconX } from "@pierre/icons";
import { useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";

import { getFileGlyph } from "@renderer/shared/icons/FileGlyphs";
import { useFileSavePresentation } from "@renderer/features/files/FileSaveStatus";
import type { ContextMenuEntry } from "@renderer/shared/contextMenu";
import { VerticalInsertionLine } from "@renderer/shared/dnd/DropIndicator";
import { getHorizontalInsertIndex } from "@renderer/shared/dnd/geometry";
import { useAppDropZone } from "@renderer/shared/dnd/useAppDropZone";
import { useAppDraggable } from "@renderer/shared/dnd/useAppDraggable";
import type { WorkspacePaneState } from "@renderer/store/editorPaneStore";
import type { WorkspaceTabState } from "@renderer/store/editorTabStore";
import { openContextMenuAtom } from "@renderer/store/contextMenuStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@renderer/shared/ui/dropdown-menu";
import { isFileWorkspaceItem, type WorkspaceItem } from "@shared/workspace";

import type { WorkspaceItemResolver } from "./workspaceItemOperations";
import {
  getWorkspaceItemTitle,
  getWorkspaceItemView,
  type WorkspaceItemView,
  type WorkspaceItemViewMap,
} from "./workspaceItemView";
import { isTaskBoardWorkspaceItem } from "@shared/workspace";

interface PaneTabsProps {
  activateTab: (paneId: string, tabId: string) => void;
  closeTab: (paneId: string, tabId: string) => void;
  closeOtherTabs: (paneId: string, keepTabId: string) => void;
  canReopenClosedTab: boolean;
  isActive: boolean;
  movePane: (paneId: string, direction: "left" | "right") => boolean;
  moveTab: (sourcePaneId: string, targetPaneId: string, tabId: string, targetIndex?: number) => void;
  moveTabToNewPane: (sourcePaneId: string, targetPaneId: string, tabId: string, side: "left" | "right") => boolean;
  tabBarEndContent?: ReactNode;
  tabBarStartContent?: ReactNode;
  onPaneDragOver: (event: DragEvent<HTMLElement>) => void;
  onPaneDrop: (event: DragEvent<HTMLElement>, paneId: string, targetIndex?: number) => void;
  onTabDragStart: (event: DragEvent<HTMLElement>, paneId: string, tabId: string) => void;
  openWorkspaceItemsByKey: Record<string, WorkspaceItem>;
  pane: WorkspacePaneState;
  panes: WorkspacePaneState[];
  reopenLastClosedTab: () => void;
  resolveWorkspaceItem: WorkspaceItemResolver;
  tabsById: Record<string, WorkspaceTabState>;
  views: WorkspaceItemViewMap;
}

interface PaneTabProps {
  activateTab: (paneId: string, tabId: string) => void;
  closeTab: (paneId: string, tabId: string) => void;
  menuEntries: ContextMenuEntry[];
  dragInsertIndex: number | null;
  freezeTabWidths: (target: HTMLElement, pointer: { x: number; y: number }) => void;
  index: number;
  isActive: boolean;
  item: WorkspaceItem | null;
  onTabDragStart: (event: DragEvent<HTMLElement>, paneId: string, tabId: string) => void;
  paneId: string;
  pinnedApp?: boolean;
  showEndMarker: boolean;
  tabCount: number;
  tabId: string;
  title: string;
  view: WorkspaceItemView | null;
}

const PaneTab = ({
  activateTab,
  closeTab,
  menuEntries,
  dragInsertIndex,
  freezeTabWidths,
  index,
  isActive,
  item,
  onTabDragStart,
  paneId,
  pinnedApp = false,
  showEndMarker,
  tabCount,
  tabId,
  title,
  view,
}: PaneTabProps) => {
  const openContextMenu = useSetAtom(openContextMenuAtom);
  const savePresentation = useFileSavePresentation(isFileWorkspaceItem(item) ? item.file.path : null);
  const TabIcon = item ? view?.getTabIcon?.(item) : null;
  const showBeforeSeparator = index > 0;
  const dragProps = useAppDraggable<HTMLButtonElement>({
    entity: { kind: "workspace-tab", id: tabId, sourcePaneId: paneId },
    preview: { icon: item ? view?.getDragIcon?.(item) : undefined, text: title },
    onDragStart: (event) => onTabDragStart(event, paneId, tabId),
  });

  return (
    <div
      className={`pane-tab${pinnedApp ? " pane-tab-app" : ""} ${isActive ? "pane-tab-active" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu({
          key: `workspace-tab:${paneId}:${tabId}`,
          anchor: event.currentTarget,
          position: { x: event.clientX, y: event.clientY },
          entries: menuEntries,
        });
      }}
      data-tab-id={tabId}
      data-tab-index={index}
    >
      {!pinnedApp ? (
        <>
          <span
            className={`pane-tab-separator pane-tab-separator-before ${
              showBeforeSeparator ? "" : "pane-tab-separator-hidden"
            }`}
            aria-hidden="true"
          />
          <VerticalInsertionLine side="before" active={dragInsertIndex === index} />
          {showEndMarker ? <VerticalInsertionLine side="after" active={dragInsertIndex === tabCount} /> : null}
        </>
      ) : null}
      <button
        type="button"
        className="pane-tab-label"
        {...(!pinnedApp ? { "data-app-drag-handle": true, ...dragProps } : {})}
        title={
          pinnedApp
            ? title
            : `${title}${savePresentation ? ` — ${savePresentation.label}` : ""} — drag to reorder or move`
        }
        aria-label={`${title}${savePresentation ? `, ${savePresentation.label}` : ""}`}
        aria-selected={isActive}
        role="tab"
        tabIndex={isActive ? 0 : -1}
        onPointerDown={(event) => {
          if (event.button > 0) return;
          activateTab(paneId, tabId);
        }}
        onClick={(event) => {
          if (event.detail === 0) activateTab(paneId, tabId);
        }}
        onMouseUp={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          if (!pinnedApp) freezeTabWidths(event.currentTarget, { x: event.clientX, y: event.clientY });
          closeTab(paneId, tabId);
        }}
      >
        <span className="pane-title-with-icon">
          {TabIcon ? <TabIcon size={pinnedApp ? 16 : 14} /> : null}
          {!pinnedApp ? <span className="pane-tab-title">{title}</span> : null}
          {savePresentation && savePresentation.phase !== "saved" ? (
            <span className="pane-tab-save-indicator" data-save-phase={savePresentation.phase} aria-hidden="true" />
          ) : null}
        </span>
      </button>
      {!pinnedApp ? (
        <button
          type="button"
          className="pane-tab-close"
          onClick={(event) => {
            event.stopPropagation();
            freezeTabWidths(event.currentTarget, { x: event.clientX, y: event.clientY });
            closeTab(paneId, tabId);
          }}
          aria-label={`Close ${title}`}
        >
          <IconX size={14} />
        </button>
      ) : null}
    </div>
  );
};

/** Renders a pane's tab bar and manages its local insertion and close-button layout state. */
export const PaneTabs = ({
  activateTab,
  closeTab,
  closeOtherTabs,
  canReopenClosedTab,
  isActive,
  onTabDragStart,
  openWorkspaceItemsByKey,
  pane,
  panes,
  reopenLastClosedTab,
  onPaneDragOver,
  onPaneDrop,
  resolveWorkspaceItem,
  tabBarEndContent,
  tabBarStartContent,
  tabsById,
  views,
}: PaneTabsProps) => {
  const [frozenTabWidth, setFrozenTabWidth] = useState<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const clearFreeze = () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    setFrozenTabWidth(null);
  };
  const pointerIsOverTab = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y);
    return Boolean(
      rowRef.current && element instanceof Element && rowRef.current.contains(element) && element.closest(".pane-tab"),
    );
  };
  const freezeTabWidths = (target: HTMLElement, pointer: { x: number; y: number }) => {
    const width = Math.round(target.closest<HTMLElement>(".pane-tab")?.getBoundingClientRect().width ?? 0);
    if (width > 0) setFrozenTabWidth(width);
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      if (!pointerIsOverTab(pointer.x, pointer.y)) clearFreeze();
    });
  };

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  useEffect(() => {
    rowRef.current?.querySelector<HTMLElement>(".pane-tab-active")?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [pane.activeTabId, pane.tabs.length]);

  const paneIndex = panes.findIndex((candidate) => candidate.id === pane.id);
  const entriesForTab = (tabId: string, item: WorkspaceItem | null, view: WorkspaceItemView | null) => {
    const entries: ContextMenuEntry[] = [
      { kind: "action", id: "close-tab", label: "Close tab", icon: IconX, onSelect: () => closeTab(pane.id, tabId) },
    ];
    const itemEntries =
      item && view?.getTabMenuEntries
        ? view
            .getTabMenuEntries(item, { paneId: pane.id, tabId })
            .filter((entry) => entry.kind === "action" && entry.icon)
        : [];
    return itemEntries.length ? [...entries, { kind: "separator" as const }, ...itemEntries] : entries;
  };
  const resolvedTabs = pane.tabs.flatMap((tabId, index) => {
    const workspaceItemKey = tabsById[tabId]?.currentResourceKey;
    if (!workspaceItemKey) return [];
    const item = resolveWorkspaceItem(workspaceItemKey, openWorkspaceItemsByKey);
    const view = getWorkspaceItemView(views, item);
    return [{ index, item, tabId, title: getWorkspaceItemTitle(views, item, workspaceItemKey), view }];
  });
  const pinnedAppTabs = resolvedTabs.filter(({ item }) => isTaskBoardWorkspaceItem(item));
  const documentTabs = resolvedTabs.filter(({ item }) => !isTaskBoardWorkspaceItem(item));
  const tabZone = useAppDropZone<HTMLDivElement, number>({
    accepts: (entity) => entity.kind === "workspace-tab",
    resolve: (event) => {
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>(".pane-tab")];
      const localIndex = getHorizontalInsertIndex(items, event.clientX);
      const index = documentTabs[localIndex]?.index ?? pane.tabs.length;
      return {
        key: `workspace-tab:${pane.id}:${index}`,
        valid: true,
        label: `pane tab position ${index + 1}`,
        operation: index,
      };
    },
    onHover: onPaneDragOver,
    onDrop: (event, index) => onPaneDrop(event, pane.id, index),
  });
  const renderTab = ({ index, item, tabId, title, view }: (typeof resolvedTabs)[number], pinnedApp = false) => (
    <PaneTab
      key={tabId}
      activateTab={activateTab}
      closeTab={closeTab}
      menuEntries={entriesForTab(tabId, item, view)}
      dragInsertIndex={tabZone.intent}
      freezeTabWidths={freezeTabWidths}
      index={index}
      isActive={pane.activeTabId === tabId}
      item={item}
      onTabDragStart={onTabDragStart}
      paneId={pane.id}
      pinnedApp={pinnedApp}
      showEndMarker={!pinnedApp && documentTabs[documentTabs.length - 1]?.tabId === tabId}
      tabCount={pane.tabs.length}
      tabId={tabId}
      title={title}
      view={view}
    />
  );

  return (
    <div
      className={`pane-tabs-group ${isActive ? "pane-tabs-group-active" : ""}`}
      onDragOver={onPaneDragOver}
      onDrop={(event) => {
        onPaneDrop(event, pane.id);
      }}
    >
      {tabBarStartContent ? <div className="pane-tabs-start">{tabBarStartContent}</div> : null}
      <div role="tablist" aria-label={`Pane ${paneIndex + 1} tabs`} className="pane-tabs-tablist">
        {pinnedAppTabs.length ? (
          <div className="pane-tabs-apps">{pinnedAppTabs.map((tab) => renderTab(tab, true))}</div>
        ) : null}
        <div
          ref={rowRef}
          className={`pane-tabs-row ${frozenTabWidth ? "pane-tabs-row-freeze" : ""}`}
          style={frozenTabWidth ? ({ "--pane-tab-frozen-width": `${frozenTabWidth}px` } as CSSProperties) : undefined}
          {...tabZone.handlers}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && event.currentTarget.contains(next)) return;
            clearFreeze();
          }}
          onMouseMove={(event) => {
            if (frozenTabWidth && !pointerIsOverTab(event.clientX, event.clientY)) clearFreeze();
          }}
          onMouseLeave={() => {
            tabZone.clearHover();
            clearFreeze();
          }}
          onWheel={(event) => {
            if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            event.preventDefault();
            event.currentTarget.scrollLeft += event.deltaY;
          }}
        >
          {pane.tabs.length === 0 ? <div className="pane-empty-tabs">No open tabs</div> : null}
          {documentTabs.length === 0 ? (
            <VerticalInsertionLine side="before" active={tabZone.intent === pane.tabs.length} />
          ) : null}
          {documentTabs.map((tab) => renderTab(tab))}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="pane-tabs-overflow"
            aria-label="Show all tabs and tab actions"
            title="All tabs"
          >
            <IconChevron size={12} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-1rem)]">
          <DropdownMenuLabel className="text-ui-meta font-medium text-muted-foreground">Open tabs</DropdownMenuLabel>
          {pane.tabs.map((tabId) => {
            const key = tabsById[tabId]?.currentResourceKey;
            const item = key ? resolveWorkspaceItem(key, openWorkspaceItemsByKey) : null;
            const title = getWorkspaceItemTitle(views, item, key);
            const view = getWorkspaceItemView(views, item);
            const TabIcon = item ? view?.getTabIcon?.(item) : null;
            return (
              <DropdownMenuItem
                key={tabId}
                className="text-ui-item"
                aria-current={pane.activeTabId === tabId ? "page" : undefined}
                onSelect={() => activateTab(pane.id, tabId)}
              >
                <span
                  className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
                  aria-hidden="true"
                >
                  {TabIcon ? (
                    <TabIcon size={16} />
                  ) : isFileWorkspaceItem(item) ? (
                    getFileGlyph(item.file.path)
                  ) : (
                    <IconFileText size={16} />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate" title={title}>
                  {title}
                </span>
                {pane.activeTabId === tabId ? (
                  <IconCheck size={14} className="text-muted-foreground" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-ui-item" disabled={!canReopenClosedTab} onSelect={reopenLastClosedTab}>
            <IconClockArrow size={16} className="text-muted-foreground" aria-hidden="true" />
            Reopen closed tab
            <DropdownMenuShortcut aria-hidden="true">
              {window.config?.isMacOS ? "⌘⇧T" : "Ctrl+Shift+T"}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          {pane.activeTabId && pane.tabs.length > 1 ? (
            <DropdownMenuItem className="text-ui-item" onSelect={() => closeOtherTabs(pane.id, pane.activeTabId!)}>
              <IconX size={16} className="text-muted-foreground" aria-hidden="true" />
              Close other tabs
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {tabBarEndContent ? <div className="pane-tabs-end">{tabBarEndContent}</div> : null}
    </div>
  );
};
