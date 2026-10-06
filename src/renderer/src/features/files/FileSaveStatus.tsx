import { useAtomValue, useSetAtom } from "jotai";

import { cn } from "@renderer/shared/classNames";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import {
  fileConflictReviewRequestAtom,
  fileSaveStatesByPathAtom,
  type FileSavePhase,
} from "@renderer/store/fileSaveStore";

const labels: Record<FileSavePhase, string> = {
  conflict: "Changed on disk",
  dirty: "Unsaved changes",
  error: "Save failed",
  saved: "Saved",
  saving: "Saving…",
};

export const useFileSavePresentation = (path?: string | null) => {
  const buffers = useAtomValue(fileBuffersByPathAtom);
  const saveStates = useAtomValue(fileSaveStatesByPathAtom);
  if (!path || !buffers[path]) return null;

  const state = saveStates[path];
  const dirty = buffers[path].savedText !== buffers[path].editorText;
  const phase: FileSavePhase =
    state?.phase === "conflict" || state?.phase === "error" || state?.phase === "saving"
      ? state.phase
      : dirty
        ? "dirty"
        : "saved";
  return { ...state, label: labels[phase], phase };
};

export const FileSaveStatus = ({ className, path }: { className?: string; path: string }) => {
  const presentation = useFileSavePresentation(path);
  const reviewConflict = useSetAtom(fileConflictReviewRequestAtom);
  if (!presentation) return null;

  const content = (
    <>
      <span className="file-save-status-dot" aria-hidden="true" />
      <span>{presentation.label}</span>
    </>
  );

  return presentation.phase === "conflict" ? (
    <button
      type="button"
      className={cn("file-save-status", className)}
      data-save-phase={presentation.phase}
      onClick={() => reviewConflict({ path })}
      title={presentation.message ?? "Review the editor and disk versions"}
    >
      {content}
    </button>
  ) : (
    <span
      className={cn("file-save-status", className)}
      data-save-phase={presentation.phase}
      role={presentation.phase === "error" ? "alert" : "status"}
      title={presentation.message ?? presentation.label}
    >
      {content}
    </span>
  );
};
