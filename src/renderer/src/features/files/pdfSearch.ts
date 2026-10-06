export interface PdfTextItem {
  str: string;
  dir?: string;
  fontName?: string;
  hasEOL?: boolean;
  width?: number;
  height?: number;
  transform?: number[];
}

interface PdfOperatorGlyph {
  unicode?: string;
  width?: number;
}

export interface PdfTextOperatorList {
  fnArray: number[];
  argsArray: unknown[][];
}

export interface PdfTextItemAdvanceMap {
  starts: Float64Array;
  ends: Float64Array;
  itemStart: number;
  itemEnd: number;
}

export interface PdfPageTextIndex {
  text: string;
  items: string[];
  sourceItemIndexes: Int32Array;
  sourceOffsets: Uint32Array;
  normalizedText: string;
  normalizedSourceItemIndexes: Int32Array;
  normalizedSourceOffsets: Uint32Array;
}

export interface PdfItemMatchRange {
  itemIndex: number;
  start: number;
  end: number;
}

export interface PdfPageTextMatch {
  start: number;
  end: number;
  itemRanges: PdfItemMatchRange[];
}

export interface PdfTextItemMatchGeometry {
  startFraction: number;
  endFraction: number;
}

interface PositionedTextRun {
  text: string;
  starts: number[];
  ends: number[];
  fontName?: string;
}

const isOperatorGlyph = (value: unknown): value is PdfOperatorGlyph =>
  Boolean(value && typeof value === "object" && "unicode" in value);

const appendPositionedText = (run: PositionedTextRun, text: string, start: number, end: number) => {
  const normalizedText = text.normalize("NFKC");
  if (!normalizedText) return;
  const width = end - start;
  for (let offset = 0; offset < normalizedText.length; offset += 1) {
    run.text += normalizedText[offset];
    run.starts.push(start + (width * offset) / normalizedText.length);
    run.ends.push(start + (width * (offset + 1)) / normalizedText.length);
  }
};

const positionedTextRuns = (
  operatorList: PdfTextOperatorList,
  showTextOperatorCodes: ReadonlySet<number>,
  setFontOperatorCode?: number,
) => {
  const runs: PositionedTextRun[] = [];
  let fontName: string | undefined;
  for (let operatorIndex = 0; operatorIndex < operatorList.fnArray.length; operatorIndex += 1) {
    const operatorCode = operatorList.fnArray[operatorIndex];
    if (operatorCode === setFontOperatorCode) {
      const fontArgument = operatorList.argsArray[operatorIndex]?.[0];
      fontName = typeof fontArgument === "string" ? fontArgument : undefined;
      continue;
    }
    if (!showTextOperatorCodes.has(operatorCode)) continue;
    const entries = operatorList.argsArray[operatorIndex]?.[0];
    if (!Array.isArray(entries)) continue;

    const run: PositionedTextRun = { text: "", starts: [], ends: [], fontName };
    let advance = 0;
    for (const entry of entries) {
      if (typeof entry === "number") {
        // TJ adjustments are subtracted from the current text position. PDF.js
        // turns sufficiently large forward adjustments into searchable spaces.
        const adjustment = -entry;
        if (adjustment >= 100) appendPositionedText(run, " ", advance, advance + adjustment);
        advance += adjustment;
        continue;
      }
      if (!isOperatorGlyph(entry) || !entry.unicode) continue;
      const glyphWidth = Number.isFinite(entry.width) ? (entry.width ?? 0) : 0;
      appendPositionedText(run, entry.unicode, advance, advance + glyphWidth);
      advance += glyphWidth;
    }
    if (run.text) runs.push(run);
  }
  return runs;
};

/**
 * Maps normalized PDF.js text-item offsets to the glyph advances used to draw
 * the page. This avoids partial DOM Range bounds, which can include neighboring
 * glyphs when PDF.js applies one horizontal transform to a long combined item.
 */
export const createPdfTextItemAdvanceMaps = (
  items: readonly PdfTextItem[],
  operatorList: PdfTextOperatorList,
  showTextOperatorCodes: ReadonlySet<number>,
  setFontOperatorCode?: number,
): Array<PdfTextItemAdvanceMap | null> => {
  const runs = positionedTextRuns(operatorList, showTextOperatorCodes, setFontOperatorCode);
  const maps: Array<PdfTextItemAdvanceMap | null> = Array.from({ length: items.length }, () => null);

  items.forEach((item, itemIndex) => {
    if (!item.str) return;
    let bestMap: PdfTextItemAdvanceMap | null = null;
    let bestLength = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    const transform = item.transform;
    const textScale = transform ? Math.hypot(transform[0] ?? 0, transform[1] ?? 0) / 1000 : 0;

    for (const run of runs) {
      if (item.fontName && run.fontName && item.fontName !== run.fontName) continue;
      for (let matchLength = item.str.length; matchLength >= Math.max(1, bestLength); matchLength -= 1) {
        const itemPrefix = item.str.slice(0, matchLength);
        let searchFrom = 0;
        let matchedThisLength = false;
        while (searchFrom <= run.text.length - matchLength) {
          const matchOffset = run.text.indexOf(itemPrefix, searchFrom);
          if (matchOffset < 0) break;
          const matchEnd = matchOffset + matchLength;
          matchedThisLength = true;
          const starts = run.starts.slice(matchOffset, matchEnd);
          const ends = run.ends.slice(matchOffset, matchEnd);
          if (starts.length === matchLength && ends.length === matchLength) {
            const directionalStart = starts[0];
            const directionalEnd = ends.at(-1) ?? directionalStart;
            if (item.dir !== "rtl" && directionalEnd <= directionalStart) {
              searchFrom = matchOffset + Math.max(1, matchLength);
              continue;
            }
            const itemStart = Math.min(...starts);
            const matchedEnd = Math.max(...ends);
            const itemEnd =
              textScale > 0 && (item.width ?? 0) > 0 ? itemStart + (item.width ?? 0) / textScale : matchedEnd;
            const estimatedWidth = (matchedEnd - itemStart) * textScale;
            const score =
              matchLength === item.str.length && textScale > 0 && (item.width ?? 0) > 0
                ? Math.abs(estimatedWidth - (item.width ?? 0)) / (item.width ?? 1)
                : Math.max(0, estimatedWidth - (item.width ?? estimatedWidth)) /
                  Math.max(1, item.width ?? estimatedWidth);
            if (matchLength > bestLength || score < bestScore - 0.000001) {
              const mappedStarts = new Float64Array(item.str.length).fill(Number.NaN);
              const mappedEnds = new Float64Array(item.str.length).fill(Number.NaN);
              mappedStarts.set(starts);
              mappedEnds.set(ends);
              bestLength = matchLength;
              bestScore = score;
              bestMap = {
                starts: mappedStarts,
                ends: mappedEnds,
                itemStart,
                itemEnd,
              };
            }
          }
          searchFrom = matchOffset + Math.max(1, matchLength);
        }
        if (matchedThisLength) break;
      }
    }
    maps[itemIndex] = bestMap;
  });

  return maps;
};

const MATCH_GEOMETRY_EPSILON = 0.001;

export const pdfTextItemMatchGeometry = (
  map: PdfTextItemAdvanceMap,
  startOffset: number,
  endOffset: number,
): PdfTextItemMatchGeometry | null => {
  if (startOffset < 0 || endOffset <= startOffset || endOffset > map.ends.length) return null;
  const itemWidth = map.itemEnd - map.itemStart;
  const start = map.starts[startOffset];
  const end = map.ends[endOffset - 1];
  if (!(itemWidth > 0) || !Number.isFinite(start) || !Number.isFinite(end)) return null;

  const startFraction = (start - map.itemStart) / itemWidth;
  const endFraction = (end - map.itemStart) / itemWidth;
  if (
    startFraction < -MATCH_GEOMETRY_EPSILON ||
    endFraction > 1 + MATCH_GEOMETRY_EPSILON ||
    endFraction <= startFraction
  )
    return null;

  return {
    startFraction: Math.max(0, startFraction),
    endFraction: Math.min(1, endFraction),
  };
};

const isWhitespace = (character: string | undefined) => Boolean(character && /\s/u.test(character));

const SEARCH_DASH_PATTERN = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/gu;

const normalizeSearchText = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").replace(SEARCH_DASH_PATTERN, "-").normalize("NFKC");

const collapseWhitespace = (value: string) => value.trim().replace(/\s+/gu, " ");

const needsSpaceBetween = (previous: PdfTextItem, current: PdfTextItem) => {
  if (!previous.str || !current.str || isWhitespace(previous.str.at(-1)) || isWhitespace(current.str[0])) return false;
  if (previous.hasEOL) return true;

  const previousTransform = previous.transform;
  const currentTransform = current.transform;
  if (!previousTransform || !currentTransform) return true;

  const fontHeight = Math.max(previous.height ?? 0, current.height ?? 0, Math.abs(previousTransform[3] ?? 0), 1);
  const sameLine = Math.abs((previousTransform[5] ?? 0) - (currentTransform[5] ?? 0)) <= fontHeight * 0.45;
  if (!sameLine) return true;

  const previousX = previousTransform[4] ?? 0;
  const currentX = currentTransform[4] ?? 0;
  const gap =
    current.dir === "rtl"
      ? previousX - (currentX + (current.width ?? 0))
      : currentX - (previousX + (previous.width ?? 0));
  return gap > fontHeight * 0.12;
};

const isHyphenatedLineBreak = (current: PdfTextItem, next: PdfTextItem | undefined) => {
  if (!current.hasEOL || !next?.str) return false;
  const dashOffset = current.str.search(/[-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]\s*$/u);
  if (dashOffset <= 0) return false;
  const beforeDash = current.str[dashOffset - 1];
  const nextCharacter = next.str.trimStart()[0];
  return /[\p{L}\p{N}]/u.test(beforeDash) && /\p{L}/u.test(nextCharacter ?? "");
};

interface MutableTextVariant {
  text: string;
  sourceItemIndexes: number[];
  sourceOffsets: number[];
}

const appendVariantCharacter = (
  variant: MutableTextVariant,
  character: string,
  itemIndex: number,
  sourceOffset: number,
) => {
  if (isWhitespace(character)) {
    if (!variant.text || variant.text.endsWith(" ")) return;
    variant.text += " ";
  } else {
    variant.text += character;
  }
  variant.sourceItemIndexes.push(itemIndex);
  variant.sourceOffsets.push(sourceOffset);
};

const appendNormalizedSourceCharacter = (
  variant: MutableTextVariant,
  sourceCharacter: string,
  itemIndex: number,
  sourceOffset: number,
) => {
  const normalized = normalizeSearchText(sourceCharacter);
  for (let offset = 0; offset < normalized.length; offset += 1) {
    appendVariantCharacter(variant, normalized[offset], itemIndex, sourceOffset);
  }
};

const createNormalizedTextVariant = (items: readonly PdfTextItem[]) => {
  const variant: MutableTextVariant = { text: "", sourceItemIndexes: [], sourceOffsets: [] };

  items.forEach((item, itemIndex) => {
    const previous = items[itemIndex - 1];
    if (previous && !isHyphenatedLineBreak(previous, item) && needsSpaceBetween(previous, item)) {
      appendVariantCharacter(variant, " ", -1, 0);
    }

    const next = items[itemIndex + 1];
    const joinsNextLine = isHyphenatedLineBreak(item, next);
    const trailingDashOffset = joinsNextLine ? item.str.search(/[-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]\s*$/u) : -1;
    for (let sourceOffset = 0; sourceOffset < item.str.length;) {
      const codePoint = item.str.codePointAt(sourceOffset);
      if (codePoint === undefined) break;
      const sourceCharacter = String.fromCodePoint(codePoint);
      if (trailingDashOffset < 0 || sourceOffset < trailingDashOffset) {
        appendNormalizedSourceCharacter(variant, sourceCharacter, itemIndex, sourceOffset);
      }
      sourceOffset += sourceCharacter.length;
    }

    if (item.hasEOL && !joinsNextLine) appendVariantCharacter(variant, " ", -1, 0);
  });

  const text = variant.text.trimEnd();
  return {
    text,
    sourceItemIndexes: Int32Array.from(variant.sourceItemIndexes.slice(0, text.length)),
    sourceOffsets: Uint32Array.from(variant.sourceOffsets.slice(0, text.length)),
  };
};

/**
 * Builds searchable text while retaining a character-level route back to the
 * original PDF.js text items. The route lets search highlights stay aligned
 * with the selectable text layer instead of approximating positions.
 */
export const createPdfPageTextIndex = (items: readonly PdfTextItem[]): PdfPageTextIndex => {
  let text = "";
  const sourceItemIndexes: number[] = [];
  const sourceOffsets: number[] = [];
  const itemStrings = items.map((item) => item.str);

  const appendCharacterSource = (itemIndex: number, offset: number) => {
    sourceItemIndexes.push(itemIndex);
    sourceOffsets.push(offset);
  };

  const appendSpace = (itemIndex = -1, offset = 0) => {
    if (!text || text.endsWith(" ")) return;
    text += " ";
    appendCharacterSource(itemIndex, offset);
  };

  items.forEach((item, itemIndex) => {
    const previous = items[itemIndex - 1];
    if (previous && needsSpaceBetween(previous, item)) appendSpace();

    for (let offset = 0; offset < item.str.length; offset += 1) {
      const character = item.str[offset];
      if (isWhitespace(character)) {
        appendSpace(itemIndex, offset);
        continue;
      }
      text += character;
      appendCharacterSource(itemIndex, offset);
    }

    if (item.hasEOL) appendSpace();
  });

  const trimmedText = text.trimEnd();
  const sourceLength = trimmedText.length;
  const normalized = createNormalizedTextVariant(items);

  return {
    text: trimmedText,
    items: itemStrings,
    sourceItemIndexes: Int32Array.from(sourceItemIndexes.slice(0, sourceLength)),
    sourceOffsets: Uint32Array.from(sourceOffsets.slice(0, sourceLength)),
    normalizedText: normalized.text,
    normalizedSourceItemIndexes: normalized.sourceItemIndexes,
    normalizedSourceOffsets: normalized.sourceOffsets,
  };
};

export const normalizePdfSearchQuery = (query: string) => {
  const collapsed = collapseWhitespace(query);
  return collapseWhitespace(normalizeSearchText(collapsed)) || collapsed;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

interface PdfSearchTextVariant {
  text: string;
  sourceItemIndexes: Int32Array;
  sourceOffsets: Uint32Array;
}

const itemRangesForMatch = (index: PdfSearchTextVariant, start: number, end: number) => {
  const ranges: PdfItemMatchRange[] = [];
  for (let cursor = start; cursor < end; cursor += 1) {
    const itemIndex = index.sourceItemIndexes[cursor] ?? -1;
    if (itemIndex < 0) continue;
    const offset = index.sourceOffsets[cursor];
    const previous = ranges.at(-1);
    if (previous && previous.itemIndex === itemIndex && offset <= previous.end) {
      previous.end = Math.max(previous.end, offset + 1);
    } else {
      ranges.push({ itemIndex, start: offset, end: offset + 1 });
    }
  }
  return ranges;
};

const findMatchesInVariant = (variant: PdfSearchTextVariant, query: string) => {
  const expression = new RegExp(escapeRegExp(query), "giu");
  const matches: PdfPageTextMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = expression.exec(variant.text))) {
    const start = match.index;
    const end = start + match[0].length;
    const itemRanges = itemRangesForMatch(variant, start, end);
    if (itemRanges.length) matches.push({ start, end, itemRanges });
    if (match[0].length === 0) expression.lastIndex += 1;
  }
  return matches;
};

const matchSourceIdentity = (match: PdfPageTextMatch) =>
  match.itemRanges.map((range) => `${range.itemIndex}:${range.start}:${range.end}`).join("|");

const compareMatchesBySource = (left: PdfPageTextMatch, right: PdfPageTextMatch) => {
  const leftStart = left.itemRanges[0];
  const rightStart = right.itemRanges[0];
  return leftStart.itemIndex - rightStart.itemIndex || leftStart.start - rightStart.start;
};

export const findPdfPageTextMatches = (index: PdfPageTextIndex, query: string): PdfPageTextMatch[] => {
  const normalizedQuery = normalizePdfSearchQuery(query);
  if (!normalizedQuery) return [];

  const exactQuery = collapseWhitespace(query);
  const matches = findMatchesInVariant(index, exactQuery);
  const identities = new Set(matches.map(matchSourceIdentity));
  const normalizedVariant = {
    text: index.normalizedText,
    sourceItemIndexes: index.normalizedSourceItemIndexes,
    sourceOffsets: index.normalizedSourceOffsets,
  };
  for (const match of findMatchesInVariant(normalizedVariant, normalizedQuery)) {
    const identity = matchSourceIdentity(match);
    if (identities.has(identity)) continue;
    identities.add(identity);
    matches.push(match);
  }
  return matches.sort(compareMatchesBySource);
};
