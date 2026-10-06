import { cursorLineDown, cursorLineUp } from "@codemirror/commands";
import { EditorSelection, Prec, type EditorState } from "@renderer/features/editor/codemirror-state";
import { keymap, type EditorView } from "@renderer/features/editor/codemirror-view";

export type LineDirection = -1 | 1;
export type LineMoveCommand = (view: EditorView) => boolean;
export type TargetLinePredicate = (state: EditorState, lineNumber: number) => boolean;

/** Keeps ArrowUp aligned with the visual row where CodeMirror renders an unassociated caret. */
export function moveUpFromVisualLineStart(view: EditorView) {
  const selection = view.state.selection;
  if (selection.ranges.length !== 1) return false;

  const cursor = selection.main;
  if (!cursor.empty || cursor.assoc !== 0) return false;

  const before = view.coordsAtPos(cursor.head, -1);
  const after = view.coordsAtPos(cursor.head, 1);
  if (!before || !after || before.bottom > after.top) return false;

  const visualStart = EditorSelection.cursor(cursor.head, 1, undefined, cursor.goalColumn);
  const moved = view.moveVertically(visualStart, false);
  view.dispatch({
    selection: EditorSelection.create([
      moved.head === cursor.head ? view.moveToLineBoundary(visualStart, false) : moved,
    ]),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

export const visualLineNavigationKeymap = Prec.high(keymap.of([{ key: "ArrowUp", run: moveUpFromVisualLineStart }]));

export function moveIntoTargetLine(
  view: EditorView,
  direction: LineDirection,
  isTargetLine: TargetLinePredicate,
  moveLine: LineMoveCommand,
) {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const beforeLine = view.state.doc.lineAt(selection.head);
  const targetLineNumber = beforeLine.number + direction;
  const hasTarget =
    targetLineNumber >= 1 && targetLineNumber <= view.state.doc.lines && isTargetLine(view.state, targetLineNumber);

  if (!hasTarget) return false;

  if (!moveLine(view)) return false;

  const movedSelection = view.state.selection.main;
  const afterLine = view.state.doc.lineAt(movedSelection.head);
  if (direction === 1 ? afterLine.number <= targetLineNumber : afterLine.number >= targetLineNumber) return true;

  const column = movedSelection.head - afterLine.from;
  const targetLine = view.state.doc.line(targetLineNumber);
  view.dispatch({
    selection: EditorSelection.create([
      EditorSelection.cursor(
        Math.min(targetLine.to, targetLine.from + column),
        direction,
        undefined,
        movedSelection.goalColumn,
      ),
    ]),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

export function moveDownIntoTargetLine(
  view: EditorView,
  isTargetLine: TargetLinePredicate,
  moveLineDown: LineMoveCommand = cursorLineDown,
) {
  return moveIntoTargetLine(view, 1, isTargetLine, moveLineDown);
}

export function moveUpIntoTargetLine(
  view: EditorView,
  isTargetLine: TargetLinePredicate,
  moveLineUp: LineMoveCommand = cursorLineUp,
) {
  return moveIntoTargetLine(view, -1, isTargetLine, moveLineUp);
}

export function targetLineNavigationKeymap(isTargetLine: TargetLinePredicate) {
  return Prec.highest(
    keymap.of([
      {
        key: "ArrowUp",
        run: (view) => moveUpIntoTargetLine(view, isTargetLine),
      },
      {
        key: "ArrowDown",
        run: (view) => moveDownIntoTargetLine(view, isTargetLine),
      },
    ]),
  );
}
