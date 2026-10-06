import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type ChangeSpec,
  type Transaction,
} from "@renderer/features/editor/codemirror-state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@renderer/features/editor/codemirror-view";
import { styleTags, Tag } from "@lezer/highlight";
import { Element, type MarkdownExtension } from "@lezer/markdown";

import { isFrontmatterFence, parseFrontmatter, type FrontmatterResult } from "@shared/frontmatter";

const frontmatterTags = {
  Frontmatter: Tag.define(),
  FrontmatterMark: Tag.define(),
};

const shouldReparseFrontmatter = (previous: FrontmatterResult, transaction: Transaction) => {
  if (!transaction.docChanged) return false;

  const startDocument = transaction.startState.doc;
  if (previous.kind === "none") {
    if (startDocument.lines === 1) return true;
    const firstLineBoundary = startDocument.line(2).from;
    let touchesFirstLine = false;
    transaction.changes.iterChangedRanges((from) => {
      if (from < firstLineBoundary) touchesFirstLine = true;
    });
    return touchesFirstLine;
  }

  const envelope = previous.envelope;
  if (!envelope) return true;

  const envelopeEnd = envelope.range.to;
  const closingFenceHasNoLineBreak =
    envelopeEnd === startDocument.length &&
    envelopeEnd > 0 &&
    !/[\r\n]/.test(startDocument.sliceString(envelopeEnd - 1, envelopeEnd));
  let touchesEnvelope = false;
  transaction.changes.iterChangedRanges((from) => {
    if (from < envelopeEnd || (closingFenceHasNoLineBreak && from === envelopeEnd)) touchesEnvelope = true;
  });
  return touchesEnvelope;
};

export const frontmatterState = StateField.define<FrontmatterResult>({
  create: (state) => parseFrontmatter(state.doc.toString()),
  update: (value, transaction) =>
    shouldReparseFrontmatter(value, transaction) ? parseFrontmatter(transaction.state.doc.toString()) : value,
});

export const setFrontmatterSourceEditingEffect = StateEffect.define<boolean>();

export const frontmatterSourceEditingState = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFrontmatterSourceEditingEffect)) value = effect.value;
    }
    return transaction.docChanged && transaction.state.field(frontmatterState).kind === "none" ? false : value;
  },
});

export const frontmatter: MarkdownExtension = {
  defineNodes: [{ name: "Frontmatter", block: true }, "FrontmatterMark"],
  props: [
    styleTags({
      Frontmatter: frontmatterTags.Frontmatter,
      FrontmatterMark: frontmatterTags.FrontmatterMark,
    }),
  ],
  parseBlock: [
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse: (cx, line) => {
        const children = new Array<Element>();
        if (cx.lineStart !== 0 || !isFrontmatterFence(line.text)) return false;

        children.push(cx.elt("FrontmatterMark", 0, line.text.length + 1));
        while (cx.nextLine()) {
          if (!isFrontmatterFence(line.text)) continue;

          const markFrom = cx.lineStart;
          const markTo = markFrom + line.text.length;
          const hasFollowingLine = cx.nextLine();
          const end = markTo + (hasFollowingLine ? 1 : 0);
          children.push(cx.elt("FrontmatterMark", markFrom, end));
          cx.addElement(cx.elt("Frontmatter", 0, end, children));
          return true;
        }
        return false;
      },
    },
  ],
};

class FrontmatterErrorWidget extends WidgetType {
  constructor(private readonly message: string) {
    super();
  }

  toDOM() {
    const container = document.createElement("div");
    container.className =
      "cm-frontmatter-error flex items-center rounded-md border border-destructive/30 bg-destructive/8 px-2 py-1 text-ui-meta text-destructive";
    container.setAttribute("role", "alert");
    container.textContent = `Fix note details: ${this.message}`;
    return container;
  }

  eq(other: FrontmatterErrorWidget) {
    return other.message === this.message;
  }

  ignoreEvent() {
    return true;
  }
}

class FrontmatterSourceOnlyWidget extends WidgetType {
  toDOM() {
    const container = document.createElement("div");
    container.className =
      "cm-frontmatter-source-only flex items-center rounded-md border border-border bg-[var(--selection-track)] px-2 py-1 text-ui-meta text-muted-foreground";
    container.setAttribute("role", "status");
    container.textContent = "Note details are unavailable for this YAML. Edit the source directly.";
    return container;
  }

  eq(other: FrontmatterSourceOnlyWidget) {
    return other instanceof FrontmatterSourceOnlyWidget;
  }

  ignoreEvent() {
    return true;
  }
}

const createFrontmatterDecorations = (state: EditorState) => {
  if (state.doc.length === 0) return Decoration.none;

  const parsed = state.field(frontmatterState);
  const editingSource = state.field(frontmatterSourceEditingState);
  if (parsed.kind === "invalid") {
    const position = parsed.envelope?.range.from ?? 0;
    return Decoration.set([
      Decoration.widget({
        widget: new FrontmatterErrorWidget(parsed.diagnostics[0]?.message ?? "Invalid frontmatter."),
        block: true,
        side: -1,
      }).range(position),
    ]);
  }

  if (parsed.kind === "valid" && parsed.managed && !editingSource) {
    const { from, to } = parsed.envelope.range;
    const trailingNewline = parsed.envelope.newline;
    const hiddenTo =
      to === state.doc.length && state.doc.sliceString(to - trailingNewline.length, to) === trailingNewline
        ? to - trailingNewline.length
        : to;
    return Decoration.set([Decoration.replace({ block: true }).range(from, hiddenTo)]);
  }

  if (parsed.kind === "valid" && !editingSource) {
    return Decoration.set([
      Decoration.widget({ widget: new FrontmatterSourceOnlyWidget(), block: true, side: -1 }).range(
        parsed.envelope.range.from,
      ),
    ]);
  }

  return Decoration.none;
};

const frontmatterVisibilityField = StateField.define<DecorationSet>({
  create: createFrontmatterDecorations,
  update(decorations, transaction) {
    return transaction.docChanged || transaction.effects.some((effect) => effect.is(setFrontmatterSourceEditingEffect))
      ? createFrontmatterDecorations(transaction.state)
      : decorations;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

const protectFrontmatterInput = (transaction: Transaction) => {
  if (!transaction.docChanged || (!transaction.isUserEvent("input") && !transaction.isUserEvent("delete"))) {
    return transaction;
  }
  if (
    transaction.startState.field(frontmatterSourceEditingState) ||
    transaction.state.field(frontmatterSourceEditingState, false)
  )
    return transaction;
  const frontmatter = transaction.startState.field(frontmatterState);
  if (frontmatter.kind !== "valid" || !frontmatter.managed) return transaction;

  const bodyFrom = frontmatter.envelope.range.to;
  const needsBodyLineBreak =
    bodyFrom === transaction.startState.doc.length &&
    !/[\r\n]$/.test(transaction.startState.doc.sliceString(0, bodyFrom));
  const changes: ChangeSpec[] = [];
  let corrected = false;
  transaction.changes.iterChanges((from, to, _fromB, _toB, insert) => {
    if (from < bodyFrom) {
      corrected = true;
      // An edit wholly inside hidden metadata is rejected. A replacement
      // crossing its boundary owns only the selected visible body.
      if (to < bodyFrom) return;
      from = bodyFrom;
    }
    if (from === bodyFrom && needsBodyLineBreak && insert.length && !/^[\r\n]/.test(insert.toString())) {
      insert = transaction.startState.toText(frontmatter.envelope.newline + insert.toString());
      corrected = true;
    }
    changes.push({ from, to, insert });
  });
  if (!corrected) return transaction;

  const replacement = transaction.startState.changes(changes);
  const correction = transaction.changes.invert(transaction.startState.doc).compose(replacement);
  // Compose the correction before publishing one transaction, retaining the
  // original annotations/effects and a single undo entry for delete + insert.
  return transaction.startState.update(transaction, { changes: correction, sequential: true, filter: false });
};

export const editableBodyStart = (state: EditorState) => {
  if (state.field(frontmatterSourceEditingState, false)) return 0;
  const frontmatter = state.field(frontmatterState, false);
  return frontmatter?.kind === "valid" && frontmatter.managed ? frontmatter.envelope.range.to : 0;
};

const selectionOutsideManagedFrontmatter = (state: EditorState) => {
  if (state.field(frontmatterSourceEditingState, false)) return null;
  const frontmatter = state.field(frontmatterState, false);
  if (frontmatter?.kind !== "valid" || !frontmatter.managed) return null;

  const { from, to } = frontmatter.envelope.range;
  const outside = (position: number) => (position >= from && position < to ? to : position);
  const ranges = state.selection.ranges.map((range) =>
    EditorSelection.range(outside(range.anchor), outside(range.head)),
  );
  if (ranges.every((range, index) => range.eq(state.selection.ranges[index]))) return null;
  return EditorSelection.create(ranges, state.selection.mainIndex);
};

const keepSelectionOutsideFrontmatter = EditorState.transactionFilter.of((transaction) => {
  transaction = protectFrontmatterInput(transaction);
  const selection = selectionOutsideManagedFrontmatter(transaction.state);
  if (!selection) return transaction;
  return [
    transaction,
    {
      selection,
      sequential: true,
    },
  ];
});

const revealCaretOutsideManagedFrontmatter = EditorView.domEventHandlers({
  focus(_event, view) {
    const selection = selectionOutsideManagedFrontmatter(view.state);
    if (selection) view.dispatch({ selection, scrollIntoView: true });
  },
});

export const FrontmatterExtension = [
  frontmatterState,
  frontmatterSourceEditingState,
  revealCaretOutsideManagedFrontmatter,
  EditorView.cursorScrollMargin.of({ x: 5, y: 12 }),
  frontmatterVisibilityField,
  keepSelectionOutsideFrontmatter,
];
