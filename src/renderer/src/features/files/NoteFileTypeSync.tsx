import { getWorkspacePath } from "@renderer/config";
import { queryWorkspacePropertyMatches } from "@renderer/features/workspace/workspaceIndexOverlay";
import { fileTreeLoadStateAtom, reloadRevisionAtom, workspaceFilesAtom } from "@renderer/store/fileExplorerStore";
import { indexedNoteFileTypesAtom, type NoteFileType } from "@renderer/store/noteFileTypeStore";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

export const NoteFileTypeSync = () => {
  const workspacePath = getWorkspacePath();
  const files = useAtomValue(workspaceFilesAtom);
  const treeState = useAtomValue(fileTreeLoadStateAtom);
  const revision = useAtomValue(reloadRevisionAtom);
  const setTypes = useSetAtom(indexedNoteFileTypesAtom);
  useEffect(() => {
    setTypes({});
    return () => setTypes({});
  }, [workspacePath, setTypes]);
  useEffect(() => {
    if (treeState !== "ready") return;
    let cancelled = false;
    void queryWorkspacePropertyMatches({ key: "type", scalarOnly: true })
      .then((matches) => {
        if (cancelled) return;
        const existingPaths = new Set(files.map((file) => file.path));
        const types: Record<string, NoteFileType> = {};
        for (const { file, values } of matches) {
          if (!existingPaths.has(file.path)) continue;
          const value = values[0];
          if (value?.type === "string" && value.value === "task") {
            types[file.path] = value.value;
          }
        }
        setTypes(types);
      })
      .catch((error) => console.error("Could not load note file icons", error));
    return () => {
      cancelled = true;
    };
  }, [files, revision, setTypes, treeState, workspacePath]);
  return null;
};
