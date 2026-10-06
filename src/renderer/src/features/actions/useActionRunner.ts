import { useStore } from "jotai";
import { useCallback } from "react";

import { filterTopLevelItems } from "@renderer/features/files/fileTreeUtils";
import { actionRunnerRequestAtom } from "@renderer/store/actionRunnerStore";
import { isVisibleAtom } from "@renderer/store/SearchWindowStore";
import type { FileItem } from "@shared/file-item";

export const useActionRunner = () => {
  const store = useStore();

  const openActionRunner = useCallback(() => {
    store.set(isVisibleAtom, false);
    store.set(actionRunnerRequestAtom, { view: "commands" });
  }, [store]);

  const openMoveToFolder = useCallback(
    (targets: FileItem[], options?: { returnToCommands?: boolean }) => {
      const topLevelTargets = filterTopLevelItems(targets);
      if (!topLevelTargets.length) return;
      store.set(isVisibleAtom, false);
      store.set(actionRunnerRequestAtom, {
        view: "move-to-folder",
        targets: topLevelTargets,
        returnToCommands: options?.returnToCommands ?? false,
      });
    },
    [store],
  );

  const closeActionRunner = useCallback(() => store.set(actionRunnerRequestAtom, null), [store]);

  return { closeActionRunner, openActionRunner, openMoveToFolder };
};
