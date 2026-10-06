import { isWorkspaceTransitionActive } from "./workspaceTransitionStore";
import { atom } from "jotai";
import { selectAtom } from "jotai/utils";
import { currentFilePathAtom } from "./workspaceResourceStore";
import type { WorkspaceFileVersion } from "@shared/file-item";
import { rewriteNoteLinks } from "@shared/note-link-updates";
import { isMarkdownFile } from "@shared/mime-types";
import type { NoteLinkMovePaths, NoteLinkUpdate } from "@shared/file-operations";

export interface FileBufferState {
  savedText: string;
  editorText: string;
  version?: WorkspaceFileVersion;
}

export const EMPTY_BUFFER: FileBufferState = { savedText: "", editorText: "" };

const buffersAtom = atom<Record<string, FileBufferState>>({});
/** A committed link transaction owns the frozen, saved snapshots of all open notes. */
export const applyNoteLinkUpdatesAtom = atom(null, (get, set, updates: NoteLinkUpdate[]) => {
  const buffers = { ...get(buffersAtom) };
  for (const update of updates) {
    const buffer = buffers[update.path];
    if (!buffer || buffer.savedText !== update.previousContent) continue;
    buffers[update.path] = {
      savedText: update.content,
      editorText: buffer.editorText === update.previousContent ? update.content : buffer.editorText,
      version: update.version,
    };
  }
  set(buffersAtom, buffers);
});
/** Rewrites the latest draft, including typing accepted while the disk transaction was running. */
export const applyBackgroundNoteLinkMoveAtom = atom(
  null,
  (get, set, { updates, move, root }: { updates: NoteLinkUpdate[]; move: NoteLinkMovePaths; root: string }) => {
    const previous = get(buffersAtom);
    set(applyNoteLinkUpdatesAtom, updates);
    const buffers = { ...get(buffersAtom) };
    for (const [path, buffer] of Object.entries(buffers)) {
      if (!isMarkdownFile(null, path)) continue;
      const sourceAfter = path.slice(root.replace(/\/$/, "").length + 1);
      const index = move.afterPaths.indexOf(sourceAfter);
      if (index < 0) continue;
      const editorText = rewriteNoteLinks(previous[path].editorText, {
        ...move,
        sourceBefore: move.beforePaths[index],
        sourceAfter,
      });
      buffers[path] = { ...buffer, editorText };
    }
    set(buffersAtom, buffers);
  },
);
type BufferUpdate =
  Record<string, FileBufferState> | ((buffers: Record<string, FileBufferState>) => Record<string, FileBufferState>);
export const fileBuffersByPathAtom = atom(
  (get) => get(buffersAtom),
  (get, set, update: BufferUpdate) => {
    const previous = get(buffersAtom);
    let next = typeof update === "function" ? update(previous) : update;
    if (isWorkspaceTransitionActive()) {
      next = Object.fromEntries(
        Object.entries(next).flatMap(([path, buffer]) => {
          const old = previous[path];
          if (old && old.editorText !== buffer.editorText) return [[path, { ...buffer, editorText: old.editorText }]];
          if (!old && buffer.editorText !== buffer.savedText && !Object.values(previous).includes(buffer)) return [];
          return [[path, buffer]];
        }),
      );
    }
    set(buffersAtom, next);
  },
);

// Stable identities survive edits and path remapping without becoming persisted document data.
export const fileBufferIdentitiesAtom = atom<Record<string, object>>({});

export const createEditorTextAtom = (filePath: string) =>
  selectAtom(fileBuffersByPathAtom, (buffers) => buffers[filePath]?.editorText ?? "");

const currentBufferAtom = atom((get) => {
  const currentFilePath = get(currentFilePathAtom);
  if (!currentFilePath) return EMPTY_BUFFER;
  return get(fileBuffersByPathAtom)[currentFilePath] ?? EMPTY_BUFFER;
});

export const noteTextAtom = atom(
  (get) => get(currentBufferAtom).savedText,
  (get, set, value: string) => {
    const currentFilePath = get(currentFilePathAtom);
    if (!currentFilePath) return;

    set(fileBuffersByPathAtom, (prev) => {
      const previousBuffer = prev[currentFilePath] ?? EMPTY_BUFFER;
      return {
        ...prev,
        [currentFilePath]: {
          ...previousBuffer,
          savedText: value,
        },
      };
    });
  },
);

export const editorNoteTextAtom = atom(
  (get) => get(currentBufferAtom).editorText,
  (get, set, value: string) => {
    const currentFilePath = get(currentFilePathAtom);
    if (!currentFilePath) return;

    set(fileBuffersByPathAtom, (prev) => {
      const previousBuffer = prev[currentFilePath] ?? EMPTY_BUFFER;
      return {
        ...prev,
        [currentFilePath]: {
          ...previousBuffer,
          editorText: value,
        },
      };
    });
  },
);
