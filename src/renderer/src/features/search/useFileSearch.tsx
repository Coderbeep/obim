import { useCallback, useEffect, useRef, useState } from "react";
import { searchResultsAtom, type SearchScope } from "@renderer/store/SearchWindowStore";
import { useAtomValue, useSetAtom } from "jotai";
import { getFileHandlingMode } from "@shared/mime-types";
import { workspaceFilesAtom } from "@renderer/store/fileExplorerStore";
import type { WorkspaceTextSearchResult } from "@shared/workspace-index";
import { rankFiles } from "./fileRanking";

const FILE_SEARCH_RESULTS_LIMIT = 30;

export type FileSearchFilter = "all" | "images" | "notes";

interface QueryDBOptions {
  filter?: FileSearchFilter;
  debounceMs?: number;
  includeContent?: boolean;
  hideCompletedTasks?: boolean;
  completedPaths?: ReadonlySet<string>;
}

export type FileSearchMatch = Pick<WorkspaceTextSearchResult, "excerpt" | "matchedIn">;

const filterFiles = (files: ReturnType<typeof rankFiles>, filter: FileSearchFilter) => {
  if (filter === "images") {
    return files.filter((file) => getFileHandlingMode(file.mimeType, file.path) === "image");
  }
  if (filter === "notes") {
    return files.filter((file) => getFileHandlingMode(file.mimeType, file.path) === "markdown");
  }
  return files;
};

const filenameMatchDetails = (files: ReturnType<typeof rankFiles>) =>
  new Map<string, FileSearchMatch>(files.map((file) => [file.path, { matchedIn: "filename" }]));

export const useFileSearch = (scope: SearchScope) => {
  const setResults = useSetAtom(searchResultsAtom);
  const workspaceFiles = useAtomValue(workspaceFilesAtom);
  const latestRequestRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);
  const [matchesByPath, setMatchesByPath] = useState<ReadonlyMap<string, FileSearchMatch>>(new Map());
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const queryContents = useCallback(
    async (
      query: string,
      filter: FileSearchFilter,
      filenameMatches: ReturnType<typeof rankFiles>,
      requestId: number,
      options?: QueryDBOptions,
    ) => {
      try {
        const indexed = await window.api.searchWorkspaceText({
          query,
          limit: FILE_SEARCH_RESULTS_LIMIT,
          ...(options?.hideCompletedTasks ? { hideCompletedTasks: true } : {}),
        });
        if (requestId !== latestRequestRef.current) return;

        const normalizedQuery = query.trim().toLocaleLowerCase();
        const directFilenameMatches = filenameMatches.filter(
          (file) =>
            file.filename.toLocaleLowerCase().includes(normalizedQuery) ||
            file.relativePath.toLocaleLowerCase().includes(normalizedQuery),
        );
        const directPaths = new Set(directFilenameMatches.map(({ path }) => path));
        const weakFilenameMatches = filenameMatches.filter(({ path }) => !directPaths.has(path));
        const filesByPath = new Map(directFilenameMatches.map((file) => [file.path, file]));
        indexed.forEach(({ file }) => {
          if (!filesByPath.has(file.path)) filesByPath.set(file.path, file);
        });
        weakFilenameMatches.forEach((file) => {
          if (!filesByPath.has(file.path)) filesByPath.set(file.path, file);
        });

        const mergedFiles = filterFiles([...filesByPath.values()], filter)
          .filter((file) => !options?.hideCompletedTasks || !options.completedPaths?.has(file.path))
          .slice(0, FILE_SEARCH_RESULTS_LIMIT);
        const indexedByPath = new Map(indexed.map((result) => [result.file.path, result]));
        setMatchesByPath(
          new Map(
            mergedFiles.map((file) => {
              const indexedMatch = indexedByPath.get(file.path);
              return [
                file.path,
                indexedMatch
                  ? { matchedIn: indexedMatch.matchedIn, excerpt: indexedMatch.excerpt }
                  : { matchedIn: "filename" },
              ];
            }),
          ),
        );
        setResults((prev) => ({ ...prev, [scope]: mergedFiles }));
        setSearchError(null);
      } catch (err) {
        console.error("Workspace index search failed; using filename search:", err);
        if (requestId === latestRequestRef.current) setSearchError("Note contents are temporarily unavailable");
      } finally {
        if (requestId === latestRequestRef.current) setIsSearching(false);
      }
    },
    [scope, setResults],
  );

  const onQueryChange = useCallback(
    (newQuery: string, options?: QueryDBOptions) => {
      const requestId = latestRequestRef.current + 1;
      latestRequestRef.current = requestId;
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);

      const { filter = "all", includeContent = false } = options ?? {};
      const searchCandidates = filterFiles([...workspaceFiles], filter).filter(
        (file) => !options?.hideCompletedTasks || !options.completedPaths?.has(file.path),
      );
      const filenameMatches = rankFiles(searchCandidates, newQuery, FILE_SEARCH_RESULTS_LIMIT);
      setResults((prev) => ({ ...prev, [scope]: filenameMatches }));
      setMatchesByPath(filenameMatchDetails(filenameMatches));
      setSearchError(null);

      const shouldSearchContents =
        includeContent && scope !== "links" && filter !== "images" && newQuery.trim().length >= 3;
      setIsSearching(shouldSearchContents);
      if (!shouldSearchContents) return;

      const run = () => void queryContents(newQuery, filter, filenameMatches, requestId, options);
      if (options?.debounceMs) {
        debounceTimerRef.current = window.setTimeout(() => {
          run();
        }, options.debounceMs);
        return;
      }
      run();
    },
    [queryContents, scope, setResults, workspaceFiles],
  );

  return {
    isSearching,
    matchesByPath,
    onQueryChange,
    searchError,
  };
};

export default useFileSearch;
