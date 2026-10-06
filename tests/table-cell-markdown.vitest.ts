import assert from "node:assert/strict";

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, waitFor } from "@testing-library/dom";
import { afterEach, test, vi } from "vitest";

import {
  createTableCellLinkExtension,
  renderTableCellMarkdown,
} from "../src/renderer/src/features/editor/extensions/tableCellMarkdown";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";

installCodeMirrorDomPolyfills();

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.remove();
    view.destroy();
  }
});

test("table cell previews render the supported inline Markdown without source delimiters", () => {
  const html = renderTableCellMarkdown(
    "**Bold** and *italic*, `code`, [Notes](notes.md), $q_\\phi(z\\mid x)$, and ![plot](assets/plot.png)",
  );
  const document = new DOMParser().parseFromString(html, "text/html");

  assert.equal(document.querySelector("strong")?.textContent, "Bold");
  assert.equal(document.querySelector("em")?.textContent, "italic");
  assert.equal(document.querySelector("code")?.textContent, "code");
  assert.equal(document.querySelector("a")?.textContent, "Notes");
  assert.equal(document.querySelector("a")?.getAttribute("href"), "notes.md");
  assert.equal(document.querySelector("a")?.classList.contains("cm-link-placeholder-internal"), true);
  assert.ok(document.querySelector(".cm-math-widget .katex"));
  assert.equal(document.querySelector("img")?.getAttribute("src"), "media:///assets/plot.png");
  assert.doesNotMatch(document.body.textContent ?? "", /\*\*|`|\$q_|\]\(notes\.md\)/);
});

test("table cell previews preserve escaped pipes and explicit line breaks", () => {
  const html = renderTableCellMarkdown("left \\| right  \nnext");
  const document = new DOMParser().parseFromString(html, "text/html");

  assert.equal(document.body.textContent?.trim(), "left | right\nnext");
  assert.equal(document.querySelectorAll("br").length, 1);
});

test("table cell previews keep document-level block syntax inline", () => {
  const html = renderTableCellMarkdown("# Heading - not a list");
  const document = new DOMParser().parseFromString(html, "text/html");

  assert.equal(document.querySelector("h1, ul, ol, blockquote"), null);
  assert.equal(document.body.textContent, "# Heading - not a list");
});

test("table cell previews keep raw HTML inert", () => {
  const html = renderTableCellMarkdown('<img src=x onerror="alert(1)"><script>alert(2)</script>');
  const document = new DOMParser().parseFromString(html, "text/html");

  assert.equal(document.querySelector("img"), null);
  assert.equal(document.querySelector("script"), null);
  assert.match(document.body.textContent ?? "", /<img src=x/);
});

test("table cell previews do not invent links or load non-workspace images", () => {
  const html = renderTableCellMarkdown(
    "https://plain.example ![remote](https://example.com/a.png) ![scheme](//example.com/b.png) ![data](data:image/png;base64,AA)",
  );
  const document = new DOMParser().parseFromString(html, "text/html");

  assert.equal(document.querySelector("a"), null);
  assert.equal(document.querySelector("img"), null);
  assert.equal(document.querySelectorAll(".tbl-cell-image-placeholder").length, 3);
});

test("the table link extension preserves package-owned HTML and routes explicit links", async () => {
  const openResource = vi.fn();
  const openExternal = vi.fn();
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      extensions: [createTableCellLinkExtension({ openExternal, openResource })],
    }),
  });
  views.push(view);

  const cell = document.createElement("div");
  cell.className = "tbl-cell-view";
  cell.innerHTML = renderTableCellMarkdown(
    "[Note](My%20Note.md), [Space](<My Note.md>), [Malformed](bad%escape.md), and [Web](https://example.com)",
  );
  view.dom.appendChild(cell);

  await waitFor(() => assert.equal(cell.querySelectorAll("a").length, 4));
  const originalHtml = cell.innerHTML;
  fireEvent.click(cell.querySelectorAll("a")[0]);
  fireEvent.click(cell.querySelectorAll("a")[1]);
  fireEvent.click(cell.querySelectorAll("a")[2]);
  fireEvent.click(cell.querySelectorAll("a")[3]);

  assert.deepEqual(openResource.mock.calls, [["My%20Note.md"], ["My Note.md"], ["bad%escape.md"]]);
  assert.deepEqual(openExternal.mock.calls, [["https://example.com"]]);
  assert.equal(cell.innerHTML, originalHtml);
});
