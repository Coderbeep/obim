import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

export const isCaretInsideImageEffect = StateEffect.define<boolean>();
export const isCaretInsideImageField = StateField.define({
  create: () => false,
  update(value, transaction) {
    for (let effect of transaction.effects) {
      if (effect.is(isCaretInsideImageEffect)) {
        value = effect.value;
      }
    }
    return value;
  },
});

export const activeImageWidgetPositionEffect = StateEffect.define<
  [number, number] | null
>();
export const activeImageWidgetPositionField = StateField.define({
  create: () => [],
  update(value, transaction) {
    for (let effect of transaction.effects) {
      if (effect.is(activeImageWidgetPositionEffect)) {
        value = effect.value;
      }
    }
    return value;
  },
});

export const toggleImageEffect = StateEffect.define<DecorationSet>();
export const imageField = StateField.define({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (let effect of transaction.effects) {
      if (effect.is(toggleImageEffect)) {
        decorations = effect.value;
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});
