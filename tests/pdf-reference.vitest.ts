// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  pdfReferenceMarkdown,
  pdfSelectionFromDom,
  pdfTextSelectionRanges,
  parsePdfTextSelection,
  resolvePdfTextSelectionRanges,
} from "../src/renderer/src/shared/pdfReference";
import { parsePdfDeepLink } from "../src/renderer/src/shared/pdfDeepLink";
import { getMarkdownSidebarInfo } from "../src/renderer/src/features/editor/inspector/documentInfo";
import { markdownPdfReferenceLinks } from "../src/shared/pdf-reference-links";
import { recolorPdfReferenceSource } from "../src/renderer/src/features/files/pdfReferenceActions";

describe("PDF selection references", () => {
  it("parses colored Markdown links while ignoring code and images", () => {
    const source =
      "[Paper](Papers/W12.pdf#page=4&selection=2,13,2,24&color=blue)\n`[Code](W12.pdf#page=9)`\n![Image](W12.pdf#page=2)";
    expect(markdownPdfReferenceLinks(source)).toEqual([
      {
        targetBasename: "w12.pdf",
        destination: "Papers/W12.pdf#page=4&selection=2,13,2,24&color=blue",
        label: "Paper",
        line: 1,
      },
    ]);
    expect(parsePdfDeepLink("Papers/W12.pdf#page=4&color=blue")?.color).toBe("blue");
    expect(
      pdfReferenceMarkdown("W12.pdf", 4, { startItem: 2, startOffset: 13, endItem: 2, endOffset: 24 }, "red"),
    ).toContain("&color=red");
  });

  it("changes only the selected note link color and refuses ambiguous duplicates", () => {
    const reference = {
      notePath: "/notes/a.md",
      noteRelativePath: "a.md",
      line: 1,
      destination: "W12.pdf#page=1&selection=0,0,0,4",
      label: "One",
    };
    expect(recolorPdfReferenceSource("[One](W12.pdf#page=1&selection=0,0,0,4)", reference, "green")).toBe(
      "[One](W12.pdf#page=1&selection=0,0,0,4&color=green)",
    );
    expect(
      recolorPdfReferenceSource(
        "[One](W12.pdf#page=1&selection=0,0,0,4) [Two](W12.pdf#page=1&selection=0,0,0,4)",
        reference,
        "red",
      ),
    ).toBeNull();
  });
  it("parses a bounded one-page item range and preserves it through deep-link parsing", () => {
    const range = parsePdfTextSelection("2,13,2,24");
    expect(range).toEqual({ startItem: 2, startOffset: 13, endItem: 2, endOffset: 24 });
    expect(parsePdfDeepLink("Papers/W12.pdf#page=4&selection=2,13,2,24")).toMatchObject({
      path: "Papers/W12.pdf",
      page: 4,
      selection: range,
    });
    expect(parsePdfTextSelection("2,24,2,13")).toBeNull();
    expect(parsePdfTextSelection("2,0,1000001,1")).toBeNull();
    expect(parsePdfDeepLink("Papers/W12.pdf#page=4x")).toBeNull();
    expect(parsePdfDeepLink("Papers/W12.pdf#page=4&selection=bad")).toMatchObject({
      page: 4,
      invalidSelection: true,
    });
  });

  it("maps a DOM selection over text items and creates a portable Markdown link", () => {
    const page = document.createElement("article");
    page.className = "pdf-page";
    const host = document.createElement("div");
    host.className = "pdf-page-text";
    const first = document.createElement("span");
    first.textContent = "Quarterly ";
    first.dataset.pdfTextItemIndex = "0";
    const second = document.createElement("span");
    second.textContent = "revenue report";
    second.dataset.pdfTextItemIndex = "1";
    host.append(first, second);
    page.append(host);
    document.body.append(page);
    const domRange = document.createRange();
    domRange.setStart(first.firstChild!, 4);
    domRange.setEnd(second.firstChild!, 7);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(domRange);
    const reference = pdfSelectionFromDom(selection, page);
    expect(reference).toEqual({ startItem: 0, startOffset: 4, endItem: 1, endOffset: 7 });
    expect(pdfTextSelectionRanges(reference!, [{ str: "Quarterly " }, { str: "revenue report" }])).toEqual([
      { itemIndex: 0, start: 4, end: 10 },
      { itemIndex: 1, start: 0, end: 7 },
    ]);
    expect(pdfReferenceMarkdown("Papers/My W12.pdf", 4, reference!)).toBe(
      "[My W12, p. 4](Papers/My%20W12.pdf#page=4&selection=0,4,1,7)",
    );
    expect(getMarkdownSidebarInfo(pdfReferenceMarkdown("Papers/My W12.pdf", 4, reference!)).links[0]?.destination).toBe(
      "Papers/My%20W12.pdf#page=4&selection=0,4,1,7",
    );
    expect(pdfReferenceMarkdown("Papers/Trial (revised).pdf", 4, reference!)).toContain(
      "Papers/Trial%20%28revised%29.pdf#page=4&selection=0,4,1,7",
    );
    expect(pdfTextSelectionRanges(reference!, [{ str: "short" }])).toBeNull();
    selection.removeAllRanges();
    page.remove();
  });

  it("retains PDF.js item indexes when empty text items have no DOM span", () => {
    const page = document.createElement("article");
    page.className = "pdf-page";
    const host = document.createElement("div");
    host.className = "pdf-page-text";
    const author = document.createElement("span");
    author.dataset.pdfTextItemIndex = "10";
    author.textContent = "Dongjun Kim";
    const institution = document.createElement("span");
    institution.dataset.pdfTextItemIndex = "12";
    institution.textContent = "Stanford University";
    host.append(author, institution);
    page.append(host);
    document.body.append(page);
    const domRange = document.createRange();
    domRange.setStart(author.firstChild!, 0);
    domRange.setEnd(institution.firstChild!, 19);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(domRange);

    const reference = pdfSelectionFromDom(selection, page);
    expect(reference).toEqual({ startItem: 10, startOffset: 0, endItem: 12, endOffset: 19 });
    expect(
      pdfTextSelectionRanges(reference!, [
        ...Array.from({ length: 10 }, () => ({ str: "" })),
        { str: "Dongjun Kim" },
        { str: "" },
        { str: "Stanford University" },
      ]),
    ).toEqual([
      { itemIndex: 10, start: 0, end: 11 },
      { itemIndex: 12, start: 0, end: 19 },
    ]);
    expect(
      resolvePdfTextSelectionRanges({ startItem: 5, startOffset: 0, endItem: 6, endOffset: 19 }, [
        { str: "The Principles of Diffusion Models" },
        { str: "" },
        { str: "Chieh-Hsin Lai" },
        { str: "" },
        { str: "Sony AI" },
        { str: "" },
        { str: "Yang Song" },
        { str: "" },
        { str: "OpenAI" },
        { str: "" },
        { str: "Dongjun Kim" },
        { str: "" },
        { str: "Stanford University" },
      ]),
    ).toEqual({
      ranges: [
        { itemIndex: 10, start: 0, end: 11 },
        { itemIndex: 12, start: 0, end: 19 },
      ],
      recoveredLegacyIndex: true,
    });
    selection.removeAllRanges();
    page.remove();
  });
});
