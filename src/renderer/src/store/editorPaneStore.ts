import { atom } from "jotai";
import type { TaskNoteSubtaskTarget } from "@renderer/shared/taskNoteSubtasks";

/**
 * State owned by a single workspace pane.
 *
 * A pane contains an ordered list of workspace tabs, identifies the tab
 * currently displayed in that pane, and stores its relative share of the
 * available workspace width.
 */
export interface WorkspacePaneState {
  /** Unique workspace-wide identifier for this pane. */
  id: string;
  /** Tab IDs in their displayed order. */
  tabs: string[];
  /** ID of the displayed tab, or `null` when the pane is empty. */
  activeTabId: string | null;
  /** Relative width of the pane compared with the other panes. */
  size: number;
}

/** Creates an empty pane with the supplied workspace ID. */
export const createWorkspacePane = (id: string): WorkspacePaneState => ({
  id,
  tabs: [],
  activeTabId: null,
  size: 1,
});

export const DEFAULT_EDITOR_PANE_ID = "pane-1";

export const workspacePanesAtom = atom<WorkspacePaneState[]>([createWorkspacePane(DEFAULT_EDITOR_PANE_ID)]);
export const activePaneIdAtom = atom(DEFAULT_EDITOR_PANE_ID);

export const editorFocusRequestAtom = atom<{
  filePath: string;
  paneId: string;
  revision: number;
  position?: number;
} | null>(null);

/** Consumed by the destination editor after it mounts, including newly opened notes. */
export const editorHeadingRequestAtom = atom<{
  filePath: string;
  paneId: string;
  fragment: string;
  revision: number;
} | null>(null);

/** Records navigation intent before asynchronous file reads begin. */
export const workspaceNavigationRevisionAtom = atom(0);

export const editorSubtaskRequestAtom = atom<{
  filePath: string;
  paneId: string;
  target: TaskNoteSubtaskTarget;
} | null>(null);
