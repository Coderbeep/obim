import { EditorSelection, Prec } from "@renderer/features/editor/codemirror-state";
import { isShortcut } from "@renderer/shared/keyboardShortcuts";
import { EditorView, keymap } from "@renderer/features/editor/codemirror-view";
import type { ChangeSpec, StateCommand } from "@renderer/features/editor/codemirror-state";
import { markdownLinksInText, type MarkdownLinkInfo } from "./shared/OverlayMarkdown";

export function toggleWrap(before: string, after = before): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const beforeFrom = range.from - before.length;
      const afterTo = range.to + after.length;
      const hasWrap =
        beforeFrom >= 0 &&
        afterTo <= state.doc.length &&
        state.doc.sliceString(beforeFrom, range.from) === before &&
        state.doc.sliceString(range.to, afterTo) === after;

      if (hasWrap) {
        const rangeChanges: ChangeSpec[] = [
          { from: beforeFrom, to: range.from },
          { from: range.to, to: afterTo },
        ];
        const anchor = beforeFrom;
        const head = range.empty ? beforeFrom : range.to - before.length;
        return { changes: rangeChanges, range: EditorSelection.range(anchor, head) };
      }

      if (range.empty) {
        return {
          changes: { from: range.from, insert: before + after },
          range: EditorSelection.cursor(range.from + before.length),
        };
      }

      const selectedText = state.doc.sliceString(range.from, range.to);
      const content = selectedText.trim();
      if (!content) return { range };

      const leadingWhitespace = selectedText.length - selectedText.trimStart().length;
      const trailingWhitespace = selectedText.length - selectedText.trimEnd().length;
      const contentFrom = range.from + leadingWhitespace;
      const contentTo = range.to - trailingWhitespace;
      return {
        changes: [
          { from: contentFrom, insert: before },
          { from: contentTo, insert: after },
        ],
        range: EditorSelection.range(contentFrom + before.length, contentTo + before.length),
      };
    });

    dispatch?.(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export function toggleWrapSelection(before: string, after = before): StateCommand {
  const command = toggleWrap(before, after);
  return (target) => {
    if (target.state.selection.ranges.every((range) => range.empty)) return false;
    return command(target);
  };
}

function selectedMarkdownLink(
  state: Parameters<StateCommand>[0]["state"],
  range: { from: number; to: number },
): MarkdownLinkInfo | null {
  const selection = { from: range.from, to: range.to };
  const selectedText = state.doc.sliceString(range.from, range.to);
  const wholeLink = markdownLinksInText(selectedText, range.from, selection).find(
    (link) => link.from === range.from && link.to === range.to,
  );
  if (wholeLink) return wholeLink;

  const firstLine = state.doc.lineAt(range.from);
  const lastLine = state.doc.lineAt(range.to);
  if (firstLine.number !== lastLine.number) return null;
  return (
    markdownLinksInText(firstLine.text, firstLine.from, selection, state).find(
      (link) => link.textFrom === range.from && link.textTo === range.to,
    ) ?? null
  );
}

export const toggleLink: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    if (range.empty) {
      return {
        changes: { from: range.from, insert: "[]()" },
        range: EditorSelection.cursor(range.from + 1),
      };
    }

    const selectedText = state.doc.sliceString(range.from, range.to);
    const selectedLink = selectedMarkdownLink(state, range);
    if (selectedLink) {
      return {
        changes: { from: selectedLink.from, to: selectedLink.to, insert: selectedLink.text },
        range: EditorSelection.range(selectedLink.from, selectedLink.from + selectedLink.text.length),
      };
    }

    const insert = `[${selectedText}]()`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + selectedText.length + 3),
    };
  });

  dispatch?.(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

const FormattingKeymap = Prec.highest([
  EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.isComposing || event.defaultPrevented) return false;
      const commands = [
        ["bold", toggleWrap("**")],
        ["italic", toggleWrap("*")],
        ["inline-code", toggleWrap("`")],
        ["insert-link", toggleLink],
      ] as const;
      const command = commands.find(([id]) => isShortcut(id, event));
      if (!command) return false;
      event.preventDefault();
      return command[1](view);
    },
  }),
  keymap.of([
    { key: "*", run: toggleWrapSelection("*") },
    { key: "`", run: toggleWrapSelection("`") },
  ]),
]);

export default FormattingKeymap;
