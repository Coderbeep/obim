import { describe, expect, it } from "vitest";

import { DEFAULT_NOTE_PDF_EXPORT_OPTIONS, normalizeNotePdfExportOptions } from "../src/shared/note-pdf-export";
import { notePdfBodySource, renderNotePdfMarkdown } from "../src/renderer/src/features/files/notePdfMarkdown";

describe("note PDF export options", () => {
  it("normalizes persisted layout preferences to safe print bounds", () => {
    expect(
      normalizeNotePdfExportOptions({
        pageSize: "letter",
        orientation: "landscape",
        columns: 3,
        columnGapMm: 99,
        marginMm: 1,
        scalePercent: 175,
        theme: "dark",
        includeTitle: false,
      }),
    ).toEqual({
      pageSize: "letter",
      orientation: "landscape",
      columns: 3,
      columnGapMm: 30,
      marginMm: 5,
      scalePercent: 150,
      theme: "dark",
      includeTitle: false,
    });
    expect(normalizeNotePdfExportOptions(null)).toEqual(DEFAULT_NOTE_PDF_EXPORT_OPTIONS);
  });

  it("migrates the previous font-size preference to an equivalent document scale", () => {
    expect(normalizeNotePdfExportOptions({ fontSizePx: 10 }).scalePercent).toBeCloseTo(71.43, 1);
    expect(normalizeNotePdfExportOptions({ fontSizePx: 14 }).scalePercent).toBe(100);
  });
});

describe("note PDF Markdown rendering", () => {
  it("omits frontmatter and renders styled note features", () => {
    const source = `---\ntags: [export]\n---\n# Heading\n\n> [!info]\n> Useful note.\n\n- [x] Done\n\n$$\nx^2 + y^2\n$$\n\n![Plot](attachments/plot.png)`;
    const html = renderNotePdfMarkdown(source);

    expect(notePdfBodySource(source)).toMatch(/^# Heading/u);
    expect(html).not.toContain("tags:");
    expect(html).toContain("note-pdf-callout-info");
    expect(html).toContain("note-pdf-checkbox is-checked");
    expect(html).toContain("note-pdf-math-block");
    expect(html).toContain('class="katex"');
    expect(html).toContain('src="media:///attachments/plot.png"');
  });

  it("keeps raw HTML escaped", () => {
    expect(renderNotePdfMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
  });

  it("preserves unordered and ordered lists for styled PDF markers", () => {
    const html = renderNotePdfMarkdown("- First\n- Second\n\n1. One\n2. Two");

    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>First</li>");
    expect(html).toContain("<li>One</li>");
  });

  it("renders parenthesized LaTeX used inside Markdown tables", () => {
    const html = renderNotePdfMarkdown("| Estimate |\n| --- |\n| \\(3.04 \\cdot 10^{62}\\) |");
    expect(html).toContain("note-pdf-math-inline");
    expect(html).toContain("⋅");
  });
});
