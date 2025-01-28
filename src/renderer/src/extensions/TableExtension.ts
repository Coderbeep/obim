import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import markdoc from '@markdoc/markdoc';

const toggleTableEffect = StateEffect.define();

const tableField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    if (transaction.docChanged) {
      return Decoration.none;
    }

    for (let effect of transaction.effects) {
      if (effect.is(toggleTableEffect)) {
        decorations = effect.value;
      }
    }
    return decorations;
  },
  provide: field => EditorView.decorations.from(field)
})


function createTableDecorations(view) {
  const builder = new RangeSetBuilder();
  const { from, to } = view.state.selection.main;

  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        const isActive = from >= node.from && to <= node.to;
        if (!isActive) {
          builder.add(node.from, node.to, Decoration.replace({
            widget: new TableWidget(view.state.sliceDoc(node.from, node.to)),
            block: true,
            side: 1
          }))
        }
      }
    }
  });
  return builder.finish();
}

function toggleTableVisibility(view) {
  view.dispatch({
    effects: toggleTableEffect.of(createTableDecorations(view))
  });
}


export class TableWidget extends WidgetType {
  private container: HTMLElement | null = null;

  constructor(public source: string) {
    super();
    this.source = source;
  }

  toDOM(view: EditorView) {
    this.container = document.createElement('div');
    this.container.className = 'cm-table-widget';

    const doc = markdoc.parse(this.source);
    const transformed = markdoc.transform(doc);
    const rendered = markdoc.renderers.html(transformed);

    this.container.innerHTML = rendered;

    view.requestMeasure()
    return this.container;
  }

  get estimatedHeight() {
    return 0;
  }

  eq(other: TableWidget) {
    return this.source === other.source;
  }
}

export const TableExtension = [
  tableField,
  EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet) {
      toggleTableVisibility(update.view);
    }
  })
]