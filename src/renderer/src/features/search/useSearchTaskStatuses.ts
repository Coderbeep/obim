import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { getWorkspacePath } from "@renderer/config";
import { queryWorkspacePropertyMatches } from "@renderer/features/workspace/workspaceIndexOverlay";
import { parseTaskMarkdown } from "@renderer/features/task-board/taskBoardFiles";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { reloadRevisionAtom } from "@renderer/store/fileExplorerStore";
import { createBufferedWorkspaceIndexFile } from "@shared/workspace-index";
import { isMarkdownFile } from "@shared/mime-types";

type TaskStatus = "open" | "done" | "cancelled";
const EMPTY_STATUSES = new Map<string, TaskStatus>();

/** Reads indexed metadata only; open editor buffers override the saved status. */
export function useSearchTaskStatuses(enabled: boolean) {
  const workspace = getWorkspacePath();
  const revision = useAtomValue(reloadRevisionAtom);
  const buffers = useAtomValue(fileBuffersByPathAtom);
  const [indexed, setIndexed] = useState({ workspace: "", statuses: new Map<string, TaskStatus>() });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      queryWorkspacePropertyMatches({ key: "type", value: { type: "string", value: "task" }, scalarOnly: true }),
      queryWorkspacePropertyMatches({ key: "task-status", scalarOnly: true }),
    ])
      .then(([types, states]) => {
        if (cancelled) return;
        const statuses = new Map<string, TaskStatus>(
          types
            .filter(({ values }) => values.some((value) => value.type === "string" && value.value === "task"))
            .map(({ file }) => [file.path, "open"]),
        );
        for (const { file, values } of states) {
          const value = values[0];
          if (
            statuses.has(file.path) &&
            value?.type === "string" &&
            (value.value === "done" || value.value === "cancelled")
          ) {
            statuses.set(file.path, value.value);
          }
        }
        setIndexed({ workspace, statuses });
      })
      .catch(() => {
        if (!cancelled) setError("Task statuses are temporarily unavailable.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, revision, workspace]);
  const statuses = useMemo(() => {
    if (!enabled) return EMPTY_STATUSES;
    const result = new Map(indexed.workspace === workspace ? indexed.statuses : []);
    for (const [path, buffer] of Object.entries(buffers)) {
      if (!buffer || !isMarkdownFile(null, path)) continue;
      const task = parseTaskMarkdown(buffer.editorText, createBufferedWorkspaceIndexFile(path, workspace));
      if (task) result.set(path, task.status);
      else result.delete(path);
    }
    return result;
  }, [buffers, enabled, indexed, workspace]);
  return { statuses, error, loading };
}
