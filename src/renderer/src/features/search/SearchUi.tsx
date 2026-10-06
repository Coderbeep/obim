import type { ReactNode } from "react";

import { getFileGlyph } from "@renderer/shared/icons/FileGlyphs";
import type { FileItem } from "@shared/file-item";
import { getExt, getFilenameNoExtFromPath, getPathWithoutFilename } from "@shared/pathUtils";

import { getSearchMatchRanges } from "./searchHighlight";

export const SearchKeyHint = ({ children }: { children: ReactNode }) => (
  <kbd className="search-panel-key">{children}</kbd>
);

export const SearchHighlightedText = ({ query, text }: { query: string; text: string }) => {
  const ranges = getSearchMatchRanges(text, query);
  if (!ranges.length) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(({ from, to }) => {
    if (from > cursor) parts.push(text.slice(cursor, from));
    parts.push(
      <mark className="search-panel-highlight" key={`${from}-${to}`}>
        {text.slice(from, to)}
      </mark>,
    );
    cursor = to;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
};

export const SearchFileResultContent = ({
  excerpt,
  file,
  query,
  trailingLabel,
  taskStatus,
}: {
  excerpt?: string;
  file: FileItem;
  query: string;
  trailingLabel?: string;
  taskStatus?: "open" | "done" | "cancelled";
}) => {
  const directory = getPathWithoutFilename(file.relativePath) || "Workspace root";
  const extension = getExt(file.relativePath).slice(1).toLocaleUpperCase() || "FILE";
  const fileName = getFilenameNoExtFromPath(file.relativePath);

  return (
    <>
      <span className="search-panel-file-icon">{getFileGlyph(file.relativePath)}</span>
      <span className="search-panel-result-copy">
        <span className="search-panel-result-title-row">
          <span className="search-panel-result-title">
            <SearchHighlightedText query={query} text={fileName} />
          </span>
          <span className="search-panel-file-type">{extension}</span>
          {taskStatus === "done" || taskStatus === "cancelled" ? (
            <span className="search-panel-file-type">{taskStatus === "done" ? "Completed" : "Cancelled"}</span>
          ) : null}
        </span>
        <span className="search-panel-result-path">
          <SearchHighlightedText query={query} text={directory} />
        </span>
        {excerpt ? (
          <span className="search-panel-result-excerpt">
            <SearchHighlightedText query={query} text={excerpt} />
          </span>
        ) : null}
      </span>
      {trailingLabel ? <span className="search-panel-match-kind">{trailingLabel}</span> : null}
    </>
  );
};
