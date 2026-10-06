import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { fileExplorerRevealRequestAtom } from "@renderer/store/fileExplorerStore";

export const useRevealInFileExplorer = () => {
  const setRevealRequest = useSetAtom(fileExplorerRevealRequestAtom);

  return useCallback(
    (relativePath: string) => {
      setRevealRequest({ relativePath });
    },
    [setRevealRequest],
  );
};
