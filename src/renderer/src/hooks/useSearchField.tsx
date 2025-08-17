import { useEffect } from "react";
import {
  isVisibleAtom,
  queryAtom,
  resultsAtom,
} from "../store/SearchWindowStore";
import { useAtom, useSetAtom } from "jotai";
import { fileRepository } from "@renderer/services/FileRepository";
import { FileSearchResultsLimit } from "@shared/constants";

interface QueryDBOptions {
  onlyImages?: boolean;
}

export const useSearchField = () => {
  const [isVisible, setIsVisible] = useAtom(isVisibleAtom);
  const [query, setQuery] = useAtom(queryAtom);
  const setResults = useSetAtom(resultsAtom);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsVisible(false);
      }
    };

    if (isVisible) {
      window.addEventListener("keydown", handleEscape);
    }

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isVisible]);

  const queryDB = async (query: string, options?: QueryDBOptions) => {
    const { onlyImages = false } = options || {};

    const filesFromDB = await fileRepository.search(query);
    let filteredFiles = filesFromDB.filter((file) => !file.isDirectory);

    if (onlyImages) {
      filteredFiles = filteredFiles.filter((file) =>
        file.mimeType?.startsWith("image/")
      );
    }

    setResults(filteredFiles.slice(0, FileSearchResultsLimit));
  };

  const onQueryChange = (newQuery: string, options?: QueryDBOptions) => {
    setQuery(newQuery);
    queryDB(newQuery, options);
  };

  return {
    onQueryChange,
  };
};

export default useSearchField;
