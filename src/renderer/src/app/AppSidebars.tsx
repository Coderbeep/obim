import { IconGitBranch } from "@renderer/shared/icons/IconGitBranch";
import "./LeftSidebarExperiment.css";
import { IconTaskBoard } from "@renderer/shared/icons/IconTaskBoard";
import { IconFolders, IconSidebarLeft, IconSidebarLeftOpen } from "@pierre/icons";
import { useAtomValue } from "jotai";
import { ComponentProps, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { usePaneTabActivation } from "@renderer/features/workspace/usePaneWorkspace";
import { SourceControlView } from "@renderer/features/git/SourceControlView";
import { cn } from "@renderer/shared/classNames";
import { Button } from "@renderer/shared/ui/button";
import { versionHistoryOpenRequestAtom } from "@renderer/store/appSessionStore";
import { currentWorkspaceItemAtom, openWorkspaceItemsByKeyAtom } from "@renderer/store/workspaceResourceStore";
import {
  createTaskBoardWorkspaceItem,
  isTaskBoardWorkspaceItem,
} from "@shared/workspace";

import { SidebarResizer } from "./SidebarResizer";
import { SettingsDialog } from "./SettingsDialog";
import { useSidebarPlacement } from "./sidebarPlacement";
import {
  EXPLORER_LAYOUT_STORAGE_KEY,
  INSPECTOR_LAYOUT_STORAGE_KEY,
  readSidebarLayoutPreference,
  RESET_LAYOUT_EVENT,
  writeSidebarLayoutPreference,
} from "./layoutPreferences";

const DEFAULT_EXPLORER_WIDTH = 300;
const DEFAULT_INSPECTOR_WIDTH = 320;
const COLLAPSE_SIDEBAR_THRESHOLD = 220;
const MAX_SIDEBAR_WIDTH = 520;
const INSPECTOR_AUTO_COLLAPSE_WIDTH = 960;

interface ResizableSidebar {
  collapseSidebar: () => void;
  expandSidebar: () => void;
  handleResizeEnd: (width: number) => void;
  handleResizeStart: () => void;
  handleWidthChange: (width: number) => void;
  isSidebarCollapsed: boolean;
  isSidebarResizing: boolean;
  resetSidebar: () => void;
  toggleSidebar: () => void;
  visibleWidth: number;
}

const clampWidth = (width: number) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(0, width));

const useResizableSidebar = (defaultWidth: number, storageKey: string): ResizableSidebar => {
  const [initialPreference] = useState(() => readSidebarLayoutPreference(storageKey, defaultWidth, MAX_SIDEBAR_WIDTH));
  const [width, setWidth] = useState(initialPreference.width);
  const [lastExpandedWidth, setLastExpandedWidth] = useState(initialPreference.lastExpandedWidth);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(initialPreference.collapsed);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const widthRef = useRef(width);

  useEffect(() => {
    widthRef.current = width;
    writeSidebarLayoutPreference(storageKey, { collapsed: isSidebarCollapsed, lastExpandedWidth, width });
  }, [isSidebarCollapsed, lastExpandedWidth, storageKey, width]);

  const collapseSidebar = useCallback(() => {
    if (widthRef.current > COLLAPSE_SIDEBAR_THRESHOLD) setLastExpandedWidth(widthRef.current);
    setIsSidebarCollapsed(true);
  }, []);

  const expandSidebar = useCallback(() => {
    setWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(defaultWidth, lastExpandedWidth)));
    setIsSidebarCollapsed(false);
  }, [defaultWidth, lastExpandedWidth]);

  const toggleSidebar = useCallback(() => {
    if (isSidebarCollapsed) {
      expandSidebar();
    } else {
      collapseSidebar();
    }
  }, [collapseSidebar, expandSidebar, isSidebarCollapsed]);

  const handleWidthChange = useCallback((nextWidth: number) => {
    const clampedWidth = clampWidth(nextWidth);
    setWidth(clampedWidth);
    setIsSidebarCollapsed(clampedWidth === 0);

    if (clampedWidth > COLLAPSE_SIDEBAR_THRESHOLD) {
      setLastExpandedWidth(clampedWidth);
    }
  }, []);

  const handleResizeEnd = useCallback((finalWidth: number) => {
    const clampedWidth = clampWidth(finalWidth);
    setIsSidebarResizing(false);
    setWidth(clampedWidth);

    if (clampedWidth <= COLLAPSE_SIDEBAR_THRESHOLD) {
      setIsSidebarCollapsed(true);
      return;
    }

    setLastExpandedWidth(clampedWidth);
    setIsSidebarCollapsed(false);
  }, []);

  const handleResizeStart = useCallback(() => setIsSidebarResizing(true), []);

  const resetSidebar = useCallback(() => {
    setWidth(defaultWidth);
    setLastExpandedWidth(defaultWidth);
    setIsSidebarCollapsed(false);
  }, [defaultWidth]);

  useEffect(() => {
    const reset = () => resetSidebar();
    window.addEventListener(RESET_LAYOUT_EVENT, reset);
    return () => window.removeEventListener(RESET_LAYOUT_EVENT, reset);
  }, [resetSidebar]);

  return {
    collapseSidebar,
    expandSidebar,
    handleResizeEnd,
    handleResizeStart,
    handleWidthChange,
    isSidebarCollapsed,
    isSidebarResizing,
    resetSidebar,
    toggleSidebar,
    visibleWidth: isSidebarCollapsed ? 0 : width,
  };
};

interface InspectorSidebarControls {
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const InspectorSidebarContext = createContext<ResizableSidebar | null>(null);

export const useInspectorSidebarControls = (): InspectorSidebarControls => {
  const context = useContext(InspectorSidebarContext);
  if (!context) {
    throw new Error("useInspectorSidebarControls must be used within InspectorSidebarProvider");
  }

  return {
    isSidebarCollapsed: context.isSidebarCollapsed,
    toggleSidebar: context.toggleSidebar,
  };
};

export const LeftSidebar = ({ className, children, style, ...props }: ComponentProps<"div">) => {
  const { activateResource } = usePaneTabActivation();
  const sidebar = useResizableSidebar(DEFAULT_EXPLORER_WIDTH, EXPLORER_LAYOUT_STORAGE_KEY);
  const placement = useSidebarPlacement();
  const isExplorerOnRight = placement === "explorer-right";
  const currentWorkspaceItem = useAtomValue(currentWorkspaceItemAtom);
  const openWorkspaceItemsByKey = useAtomValue(openWorkspaceItemsByKeyAtom);
  const taskBoardOpen = Object.values(openWorkspaceItemsByKey).some(isTaskBoardWorkspaceItem);
  const taskBoardActive = isTaskBoardWorkspaceItem(currentWorkspaceItem);
  const versionHistoryOpenRequest = useAtomValue(versionHistoryOpenRequestAtom);
  const [activeView, setActiveView] = useState<"files" | "source-control">("files");
  const [sourceControlMounted, setSourceControlMounted] = useState(false);
  const handledVersionHistoryOpenRequest = useRef(versionHistoryOpenRequest);

  const showView = useCallback(
    (view: "files" | "source-control") => {
      if (view === "source-control") setSourceControlMounted(true);
      setActiveView(view);
      sidebar.expandSidebar();
    },
    [sidebar.expandSidebar],
  );

  useEffect(() => {
    if (versionHistoryOpenRequest === handledVersionHistoryOpenRequest.current) return;
    handledVersionHistoryOpenRequest.current = versionHistoryOpenRequest;
    showView("source-control");
  }, [showView, versionHistoryOpenRequest]);

  const activateTodoList = useCallback(() => {
    const resource = createTaskBoardWorkspaceItem();
    activateResource(resource.key, { item: resource });
  }, [activateResource]);

  const shellStyle = {
    ...style,
    width: sidebar.isSidebarCollapsed
      ? "var(--sidebar-action-rail-width)"
      : `calc(${sidebar.visibleWidth}px + var(--sidebar-action-rail-width))`,
  } satisfies CSSProperties;

  return (
    <div
      className={cn("sidebar-shell sidebar-soft-experiment", className)}
      data-side={isExplorerOnRight ? "right" : "left"}
      style={shellStyle}
      {...props}
    >
      <div className="sidebar-actions-pane bg-sidebar">
        <div className="sidebar-actions-group">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="motion-panel-toggle"
            onClick={sidebar.toggleSidebar}
            aria-label={sidebar.isSidebarCollapsed ? "Expand left sidebar" : "Collapse left sidebar"}
            title={sidebar.isSidebarCollapsed ? "Expand left sidebar" : "Collapse left sidebar"}
          >
            <span className={cn("inline-flex", isExplorerOnRight && "-scale-x-100")}>
              {sidebar.isSidebarCollapsed ? <IconSidebarLeftOpen size={16} /> : <IconSidebarLeft size={16} />}
            </span>
          </Button>
          <span className="sidebar-actions-separator" aria-hidden="true" />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="sidebar-view-button"
            onClick={() => showView("files")}
            aria-label="Files"
            aria-pressed={activeView === "files"}
            title="Files sidebar"
          >
            <IconFolders size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="sidebar-view-button"
            onClick={() => showView("source-control")}
            aria-label="Version History"
            aria-pressed={activeView === "source-control"}
            title="Version History"
          >
            <IconGitBranch size={16} />
          </Button>
        </div>
        <div className="sidebar-actions-group sidebar-workspace-actions-group">
          <span className="sidebar-workspace-group-label" aria-hidden="true">
            Apps
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="sidebar-workspace-launcher"
            onClick={activateTodoList}
            aria-label={taskBoardOpen ? "Show Task Board in workspace" : "Open Task Board in workspace"}
            aria-current={taskBoardActive ? "page" : undefined}
            title={taskBoardOpen ? "Show Task Board in workspace" : "Open Task Board in workspace"}
          >
            <IconTaskBoard size={16} />
            {taskBoardOpen ? (
              <span className="sidebar-workspace-open-indicator" data-current={taskBoardActive} aria-hidden="true" />
            ) : null}
          </Button>
        </div>
        <div className="sidebar-actions-group mt-auto">
          <span className="sidebar-actions-separator" aria-hidden="true" />
          <SettingsDialog />
        </div>
      </div>
      <div
        className={cn("sidebar-inner", sidebar.isSidebarCollapsed && "sidebar-inner-collapsed")}
        aria-hidden={sidebar.isSidebarCollapsed}
        inert={sidebar.isSidebarCollapsed}
      >
        <div
          className="sidebar-view-content"
          aria-hidden={activeView !== "files"}
          hidden={activeView !== "files"}
          inert={activeView !== "files"}
        >
          {children}
        </div>
        {sourceControlMounted ? (
          <div
            className="sidebar-view-content"
            aria-hidden={activeView !== "source-control"}
            hidden={activeView !== "source-control"}
            inert={activeView !== "source-control"}
          >
            <SourceControlView />
          </div>
        ) : null}
      </div>
      {(!sidebar.isSidebarCollapsed || sidebar.isSidebarResizing) && (
        <SidebarResizer
          aria-label="Resize left sidebar"
          edge={isExplorerOnRight ? "left" : "right"}
          width={sidebar.visibleWidth}
          maxWidth={MAX_SIDEBAR_WIDTH}
          onWidthChange={sidebar.handleWidthChange}
          onResizeStart={sidebar.handleResizeStart}
          onResizeEnd={sidebar.handleResizeEnd}
          onReset={sidebar.resetSidebar}
        />
      )}
    </div>
  );
};

export const InspectorSidebarProvider = ({ children }: { children: ReactNode }) => {
  const sidebar = useResizableSidebar(DEFAULT_INSPECTOR_WIDTH, INSPECTOR_LAYOUT_STORAGE_KEY);
  const autoCollapsedRef = useRef(false);
  const sidebarRef = useRef(sidebar);

  useEffect(() => {
    sidebarRef.current = sidebar;
  });

  useEffect(() => {
    let previousNarrow: boolean | undefined;
    const syncResponsiveState = () => {
      const isNarrow = window.innerWidth < INSPECTOR_AUTO_COLLAPSE_WIDTH;
      // Only react to crossing the breakpoint. Manual opening and dragging within
      // a narrow window must not trigger another automatic collapse.
      if (isNarrow === previousNarrow) return;
      previousNarrow = isNarrow;
      const current = sidebarRef.current;
      if (isNarrow && !current.isSidebarCollapsed) {
        autoCollapsedRef.current = true;
        current.collapseSidebar();
      } else if (!isNarrow && autoCollapsedRef.current) {
        autoCollapsedRef.current = false;
        current.expandSidebar();
      }
    };

    syncResponsiveState();
    window.addEventListener("resize", syncResponsiveState);
    return () => window.removeEventListener("resize", syncResponsiveState);
  }, []);

  return <InspectorSidebarContext.Provider value={sidebar}>{children}</InspectorSidebarContext.Provider>;
};

export const InspectorSidebar = ({ className, children, style, ...props }: ComponentProps<"aside">) => {
  const sidebar = useContext(InspectorSidebarContext);
  const placement = useSidebarPlacement();
  if (!sidebar) {
    throw new Error("InspectorSidebar must be used within InspectorSidebarProvider");
  }

  return (
    <aside
      className={cn("right-sidebar-shell", className)}
      data-collapsed={sidebar.isSidebarCollapsed ? "true" : undefined}
      data-side={placement === "explorer-right" ? "left" : "right"}
      style={{ ...style, width: `${sidebar.visibleWidth}px` }}
      {...props}
    >
      {(!sidebar.isSidebarCollapsed || sidebar.isSidebarResizing) && (
        <SidebarResizer
          aria-label="Resize file inspector"
          edge={placement === "explorer-right" ? "right" : "left"}
          width={sidebar.visibleWidth}
          maxWidth={MAX_SIDEBAR_WIDTH}
          onWidthChange={sidebar.handleWidthChange}
          onResizeStart={sidebar.handleResizeStart}
          onResizeEnd={sidebar.handleResizeEnd}
          onReset={sidebar.resetSidebar}
        />
      )}
      <div
        className={cn(
          "right-sidebar-inner flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none border border-[var(--border-panel)] bg-sidebar",
          sidebar.isSidebarCollapsed && "right-sidebar-inner-collapsed",
        )}
        aria-hidden={sidebar.isSidebarCollapsed}
        inert={sidebar.isSidebarCollapsed}
      >
        {children}
      </div>
    </aside>
  );
};
