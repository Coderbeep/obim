import { atom } from "jotai";
import { workspaceViewPositionsAtom, type WorkspaceViewPosition } from "./workspaceViewStateStore";

/**
 * State owned by a single workspace tab.
 *
 * The tab displays the item identified by `currentResourceKey` and keeps its
 * own navigation history. The current resource is the last entry in
 * `backStack`; entries in `forwardStack` become available after navigating
 * backward.
 */
export interface WorkspaceTabState {
  /** Unique workspace-wide identifier for this tab. */
  id: string;
  /** Key of the workspace item currently displayed in the tab. */
  currentResourceKey: string;
  /** Visited resource keys, ending with the current resource. */
  backStack: string[];
  /** Resource keys available through forward navigation. */
  forwardStack: string[];
}

/** Creates a tab whose initial item is also the first entry in its history. */
export const createEditorTab = (id: string, resourceKey: string): WorkspaceTabState => ({
  id,
  currentResourceKey: resourceKey,
  backStack: [resourceKey],
  forwardStack: [],
});

const tabsAtom = atom<Record<string, WorkspaceTabState>>({});
type TabUpdate =
  Record<string, WorkspaceTabState> | ((tabs: Record<string, WorkspaceTabState>) => Record<string, WorkspaceTabState>);

export const workspaceTabsByIdAtom = atom(
  (get) => get(tabsAtom),
  (get, set, update: TabUpdate) => {
    const tabs = typeof update === "function" ? update(get(tabsAtom)) : update;
    set(tabsAtom, tabs);
    // Closing a tab or dropping a history entry releases its saved document state.
    const positions = get(workspaceViewPositionsAtom);
    let changed = false;
    const next = Object.fromEntries(
      Object.entries(positions).flatMap(([tabId, resources]) => {
        const tab = tabs[tabId];
        if (!tab) {
          changed = true;
          return [];
        }
        const keys = new Set([tab.currentResourceKey, ...tab.backStack, ...tab.forwardStack]);
        const retained = Object.entries(resources).filter(([key]) => keys.has(key));
        if (retained.length !== Object.keys(resources).length) changed = true;
        return [[tabId, Object.fromEntries(retained)]];
      }),
    );
    if (changed) set(workspaceViewPositionsAtom, next);
  },
);

export const saveWorkspaceViewPositionAtom = atom(
  null,
  (
    get,
    set,
    { tabId, resourceKey, position }: { tabId: string; resourceKey: string; position: WorkspaceViewPosition },
  ) => {
    const tab = get(tabsAtom)[tabId];
    // Unmount cleanup must not recreate positions for a closed tab or a removed resource.
    if (!tab || ![tab.currentResourceKey, ...tab.backStack, ...tab.forwardStack].includes(resourceKey)) return;
    set(workspaceViewPositionsAtom, (current) => ({
      ...current,
      [tabId]: { ...current[tabId], [resourceKey]: position },
    }));
  },
);
