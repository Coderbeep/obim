import { selectAll } from "@codemirror/commands";

import { Prec, type Extension } from "@renderer/features/editor/codemirror-state";
import { keymap, ViewPlugin, type EditorView } from "@renderer/features/editor/codemirror-view";

const PRIMARY_MOUSE_BUTTON_MASK = 1;

const controlSelectAllKeymap = Prec.highest(keymap.of([{ key: "Ctrl-a", run: selectAll }]));

function createSelectionFocusPlugin(focusWindow: () => void) {
  return ViewPlugin.fromClass(
    class {
      private focusRequested = false;
      private selecting = false;
      private readonly document: Document;

      constructor(private readonly view: EditorView) {
        this.document = view.contentDOM.ownerDocument;
        this.document.addEventListener("mousemove", this.handleMouseMove, true);
        this.document.addEventListener("mouseup", this.stopSelecting, true);
      }

      destroy() {
        this.document.removeEventListener("mousemove", this.handleMouseMove, true);
        this.document.removeEventListener("mouseup", this.stopSelecting, true);
      }

      startSelecting(event: MouseEvent) {
        if (event.button === 0) this.selecting = true;
      }

      private readonly handleMouseMove = (event: MouseEvent) => {
        if (!this.selecting) return;
        if ((event.buttons & PRIMARY_MOUSE_BUTTON_MASK) === 0) {
          this.stopSelecting();
          return;
        }
        if (this.view.hasFocus) {
          this.focusRequested = false;
          return;
        }
        if (this.focusRequested) return;

        this.focusRequested = true;
        focusWindow();
        this.view.focus();
      };

      private readonly stopSelecting = () => {
        this.focusRequested = false;
        this.selecting = false;
      };
    },
    {
      eventObservers: {
        mousedown(event) {
          this.startSelecting(event);
        },
      },
    },
  );
}

export function createEditorSelectionExtensions(focusWindow: () => void): Extension {
  return [controlSelectAllKeymap, createSelectionFocusPlugin(focusWindow)];
}
