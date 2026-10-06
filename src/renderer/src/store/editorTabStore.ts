import { atom } from "jotai";

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

export const workspaceTabsByIdAtom = atom<Record<string, WorkspaceTabState>>({});
