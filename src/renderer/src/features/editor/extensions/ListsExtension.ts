import { createListKeymap } from "./ListsCommands";
import { orderedListRenumberFilter } from "./ListsRenumbering";
import { ListsViewPlugin } from "./ListsRendering";

export { listAwareIndentLess, listAwareIndentMore } from "./ListsCommands";
export { transactionMayTouchOrderedListMarker } from "./ListsRenumbering";
export { buildListDecorations, ListsViewPlugin } from "./ListsRendering";

export function createListsExtension(isEditorOverlayOpen: () => boolean) {
  return [createListKeymap(isEditorOverlayOpen), orderedListRenumberFilter, ListsViewPlugin];
}
