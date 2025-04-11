import { EditorView, keymap } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

const wrapSelectionWithCharacter = ({ state, dispatch }) => {
  console.log("Wrapping selection with character");
  const changes = state.changeByRange((range) => {
    if (range.empty) return { range, changes: [] };
    const selectedText = state.doc.slice(range.from, range.to).text;
    const wrappedText = `*${selectedText}*`;
    return {
      changes: { from: range.from, to: range.to, insert: wrappedText },
      range: EditorSelection.range(range.from + 1, range.to + 1),
    };
  });

  dispatch(state.update(changes));
  return true;
};

const FormattingKeymap = keymap.of([
  {
    key: "*",
    run: wrapSelectionWithCharacter,
  },
]);

export default FormattingKeymap;
