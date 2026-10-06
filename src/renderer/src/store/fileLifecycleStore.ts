import { atom } from "jotai";
import { fileLoadStatesByPathAtom } from "./fileLoadStore";
import { isWorkspaceTransitionActive } from "./workspaceTransitionStore";

import type { FileItem, WorkspaceFileVersion } from "@shared/file-item";
import {
  createRemovedPathMatcher,
  getRelativePathFromPath,
  joinFsPath,
  normalizeFileItemPath,
} from "@shared/pathUtils";

import { bookmarksAtom } from "./bookmarkStore";
import { fileBufferIdentitiesAtom, fileBuffersByPathAtom } from "./fileBufferStore";
import {
  expandedDirectoriesAtom,
  explorerSelectionPathsAtom,
  fileAccessesAtom,
  fileExplorerRevealRequestAtom,
  recentFilesAtom,
  renamingRequestAtom,
} from "./fileExplorerStore";
import { fileConflictReviewRequestAtom, fileSaveStatesByPathAtom } from "./fileSaveStore";
import { remapWorkspaceFileReferencesAtom, removeWorkspaceFileReferencesAtom } from "./workspaceActionStore";

const remapRelativePath = (relativePath: string, remapPath: (path: string) => string, notesDirectoryPath: string) => {
  const absolutePath = joinFsPath(notesDirectoryPath, relativePath);
  const nextAbsolutePath = remapPath(absolutePath);
  return nextAbsolutePath === absolutePath
    ? relativePath
    : getRelativePathFromPath(nextAbsolutePath, notesDirectoryPath);
};

export type RemapFileReferencesPayload = {
  notesDirectoryPath: string;
  remapPath: (path: string) => string;
};

export const remapFileReferencesAtom = atom(
  null,
  (_get, set, { notesDirectoryPath, remapPath }: RemapFileReferencesPayload) => {
    set(remapWorkspaceFileReferencesAtom, { notesDirectoryPath, remapPath });
    set(fileLoadStatesByPathAtom, (states) =>
      Object.fromEntries(Object.entries(states).map(([path, state]) => [remapPath(path), state])),
    );
    set(bookmarksAtom, (bookmarks) =>
      bookmarks.map((bookmark) => {
        const path = remapPath(bookmark.path);
        return path === bookmark.path ? bookmark : normalizeFileItemPath(bookmark, path, notesDirectoryPath);
      }),
    );
    set(recentFilesAtom, (files) =>
      files.map((file) => {
        const path = remapPath(file.path);
        return path === file.path ? file : normalizeFileItemPath(file, path, notesDirectoryPath);
      }),
    );
    set(fileAccessesAtom, (accesses) =>
      Object.fromEntries(Object.entries(accesses).map(([path, accessedAt]) => [remapPath(path), accessedAt])),
    );
    set(explorerSelectionPathsAtom, (paths) => paths.map(remapPath));
    set(expandedDirectoriesAtom, (paths) => {
      const next = new Set<string>();
      paths.forEach((path) => next.add(remapRelativePath(path, remapPath, notesDirectoryPath)));
      return next;
    });
    set(renamingRequestAtom, (request) => {
      if (!request) return request;
      const filePath = remapPath(request.filePath);
      return filePath === request.filePath ? request : { ...request, filePath };
    });
    set(fileExplorerRevealRequestAtom, (request) => {
      if (!request) return request;
      const relativePath = remapRelativePath(request.relativePath, remapPath, notesDirectoryPath);
      return relativePath === request.relativePath ? request : { ...request, relativePath };
    });
    set(fileSaveStatesByPathAtom, (states) => {
      const entries = Object.entries(states);
      const changed = entries.some(([path]) => remapPath(path) !== path);
      return changed ? Object.fromEntries(entries.map(([path, state]) => [remapPath(path), state])) : states;
    });
    set(fileConflictReviewRequestAtom, (request) =>
      request ? { ...request, path: remapPath(request.path) } : request,
    );
  },
);

export type RemoveFileReferencesPayload = {
  notesDirectoryPath: string;
  removedItems: FileItem[];
};

export const removeFileReferencesAtom = atom(
  null,
  (_get, set, { notesDirectoryPath, removedItems }: RemoveFileReferencesPayload) => {
    const wasRemoved = createRemovedPathMatcher(removedItems);
    set(fileLoadStatesByPathAtom, (states) =>
      Object.fromEntries(Object.entries(states).filter(([path]) => !wasRemoved(path))),
    );
    set(removeWorkspaceFileReferencesAtom, { removedItems });
    set(bookmarksAtom, (bookmarks) => bookmarks.filter((bookmark) => !wasRemoved(bookmark.path)));
    set(recentFilesAtom, (files) => files.filter((file) => !wasRemoved(file.path)));
    set(fileAccessesAtom, (accesses) =>
      Object.fromEntries(Object.entries(accesses).filter(([path]) => !wasRemoved(path))),
    );
    set(explorerSelectionPathsAtom, (paths) => paths.filter((path) => !wasRemoved(path)));
    set(expandedDirectoriesAtom, (paths) => {
      const next = new Set<string>();
      paths.forEach((path) => {
        if (!wasRemoved(joinFsPath(notesDirectoryPath, path))) next.add(path);
      });
      return next.size === paths.size ? paths : next;
    });
    set(renamingRequestAtom, (request) => (request && wasRemoved(request.filePath) ? null : request));
    set(fileExplorerRevealRequestAtom, (request) =>
      request && wasRemoved(joinFsPath(notesDirectoryPath, request.relativePath)) ? null : request,
    );
    set(fileSaveStatesByPathAtom, (states) =>
      Object.fromEntries(Object.entries(states).filter(([path]) => !wasRemoved(path))),
    );
    set(fileConflictReviewRequestAtom, (request) => (request && wasRemoved(request.path) ? null : request));
  },
);

export const hydrateFileBufferAtom = atom(
  null,
  (get, set, path: string, content: string, version?: WorkspaceFileVersion) => {
    if (!get(fileBuffersByPathAtom)[path]) {
      set(fileBufferIdentitiesAtom, (identities) => ({ ...identities, [path]: {} }));
    }
    set(fileBuffersByPathAtom, (buffers) =>
      buffers[path]
        ? buffers
        : {
            ...buffers,
            [path]: { savedText: content, editorText: content, ...(version ? { version } : {}) },
          },
    );
    set(fileLoadStatesByPathAtom, (states) =>
      Object.fromEntries(Object.entries(states).filter(([filePath]) => filePath !== path)),
    );
    set(fileSaveStatesByPathAtom, (states) => ({
      ...states,
      [path]: { phase: "saved", savedAt: Date.now() },
    }));
  },
);

export const markFileBufferSavedAtom = atom(
  null,
  (get, set, path: string, content: string, version?: WorkspaceFileVersion) => {
    const buffers = get(fileBuffersByPathAtom);
    const existing = buffers[path];
    if (!existing) return;
    set(fileBuffersByPathAtom, {
      ...buffers,
      [path]: { ...existing, savedText: content, ...(version ? { version } : {}) },
    });
    set(fileSaveStatesByPathAtom, (states) => ({
      ...states,
      [path]: existing.editorText === content ? { phase: "saved", savedAt: Date.now() } : { phase: "dirty" },
    }));
  },
);

export type ExternalFileEditPayload = {
  path: string;
  expectedText: string;
  nextText: string;
};

export const stageExternalFileEditAtom = atom(
  null,
  (get, set, { path, expectedText, nextText }: ExternalFileEditPayload) => {
    if (isWorkspaceTransitionActive()) return false;
    const buffer = get(fileBuffersByPathAtom)[path];
    if (!buffer || buffer.editorText !== expectedText) return false;

    set(fileBuffersByPathAtom, (buffers) => ({
      ...buffers,
      [path]: { ...buffer, editorText: nextText },
    }));
    set(fileSaveStatesByPathAtom, (states) => ({ ...states, [path]: { phase: "dirty" } }));
    return true;
  },
);

export const settleExternalFileEditAtom = atom(
  null,
  (
    get,
    set,
    {
      path,
      expectedText,
      nextText,
      success,
      version,
    }: ExternalFileEditPayload & {
      success: boolean;
      version?: WorkspaceFileVersion;
    },
  ) => {
    const buffers = get(fileBuffersByPathAtom);
    const buffer = buffers[path];
    if (!buffer) return;

    if (success) {
      set(fileBuffersByPathAtom, {
        ...buffers,
        [path]: { ...buffer, savedText: nextText, ...(version ? { version } : {}) },
      });
      set(fileSaveStatesByPathAtom, (states) => ({
        ...states,
        [path]: buffer.editorText === nextText ? { phase: "saved", savedAt: Date.now() } : { phase: "dirty" },
      }));
      return;
    }

    if (buffer.editorText !== nextText) return;
    set(fileBuffersByPathAtom, {
      ...buffers,
      [path]: { ...buffer, editorText: expectedText },
    });
    set(fileSaveStatesByPathAtom, (states) => ({ ...states, [path]: { phase: "dirty" } }));
  },
);
