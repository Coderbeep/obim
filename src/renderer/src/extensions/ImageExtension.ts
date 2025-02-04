import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { notesDirectoryPath } from '@shared/constants';
import { doesPathExist } from '../../utils/db';

// TODO: Vertical scrolling does not work properly
// TODO: OnClick event for the image widget
// TODO: Proper url handling
// TODO: Image widgets styling
// TODO: Local image handling

const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif'];

const toggleImageEffect = StateEffect.define<DecorationSet>();

const imageField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    for (let effect of transaction.effects) {
      if (effect.is(toggleImageEffect)) {
        decorations = effect.value;
      }
    }
    return decorations;
  },
  provide: field => EditorView.decorations.from(field)
});

const imageCache = new Map();

function checkImageExists(src) {
  if (!src.endsWith('.png')) {
    return Promise.resolve(false);
  }

  return doesPathExist(notesDirectoryPath + src).then((exists) => {
    return exists;
  })
}

function createImageDecorations(view) {
  const builder = new RangeSetBuilder();
  const { from, to } = view.state.selection.main;

  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name === 'Image') {
        const isActive = from >= node.from && to <= node.to;
        const src = view.state.doc.sliceString(node.from + 3, node.to - 2);

        if (!isActive) {
          builder.add(node.from, node.to, Decoration.mark({ class: 'cm-mark-hidden' }));
        }

        builder.add(node.to, node.to, Decoration.widget({
          widget: new ImageWidget(src, [node.from + 3, node.to - 2]),
          block: true,
          side: 1
        }));
      }
    }
  });

  return builder.finish();
}

function toggleImageVisibility(view) {
  view.dispatch({
    effects: toggleImageEffect.of(createImageDecorations(view))
  });
}

class ImageWidget extends WidgetType {
  private container = document.createElement('div');
  private overlayUpdater: number | null = null; // Store animation frame

  constructor(private readonly src: string, private readonly pos) {
    super();
  }

  toDOM(view: EditorView) {
    this.container = document.createElement('div');
    this.container.className = 'cm-image-widget cm-image-error';
    this.container.innerHTML = `Image '${this.src}' not found`;

    requestAnimationFrame(() => this.updateOverlayWindowPosition(view, this.container, this.src, this.pos));
    
    if (imageCache.has(this.src)) {
      const cachedImage = imageCache.get(this.src);
      this.container.innerHTML = '';
      this.container.className = 'cm-image-widget';
      this.container.appendChild(cachedImage.cloneNode(true));
    } else {
      checkImageExists(this.src).then((exists) => {
        if (exists) {
          this.container.innerHTML = '';
          this.container.className = 'cm-image-widget';
          const img = document.createElement('img');
          img.src = `media://${this.src}`;
          this.container.appendChild(img);
          imageCache.set(this.src, img);
        }
      });
    }
    
    this.startOverlayTracking(view, this.container, this.src, this.pos);
    return this.container;
  }

  updateOverlayWindowPosition(view: EditorView, widgetNode: HTMLElement, src: string, pos) {
    const overlay = document.getElementById('image-overlay');
    if (!overlay) return;

    const rect = widgetNode.getBoundingClientRect();
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
  }

  startOverlayTracking(view: EditorView, widgetNode: HTMLElement, src: string, pos) {
    if (this.overlayUpdater !== null) {
      cancelAnimationFrame(this.overlayUpdater);
    }

    const updatePosition = () => {
      this.updateOverlayWindowPosition(view, widgetNode, src, pos);
      this.overlayUpdater = requestAnimationFrame(updatePosition); 
    };

    this.overlayUpdater = requestAnimationFrame(updatePosition);
  }

  destroy(dom) {
    dom.remove();
    if (this.overlayUpdater !== null) {
      cancelAnimationFrame(this.overlayUpdater);
    }
  }

  eq(other: ImageWidget) {
    return this.src === other.src;
  }

  get estimatedHeight() {
    return 100;
  }
}


export const ImageExtension = [
  imageField,
  EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet) {
      toggleImageVisibility(update.view);
    }
  })
];