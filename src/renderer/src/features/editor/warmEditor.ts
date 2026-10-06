import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "./codemirror-state";
import { EditorView } from "./codemirror-view";
import { createEditorExtensions } from "./setup";

let warmed = false;

/** Exercise first-mount editor work without buffers, file access, focus, or autosave. */
export function warmEditor() {
  if (warmed || document.querySelector(".cm-editor")) return;
  warmed = true;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:800px;height:400px;visibility:hidden;pointer-events:none;contain:strict";
  document.body.append(host);
  let view: EditorView | undefined;
  let disposed = false;
  let timeout: number | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (timeout !== undefined) window.clearTimeout(timeout);
    view?.destroy();
    host.remove();
  };
  try {
    const extensions = createEditorExtensions({
      isMarkdown: true,
      owner: "editor-warmup",
      overlay: { open: () => {}, close: () => {}, hotkey: () => false },
      notify: () => {},
      openResource: () => {},
      openExternal: () => {},
      noteHeader: [],
    });
    const state = EditorState.create({
      doc: "# Note\n\nA paragraph with **bold** and *italic* text.\n\n- [ ] A task\n- A list item\n\n> A quote\n\n$1 + 1$\n",
      extensions: [extensions, EditorState.readOnly.of(true), EditorView.editable.of(false)],
    });
    ensureSyntaxTree(state, state.doc.length, 50);
    view = new EditorView({ state, parent: host });
    // Allow the first layout/measurement cycle to finish before releasing the view.
    timeout = window.setTimeout(dispose, 1000);
    view.requestMeasure({
      read: () => {
        window.setTimeout(dispose, 0);
      },
    });
  } catch (error) {
    warmed = false;
    dispose();
    throw error;
  }
}
