import { rangeContains, rangesIntersect, type DocumentRange } from "./documentRange";
import { parser } from "@lezer/markdown";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@renderer/features/editor/codemirror-state";
import { isSupportedImagePath } from "@shared/mime-types";

export type TextSelection = DocumentRange;

export interface MarkdownImageInfo {
  from: number;
  to: number;
  altFrom: number;
  altTo: number;
  alt: string;
  urlFrom: number;
  urlTo: number;
  src: string;
  srcFrom: number;
  srcTo: number;
  titleFrom?: number;
  titleTo?: number;
  prefixColumns: number;
  quoteDepth: number;
  isActive: boolean;
  isCaretInside: boolean;
}

export interface WikiImageInfo {
  from: number;
  to: number;
  src: string;
  srcFrom: number;
  srcTo: number;
  modifierFrom: number | null;
  modifierTo: number | null;
  alt: string;
  prefixColumns: number;
  quoteDepth: number;
  closed: boolean;
  renderable: boolean;
  isActive: boolean;
  isCaretInside: boolean;
}

export interface WikiLinkInfo {
  from: number;
  to: number;
  dest: string;
  destFrom: number;
  destTo: number;
  alias: string | null;
  aliasFrom: number | null;
  aliasTo: number | null;
  closed: boolean;
  isActive: boolean;
  isCaretInside: boolean;
}

export interface MarkdownLinkInfo {
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
  text: string;
  dest: string;
  urlFrom: number;
  urlTo: number;
  destFrom: number;
  destTo: number;
  titleFrom?: number;
  titleTo?: number;
  isActive: boolean;
  isCaretInside: boolean;
}

export interface MarkdownDestinationInfo {
  kind: "image" | "link";
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
  label: string;
  urlFrom: number;
  urlTo: number;
  destination: string;
  destinationFrom: number;
  destinationTo: number;
  titleFrom?: number;
  titleTo?: number;
  prefixColumns: number;
  quoteDepth: number;
  isActive: boolean;
  isCaretInside: boolean;
}

function escapedAt(text: string, position: number) {
  let slashes = 0;
  for (let index = position - 1; index >= 0 && text[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function containsUnescapedBracket(text: string, from: number, to: number) {
  for (let index = from; index < to; index += 1) {
    if ((text[index] === "[" || text[index] === "]") && !escapedAt(text, index)) return true;
  }
  return false;
}

function findClosingBracket(text: string, from: number) {
  let depth = 0;

  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      if (!depth) return index;
      depth -= 1;
    }
  }

  return -1;
}

function findClosingParen(text: string, from: number) {
  let depth = 0;
  let quote: string | null = null;
  let angled = false;

  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
    } else if (quote) {
      if (char === quote) quote = null;
    } else if (angled) {
      if (char === ">") angled = false;
    } else if (char === "<" && (index === from || /\s/.test(text[index - 1]))) {
      angled = true;
    } else if ((char === '"' || char === "'") && index > from && /\s/.test(text[index - 1])) {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      if (!depth) return index;
      depth -= 1;
    }
  }

  return -1;
}

function targetStart(text: string, from: number, to: number) {
  while (from < to && /\s/.test(text[from])) from += 1;
  return from;
}

export function normalizeMarkdownTarget(rawTarget: string) {
  const trimmed = rawTarget.trim();
  const angled = trimmed.startsWith("<") && trimmed.endsWith(">");
  return (angled ? trimmed.slice(1, -1) : trimmed)
    .replace(/[ \t]*\r?\n[ \t]*(?:>[ \t]*)*/g, " ")
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
}

function firstUnescapedPipe(text: string) {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "|" && !escapedAt(text, index)) return index;
  }
  return -1;
}

function normalizeWikiTarget(rawTarget: string) {
  return rawTarget.trim().replace(/\\\|/g, "|").replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Parses Obsidian/Writer note links while leaving wiki image embeds to the image parser. */
export function wikiLinksInText(text: string, textFrom: number, selection: TextSelection | null): WikiLinkInfo[] {
  const links: WikiLinkInfo[] = [];

  for (let open = text.indexOf("[["); open !== -1; open = text.indexOf("[[", open + 1)) {
    if (escapedAt(text, open)) continue;
    if (open > 0 && text[open - 1] === "!" && !escapedAt(text, open - 1)) continue;

    const lineEnd = text.indexOf("\n", open + 2);
    const contentEnd = lineEnd === -1 ? text.length : lineEnd;
    const closingMarker = text.indexOf("]]", open + 2);
    const closed = closingMarker !== -1 && closingMarker <= contentEnd;
    const close = closed ? closingMarker : contentEnd;
    const inner = text.slice(open + 2, close);
    const pipe = firstUnescapedPipe(inner);
    const rawTarget = inner.slice(0, pipe === -1 ? inner.length : pipe);
    const leadingWhitespace = rawTarget.length - rawTarget.trimStart().length;
    const trailingWhitespace = rawTarget.length - rawTarget.trimEnd().length;
    const dest = normalizeWikiTarget(rawTarget);
    const from = textFrom + open;
    const to = textFrom + close + (closed ? 2 : 0);
    const destFrom = textFrom + open + 2 + leadingWhitespace;
    const rawDestTo = textFrom + open + 2 + rawTarget.length;
    const trimmedDestTo = Math.max(destFrom, rawDestTo - trailingWhitespace);
    const selectionInsideRawTarget = selection && selection.from >= destFrom && selection.to <= rawDestTo;
    const destTo = selectionInsideRawTarget ? rawDestTo : trimmedDestTo;
    const isActive = selection ? rangesIntersect(selection, { from, to }) : false;
    if ((!closed || !dest) && !isActive) continue;

    const rawAlias = pipe === -1 ? null : inner.slice(pipe + 1);
    const aliasLeadingWhitespace = rawAlias ? rawAlias.length - rawAlias.trimStart().length : 0;
    const aliasTrailingWhitespace = rawAlias ? rawAlias.length - rawAlias.trimEnd().length : 0;
    links.push({
      from,
      to,
      dest,
      destFrom,
      destTo,
      alias: rawAlias === null ? null : rawAlias.trim().replace(/\\\|/g, "|"),
      aliasFrom: rawAlias === null ? null : textFrom + open + 2 + pipe + 1 + aliasLeadingWhitespace,
      aliasTo: rawAlias === null ? null : textFrom + open + 2 + pipe + 1 + rawAlias.length - aliasTrailingWhitespace,
      closed,
      isActive,
      isCaretInside: selection ? rangeContains({ from: destFrom, to: destTo }, selection) : false,
    });

    open = close + (closed ? 1 : 0);
  }

  return links;
}

/** Parses Obsidian image embeds without changing their source representation. */
export function wikiImagesInText(text: string, textFrom: number, selection: TextSelection | null): WikiImageInfo[] {
  const images: WikiImageInfo[] = [];

  for (let open = text.indexOf("![["); open !== -1; open = text.indexOf("![[", open + 1)) {
    if (escapedAt(text, open)) continue;

    const lineEnd = text.indexOf("\n", open + 3);
    const contentEnd = lineEnd === -1 ? text.length : lineEnd;
    const closingMarker = text.indexOf("]]", open + 3);
    const closed = closingMarker !== -1 && closingMarker <= contentEnd;
    const close = closed ? closingMarker : contentEnd;

    const inner = text.slice(open + 3, close);
    const pipe = firstUnescapedPipe(inner);
    const rawTarget = inner.slice(0, pipe === -1 ? inner.length : pipe);
    const leadingWhitespace = rawTarget.length - rawTarget.trimStart().length;
    const trailingWhitespace = rawTarget.length - rawTarget.trimEnd().length;
    const target = normalizeWikiTarget(rawTarget);

    const from = textFrom + open;
    const to = textFrom + close + (closed ? 2 : 0);
    const srcFrom = textFrom + open + 3 + leadingWhitespace;
    const rawSrcTo = textFrom + open + 3 + rawTarget.length;
    const trimmedSrcTo = Math.max(srcFrom, rawSrcTo - trailingWhitespace);
    const selectionInsideRawTarget = selection && selection.from >= srcFrom && selection.to <= rawSrcTo;
    const srcTo = selectionInsideRawTarget ? rawSrcTo : trimmedSrcTo;
    const isActive = selection ? rangesIntersect(selection, { from, to }) : false;
    const renderable = closed && Boolean(target) && isSupportedImagePath(target);
    if (!renderable && !isActive) continue;

    const lineStart = text.lastIndexOf("\n", open) + 1;
    const prefix = text.slice(lineStart, open);
    images.push({
      from,
      to,
      src: target,
      srcFrom,
      srcTo,
      modifierFrom: pipe === -1 ? null : textFrom + open + 3 + pipe,
      modifierTo: pipe === -1 ? null : textFrom + close,
      alt: target.split("/").at(-1) ?? target,
      prefixColumns: open - lineStart,
      quoteDepth: prefix.split(">").length - 1,
      closed,
      renderable,
      isActive,
      isCaretInside: selection ? rangeContains({ from: srcFrom, to: srcTo }, selection) : false,
    });

    open = close + (closed ? 1 : 0);
  }

  return images;
}

interface DestinationRanges {
  to: number;
  urlFrom: number;
  urlTo: number;
  titleFrom?: number;
  titleTo?: number;
}

function syntaxDestinations(text: string, textFrom: number, name: "Image" | "Link", state?: EditorState) {
  const result = new Map<number, DestinationRanges>();
  const offset = state ? textFrom : 0;
  const tree = state ? syntaxTree(state) : parser.parse(text);
  tree.iterate({
    from: offset,
    to: offset + text.length,
    enter(ref) {
      if (ref.name !== name) return;
      const node = ref.node;
      const marks = node.getChildren("LinkMark");
      const opening = marks.find((mark) => text.slice(mark.from - offset, mark.to - offset) === "(");
      if (!opening || text[node.to - offset - 1] !== ")") return;
      const url = node.getChild("URL");
      const title = node.getChild("LinkTitle");
      result.set(node.from - offset, {
        to: node.to - offset,
        urlFrom: (url?.from ?? opening.to) - offset,
        urlTo: (url?.to ?? opening.to) - offset,
        ...(title ? { titleFrom: title.from - offset, titleTo: title.to - offset } : {}),
      });
      return false;
    },
  });
  return result;
}

function destinationRanges(
  text: string,
  from: number,
  to: number,
  parsed?: DestinationRanges,
  selection?: TextSelection | null,
) {
  if (parsed) {
    if (
      parsed.titleFrom === undefined &&
      selection &&
      selection.from > parsed.urlTo &&
      selection.to <= to &&
      !text.slice(parsed.urlTo, to).trim() &&
      text[parsed.urlFrom] !== "<"
    )
      return { ...parsed, urlTo: to };
    return parsed;
  }
  const urlFrom = targetStart(text, from, to);
  let urlTo = to;
  let titleFrom: number | undefined;
  // While typing an unfinished destination, retain spaces. A recognizable
  // trailing title is a separate editing region even before its quote closes.
  for (let index = urlFrom + 1; index < to; index += 1) {
    if (!/\s/.test(text[index - 1]) || !/["'(]/.test(text[index])) continue;
    const suffix = text.slice(index, to).trimEnd();
    const complete = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\))$/.test(suffix);
    const incomplete = /^(?:"(?:\\.|[^"\\])*|'(?:\\.|[^'\\])*)$/.test(suffix);
    if (!complete && !incomplete) continue;
    titleFrom = index;
    urlTo = index;
    while (urlTo > urlFrom && /\s/.test(text[urlTo - 1])) urlTo -= 1;
    break;
  }
  return { to: to + 1, urlFrom, urlTo, ...(titleFrom === undefined ? {} : { titleFrom, titleTo: to }) };
}

function targetRange(text: string, ranges: DestinationRanges) {
  const raw = text.slice(ranges.urlFrom, ranges.urlTo).trimEnd();
  const angled = raw.startsWith("<") && raw.endsWith(">");
  return { from: ranges.urlFrom + (angled ? 1 : 0), to: angled ? ranges.urlFrom + raw.length - 1 : ranges.urlTo };
}

function targetEnd(text: string, from: number, parsedTo: number | undefined, selection: TextSelection | null) {
  const closing = parsedTo === undefined ? findClosingParen(text, from) : parsedTo - 1;
  if (closing !== -1) return { position: closing, closed: true };
  const lineEnd = text.indexOf("\n", from);
  const end = lineEnd === -1 ? text.length : lineEnd;
  if (!selection || selection.from < from || selection.to > end || containsUnescapedBracket(text, from, end))
    return null;
  return { position: end, closed: false };
}

export function markdownDestinationsInText(
  text: string,
  textFrom: number,
  selection: TextSelection | null,
  kind: "image" | "link",
  state?: EditorState,
): MarkdownDestinationInfo[] {
  const destinations: MarkdownDestinationInfo[] = [];
  const image = kind === "image";
  const parsed = syntaxDestinations(text, textFrom, image ? "Image" : "Link", state);
  const opening = image ? "![" : "[";
  const labelOffset = image ? 2 : 1;
  const localSelection = selection && { from: selection.from - textFrom, to: selection.to - textFrom };

  for (let open = text.indexOf(opening); open !== -1; open = text.indexOf(opening, open + 1)) {
    if (escapedAt(text, open)) continue;
    if (!image && open > 0 && text[open - 1] === "!" && !escapedAt(text, open - 1)) continue;

    const close = findClosingBracket(text, open + labelOffset);
    if (close === -1 || text[close + 1] !== "(") continue;

    const rawDestinationFrom = close + 2;
    const end = targetEnd(text, rawDestinationFrom, parsed.get(open)?.to, localSelection);
    if (!end) continue;
    const rawDestinationTo = end.position;
    const ranges = destinationRanges(text, rawDestinationFrom, rawDestinationTo, parsed.get(open), localSelection);
    const target = targetRange(text, ranges);
    if (
      target.from === target.to &&
      (!selection || !rangeContains({ from: textFrom + target.from, to: textFrom + target.to }, selection))
    )
      continue;

    const from = textFrom + open;
    const to = textFrom + rawDestinationTo + (end.closed ? 1 : 0);
    const lineStart = text.lastIndexOf("\n", open) + 1;
    const prefix = text.slice(lineStart, open);
    destinations.push({
      kind,
      from,
      to,
      labelFrom: textFrom + open + labelOffset,
      labelTo: textFrom + close,
      label: text.slice(open + labelOffset, close),
      urlFrom: textFrom + ranges.urlFrom,
      urlTo: textFrom + ranges.urlTo,
      destination: normalizeMarkdownTarget(text.slice(target.from, target.to)),
      destinationFrom: textFrom + target.from,
      destinationTo: textFrom + target.to,
      ...(ranges.titleFrom === undefined
        ? {}
        : { titleFrom: textFrom + ranges.titleFrom, titleTo: textFrom + ranges.titleTo! }),
      prefixColumns: open - lineStart,
      quoteDepth: prefix.split(">").length - 1,
      isActive: selection ? rangesIntersect(selection, { from, to }) : false,
      isCaretInside: selection
        ? rangeContains({ from: textFrom + target.from, to: textFrom + target.to }, selection)
        : false,
    });

    open = rawDestinationTo;
  }

  return destinations;
}

export function markdownImagesInText(
  text: string,
  textFrom: number,
  selection: TextSelection | null,
  state?: EditorState,
): MarkdownImageInfo[] {
  return markdownDestinationsInText(text, textFrom, selection, "image", state).map((destination) => ({
    from: destination.from,
    to: destination.to,
    altFrom: destination.labelFrom,
    altTo: destination.labelTo,
    alt: destination.label,
    urlFrom: destination.urlFrom,
    urlTo: destination.urlTo,
    src: destination.destination,
    srcFrom: destination.destinationFrom,
    srcTo: destination.destinationTo,
    ...(destination.titleFrom === undefined ? {} : { titleFrom: destination.titleFrom, titleTo: destination.titleTo! }),
    prefixColumns: destination.prefixColumns,
    quoteDepth: destination.quoteDepth,
    isActive: destination.isActive,
    isCaretInside: destination.isCaretInside,
  }));
}

export function markdownLinksInText(
  text: string,
  textFrom: number,
  selection: TextSelection | null,
  state?: EditorState,
): MarkdownLinkInfo[] {
  return markdownDestinationsInText(text, textFrom, selection, "link", state).map((destination) => ({
    from: destination.from,
    to: destination.to,
    textFrom: destination.labelFrom,
    textTo: destination.labelTo,
    text: destination.label,
    dest: destination.destination,
    urlFrom: destination.urlFrom,
    urlTo: destination.urlTo,
    destFrom: destination.destinationFrom,
    destTo: destination.destinationTo,
    ...(destination.titleFrom === undefined ? {} : { titleFrom: destination.titleFrom, titleTo: destination.titleTo! }),
    isActive: destination.isActive,
    isCaretInside: destination.isCaretInside,
  }));
}
