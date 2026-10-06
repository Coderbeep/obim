import { countColumn, EditorSelection } from "@renderer/features/editor/codemirror-state";
import { ancestorNodeAt, childNode } from "./syntaxDecorationPlugin";
import type { ChangeSpec, EditorState, StateCommand } from "@renderer/features/editor/codemirror-state";

function listItemContentIndent(state: EditorState, pos: number) {
  const item = ancestorNodeAt(state, pos, "ListItem");
  if (!item) return null;

  const mark = childNode(item, "ListMark");
  if (!mark) return null;

  const line = state.doc.lineAt(mark.from);
  const afterMarkText = state.doc.sliceString(mark.to, line.to);
  const task = /^([ \t]*)\[[ xX]\]([ \t]*)/.exec(afterMarkText);
  const contentOffset = task
    ? mark.to - line.from + task[1].length + 3 + task[2].length
    : mark.to - line.from + /^[ \t]*/.exec(afterMarkText)![0].length;
  const structuralPrefix = state.doc.sliceString(line.from, mark.from);
  const structuralColumn = countColumn(structuralPrefix, state.tabSize);
  const contentColumn = countColumn(line.text, state.tabSize, contentOffset);
  return structuralPrefix + " ".repeat(Math.max(0, contentColumn - structuralColumn));
}

export const insertNewlineContinueMarkup: StateCommand = ({ state, dispatch }) => {
  let blocked = false;
  const changes = state.changeByRange((range) => {
    if (!range.empty) {
      blocked = true;
      return { range };
    }

    const pos = range.from;
    const line = state.doc.lineAt(pos);
    const indent = listItemContentIndent(state, pos) ?? /^[ \t]*/.exec(line.text)![0];
    const insert = state.lineBreak + indent;
    const rangeChanges: ChangeSpec[] = [{ from: pos, insert }];

    return { range: EditorSelection.cursor(pos + insert.length), changes: rangeChanges };
  });

  if (blocked) return false;
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};
