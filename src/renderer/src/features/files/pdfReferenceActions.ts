import { stageExternalFileEditAtom, settleExternalFileEditAtom } from "@renderer/store/fileLifecycleStore";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import type { PdfReferenceColor } from "@renderer/shared/pdfReference";
import type { IndexedPdfReference } from "@shared/workspace-index";
import { createStore } from "jotai";

import { readTextFile, saveFile } from "./workspaceFileService";

const withColor = (destination: string, color: PdfReferenceColor) => {
  const withoutColor = destination.replace(/&color=(?:yellow|green|blue|purple|red)(?=&|$)/, "");
  return color === "yellow" ? withoutColor : `${withoutColor}&color=${color}`;
};

/** Changes exactly one ordinary inline Markdown link; ambiguous matches fail closed. */
export const recolorPdfReferenceSource = (
  source: string,
  reference: IndexedPdfReference,
  color: PdfReferenceColor,
): string | null => {
  const matches = [...source.matchAll(/\]\(([^)\n]+)\)/g)].filter((match) => {
    const raw = match[1];
    return raw.replaceAll("\\&", "&").replaceAll("&amp;", "&") === reference.destination;
  });
  if (!matches.length) return null;
  const onLine = matches.filter((match) => source.slice(0, match.index).split("\n").length === reference.line);
  const candidates = onLine.length ? onLine : matches;
  if (candidates.length !== 1) return null;
  const match = candidates[0];
  const raw = match[1];
  const nextDestination = withColor(reference.destination, color);
  if (nextDestination === reference.destination) return source;
  const nextRaw = raw.includes("\\&")
    ? nextDestination.replaceAll("&", "\\&")
    : raw.includes("&amp;")
      ? nextDestination.replaceAll("&", "&amp;")
      : nextDestination;
  const start = match.index + 2;
  return source.slice(0, start) + nextRaw + source.slice(start + raw.length);
};

/** Persists all matching links in one note with one version-aware write. */
const recolorNoteReferences = async (
  store: ReturnType<typeof createStore>,
  references: readonly IndexedPdfReference[],
  color: PdfReferenceColor,
): Promise<{ success: true; changed: boolean } | { success: false; error: string }> => {
  const notePath = references[0]?.notePath;
  if (!notePath || references.some((reference) => reference.notePath !== notePath))
    return { success: false, error: "References must belong to one note." };
  const existing = store.get(fileBuffersByPathAtom)[notePath];
  const loaded = existing ? null : await readTextFile(notePath);
  if (loaded && !loaded.success) return { success: false, error: loaded.error };
  const source = existing?.editorText ?? loaded?.content;
  const version = existing?.version ?? loaded?.version;
  if (source === undefined || !version) return { success: false, error: "The source note has no save version." };
  let next = source;
  for (const reference of references) {
    const recolored = recolorPdfReferenceSource(next, reference, color);
    if (recolored === null)
      return { success: false, error: "A source link changed or occurs more than once. Open the note to edit it." };
    next = recolored;
  }
  if (next === source) return { success: true, changed: false };
  const staged = existing
    ? store.set(stageExternalFileEditAtom, {
        path: notePath,
        expectedText: source,
        nextText: next,
      })
    : false;
  if (existing && !staged) return { success: false, error: "The source note changed while updating its link." };
  const result = await saveFile(notePath, next, version);
  if (staged)
    store.set(settleExternalFileEditAtom, {
      path: notePath,
      expectedText: source,
      nextText: next,
      success: result.success,
      ...(result.success ? { version: result.version } : {}),
    });
  return result.success ? { success: true, changed: true } : { success: false, error: result.error };
};

/** Updates all links to one PDF passage, counting only notes whose content changed. */
export const recolorPdfReferences = async (
  store: ReturnType<typeof createStore>,
  references: readonly IndexedPdfReference[],
  color: PdfReferenceColor,
): Promise<{ updatedNotes: number; failures: { notePath: string; error: string }[] }> => {
  const byNote = new Map<string, IndexedPdfReference[]>();
  for (const reference of references)
    byNote.set(reference.notePath, [...(byNote.get(reference.notePath) ?? []), reference]);
  let updatedNotes = 0;
  const failures: { notePath: string; error: string }[] = [];
  for (const [notePath, noteReferences] of byNote) {
    try {
      const result = await recolorNoteReferences(store, noteReferences, color);
      if (!result.success) failures.push({ notePath, error: result.error });
      else if (result.changed) updatedNotes += 1;
    } catch (error) {
      failures.push({ notePath, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { updatedNotes, failures };
};
