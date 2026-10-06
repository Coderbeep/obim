import { IconCheck, IconTerminal } from "@pierre/icons";
import { getMarkdownSidebarInfo } from "@renderer/features/editor/inspector/documentInfo";
import { IconGitBranch } from "@renderer/shared/icons/IconGitBranch";
import { actionRunnerRequestAtom } from "@renderer/store/actionRunnerStore";
import { shortcutHelpOpenAtom } from "@renderer/store/appSessionStore";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { fileSaveStatesByPathAtom } from "@renderer/store/fileSaveStore";
import { isVisibleAtom } from "@renderer/store/SearchWindowStore";
import { currentWorkspaceItemAtom } from "@renderer/store/workspaceResourceStore";
import type { GitFileStatusSnapshot } from "@shared/git";
import { isLargeTextFile } from "@shared/large-files";
import { isMarkdownFile } from "@shared/mime-types";
import { isFileWorkspaceItem } from "@shared/workspace";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { primaryShortcutLabel } from "./ShortcutHelpCard";
import "./StatusBar.css";

function useGitSummary() {
  const [snapshot, setSnapshot] = useState<GitFileStatusSnapshot | null>(null);
  useEffect(() => {
    let disposed = false;
    let running = false;
    let pending = false;
    const refresh = async () => {
      if (running) {
        pending = true;
        return;
      }
      if (!window.api.getGitFileStatus) return;
      running = true;
      try {
        do {
          pending = false;
          const next = await window.api.getGitFileStatus();
          if (!disposed) setSnapshot(next);
        } while (pending && !disposed);
      } catch {
        if (!disposed) setSnapshot({ status: "unavailable", changes: [], error: "Git status unavailable" });
      } finally {
        running = false;
      }
    };
    void refresh();
    const unsubscribe = window.api.onGitFileStatusChanged?.(() => void refresh());
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
  return snapshot;
}

export function StatusBar() {
  const item = useAtomValue(currentWorkspaceItemAtom);
  const buffers = useAtomValue(fileBuffersByPathAtom);
  const saveStates = useAtomValue(fileSaveStatesByPathAtom);
  const showHelp = useSetAtom(shortcutHelpOpenAtom);
  const showCommands = useSetAtom(actionRunnerRequestAtom);
  const showSearch = useSetAtom(isVisibleAtom);
  const git = useGitSummary();
  const file = isFileWorkspaceItem(item) ? item.file : null;
  const buffer = file ? buffers[file.path] : undefined;
  const text = buffer?.editorText ?? "";
  const [settled, setSettled] = useState({ path: file?.path, text });
  useEffect(() => {
    const timeout = window.setTimeout(() => setSettled({ path: file?.path, text }), 150);
    return () => window.clearTimeout(timeout);
  }, [file?.path, text]);
  const canCount = file && buffer && !isLargeTextFile(file);
  const markdown = file && isMarkdownFile(file.mimeType, file.path);
  const counts = useMemo(() => {
    if (!canCount || settled.path !== file.path) return null;
    if (markdown) return getMarkdownSidebarInfo(settled.text).stats;
    return {
      words: settled.text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu)?.length ?? 0,
      characters: settled.text.length,
      lines: settled.text ? settled.text.split(/\r\n|\r|\n/).length : 0,
    };
  }, [canCount, file?.path, markdown, settled]);
  const save = file ? saveStates[file.path] : undefined;
  const phase =
    buffer && buffer.editorText !== buffer.savedText && save?.phase === "saved"
      ? "dirty"
      : (save?.phase ?? (buffer && buffer.editorText !== buffer.savedText ? "dirty" : "saved"));
  const saveLabel = {
    dirty: "Unsaved",
    saving: "Saving…",
    saved: "Saved",
    error: "Save failed",
    conflict: "Save conflict",
  }[phase];
  const primary = primaryShortcutLabel();
  return (
    <footer className="app-status-bar" aria-label="Workspace status">
      <div className="app-status-group app-status-context">
        {git?.status === "ready" && (
          <span
            className="app-status-git"
            title={`Git · ${git.changes.length} changed files${git.mergeInProgress ? " · Merge in progress" : ""}`}
          >
            <IconGitBranch size={13} aria-hidden="true" />
            <span>
              {git.changes.some((change) => change.conflicted)
                ? "Conflicts"
                : git.changes.length
                  ? `${git.changes.length} changed`
                  : "Clean"}
            </span>
          </span>
        )}
        {git?.status === "unavailable" && <span title={git.error}>Git unavailable</span>}
        {buffer && (
          <span
            className="app-status-save"
            data-attention={phase === "error" || phase === "conflict" || undefined}
            title={save?.message ?? saveLabel}
          >
            {phase === "saved" && <IconCheck size={12} aria-hidden="true" />}
            {saveLabel}
          </span>
        )}
      </div>
      <div className="app-status-group app-status-details">
        {counts && (
          <>
            <span>{counts.words.toLocaleString()} words</span>
            <span>{counts.characters.toLocaleString()} characters</span>
            <span className="app-status-extra">{counts.lines.toLocaleString()} lines</span>
          </>
        )}
        {canCount && <span className="app-status-extra">{markdown ? "Markdown" : "Plain text"}</span>}
        <button
          className="app-status-commands"
          onClick={() => {
            showSearch(false);
            showCommands({ view: "commands" });
          }}
          title={`Commands (${primary} Shift P)`}
        >
          <IconTerminal size={13} aria-hidden="true" />
          <span>Commands</span>
          <kbd>{primary} ⇧ P</kbd>
        </button>
        <button
          className="app-status-help"
          onClick={() => showHelp((value) => !value)}
          title={`Keyboard shortcuts (${primary} /)`}
        >
          <kbd>{primary} /</kbd>
          <span>Shortcuts</span>
        </button>
      </div>
    </footer>
  );
}
