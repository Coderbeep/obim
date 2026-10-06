import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@renderer/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/shared/ui/dialog";
import { markFileBufferSavedAtom } from "@renderer/store/fileLifecycleStore";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { reloadRevisionAtom } from "@renderer/store/fileExplorerStore";
import { fileConflictReviewRequestAtom, fileSaveStatesByPathAtom } from "@renderer/store/fileSaveStore";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import type { WorkspaceFileVersion } from "@shared/file-item";
import { basename, getExt, getPathWithoutFilename, stripLastExt } from "@shared/pathUtils";

import { notifyFileSaveFailure, saveFileTracked } from "./dirtyFileBuffers";
import { createFile, readTextFile } from "./workspaceFileService";

type DiskVersion = {
  content: string;
  version?: WorkspaceFileVersion;
};

const conflictCopyName = (path: string, attempt: number) => {
  const filename = basename(path);
  const extension = getExt(filename);
  const base = stripLastExt(filename);
  const suffix = attempt === 1 ? "" : ` ${attempt}`;
  return `${base} — conflict copy${suffix}${extension}`;
};

export const FileConflictDialog = () => {
  const store = useStore();
  const [request, setRequest] = useAtom(fileConflictReviewRequestAtom);
  const buffers = useAtomValue(fileBuffersByPathAtom);
  const setSaveStates = useSetAtom(fileSaveStatesByPathAtom);
  const requestReload = useSetAtom(reloadRevisionAtom);
  const notify = useSetAtom(addNotificationAtom);
  const loadRevision = useRef(0);
  const [diskReadState, setDiskReadState] = useState<"loading" | "missing" | "unreadable" | "loaded">("loading");
  const [diskVersion, setDiskVersion] = useState<DiskVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"keep" | "reload" | "copy" | null>(null);
  const path = request?.path ?? "";
  const editorText = path ? (buffers[path]?.editorText ?? "") : "";

  const close = useCallback(() => {
    setRequest(null);
    setDiskVersion(null);
    setError(null);
    setBusyAction(null);
  }, [setRequest]);

  const loadDiskVersion = useCallback(async () => {
    if (!path) return;
    const revision = ++loadRevision.current;
    setDiskVersion(null);
    setDiskReadState("loading");
    setError(null);
    const result = await readTextFile(path);
    if (revision !== loadRevision.current || store.get(fileConflictReviewRequestAtom)?.path !== path) return;
    if (!result.success) {
      setDiskReadState(/ENOENT|no such file|file not found/i.test(result.error) ? "missing" : "unreadable");
      setError(result.error);
      return;
    }
    setDiskReadState("loaded");
    setDiskVersion({ content: result.content, version: result.version });
  }, [path, store]);

  useEffect(() => {
    if (path) void loadDiskVersion();
  }, [loadDiskVersion, path]);

  const applyDiskVersion = () => {
    if (!path || !diskVersion) return;
    store.set(fileBuffersByPathAtom, (current) =>
      current[path] && current[path].editorText === editorText
        ? {
            ...current,
            [path]: {
              savedText: diskVersion.content,
              editorText: diskVersion.content,
              ...(diskVersion.version ? { version: diskVersion.version } : {}),
            },
          }
        : current,
    );
    setSaveStates((states) => ({ ...states, [path]: { phase: "saved", savedAt: Date.now() } }));
  };

  const keepEditorVersion = async () => {
    if (!path || !diskVersion?.version) return;
    setBusyAction("keep");
    const result = await saveFileTracked(path, editorText, diskVersion.version);
    if (!result.success) {
      notifyFileSaveFailure(store, path, result);
      setError(result.error);
      setBusyAction(null);
      if (result.errorCode === "conflict") await loadDiskVersion();
      return;
    }
    store.set(markFileBufferSavedAtom, path, editorText, result.version);
    close();
  };

  const reloadDiskVersion = () => {
    setBusyAction("reload");
    applyDiskVersion();
    close();
  };

  const saveCopyAndReload = async () => {
    if (!path || !buffers[path]) return;
    setBusyAction("copy");
    const directory = getPathWithoutFilename(path);
    let result = await createFile(directory, conflictCopyName(path, 1), editorText);
    let attempt = 2;
    while (!result.success && result.error === "Destination file already exists" && attempt <= 50) {
      result = await createFile(directory, conflictCopyName(path, attempt), editorText);
      attempt += 1;
    }
    if (!result.success) {
      setError(result.error);
      setBusyAction(null);
      return;
    }

    requestReload((revision) => revision + 1);
    notify({
      id: crypto.randomUUID(),
      level: NotificationLevel.INFO,
      title: "Saved a conflict copy",
      message: `${result.file.relativePath || result.file.path} contains your edits.${
        diskVersion && store.get(fileBuffersByPathAtom)[path]?.editorText === editorText
          ? " The original now shows the disk version."
          : " The original draft remains available in the editor."
      }`,
      timestamp: Date.now(),
    });
    applyDiskVersion();
    close();
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[min(42rem,90vh)] max-w-[min(64rem,94vw)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[var(--border-default)] bg-[var(--surface-2)] px-5 py-4 pr-12">
          <DialogTitle>Review changes from outside Obim</DialogTitle>
          <DialogDescription>
            {diskReadState === "missing"
              ? "The original note was deleted or moved. Save your surviving edits as a copy to preserve them."
              : "The note changed on disk after you opened it. Your edits are still safe until you choose a version."}
          </DialogDescription>
          <code className="mt-2 block truncate text-ui-meta text-muted-foreground" title={path}>
            {path}
          </code>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto p-5">
          {error ? (
            <div
              className="mb-4 flex items-center justify-between gap-4 border border-[var(--danger)] bg-[var(--chip-danger)] px-3 py-2 text-ui-control text-[var(--danger)]"
              role="alert"
            >
              <span>{error}</span>
              <Button type="button" size="xs" variant="outline" onClick={() => void loadDiskVersion()}>
                Retry
              </Button>
            </div>
          ) : null}

          <div className="grid min-h-[18rem] grid-cols-1 gap-3 md:grid-cols-2">
            <section className="flex min-h-0 flex-col border border-[var(--border-default)] bg-[var(--surface-1)]">
              <h3 className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-ui-control font-semibold">
                Your edits
              </h3>
              <pre className="min-h-0 flex-1 select-text overflow-auto whitespace-pre-wrap p-3 text-ui-body leading-5">
                {editorText}
              </pre>
            </section>
            <section className="flex min-h-0 flex-col border border-[var(--border-default)] bg-[var(--surface-1)]">
              <h3 className="border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2 text-ui-control font-semibold">
                Version on disk
              </h3>
              <pre className="min-h-0 flex-1 select-text overflow-auto whitespace-pre-wrap p-3 text-ui-body leading-5">
                {diskVersion?.content ??
                  (diskReadState === "missing"
                    ? "The original file is missing."
                    : diskReadState === "unreadable"
                      ? "The disk version could not be read. You can still save your edits as a copy."
                      : "Loading the disk version…")}
              </pre>
            </section>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 border-t border-[var(--border-default)] bg-[var(--surface-2)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
          <Button type="button" variant="ghost" onClick={close} disabled={Boolean(busyAction)}>
            Decide later
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => void saveCopyAndReload()}
              disabled={!buffers[path] || Boolean(busyAction)}
            >
              {busyAction === "copy" ? "Saving copy…" : "Save my edits as a copy"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={reloadDiskVersion}
              disabled={!diskVersion || Boolean(busyAction)}
            >
              Use disk version
            </Button>
            <Button
              type="button"
              onClick={() => void keepEditorVersion()}
              disabled={!diskVersion?.version || Boolean(busyAction)}
            >
              {busyAction === "keep" ? "Saving…" : "Keep my edits"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
