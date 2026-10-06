import type { WorkspacePaneState } from "@renderer/store/editorPaneStore";

export const normalizePaneSize = (size?: number) => Math.max(0.01, size ?? 1);

// index:    0   1   2   3
//           | A | B | C |

export const getPaneSplitTarget = (panes: readonly WorkspacePaneState[], insertIndex: number) => {
  if (panes.length === 0) return null;
  if (insertIndex <= 0) return { paneId: panes[0].id, side: "left" as const };
  if (insertIndex >= panes.length) return { paneId: panes.at(-1)!.id, side: "right" as const };
  return { paneId: panes[insertIndex].id, side: "left" as const };
};
