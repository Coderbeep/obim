import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { LanguageDescription } from "@codemirror/language";
import { Table, TaskList } from "@lezer/markdown";

import { frontmatter } from "./extensions/FrontmatterExtension";
import { MathBlockParser } from "./extensions/MathExpression";

export const obimMarkdownExtensions = [MathBlockParser, frontmatter, Table, TaskList];

type MarkdownConfig = NonNullable<Parameters<typeof markdown>[0]>;

export function resolveMarkdownCodeLanguage(codeLanguages: readonly LanguageDescription[], info: string) {
  const language = info.toLowerCase();
  return (
    LanguageDescription.matchLanguageName(codeLanguages, language, true) ??
    LanguageDescription.matchFilename(codeLanguages, `file.${language}`)
  );
}

export const obimMarkdown = (codeLanguages?: MarkdownConfig["codeLanguages"]) =>
  markdown({
    base: markdownLanguage,
    completeHTMLTags: false,
    codeLanguages: Array.isArray(codeLanguages)
      ? (info) => resolveMarkdownCodeLanguage(codeLanguages, info)
      : codeLanguages,
    extensions: obimMarkdownExtensions,
  });

export const obimMarkdownParser = obimMarkdown().language.parser;
