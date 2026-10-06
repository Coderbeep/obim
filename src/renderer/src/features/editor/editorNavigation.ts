import { EditorView } from "./codemirror-view";
import {
  clearOutlineLineHighlightEffect,
  showOutlineLineHighlightEffect,
} from "./extensions/OutlineNavigationExtension";

let outlineNavigationToken = 0;

export function focusEditorLine(view: EditorView, lineNumber: number) {
  const line = view.state.doc.line(Math.max(1, Math.min(lineNumber, view.state.doc.lines)));
  const token = (outlineNavigationToken += 1);
  const yMargin = Math.max(
    0,
    Math.min(96, Math.floor(view.scrollDOM.clientHeight * 0.16), Math.max(0, view.scrollDOM.clientHeight - 32)),
  );
  view.dispatch({
    selection: { anchor: line.from },
    effects: [
      showOutlineLineHighlightEffect.of({ from: line.from, token }),
      EditorView.scrollIntoView(line.from, { y: "start", yMargin }),
    ],
    userEvent: "select.outline",
  });
  view.focus();
  window.setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: clearOutlineLineHighlightEffect.of(token) });
  }, 1800);
}
