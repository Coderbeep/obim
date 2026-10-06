import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";

import { parsePdfDeepLink } from "@renderer/shared/pdfDeepLink";
import { fileBuffersByPathAtom, type FileBufferState } from "@renderer/store/fileBufferStore";
import { fileTreeAtom, reloadRevisionAtom, workspaceFilesAtom } from "@renderer/store/fileExplorerStore";
import { markdownPdfReferenceLinks } from "@shared/pdf-reference-links";
import { WORKSPACE_INDEX_PAGE_SIZE, type IndexedPdfReference } from "@shared/workspace-index";
import { isMarkdownFile } from "@shared/mime-types";

import { resolveLinkedWorkspaceItem } from "./workspaceFileResolver";

const parsedBufferLinks = new WeakMap<FileBufferState, ReturnType<typeof markdownPdfReferenceLinks>>();
const linksForBuffer = (buffer: FileBufferState) => {
  const cached = parsedBufferLinks.get(buffer);
  if (cached) return cached;
  const links = markdownPdfReferenceLinks(buffer.editorText);
  parsedBufferLinks.set(buffer, links);
  return links;
};

export interface PdfNoteReference extends IndexedPdfReference {
  page: number;
  selection?: NonNullable<ReturnType<typeof parsePdfDeepLink>>["selection"];
  color: NonNullable<ReturnType<typeof parsePdfDeepLink>>["color"];
}

/** A cheap projection of the disposable index, with open editor buffers taking precedence. */
export const usePdfReferences = (pdfPath: string) => {
  const basename = pdfPath.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const [indexed, setIndexed] = useState<IndexedPdfReference[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const buffers = useAtomValue(fileBuffersByPathAtom);
  const fileTree = useAtomValue(fileTreeAtom);
  const files = useAtomValue(workspaceFilesAtom);
  const reloadRevision = useAtomValue(reloadRevisionAtom);
  const notePaths = useMemo(
    () => files.filter((file) => isMarkdownFile(file.mimeType, file.path)).map((file) => file.path),
    [files],
  );

  useEffect(() => {
    let cancelled = false;
    // A running Electron window can hot-reload the renderer before main/preload
    // restart with the new projection. Read the existing disposable index in
    // bounded batches in that case, then use the dedicated lookup after restart.
    const fallbackLookup = () =>
      window.api.readIndexedDocuments
        ? Promise.all(
            Array.from({ length: Math.ceil(notePaths.length / WORKSPACE_INDEX_PAGE_SIZE) }, (_, index) =>
              window.api.readIndexedDocuments(
                notePaths.slice(index * WORKSPACE_INDEX_PAGE_SIZE, (index + 1) * WORKSPACE_INDEX_PAGE_SIZE),
              ),
            ),
          ).then((batches) =>
            batches.flatMap((documents) =>
              documents.flatMap(({ file, source }) =>
                markdownPdfReferenceLinks(source)
                  .filter((link) => link.targetBasename === basename.toLocaleLowerCase())
                  .map((link) => ({
                    notePath: file.path,
                    noteRelativePath: file.relativePath,
                    destination: link.destination,
                    label: link.label,
                    line: link.line,
                  })),
              ),
            ),
          )
        : Promise.resolve([]);
    const lookup = window.api.queryPdfReferences
      ? window.api.queryPdfReferences(basename).catch(fallbackLookup)
      : fallbackLookup();
    void lookup
      .then((references) => {
        if (!cancelled) {
          setIndexed(references);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [basename, notePaths, revision, reloadRevision]);

  useEffect(() => {
    if (!window.api.onWorkspaceFilesChanged) return;
    let timer = 0;
    const unsubscribe = window.api.onWorkspaceFilesChanged(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setRevision((value) => value + 1), 150);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const references = useMemo(() => {
    const overridden = new Set(Object.keys(buffers));
    const combined = indexed.filter((reference) => !overridden.has(reference.notePath));
    for (const [notePath, buffer] of Object.entries(buffers)) {
      const note = files.find((candidate) => candidate.path === notePath);
      if (!note || !isMarkdownFile(note.mimeType, note.path)) continue;
      for (const link of linksForBuffer(buffer)) {
        if (link.targetBasename !== basename.toLocaleLowerCase()) continue;
        combined.push({
          notePath,
          noteRelativePath: note.relativePath,
          destination: link.destination,
          label: link.label,
          line: link.line,
        });
      }
    }
    return combined
      .flatMap((reference): PdfNoteReference[] => {
        const parsed = parsePdfDeepLink(reference.destination);
        if (!parsed) return [];
        const target = resolveLinkedWorkspaceItem(parsed.path, fileTree, reference.notePath);
        if (!target || target.kind !== "file" || target.file.path !== pdfPath) return [];
        return [{ ...reference, page: parsed.page, selection: parsed.selection, color: parsed.color }];
      })
      .sort((a, b) => a.page - b.page || a.noteRelativePath.localeCompare(b.noteRelativePath) || a.line - b.line);
  }, [basename, buffers, fileTree, files, indexed, pdfPath]);
  return { references, error };
};
