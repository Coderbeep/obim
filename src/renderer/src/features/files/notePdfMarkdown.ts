import katex from "katex";
import MarkdownIt from "markdown-it";

import { imageSourceUrl } from "./imageSource";
import { locateFrontmatter } from "@shared/frontmatter";

const renderMath = (source: string, displayMode: boolean) =>
  katex.renderToString(source, {
    displayMode,
    output: "htmlAndMathml",
    strict: "ignore",
    throwOnError: false,
  });

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

markdown.inline.ruler.before("escape", "note_pdf_math_inline", (state, silent) => {
  const start = state.pos;
  if (state.src[start] !== "$" || state.src[start + 1] === "$" || state.src[start - 1] === "\\") return false;

  let end = start + 1;
  while (end < state.posMax) {
    if (state.src[end] === "\n") return false;
    if (state.src[end] === "$" && state.src[end - 1] !== "\\") break;
    end += 1;
  }
  if (end >= state.posMax || end === start + 1) return false;

  const content = state.src.slice(start + 1, end);
  if (/^\s|\s$/u.test(content)) return false;
  if (!silent) {
    const token = state.push("note_pdf_math_inline", "math", 0);
    token.content = content;
  }
  state.pos = end + 1;
  return true;
});

markdown.inline.ruler.before("escape", "note_pdf_math_parentheses", (state, silent) => {
  const start = state.pos;
  if (state.src.slice(start, start + 2) !== "\\(") return false;
  const end = state.src.indexOf("\\)", start + 2);
  if (end < 0 || end === start + 2) return false;

  if (!silent) {
    const token = state.push("note_pdf_math_inline", "math", 0);
    token.content = state.src.slice(start + 2, end);
  }
  state.pos = end + 2;
  return true;
});

markdown.block.ruler.before(
  "fence",
  "note_pdf_math_block",
  (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const firstLine = state.src.slice(start, state.eMarks[startLine]).trim();
    if (!firstLine.startsWith("$$")) return false;

    let content = firstLine.slice(2);
    let nextLine = startLine;
    let closed = content.endsWith("$$") && content.length > 2;
    if (closed) content = content.slice(0, -2);

    while (!closed && ++nextLine < endLine) {
      const line = state.src.slice(state.bMarks[nextLine] + state.tShift[nextLine], state.eMarks[nextLine]);
      if (line.trimEnd().endsWith("$$")) {
        content += `${content ? "\n" : ""}${line.trimEnd().slice(0, -2)}`;
        closed = true;
      } else {
        content += `${content ? "\n" : ""}${line}`;
      }
    }
    if (!closed) return false;
    if (silent) return true;

    const token = state.push("note_pdf_math_block", "math", 0);
    token.block = true;
    token.content = content.trim();
    token.map = [startLine, nextLine + 1];
    state.line = nextLine + 1;
    return true;
  },
  { alt: ["paragraph", "reference", "blockquote", "list"] },
);

markdown.renderer.rules.note_pdf_math_inline = (tokens, index) =>
  `<span class="note-pdf-math-inline">${renderMath(tokens[index].content, false)}</span>`;
markdown.renderer.rules.note_pdf_math_block = (tokens, index) =>
  `<div class="note-pdf-math-block">${renderMath(tokens[index].content, true)}</div>`;

const defaultImageRenderer =
  markdown.renderer.rules.image ??
  ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options));
markdown.renderer.rules.image = (tokens, index, options, environment, renderer) => {
  const sourceIndex = tokens[index].attrIndex("src");
  const source = sourceIndex >= 0 ? tokens[index].attrs?.[sourceIndex]?.[1] : null;
  if (source) tokens[index].attrSet("src", imageSourceUrl(source));
  return defaultImageRenderer(tokens, index, options, environment, renderer);
};

const decorateTaskLists = (html: string) =>
  html.replace(/<li>\[([ xX])\]\s*/gu, (_match, value: string) => {
    const checked = value.toLocaleLowerCase() === "x";
    return `<li class="note-pdf-task"><span class="note-pdf-checkbox${checked ? " is-checked" : ""}" aria-hidden="true">${checked ? "✓" : ""}</span>`;
  });

const decorateCallouts = (html: string) =>
  html.replace(
    /<blockquote>\s*<p>\[!(info|note|tip|warning|danger|important)\]\s*/giu,
    (_match, kind: string) =>
      `<blockquote class="note-pdf-callout note-pdf-callout-${kind.toLocaleLowerCase()}"><p><strong class="note-pdf-callout-label">${kind}</strong>`,
  );

export const notePdfBodySource = (source: string) => {
  const frontmatter = locateFrontmatter(source);
  return frontmatter ? source.slice(frontmatter.range.to).replace(/^\s+/u, "") : source;
};

export const renderNotePdfMarkdown = (source: string) =>
  decorateCallouts(decorateTaskLists(markdown.render(notePdfBodySource(source))));
