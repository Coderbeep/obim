import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { SyntaxNodeRef } from '@lezer/common';
import { RangeSetBuilder } from '@uiw/react-codemirror';
import icons from "@shared/assets/icons.json"
import { createElement, Clipboard, ClipboardCheck } from 'lucide'
import { size } from 'lodash';

const tokenFormattingClasses = {
  InlineCodeText: Decoration.mark({ class: 'cm-formatting-inline-code-text' }),
  FencedCode: Decoration.line({ class: 'cm-formatting-codeblock-line' }),
  FencedCodeBegin: (isActive: boolean) => {
    return Decoration.line({ class: `cm-formatting-codeblock-line-begin ${isActive ? 'active' : ''}` })
  },
  FencedCodeEnd: (isActive: boolean) => {
    return Decoration.line({ class: `cm-formatting-codeblock-line-end ${isActive ? 'active' : ''}` })
  },
  MarkHidden: Decoration.mark({ class: 'cm-mark-hidden' })
}

const tokenElements = {
  InlineCode: 'InlineCode',
  FencedCode: 'FencedCode',
  CodeMark: 'CodeMark'
}

/**
 * Get the start positions of each line in a block syntax node (FencedCode)
 * @param {SyntaxNodeRef} node The block node 
 * @param {EditorView} view The EditorView
 * @returns {Array<number>} An array of line start positions
*/
const _getLineStartPositions = (node: SyntaxNodeRef, view: EditorView): number[] => {
  let lineStarts: number[] = []
  let docStateLines = view.state.doc.slice(node.from, node.to).iterLines()
  let starts = node.from

  for (let line of docStateLines) {
    starts += line.length + 1
    lineStarts.push(starts)
  }
  lineStarts.pop()
  return lineStarts
}

export const CodeBlockExtension = ViewPlugin.fromClass(class {
  decorations;

  constructor(view) {
    this.decorations = this.computeDecorations(view);
  }

  update(update) {
    if (update.docChanged || update.selectionSet) {
      this.decorations = this.computeDecorations(update.view);
    }
  }

  computeDecorations(view: EditorView) {
    const builder = new RangeSetBuilder();
    const { from, to } = view.state.selection.main;


    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name === tokenElements.InlineCode || node.matchContext([tokenElements.InlineCode])) {
          if (node.name === tokenElements.CodeMark) {
            builder.add(node.from, node.to, tokenFormattingClasses.MarkHidden)
          }

          if (node.name === tokenElements.InlineCode) {
            builder.add(node.from, node.to, tokenFormattingClasses.InlineCodeText)
            if (from <= node.to && to >= node.from)
              return false
          }
        }

        if (node.name === 'FencedCode') {
          const isActive = from <= node.to && to >= node.from;
          const lineStarts = _getLineStartPositions(node, view)

          builder.add(node.from, node.from, tokenFormattingClasses.FencedCodeBegin(isActive))

          if (!isActive) {
            const language = view.state.sliceDoc(node.from, lineStarts[0] - 1).slice(3).trim()
            builder.add(node.from, lineStarts[0] - 1, Decoration.widget({
              widget: new CodeLanguageIndicatorWidget(language,
                view.state.sliceDoc(lineStarts[0], lineStarts[lineStarts.length - 1])
              ),
            }))
          }

          for (let i = 0; i < lineStarts.length - 1; i++) {
            builder.add(lineStarts[i], lineStarts[i], tokenFormattingClasses.FencedCode)
          }
          builder.add(lineStarts[lineStarts.length - 1], lineStarts[lineStarts.length - 1],
            tokenFormattingClasses.FencedCodeEnd(isActive))
        }
      }
    });

    return builder.finish();
  }

}, {
  decorations: v => v.decorations
});

class CodeLanguageIndicatorWidget extends WidgetType {
  constructor(private language: string, private code: string) {
    super();
  }

  private _createSVGElement = () => {
    const iconData = icons[this.language] || icons['default'];

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('fill', 'gray');
    svg.setAttribute('stroke-width', '0');
    svg.setAttribute('viewBox', iconData.viewBox);
    svg.setAttribute('height', iconData.size);
    svg.setAttribute('width', iconData.size);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', iconData.path);
    svg.appendChild(path);
    svg.style.marginRight = '4px';
    return svg;
  }

  private _createCopyButton = () => {
    const button = document.createElement('button');
    const icon = createElement(Clipboard, { color: 'currentColor', width: 16, height: 16 });
    button.appendChild(icon)

    button.style.border = 'none';
    button.style.backgroundColor = 'transparent';
    button.style.color = 'gray';
    button.style.cursor = 'pointer';
    button.style.fontSize = '12px';
    button.style.marginLeft = '4px';
    button.style.marginRight = '4px';
    button.style.padding = '2px';
    button.style.borderRadius = '4px';
    button.style.outline = 'none';

    button.onmouseover = () => {
      button.style.backgroundColor = colors.gray[200]
    }

    button.onmouseout = () => {
      button.style.backgroundColor = 'transparent'
    }

    button.onclick = () => {
      navigator.clipboard.writeText(this.code).then(() => {
        const icon = createElement(ClipboardCheck, { color: 'currentColor', width: 16, height: 16 });
        button.innerHTML = '';
        button.appendChild(icon);
      });

      setTimeout(() => {
        const icon = createElement(Clipboard, { color: 'currentColor', width: 16, height: 16 });
        button.innerHTML = '';
        button.appendChild(icon);
      }, 3000)
    }

    return button;
  }

  toDOM() {
    const container = document.createElement('div');
    container.className = 'cm-formatting-codeblock-language-container';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.float = 'right';
    container.style.paddingTop = '4px';

    const span = document.createElement('span');
    span.textContent = this.language;
    span.style.fontSize = '12px';
    span.style.color = 'gray'
    span.className = 'cm-formatting-codeblock-language';
    span.style.marginRight = '8px';
    span.style.userSelect = 'none';


    const svg = this._createSVGElement();
    const button = this._createCopyButton();

    container.appendChild(svg);
    container.appendChild(span);
    container.appendChild(button);


    return container;
  }

  eq(other: CodeLanguageIndicatorWidget) {
    return this.code === other.code;
  }
}
