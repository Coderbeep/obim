import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from '@codemirror/language';
import { notesDirectoryPath } from '@shared/constants';
import { doesPathExist } from '../../utils/filesDB';
import { activeImageWidgetPositionEffect, imageField, isCaretInsideImageEffect, toggleImageEffect } from "./ImageExtensionState";
import { OverlayManager } from "./ImageExtensionOverlay";

const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif'];
const imageCache = new Map();


const checkImageExists = (src: string) => {
  if (!ACCEPTED_EXTENSIONS.some((ext) => src.endsWith(ext))) return Promise.resolve(false);
  return doesPathExist(notesDirectoryPath + src);
}

function createImageDecorations(view) {
  const builder = new RangeSetBuilder();
  const { from, to } = view.state.selection.main;
  let isCaretInsideGlobal = false;
  let activeWidgetPosition = null;

  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name === 'Image') {
        const isActive = from >= node.from && to <= node.to; // caret inside the image widget
        const isCaretInside = from >= node.from + 3 && to <= node.to - 2; // caret inside writing area of the image widget
        const src = view.state.doc.sliceString(node.from + 3, node.to - 2);

        if (!isCaretInsideGlobal && isCaretInside) isCaretInsideGlobal = true;

        if (!isActive) {
          builder.add(node.from, node.to, Decoration.mark({ class: 'cm-mark-hidden' }));
        } else {
          view.dispatch({
            effects: activeImageWidgetPositionEffect.of([node.from + 3, node.to - 2])
          })
        }

        builder.add(node.from, node.to, Decoration.mark({ class: 'cm-mark-image' }));
        builder.add(node.to, node.to, Decoration.widget({
          widget: new ImageWidget(src, [node.from + 3, node.to - 2], isCaretInside),
          block: true,
          side: 1
        }));

      }
    }
  });

  view.dispatch({
    effects: isCaretInsideImageEffect.of(isCaretInsideGlobal)
  })
  return builder.finish();
}

class ImageWidget extends WidgetType {
  constructor(private readonly src: string, private readonly pos, private readonly reactive) {
    super();
  }

  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = 'cm-image-widget cm-image-error';
    container.innerHTML = `Image '${this.src}' not found`;

    if (imageCache.has(this.src)) {
      const cachedImage = imageCache.get(this.src);
      container.innerHTML = '';
      container.className = 'cm-image-widget';
      container.appendChild(cachedImage.cloneNode(true));
    } else {
      checkImageExists(this.src).then((exists) => {
        if (exists) {
          container.innerHTML = '';
          container.className = 'cm-image-widget';
          const img = document.createElement('img');
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
      })
    }

    return container;
  }

  destroy(dom) {
    dom.remove();
    OverlayManager.unregisterSelectionHandler();
  }

  eq(other: ImageWidget) {
    return this.src === other.src
  }

  get estimatedHeight() { return 100; }
}

export const ImageExtension = [
  imageField,
  EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet) {
      update.view.dispatch({
        effects: toggleImageEffect.of(createImageDecorations(update.view))
      })
    }
  }),
];