import { canLinkToSections } from "@shared/section-links";
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { workspaceFilesAtom } from "@renderer/store/fileExplorerStore";
import { getHeadingTargets } from "@renderer/shared/markdownHeadingTargets";
import { readFile } from "@renderer/features/files/workspaceFileService";
import type { FileItem } from "@shared/file-item";

export const decodeLinkQuery = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export interface LinkSectionResult {
  file: FileItem;
  text: string;
  level: number;
  line: number;
  destination: string;
}

export function useLinkSections(source: string, enabled: boolean, files: FileItem[], notePath?: string) {
  const separator = enabled && !/^[a-z][a-z\d+.-]*:/i.test(source) ? source.indexOf("#") : -1;
  const pathQuery = decodeLinkQuery(separator < 0 ? source : source.slice(0, separator));
  const sectionQuery = separator < 0 ? "" : decodeLinkQuery(source.slice(separator + 1));
  const buffers = useAtomValue(fileBuffersByPathAtom);
  const workspaceFiles = useAtomValue(workspaceFilesAtom);
  const [state, setState] = useState<{
    key: string;
    results: LinkSectionResult[];
    loading: boolean;
    failed: boolean;
    blocked: boolean;
  }>({
    key: "",
    results: [],
    loading: false,
    failed: false,
    blocked: false,
  });
  const key = `${notePath ?? ""}:${source}`;

  useEffect(() => {
    if (separator < 0) return;
    let cancelled = false;
    setState({ key, results: [], loading: true, failed: false, blocked: false });
    const exact = files.filter(
      (file) => file.relativePath === pathQuery || file.relativePath.replace(/\.md$/i, "") === pathQuery,
    );
    const candidates = !pathQuery
      ? workspaceFiles.filter((file) => file.path === notePath)
      : exact.length
        ? exact
        : files;
    const query = sectionQuery.toLocaleLowerCase();
    void Promise.all(
      candidates
        .filter((file) => canLinkToSections(file.path))
        .map(async (file) => {
          const buffer = buffers[file.path];
          const result = buffer
            ? { success: true as const, content: buffer.editorText }
            : await readFile(file.path).catch(() => ({ success: false as const }));
          if (!result.success) return null;
          return getHeadingTargets(result.content)
            .filter(
              (heading) =>
                heading.text.toLocaleLowerCase().includes(query) ||
                decodeLinkQuery(heading.fragment.slice(1)).includes(query),
            )
            .map((heading) => ({
              ...heading,
              file,
              destination: `${pathQuery ? file.relativePath : ""}${heading.fragment}`,
            }));
        }),
    ).then((groups) => {
      if (!cancelled)
        setState({
          key,
          results: groups.flatMap((group) => group ?? []).slice(0, 100),
          loading: false,
          failed: groups.some((group) => group === null),
          blocked: candidates.length > 0 && candidates.every((file) => !canLinkToSections(file.path)),
        });
    });
    return () => {
      cancelled = true;
    };
  }, [buffers, files, key, notePath, pathQuery, sectionQuery, separator, workspaceFiles]);

  return {
    isSectionSearch: separator >= 0,
    pathQuery,
    sectionQuery,
    sections: state.key === key ? state.results : [],
    loading: separator >= 0 && (state.key !== key || state.loading),
    failed: state.key === key && state.failed,
    blocked: state.key === key && state.blocked,
  };
}
