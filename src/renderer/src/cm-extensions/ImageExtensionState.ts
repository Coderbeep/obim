import { StateEffect, StateField } from "@codemirror/state";

export interface ImageOverlayState {
  caretInside: boolean
  activePos: [number, number] | null
}

export const imageOverlayEffect = StateEffect.define<ImageOverlayState>();

export const imageOverlayField = StateField.define<ImageOverlayState>({
  create: () => ({ caretInside: false, activePos: null }),
  update(value, transaction) {
    for (const e of transaction.effects) {
      if (e.is(imageOverlayEffect)) value = e.value;
    }
    return value;
  },
});

export const setViewportEffect = StateEffect.define<{
  from: number;
  to: number;
}>();
