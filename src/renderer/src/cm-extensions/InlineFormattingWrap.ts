import { keymap } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

const wrapSelectionWithCharacter = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    if (!range.empty) {
      const selectedText = state.doc.sliceString(range.from, range.to);
      const wrappedText = `*${selectedText}*`;
      return {
        changes: { from: range.from, to: range.to, insert: wrappedText },
        range: EditorSelection.range(range.from + 1, range.to + 1),
      };
    } else {
      return { changes: {}, range: range };
    }
  });
  if (changes.changes.empty) {
    return false;
  }
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
