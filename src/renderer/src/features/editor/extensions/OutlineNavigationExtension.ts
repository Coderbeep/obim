import { StateEffect, StateField } from "@renderer/features/editor/codemirror-state";
import { Decoration, EditorView } from "@renderer/features/editor/codemirror-view";

export const OUTLINE_ACTIVE_LINE_EVENT = "obim:outline-active-line";

export interface OutlineActiveLineDetail {
  editor: HTMLElement;
  line: number;
}

const publishActiveOutlineLine = (view: EditorView) => {
  window.dispatchEvent(
    new CustomEvent<OutlineActiveLineDetail>(OUTLINE_ACTIVE_LINE_EVENT, {
      detail: {
        editor: view.dom,
        line: view.state.doc.lineAt(view.state.selection.main.head).number,
      },
    }),
  );
};

interface OutlineLineHighlight {
  from: number;
  token: number;
}

export const showOutlineLineHighlightEffect = StateEffect.define<OutlineLineHighlight>({
  map: (value, mapping) => ({ ...value, from: mapping.mapPos(value.from) }),
});

export const clearOutlineLineHighlightEffect = StateEffect.define<number>();

const outlineLineDecoration = Decoration.line({ class: "cm-outline-target-line" });

const outlineLineHighlightField = StateField.define<OutlineLineHighlight | null>({
  create: () => null,
  update(value, transaction) {
    let next = value;

    if (next && transaction.docChanged) {
      const mapped = transaction.changes.mapPos(next.from);
      const line = transaction.state.doc.lineAt(Math.min(mapped, transaction.state.doc.length));
      next = { ...next, from: line.from };
    }

    for (const effect of transaction.effects) {
      if (effect.is(showOutlineLineHighlightEffect)) {
        const line = transaction.state.doc.lineAt(Math.min(effect.value.from, transaction.state.doc.length));
        next = { ...effect.value, from: line.from };
      }

      if (effect.is(clearOutlineLineHighlightEffect) && next?.token === effect.value) {
        next = null;
      }
    }

    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) =>
      value ? Decoration.set([outlineLineDecoration.range(value.from)], true) : Decoration.none,
    ),
});

const outlineLineHighlightTheme = EditorView.theme({
  ".cm-line.cm-outline-target-line": {
    backgroundColor: "color-mix(in srgb, var(--ring) 14%, transparent) !important",
    borderRadius: "4px",
    transition: "background-color 160ms ease",
  },
});

const activeOutlineLinePublisher = [
  EditorView.updateListener.of((update) => {
    if ((!update.selectionSet && !update.docChanged) || !update.view.hasFocus) return;

    const before = update.startState.doc.lineAt(update.startState.selection.main.head).number;
    const after = update.state.doc.lineAt(update.state.selection.main.head).number;
    if (before !== after) publishActiveOutlineLine(update.view);
  }),
  EditorView.domEventHandlers({
    focus(_event, view) {
      publishActiveOutlineLine(view);
    },
  }),
];

export const OutlineNavigationExtension = [
  outlineLineHighlightField,
  outlineLineHighlightTheme,
  activeOutlineLinePublisher,
];
