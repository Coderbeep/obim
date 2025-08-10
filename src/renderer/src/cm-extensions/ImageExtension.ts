import { RangeSetBuilder, StateField, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { getNotesDirectoryPath } from "@shared/constants";
import { fileRepository } from "@renderer/services/FileRepository";
import { OverlayManager } from "./ImageExtensionOverlay";
import {
  isCaretInsideImageEffect,
  activeImageWidgetPositionEffect,
} from "./ImageExtensionState";

const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif"];
const imageCache = new Map<string, HTMLImageElement>();

// --- Utils ---
function checkImageExists(src: string) {
  if (!ACCEPTED_EXTENSIONS.some((ext) => src.endsWith(ext)))
    return Promise.resolve(false);
  return fileRepository.exists(getNotesDirectoryPath() + src);
}

function isCaretInsideImageFunc(view: EditorView): boolean {
  const state = view.state;
  const { from, to } = state.selection.main;
  let inside = false;

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Image") {
        const isInside = from >= node.from + 3 && to <= node.to - 2;
        if (isInside) inside = true;
      }
    },
  });
  return inside;
}

function activeImageWidgetPositionFunc(
  view: EditorView
): [number, number] | null {
  const state = view.state;
  const { from, to } = state.selection.main;
  let position: [number, number] | null = null;

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Image") {
        const isActive = from >= node.from && to <= node.to;
        if (isActive) {
          position = [node.from + 3, node.to - 2];
        }
      }
    },
  });
  return position;
}

// --- Effect to pass viewport to the StateField ---
const setViewportEffect = StateEffect.define<{ from: number; to: number }>();

// --- Image Widget ---
class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly pos: [number, number],
    private readonly reactive: boolean
  ) {
    super();
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "cm-image-widget cm-image-error";
    container.innerHTML = `Image '${this.src}' not found`;
    console.log(`ImageWidget: ${this.src} at position ${this.pos}`);

    if (imageCache.has(this.src)) {
      const cachedImage = imageCache.get(this.src)!;
      container.innerHTML = "";
      container.className = "cm-image-widget";
      container.appendChild(cachedImage.cloneNode(true));
    } else {
      checkImageExists(this.src).then((exists) => {
        if (exists) {
          container.innerHTML = "";
          container.className = "cm-image-widget";
          const img = document.createElement("img");
          img.src = `media://${this.src}`;
          container.appendChild(img);
          imageCache.set(this.src, img);
        }
      });
    }

    if (this.reactive) {
      requestAnimationFrame(() => {
        OverlayManager.updatePosition(container, this.src);
        OverlayManager.registerSelectionHandler(view);
      });
    }

    return container;
  }

  destroy(dom: HTMLElement) {
    dom.remove();
    OverlayManager.unregisterSelectionHandler();
  }

  eq(other: ImageWidget) {
    return this.src === other.src && this.reactive === other.reactive;
  }
}

// --- StateField for viewport-aware block decorations ---
const imageField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    console.log(tr.state.selection.main.from, tr.state.selection.main.to);
    decorations = decorations.map(tr.changes);

    let viewport: { from: number; to: number } | null = null;
    for (const e of tr.effects) {
      if (e.is(setViewportEffect)) viewport = e.value;
    }

    // Track caret position changes
    const oldCaret = tr.startState.selection.main;
    const newCaret = tr.state.selection.main;

    const caretMovedBetweenImages = (() => {
      if (oldCaret.from === newCaret.from && oldCaret.to === newCaret.to)
        return false;

      let oldNode = null,
        newNode = null;
      syntaxTree(tr.startState).iterate({
        from: oldCaret.from,
        to: oldCaret.to,
        enter: (n) => {
          if (n.name === "Image") oldNode = [n.from, n.to];
        },
      });
      syntaxTree(tr.state).iterate({
        from: newCaret.from,
        to: newCaret.to,
        enter: (n) => {
          if (n.name === "Image") newNode = [n.from, n.to];
        },
      });
      return JSON.stringify(oldNode) !== JSON.stringify(newNode);
    })();

    const needsRebuild =
      (viewport !== null && (tr.docChanged || !decorations.size)) ||
      (tr.selection && caretMovedBetweenImages);

    if (needsRebuild) {
      const builder = new RangeSetBuilder<Decoration>();
      const { from, to } = viewport || { from: 0, to: tr.state.doc.length };
      const sel = tr.state.selection.main;

      syntaxTree(tr.state).iterate({
        from,
        to,
        enter: (node) => {
          if (node.name === "Image") {
            const isActive = sel.from >= node.from && sel.to <= node.to;
            const isCaretInside =
              sel.from >= node.from + 3 && sel.to <= node.to - 2;
            const src = tr.state.doc.sliceString(node.from + 3, node.to - 2);

            if (!isActive) {
              builder.add(
                node.from,
                node.to,
                Decoration.mark({ class: "cm-mark-hidden" })
              );
            }

            builder.add(
              node.from,
              node.to,
              Decoration.mark({ class: "cm-mark-image" })
            );

            builder.add(
              node.to,
              node.to,
              Decoration.widget({
                widget: new ImageWidget(
                  src,
                  [node.from + 3, node.to - 2],
                  isCaretInside
                ),
                block: true,
                side: 0,
                inlineOrder: true,
              })
            );
          }
        },
      });

      return builder.finish();
    }

    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// --- Listener plugin for viewport + caret state ---
const imageViewportAndStatePlugin = EditorView.updateListener.of((update) => {
  if (update.viewportChanged || update.docChanged) {
    const { from, to } = update.view.viewport;
    update.view.dispatch({
      effects: setViewportEffect.of({ from, to }),
    });
  }
  if (update.selectionSet || update.docChanged) {
    update.view.dispatch({
      effects: [
        isCaretInsideImageEffect.of(isCaretInsideImageFunc(update.view)),
        activeImageWidgetPositionEffect.of(
          activeImageWidgetPositionFunc(update.view)
        ),
      ],
    });
  }
});

// --- Final extension ---
export const ImageExtension = [imageField, imageViewportAndStatePlugin];
