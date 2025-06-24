import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Prec } from "@codemirror/state";
import { frontmatter } from "../cm-extensions/FrontmatterExtension";
import { Table } from "@lezer/markdown";
import { DefaultExtensions } from "../cm-extensions";
import { insertNewlineContinueMarkup } from "../cm-extensions/commands";
import { customMarkdownConfig } from "../cm-extensions/TableMarkdocExtension";
import CodeMirror, { EditorView, keymap } from "@uiw/react-codemirror";
import { memo, useCallback } from "react";
import "../assets/Editor.scss";
import { MathBlockParser } from "../cm-extensions/MathExpression";
import { useAtom, useSetAtom } from "jotai";
import {
  noteTextAtom,
  currentFilePathAtom,
  editorNoteTextAtom,
} from "../store/NotesStore";
import { useObimEditor } from "@renderer/hooks/useObimEditor";
import { basicLight } from "@renderer/assets/basic-light";

const ObimEditor = memo(() => {
  const [text] = useAtom(noteTextAtom);
  const [currentFilename] = useAtom(currentFilePathAtom);
  const setEditorNoteText = useSetAtom(editorNoteTextAtom);
  const { handleAutoSave } = useObimEditor();

  const basicSetup = markdown({
    base: markdownLanguage,
    codeLanguages: languages,
    extensions: [MathBlockParser, frontmatter, Table, customMarkdownConfig],
  });

  const handleChange = useCallback(
    (value: string) => {
      setEditorNoteText(value);
      handleAutoSave(value);
    },
    [setEditorNoteText],
  );

  return (
    <div className="h-screen flex">
      <div
        style={{ width: `${100}%`, height: `${120}%` }}
        className="cm-window"
      >
        <CodeMirror
          autoFocus
          key={currentFilename}
          value={text}
          onChange={handleChange}
          extensions={[
            basicSetup,
            basicLight,
            EditorView.lineWrapping,
            DefaultExtensions,
            indentUnit.of("    "),
            Prec.highest(
              keymap.of([
                { key: "Shift-Enter", run: insertNewlineContinueMarkup },
              ]),
            ),
          ]}
          className="editor-comp"
        />
      </div>
    </div>
  );
});

export default ObimEditor;
