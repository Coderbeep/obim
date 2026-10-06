import { createStore } from "jotai/vanilla";

import { findItemNode } from "@renderer/features/files/fileTreeUtils";
import { fileBuffersByPathAtom, type FileBufferState } from "@renderer/store/fileBufferStore";
import { removeFileReferencesAtom } from "@renderer/store/fileLifecycleStore";
import { reloadRevisionAtom } from "@renderer/store/fileExplorerStore";
import { fileSaveStatesByPathAtom } from "@renderer/store/fileSaveStore";
import type { FileItem } from "@shared/file-item";
import type { GitRemoteChangedPath } from "@shared/git";
import { joinFsPath } from "@shared/pathUtils";

type Store = ReturnType<typeof createStore>;

export const reloadGitChangedFiles = async ({
  buffersBeforeOperation,
  changes,
  fileTree,
  store,
  workspacePath,
}: {
  buffersBeforeOperation: Readonly<Record<string, FileBufferState>>;
  changes: GitRemoteChangedPath[];
  fileTree: FileItem[];
  store: Store;
  workspacePath: string;
}) => {
  const readableChanges = changes.filter((change) => change.kind !== "deleted");
  const refreshed = await Promise.all(
    readableChanges.map(async (change) => {
      const filePath = joinFsPath(workspacePath, change.path);
      if (!buffersBeforeOperation[filePath]) return null;
      try {
        return { filePath, file: await window.api.openTextFile(filePath) };
      } catch {
        return { filePath, file: null };
      }
    }),
  );
  const refreshedByPath = new Map(
    refreshed
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => [entry.filePath, entry]),
  );
  const currentBuffers = store.get(fileBuffersByPathAtom);
  let skipped = 0;
  const nextBuffers = { ...currentBuffers };
  const safelyDeletedItems: FileItem[] = [];

  for (const change of changes) {
    const filePath = joinFsPath(workspacePath, change.path);
    const before = buffersBeforeOperation[filePath];
    if (!before) continue;
    if (currentBuffers[filePath] !== before) {
      skipped += 1;
      continue;
    }
    if (change.kind === "deleted") {
      const item = findItemNode(fileTree, filePath);
      if (item) safelyDeletedItems.push(item);
      delete nextBuffers[filePath];
      continue;
    }
    const entry = refreshedByPath.get(filePath);
    if (!entry?.file) {
      skipped += 1;
      continue;
    }
    nextBuffers[filePath] = {
      editorText: entry.file.content,
      savedText: entry.file.content,
      version: entry.file.version,
    };
  }

  store.set(fileBuffersByPathAtom, nextBuffers);
  store.set(fileSaveStatesByPathAtom, (current) => {
    const next = { ...current };
    for (const change of changes) {
      const filePath = joinFsPath(workspacePath, change.path);
      if (change.kind === "deleted") delete next[filePath];
      else if (nextBuffers[filePath] && nextBuffers[filePath] !== currentBuffers[filePath]) {
        next[filePath] = { phase: "saved", savedAt: Date.now() };
      }
    }
    return next;
  });
  if (safelyDeletedItems.length > 0) {
    store.set(removeFileReferencesAtom, { notesDirectoryPath: workspacePath, removedItems: safelyDeletedItems });
  }
  store.set(reloadRevisionAtom, (revision) => revision + 1);
  return skipped;
};
