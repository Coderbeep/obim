import type { useStore } from "jotai";

import { saveFile } from "@renderer/features/files/workspaceFileService";
import { markFileBufferSavedAtom } from "@renderer/store/fileLifecycleStore";
import { fileBufferIdentitiesAtom, fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import {
  fileConflictReviewRequestAtom,
  fileSaveStatesByPathAtom,
  pendingFileSavePaths,
} from "@renderer/store/fileSaveStore";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import type { FileOperationResult } from "@shared/file-operations";
import type { WorkspaceFileVersion } from "@shared/file-item";

type FileSaveResult = FileOperationResult<{ version?: WorkspaceFileVersion }>;
export type FileSave = (path: string, content: string, version?: WorkspaceFileVersion) => Promise<FileSaveResult>;
type Store = ReturnType<typeof useStore>;

const pendingSaves = new Map<string, Promise<FileSaveResult>>();

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const notifySaveError = (store: Store, path: string, error: string) => {
  store.set(fileSaveStatesByPathAtom, (states) => ({
    ...states,
    [path]: { phase: "error", message: error },
  }));
  store.set(addNotificationAtom, {
    id: crypto.randomUUID(),
    level: NotificationLevel.ERROR,
    title: "Could not save note",
    path,
    message: error,
    timestamp: Date.now(),
  });
};

export const notifyFileSaveFailure = (
  store: Store,
  path: string,
  result: Extract<FileSaveResult, { success: false }>,
) => {
  if (result.errorCode !== "conflict") {
    notifySaveError(store, path, result.error);
    return;
  }

  store.set(fileSaveStatesByPathAtom, (states) => ({
    ...states,
    [path]: { phase: "conflict", message: result.error },
  }));

  store.set(addNotificationAtom, {
    id: crypto.randomUUID(),
    level: NotificationLevel.WARNING,
    title: "Note changed on disk",
    path,
    message: "Your edits are still safe. Review both versions before choosing which one to keep.",
    timestamp: Date.now(),
    timeout: 0,
    action: {
      label: "Review conflict",
      onClick: () => store.set(fileConflictReviewRequestAtom, { path }),
    },
  });
};

export const saveFileTracked = (
  path: string,
  content: string,
  versionOrSave?: WorkspaceFileVersion | FileSave,
  save: FileSave = saveFile,
) => {
  const version = typeof versionOrSave === "function" ? undefined : versionOrSave;
  const saveOperation = typeof versionOrSave === "function" ? versionOrSave : save;
  const previous = pendingSaves.get(path);
  const operation = (async (): Promise<FileSaveResult> => {
    const previousResult = await previous;
    const expectedVersion = previousResult?.success && previousResult.version ? previousResult.version : version;
    try {
      return expectedVersion ? await saveOperation(path, content, expectedVersion) : await saveOperation(path, content);
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  })();
  pendingSaves.set(path, operation);
  pendingFileSavePaths.add(path);
  void operation.then(() => {
    if (pendingSaves.get(path) === operation) {
      pendingSaves.delete(path);
      pendingFileSavePaths.delete(path);
    }
  });
  return operation;
};

export const waitForPendingFileSaves = async (path?: string) => {
  if (path) {
    await pendingSaves.get(path);
  } else {
    await Promise.all([...pendingSaves.values()]);
  }
};

export const hasPendingFileSaves = () => pendingSaves.size > 0;

export const saveDirtyFileBuffer = async (
  store: Store,
  path: string,
  editorText: string,
  save: FileSave = saveFile,
): Promise<FileOperationResult> => {
  const initial = store.get(fileBuffersByPathAtom)[path];
  if (!initial || initial.savedText === initial.editorText) return { success: true };

  const identity = store.get(fileBufferIdentitiesAtom)[path] ?? {};
  store.set(fileBufferIdentitiesAtom, (identities) => ({ ...identities, [path]: identity }));

  const pending = pendingSaves.get(path);
  const pendingResult = await pending;
  const current = store.get(fileBuffersByPathAtom)[path];
  if (!current || current.editorText !== editorText) {
    const error = "File changed while the save was pending";
    notifySaveError(store, path, error);
    return { success: false, error };
  }
  if (current.savedText === editorText) return { success: true };

  const expectedVersion = pendingResult?.success && pendingResult.version ? pendingResult.version : current.version;
  store.set(fileSaveStatesByPathAtom, (states) => ({ ...states, [path]: { phase: "saving" } }));
  const result = await saveFileTracked(path, editorText, expectedVersion, save);
  if (!result.success) {
    notifyFileSaveFailure(store, path, result);
    return result;
  }

  const savedPath = Object.entries(store.get(fileBufferIdentitiesAtom)).find(([, value]) => value === identity)?.[0];
  if (!savedPath || !store.get(fileBuffersByPathAtom)[savedPath]) {
    return { success: false, error: "The saved buffer is no longer open" };
  }
  // A completed write advances the persisted snapshot even when newer typing remains dirty.
  store.set(markFileBufferSavedAtom, savedPath, editorText, result.version);
  if (store.get(fileBuffersByPathAtom)[savedPath]?.editorText !== editorText) {
    return { success: false, error: "File changed while the save was pending. Save again before continuing." };
  }

  return { success: true };
};

export const saveDirtyFileBuffers = async (
  store: Store,
  matches: (path: string) => boolean = () => true,
  save: FileSave = saveFile,
): Promise<FileOperationResult> => {
  await Promise.all([...pendingSaves].filter(([path]) => matches(path)).map(([, operation]) => operation));
  const dirtyBuffers = Object.entries(store.get(fileBuffersByPathAtom)).filter(
    ([path, buffer]) => matches(path) && buffer.savedText !== buffer.editorText,
  );

  for (const [path, buffer] of dirtyBuffers) {
    const result = await saveDirtyFileBuffer(store, path, buffer.editorText, save);
    if (!result.success) return result;
  }
  const changed = Object.entries(store.get(fileBuffersByPathAtom)).find(
    ([path, buffer]) => matches(path) && (buffer.savedText !== buffer.editorText || pendingSaves.has(path)),
  );
  if (changed) {
    const error = "File changed while saving. Save again before continuing.";
    notifySaveError(store, changed[0], error);
    return { success: false, error };
  }
  return { success: true };
};
