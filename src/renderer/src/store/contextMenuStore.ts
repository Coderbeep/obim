import { atom } from "jotai";

import type { ContextMenuRequest } from "@renderer/shared/contextMenu";

/** Current menu request, or `null` when no application context menu is open. */
export const contextMenuRequestAtom = atom<ContextMenuRequest | null>(null);

/**
 * Opens the requested context menu.
 *
 * When `toggleOnRepeat` is enabled, requesting the same key from the same
 * anchor closes the current menu instead.
 */
export const openContextMenuAtom = atom(null, (get, set, request: ContextMenuRequest) => {
  const current = get(contextMenuRequestAtom);
  if (request.toggleOnRepeat && current?.key === request.key && current.anchor === request.anchor) {
    set(contextMenuRequestAtom, null);
    return;
  }

  set(contextMenuRequestAtom, {
    key: request.key,
    anchor: request.anchor,
    position: request.position,
    entries: request.entries,
    toggleOnRepeat: request.toggleOnRepeat,
  });
});

/** Closes the current context menu without invoking an entry. */
export const closeContextMenuAtom = atom(null, (_, set) => {
  set(contextMenuRequestAtom, null);
});
