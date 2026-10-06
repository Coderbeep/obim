import { atom } from "jotai";

export const isAppInitializedAtom = atom(false);
export const shortcutHelpOpenAtom = atom(false);

/** Incrementing this asks the mounted settings trigger to open its dialog. */
export const settingsDialogOpenRequestAtom = atom(0);

/** Incrementing this asks the mounted left sidebar to reveal Version History. */
export const versionHistoryOpenRequestAtom = atom(0);
