import type { useStore } from "jotai";
import type { WorkspaceSelectionResult } from "@shared/config";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import {
  beginWorkspaceTransition,
  waitForWorkspaceActivity,
  WORKSPACE_TRANSITION_MESSAGE,
} from "@renderer/store/workspaceTransitionStore";
import { saveDirtyFileBuffers, waitForPendingFileSaves } from "./dirtyFileBuffers";
import { saveFile } from "./workspaceFileService";

type Store = ReturnType<typeof useStore>;

export const switchWorkspaceSafely = async (
  store: Store,
  selectWorkspace: () => Promise<WorkspaceSelectionResult>,
  onSelected: () => void,
  retainUntilReload = true,
): Promise<WorkspaceSelectionResult> => {
  const lease = beginWorkspaceTransition(store, "Switching workspace…");
  if (!lease) return { status: "error", error: WORKSPACE_TRANSITION_MESSAGE };
  let selected = false;
  try {
    await window.api.cancelGitSync?.();
    await Promise.race([waitForWorkspaceActivity(), lease.cancellation]);
    if (lease.cancelled) return { status: "cancelled" };
    await Promise.race([waitForPendingFileSaves(), lease.cancellation]);
    if (lease.cancelled) return { status: "cancelled" };
    const saved = await saveDirtyFileBuffers(
      store,
      () => true,
      (path, content, version) => saveFile(path, content, version, lease),
    );
    if (!saved.success) return { status: "error", error: saved.error };
    await waitForPendingFileSaves();
    if (Object.values(store.get(fileBuffersByPathAtom)).some((buffer) => buffer.editorText !== buffer.savedText)) {
      return { status: "error", error: "There are unsaved changes. Save them before switching workspaces." };
    }
    if (!lease.commit()) return { status: "cancelled" };
    const result = await selectWorkspace();
    if (result.status === "selected") {
      selected = true;
      onSelected();
    }
    return result;
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  } finally {
    // Once the root is committed, the old renderer must never accept another write.
    if (!selected || !retainUntilReload) lease.release();
  }
};
