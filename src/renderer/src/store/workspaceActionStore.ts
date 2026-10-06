import { atom, type Getter, type Setter } from "jotai";
import { pendingFileSavePaths } from "./fileSaveStore";
import { getWorkspaceItemBufferPaths, getWorkspaceTabBufferPaths } from "./workspaceBufferOwnership";

import type { FileItem } from "@shared/file-item";
import { createRemovedPathMatcher } from "@shared/pathUtils";
import {
  createWorkspaceItemKeyRemapper,
  getWorkspaceReferenceFilePathFromKey,
  remapWorkspaceItems,
  type WorkspaceItem,
} from "@shared/workspace";

import { activePaneIdAtom, workspacePanesAtom } from "./editorPaneStore";
import { workspaceTabsByIdAtom } from "./editorTabStore";
import { fileBufferIdentitiesAtom, fileBuffersByPathAtom } from "./fileBufferStore";
import { openWorkspaceItemsByKeyAtom } from "./workspaceResourceStore";
import {
  activatePaneTab,
  activateWorkspaceResource,
  closeWorkspaceTab,
  commitWorkspaceHistoryNavigation,
  insertWorkspacePane,
  moveWorkspacePane,
  moveWorkspaceTab,
  normalizeWorkspacePaneSizes,
  openWorkspaceResource,
  remapWorkspaceTabs,
  removeWorkspaceResources,
  resizeWorkspacePanePair,
  splitWorkspaceTab,
  type PaneSplitSide,
  type WorkspaceState,
} from "./workspaceTransitions";

const readWorkspaceState = (get: Getter): WorkspaceState => ({
  activePaneId: get(activePaneIdAtom),
  openItemsByKey: get(openWorkspaceItemsByKeyAtom),
  panes: get(workspacePanesAtom),
  tabsById: get(workspaceTabsByIdAtom),
});

const writeWorkspaceState = (set: Setter, state: WorkspaceState) => {
  set(activePaneIdAtom, state.activePaneId);
  set(openWorkspaceItemsByKeyAtom, state.openItemsByKey);
  set(workspacePanesAtom, state.panes);
  set(workspaceTabsByIdAtom, state.tabsById);
};

const createTabId = () => `tab-${crypto.randomUUID()}`;

export type ActivateWorkspaceResourcePayload = {
  item?: WorkspaceItem;
  paneId?: string;
  resourceKey: string;
};

export const activateWorkspaceResourceAtom = atom(null, (get, set, payload: ActivateWorkspaceResourcePayload) => {
  const next = activateWorkspaceResource(readWorkspaceState(get), {
    ...payload,
    newTabId: createTabId(),
  });
  writeWorkspaceState(set, next);
  return next.activatedTabId;
});

export type OpenWorkspaceResourcePayload = {
  activate?: boolean;
  historyDirection?: "back" | "forward";
  item: WorkspaceItem;
  openInNewTab?: boolean;
  paneId?: string;
  skipHistoryPush?: boolean;
  targetTabId?: string;
};

export const openWorkspaceResourceAtom = atom(null, (get, set, payload: OpenWorkspaceResourcePayload) => {
  const next = openWorkspaceResource(readWorkspaceState(get), {
    ...payload,
    newTabId: createTabId(),
  });
  writeWorkspaceState(set, next);
});

export const activateWorkspaceTabAtom = atom(null, (get, set, { paneId, tabId }: { paneId: string; tabId: string }) => {
  set(workspacePanesAtom, activatePaneTab(get(workspacePanesAtom), paneId, tabId));
  set(activePaneIdAtom, paneId);
});

/** Activates a tab in its pane while preserving keyboard focus in the current pane. */
export const activateWorkspaceTabInBackgroundAtom = atom(
  null,
  (get, set, { paneId, tabId }: { paneId: string; tabId: string }) => {
    set(workspacePanesAtom, activatePaneTab(get(workspacePanesAtom), paneId, tabId));
  },
);

export const activateWorkspacePaneAtom = atom(null, (get, set, paneId: string) => {
  if (get(workspacePanesAtom).some((pane) => pane.id === paneId)) set(activePaneIdAtom, paneId);
});

export const closeWorkspaceTabAtom = atom(null, (get, set, { paneId, tabId }: { paneId: string; tabId: string }) => {
  const buffers = get(fileBuffersByPathAtom);
  if (
    getWorkspaceTabBufferPaths(get, tabId).some(
      (path) =>
        pendingFileSavePaths.has(path) || (buffers[path] && buffers[path].savedText !== buffers[path].editorText),
    )
  )
    return false;
  const next = closeWorkspaceTab(readWorkspaceState(get), paneId, tabId);
  writeWorkspaceState(set, next);

  const usedFilePaths = new Set(
    Object.values(next.openItemsByKey).flatMap((item) => getWorkspaceItemBufferPaths(item)),
  );
  set(fileBuffersByPathAtom, (buffers) =>
    Object.fromEntries(
      Object.entries(buffers).filter(
        ([path, buffer]) =>
          usedFilePaths.has(path) || buffer.editorText !== buffer.savedText || pendingFileSavePaths.has(path),
      ),
    ),
  );
  return true;
});

export const moveWorkspaceTabAtom = atom(
  null,
  (get, set, payload: { sourcePaneId: string; tabId: string; targetIndex?: number; targetPaneId: string }) => {
    const panes = moveWorkspaceTab(
      get(workspacePanesAtom),
      payload.sourcePaneId,
      payload.targetPaneId,
      payload.tabId,
      payload.targetIndex,
    );
    set(workspacePanesAtom, panes);
    set(activePaneIdAtom, payload.targetPaneId);
  },
);

export const moveWorkspacePaneAtom = atom(null, (get, set, payload: { paneId: string; boundaryIndex: number }) => {
  const current = get(workspacePanesAtom);
  const panes = moveWorkspacePane(current, payload.paneId, payload.boundaryIndex);
  if (panes.every((pane, index) => pane.id === current[index]?.id)) return false;
  set(workspacePanesAtom, panes);
  set(activePaneIdAtom, payload.paneId);
  return true;
});

export const splitWorkspaceTabAtom = atom(
  null,
  (
    get,
    set,
    payload: {
      newPaneId: string;
      side: PaneSplitSide;
      sourcePaneId: string;
      tabId: string;
      targetPaneId: string;
    },
  ) => {
    const current = get(workspacePanesAtom);
    const panes = splitWorkspaceTab(
      current,
      payload.sourcePaneId,
      payload.targetPaneId,
      payload.tabId,
      payload.side,
      payload.newPaneId,
    );
    const changed = panes.length !== current.length || panes.some((pane, index) => pane.id !== current[index]?.id);
    if (!changed) return false;
    set(workspacePanesAtom, panes);
    const didSplit = panes.some((pane) => pane.id === payload.newPaneId);
    set(activePaneIdAtom, didSplit ? payload.newPaneId : payload.sourcePaneId);
    return true;
  },
);

export const insertWorkspacePaneAtom = atom(
  null,
  (get, set, payload: { paneId: string; side: PaneSplitSide; targetPaneId: string }) => {
    set(
      workspacePanesAtom,
      insertWorkspacePane(get(workspacePanesAtom), payload.targetPaneId, payload.side, payload.paneId),
    );
  },
);

export const removeEmptyWorkspacePaneAtom = atom(null, (get, set, paneId: string) => {
  const panes = get(workspacePanesAtom);
  const pane = panes.find((candidate) => candidate.id === paneId);
  if (!pane || pane.tabs.length > 0 || panes.length <= 1) return;
  const next = normalizeWorkspacePaneSizes(panes.filter((candidate) => candidate.id !== paneId));
  set(workspacePanesAtom, next);
  if (get(activePaneIdAtom) === paneId) set(activePaneIdAtom, next[0].id);
});

export const resizeWorkspacePanePairAtom = atom(
  null,
  (get, set, payload: { leftPaneId: string; leftSize: number; rightPaneId: string; rightSize: number }) => {
    set(
      workspacePanesAtom,
      resizeWorkspacePanePair(
        get(workspacePanesAtom),
        payload.leftPaneId,
        payload.rightPaneId,
        payload.leftSize,
        payload.rightSize,
      ),
    );
  },
);

export const commitWorkspaceHistoryNavigationAtom = atom(
  null,
  (get, set, payload: { direction: "back" | "forward"; tabId: string; targetResourceKey: string }) => {
    const tab = get(workspaceTabsByIdAtom)[payload.tabId];
    if (!tab) return;
    const next = commitWorkspaceHistoryNavigation(tab, payload.direction, payload.targetResourceKey);
    if (next === tab) return;
    set(workspaceTabsByIdAtom, (tabs) => ({ ...tabs, [payload.tabId]: next }));
  },
);

export type RemapWorkspaceFileReferencesPayload = {
  notesDirectoryPath: string;
  remapPath: (path: string) => string;
};

export const remapWorkspaceFileReferencesAtom = atom(
  null,
  (get, set, { notesDirectoryPath, remapPath }: RemapWorkspaceFileReferencesPayload) => {
    const remapResourceKey = createWorkspaceItemKeyRemapper(remapPath);
    set(fileBufferIdentitiesAtom, (identities) =>
      Object.fromEntries(Object.entries(identities).map(([path, identity]) => [remapPath(path), identity])),
    );
    set(workspaceTabsByIdAtom, remapWorkspaceTabs(get(workspaceTabsByIdAtom), remapResourceKey));
    set(
      openWorkspaceItemsByKeyAtom,
      remapWorkspaceItems(get(openWorkspaceItemsByKeyAtom), remapPath, notesDirectoryPath),
    );
    set(
      fileBuffersByPathAtom,
      Object.fromEntries(Object.entries(get(fileBuffersByPathAtom)).map(([path, value]) => [remapPath(path), value])),
    );
  },
);

export type RemoveWorkspaceFileReferencesPayload = {
  removedItems: FileItem[];
};

export const removeWorkspaceFileReferencesAtom = atom(
  null,
  (get, set, { removedItems }: RemoveWorkspaceFileReferencesPayload) => {
    const wasRemoved = createRemovedPathMatcher(removedItems);
    const shouldRemoveResource = (resourceKey: string) => {
      const path = getWorkspaceReferenceFilePathFromKey(resourceKey);
      return path ? wasRemoved(path) : false;
    };
    const next = removeWorkspaceResources(get(workspacePanesAtom), get(workspaceTabsByIdAtom), shouldRemoveResource);
    set(workspacePanesAtom, next.panes);
    set(workspaceTabsByIdAtom, next.tabsById);
    set(openWorkspaceItemsByKeyAtom, (items) =>
      Object.fromEntries(Object.entries(items).filter(([resourceKey]) => !shouldRemoveResource(resourceKey))),
    );
    set(fileBuffersByPathAtom, (buffers) =>
      Object.fromEntries(
        Object.entries(buffers).filter(
          ([path, buffer]) =>
            !wasRemoved(path) || buffer.editorText !== buffer.savedText || pendingFileSavePaths.has(path),
        ),
      ),
    );
  },
);
