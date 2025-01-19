import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import contextMenuManager, { ContextMenuType } from '@renderer/components/ContextMenuManager';

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

function createImageDecorations(view) {
    const builder = new RangeSetBuilder();
    const { from, to } = view.state.selection.main;

    syntaxTree(view.state).iterate({
        enter: (node) => { 
            if (node.name === 'Image') {
              const isActive = from >= node.from && to <= node.to;
              if (!isActive) {
                builder.add(node.from, node.to, Decoration.replace({
                  block: true,
                }));
              }

              builder.add(node.to, node.to, Decoration.widget({
                widget: new ImageWidget(),
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
  constructor() {
    super();
  }

  toDOM(view) {
    const container = document.createElement('div');
    container.className = 'cm-image-widget';

    const img = document.createElement('img');
    img.src = 'https://commonmark.org/help/images/favicon.png';

    container.appendChild(img);

    container.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      // TODO: Implement menu logic here
      const { clientX: x, clientY: y } = event;
      contextMenuManager.showMenu(ContextMenuType.Image, { x, y });
      console.log('Right click on image widget');
    });

    return container;
  }

  destroy(dom) {
    dom.remove();
  }

  get estimatedHeight() {
    return 144;
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