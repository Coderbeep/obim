import { atom } from "jotai";

import type { FileItem } from "@shared/file-item";

export type ActionRunnerRequest =
  | { view: "commands" }
  | { view: "create-task"; returnToCommands: boolean }
  | { view: "import-article"; returnToCommands: boolean }
  | {
      view: "move-to-folder";
      targets: FileItem[];
      returnToCommands: boolean;
    };

/** The action runner is closed when no request is present. */
export const actionRunnerRequestAtom = atom<ActionRunnerRequest | null>(null);
