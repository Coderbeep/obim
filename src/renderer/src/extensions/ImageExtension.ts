import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import contextMenuManager, { ContextMenuType } from '@renderer/components/ContextMenuManager';
import { notesDirectoryPath } from '@shared/constants';
import { doesPathExist } from '../../utils/db';

// TODO: Vertical scrolling does not work properly
// TODO: OnClick event for the image widget
// TODO: Proper url handling
// TODO: Image widgets styling
// TODO: Local image handling

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

function checkImageExists(src) {
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
          builder.add(node.from, node.to, Decoration.replace({
            block: true,
          }));
        }

        builder.add(node.to, node.to, Decoration.widget({
          widget: new ImageWidget(src),
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
  static cache = new Map();

  constructor(private readonly src: string) {
    super();
  }

  toDOM(view) {
    const container = document.createElement('div');
    container.className = 'cm-image-widget cm-image-error';
    container.innerHTML = `Image '${this.src}' not found`;

    checkImageExists(this.src).then((exists) => {
      if (exists) {
        container.innerHTML = '';
        container.className = 'cm-image-widget';
        const img = document.createElement('img');
        img.src = `media://${this.src}`;
        container.appendChild(img);
      }
    })

    // container.addEventListener('contextmenu', (event) => {
    //   event.preventDefault();
    //   // TODO: Implement menu logic here
    //   const { clientX: x, clientY: y } = event;
    //   contextMenuManager.showMenu(ContextMenuType.Image, { x, y });
    //   console.log('Right click on image widget');
    // });

    return container;
  }

  eq(other: ImageWidget) {
    return this.src === other.src;
  }

  destroy(dom) {
    dom.remove();
  }

  get estimatedHeight() {
    return 137;
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