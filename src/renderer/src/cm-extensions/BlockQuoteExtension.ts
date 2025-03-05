import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { Range } from '@codemirror/state';
import * as emojiToolkit from 'emoji-toolkit';

const tokenFormattingClasses = {
  'Blockquote': (isActive: boolean) => { return isActive ? 
    Decoration.mark({ class: 'cm-formatting-blockquote cm-active' }) : 
    Decoration.mark({ class: 'cm-formatting-blockquote' })},
  'QuoteMark': Decoration.mark({ class: 'cm-formatting-quote-mark' }),
}

const tokenElements = [
  'Blockquote',
  'QuoteMark',
]

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
      let widgets: Range<Decoration>[] = []
      const { from, to } = view.state.selection.main;

      syntaxTree(view.state).iterate({
          enter: (node) => {
            if (tokenElements.includes(node.name)) {
              const isActive = from <= node.to && to >= node.from;
              if (node.name === 'Blockquote') {
                widgets.push(tokenFormattingClasses[node.name](isActive).range(node.from, node.to))
              } else {
                widgets.push(tokenFormattingClasses[node.name].range(node.from, node.to))
              }
            }
          }
      });

      return Decoration.set(widgets);
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
