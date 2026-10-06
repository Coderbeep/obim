import "./WidgetSurfaces.css";
import { Children, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";

import { cn } from "@renderer/shared/classNames";
import { VerticalInsertionLine, SplitDropIndicator, WidgetSplitSlot } from "@renderer/shared/dnd/DropIndicator";
import { getHorizontalInsertIndex } from "@renderer/shared/dnd/geometry";
import { useAppDropZone } from "@renderer/shared/dnd/useAppDropZone";
import { useAppDraggable } from "@renderer/shared/dnd/useAppDraggable";
import type { IconComponent } from "@renderer/shared/icons/types";
import type { WorkspacePaneState } from "@renderer/store/editorPaneStore";
import { moveWorkspaceTab, splitWorkspaceTab } from "@renderer/store/workspaceTransitions";
import { WIDGET_TAB_DRAG_DATA_MIME } from "@shared/drag-data";

export interface RightSidebarWidgetProps {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  icon: IconComponent;
  id: string;
  tabTitle?: string;
  title: string;
}

const WIDGET_LAYOUT_VERSION = 1;
let nextWidgetPaneId = 0;

type WidgetElement = ReactElement<RightSidebarWidgetProps>;
type WidgetContentDropIntent = "above" | "below";
type WidgetFieldDropOperation = "move-field" | "split";
type WidgetDragData = { paneId: string; widgetId: string };
type WidgetDragPreview = WidgetDragData;
type WidgetContentDropTarget = { intent: WidgetContentDropIntent; operation: WidgetFieldDropOperation; paneId: string };

const widgetLayoutStorageKey = (autoSaveId: string) => `${autoSaveId}:dock-layout:${WIDGET_LAYOUT_VERSION}`;
const createWidgetPaneId = () => `widget-pane-${Date.now()}-${nextWidgetPaneId++}`;
const defaultWidgetPaneId = (autoSaveId: string) => `${autoSaveId}-pane-1`;

const normalizeWidgetPanes = (
  value: unknown,
  widgetIds: readonly string[],
  autoSaveId: string,
): WorkspacePaneState[] => {
  if (!widgetIds.length) return [];

  const available = new Set(widgetIds);
  const used = new Set<string>();
  const input = Array.isArray(value) ? value : [];
  const panes = input.flatMap((candidate): WorkspacePaneState[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const pane = candidate as Partial<WorkspacePaneState>;
    if (typeof pane.id !== "string" || !Array.isArray(pane.tabs)) return [];
    const tabs = pane.tabs.filter((id): id is string => {
      if (typeof id !== "string" || !available.has(id) || used.has(id)) return false;
      used.add(id);
      return true;
    });
    if (!tabs.length) return [];
    return [
      {
        id: pane.id,
        tabs,
        activeTabId:
          typeof pane.activeTabId === "string" && tabs.includes(pane.activeTabId) ? pane.activeTabId : tabs[0],
        size: typeof pane.size === "number" && pane.size > 0 ? pane.size : 1,
      },
    ];
  });

  const missing = widgetIds.filter((id) => !used.has(id));
  if (!panes.length) {
    return [{ id: defaultWidgetPaneId(autoSaveId), tabs: [...widgetIds], activeTabId: widgetIds[0], size: 1 }];
  }
  if (missing.length) panes[0] = { ...panes[0], tabs: [...panes[0].tabs, ...missing] };
  return panes;
};

const loadWidgetPanes = (autoSaveId: string, widgetIds: readonly string[]) => {
  try {
    const saved = window.localStorage.getItem(widgetLayoutStorageKey(autoSaveId));
    return normalizeWidgetPanes(saved ? JSON.parse(saved) : null, widgetIds, autoSaveId);
  } catch {
    return normalizeWidgetPanes(null, widgetIds, autoSaveId);
  }
};

const getWidgetContentDropIntent = (bounds: DOMRect, pointerY: number): WidgetContentDropIntent | null =>
  pointerY >= bounds.bottom - Math.min(48, bounds.height / 3) ? "below" : null;

/** Returns the operation produced by placing a widget at a field boundary. */
const getWidgetFieldDropOperation = (
  panes: readonly WorkspacePaneState[],
  drag: WidgetDragData,
  boundaryIndex: number,
): WidgetFieldDropOperation | null => {
  const sourceIndex = panes.findIndex((pane) => pane.id === drag.paneId && pane.tabs.includes(drag.widgetId));
  if (sourceIndex < 0) return null;
  if (panes[sourceIndex].tabs.length > 1) return "split";
  return boundaryIndex !== sourceIndex && boundaryIndex !== sourceIndex + 1 ? "move-field" : null;
};

/** Places a widget at the displayed boundary without adjacent-field swapping. */
const placeWidgetAtBoundary = (panes: WorkspacePaneState[], drag: WidgetDragData, boundaryIndex: number) => {
  if (!getWidgetFieldDropOperation(panes, drag, boundaryIndex)) return panes;
  const sourceIndex = panes.findIndex((pane) => pane.id === drag.paneId);
  const source = panes[sourceIndex];
  if (source.tabs.length === 1) {
    const remaining = panes.filter((pane) => pane.id !== source.id);
    const insertIndex = boundaryIndex > sourceIndex ? boundaryIndex - 1 : boundaryIndex;
    return [...remaining.slice(0, insertIndex), source, ...remaining.slice(insertIndex)];
  }
  const target = panes[Math.min(boundaryIndex, panes.length - 1)];
  return splitWorkspaceTab(
    panes,
    drag.paneId,
    target.id,
    drag.widgetId,
    boundaryIndex >= panes.length ? "right" : "left",
    createWidgetPaneId(),
  );
};

export const RightSidebarWidget = (props: RightSidebarWidgetProps) => {
  const { children, className, contentClassName, id, title } = props;
  return (
    <section className={cn("flex h-full min-h-0 min-w-0 flex-col", className)} data-widget-id={id} aria-label={title}>
      <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto px-3 pb-3 pt-2", contentClassName)}>{children}</div>
    </section>
  );
};

const WidgetTab = ({
  active,
  dragInsertIndex,
  index,
  onDragFinish,
  paneId,
  setDragPreview,
  setPanes,
  tabCount,
  widget,
}: {
  active: boolean;
  dragInsertIndex: number | null;
  index: number;
  onDragFinish(): void;
  paneId: string;
  setDragPreview(preview: WidgetDragPreview | null): void;
  setPanes: React.Dispatch<React.SetStateAction<WorkspacePaneState[]>>;
  tabCount: number;
  widget: WidgetElement;
}) => {
  const { icon: Icon, id, tabTitle, title } = widget.props;
  const label = tabTitle ?? title;
  const tabId = `${paneId}-${id}-tab`;
  const panelId = `${paneId}-${id}-panel`;
  const activate = () =>
    setPanes((current) => current.map((pane) => (pane.id === paneId ? { ...pane, activeTabId: id } : pane)));
  const dragProps = useAppDraggable<HTMLButtonElement>({
    entity: { kind: "widget-tab", id, sourcePaneId: paneId },
    preview: { icon: <Icon size={14} />, text: title, subtext: "Drop in a tab bar or between fields" },
    onCancel: onDragFinish,
    onDragEnd: onDragFinish,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(WIDGET_TAB_DRAG_DATA_MIME, JSON.stringify({ paneId, widgetId: id }));
      activate();
      setDragPreview({ paneId, widgetId: id });
    },
  });

  return (
    <div
      className={cn(
        "group/widget-tab relative flex h-[31px] w-9 flex-none cursor-grab items-center rounded-none border-r border-b-2 transition-[opacity,background-color,border-color,color] duration-[40ms] motion-reduce:transition-none active:cursor-grabbing",
        active
          ? "border-r-[var(--border-subtle)] border-b-[var(--accent)] bg-[var(--surface-1)] text-foreground"
          : "border-r-[var(--border-subtle)] border-b-transparent text-muted-foreground",
      )}
      data-widget-tab={id}
    >
      <VerticalInsertionLine side="before" active={dragInsertIndex === index} />
      {index === tabCount - 1 ? (
        <VerticalInsertionLine
          side="after"
          active={dragInsertIndex === tabCount}
          data-widget-tab-end-insert-marker
        />
      ) : null}
      <button
        id={tabId}
        type="button"
        role="tab"
        data-app-drag-handle
        {...dragProps}
        aria-label={label}
        aria-controls={panelId}
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        className="flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-none px-2 text-ui-control font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
        title={`${label} — drag to rearrange`}
        onClick={activate}
      >
        <Icon size={15} className="flex-none" aria-hidden="true" />
        <span className="widget-tab-label" aria-hidden="true">
          {label}
        </span>
      </button>
    </div>
  );
};

const WidgetPane = ({
  getFieldDropOperation,
  onDragFinish,
  pane,
  paneIndex,
  setContentDropTarget,
  setDragPreview,
  setPanes,
  widgetById,
}: {
  getFieldDropOperation(drag: WidgetDragData, boundaryIndex: number): WidgetFieldDropOperation | null;
  onDragFinish(): void;
  pane: WorkspacePaneState;
  paneIndex: number;
  setContentDropTarget(target: WidgetContentDropTarget | null): void;
  setDragPreview(preview: WidgetDragPreview | null): void;
  setPanes: React.Dispatch<React.SetStateAction<WorkspacePaneState[]>>;
  widgetById: ReadonlyMap<string, WidgetElement>;
}) => {
  const activeWidget = pane.activeTabId ? widgetById.get(pane.activeTabId) : null;
  const tabZone = useAppDropZone<HTMLDivElement, { drag: WidgetDragData; index: number }>({
    accepts: (entity) => entity.kind === "widget-tab",
    resolve: (event, entity) => {
      if (entity.kind !== "widget-tab") return null;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-widget-tab]")];
      const index = getHorizontalInsertIndex(items, event.clientX);
      return {
        key: `widget-tab:${pane.id}:${index}`,
        valid: true,
        label: `Insert at position ${index + 1}`,
        operation: { drag: { paneId: entity.sourcePaneId, widgetId: entity.id }, index },
      };
    },
    onHover: () => setContentDropTarget(null),
    onDrop: (_event, { drag, index }) => {
      setPanes((current) => moveWorkspaceTab(current, drag.paneId, pane.id, drag.widgetId, index));
      onDragFinish();
    },
  });
  const dragInsertIndex = tabZone.intent?.index ?? null;
  const resolveContentTarget = (
    bounds: DOMRect,
    pointerY: number,
    drag: WidgetDragData | null,
  ): WidgetContentDropTarget | null => {
    if (!drag) return null;
    const intent = getWidgetContentDropIntent(bounds, pointerY);
    if (!intent) return null;
    const operation = getFieldDropOperation(drag, paneIndex + 1);
    return operation ? { paneId: pane.id, intent, operation } : null;
  };
  const contentZone = useAppDropZone<HTMLDivElement, { drag: WidgetDragData; target: WidgetContentDropTarget }>({
    accepts: (entity) => entity.kind === "widget-tab",
    resolve: (event, entity) => {
      if (entity.kind !== "widget-tab") return null;
      const drag = { paneId: entity.sourcePaneId, widgetId: entity.id };
      const target = resolveContentTarget(event.currentTarget.getBoundingClientRect(), event.clientY, drag);
      return target
        ? {
            key: `widget:${target.operation}:${target.paneId}:${target.intent}`,
            valid: true,
            label: target.operation === "move-field" ? "Move field here" : "Place field below",
            operation: { drag, target },
          }
        : null;
    },
    onHover: (_event, { target }) => {
      tabZone.clearHover();
      setContentDropTarget(target);
    },
    onClear: () => setContentDropTarget(null),
    onDrop: (_event, { drag }) => {
      setPanes((current) => placeWidgetAtBoundary(current, drag, paneIndex + 1));
      onDragFinish();
    },
  });

  return (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-none border-0 bg-[var(--surface-1)]"
      data-widget-pane={pane.id}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-8 flex-none items-center gap-0 border-b border-[var(--border-default)] bg-[var(--surface-2)]">
          <div
            role="tablist"
            aria-label={`Widget field ${paneIndex + 1}`}
            className="widget-tab-list flex h-[31px] min-w-0 flex-1 items-center gap-0 overflow-x-auto rounded-none bg-transparent [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onWheel={(event) => {
              if (
                Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
                event.currentTarget.scrollWidth > event.currentTarget.clientWidth
              ) {
                event.preventDefault();
                event.currentTarget.scrollLeft += event.deltaY;
              }
            }}
            {...tabZone.handlers}
          >
            {pane.tabs.map((widgetId, index) => {
              const widget = widgetById.get(widgetId);
              return widget ? (
                <WidgetTab
                  key={widgetId}
                  active={pane.activeTabId === widgetId}
                  dragInsertIndex={dragInsertIndex}
                  index={index}
                  onDragFinish={onDragFinish}
                  paneId={pane.id}
                  setDragPreview={setDragPreview}
                  setPanes={setPanes}
                  tabCount={pane.tabs.length}
                  widget={widget}
                />
              ) : null;
            })}
          </div>
          {activeWidget?.props.actions ? (
            <div className="flex h-full flex-none items-center gap-1 border-l border-[var(--border-subtle)] px-1">
              {activeWidget.props.actions}
            </div>
          ) : null}
        </div>
        <div className="relative min-h-0 min-w-0 flex-1" data-widget-pane-content={pane.id} {...contentZone.handlers}>
          {pane.tabs.map((widgetId) => {
            const widget = widgetById.get(widgetId);
            const active = pane.activeTabId === widgetId;
            return widget ? (
              <div
                key={widgetId}
                id={`${pane.id}-${widgetId}-panel`}
                role="tabpanel"
                aria-labelledby={`${pane.id}-${widgetId}-tab`}
                className="h-full min-h-0 min-w-0"
                hidden={!active}
              >
                {widget}
              </div>
            ) : null;
          })}
        </div>
      </div>
    </div>
  );
};

const WidgetFieldZone = ({
  active,
  boundaryIndex,
  edge,
  paneId,
  panes,
  onPreview,
  onDragFinish,
  setPanes,
}: {
  active: boolean;
  boundaryIndex: number;
  edge?: "top" | "bottom";
  paneId: string;
  panes: readonly WorkspacePaneState[];
  onPreview(target: WidgetContentDropTarget | null): void;
  onDragFinish(): void;
  setPanes: React.Dispatch<React.SetStateAction<WorkspacePaneState[]>>;
}) => {
  const zone = useAppDropZone<HTMLElement, { drag: WidgetDragData; target: WidgetContentDropTarget | null }>({
    accepts: (entity) => entity.kind === "widget-tab",
    resolve: (_event, entity) => {
      if (entity.kind !== "widget-tab") return null;
      const drag = { paneId: entity.sourcePaneId, widgetId: entity.id };
      const operation = getWidgetFieldDropOperation(panes, drag, boundaryIndex);
      const target = operation
        ? {
            paneId,
            operation,
            intent: edge === "top" ? ("above" as const) : ("below" as const),
          }
        : null;
      return {
        key: `widget:field:${boundaryIndex}`,
        valid: Boolean(target),
        label: target
          ? operation === "move-field"
            ? "Move field here"
            : edge === "top"
              ? "Place field above"
              : "Place field below"
          : "Field is already at this position",
        operation: { drag, target },
      };
    },
    onHover: (_event, { target }) => onPreview(target),
    onClear: () => onPreview(null),
    onDrop: (_event, { drag }) => {
      setPanes((current) => placeWidgetAtBoundary(current, drag, boundaryIndex));
      onDragFinish();
    },
  });
  if (edge)
    return (
      <div
        className="widget-stack-outer-drop-slot"
        data-widget-outer-drop-edge={edge}
        {...zone.handlers}
      >
        {active ? <SplitDropIndicator orientation="horizontal" data-widget-field-placeholder={edge} /> : null}
      </div>
    );
  return (
    <WidgetSplitSlot
      id={`${paneId}-separator`}
      data-widget-field-separator={boundaryIndex}
      {...zone.handlers}
    >
      {active ? (
        <SplitDropIndicator
          className="pointer-events-none h-full min-h-0 w-full"
          data-widget-field-placeholder-surface
          orientation="horizontal"
        />
      ) : null}
    </WidgetSplitSlot>
  );
};

export const RightSidebarWidgetStack = ({
  autoSaveId = "right-sidebar-widget-stack",
  children,
}: {
  autoSaveId?: string;
  children: ReactNode;
}) => {
  const widgets = Children.toArray(children).filter((child): child is WidgetElement => {
    if (!isValidElement<RightSidebarWidgetProps>(child)) return false;
    return typeof child.props.id === "string" && typeof child.props.title === "string";
  });
  const widgetIds = widgets.map(({ props }) => props.id);
  const widgetIdsKey = widgetIds.join("\u0000");
  const widgetById = new Map(widgets.map((widget) => [widget.props.id, widget]));
  const [panes, setPanes] = useState(() => loadWidgetPanes(autoSaveId, widgetIds));
  const [contentDropTarget, setContentDropTarget] = useState<WidgetContentDropTarget | null>(null);
  const [dragPreview, setDragPreview] = useState<WidgetDragPreview | null>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const isDraggingWidget = Boolean(dragPreview);

  useEffect(() => {
    const stack = stackRef.current;
    if (!isDraggingWidget || !stack) return;
    const scrollContainers = [...stack.querySelectorAll<HTMLElement>("[data-widget-pane] *")]
      .filter((element) => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
      .map((element) => ({
        element,
        top: element.scrollTop,
        left: element.scrollLeft,
        overflow: element.style.getPropertyValue("overflow"),
        priority: element.style.getPropertyPriority("overflow"),
      }));
    const preventWheel = (event: WheelEvent) => event.preventDefault();
    const preserveScroll = () => {
      for (const { element, top, left } of scrollContainers) {
        if (element.scrollTop !== top) element.scrollTop = top;
        if (element.scrollLeft !== left) element.scrollLeft = left;
      }
    };
    for (const { element } of scrollContainers) element.style.setProperty("overflow", "hidden", "important");
    stack.addEventListener("wheel", preventWheel, { passive: false });
    stack.addEventListener("scroll", preserveScroll, true);
    return () => {
      stack.removeEventListener("wheel", preventWheel);
      stack.removeEventListener("scroll", preserveScroll, true);
      for (const { element, overflow, priority } of scrollContainers) {
        if (overflow) element.style.setProperty("overflow", overflow, priority);
        else element.style.removeProperty("overflow");
      }
      preserveScroll();
    };
  }, [isDraggingWidget]);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: `${autoSaveId}-dock-panels` });
  const updateContentDropTarget = (target: WidgetContentDropTarget | null) => {
    setContentDropTarget((current) =>
      current?.paneId === target?.paneId &&
      current?.intent === target?.intent &&
      current?.operation === target?.operation
        ? current
        : target,
    );
  };
  const finishDrag = () => {
    setContentDropTarget(null);
    setDragPreview(null);
  };

  useEffect(() => {
    const currentWidgetIds = widgetIdsKey ? widgetIdsKey.split("\u0000") : [];
    setPanes((current) => normalizeWidgetPanes(current, currentWidgetIds, autoSaveId));
  }, [autoSaveId, widgetIdsKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(widgetLayoutStorageKey(autoSaveId), JSON.stringify(panes));
    } catch {
      // Sidebar layout preferences are optional; keep the in-memory layout.
    }
  }, [autoSaveId, panes]);

  if (!widgets.length || !panes.length) return null;

  const fieldDropIndex = (() => {
    if (!contentDropTarget) return null;
    const paneIndex = panes.findIndex((pane) => pane.id === contentDropTarget.paneId);
    return paneIndex < 0 ? null : paneIndex + (contentDropTarget.intent === "above" ? 0 : 1);
  })();
  const renderOuterDropSlot = (edge: "top" | "bottom") => {
    const boundaryIndex = edge === "top" ? 0 : panes.length;
    const pane = edge === "top" ? panes[0] : panes[panes.length - 1];
    return (
      <WidgetFieldZone
        key={edge}
        active={fieldDropIndex === boundaryIndex}
        boundaryIndex={boundaryIndex}
        edge={edge}
        paneId={pane.id}
        panes={panes}
        onPreview={updateContentDropTarget}
        onDragFinish={finishDrag}
        setPanes={setPanes}
      />
    );
  };

  const groupChildren: ReactNode[] = [];
  panes.forEach((pane, index) => {
    groupChildren.push(
      <Panel
        key={pane.id}
        id={pane.id}
        defaultSize={`${100 / panes.length}%`}
        minSize="96px"
        className="relative min-h-0 min-w-0"
        data-widget-field={pane.id}
      >
        <WidgetPane
          getFieldDropOperation={(drag, boundaryIndex) => getWidgetFieldDropOperation(panes, drag, boundaryIndex)}
          onDragFinish={finishDrag}
          pane={pane}
          paneIndex={index}
          setContentDropTarget={updateContentDropTarget}
          setDragPreview={setDragPreview}
          setPanes={setPanes}
          widgetById={widgetById}
        />
      </Panel>,
    );
    if (index < panes.length - 1) {
      groupChildren.push(
        <WidgetFieldZone
          key={`${pane.id}-separator`}
          active={fieldDropIndex === index + 1}
          boundaryIndex={index + 1}
          paneId={pane.id}
          panes={panes}
          onPreview={updateContentDropTarget}
          onDragFinish={finishDrag}
          setPanes={setPanes}
        />,
      );
    }
  });

  return (
    <div
      ref={stackRef}
      className="widget-stack-layout"
      data-widget-stack-drop-zone
      data-widget-dragging={Boolean(dragPreview)}
    >
      {renderOuterDropSlot("top")}
      <Group
        id={`${autoSaveId}-dock-panels`}
        orientation="vertical"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        resizeTargetMinimumSize={{ coarse: 20, fine: 8 }}
        className="min-h-0 min-w-0 flex-1"
      >
        {groupChildren}
      </Group>
      {renderOuterDropSlot("bottom")}
    </div>
  );
};
