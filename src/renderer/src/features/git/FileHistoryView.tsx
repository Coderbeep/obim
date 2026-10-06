import { workspaceMutationApi } from "@renderer/features/files/workspaceMutationApi";
import { IconClockArrow, IconFileText, IconRefresh } from "@pierre/icons";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { saveDirtyFileBuffer } from "@renderer/features/files/dirtyFileBuffers";
import { Button } from "@renderer/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/shared/ui/dialog";
import { activateWorkspaceResourceAtom } from "@renderer/store/workspaceActionStore";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { reloadRevisionAtom } from "@renderer/store/fileExplorerStore";
import { fileSaveStatesByPathAtom } from "@renderer/store/fileSaveStore";
import type { GitFileHistoryEntry, GitFileHistoryPage, GitFileRevisionResult } from "@shared/git";
import { GIT_FILE_HISTORY_PAGE_SIZE } from "@shared/git";
import { basename } from "@shared/pathUtils";
import { createFileWorkspaceItem, type FileHistoryWorkspaceItem } from "@shared/workspace";

import "./FileHistoryView.css";

const historyDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatHistoryDate = (value: number) => historyDateFormatter.format(new Date(value));

const appendHistoryPage = (current: GitFileHistoryPage, next: GitFileHistoryPage): GitFileHistoryPage => {
  if (current.status !== "ready" || next.status !== "ready") return next;
  const known = new Set(current.entries.map((entry) => entry.revisionId));
  return {
    ...next,
    entries: [...current.entries, ...next.entries.filter((entry) => !known.has(entry.revisionId))],
  };
};

const historyKindLabel = (entry: GitFileHistoryEntry): string | null => {
  if (entry.changeKind === "deleted") return "File deleted";
  if (entry.changeKind === "renamed") return "File renamed";
  if (entry.changeKind === "added") return "File added";
  return null;
};

const FileHistoryEmptyState = ({ history }: { history: GitFileHistoryPage | null }) => {
  if (!history)
    return (
      <div className="file-history-state" role="status">
        Loading versions…
      </div>
    );
  if (history.status === "not-repository") {
    return (
      <div className="file-history-state">
        <IconClockArrow size={24} />
        <strong>Version history is not set up</strong>
        <span>Start local version history from the sidebar before recording versions.</span>
      </div>
    );
  }
  if (history.status === "no-history") {
    return (
      <div className="file-history-state">
        <IconClockArrow size={24} />
        <strong>No saved versions yet</strong>
        <span>This file will appear here after a local version is saved.</span>
      </div>
    );
  }
  if (history.status === "unavailable") {
    return (
      <div className="file-history-state" role="alert">
        <IconClockArrow size={24} />
        <strong>Versions are unavailable</strong>
        <span>{history.error}</span>
      </div>
    );
  }
  return null;
};

const RevisionDocument = ({
  currentContent,
  revision,
}: {
  currentContent: string | null | undefined;
  revision: GitFileRevisionResult | null;
}) => {
  if (!revision)
    return (
      <div className="file-history-inspection-state" role="status">
        Loading document…
      </div>
    );
  if (revision.status === "ready") {
    return (
      <div className="file-history-comparison">
        <section>
          <strong>Selected version</strong>
          <pre className="file-history-document">{revision.content}</pre>
        </section>
        <section>
          <strong>Current note</strong>
          {currentContent === undefined ? (
            <div className="file-history-comparison-state">Loading current note…</div>
          ) : currentContent === null ? (
            <div className="file-history-comparison-state">Current contents are unavailable.</div>
          ) : (
            <pre className="file-history-document">{currentContent}</pre>
          )}
        </section>
      </div>
    );
  }
  if (revision.status === "binary") {
    return (
      <div className="file-history-inspection-state">
        <strong>Binary file</strong>
        <span>This version is {revision.sizeBytes.toLocaleString()} bytes and cannot be shown as text.</span>
      </div>
    );
  }
  if (revision.status === "deleted") {
    return (
      <div className="file-history-inspection-state">
        <strong>The file did not exist after this version</strong>
        <span>Select an earlier version to inspect or restore its contents.</span>
      </div>
    );
  }
  if (revision.status === "too-large") {
    return (
      <div className="file-history-inspection-state">
        <strong>Historical file is too large to preview</strong>
        <span>{revision.sizeBytes.toLocaleString()} bytes</span>
      </div>
    );
  }
  return (
    <div className="file-history-inspection-state" role="alert">
      {revision.error}
    </div>
  );
};

export const FileHistoryView = ({ item }: { item: FileHistoryWorkspaceItem }) => {
  const store = useStore();
  const activateResource = useSetAtom(activateWorkspaceResourceAtom);
  const setBuffers = useSetAtom(fileBuffersByPathAtom);
  const setFileSaveStates = useSetAtom(fileSaveStatesByPathAtom);
  const requestTreeReload = useSetAtom(reloadRevisionAtom);
  const currentBuffer = useAtomValue(fileBuffersByPathAtom)[item.file.path];
  const [history, setHistory] = useState<GitFileHistoryPage | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [revision, setRevision] = useState<GitFileRevisionResult | null>(null);
  const [currentContent, setCurrentContent] = useState<string | null | undefined>(undefined);
  const [repositoryRevision, setRepositoryRevision] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshPendingRef = useRef(false);

  const loadHistory = useCallback(() => {
    if (refreshPromiseRef.current) {
      refreshPendingRef.current = true;
      return refreshPromiseRef.current;
    }
    const request = (async () => {
      setLoadingHistory(true);
      try {
        const next = await window.api.getGitFileHistory(item.file.path, undefined, GIT_FILE_HISTORY_PAGE_SIZE);
        setHistory(next);
        if (next.status === "ready") {
          setSelectedRevisionId((selected) =>
            selected && next.entries.some((entry) => entry.revisionId === selected)
              ? selected
              : (next.entries[0]?.revisionId ?? null),
          );
        } else {
          setSelectedRevisionId(null);
        }
      } catch (error) {
        setHistory({
          status: "unavailable",
          entries: [],
          error: error instanceof Error ? error.message : "Git versions are unavailable.",
        });
      } finally {
        setLoadingHistory(false);
      }
    })();
    refreshPromiseRef.current = request;
    void request.finally(() => {
      if (refreshPromiseRef.current !== request) return;
      refreshPromiseRef.current = null;
      if (refreshPendingRef.current) {
        refreshPendingRef.current = false;
        void loadHistory();
      }
    });
    return request;
  }, [item.file.path]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, repositoryRevision]);

  useEffect(
    () =>
      window.api.onGitFileStatusChanged((event) => {
        if (event.historyMayHaveChanged) setRepositoryRevision((value) => value + 1);
      }),
    [],
  );

  const entries = history?.status === "ready" ? history.entries : [];
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.revisionId === selectedRevisionId) ?? null,
    [entries, selectedRevisionId],
  );
  const selectedRevisionRequest = useMemo(
    () =>
      selectedEntry
        ? {
            filePath: item.file.path,
            pathAtRevision: selectedEntry.pathAtRevision,
            revisionId: selectedEntry.revisionId,
            restoreToken: selectedEntry.restoreToken,
          }
        : null,
    [item.file.path, selectedEntry?.pathAtRevision, selectedEntry?.restoreToken, selectedEntry?.revisionId],
  );

  useEffect(() => {
    if (!selectedRevisionRequest) {
      setRevision(null);
      return;
    }

    let cancelled = false;
    setRevision(null);
    void window.api
      .getGitFileRevision(selectedRevisionRequest)
      .then((nextRevision) => {
        if (cancelled) return;
        setRevision(nextRevision);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "The selected version is unavailable.";
        setRevision({ status: "failed", error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRevisionRequest]);

  useEffect(() => {
    if (currentBuffer) {
      setCurrentContent(currentBuffer.editorText);
      return;
    }
    let cancelled = false;
    setCurrentContent(undefined);
    void window.api
      .openTextFile(item.file.path)
      .then((opened) => {
        if (!cancelled) setCurrentContent(opened.content);
      })
      .catch(() => {
        if (!cancelled) setCurrentContent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentBuffer, item.file.path]);

  const loadOlder = async () => {
    if (history?.status !== "ready" || !history.nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const next = await window.api.getGitFileHistory(item.file.path, history.nextCursor, GIT_FILE_HISTORY_PAGE_SIZE);
      setHistory((current) => (current ? appendHistoryPage(current, next) : next));
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Older versions could not be loaded.",
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  const openNote = () => {
    const note = createFileWorkspaceItem(item.file);
    activateResource({ item: note, resourceKey: note.key });
  };

  const restore = async () => {
    if (!selectedEntry || restoreBusy || (revision?.status !== "ready" && revision?.status !== "binary")) return;
    setRestoreBusy(true);
    setFeedback(null);
    try {
      const buffer = store.get(fileBuffersByPathAtom)[item.file.path];
      if (buffer && buffer.savedText !== buffer.editorText) {
        const saved = await saveDirtyFileBuffer(store, item.file.path, buffer.editorText);
        if (!saved.success) {
          setFeedback({ kind: "error", text: saved.error });
          return;
        }
      }

      const expectedVersion = store.get(fileBuffersByPathAtom)[item.file.path]?.version ?? item.file.version;
      if (!expectedVersion) {
        setFeedback({ kind: "error", text: "The current file version is unavailable. Reopen the note and try again." });
        return;
      }

      const result = await workspaceMutationApi.restoreGitFileRevision({
        expectedVersion,
        filePath: item.file.path,
        pathAtRevision: selectedEntry.pathAtRevision,
        revisionId: selectedEntry.revisionId,
        restoreToken: selectedEntry.restoreToken,
      });
      if (result.status === "failed") {
        setFeedback({ kind: "error", text: result.error });
        return;
      }

      const restoredContent = result.content;
      if (restoredContent !== undefined) {
        setBuffers((buffers) => ({
          ...buffers,
          [item.file.path]: {
            editorText: restoredContent,
            savedText: restoredContent,
            version: result.version,
          },
        }));
        setFileSaveStates((states) => ({
          ...states,
          [item.file.path]: { phase: "saved", savedAt: Date.now() },
        }));
      }
      requestTreeReload((value) => value + 1);
      setRestoreOpen(false);
      setFeedback({
        kind: "success",
        text: result.recoveryPath
          ? `Version restored. Your previous contents are in ${basename(result.recoveryPath)}.`
          : "Version restored as a new local change. Later versions remain in history.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "The historical version could not be restored.",
      });
    } finally {
      setRestoreBusy(false);
    }
  };

  const hasDirtyBuffer = Boolean(currentBuffer && currentBuffer.savedText !== currentBuffer.editorText);
  const repositoryScope =
    history?.status === "ready" || history?.status === "no-history" ? history.repositoryScope : null;
  const restoreDisabled =
    repositoryScope !== "workspace" || (revision?.status !== "ready" && revision?.status !== "binary");

  return (
    <div className="file-history-view" aria-label={`Version history for ${item.file.filename}`}>
      <header className="file-history-toolbar">
        <div className="file-history-toolbar-title">
          <div>
            <strong>{item.file.filename}</strong>
            <span>Version history</span>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={openNote}>
          <IconFileText size={14} />
          Open note
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="file-history-refresh"
          aria-label="Refresh version history"
          title="Refresh"
          disabled={loadingHistory}
          onClick={() => void loadHistory()}
        >
          <IconRefresh size={14} />
        </Button>
      </header>

      {history?.status === "ready" ? (
        <div className="file-history-content">
          <aside className="file-history-timeline" aria-label="File versions">
            <div className="file-history-section-toolbar file-history-timeline-heading">
              <strong>Versions</strong>
              <span>Only versions that changed this file</span>
            </div>
            <div className="file-history-revisions" role="listbox" aria-label="Historical versions">
              {entries.map((entry) => {
                const kindLabel = historyKindLabel(entry);
                return (
                  <button
                    type="button"
                    className="file-history-revision"
                    role="option"
                    aria-selected={entry.revisionId === selectedRevisionId}
                    key={entry.revisionId}
                    onClick={() => {
                      setSelectedRevisionId(entry.revisionId);
                      setFeedback(null);
                    }}
                  >
                    <span className="file-history-revision-dot" aria-hidden="true" />
                    <span className="file-history-revision-content">
                      <strong>{entry.subject}</strong>
                      <span>{formatHistoryDate(entry.committedAt)}</span>
                      {kindLabel ? <span className="file-history-revision-kind">{kindLabel}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
            {history.nextCursor ? (
              <Button
                type="button"
                variant="ghost"
                className="file-history-load-older"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
              >
                {loadingOlder ? "Loading…" : "Load older versions"}
              </Button>
            ) : null}
          </aside>

          <section className="file-history-inspector" aria-label="Selected version">
            {selectedEntry ? (
              <>
                <div className="file-history-section-toolbar file-history-inspector-toolbar">
                  <div className="file-history-selected-title">
                    <strong>{selectedEntry.subject}</strong>
                    <span>
                      {formatHistoryDate(selectedEntry.committedAt)}
                      {selectedEntry.author ? ` · ${selectedEntry.author}` : ""}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={restoreDisabled}
                    title={repositoryScope === "ancestor" ? "Restore is disabled for parent repositories" : undefined}
                    onClick={() => setRestoreOpen(true)}
                  >
                    Restore
                  </Button>
                </div>
                <div className="file-history-inspection-body" aria-live="polite">
                  <RevisionDocument currentContent={currentContent} revision={revision} />
                </div>
              </>
            ) : (
              <div className="file-history-inspection-state">Select a version to inspect.</div>
            )}
          </section>
        </div>
      ) : (
        <FileHistoryEmptyState history={history} />
      )}

      {feedback ? (
        <p
          className="file-history-feedback"
          data-kind={feedback.kind}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      ) : null}

      <Dialog open={restoreOpen} onOpenChange={(open) => !restoreBusy && setRestoreOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore this version?</DialogTitle>
            <DialogDescription>
              {hasDirtyBuffer
                ? "Your editor changes will be saved first. A recovery copy of those current contents will be kept beside the note before the selected version replaces it."
                : "A recovery copy of the current contents will be kept beside the note before the selected version replaces it."}{" "}
              Later versions also remain in history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={restoreBusy} onClick={() => setRestoreOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={restoreBusy} onClick={() => void restore()}>
              {restoreBusy ? "Restoring…" : hasDirtyBuffer ? "Save and restore" : "Restore as new change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
