import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import {
  FILE_GLYPH_ICONS,
  FILE_GLYPH_SIZE,
  FileGlyphSprite,
  getFileGlyph,
} from "../src/renderer/src/shared/icons/FileGlyphs";

test("standalone file glyphs resolve through the canonical Pierre configuration", () => {
  expect(FILE_GLYPH_ICONS).toEqual(
    expect.objectContaining({
      colored: false,
      set: "standard",
    }),
  );

  const markdown = renderToStaticMarkup(getFileGlyph("note.md"));
  expect(FILE_GLYPH_SIZE).toBe(16);
  expect(markdown).toContain('height="16"');
  expect(markdown).toContain('width="16"');
  expect(markdown).toContain('<use href="#file-tree-builtin-text"');
  expect(renderToStaticMarkup(getFileGlyph("image.png"))).toContain('<use href="#file-tree-builtin-image"></use>');
  expect(renderToStaticMarkup(getFileGlyph("report.pdf"))).toContain('<use href="#obim-file-pdf"></use>');
  expect(renderToStaticMarkup(getFileGlyph("drawing.svg"))).toContain('<use href="#file-tree-builtin-default"></use>');
  expect(renderToStaticMarkup(getFileGlyph("plain.txt"))).toContain('<use href="#file-tree-builtin-default"></use>');
  expect(renderToStaticMarkup(getFileGlyph("document"))).toContain('<use href="#file-tree-builtin-default"></use>');
});

test("the document sprite comes from the same Pierre icon set", () => {
  const sprite = renderToStaticMarkup(<FileGlyphSprite />);

  expect(sprite).toContain('id="file-tree-builtin-text"');
  expect(sprite).toContain('id="file-tree-builtin-image"');
  expect(sprite).toContain('id="file-tree-builtin-default"');
  expect(sprite).toContain('id="obim-file-pdf"');
});
