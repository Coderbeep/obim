import { indentLess, indentMore } from "@codemirror/commands";
import { getIndentUnit, syntaxTree } from "@codemirror/language";
import { countColumn, EditorState, Prec } from "@renderer/features/editor/codemirror-state";
import type { StateCommand } from "@renderer/features/editor/codemirror-state";
import { keymap } from "@renderer/features/editor/codemirror-view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { orderedListMark, runAndRenumber } from "./ListsRenumbering";
import { ancestorNodeAt, childNode, directChildren } from "./shared/syntaxDecorationPlugin";

function nestingColumnInState(state: EditorState, node: SyntaxNodeRef) {
  const mark = childNode(node, "ListMark");
  if (!mark) return null;

  const line = state.doc.lineAt(mark.from);
  const afterMarkText = state.doc.sliceString(mark.to, line.to);
  const afterMark = /^[ \t]*/.exec(afterMarkText)![0];
  return countColumn(line.text, state.tabSize, mark.to - line.from + afterMark.length);
}

function listItemAt(state: EditorState, pos: number) {
  return ancestorNodeAt(state, pos, "ListItem");
}

function markerAfterListItem(state: EditorState, item: SyntaxNode) {
  const mark = childNode(item, "ListMark");
  if (!mark) return null;

  const line = state.doc.lineAt(mark.from);
  const indent = state.doc.sliceString(line.from, mark.from);
  const afterMarkText = state.doc.sliceString(mark.to, line.to);
  const afterMark = /^[ \t]*/.exec(afterMarkText)![0];
  const task = /^([ \t]*)\[[ xX]\]([ \t]*)/.exec(afterMarkText);
  const prefix = task ? `${task[1]}[ ]${task[2] || " "}` : afterMark || " ";
  const ordered = orderedListMark(state, mark);

  if (ordered) return `${indent}${ordered.number + 1}${ordered.delimiter}${prefix}`;

  return `${indent}${state.doc.sliceString(mark.from, mark.to)}${prefix}`;
}

function selectedLineStarts(state: EditorState) {
  const starts = new Set<number>();

  for (const range of state.selection.ranges) {
    const end = range.empty ? range.to : range.to - 1;
    const startLine = state.doc.lineAt(range.from);
    const endLine = state.doc.lineAt(Math.max(range.from, end));

    for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
      starts.add(state.doc.line(lineNumber).from);
    }
  }

  return [...starts].sort((a, b) => a - b);
}

function lineMayHaveListItem(state: EditorState, lineStart: number) {
  return /^(?:[ \t]*>[ \t]*)*[ \t]*(?:[-+*]|\d+[.)])(?:[ \t]|$)/.test(state.doc.lineAt(lineStart).text);
}

function parentListItemIndent(state: EditorState, item: SyntaxNode) {
  const parent = parentListItem(item);
  if (!parent) return 0;

  const mark = childNode(parent, "ListMark");
  return mark ? mark.from - state.doc.lineAt(mark.from).from : 0;
}

function parentListItem(item: SyntaxNode) {
  let parent = item.parent;

  while (parent) {
    if (parent.name === "ListItem") return parent;

    parent = parent.parent;
  }

  return null;
}

function childListIndent(state: EditorState, item: SyntaxNode) {
  const lists = [...directChildren(item, "OrderedList"), ...directChildren(item, "BulletList")].sort(
    (a, b) => a.from - b.from,
  );

  for (const list of lists) {
    const child = directChildren(list, "ListItem")[0];
    const mark = child ? childNode(child, "ListMark") : null;
    if (mark) return mark.from - state.doc.lineAt(mark.from).from;
  }

  if (item.parent?.name === "BulletList") {
    const mark = childNode(item, "ListMark");
    if (mark) return mark.from - state.doc.lineAt(mark.from).from + getIndentUnit(state);
  }

  return nestingColumnInState(state, item);
}

function listItemIndents(state: EditorState) {
  const indents = new Map<number, { indent: number; parentIndent: number; childIndent?: number }>();

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "OrderedList" && node.name !== "BulletList") return;

      directChildren(node, "ListItem").forEach((item, index, items) => {
        const mark = childNode(item, "ListMark");
        if (!mark) return;

        const line = state.doc.lineAt(mark.from);
        const childIndent = index ? childListIndent(state, items[index - 1]) : null;

        indents.set(line.from, {
          indent: mark.from - line.from,
          parentIndent: parentListItemIndent(state, item),
          ...(childIndent === null ? {} : { childIndent }),
        });
      });
    },
  });

  return indents;
}

function emptyListMarkerLine(text: string) {
  return /^(\s*)(?:(\d+)([.)])|[-+*])(?:[ \t]+\[[ xX]\])?\s*$/.exec(text);
}

function continuedListMarkerFromLine(text: string) {
  const task = /^(\s*)(?:(\d+)([.)])|([-+*]))([ \t]+)\[[ xX]\]([ \t]+)(.*\S.*)$/.exec(text);
  if (task) {
    const marker = task[2] ? `${Number(task[2]) + 1}${task[3]}` : task[4];
    return `${task[1]}${marker}${task[5]}[ ]${task[6]}`;
  }

  const ordered = /^(\s*)(\d+)([.)])(\s+)(.*\S.*)$/.exec(text);
  if (ordered) return `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]}${ordered[4]}`;

  const bullet = /^(\s*)([-+*])(\s+)(.*\S.*)$/.exec(text);
  return bullet ? `${bullet[1]}${bullet[2]}${bullet[3]}` : null;
}

export const listAwareIndentMore: StateCommand = ({ state, dispatch }) => {
  const lineStarts = selectedLineStarts(state);
  if (!lineStarts.some((lineStart) => lineMayHaveListItem(state, lineStart))) {
    return indentMore({ state, dispatch });
  }

  const indents = listItemIndents(state);
  let sawListItem = false;
  const changes = lineStarts.flatMap((lineStart) => {
    const item = indents.get(lineStart);
    if (!item) return [];

    sawListItem = true;
    if (item.childIndent === undefined || item.childIndent <= item.indent) return [];

    return [{ from: lineStart, to: lineStart + item.indent, insert: " ".repeat(item.childIndent) }];
  });

  if (!changes.length && sawListItem) return true;
  if (!changes.length) return indentMore({ state, dispatch });

  dispatch(state.update({ changes, userEvent: "input.indent" }));
  return true;
};

export const listAwareIndentLess: StateCommand = ({ state, dispatch }) => {
  const lineStarts = selectedLineStarts(state);
  if (!lineStarts.some((lineStart) => lineMayHaveListItem(state, lineStart))) {
    return indentLess({ state, dispatch });
  }

  const indents = listItemIndents(state);
  let sawListItem = false;
  const changes = lineStarts.flatMap((lineStart) => {
    const item = indents.get(lineStart);
    if (!item) return [];

    sawListItem = true;
    if (item.indent <= item.parentIndent) return [];

    return [{ from: lineStart, to: lineStart + item.indent, insert: " ".repeat(item.parentIndent) }];
  });

  if (!changes.length && sawListItem) return true;
  if (!changes.length) return indentLess({ state, dispatch });

  dispatch(state.update({ changes, userEvent: "delete.dedent" }));
  return true;
};

const continueListItem: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;

  const line = state.doc.lineAt(range.from);
  const lineOffset = range.from - line.from;
  if (line.text.slice(lineOffset).trim()) return false;

  const item = listItemAt(state, range.from);
  if (!item) return false;

  const indents = listItemIndents(state);
  const itemIndent = indents.get(line.from);
  const emptyMarker = emptyListMarkerLine(line.text);

  if (itemIndent && emptyMarker) {
    const markerTo = line.from + emptyMarker[0].length;

    if (itemIndent.indent > itemIndent.parentIndent) {
      const parentItem = parentListItem(item);
      const marker = parentItem
        ? markerAfterListItem(state, parentItem)
        : `${" ".repeat(itemIndent.parentIndent)}${state.doc.sliceString(line.from + itemIndent.indent, markerTo)}`;
      const insert = marker ?? " ".repeat(itemIndent.parentIndent);

      dispatch(
        state.update({
          changes: { from: line.from, to: markerTo, insert },
          selection: { anchor: line.from + insert.length },
          scrollIntoView: true,
          userEvent: "delete.dedent",
        }),
      );
      return true;
    }

    dispatch(
      state.update({
        changes: { from: line.from, to: markerTo, insert: "" },
        selection: { anchor: line.from },
        scrollIntoView: true,
        userEvent: "delete.list",
      }),
    );
    return true;
  }

  const markerLine = !!itemIndent;
  const marker = markerLine ? continuedListMarkerFromLine(line.text) : markerAfterListItem(state, item);

  if (!marker) return false;

  let from = range.from;
  while (from > line.from && /\s/.test(state.doc.sliceString(from - 1, from))) from--;

  const insert = state.lineBreak + marker;
  const cursor = from + insert.length;

  dispatch(
    state.update({
      changes: { from, to: range.from, insert },
      selection: { anchor: cursor },
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

const deleteTaskMarkerBackward: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;

  let taskMarker = ancestorNodeAt(state, range.from, "TaskMarker");

  if (!taskMarker && range.from > 0) {
    taskMarker = ancestorNodeAt(state, range.from - 1, "TaskMarker", 1);
  }

  if (!taskMarker || range.from <= taskMarker.from || range.from > taskMarker.to) return false;

  dispatch(
    state.update({
      changes: { from: range.from - 1, to: range.from },
      scrollIntoView: true,
      userEvent: "delete.backward",
    }),
  );
  return true;
};

const continueListCommand = runAndRenumber(continueListItem);

export function createListKeymap(isEditorOverlayOpen: () => boolean) {
  return Prec.highest(
    keymap.of([
      { key: "Backspace", run: deleteTaskMarkerBackward },
      { key: "Enter", run: (view) => (isEditorOverlayOpen() ? false : continueListCommand(view)) },
      { key: "Tab", run: runAndRenumber(listAwareIndentMore) },
      { key: "Shift-Tab", run: runAndRenumber(listAwareIndentLess) },
      { key: "Mod-]", run: runAndRenumber(listAwareIndentMore) },
      { key: "Ctrl-]", run: runAndRenumber(listAwareIndentMore) },
      { key: "Mod-[", run: runAndRenumber(listAwareIndentLess) },
      { key: "Ctrl-[", run: runAndRenumber(listAwareIndentLess) },
    ]),
  );
}
