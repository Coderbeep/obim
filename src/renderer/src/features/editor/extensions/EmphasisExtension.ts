import { Decoration } from "@renderer/features/editor/codemirror-view";
import type { EditorView } from "@renderer/features/editor/codemirror-view";
import { buildHideRevealDecorations, createHideRevealRegistry } from "./shared/hideRevealRegistry";

const emphasisDecorations = {
  EmphasisMark: Decoration.mark({ class: "cm-formatting-emphasis-mark" }),
  EmphasisMarkHidden: Decoration.replace({}),
  Emphasis: Decoration.mark({ class: "cm-formatting-italic-text" }),
  StrongEmphasis: Decoration.mark({ class: "cm-formatting-bold-text" }),
};

const emphasisHideRevealRules = [
  {
    node: "StrongEmphasis",
    markers: "EmphasisMark",
    content: emphasisDecorations.StrongEmphasis,
    revealedMarker: emphasisDecorations.EmphasisMark,
    hiddenMarker: emphasisDecorations.EmphasisMarkHidden,
  },
  {
    node: "Emphasis",
    markers: "EmphasisMark",
    content: emphasisDecorations.Emphasis,
    revealedMarker: emphasisDecorations.EmphasisMark,
    hiddenMarker: emphasisDecorations.EmphasisMarkHidden,
  },
] as const;

export function buildEmphasisDecorations(view: EditorView) {
  return buildHideRevealDecorations(view, emphasisHideRevealRules);
}

export const EmphasisExtension = createHideRevealRegistry(emphasisHideRevealRules);
