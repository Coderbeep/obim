export interface PdfTextSelection {
  startItem: number;
  startOffset: number;
  endItem: number;
  endOffset: number;
}
export type PdfReferenceColor = "yellow" | "green" | "blue" | "purple" | "red";
export const parsePdfReferenceColor = (value: string | null): PdfReferenceColor =>
  value === "green" || value === "blue" || value === "purple" || value === "red" ? value : "yellow";

const MAX_SELECTION_NUMBER = 1_000_000;

export const parsePdfTextSelection = (value: string | null): PdfTextSelection | null => {
  if (!value || !/^\d+,\d+,\d+,\d+$/.test(value)) return null;
  const [startItem, startOffset, endItem, endOffset] = value.split(",").map(Number);
  if (
    [startItem, startOffset, endItem, endOffset].some(
      (part) => !Number.isSafeInteger(part) || part > MAX_SELECTION_NUMBER,
    ) ||
    startItem > endItem ||
    (startItem === endItem && startOffset >= endOffset)
  )
    return null;
  return { startItem, startOffset, endItem, endOffset };
};

export const serializePdfTextSelection = (range: PdfTextSelection) =>
  `${range.startItem},${range.startOffset},${range.endItem},${range.endOffset}`;

export const pdfTextSelectionRanges = (range: PdfTextSelection, items: readonly { str: string }[]) => {
  if (
    range.endItem >= items.length ||
    range.startOffset > items[range.startItem].str.length ||
    range.endOffset > items[range.endItem].str.length
  )
    return null;
  const ranges: Array<{ itemIndex: number; start: number; end: number }> = [];
  for (let itemIndex = range.startItem; itemIndex <= range.endItem; itemIndex += 1) {
    const start = itemIndex === range.startItem ? range.startOffset : 0;
    const end = itemIndex === range.endItem ? range.endOffset : items[itemIndex].str.length;
    if (start < end) ranges.push({ itemIndex, start, end });
  }
  return ranges.length ? ranges : null;
};

/** Recovers links copied before empty PDF.js items were counted in selection offsets. */
export const resolvePdfTextSelectionRanges = (range: PdfTextSelection, items: readonly { str: string }[]) => {
  const direct = pdfTextSelectionRanges(range, items);
  if (direct) return { ranges: direct, recoveredLegacyIndex: false };
  const visibleItemIndexes = items.flatMap((item, index) => (item.str ? [index] : []));
  const startItem = visibleItemIndexes[range.startItem];
  const endItem = visibleItemIndexes[range.endItem];
  if (startItem === undefined || endItem === undefined || (startItem === range.startItem && endItem === range.endItem))
    return null;
  const ranges = pdfTextSelectionRanges({ ...range, startItem, endItem }, items);
  return ranges ? { ranges, recoveredLegacyIndex: true } : null;
};

const boundaryInTextLayer = (node: Node, offset: number, textDivs: readonly HTMLElement[]) => {
  const textDiv = textDivs.find((div) => div === node || div.contains(node));
  if (!textDiv) return null;
  const itemIndex = Number(textDiv.dataset.pdfTextItemIndex);
  if (!Number.isSafeInteger(itemIndex) || itemIndex < 0) return null;
  const before = document.createRange();
  before.selectNodeContents(textDiv);
  try {
    before.setEnd(node, offset);
  } catch {
    return null;
  }
  return { itemIndex, offset: before.toString().length };
};

/** Maps a real DOM selection to PDF.js text item coordinates on one page. */
export const pdfSelectionFromDom = (selection: Selection | null, page: HTMLElement): PdfTextSelection | null => {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const textHost = page.querySelector<HTMLElement>(".pdf-page-text");
  if (!textHost) return null;
  const range = selection.getRangeAt(0);
  if (!textHost.contains(range.startContainer) || !textHost.contains(range.endContainer)) return null;
  const textDivs = Array.from(textHost.querySelectorAll<HTMLElement>("[data-pdf-text-item-index]"));
  const start = boundaryInTextLayer(range.startContainer, range.startOffset, textDivs);
  const end = boundaryInTextLayer(range.endContainer, range.endOffset, textDivs);
  if (!start || !end) return null;
  return parsePdfTextSelection(`${start.itemIndex},${start.offset},${end.itemIndex},${end.offset}`);
};

export const pdfReferenceMarkdown = (
  relativePath: string,
  page: number,
  range: PdfTextSelection,
  color: PdfReferenceColor = "yellow",
) => {
  const path = relativePath
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
  const label = `${
    relativePath
      .split("/")
      .at(-1)
      ?.replace(/\.pdf$/i, "") ?? "PDF"
  }, p. ${page}`
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
  return `[${label}](${path}#page=${page}&selection=${serializePdfTextSelection(range)}${color === "yellow" ? "" : `&color=${color}`})`;
};
