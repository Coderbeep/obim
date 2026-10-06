import { test } from "vitest";

import assert from "node:assert/strict";

import { buildDocumentOutline } from "../src/renderer/src/features/editor/inspector/DocumentOutline";
import { getMarkdownSidebarInfo } from "../src/renderer/src/features/editor/inspector/documentInfo";

test("markdown sidebar info extracts ATX and setext headings", () => {
  const info = getMarkdownSidebarInfo("# Title\n\nSection\n---\n\n### Detail ###");

  assert.deepEqual(info.headings, [
    { level: 1, text: "Title", line: 1 },
    { level: 2, text: "Section", line: 3 },
    { level: 3, text: "Detail", line: 6 },
  ]);
});

test("markdown sidebar info ignores headings inside fenced code", () => {
  const info = getMarkdownSidebarInfo("```md\n# Hidden\n```\n\n## Visible");

  assert.deepEqual(info.headings, [{ level: 2, text: "Visible", line: 5 }]);
  assert.equal(info.stats.codeBlocks, 1);
});

test("markdown sidebar info ignores setext-like lines inside display math", () => {
  const info = getMarkdownSidebarInfo(
    ["# Method", "", "$$", "\\mathbb E[(X-Y)^2]", "=", "2\\sigma_X-2\\rho", "---", "$$", "", "Result", "="].join("\n"),
  );

  assert.deepEqual(info.headings, [
    { level: 1, text: "Method", line: 1 },
    { level: 1, text: "Result", line: 10 },
  ]);
});

test("markdown sidebar headings follow parser context", () => {
  const info = getMarkdownSidebarInfo(
    [
      "<!--",
      "# Hidden in HTML",
      "-->",
      "",
      "    # Hidden in indented code",
      "",
      "> ## Visible quote heading",
      "",
      "Visible setext heading",
      "---",
    ].join("\n"),
  );

  assert.deepEqual(info.headings, [
    { level: 2, text: "Visible quote heading", line: 7 },
    { level: 2, text: "Visible setext heading", line: 9 },
  ]);
});

test("markdown sidebar info ignores YAML frontmatter", () => {
  const info = getMarkdownSidebarInfo("---\ncssclasses:\n  - justify\n  - dasd\n---\n\n- dash");

  assert.deepEqual(info.headings, []);
  assert.equal(info.stats.words, 1);
});

test("markdown sidebar info does not treat list items before horizontal rules as headings", () => {
  const info = getMarkdownSidebarInfo("## Other cooling schedules\n- dasd\n---\n# Lecture 03 - Simulated annealing");

  assert.deepEqual(info.headings, [
    { level: 2, text: "Other cooling schedules", line: 1 },
    { level: 1, text: "Lecture 03 - Simulated annealing", line: 4 },
  ]);
});

test("markdown sidebar info counts common document stats", () => {
  const info = getMarkdownSidebarInfo(
    "# Title\n\nA paragraph with [link](note.md) and ![image](image.png).\n\n- [x] Done\n- [ ] Todo",
  );

  assert.equal(info.stats.words, 9);
  assert.equal(info.stats.links, 1);
  assert.equal(info.stats.images, 1);
  assert.equal(info.stats.tasks, 2);
  assert.equal(info.stats.completedTasks, 1);
  assert.deepEqual(info.tasks, [
    { depth: 0, checked: true, text: "Done", line: 5, marker: { from: 70, to: 73 } },
    { depth: 0, checked: false, text: "Todo", line: 6, marker: { from: 81, to: 84 } },
  ]);
  assert.deepEqual(info.links, [
    { destination: "note.md", text: "link", line: 3, kind: "note" },
    { destination: "image.png", text: "image", line: 3, kind: "image" },
  ]);
});

test("markdown sidebar items follow parser context and retain source lines", () => {
  const info = getMarkdownSidebarInfo(
    [
      "---",
      'draft: "- [ ] Hidden property"',
      "---",
      "",
      "- [ ] Visible task",
      "[Reference](notes/reference.md)",
      "",
      "```md",
      "- [ ] Hidden code task",
      "[Hidden](hidden.md)",
      "```",
    ].join("\n"),
  );

  assert.deepEqual(info.tasks, [
    { depth: 0, checked: false, text: "Visible task", line: 5, marker: { from: 42, to: 45 } },
  ]);
  assert.deepEqual(info.links, [{ destination: "notes/reference.md", text: "Reference", line: 6, kind: "note" }]);
});

test("document outline nests headings by level", () => {
  const info = getMarkdownSidebarInfo("# Page\n\n## Setup\n\n### Install\n\n## Setup");
  const outline = buildDocumentOutline(info.headings);

  assert.deepEqual(
    outline.map((node) => ({
      text: node.heading.text,
      children: node.children.map((child) => ({
        text: child.heading.text,
        children: child.children.map((grandchild) => grandchild.heading.text),
      })),
    })),
    [
      {
        text: "Page",
        children: [
          { text: "Setup", children: ["Install"] },
          { text: "Setup", children: [] },
        ],
      },
    ],
  );
});

test("document outline keeps repeated heading text as distinct semantic items", () => {
  const items = buildDocumentOutline(getMarkdownSidebarInfo("# Page\n\n# Page").headings);

  assert.deepEqual(
    items.map((item) => item.heading.text),
    ["Page", "Page"],
  );
  assert.notEqual(items[0].key, items[1].key);
});

test("document outline returns to root after a nested heading", () => {
  const info = getMarkdownSidebarInfo(
    [
      "# Why accepting worse moves helps",
      "",
      "## Meaning",
      "",
      "### Style of cooling function",
      "",
      "# Markov chains in SA",
      "",
      "## Markov chains in math",
    ].join("\n"),
  );

  const outline = buildDocumentOutline(info.headings);
  assert.deepEqual(
    outline.map((node) => ({
      text: node.heading.text,
      children: node.children.map((child) => child.heading.text),
    })),
    [
      { text: "Why accepting worse moves helps", children: ["Meaning"] },
      { text: "Markov chains in SA", children: ["Markov chains in math"] },
    ],
  );
  assert.equal(outline[0].children[0].children[0].heading.text, "Style of cooling function");
});

test("sidebar tasks retain list nesting and links distinguish destinations", () => {
  const info = getMarkdownSidebarInfo(
    "- [ ] Parent\n  - [x] Child\n- [ ] Sibling\n\n[Web](https://example.com) [Section](#part) ![Photo](photo.png)",
  );
  assert.deepEqual(
    info.tasks.map(({ depth }) => depth),
    [0, 1, 0],
  );
  assert.deepEqual(
    info.links.map(({ kind }) => kind),
    ["external", "internal", "image"],
  );
});
