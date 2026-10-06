import { EditorView } from "@renderer/features/editor/codemirror-view";

import { parseJsonData } from "@renderer/shared/parseJsonData";
import { appDndBridge } from "@renderer/shared/dnd/bridge";
import { FILE_DRAG_DATA_MIME } from "@shared/drag-data";
import { getFileHandlingMode } from "@shared/mime-types";
import type { FileDragData } from "@shared/drag-data";
import { editableBodyStart } from "./extensions/FrontmatterExtension";
import { serializeMarkdownDestination } from "./extensions/shared/markdownDestination";

export function normalizeTabsOnPaste(tabSize = 4) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const clipboardData = event.clipboardData;
      if (!clipboardData || view.state.readOnly) return;

      const text = clipboardData.getData("text/plain");
      if (!text.includes("\t")) return;

      event.preventDefault();
      view.dispatch(view.state.replaceSelection(text.replace(/\t/g, " ".repeat(tabSize))), {
        userEvent: "input.paste",
      });
      return true;
    },
  });
}

const escapeMarkdownLinkText = (text: string) => text.replace(/([\\[\]])/g, "\\$1");

export const fileDropExtension = EditorView.domEventHandlers({
  dragover(event) {
    const dataTransfer = event.dataTransfer;
    if (appDndBridge.getActiveEntity()?.kind !== "explorer-item" || !dataTransfer?.types.includes(FILE_DRAG_DATA_MIME))
      return;
    event.preventDefault();
    event.stopPropagation();
    dataTransfer.dropEffect = "copy";
    appDndBridge.updateTarget({
      valid: true,
      key: "editor:link",
      label: "editor insertion point",
    });
  },
  drop(event, view) {
    if (view.state.readOnly) return;
    const droppedFile = parseJsonData<FileDragData>(event.dataTransfer?.getData(FILE_DRAG_DATA_MIME) ?? "");
    if (
      !droppedFile ||
      appDndBridge.getActiveEntity()?.kind !== "explorer-item" ||
      !appDndBridge.canCommit("explorer-item")
    )
      return;

    const position = Math.max(
      editableBodyStart(view.state),
      view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from,
    );
    const imageMarker = getFileHandlingMode(droppedFile.mimeType, droppedFile.path) === "image" ? "!" : "";
    const link = `${imageMarker}[${escapeMarkdownLinkText(droppedFile.filename)}](${serializeMarkdownDestination(droppedFile.relativePath)})`;

    event.preventDefault();
    event.stopPropagation();
    appDndBridge.complete();
    view.dispatch({
      changes: { from: position, insert: link },
      selection: { anchor: position + link.length },
      scrollIntoView: true,
      userEvent: "input.drop",
    });
  },
});
