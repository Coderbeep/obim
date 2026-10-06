import type { WorkspaceItem } from "@shared/workspace";

import { createWorkspacePane, type WorkspacePaneState } from "./editorPaneStore";
import { createEditorTab, type WorkspaceTabState } from "./editorTabStore";

/** Complete immutable state consumed and returned by workspace transitions. */
export type WorkspaceState = {
  activePaneId: string;
  openItemsByKey: Record<string, WorkspaceItem>;
  panes: WorkspacePaneState[];
  tabsById: Record<string, WorkspaceTabState>;
};

/** Side of a target pane where a split or empty pane is inserted. */
export type PaneSplitSide = "left" | "right";

/** Keeps pane widths proportional while making their flex shares fill the workspace. */
export const normalizeWorkspacePaneSizes = (panes: readonly WorkspacePaneState[]): WorkspacePaneState[] => {
  if (panes.length === 0) return [];
  const sizes = panes.map((pane) => (Number.isFinite(pane.size) && pane.size > 0 ? Math.max(0.01, pane.size) : 1));
  const totalSize = sizes.reduce((sum, size) => sum + size, 0);
  const targetSize = panes.length;
  return panes.map((pane, index) => {
    const size = (sizes[index] / totalSize) * targetSize;
    return pane.size === size ? pane : { ...pane, size };
  });
};

/** Adds a tab to a pane when needed and makes it the pane's active tab. */
export const activatePaneTab = (panes: readonly WorkspacePaneState[], paneId: string, tabId: string) => {
  const nextPanes = [...panes];
  let paneIndex = nextPanes.findIndex((pane) => pane.id === paneId);

  if (paneIndex === -1) {
    nextPanes.push(createWorkspacePane(paneId));
    paneIndex = nextPanes.length - 1;
  }

  const pane = nextPanes[paneIndex];
  nextPanes[paneIndex] = {
    ...pane,
    tabs: pane.tabs.includes(tabId) ? pane.tabs : [...pane.tabs, tabId],
    activeTabId: tabId,
  };

  return nextPanes;
};
const moveTabInsidePane = (tabs: readonly string[], tabId: string, targetIndex: number) => {
  const sourceIndex = tabs.indexOf(tabId);
  if (sourceIndex < 0) return [...tabs];

  const next = [...tabs];
  next.splice(sourceIndex, 1);
  const shiftedIndex = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
  next.splice(Math.max(0, Math.min(shiftedIndex, next.length)), 0, tabId);
  return next;
};

const moveTabAcrossPanes = (tabs: readonly string[], tabId: string, targetIndex: number) => {
  const next = tabs.filter((candidate) => candidate !== tabId);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, tabId);
  return next;
};

const getActiveTabAfterRemoval = (tabs: readonly string[], removedTabId: string) => {
  const removedIndex = tabs.indexOf(removedTabId);
  const nextTabs = tabs.filter((tabId) => tabId !== removedTabId);
  return {
    tabs: nextTabs,
    activeTabId: nextTabs[Math.max(0, removedIndex - 1)] ?? nextTabs[0] ?? null,
  };
};

/**
 * Opens an item in an existing target tab or creates a new tab.
 *
 * Normal opens append to backward history and clear forward history.
 * `skipHistoryPush` changes only the displayed item so navigation can be
 * committed separately after the asynchronous open succeeds.
 */
export const openWorkspaceResource = (
  state: WorkspaceState,
  input: {
    activate?: boolean;
    historyDirection?: "back" | "forward";
    item: WorkspaceItem;
    newTabId: string;
    openInNewTab?: boolean;
    paneId?: string;
    skipHistoryPush?: boolean;
    targetTabId?: string;
  },
): WorkspaceState => {
  const paneId = input.paneId ?? state.activePaneId;
  const targetPane = state.panes.find((pane) => pane.id === paneId);
  const targetTabId = input.targetTabId ?? (input.openInNewTab ? null : (targetPane?.activeTabId ?? null));
  const openItemsByKey = { ...state.openItemsByKey, [input.item.key]: input.item };

  if (!targetTabId || !state.tabsById[targetTabId]) {
    const tab = createEditorTab(input.newTabId, input.item.key);
    return {
      activePaneId: paneId,
      openItemsByKey,
      panes: activatePaneTab(state.panes, paneId, tab.id),
      tabsById: { ...state.tabsById, [tab.id]: tab },
    };
  }

  const current = state.tabsById[targetTabId];
  if (input.historyDirection && getWorkspaceHistoryTarget(current, input.historyDirection) !== input.item.key)
    return state;
  const backStack =
    input.skipHistoryPush || input.historyDirection
      ? current.backStack
      : current.backStack.at(-1) === input.item.key
        ? current.backStack
        : [...current.backStack, input.item.key];

  const displayed = {
    ...current,
    currentResourceKey: input.item.key,
    backStack,
    forwardStack: input.skipHistoryPush || input.historyDirection ? current.forwardStack : [],
  };
  return {
    activePaneId: input.activate === false ? state.activePaneId : paneId,
    openItemsByKey,
    panes: input.activate === false ? state.panes : activatePaneTab(state.panes, paneId, targetTabId),
    tabsById: {
      ...state.tabsById,
      [targetTabId]: input.historyDirection
        ? commitWorkspaceHistoryNavigation(displayed, input.historyDirection, input.item.key)
        : displayed,
    },
  };
};

/**
 * Activates the tab already displaying a key, or creates a tab for that key.
 *
 * The returned `activatedTabId` identifies the existing or newly created tab.
 */
export const activateWorkspaceResource = (
  state: WorkspaceState,
  input: { item?: WorkspaceItem; newTabId: string; paneId?: string; resourceKey: string },
): WorkspaceState & { activatedTabId: string } => {
  const paneId = input.paneId ?? state.activePaneId;
  const existingEntry = Object.entries(state.tabsById).find(([, tab]) => tab.currentResourceKey === input.resourceKey);
  const openItemsByKey = input.item
    ? { ...state.openItemsByKey, [input.resourceKey]: input.item }
    : state.openItemsByKey;

  if (existingEntry) {
    const [tabId] = existingEntry;
    const existingPane = state.panes.find((pane) => pane.tabs.includes(tabId));
    const resolvedPaneId = existingPane?.id ?? paneId;
    return {
      ...state,
      activePaneId: resolvedPaneId,
      openItemsByKey,
      panes: activatePaneTab(state.panes, resolvedPaneId, tabId),
      activatedTabId: tabId,
    };
  }

  const tab = createEditorTab(input.newTabId, input.resourceKey);
  return {
    ...state,
    activePaneId: paneId,
    openItemsByKey,
    panes: activatePaneTab(state.panes, paneId, tab.id),
    tabsById: { ...state.tabsById, [tab.id]: tab },
    activatedTabId: tab.id,
  };
};

/**
 * Closes a tab and removes its now-unused resolved item.
 *
 * An empty pane is removed when another pane remains. Invalid pane or tab IDs
 * return the original state unchanged.
 */
export const closeWorkspaceTab = (state: WorkspaceState, paneId: string, tabId: string): WorkspaceState => {
  const paneIndex = state.panes.findIndex((pane) => pane.id === paneId);
  if (paneIndex < 0 || !state.panes[paneIndex].tabs.includes(tabId) || !state.tabsById[tabId]) return state;

  const panesAfterTabClose = state.panes.map((pane) => {
    if (pane.id !== paneId || !pane.tabs.includes(tabId)) return pane;
    const next = getActiveTabAfterRemoval(pane.tabs, tabId);
    return {
      ...pane,
      tabs: next.tabs,
      activeTabId: pane.activeTabId === tabId ? next.activeTabId : pane.activeTabId,
    };
  });
  const emptiedPane = panesAfterTabClose.find((pane) => pane.id === paneId);
  const removePane = emptiedPane?.tabs.length === 0 && panesAfterTabClose.length > 1;
  const panes = removePane
    ? normalizeWorkspacePaneSizes(panesAfterTabClose.filter((pane) => pane.id !== paneId))
    : panesAfterTabClose;
  const tabsById = { ...state.tabsById };
  delete tabsById[tabId];
  const activePaneId =
    removePane && state.activePaneId === paneId
      ? ((panes[Math.max(0, paneIndex - 1)] ?? panes[0])?.id ?? state.activePaneId)
      : state.activePaneId;

  const usedResourceKeys = new Set(
    panes.flatMap((pane) =>
      pane.tabs.map((currentTabId) => tabsById[currentTabId]?.currentResourceKey).filter(Boolean),
    ),
  );
  const openItemsByKey = Object.fromEntries(
    Object.entries(state.openItemsByKey).filter(([resourceKey]) => usedResourceKeys.has(resourceKey)),
  );

  return { activePaneId, openItemsByKey, panes, tabsById };
};

/**
 * Reorders a tab or moves it between panes.
 *
 * Moving the last tab out removes its source pane when another pane remains.
 */
export const moveWorkspaceTab = (
  panes: readonly WorkspacePaneState[],
  sourcePaneId: string,
  targetPaneId: string,
  tabId: string,
  targetIndex?: number,
) => {
  const sourcePane = panes.find((pane) => pane.id === sourcePaneId);
  const targetPane = panes.find((pane) => pane.id === targetPaneId);
  if (!sourcePane || !targetPane || !sourcePane.tabs.includes(tabId)) return [...panes];

  const resolvedTargetIndex = targetIndex ?? targetPane.tabs.length;
  if (sourcePaneId === targetPaneId) {
    const tabs = moveTabInsidePane(sourcePane.tabs, tabId, resolvedTargetIndex);
    return panes.map((pane) => (pane.id === sourcePaneId ? { ...pane, tabs } : pane));
  }

  const sourceTabs = sourcePane.tabs.filter((candidate) => candidate !== tabId);
  const next = panes.map((pane) => {
    if (pane.id === sourcePaneId) {
      return {
        ...pane,
        tabs: sourceTabs,
        activeTabId:
          pane.activeTabId === tabId ? getActiveTabAfterRemoval(pane.tabs, tabId).activeTabId : pane.activeTabId,
      };
    }
    return pane.id === targetPaneId
      ? { ...pane, tabs: moveTabAcrossPanes(pane.tabs, tabId, resolvedTargetIndex), activeTabId: tabId }
      : pane;
  });
  return sourceTabs.length === 0 && panes.length > 1
    ? normalizeWorkspacePaneSizes(next.filter((pane) => pane.id !== sourcePaneId))
    : next;
};

/** Returns the insertion boundary produced by crossing a pane separator. */
export const getWorkspacePaneMoveBoundary = (
  panes: readonly WorkspacePaneState[],
  sourcePaneId: string,
  boundaryIndex: number,
) => {
  const sourceIndex = panes.findIndex((pane) => pane.id === sourcePaneId);
  if (sourceIndex < 0) return null;
  const boundedIndex = Math.max(0, Math.min(boundaryIndex, panes.length));
  if (boundedIndex === sourceIndex) return Math.max(0, boundedIndex - 1);
  if (boundedIndex === sourceIndex + 1) return Math.min(panes.length, boundedIndex + 1);
  return boundedIndex;
};

/** Returns the pane index produced by moving a pane across a boundary. */
export const getWorkspacePaneMoveIndex = (
  panes: readonly WorkspacePaneState[],
  sourcePaneId: string,
  boundaryIndex: number,
) => {
  const sourceIndex = panes.findIndex((pane) => pane.id === sourcePaneId);
  if (sourceIndex < 0) return null;
  const moveBoundary = getWorkspacePaneMoveBoundary(panes, sourcePaneId, boundaryIndex);
  if (moveBoundary === null) return null;
  return moveBoundary > sourceIndex ? moveBoundary - 1 : moveBoundary;
};

/** Moves a pane to an explicit boundary without changing its identity or size. */
export const moveWorkspacePane = (
  panes: readonly WorkspacePaneState[],
  sourcePaneId: string,
  boundaryIndex: number,
) => {
  const sourceIndex = panes.findIndex((pane) => pane.id === sourcePaneId);
  const targetIndex = getWorkspacePaneMoveIndex(panes, sourcePaneId, boundaryIndex);
  if (sourceIndex < 0 || targetIndex === null || targetIndex === sourceIndex) return [...panes];
  const sourcePane = panes[sourceIndex];
  const remaining = panes.filter((pane) => pane.id !== sourcePaneId);
  return [...remaining.slice(0, targetIndex), sourcePane, ...remaining.slice(targetIndex)];
};

/**
 * Places a tab in a pane boundary.
 *
 * A tab from a multi-tab pane creates a new pane. A tab that already occupies
 * its pane alone moves that pane without changing its identity or size.
 */
export const splitWorkspaceTab = (
  panes: readonly WorkspacePaneState[],
  sourcePaneId: string,
  targetPaneId: string,
  tabId: string,
  side: PaneSplitSide,
  newPaneId: string,
) => {
  const sourcePane = panes.find((pane) => pane.id === sourcePaneId);
  const targetIndex = panes.findIndex((pane) => pane.id === targetPaneId);
  if (!sourcePane?.tabs.includes(tabId) || targetIndex < 0) return [...panes];
  if (sourcePane.tabs.length === 1) {
    return moveWorkspacePane(panes, sourcePaneId, targetIndex + (side === "right" ? 1 : 0));
  }

  const sourceTabs = sourcePane.tabs.filter((candidate) => candidate !== tabId);
  const afterSourceUpdate = panes.map((pane) =>
    pane.id === sourcePaneId
      ? {
          ...pane,
          tabs: sourceTabs,
          activeTabId:
            pane.activeTabId === tabId ? getActiveTabAfterRemoval(pane.tabs, tabId).activeTabId : pane.activeTabId,
        }
      : pane,
  );
  const withoutEmptySource =
    sourceTabs.length === 0 && panes.length > 1
      ? afterSourceUpdate.filter((pane) => pane.id !== sourcePaneId)
      : afterSourceUpdate;
  const updatedTargetIndex = withoutEmptySource.findIndex((pane) => pane.id === targetPaneId);
  if (updatedTargetIndex < 0) return [...panes];
  const pane = { ...createWorkspacePane(newPaneId), tabs: [tabId], activeTabId: tabId };
  const insertIndex = side === "left" ? updatedTargetIndex : updatedTargetIndex + 1;
  return [...withoutEmptySource.slice(0, insertIndex), pane, ...withoutEmptySource.slice(insertIndex)];
};

/** Inserts an empty pane beside an existing target pane. */
export const insertWorkspacePane = (
  panes: readonly WorkspacePaneState[],
  targetPaneId: string,
  side: PaneSplitSide,
  paneId: string,
) => {
  const targetIndex = panes.findIndex((pane) => pane.id === targetPaneId);
  if (targetIndex < 0) return [...panes];
  const insertIndex = side === "left" ? targetIndex : targetIndex + 1;
  return [...panes.slice(0, insertIndex), createWorkspacePane(paneId), ...panes.slice(insertIndex)];
};

/** Updates a neighboring pane pair while keeping both size shares positive. */
export const resizeWorkspacePanePair = (
  panes: readonly WorkspacePaneState[],
  leftPaneId: string,
  rightPaneId: string,
  leftSize: number,
  rightSize: number,
) =>
  panes.map((pane) => {
    if (pane.id === leftPaneId) return { ...pane, size: Math.max(0.01, leftSize) };
    if (pane.id === rightPaneId) return { ...pane, size: Math.max(0.01, rightSize) };
    return pane;
  });

/**
 * Commits a completed backward or forward navigation to a tab's history.
 *
 * The tab must already display `targetResourceKey`; otherwise the original tab
 * is returned to avoid committing a stale asynchronous navigation.
 */
export const commitWorkspaceHistoryNavigation = (
  tab: WorkspaceTabState,
  direction: "back" | "forward",
  targetResourceKey: string,
): WorkspaceTabState => {
  if (tab.currentResourceKey !== targetResourceKey) return tab;
  if (direction === "back") {
    const previousCurrent = tab.backStack.at(-1);
    return {
      ...tab,
      backStack: tab.backStack.slice(0, -1),
      forwardStack: previousCurrent ? [...tab.forwardStack, previousCurrent] : tab.forwardStack,
    };
  }
  return {
    ...tab,
    backStack: [...tab.backStack, targetResourceKey],
    forwardStack: tab.forwardStack.slice(0, -1),
  };
};

/**
 * Returns the resource a tab should open when navigating backward or forward.
 *
 * The current resource is the last entry in the back stack, so backward
 * navigation targets the entry before it. Forward navigation targets the last
 * entry in the forward stack. Returns `null` when no target is available.
 */
export const getWorkspaceHistoryTarget = (tab: WorkspaceTabState, direction: "back" | "forward") =>
  direction === "back" ? (tab.backStack.at(-2) ?? null) : (tab.forwardStack.at(-1) ?? null);

const repairTabHistory = (tab: WorkspaceTabState, shouldRemove: (resourceKey: string) => boolean) => {
  const backStack = tab.backStack.filter((resourceKey) => !shouldRemove(resourceKey));
  return {
    ...tab,
    backStack: backStack.includes(tab.currentResourceKey) ? backStack : [...backStack, tab.currentResourceKey],
    forwardStack: tab.forwardStack.filter((resourceKey) => !shouldRemove(resourceKey)),
  };
};

/**
 * Removes matching current items from tabs and repairs surviving histories.
 *
 * Pane tab lists and active-tab references are updated to contain only tabs
 * that remain in `tabsById`.
 */
export const removeWorkspaceResources = (
  panes: readonly WorkspacePaneState[],
  tabsById: Readonly<Record<string, WorkspaceTabState>>,
  shouldRemove: (resourceKey: string) => boolean,
) => {
  const nextTabsById = Object.fromEntries(
    Object.entries(tabsById).reduce<[string, WorkspaceTabState][]>((tabs, [tabId, tab]) => {
      if (!shouldRemove(tab.currentResourceKey)) tabs.push([tabId, repairTabHistory(tab, shouldRemove)]);
      return tabs;
    }, []),
  );
  const nextPanes = panes.map((pane) => {
    const tabs = pane.tabs.filter((tabId) => nextTabsById[tabId]);
    return {
      ...pane,
      tabs,
      activeTabId: pane.activeTabId && nextTabsById[pane.activeTabId] ? pane.activeTabId : (tabs[0] ?? null),
    };
  });
  return { panes: nextPanes, tabsById: nextTabsById };
};

/** Remaps every current, backward, and forward item key in every tab. */
export const remapWorkspaceTabs = (
  tabsById: Readonly<Record<string, WorkspaceTabState>>,
  remapResourceKey: (resourceKey: string) => string,
) =>
  Object.fromEntries(
    Object.entries(tabsById).map(([tabId, tab]) => [
      tabId,
      {
        ...tab,
        currentResourceKey: remapResourceKey(tab.currentResourceKey),
        backStack: tab.backStack.map(remapResourceKey),
        forwardStack: tab.forwardStack.map(remapResourceKey),
      },
    ]),
  );
