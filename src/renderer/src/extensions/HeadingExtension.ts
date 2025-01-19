import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@uiw/react-codemirror';

// TODO: Click on the widget should insert the selection at the heading position
// TODO: bottom border for the widget container


const headingFormattingClasses = {
  HeadingWidget: 'cm-heading-widget',
  Heading1: 'formatting-heading1',
  Heading2: 'formatting-heading2',
  Heading3: 'formatting-heading3',
  Heading4: 'formatting-heading4',
  Heading5: 'formatting-heading5',
  Heading6: 'formatting-heading6',
}

const headingLevels = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
}

export const HeadingExtension = ViewPlugin.fromClass(class {
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
              const level = headingLevels[node.name]; // Results in undefined if node.name is not a heading
              if (level) {
                  const headingRange = { start: node.from, end: node.to };
                  const isActive = from >= headingRange.start && to <= headingRange.end;

                  if (!isActive) {
                      let headingText = view.state.sliceDoc(node.from, node.to);
                      if (node.to - node.from > 2) {
                          headingText = view.state.sliceDoc(node.from + level + 1, node.to);
                      }
                      
                      builder.add(node.from, node.to, Decoration.widget({
                          widget: new HeadingWidget(headingText, level,() => this.activateHeading(view, headingRange.start)),
                          side: 1,
                          replace: true,
                      }));
                  }
              }
          }
      });

      return builder.finish();
  }

  activateHeading(view, position) {
      view.dispatch({
          selection: { anchor: position }
      });
      view.focus();
  }

  get decorationss() {
      return this.decorations;
  }
}, {
  decorations: v => v.decorations
});


class HeadingWidget extends WidgetType {
  headingText;
  onClick;
  level: number ;

  constructor(headingText, level, onClick) {
      super();
      this.headingText = headingText;
      this.onClick = onClick;
      this.level = level;
  }

  toDOM() {
      const container = document.createElement('div');
      container.className = headingFormattingClasses.HeadingWidget;

      container.innerHTML = `<span class="${headingFormattingClasses[`Heading${this.level}`]}">${this.headingText}</span>`;
      container.style.cursor = 'text';

      container.addEventListener('click', this.onClick);

      return container;
  }

  destroy(dom: HTMLElement): void {
      dom.removeEventListener('click', this.onClick);
  }
}