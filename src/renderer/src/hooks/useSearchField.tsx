import { useEffect } from "react";
import {
  isVisibleAtom,
  queryAtom,
  resultsAtom,
} from "../store/SearchWindowStore";
import { useAtom, useSetAtom } from "jotai";
import { fileRepository } from "@renderer/services/FileRepository";
import { FileSearchResultsLimit } from "@shared/constants";

export const useSearchField = () => {
  const [isVisible, setIsVisible] = useAtom(isVisibleAtom);
  const [query, setQuery] = useAtom(queryAtom);
  const setResults = useSetAtom(resultsAtom);

  useEffect(() => {
    if (isVisible) {
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          setIsVisible(false);
        }
      });
    } else {
      window.removeEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          setIsVisible(false);
        }
      });
    }
  });

  const queryDB = async (query: string) => {
    const filesFromDB = await fileRepository.search(query);
    const filteredFiles = filesFromDB.filter(file => !file.isDirectory);
    setResults(filteredFiles.slice(0, FileSearchResultsLimit));
  };

  const onQueryChange = (newQuery: string) => {
    setQuery(newQuery);
    queryDB(newQuery);
  };

  return {
    onQueryChange,
  };
};

export default useSearchField;
