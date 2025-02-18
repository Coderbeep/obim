import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { indentUnit } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Prec } from '@codemirror/state'
import { frontmatter } from '@extensions/FrontmatterExtension'
import { Table } from '@lezer/markdown'
import { DefaultExtensions } from '@renderer/extensions'
import { insertNewlineContinueMarkup } from '@renderer/extensions/commands'
import { customMarkdownConfig } from '@renderer/extensions/TableMarkdocExtension'
import CodeMirror, {
  EditorView,
  keymap,
} from '@uiw/react-codemirror'
import { useRef } from 'react'
import '../assets/Editor.scss'
import { MathBlockParser } from '../extensions/MathExpression'
import { useAtom, useSetAtom } from 'jotai'
import { noteTextAtom, currentFilePathAtom, editorNoteTextAtom } from '../store/NotesStore'


const initText = `---
title: Example document
author: Jakub Kubiak
date: 2024-01-01
tags: 
  - text
  - example
  - test
---

## Images
![](https://commonmark.org/help/images/favicon.png)

## Paragraphs
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor. Cras elementum ultrices diam. Maecenas ligula massa, varius a, semper congue, euismod non, mi.

## Emphasis
Two emphasis styles are available: 
- use single \`*\` around text to *italicize it* 
- use double \`**\` around text to **make it bold**

## Horizontal rule
For a space between sections, use a horizontal rule like the one below. 

---

The horizontal rule is created by placing three or more hyphens (\`---\`) on a line by themselves.

## Lists
### Unordered list
- This is the only line that is longer than it should be
    - This is another line which also is way longer
        - This line also overflows the space it is supposed to
        - This line also overflows the space it is supposed to
    - This is another line which also is way longer
- This is the only line that is longer than it should be

### Ordered list
1. This is the only line that is longer Than it should be
    1. This is the only line that is longer than it should be
    2. This is the only line that is longer than it should be
        1. This is the only line that is longer than it should be
        2. This is the only line that is longer than it should be
    3. This is the only line that is longer than it should be
2. This is the only line that is longer than it should be

### Mixed list
- This is the first item
    1. The second item is a part of ordered list. For proper alignment, each level of the list should have 4 spaces of indentation, when compared to the previous level
    2. The list items texts are indented so that each line starts at the same level as the other.
- Mixed lists

### Task lists
- [x] This is a complete item
- [ ] This is an incomplete item
    - [ ] This is an incomplete item
    - [x] This is a complete item
- [ ] This is an incomplete item

## Tables
The editor supports two markdown table specifications. The first one is defined by the GFM syntax and uses \`|\` as a separator. The second one is defined by the Markdoc syntax.  

| Header 1 | Header 2 | Header 3 |
| -------- | -------- | -------- |
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
| Cell 7   | Cell 8   | Cell 9   |

{% table %}
* Heading 1
* Heading 2
---
* Row 1 Cell 1
* Row 1 Cell 2
---
* Row 2 Cell 1
* Row 2 cell 2
{% /table %}
 
## Blockquotes (WIP)

> This is a blockquote with two paragraphs. Lorem ipsum dolor sit amet,
> consectetuer adipiscing elit. Aliquam hendrerit mi posuere lectus.

## Code blocks
To insert a code block, use triple backtick (\`\`\`) followed by the language name. Supported languages are defined by the Codemirror language data.

\`\`\`python
def hello_world():
    print("Hello, World!")

hello_world()
\`\`\`
`


const Editor = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useAtom(noteTextAtom)
  const [currentFilename, setCurrentFilename] = useAtom(currentFilePathAtom)
  const setEditorNoteText = useSetAtom(editorNoteTextAtom)

  const basicSetup = markdown({
    base: markdownLanguage,
    codeLanguages: languages,
    extensions: [MathBlockParser, frontmatter, Table, customMarkdownConfig],
  })

  return (
    <div ref={containerRef} className="h-screen flex">
      <div style={{ width: `${100}%`, height: `${120}%` }} className="cm-window">
        <CodeMirror
          autoFocus
          key={currentFilename}
          value={text}
          onChange={(value) => { setEditorNoteText(value) }}
          extensions={[
            basicSetup,
            EditorView.lineWrapping,
            DefaultExtensions,
            indentUnit.of('    '),
            Prec.highest(keymap.of([
              { key: 'Shift-Enter', run: insertNewlineContinueMarkup },
            ])),
          ]}
          className="editor-comp"
        />
      </div>
    </div>
  )
};

export default Editor
