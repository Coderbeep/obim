import { EditorView, WidgetType } from "@codemirror/view";

class TaskMarkerWidget extends WidgetType {
  isChecked: boolean;
  position: { from: number; to: number };

  constructor(isChecked: boolean, position: { from: number; to: number }) {
    super();
    this.isChecked = isChecked;
    this.position = position;
  }

  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.isChecked;
    input.classList.add("cm-formatting-input");

    // event listener to update the state
    input.addEventListener("change", (e) => {
      this.toggle(view);
    });

    return input;
  }

  toggle(view: EditorView) {
    const { from, to } = this.position;

    const newContent = view.state.sliceDoc(from, to) === "[ ]" ? "[x]" : "[ ]";

    view.dispatch({
      changes: { from, to, insert: newContent },
    });
    view.focus();
  }
}
