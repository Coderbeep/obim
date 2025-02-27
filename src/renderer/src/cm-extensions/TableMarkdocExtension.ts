import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { Tag } from '@lezer/highlight'
import markdoc from '@markdoc/markdoc'


// TODO: input handling into specific rows
// TODO: non block inputs
// TODO: focus on click

const customTags = {
  customBlock: Tag.define()
}

const customBlock = 'CustomBlock'
const customBlockMark = 'CustomBlockMark'

export const customNodes = {
  customBlock,
  customBlockMark
}
const findCustomBlockEnd = (cx, line) => {
  const endMarker = '{% /table %}'
  const sameLineIndex = line.text.indexOf(endMarker)

  if (sameLineIndex !== -1) {
    return cx.lineStart + line.pos + sameLineIndex + endMarker.length
  }

  let hasNextLine
  let index
  do {
    hasNextLine = cx.nextLine()
    index = line.text.indexOf(endMarker)
  } while (hasNextLine && index === -1)

  if (!hasNextLine) {
    return -1
  }

  return cx.lineStart + line.pos + index + endMarker.length
}

export const customMarkdownConfig = {
  defineNodes: [{ name: customBlock, block: true }, customBlockMark],
  parseBlock: [
    {
      name: customBlock,
      parse(cx, line) {
        const startMarker = '{% table %}'
        if (!line.text.trim().startsWith(startMarker)) {
          return false
        }

        const from = cx.lineStart + line.pos
        cx.addElement(cx.elt(customBlockMark, from, from + startMarker.length))

        const to = findCustomBlockEnd(cx, line)
        if (to === -1) {
          return false
        }

        cx.addElement(cx.elt(customBlockMark, to - '{% /table %}'.length, to))
        cx.addElement(cx.elt(customBlock, from, to))
        cx.nextLine()
        return true
      }
    }
  ]
}

const toggleMarkdocTableEffect = StateEffect.define()

const markdocTableField = StateField.define({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    if (transaction.docChanged) {
			return Decoration.none;
		}

    for (let effect of transaction.effects) {
      if (effect.is(toggleMarkdocTableEffect)) {
        decorations = effect.value
      }
    }
    return decorations
  },
  provide: field => EditorView.decorations.from(field)
})

function createTableDecorations(view) {
  const builder = new RangeSetBuilder()
  const { from, to } = view.state.selection.main

  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name === 'CustomBlock') {
        const isActive = from >= node.from && to <= node.to
        if (!isActive) {
          builder.add(
            node.from,
            node.to,
            Decoration.widget({
              widget: new TableWidget(view.state.sliceDoc(node.from, node.to)),
              block: true,
              side: 1
            })
          )
        }
      }
    }
  })
  return builder.finish()
}

function toggleTableVisibility(view) {
  view.dispatch({
    effects: toggleMarkdocTableEffect.of(createTableDecorations(view))
  })
}

class TableWidget extends WidgetType {
  constructor(public source: string) {
    super()
    this.source = source
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'cm-table-markdoc'

    const doc = markdoc.parse(this.source)
    const transformed = markdoc.transform(doc)
    const rendered = markdoc.renderers.html(transformed)

    container.innerHTML = rendered

    return container
  }
}

export const MarkdocTableExtension = [
  markdocTableField,
  EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet) {
      toggleTableVisibility(update.view)
    }
  })
]