
import { indentUnit, syntaxTree } from '@codemirror/language'
import { countColumn, Text } from '@codemirror/state'
import { SyntaxNode } from '@lezer/common'
import '../assets/Editor.scss'

import {
  ChangeSpec,
  EditorSelection,
  EditorState,
  StateCommand
} from '@codemirror/state'

class Context {
    constructor(
      readonly node: SyntaxNode,
      readonly from: number,
      readonly to: number,
      readonly spaceBefore: string,
      readonly spaceAfter: string,
      readonly type: string,
      readonly item: SyntaxNode | null
    ) { }
  
    blank(maxWidth: number | null, trailing = true) {
      let result = this.spaceBefore + (this.node.name == 'Blockquote' ? '>' : '')
      if (maxWidth != null) {
        while (result.length < maxWidth) result += ' '
        return result
      } else {
        for (let i = this.to - this.from - result.length - this.spaceAfter.length; i > 0; i--)
          result += ' '
        return result + (trailing ? this.spaceAfter : '')
      }
    }
  
    marker(doc: Text, add: number) {
      let number =
        this.node.name == 'OrderedList' ? String(+itemNumber(this.item!, doc)[2] + add) : ''
      return this.spaceBefore + number + this.type + this.spaceAfter
    }
  }
  
  function getContext(node: SyntaxNode, doc: Text) {
    let nodes = []
    for (let cur: SyntaxNode | null = node; cur && cur.name != 'Document'; cur = cur.parent) {
      if (cur.name == 'ListItem' || cur.name == 'Blockquote' || cur.name == 'FencedCode')
        nodes.push(cur)
    }
    let context = []
    for (let i = nodes.length - 1; i >= 0; i--) {
      let node = nodes[i],
        match
      let line = doc.lineAt(node.from),
        startPos = node.from - line.from
      if (node.name == 'FencedCode') {
        context.push(new Context(node, startPos, startPos, '', '', '', null))
      } else if (node.name == 'Blockquote' && (match = /^ *>( ?)/.exec(line.text.slice(startPos)))) {
        context.push(new Context(node, startPos, startPos + match[0].length, '', match[1], '>', null))
      } else if (
        node.name == 'ListItem' &&
        node.parent!.name == 'OrderedList' &&
        (match = /^( *)\d+([.)])( *)/.exec(line.text.slice(startPos)))
      ) {
        let after = match[3],
          len = match[0].length
        if (after.length >= 4) {
          after = after.slice(0, after.length - 4)
          len -= 4
        }
        context.push(
          new Context(node.parent!, startPos, startPos + len, match[1], after, match[2], node)
        )
      } else if (
        node.name == 'ListItem' &&
        node.parent!.name == 'BulletList' &&
        (match = /^( *)([-+*])( {1,4}\[[ xX]\])?( +)/.exec(line.text.slice(startPos)))
      ) {
        let after = match[4],
          len = match[0].length
        if (after.length > 4) {
          after = after.slice(0, after.length - 4)
          len -= 4
        }
        let type = match[2]
        if (match[3]) type += match[3].replace(/[xX]/, ' ')
        context.push(new Context(node.parent!, startPos, startPos + len, match[1], after, type, node))
      }
    }
    return context
  }
  
  function itemNumber(item: SyntaxNode, doc: Text) {
    return /^(\s*)(\d+)(?=[.)])/.exec(doc.sliceString(item.from, item.from + 10))!
  }
  
  function renumberList(after: SyntaxNode, doc: Text, changes: ChangeSpec[], offset = 0) {
    for (let prev = -1, node = after; ;) {
      if (node.name == 'ListItem') {
        let m = itemNumber(node, doc)
        let number = +m[2]
        if (prev >= 0) {
          if (number != prev + 1) return
          changes.push({
            from: node.from + m[1].length,
            to: node.from + m[0].length,
            insert: String(prev + 2 + offset)
          })
        }
        prev = number
      }
      let next = node.nextSibling
      if (!next) break
      node = next
    }
  }
  
  function normalizeIndent(content: string, state: EditorState) {
    let blank = /^[ \t]*/.exec(content)![0].length
    if (!blank || state.facet(indentUnit) != '\t') return content
    let col = countColumn(content, 4, blank)
    let space = ''
    for (let i = col; i > 0;) {
      if (i >= 4) {
        space += '\t'
        i -= 4
      } else {
        space += ' '
        i--
      }
    }
    return space + content.slice(blank)
  }
  
  /// This command, when invoked in Markdown context with cursor
  /// selection(s), will create a new line with the markup for
  /// blockquotes and lists that were active on the old line. If the
  /// cursor was directly after the end of the markup for the old line,
  /// trailing whitespace and list markers are removed from that line.
  ///
  /// The command does nothing in non-Markdown context, so it should
  /// not be used as the only binding for Enter (even in a Markdown
  /// document, HTML and code regions might use a different language).
export const insertNewlineContinueMarkup: StateCommand = ({ state, dispatch }) => {
    let tree = syntaxTree(state),
      { doc } = state
    let dont = null,
      changes = state.changeByRange((range) => {
        if (!range.empty) return (dont = { range })
        let pos = range.from,
          line = doc.lineAt(pos)
  
        // Calculate the indentation of the current line
        let currentIndent = /^[ \t]*/.exec(line.text)![0]
  
        // Create a new line with the same indentation
        let insert = state.lineBreak + currentIndent
  
        // Insert the new line at the current cursor position without modifying the current line
        let changes: ChangeSpec[] = [{ from: pos, insert }]
        return { range: EditorSelection.cursor(pos + insert.length), changes }
      })
    if (dont) return false
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }