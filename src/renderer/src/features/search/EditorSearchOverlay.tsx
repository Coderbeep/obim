import { SECTION_LINK_FILENAME_MESSAGE } from "@shared/section-links";
import { IconSearch, IconHash } from "@pierre/icons";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { editorOverlayRequestAtom } from "@renderer/store/editorOverlayStore";
import { searchResultsAtom } from "@renderer/store/SearchWindowStore";
import { SearchFileResultContent, SearchHighlightedText, SearchKeyHint } from "./SearchUi";
import { useLinkSections } from "./useLinkSections";
import { useFileSearch } from "./useFileSearch";
import { useListKeyboardNavigation } from "./useListKeyboardNavigation";

const shortcuts = [
  { key: "↑ ↓", label: "Navigate" },
  { key: "Enter", label: "Insert" },
  { key: "esc", label: "Close" },
];

export function EditorSearchOverlay() {
  const request = useAtomValue(editorOverlayRequestAtom);
  const allResults = useAtomValue(searchResultsAtom);
  const scope = request?.scope ?? "links";
  const files = allResults[scope];
  const { isSectionSearch, pathQuery, sectionQuery, sections, loading, failed, blocked } = useLinkSections(
    request?.source ?? "",
    scope === "links",
    files,
    request?.notePath,
  );
  const results = useMemo(
    () =>
      isSectionSearch
        ? sections.map((section) => ({ file: section.file, destination: section.destination, section }))
        : files.map((file) => ({
            file,
            destination: file.relativePath,
            section: null,
          })),
    [files, isSectionSearch, scope, sections],
  );
  const { onQueryChange } = useFileSearch(scope);
  const { currentlySelected, setCurrentlySelected, handleKeyDown, setMaxIndex } = useListKeyboardNavigation();
  const [mouseNavigation, setMouseNavigation] = useState(false);
  const listRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const requestRef = useRef(request);
  const resultsRef = useRef(results);
  const selectedRef = useRef(currentlySelected);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(() => {
    resultsRef.current = results;
    setMaxIndex(results.length - 1);
  }, [results, setMaxIndex]);

  useEffect(() => {
    selectedRef.current = currentlySelected;
    if (!mouseNavigation)
      listRefs.current[currentlySelected]?.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [currentlySelected, mouseNavigation]);

  useEffect(() => {
    if (!request) return;
    onQueryChange(pathQuery, {
      filter: request.scope === "images" ? "images" : "notes",
      debounceMs: 120,
    });
    setCurrentlySelected(0);
    setMouseNavigation(false);
  }, [onQueryChange, request?.owner, request?.scope, request?.source, pathQuery, setCurrentlySelected]);

  const routeHotkey = useCallback(
    (key: "ArrowUp" | "ArrowDown" | "Enter") => {
      setMouseNavigation(false);
      if (key === "Enter") {
        const activeRequest = requestRef.current;
        const selected = resultsRef.current[selectedRef.current];
        if (activeRequest && selected) activeRequest.select(selected.destination);
        return;
      }
      handleKeyDown(new KeyboardEvent("keydown", { key }));
    },
    [handleKeyDown],
  );

  useEffect(() => {
    const hotkey = request?.hotkey;
    if (hotkey) routeHotkey(hotkey.key);
  }, [request?.hotkey?.revision, routeHotkey]);

  if (!request) return null;

  return (
    <div
      id="editor-search-overlay"
      tabIndex={-1}
      style={{ left: request.anchor.left, top: request.anchor.top }}
      className="search-panel-inline"
    >
      <div className="search-panel-results search-panel-inline-results" role="listbox">
        {results.length === 0 ? (
          <div className="search-panel-empty search-panel-inline-empty">
            <IconSearch aria-hidden="true" />
            <strong>
              {loading
                ? "Finding sections…"
                : blocked
                  ? "Section links unavailable"
                  : failed
                    ? "Sections unavailable"
                    : "No matches found"}
            </strong>
            <span>
              {isSectionSearch
                ? blocked
                  ? SECTION_LINK_FILENAME_MESSAGE
                  : failed
                    ? "The note could not be read. Try again."
                    : "Type a heading after #, or try another note."
                : `Try a different ${request.scope === "images" ? "image" : "note"} name or path.`}
            </span>
          </div>
        ) : (
          results.map((result, index) => (
            <button
              key={`${result.file.path}:${result.destination}`}
              ref={(element) => {
                listRefs.current[index] = element;
              }}
              type="button"
              className="search-panel-result search-panel-inline-result"
              data-selected={currentlySelected === index ? "true" : undefined}
              aria-selected={currentlySelected === index}
              role="option"
              onMouseMove={() => {
                setMouseNavigation(true);
                setCurrentlySelected(index);
              }}
              onClick={() => request.select(result.destination)}
            >
              {result.section ? (
                <>
                  <span className="search-panel-file-icon">
                    <IconHash aria-hidden="true" />
                  </span>
                  <span className="search-panel-result-copy">
                    <span className="search-panel-result-title-row">
                      <span className="search-panel-result-title">
                        <SearchHighlightedText query={sectionQuery} text={result.section.text} />
                      </span>
                      <span className="search-panel-file-type">H{result.section.level}</span>
                    </span>
                    <span className="search-panel-result-path">
                      {result.file.relativePath} · Line {result.section.line}
                    </span>
                  </span>
                </>
              ) : (
                <SearchFileResultContent
                  file={result.file}
                  query={pathQuery}
                  trailingLabel={request.scope === "images" ? "Image" : "Note"}
                />
              )}
            </button>
          ))
        )}
      </div>
      <div className="search-panel-footer search-panel-inline-footer">
        {request.scope === "links" && !isSectionSearch ? <span>Type # to find a section</span> : null}
        {shortcuts.map(({ key, label }) => (
          <span key={label}>
            <SearchKeyHint>{key}</SearchKeyHint>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
