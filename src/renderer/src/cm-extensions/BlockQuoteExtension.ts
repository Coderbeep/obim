import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@uiw/react-codemirror';
import * as emojiToolkit from 'emoji-toolkit';

// TODO: Click on the widget should insert the selection at the heading position



export const BlockQuoteExtension = ViewPlugin.fromClass(class {
  decorations;

  constructor(view) {
      this.decorations = this.computeDecorations(view);
  }

  update(update) {
      if (update.docChanged || update.selectionSet) {
          this.decorations = this.computeDecorations(update.view);
      }
  }

  computeDecorations(view) {
      const builder = new RangeSetBuilder();
      const { from, to } = view.state.selection.main;

      syntaxTree(view.state).iterate({
          enter: (node) => {
            if (node.name === 'QuoteMark') {    
              builder.add(
                node.from,
                node.to, 
                Decoration.mark({ class: 'cm-formatting-blockquote' })
              )
            }

            if (node.name === 'TaskMarker') {
              const isActive = from >= node.from && to <= node.to;

              if (!isActive) {
                let isChecked: boolean = view.state.sliceDoc(node.from, node.to).includes('x')

                builder.add(
                  node.from,
                  node.to, 
                  Decoration.widget({
                    widget: new TaskMarkerWidget(isChecked, { from: node.from, to: node.to }),
                    side: 1,
                  })
                )
              }
            }

            if (node.name === 'Emoji') {
              builder.add(
                node.from,
                node.to, 
                Decoration.replace({ widget: new EmojiWidget(view.state.sliceDoc(node.from, node.to)) })
              )
            }
          }
      });

      return builder.finish();
  }



  get decorationss() {
      return this.decorations;
  }
}, {
  decorations: v => v.decorations
});


class EmojiWidget extends WidgetType {
  emoji: string;

  constructor(emoji: string) {
    super();
    this.emoji = emojiToolkit.shortnameToUnicode(emoji);  
  }

  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.textContent = this.emoji;
    span.classList.add('cm-formatting-emoji');
    return span;
  }
}

class TaskMarkerWidget extends WidgetType {
  isChecked: boolean;
  position: { from: number, to: number };

  constructor(isChecked: boolean, position: { from: number, to: number }) { 
    super();
    this.isChecked = isChecked;
    this.position = position;
  }

  toDOM(view: EditorView) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.isChecked;
    input.classList.add('cm-formatting-input');

    // event listener to update the state
    input.addEventListener('change', (e) => {
      this.toggle(view);
    })

    return input;
  }

  toggle(view: EditorView) {
    const { from, to } = this.position;

    const newContent = view.state.sliceDoc(from, to) === '[ ]' ? '[x]' : '[ ]';

    view.dispatch({
      changes: { from, to, insert: newContent },
    });
    view.focus();
  }

}
