import { Extension } from "@renderer/features/editor/codemirror-state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const createCodeBlockTheme = ({ styles }): Extension => {
  const highlightStyle = HighlightStyle.define(styles);
  const extension = [syntaxHighlighting(highlightStyle)];
  return extension;
};

export const basicLight = createCodeBlockTheme({
  styles: [
    {
      tag: t.strong,
      class: "cm-obim-strong",
    },
    {
      tag: t.emphasis,
      class: "cm-obim-emphasis",
    },
    {
      tag: t.monospace,
      class: "cm-obim-inline-code",
    },
    {
      tag: t.link,
      class: "cm-obim-link",
    },
    {
      tag: t.processingInstruction,
      class: "cm-obim-formatting-mark",
    },
    {
      tag: t.heading,
      fontWeight: "bold",
    },
    {
      tag: t.comment,
      color: "var(--syntax-comment)",
    },
    {
      tag: [t.variableName, t.self, t.propertyName, t.attributeName, t.regexp],
      color: "var(--syntax-variable)",
    },
    {
      tag: [t.number, t.bool, t.null],
      color: "var(--syntax-number)",
    },
    {
      tag: [t.className, t.typeName, t.definition(t.typeName)],
      color: "var(--syntax-type)",
    },
    {
      tag: [t.string, t.special(t.brace)],
      color: "var(--syntax-string)",
    },
    {
      tag: t.operator,
      color: "var(--syntax-operator)",
    },
    {
      tag: [t.definition(t.propertyName), t.function(t.variableName)],
      color: "var(--syntax-function)",
    },
    {
      tag: t.keyword,
      color: "var(--syntax-keyword)",
    },
    {
      tag: t.derefOperator,
      color: "var(--syntax-punctuation)",
    },
    {
      tag: t.inserted,
    },
  ],
});
