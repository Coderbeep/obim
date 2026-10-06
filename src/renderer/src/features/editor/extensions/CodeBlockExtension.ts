import { Decoration, WidgetType } from "@renderer/features/editor/codemirror-view";
import type { Range } from "@renderer/features/editor/codemirror-state";
import type { EditorView } from "@renderer/features/editor/codemirror-view";
import type { SyntaxNodeRef } from "@lezer/common";
import icons from "@shared/assets/icons.json";
import {
  createSyntaxDecorationPlugin,
  decorationSet,
  directChildren,
  isSyntaxRangeActive,
  iterateVisibleSyntaxTree,
  lastLineInNode,
  pushDecorationRange,
  visibleLineSpans,
} from "./shared/syntaxDecorationPlugin";

type IconData = { viewBox: string; size: string; path: string };
type IconRegistry = { default: IconData; aliases: Record<string, string>; icons: Record<string, IconData> };

const iconRegistry = icons as IconRegistry;

const copyIconBackgroundPath =
  "M2.25 4H2.5V9.75C2.5 11.8211 4.17893 13.5 6.25 13.5H12V13.75C12 14.9926 10.9926 16 9.75 16H2.25C1.00736 16 0 14.9926 0 13.75V6.25C0 5.00736 1.00736 4 2.25 4Z";
const copyIconPath =
  "M16 9.75C16 10.9926 14.9926 12 13.75 12H6.25C5.00736 12 4 10.9926 4 9.75V2.25C4 1.00736 5.00736 0 6.25 0H13.75C14.9926 0 16 1.00736 16 2.25V9.75Z";
const copiedIconPath =
  "M13.75 0C14.9926 0 16 1.00736 16 2.25V9.75C16 10.9926 14.9926 12 13.75 12H6.25C5.00736 12 4 10.9926 4 9.75V2.25C4 1.00736 5.00736 0 6.25 0H13.75ZM14.2246 2.66992C13.904 2.40764 13.4322 2.45484 13.1699 2.77539L9.19434 7.63379L7.28027 5.71973C6.98739 5.42685 6.51261 5.42685 6.21973 5.71973C5.92684 6.01261 5.92685 6.48738 6.21973 6.78027L8.71973 9.28027C8.8695 9.43011 9.07557 9.50945 9.28711 9.49902C9.49874 9.48842 9.6959 9.38861 9.83008 9.22461L14.3301 3.72461C14.5924 3.40402 14.5452 2.93222 14.2246 2.66992Z";

function createCopyIcon(copied: boolean) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");

  for (const [pathData, opacity] of [
    [copyIconBackgroundPath, "0.4"],
    [copied ? copiedIconPath : copyIconPath, "1"],
  ]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", "currentColor");
    if (opacity !== "1") path.setAttribute("opacity", opacity);
    svg.appendChild(path);
  }

  return svg;
}

export function resolveCodeBlockIconData(language: string) {
  const key = language.trim().split(/\s+/, 1)[0].toLowerCase();
  const iconKey = iconRegistry.aliases[key] ?? key;
  return iconRegistry.icons[iconKey] ?? iconRegistry.default;
}

function activeClass(className: string, isActive: boolean) {
  return isActive ? `${className} active` : className;
}

const codeDecorations = {
  InlineCode: Decoration.mark({ class: "cm-formatting-inline-code" }),
  InlineCodeText: Decoration.mark({ class: "cm-formatting-inline-code-text" }),
  InlineCodeMark: Decoration.mark({ class: "cm-formatting-inline-code-mark" }),
  InlineCodeMarkHidden: Decoration.replace({}),
  FencedCodeBegin: (isActive: boolean) =>
    Decoration.line({
      class: activeClass("cm-formatting-codeblock-line-begin", isActive),
    }),
  FencedCodeEnd: (isActive: boolean) =>
    Decoration.line({
      class: activeClass("cm-formatting-codeblock-line-end", isActive),
    }),
  FencedCodeSingle: (isActive: boolean) =>
    Decoration.line({
      class: activeClass("cm-formatting-codeblock-line-single", isActive),
    }),
  CodeLine: Decoration.line({ class: "cm-formatting-codeblock-line" }),
  CodeLineBegin: Decoration.line({ class: "cm-formatting-codeblock-line-content-begin" }),
  CodeLineEnd: Decoration.line({ class: "cm-formatting-codeblock-line-unclosed-end" }),
  CodeLineSingle: Decoration.line({
    class: "cm-formatting-codeblock-line-content-begin cm-formatting-codeblock-line-unclosed-end",
  }),
};

function nodeText(view: EditorView, node: { from: number; to: number }) {
  return view.state.doc.sliceString(node.from, node.to);
}

function directChildText(view: EditorView, node: SyntaxNodeRef, name: string) {
  const child = directChildren(node, name)[0];
  return child ? nodeText(view, child).trim() : "";
}

function codeRanges(node: SyntaxNodeRef) {
  return directChildren(node, "CodeText").map(({ from, to }) => ({ from, to }));
}

function isInsideBlockquote(node: SyntaxNodeRef) {
  for (let parent = node.node.parent; parent; parent = parent.parent) {
    if (parent.name === "Blockquote") return true;
  }
  return false;
}

function addInlineCodeDecorations(view: EditorView, node: SyntaxNodeRef, decorations: Range<Decoration>[]) {
  const isActive = isSyntaxRangeActive(view.state, node.from, node.to);
  const marks = directChildren(node, "CodeMark");
  let from = node.from;

  pushDecorationRange(decorations, codeDecorations.InlineCode, node.from, node.to);
  for (const mark of marks) {
    pushDecorationRange(decorations, codeDecorations.InlineCodeText, from, mark.from);
    pushDecorationRange(
      decorations,
      isActive ? codeDecorations.InlineCodeMark : codeDecorations.InlineCodeMarkHidden,
      mark.from,
      mark.to,
    );
    from = mark.to;
  }

  pushDecorationRange(decorations, codeDecorations.InlineCodeText, from, node.to);
}

function addCodeLineNumber(
  decorations: Range<Decoration>[],
  line: { from: number; text: string },
  number: number,
  insideBlockquote: boolean,
) {
  decorations.push(
    Decoration.line({
      attributes: {
        "data-code-line-number": String(number),
        ...(insideBlockquote && /^\s*>/.test(line.text) ? { "data-code-line-number-quoted": "true" } : {}),
      },
    }).range(line.from),
  );
}

function addCodeLineDecorations(
  view: EditorView,
  node: SyntaxNodeRef,
  decorations: Range<Decoration>[],
  firstDecoration: Decoration,
) {
  const firstLine = view.state.doc.lineAt(node.from);
  const lastLine = lastLineInNode(view, node);
  const insideBlockquote = isInsideBlockquote(node);
  for (const visibleLines of visibleLineSpans(view, node)) {
    const startLine = Math.max(firstLine.number, visibleLines.first.number);
    const endLine = Math.min(lastLine.number, visibleLines.last.number);

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
      const line = view.state.doc.line(lineNumber);
      const decoration =
        firstLine.number === lastLine.number
          ? codeDecorations.CodeLineSingle
          : lineNumber === firstLine.number
            ? firstDecoration
            : lineNumber === lastLine.number
              ? codeDecorations.CodeLineEnd
              : codeDecorations.CodeLine;

      decorations.push(decoration.range(line.from));
      addCodeLineNumber(decorations, line, lineNumber - firstLine.number + 1, insideBlockquote);
    }
  }
}

function addFencedCodeDecorations(view: EditorView, node: SyntaxNodeRef, decorations: Range<Decoration>[]) {
  const isActive = isSyntaxRangeActive(view.state, node.from, node.to);
  const firstLine = view.state.doc.lineAt(node.from);
  const lastLine = lastLineInNode(view, node);
  const closingMark = directChildren(node, "CodeMark")[1];
  const closingLine = closingMark ? view.state.doc.lineAt(closingMark.from) : null;
  const visibleLines = visibleLineSpans(view, node);
  if (visibleLines.length === 0) return;
  const insideBlockquote = isInsideBlockquote(node);

  for (const visibleSpan of visibleLines) {
    const startLine = Math.max(firstLine.number, visibleSpan.first.number);
    const endLine = Math.min(lastLine.number, visibleSpan.last.number);

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
      const line = view.state.doc.line(lineNumber);
      const decoration =
        firstLine.number === lastLine.number
          ? codeDecorations.FencedCodeSingle(isActive)
          : lineNumber === firstLine.number
            ? codeDecorations.FencedCodeBegin(isActive)
            : closingLine?.number === lineNumber
              ? codeDecorations.FencedCodeEnd(isActive)
              : lineNumber === lastLine.number
                ? codeDecorations.CodeLineEnd
                : codeDecorations.CodeLine;

      decorations.push(decoration.range(line.from));
      const codeLineNumber = lineNumber - firstLine.number;
      if (codeLineNumber > 0 && lineNumber !== closingLine?.number) {
        addCodeLineNumber(decorations, line, codeLineNumber, insideBlockquote);
      }
    }
  }

  if (
    !isActive &&
    visibleLines.some(({ first, last }) => firstLine.number >= first.number && firstLine.number <= last.number)
  ) {
    decorations.push(
      Decoration.replace({
        widget: new CodeLanguageIndicatorWidget(directChildText(view, node, "CodeInfo"), codeRanges(node)),
      }).range(firstLine.from, firstLine.to),
    );
  }
}

export function buildCodeBlockDecorations(view: EditorView) {
  const decorations: Range<Decoration>[] = [];

  iterateVisibleSyntaxTree(view, (node) => {
    if (node.name === "InlineCode") {
      addInlineCodeDecorations(view, node, decorations);
      return false;
    }

    if (node.name === "FencedCode") {
      addFencedCodeDecorations(view, node, decorations);
      return false;
    }

    if (node.name === "CodeBlock") {
      addCodeLineDecorations(view, node, decorations, codeDecorations.CodeLineBegin);
      return false;
    }

    return undefined;
  });

  return decorationSet(decorations);
}

export const CodeBlockExtension = createSyntaxDecorationPlugin(buildCodeBlockDecorations);

class CodeLanguageIndicatorWidget extends WidgetType {
  constructor(
    private readonly language: string,
    private readonly ranges: Array<{ from: number; to: number }>,
  ) {
    super();
  }

  private iconData() {
    return resolveCodeBlockIconData(this.language);
  }

  private createSVGElement() {
    const iconData = this.iconData();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("stroke-width", "0");
    svg.setAttribute("viewBox", iconData.viewBox);
    svg.setAttribute("height", iconData.size);
    svg.setAttribute("width", iconData.size);
    svg.style.marginRight = "4px";

    path.setAttribute("d", iconData.path);
    svg.appendChild(path);
    return svg;
  }

  private setButtonIcon(button: HTMLButtonElement, copied: boolean) {
    button.replaceChildren(createCopyIcon(copied));
  }

  private codeText(view: EditorView) {
    return this.ranges.map(({ from, to }) => view.state.doc.sliceString(from, to)).join("");
  }

  private createCopyButton(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.style.border = "none";
    button.style.backgroundColor = "transparent";
    button.style.color = "var(--muted-foreground)";
    button.style.cursor = "pointer";
    button.style.fontSize = "var(--text-ui-control)";
    button.style.marginLeft = "4px";
    button.style.marginRight = "4px";
    button.style.padding = "2px";
    button.style.borderRadius = "var(--radius-sm)";
    button.style.outline = "none";
    this.setButtonIcon(button, false);

    button.onmouseover = () => {
      button.style.backgroundColor = "var(--surface-hover)";
    };

    button.onmouseout = () => {
      button.style.backgroundColor = "transparent";
    };

    button.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(this.codeText(view));
      } catch {
        return;
      }
      this.setButtonIcon(button, true);
      setTimeout(() => this.setButtonIcon(button, false), 3000);
    };

    return button;
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "cm-formatting-codeblock-language-container";
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.float = "right";
    container.style.paddingTop = "0";

    const span = document.createElement("span");
    span.textContent = this.language;
    span.style.fontSize = "var(--text-ui-control)";
    span.style.color = "var(--muted-foreground)";
    span.className = "cm-formatting-codeblock-language";
    span.style.marginRight = "8px";
    span.style.userSelect = "none";

    container.appendChild(this.createSVGElement());
    container.appendChild(span);
    container.appendChild(this.createCopyButton(view));

    return container;
  }

  eq(other: CodeLanguageIndicatorWidget) {
    return (
      this.language === other.language &&
      this.ranges.length === other.ranges.length &&
      this.ranges.every((range, index) => {
        const otherRange = other.ranges[index];
        return range.from === otherRange.from && range.to === otherRange.to;
      })
    );
  }
}
