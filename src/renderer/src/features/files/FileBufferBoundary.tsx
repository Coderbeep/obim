import { useAtomValue, useStore } from "jotai";
import { useEffect, useRef, type ReactNode } from "react";
import { getWorkspacePath } from "@renderer/config";
import { Button } from "@renderer/shared/ui/button";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { fileLoadStatesByPathAtom } from "@renderer/store/fileLoadStore";
import { hydrateFileBufferAtom } from "@renderer/store/fileLifecycleStore";
import {
  getWorkspaceTransitionGeneration,
  isWorkspaceTransitionActive,
} from "@renderer/store/workspaceTransitionStore";
import { readTextFile } from "./workspaceFileService";

/** A missing buffer is never an editable empty document. Retry hydrates the same file and tab. */
export const FileBufferBoundary = ({ filePath, children }: { filePath: string; children: ReactNode }) => {
  const store = useStore();
  const buffer = useAtomValue(fileBuffersByPathAtom)[filePath];
  const loadState = useAtomValue(fileLoadStatesByPathAtom)[filePath];
  const requestRevision = useRef(0);
  useEffect(
    () => () => {
      requestRevision.current += 1;
      store.set(fileLoadStatesByPathAtom, (states) =>
        states[filePath]?.phase === "loading"
          ? { ...states, [filePath]: { phase: "error", message: "Opening was cancelled. Retry to read the note." } }
          : states,
      );
    },
    [filePath, store],
  );

  const retry = async () => {
    if (isWorkspaceTransitionActive()) return;
    const revision = ++requestRevision.current;
    const generation = getWorkspaceTransitionGeneration();
    const workspacePath = getWorkspacePath();
    store.set(fileLoadStatesByPathAtom, (states) => ({ ...states, [filePath]: { phase: "loading" } }));
    const result = await readTextFile(filePath).catch((error: unknown) => ({
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (revision !== requestRevision.current) return;
    if (generation !== getWorkspaceTransitionGeneration() || workspacePath !== getWorkspacePath()) {
      store.set(fileLoadStatesByPathAtom, (states) => ({
        ...states,
        [filePath]: { phase: "error", message: "Opening was cancelled. Retry to read the note." },
      }));
      return;
    }
    if (result.success) store.set(hydrateFileBufferAtom, filePath, result.content, result.version);
    else
      store.set(fileLoadStatesByPathAtom, (states) => ({
        ...states,
        [filePath]: { phase: "error", message: result.error },
      }));
  };

  if (buffer) return children;
  return (
    <section className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <h2 className="text-ui-body font-semibold">
        {loadState?.phase === "loading" ? "Opening note…" : "Could not open note"}
      </h2>
      <p className="max-w-lg break-all text-ui-meta text-muted-foreground">{filePath}</p>
      {loadState?.phase === "loading" ? (
        <p role="status">Reading the file. Your note will appear when it is ready.</p>
      ) : (
        <>
          <p role="alert" className="max-w-lg text-ui-control text-muted-foreground">
            {loadState?.message ?? "The note has not loaded. Retry to read it, or close this tab."}
          </p>
          <Button type="button" onClick={() => void retry()}>
            Retry opening note
          </Button>
        </>
      )}
    </section>
  );
};
