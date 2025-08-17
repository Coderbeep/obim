import { RangeSetBuilder, StateField, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { getNotesDirectoryPath } from "@shared/constants";
import { fileRepository } from "@renderer/services/FileRepository";
import {
  closeOverlay,
  OverlayManager,
  updateImageOverlayKeymap,
} from "./ImageExtensionOverlay";
import { imageOverlayEffect, setViewportEffect } from "./ImageExtensionState";

const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif"];
const imageCache = new Map<string, HTMLImageElement>();

// --- Utils ---
function checkImageExists(src: string) {
  if (!ACCEPTED_EXTENSIONS.some((ext) => src.endsWith(ext)))
    return Promise.resolve(false);
  return fileRepository.exists(getNotesDirectoryPath() + src);
}

// --- Image Widget ---
class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly reactive: boolean
  ) {
    super();
  }

  toDOM(view: EditorView) {
    console.log("[INFO] Creating ImageWidget for:", this.src);
    const container = document.createElement("div");
    container.className = "cm-image-widget cm-image-error";
    container.innerHTML = `Image '${this.src}' not found`;

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
    decorations = decorations.map(tr.changes);
    const sel = tr.state.selection.main;

    const needsRebuild = tr.docChanged || !decorations.size || tr.selection;

    if (needsRebuild) {
      const builder = new RangeSetBuilder<Decoration>();
      const { from, to } = { from: 0, to: tr.state.doc.length };

      syntaxTree(tr.state).iterate({
        from,
        to,
        enter: (node) => {
          if (node.name === "Image") {
            const isActive = sel.from >= node.from && sel.to <= node.to;
            const isInside = sel.from >= node.from + 3 && sel.to <= node.to - 2;
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
                widget: new ImageWidget(src, isInside),
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
  const effects: StateEffect<any>[] = [];

  if (update.viewportChanged || update.docChanged) {
    const { from, to } = update.view.viewport;
    effects.push(setViewportEffect.of({ from, to }));
  }

  if (update.selectionSet || update.docChanged) {
    const state = update.view.state;
    const { from, to } = state.selection.main;
    let caretInside: boolean = false;
    let activePos: [number, number] | null = null;

    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === "Image") {
          const isActive = from >= node.from && to <= node.to;
          const isInside = from >= node.from + 3 && to <= node.to - 2;

          if (isActive) {
            activePos = [node.from + 3, node.to - 2];
          }
          if (isInside) {
            caretInside = true;
          }
        }
      },
    });

    effects.push(imageOverlayEffect.of({ caretInside, activePos }));

    if (caretInside) {
      updateImageOverlayKeymap(update.view, true);
    } else {
      closeOverlay(update.view);
    }
  }

  if (effects.length > 0) {
    update.view.dispatch({ effects });
  }
});

// --- Final extension ---
export const ImageExtension = [imageField, imageViewportAndStatePlugin];
