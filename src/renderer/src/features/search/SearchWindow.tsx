import { IconSearch, IconX } from "@pierre/icons";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";

import { useFileOpen } from "@renderer/features/files/fileActions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@renderer/shared/ui/dialog";
import { recentFilesAtom } from "@renderer/store/fileExplorerStore";
import { isVisibleAtom, searchResultsAtom } from "@renderer/store/SearchWindowStore";
import type { FileItem } from "@shared/file-item";
import { getFileHandlingMode } from "@shared/mime-types";

import { SearchFileResultContent, SearchKeyHint } from "./SearchUi";
import { useFileSearch, type FileSearchFilter } from "./useFileSearch";
import { useSearchTaskStatuses } from "./useSearchTaskStatuses";
import { useListKeyboardNavigation } from "./useListKeyboardNavigation";

const SEARCH_DEBOUNCE_MS = 90;
const RECENT_RESULTS_LIMIT = 8;

const FILTERS: ReadonlyArray<{ label: string; value: FileSearchFilter }> = [
  { label: "All", value: "all" },
  { label: "Notes", value: "notes" },
  { label: "Images", value: "images" },
];

const matchesFilter = (file: FileItem, filter: FileSearchFilter) => {
  if (filter === "images") return getFileHandlingMode(file.mimeType, file.path) === "image";
  if (filter === "notes") return getFileHandlingMode(file.mimeType, file.path) === "markdown";
  return true;
};

const SearchWindow = () => {
  const searchResults = useAtomValue(searchResultsAtom).files;
  const recentFiles = useAtomValue(recentFilesAtom);
  const [isVisible, setIsVisible] = useAtom(isVisibleAtom);
  const [filter, setFilter] = useState<FileSearchFilter>("all");
  const [query, setQuery] = useState("");
  const [hideCompletedTasks, setHideCompletedTasks] = useState(false);
  const { statuses: taskStatuses, error: taskStatusError, loading: statusesLoading } = useSearchTaskStatuses(isVisible);
  const completedPaths = useMemo(
    () => new Set([...taskStatuses].filter(([, status]) => status === "done").map(([path]) => path)),
    [taskStatuses],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const mouseNavigationRef = useRef(false);
  const { open } = useFileOpen();
  const { isSearching, matchesByPath, onQueryChange, searchError } = useFileSearch("files");
  const { currentlySelected, handleKeyDown, setCurrentlySelected, setMaxIndex } = useListKeyboardNavigation();
  const hasQuery = query.trim().length > 0;
  const primaryKey = window.config.isMacOS ? "⌘" : "Ctrl";
  const recentResults = useMemo(
    () =>
      recentFiles
        .filter((file) => matchesFilter(file, filter) && (!hideCompletedTasks || !completedPaths.has(file.path)))
        .slice(0, RECENT_RESULTS_LIMIT),
    [filter, recentFiles, hideCompletedTasks, completedPaths],
  );
  const results = hasQuery
    ? searchResults.filter((file) => !hideCompletedTasks || !completedPaths.has(file.path))
    : recentResults;

  const search = (nextQuery: string, nextFilter = filter) => {
    mouseNavigationRef.current = false;
    setQuery(nextQuery);
    setCurrentlySelected(0);
    setFilter(nextFilter);
  };

  useEffect(() => {
    if (!isVisible) return;
    onQueryChange(query, {
      debounceMs: SEARCH_DEBOUNCE_MS,
      filter,
      includeContent: true,
      hideCompletedTasks,
      completedPaths,
    });
    setCurrentlySelected(0);
  }, [isVisible, query, filter, hideCompletedTasks, completedPaths, onQueryChange, setCurrentlySelected]);

  const close = () => {
    setIsVisible(false);
    setFilter("all");
    search("", "all");
  };

  const selectFilter = (nextFilter: FileSearchFilter) => {
    setFilter(nextFilter);
    search(query, nextFilter);
    inputRef.current?.focus();
  };

  const openResult = (file: FileItem, openInNewTab = false) => {
    close();
    void open(file, { focusEditor: true, openInNewTab });
  };

  const handleKeyboardNavigation = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const currentIndex = FILTERS.findIndex(({ value }) => value === filter);
      const direction = event.shiftKey ? -1 : 1;
      const nextIndex = (currentIndex + direction + FILTERS.length) % FILTERS.length;
      selectFilter(FILTERS[nextIndex].value);
      return;
    }

    const navigationKeys = ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
    if (navigationKeys.includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      mouseNavigationRef.current = false;
      handleKeyDown(event.nativeEvent);
      return;
    }

    if (event.key === "Enter") {
      const selected = results[currentlySelected];
      if (!selected) return;
      event.preventDefault();
      event.stopPropagation();
      openResult(selected, event.ctrlKey || event.metaKey);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  useEffect(() => {
    setMaxIndex(results.length - 1);
  }, [results.length, setMaxIndex]);

  useEffect(() => {
    if (!mouseNavigationRef.current) {
      listRefs.current[currentlySelected]?.scrollIntoView({ behavior: "instant", block: "nearest" });
    }
  }, [currentlySelected]);

  useEffect(() => {
    if (!isVisible) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isVisible]);

  if (!isVisible) return null;

  const sectionLabel = hasQuery ? "Best matches" : "Recent";
  const resultCount = results.length;

  return (
    <Dialog open={isVisible} onOpenChange={(open) => !open && close()}>
      <DialogContent className="search-panel translate-y-0" aria-describedby={undefined}>
        <DialogHeader className="sr-only">
          <DialogTitle>Search workspace</DialogTitle>
        </DialogHeader>

        <div className="search-panel-query-row">
          <IconSearch className="search-panel-search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            className="search-panel-input"
            value={query}
            onChange={(event) => search(event.currentTarget.value)}
            onKeyDown={handleKeyboardNavigation}
            placeholder="Search titles, paths, and note contents…"
            aria-label="Search workspace"
            aria-autocomplete="list"
            aria-controls="workspace-search-results"
            aria-expanded="true"
            aria-activedescendant={
              results[currentlySelected] ? `workspace-search-result-${currentlySelected}` : undefined
            }
            role="combobox"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              className="search-panel-clear"
              onClick={() => {
                search("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <IconX aria-hidden="true" />
            </button>
          ) : (
            <SearchKeyHint>{primaryKey} P</SearchKeyHint>
          )}
        </div>

        {taskStatusError ? (
          <p role="status" className="px-4 text-ui-control text-muted-foreground">
            {taskStatusError}
          </p>
        ) : null}
        <div className="search-panel-toolbar">
          <div className="search-panel-filters" aria-label="File type" role="group">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="search-panel-filter"
                data-active={filter === option.value ? "true" : undefined}
                aria-pressed={filter === option.value}
                onClick={() => selectFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="search-panel-filter"
            aria-pressed={hideCompletedTasks}
            data-active={hideCompletedTasks ? "true" : undefined}
            disabled={statusesLoading || Boolean(taskStatusError)}
            onClick={() => {
              setHideCompletedTasks((value) => !value);
              inputRef.current?.focus();
            }}
          >
            Hide completed tasks
          </button>
          <span className="search-panel-status" aria-live="polite">
            {isSearching ? (
              <>
                <span className="search-panel-spinner" aria-hidden="true" /> Searching contents
              </>
            ) : hasQuery ? (
              `${resultCount} ${resultCount === 1 ? "result" : "results"}`
            ) : recentResults.length ? (
              "Recently opened"
            ) : (
              "Workspace search"
            )}
          </span>
        </div>

        <div className="search-panel-results-shell">
          {results.length ? (
            <>
              <div className="search-panel-results-heading">
                <span>{sectionLabel}</span>
                {searchError ? <span className="search-panel-warning">{searchError}</span> : null}
              </div>
              <div className="search-panel-results" id="workspace-search-results" role="listbox">
                {results.map((result, index) => {
                  const match = hasQuery ? matchesByPath.get(result.path) : undefined;
                  const contentMatch = match?.matchedIn === "content" || match?.matchedIn === "both";
                  const matchLabel = !hasQuery
                    ? "Recent"
                    : match?.matchedIn === "content"
                      ? "Contents"
                      : match?.matchedIn === "both"
                        ? "Title + contents"
                        : "Title or path";

                  return (
                    <button
                      key={result.path}
                      id={`workspace-search-result-${index}`}
                      ref={(element) => {
                        listRefs.current[index] = element;
                      }}
                      type="button"
                      className="search-panel-result"
                      data-selected={currentlySelected === index ? "true" : undefined}
                      aria-selected={currentlySelected === index}
                      role="option"
                      onClick={() => openResult(result)}
                      onAuxClick={(event) => {
                        if (event.button === 1) openResult(result, true);
                      }}
                      onMouseMove={() => {
                        mouseNavigationRef.current = true;
                        setCurrentlySelected(index);
                      }}
                    >
                      <SearchFileResultContent
                        taskStatus={taskStatuses.get(result.path)}
                        excerpt={contentMatch ? match?.excerpt : undefined}
                        file={result}
                        query={query}
                        trailingLabel={matchLabel}
                      />
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="search-panel-empty">
              {isSearching ? (
                <>
                  <span className="search-panel-spinner search-panel-spinner-large" aria-hidden="true" />
                  <strong>Searching your notes…</strong>
                  <span>Filename results appear immediately; note contents are still being checked.</span>
                </>
              ) : hasQuery ? (
                <>
                  <IconSearch aria-hidden="true" />
                  <strong>No matches for “{query.trim()}”</strong>
                  <span>
                    {hideCompletedTasks
                      ? "Completed tasks are hidden. Turn off the filter to include them."
                      : "Try fewer words, a partial filename, or another file type."}
                  </span>
                </>
              ) : (
                <>
                  <IconSearch aria-hidden="true" />
                  <strong>Find anything in your workspace</strong>
                  <span>Search by filename, folder path, or words inside a note.</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="search-panel-footer">
          <span className="search-panel-shortcuts">
            <span>
              <SearchKeyHint>↑↓</SearchKeyHint> Navigate
            </span>
            <span>
              <SearchKeyHint>Tab</SearchKeyHint> Filter
            </span>
            <span>
              <SearchKeyHint>↵</SearchKeyHint> Open
            </span>
            <span>
              <SearchKeyHint>esc</SearchKeyHint> Close
            </span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SearchWindow;
