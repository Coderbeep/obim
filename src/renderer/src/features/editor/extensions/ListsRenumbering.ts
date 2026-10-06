import { syntaxTree } from "@codemirror/language";
import { EditorState, Transaction } from "@renderer/features/editor/codemirror-state";
import type { StateCommand } from "@renderer/features/editor/codemirror-state";
import type { EditorView } from "@renderer/features/editor/codemirror-view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { ancestorNodeAt, childNode, directChildren } from "./shared/syntaxDecorationPlugin";

export function orderedListMark(state: EditorState, mark: { from: number; to: number }) {
  const text = state.doc.sliceString(mark.from, mark.to);
  const match = /^(\d+)([.)])$/.exec(text);
  if (!match) return null;

  return { delimiter: match[2], number: Number(match[1]), text };
}

function changedLineStarts(transaction: Transaction) {
  const lines = new Set<number>();

  transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const startLine = transaction.state.doc.lineAt(Math.min(fromB, transaction.state.doc.length));
    const endLine = transaction.state.doc.lineAt(Math.min(Math.max(fromB, toB), transaction.state.doc.length));

    for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
      lines.add(transaction.state.doc.line(lineNumber).from);
    }
  });

  return lines;
}

function rangeIntersectsOrderedListMarker(state: EditorState, from: number, to: number) {
  if (state.doc.length === 0) return false;

  const line = state.doc.lineAt(Math.min(from, state.doc.length));
  const match = /^(?:[ \t]*>[ \t]*)*[ \t]*\d+[.)]/.exec(line.text);
  if (!match) return false;

  const markerFrom = line.from;
  const markerTo = line.from + match[0].length;
  return from <= markerTo && Math.max(from, to) >= markerFrom;
}

function rangeTouchesOrderedList(state: EditorState, from: number, to: number) {
  if (state.doc.length === 0) return false;

  for (const position of [from, to]) {
    const clamped = Math.max(0, Math.min(position, state.doc.length));
    if (ancestorNodeAt(state, clamped, "OrderedList", -1) || ancestorNodeAt(state, clamped, "OrderedList", 1)) {
      return true;
    }
  }

  return false;
}

function textContainsOrderedListMarker(text: string) {
  return /(?:^|\n)[ \t]*(?:>[ \t]*)*\d+[.)](?=[ \t]|$)/.test(text);
}

export function transactionMayTouchOrderedListMarker(transaction: Transaction) {
  let mayTouch = false;

  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (mayTouch) return;

    const removed = transaction.startState.doc.sliceString(fromA, toA);
    const inserted = transaction.state.doc.sliceString(fromB, toB);

    mayTouch =
      rangeIntersectsOrderedListMarker(transaction.startState, fromA, toA) ||
      rangeIntersectsOrderedListMarker(transaction.state, fromB, toB) ||
      textContainsOrderedListMarker(removed) ||
      textContainsOrderedListMarker(inserted) ||
      ((removed.includes("\n") || inserted.includes("\n")) &&
        (rangeTouchesOrderedList(transaction.startState, fromA, toA) ||
          rangeTouchesOrderedList(transaction.state, fromB, toB)));
  });

  return mayTouch;
}

function orderedListsTouchingRanges(state: EditorState, ranges: readonly { from: number; to: number }[]) {
  const lists = new Map<string, SyntaxNode>();
  const tree = syntaxTree(state);

  for (const range of ranges) {
    if (state.doc.length === 0) break;

    const from = Math.max(0, Math.min(range.from, state.doc.length));
    const to = Math.max(from, Math.min(range.to, state.doc.length));
    const firstLine = state.doc.lineAt(from);
    const lastLine = state.doc.lineAt(to);
    const scopeFrom = firstLine.from;
    const scopeTo = Math.min(state.doc.length, Math.max(lastLine.to, scopeFrom + 1));

    tree.iterate({
      from: scopeFrom,
      to: scopeTo,
      enter(node) {
        if (node.name === "OrderedList") lists.set(`${node.from}:${node.to}`, node.node);
      },
    });
  }

  return [...lists.values()];
}

function changedOrderedListMarkAnchors(transaction: Transaction) {
  const changedRangesA: { from: number; to: number }[] = [];
  const changedRangesB: { from: number; to: number }[] = [];
  const anchors = new Map<number, number>();
  const finalMarksByLine = new Map<number, ReturnType<typeof orderedListMark>>();

  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    changedRangesA.push({ from: fromA, to: toA });
    changedRangesB.push({ from: fromB, to: toB });
  });

  for (const list of orderedListsTouchingRanges(transaction.state, changedRangesB)) {
    for (const item of directChildren(list, "ListItem")) {
      const mark = childNode(item, "ListMark");
      if (!mark) continue;
      const parsed = orderedListMark(transaction.state, mark);
      if (!parsed) continue;

      const lineStart = transaction.state.doc.lineAt(mark.from).from;
      finalMarksByLine.set(lineStart, parsed);

      const touched = changedRangesB.some(({ from, to }) =>
        from === to ? from > mark.from && from < mark.to : from < mark.to && to > mark.from,
      );
      if (touched) anchors.set(lineStart, parsed.number);
    }
  }

  for (const list of orderedListsTouchingRanges(transaction.startState, changedRangesA)) {
    const items = directChildren(list, "ListItem").flatMap((item) => {
      const mark = childNode(item, "ListMark");
      if (!mark) return [];

      const parsed = orderedListMark(transaction.startState, mark);
      if (!parsed) return [];

      return [{ mark, parsed }];
    });

    items.forEach(({ mark, parsed }, index) => {
      const touched = changedRangesA.some(({ from, to }) =>
        from === to ? from >= mark.from && from <= mark.to : from < mark.to && to > mark.from,
      );
      if (!touched) return;

      const mappedLine = transaction.state.doc.lineAt(transaction.changes.mapPos(mark.from)).from;
      if (anchors.has(mappedLine)) return;

      const markerSurvivedEdit = changedRangesA.some(
        ({ from, to }) => from < mark.to && to > mark.from && !(from <= mark.from && to >= mark.to),
      );
      const finalMark = markerSurvivedEdit ? finalMarksByLine.get(mappedLine) : null;
      if (finalMark) {
        anchors.set(mappedLine, finalMark.number);
        return;
      }

      const next = items[index + 1];
      if (!next) return;

      const nextLine = transaction.state.doc.lineAt(transaction.changes.mapPos(next.mark.from)).from;
      anchors.set(nextLine, parsed.number);
    });
  }

  return anchors;
}

function orderedListRenumberChanges(
  state: EditorState,
  resetStartLines = new Set<number>(),
  anchorStartNumbers?: Map<number, number>,
) {
  const changes: { from: number; to: number; insert: string }[] = [];
  const handledAnchorLines = new Set<number>();

  const renumberList = (node: SyntaxNode | SyntaxNodeRef) => {
    const items = directChildren(node, "ListItem").flatMap((item) => {
      const mark = childNode(item, "ListMark");
      if (!mark) return [];

      const parsed = orderedListMark(state, mark);
      if (!parsed) return [];

      return [{ mark, parsed }];
    });

    const startIndex = anchorStartNumbers
      ? items.findIndex(({ mark }) => anchorStartNumbers.has(state.doc.lineAt(mark.from).from))
      : 0;
    if (startIndex < 0) return;

    const first = items[startIndex];
    if (!first) return;

    const firstLine = state.doc.lineAt(first.mark.from).from;
    if (anchorStartNumbers) handledAnchorLines.add(firstLine);

    const startNumber =
      anchorStartNumbers?.get(firstLine) ?? (resetStartLines.has(firstLine) ? 1 : first.parsed.number);

    items.slice(startIndex).forEach(({ mark, parsed }, index) => {
      const next = `${startNumber + index}${parsed.delimiter}`;

      if (parsed.text !== next) {
        changes.push({ from: mark.from, to: mark.to, insert: next });
      }
    });
  };

  if (anchorStartNumbers) {
    const anchorRanges = [...anchorStartNumbers.keys()].map((from) => ({ from, to: from }));
    orderedListsTouchingRanges(state, anchorRanges).forEach(renumberList);
  } else {
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === "OrderedList") renumberList(node);
      },
    });
  }

  if (anchorStartNumbers) {
    for (const [lineStart, startNumber] of anchorStartNumbers) {
      if (handledAnchorLines.has(lineStart)) continue;

      const firstLine = state.doc.lineAt(Math.min(lineStart, state.doc.length));
      const firstMatch = /^(\s*)(\d+)([.)])(?=\s|$)/.exec(firstLine.text);
      if (!firstMatch) continue;

      const indent = firstMatch[1].length;
      let number = startNumber;

      for (let lineNumber = firstLine.number; lineNumber <= state.doc.lines; lineNumber++) {
        const line = state.doc.line(lineNumber);
        const textIndent = /^[ \t]*/.exec(line.text)![0].length;
        if (textIndent < indent) break;
        if (textIndent > indent) continue;

        const match = /^(\s*)(\d+)([.)])(?=\s|$)/.exec(line.text);
        if (!match) break;

        const next = `${number}${match[3]}`;
        if (match[2] + match[3] !== next) {
          changes.push({
            from: line.from + match[1].length,
            to: line.from + match[1].length + match[2].length + 1,
            insert: next,
          });
        }
        number++;
      }
    }
  }

  return changes.sort((a, b) => a.from - b.from);
}

export function runAndRenumber(command: StateCommand) {
  return (view: EditorView) => {
    const captured: { transaction: Transaction | null } = { transaction: null };

    if (
      !command({
        state: view.state,
        dispatch: (transaction) => {
          captured.transaction = transaction;
        },
      })
    ) {
      return false;
    }

    const indentationTransaction = captured.transaction;
    if (!indentationTransaction) return true;

    const renumberChanges = orderedListRenumberChanges(
      indentationTransaction.state,
      indentationTransaction.isUserEvent("input.indent") ? changedLineStarts(indentationTransaction) : undefined,
    );
    if (!renumberChanges.length) {
      view.dispatch(indentationTransaction);
      return true;
    }

    view.dispatch(view.state.update(indentationTransaction, { changes: renumberChanges, sequential: true }));
    return true;
  };
}

export const orderedListRenumberFilter = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged) return transaction;
  if (!transactionMayTouchOrderedListMarker(transaction)) return transaction;

  const anchorStartNumbers = changedOrderedListMarkAnchors(transaction);
  if (!anchorStartNumbers.size) return transaction;

  const renumberChanges = orderedListRenumberChanges(transaction.state, new Set(), anchorStartNumbers);
  if (!renumberChanges.length) return transaction;

  return [transaction, { changes: renumberChanges, sequential: true }];
});
