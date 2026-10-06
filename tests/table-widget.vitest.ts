import assert from "node:assert/strict";

import { history, historyKeymap, redo, undo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { fireEvent, waitFor } from "@testing-library/dom";
import { afterEach, test, vi } from "vitest";

import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import {
  createTableMenuRenderBatch,
  tableExtensions,
} from "../src/renderer/src/features/editor/extensions/TableExtension";
import { renderTableCellMarkdown } from "../src/renderer/src/features/editor/extensions/tableCellMarkdown";
import { createEditorExtensions } from "../src/renderer/src/features/editor/setup";
import type { EditorOverlayPort, EditorOverlayRequest } from "../src/renderer/src/store/editorOverlayStore";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";

installCodeMirrorDomPolyfills();

const views: EditorView[] = [];
const fixture = formattedFixture([
  ["Name", "Destination", "Detail"],
  ["Alpha", "[First](First.md) [Web](https://example.com)", "**Bold**"],
  ["Beta", "[Second](Second.md)", "$b^2$"],
  ["Gamma", "[Third](Third.md)", "![Plot](assets/plot.png)"],
]);

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.querySelectorAll(".cm-tooltip").forEach((element) => element.remove());
  for (const view of views.splice(0)) {
    view.dom.remove();
    view.destroy();
  }
});

async function createTableView({
  preview = true,
  renderCell,
}: { preview?: boolean; renderCell?: (source: string) => string } = {}) {
  const markdown = obimMarkdown();
  const openExternal = vi.fn();
  const openResource = vi.fn();
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: fixture,
      selection: { anchor: 0 },
      extensions: [
        markdown,
        history(),
        tableExtensions(markdown, {
          openExternal,
          openResource,
          renderCell: renderCell ?? (preview ? undefined : null),
        }),
      ],
    }),
  });
  views.push(view);

  // Tables intersecting the selection stay as source. Enter and leave once so
  // the real package widget is mounted before menu interaction.
  view.focus();
  view.dispatch({ selection: { anchor: fixture.indexOf("Alpha") } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  view.dispatch({ selection: { anchor: 0 } });
  return { openExternal, openResource, view };
}

function formattedFixture(rows: string[][]) {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)));
  const line = (row: string[]) => `| ${row.map((cell, col) => cell.padEnd(widths[col])).join(" | ")} |`;
  return [
    "before",
    "",
    line(rows[0]),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.slice(1).map(line),
    "",
    "after",
  ].join("\n");
}

async function createProductionTableView(rows: string[][]) {
  const doc = formattedFixture(rows);
  const result = createProductionDocumentView(doc);
  const { view } = result;
  view.dispatch({ selection: { anchor: doc.indexOf(rows[1][0]) } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  view.dispatch({ selection: { anchor: 0 } });
  await waitFor(() => assert.ok(view.dom.querySelector(".tbl-table-widget")));
  return result;
}

function createProductionDocumentView(doc: string) {
  let overlayRequest: EditorOverlayRequest | null = null;
  const openExternal = vi.fn();
  const openResource = vi.fn();
  const overlay: EditorOverlayPort = {
    open(request) {
      overlayRequest = request;
    },
    close(owner) {
      if (overlayRequest?.owner === owner) overlayRequest = null;
    },
    hotkey() {},
  };
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        createEditorExtensions({
          isMarkdown: true,
          noteHeader: [],
          notify: vi.fn(),
          openExternal,
          openResource,
          overlay,
          owner: "table-capabilities",
        }),
        history(),
        // ObimEditor's React CodeMirror basicSetup supplies the root history bindings.
        keymap.of(historyKeymap),
      ],
    }),
  });
  views.push(view);
  return { getOverlayRequest: () => overlayRequest, openExternal, openResource, view };
}

function renderedRows(view: EditorView) {
  return [...view.dom.querySelectorAll<HTMLElement>(".tbl-table-row")].map((row) =>
    [...row.querySelectorAll<HTMLElement>(".tbl-cell-view")].map((cell) => cell.textContent?.trim() ?? ""),
  );
}

type SourceCell = { from: number; source: string };

function unescapedPipes(source: string) {
  const indexes: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "|") continue;
    let slashes = 0;
    for (let before = index - 1; before >= 0 && source[before] === "\\"; before -= 1) slashes += 1;
    if (slashes % 2 === 0) indexes.push(index);
  }
  return indexes;
}

function sourceCells(view: EditorView) {
  const rows: SourceCell[][] = [];
  for (let number = 1; number <= view.state.doc.lines; number += 1) {
    const line = view.state.doc.line(number);
    if (!/^\|.*\|$/.test(line.text)) continue;

    const pipes = unescapedPipes(line.text);
    const cells = pipes.slice(0, -1).map((left, index) => {
      const raw = line.text.slice(left + 1, pipes[index + 1]);
      const leadingWhitespace = raw.length - raw.trimStart().length;
      return { from: line.from + left + 1 + leadingWhitespace, source: raw.trim() };
    });
    if (!cells.every(({ source }) => /^:?-+:?$/.test(source))) rows.push(cells);
  }
  return rows;
}

function sourceRows(view: EditorView) {
  return sourceCells(view).map((row) => row.map(({ source }) => source));
}

function renderedCellState(cell: ParentNode) {
  return {
    images: [...cell.querySelectorAll<HTMLImageElement>("img")].map((image) => image.getAttribute("src")),
    links: [...cell.querySelectorAll<HTMLAnchorElement>("a[href]")].map((link) => link.getAttribute("href")),
    text: cell.textContent?.trim() ?? "",
  };
}

function previewState(source: string) {
  const document = new DOMParser().parseFromString(renderTableCellMarkdown(source), "text/html");
  return renderedCellState(document.body);
}

async function assertTableMatchesSource(view: EditorView) {
  await waitFor(() => {
    const expected = sourceRows(view).map((row) => row.map(previewState));
    const rendered = [...view.dom.querySelectorAll<HTMLElement>(".tbl-table-widget")].flatMap((table) =>
      [...table.querySelectorAll<HTMLElement>(".tbl-table-row")].map((row, rowIndex) =>
        [...row.querySelectorAll<HTMLElement>(":scope > .tbl-cell")].map((cell, colIndex) => {
          assert.equal(cell.dataset.row, String(rowIndex));
          assert.equal(cell.dataset.col, String(colIndex));
          const preview = cell.querySelector<HTMLElement>(":scope > .tbl-cell-view");
          assert.ok(preview);
          return renderedCellState(preview);
        }),
      ),
    );
    assert.deepEqual(rendered, expected);
  });
}

async function assertActiveCellsMatchSource(view: EditorView) {
  const expected = sourceCells(view);
  for (const [rowIndex, row] of expected.entries()) {
    for (const [colIndex, cell] of row.entries()) {
      view.dispatch({ selection: { anchor: cell.from } });
      const nested = await waitFor(() => {
        const editor = view.dom.querySelector<HTMLElement>(
          `.tbl-cell[data-row="${rowIndex}"][data-col="${colIndex}"] .tbl-cell-editor .cm-editor`,
        );
        assert.ok(editor);
        const nestedView = EditorView.findFromDOM(editor);
        assert.ok(nestedView);
        return nestedView;
      });
      assert.equal(nested.state.doc.toString(), cell.source);
    }
  }
  view.dispatch({ selection: { anchor: 0 } });
  await waitFor(() => assert.equal(view.dom.querySelector(".tbl-cell-editor"), null));
}

function assertCurrentLinksRoute(
  view: EditorView,
  openResource: ReturnType<typeof vi.fn>,
  openExternal: ReturnType<typeof vi.fn>,
) {
  openResource.mockClear();
  openExternal.mockClear();
  const expectedResources: string[][] = [];
  const expectedExternal: string[][] = [];
  for (const link of view.dom.querySelectorAll<HTMLAnchorElement>(".tbl-cell-view a[href]")) {
    const destination = link.getAttribute("href");
    assert.ok(destination);
    if (/^(?:https?:\/\/|www\.)/i.test(destination)) {
      expectedExternal.push([destination.startsWith("www.") ? `https://${destination}` : destination]);
    } else {
      expectedResources.push([destination]);
    }
    fireEvent.click(link);
  }
  assert.deepEqual(openResource.mock.calls, expectedResources);
  assert.deepEqual(openExternal.mock.calls, expectedExternal);
}

async function chooseMenuItem(view: EditorView, location: "row" | "col", index: number, label: string) {
  const cell = location === "row" ? { row: index, col: 0 } : { row: 0, col: index };
  await waitFor(() => assert.ok(view.dom.querySelector(`.tbl-cell[data-row="${cell.row}"][data-col="${cell.col}"]`)));
  const selector = `.tbl-cell[data-row="${cell.row}"][data-col="${cell.col}"] .tbl-handle[data-type="header"][data-location="${location}"]`;
  const handle = view.dom.querySelector<HTMLElement>(selector);
  assert.ok(handle, `${location} ${index} handle must exist`);

  fireEvent.mouseOver(handle);
  fireEvent.pointerDown(handle, { button: 0, buttons: 1, clientX: 10, clientY: 10, pointerId: 1 });
  await Promise.resolve();
  const currentHandle = view.dom.querySelector<HTMLElement>(selector);
  assert.ok(currentHandle, `${location} ${index} handle must survive activation`);
  fireEvent.pointerUp(currentHandle, { button: 0, buttons: 0, clientX: 10, clientY: 10, pointerId: 1 });

  const item = await waitFor(() => {
    const match = [...document.querySelectorAll<HTMLElement>(".tbl-menu-item")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    assert.ok(match, `${label} menu item must exist`);
    return match;
  });
  fireEvent.click(item);
  await waitFor(() => assert.equal(document.querySelector(".tbl-menu-item"), null));
}

async function selectRowWithHandle(view: EditorView, index: number) {
  const selector = `.tbl-cell[data-row="${index}"][data-col="0"] .tbl-handle[data-type="header"][data-location="row"]`;
  const handle = await waitFor(() => {
    const current = view.dom.querySelector<HTMLElement>(selector);
    assert.ok(current);
    return current;
  });

  fireEvent.mouseOver(handle);
  fireEvent.pointerDown(handle, { button: 0, buttons: 1, clientX: 10, clientY: 10, pointerId: 1 });
  await Promise.resolve();
  const currentHandle = view.dom.querySelector<HTMLElement>(selector);
  assert.ok(currentHandle);
  fireEvent.pointerUp(currentHandle, { button: 0, buttons: 0, clientX: 10, clientY: 10, pointerId: 1 });
  await waitFor(() => assert.ok(document.querySelector(".tbl-menu-item")));
  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() => assert.equal(document.querySelector(".tbl-menu-item"), null));
}

function cutEvent() {
  const event = new Event("cut", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { clearData: vi.fn(), getData: vi.fn(() => ""), setData: vi.fn() },
  });
  return event;
}

test("package-owned previews track a middle-row delete, undo, and redo", async () => {
  const { openExternal, openResource, view } = await createTableView();
  await waitFor(() => assert.match(syntaxTree(view.state).toString(), /Table/), { timeout: 5_000 });
  await assertTableMatchesSource(view);
  assert.deepEqual(
    renderedRows(view).map(([name]) => name),
    ["Name", "Alpha", "Beta", "Gamma"],
  );
  assertCurrentLinksRoute(view, openResource, openExternal);

  await chooseMenuItem(view, "row", 2, "Delete row");
  await waitFor(() => assert.doesNotMatch(view.state.doc.toString(), /Beta|Second/));
  await assertTableMatchesSource(view);
  assert.deepEqual(
    renderedRows(view).map(([name]) => name),
    ["Name", "Alpha", "Gamma"],
  );
  assert.equal(view.dom.textContent?.includes("Second"), false);
  const third = view.dom.querySelector<HTMLAnchorElement>('.tbl-cell[data-row="2"][data-col="1"] a');
  assert.ok(third);
  openResource.mockClear();
  fireEvent.click(third);
  assert.deepEqual(openResource.mock.calls, [["Third.md"]]);

  assert.equal(undo(view), true);
  await waitFor(() => assert.match(view.state.doc.toString(), /Beta.*Second/));
  await assertTableMatchesSource(view);
  assert.deepEqual(
    renderedRows(view).map(([name]) => name),
    ["Name", "Alpha", "Beta", "Gamma"],
  );

  assert.equal(redo(view), true);
  await waitFor(() => assert.doesNotMatch(view.state.doc.toString(), /Beta|Second/));
  await assertTableMatchesSource(view);
  assert.deepEqual(
    renderedRows(view).map(([name]) => name),
    ["Name", "Alpha", "Gamma"],
  );
});

test("the uncustomized package renderer keeps row identity through delete and undo", async () => {
  const { view } = await createTableView({ preview: false });
  const names = () => renderedRows(view).map((row) => row[0]);

  await waitFor(() => assert.deepEqual(names(), ["Name", "Alpha", "Beta", "Gamma"]));
  await chooseMenuItem(view, "row", 2, "Delete row");
  await waitFor(() => assert.deepEqual(names(), ["Name", "Alpha", "Gamma"]));
  assert.equal(undo(view), true);
  await waitFor(() => assert.deepEqual(names(), ["Name", "Alpha", "Beta", "Gamma"]));
});

test("cutting root editor text after selecting a table row leaves the table alone", async () => {
  const { view } = await createTableView();
  const before = sourceRows(view);
  await selectRowWithHandle(view, 3);

  const outsideCut = cutEvent();
  document.body.dispatchEvent(outsideCut);
  assert.equal(outsideCut.defaultPrevented, false);
  assert.deepEqual(sourceRows(view), before);

  const outsideText = view.contentDOM.querySelector<HTMLElement>(".cm-line")?.firstChild;
  assert.ok(outsideText);
  const range = document.createRange();
  range.setStart(outsideText, 0);
  range.setEnd(outsideText, "before".length);
  const selection = document.getSelection();
  assert.ok(selection);
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  await Promise.resolve();

  assert.equal(view.dom.querySelector(".tbl-handle[data-hover], .tbl-handle[data-active]"), null);

  view.dispatch({ selection: { anchor: 0, head: "before".length } });
  view.focus();
  view.contentDOM.dispatchEvent(cutEvent());
  await waitFor(() => assert.equal(view.state.doc.toString().startsWith("before"), false));
  assert.deepEqual(sourceRows(view), before);
});

test("moving outside the table clears a latched header hover", async () => {
  const { view } = await createTableView();
  const handle = await waitFor(() => {
    const current = view.dom.querySelector<HTMLElement>('.tbl-handle[data-type="header"][data-location="col"]');
    assert.ok(current);
    return current;
  });
  const outside = view.contentDOM.querySelector<HTMLElement>(":scope > .cm-line");
  assert.ok(outside);

  fireEvent.mouseOver(handle);
  await waitFor(() => assert.ok(view.dom.querySelector(".tbl-handle[data-hover]")));
  assert.equal(document.body.style.cursor, "pointer");

  fireEvent.pointerMove(handle);
  assert.ok(view.dom.querySelector(".tbl-handle[data-hover]"));

  fireEvent.pointerMove(outside);
  await waitFor(() => assert.equal(view.dom.querySelector(".tbl-handle[data-hover]"), null));
  assert.equal(document.body.style.cursor, "");
});

test("cutting links before and between multiple tables preserves complete table spans", async () => {
  const firstTable = formattedFixture([
    ["Type", "Example"],
    ["External", "[Site](https://example.com)"],
  ]);
  const secondTable = formattedFixture([
    ["Inline structure", "Rendered example"],
    ["Plain text", "Ordinary text"],
    ["Combined formatting", "**Bold with [an internal link](Another note.md)**"],
  ]);
  const links = ["[Note](notes/todo.md)", "[Site](https://example.com)", "[Site](www.example.com)"];
  const doc = [links[0], firstTable, `${links[1]} or ${links[2]}`, secondTable].join("\n\n");
  const { view } = createProductionDocumentView(doc);
  const expectedLastRow = "| Combined formatting | **Bold with [an internal link](Another note.md)** |";
  const assertTablesComplete = async () => {
    assert.equal(view.state.doc.toString().includes(expectedLastRow), true);
    assert.equal(view.dom.querySelectorAll(".tbl-table-widget").length, 2);
    const leakedTableSource = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")]
      .filter((line) => !line.closest(".tbl-table-widget"))
      .some((line) => line.textContent?.includes("Another note.md"));
    assert.equal(leakedTableSource, false);
    await assertTableMatchesSource(view);
  };

  await waitFor(() => assert.equal(view.dom.querySelectorAll(".tbl-table-widget").length, 2));
  assert.equal(view.state.doc.toString(), doc);
  const parsedTables: string[] = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name === "Table") parsedTables.push(view.state.doc.sliceString(node.from, node.to));
    },
  });
  assert.equal(parsedTables.length, 2);
  assert.equal(parsedTables[1].includes(expectedLastRow), true, JSON.stringify(parsedTables, null, 2));
  await assertTablesComplete();

  for (const source of links) {
    const beforeCut = view.state.doc.toString();
    const from = view.state.doc.toString().lastIndexOf(source);
    assert.notEqual(from, -1);
    view.dispatch({ selection: { anchor: from, head: from + source.length } });
    view.focus();
    view.contentDOM.dispatchEvent(cutEvent());

    await waitFor(() => assert.equal(view.state.doc.length, beforeCut.length - source.length));
    await assertTablesComplete();
  }

  const cutDoc = view.state.doc.toString();
  for (let index = links.length - 1; index >= 0; index -= 1) {
    const beforeUndo = view.state.doc.length;
    assert.equal(undo(view), true);
    await waitFor(() => assert.equal(view.state.doc.length, beforeUndo + links[index].length));
    await assertTablesComplete();
  }
  assert.equal(view.state.doc.toString(), doc);

  for (const source of links) {
    const beforeRedo = view.state.doc.length;
    assert.equal(redo(view), true);
    await waitFor(() => assert.equal(view.state.doc.length, beforeRedo - source.length));
    await assertTablesComplete();
  }
  assert.equal(view.state.doc.toString(), cutDoc);
});

test("the package renderer callback receives current source after delete and undo", async () => {
  const renderCell = vi.fn(renderTableCellMarkdown);
  const { view } = await createTableView({ renderCell });
  await assertTableMatchesSource(view);

  renderCell.mockClear();
  await chooseMenuItem(view, "row", 2, "Delete row");
  await waitFor(() => assert.ok(renderCell.mock.calls.some(([source]) => source.includes("Third.md"))));
  assert.equal(
    renderCell.mock.calls.some(([source]) => source.includes("Second.md")),
    false,
  );

  renderCell.mockClear();
  assert.equal(undo(view), true);
  await waitFor(() => assert.ok(renderCell.mock.calls.some(([source]) => source.includes("Second.md"))));
  await assertTableMatchesSource(view);
});

test("Ctrl+Z from an active cell delegates to root table history", async () => {
  const { view } = await createTableView();
  const before = view.state.doc.toString();

  await chooseMenuItem(view, "row", 2, "Delete row");
  await waitFor(() => assert.doesNotMatch(view.state.doc.toString(), /Beta|Second/));
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("Gamma") } });
  const nestedContent = await waitFor(() => {
    const content = view.dom.querySelector<HTMLElement>(
      '.tbl-cell[data-row="2"][data-col="0"] .tbl-cell-editor .cm-content',
    );
    assert.ok(content);
    return content;
  });

  fireEvent.keyDown(nestedContent, { ctrlKey: true, key: "z" });
  await waitFor(() => assert.equal(view.state.doc.toString(), before));
  await assertTableMatchesSource(view);
});

for (const { label, location, index } of [
  { label: "Add row below", location: "row" as const, index: 2 },
  { label: "Move row up", location: "row" as const, index: 2 },
  { label: "Duplicate row", location: "row" as const, index: 2 },
  { label: "Clear row", location: "row" as const, index: 2 },
  { label: "Add column after", location: "col" as const, index: 0 },
  { label: "Move column right", location: "col" as const, index: 0 },
  { label: "Duplicate column", location: "col" as const, index: 0 },
  { label: "Clear column", location: "col" as const, index: 1 },
  { label: "Delete column", location: "col" as const, index: 1 },
]) {
  test(`${label.toLowerCase()} keeps source, preview, undo, and redo aligned`, async () => {
    const { openExternal, openResource, view } = await createTableView();
    await assertTableMatchesSource(view);
    const before = view.state.doc.toString();

    await chooseMenuItem(view, location, index, label);
    await waitFor(() => assert.notEqual(view.state.doc.toString(), before));
    const changed = view.state.doc.toString();
    await assertTableMatchesSource(view);
    await assertActiveCellsMatchSource(view);
    assertCurrentLinksRoute(view, openResource, openExternal);

    assert.equal(undo(view), true);
    await waitFor(() => assert.equal(view.state.doc.toString(), before));
    await assertTableMatchesSource(view);
    await assertActiveCellsMatchSource(view);
    assertCurrentLinksRoute(view, openResource, openExternal);

    assert.equal(redo(view), true);
    await waitFor(() => assert.equal(view.state.doc.toString(), changed));
    await assertTableMatchesSource(view);
    await assertActiveCellsMatchSource(view);
    assertCurrentLinksRoute(view, openResource, openExternal);
  });
}

for (const row of [1, 2, 3]) {
  test(`deleting data row ${row} removes that row and survives undo/redo`, async () => {
    const { openExternal, openResource, view } = await createTableView();
    const before = view.state.doc.toString();
    const deleted = sourceRows(view)[row][0];

    await chooseMenuItem(view, "row", row, "Delete row");
    await waitFor(() => assert.doesNotMatch(view.state.doc.toString(), new RegExp(`\\b${deleted}\\b`)));
    const changed = view.state.doc.toString();
    await assertTableMatchesSource(view);
    await assertActiveCellsMatchSource(view);
    assertCurrentLinksRoute(view, openResource, openExternal);

    assert.equal(undo(view), true);
    await waitFor(() => assert.equal(view.state.doc.toString(), before));
    await assertTableMatchesSource(view);
    await assertActiveCellsMatchSource(view);
    assertCurrentLinksRoute(view, openResource, openExternal);

    assert.equal(redo(view), true);
    await waitFor(() => assert.equal(view.state.doc.toString(), changed));
    await assertTableMatchesSource(view);
    await assertActiveCellsMatchSource(view);
    assertCurrentLinksRoute(view, openResource, openExternal);
  });
}

test("supported inline capabilities render in inactive and active cells", async () => {
  const capabilities = [
    { active: ".cm-formatting-bold-text", inactive: "strong", name: "Bold", source: "x **Bold**", text: "Bold" },
    { active: ".cm-formatting-italic-text", inactive: "em", name: "Italic", source: "x *Italic*", text: "Italic" },
    { active: ".cm-formatting-inline-code", inactive: "code", name: "Code", source: "x `code`", text: "code" },
    { active: ".cm-math-widget", inactive: ".cm-math-widget", name: "Math", source: "x $x^2$", text: "x\\^2" },
    {
      active: ".cm-image-widget",
      inactive: "img.tbl-cell-image",
      name: "Image",
      source: "x ![Plot](assets/plot.png)",
      text: "Plot",
    },
    {
      active: "a.cm-link-placeholder",
      inactive: "a.cm-link-placeholder",
      name: "Link",
      source: "x [Note](note.md)",
      text: "Note",
    },
  ];
  const { view } = await createProductionTableView([
    ["Feature", "Value"],
    ...capabilities.map(({ name, source }) => [name, source]),
    ["Escaped", "left \\| right"],
  ]);

  await assertTableMatchesSource(view);
  assert.equal(view.dom.querySelector('.tbl-cell[data-row="7"][data-col="1"]')?.textContent?.trim(), "left | right");

  for (const [index, capability] of capabilities.entries()) {
    const row = index + 1;
    const cell = () => view.dom.querySelector<HTMLElement>(`.tbl-cell[data-row="${row}"][data-col="1"]`);
    assert.ok(cell()?.querySelector(capability.inactive), `${capability.name} inactive preview must render`);

    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(capability.source) } });
    await waitFor(() => assert.ok(cell()?.querySelector(".tbl-cell-editor")));
    assert.match(
      cell()?.querySelector(".tbl-cell-editor .cm-content")?.textContent ?? "",
      new RegExp(capability.text, "i"),
    );
    await waitFor(() =>
      assert.ok(cell()?.querySelector(capability.active), `${capability.name} active extension must render`),
    );

    view.dispatch({ selection: { anchor: 0 } });
    await waitFor(() => assert.equal(view.dom.querySelector(".tbl-cell-editor"), null));
  }
});

test("image and link destinations inside active cells use the shared overlays", async () => {
  const image = "x ![Plot](assets/plot.png)";
  const link = "x [Note](note.md)";
  const { getOverlayRequest, openResource, view } = await createProductionTableView([
    ["Feature", "Value"],
    ["Image", image],
    ["Link", link],
  ]);

  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(image) } });
  await waitFor(() => assert.ok(view.dom.querySelector('.tbl-cell[data-row="1"][data-col="1"] .tbl-cell-editor')));
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("assets/plot.png") + 2 } });
  await waitFor(() => assert.equal(getOverlayRequest()?.scope, "images"));
  assert.equal(getOverlayRequest()?.source, "assets/plot.png");

  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(link) } });
  await waitFor(() => assert.ok(view.dom.querySelector('.tbl-cell[data-row="2"][data-col="1"] .tbl-cell-editor')));
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("note.md") + 2 } });
  await waitFor(() => assert.equal(getOverlayRequest()?.scope, "links"));
  assert.equal(getOverlayRequest()?.source, "note.md");

  const editor = view.dom.querySelector<HTMLElement>(
    '.tbl-cell[data-row="2"][data-col="1"] .tbl-cell-editor .cm-editor',
  );
  assert.ok(editor);
  const nested = EditorView.findFromDOM(editor);
  assert.ok(nested);
  const destinationFrom = nested.state.doc.toString().indexOf("note.md");
  const updatedDestination = "folder/My%20Note.md";
  nested.dispatch({
    changes: { from: destinationFrom, to: destinationFrom + "note.md".length, insert: updatedDestination },
    selection: { anchor: destinationFrom + updatedDestination.length },
  });
  await waitFor(() => assert.match(view.state.doc.toString(), /folder\/My%20Note\.md/));

  view.dispatch({ selection: { anchor: 0 } });
  const updatedLink = await waitFor(() => {
    const anchor = view.dom.querySelector<HTMLAnchorElement>('.tbl-cell[data-row="2"][data-col="1"] a[href]');
    assert.ok(anchor);
    assert.equal(anchor.getAttribute("href"), updatedDestination);
    return anchor;
  });
  fireEvent.click(updatedLink);
  assert.deepEqual(openResource.mock.calls, [[updatedDestination]]);
  await assertTableMatchesSource(view);
});

async function activeCellEditor(view: EditorView, row: number, col: number) {
  return waitFor(() => {
    const dom = view.dom.querySelector<HTMLElement>(`.tbl-cell[data-row="${row}"][data-col="${col}"] .cm-editor`);
    assert.ok(dom);
    const nested = EditorView.findFromDOM(dom);
    assert.ok(nested);
    return nested;
  });
}

for (const value of ["left | right", "first\nsecond", "`left | right`", "**new value**"]) {
  test(`editing a cell preserves ${JSON.stringify(value)} across blur and undo/redo`, async () => {
    const { view } = await createTableView();
    const before = view.state.doc.toString();
    view.dispatch({ selection: { anchor: before.indexOf("Alpha") } });
    const nested = await activeCellEditor(view, 1, 0);
    nested.dispatch({
      changes: { from: 0, to: nested.state.doc.length, insert: value },
      selection: { anchor: value.length },
    });
    await waitFor(() => assert.notEqual(view.state.doc.toString(), before));
    view.dispatch({ selection: { anchor: 0 } });
    await waitFor(() => {
      const cell = view.dom.querySelector('.tbl-cell[data-row="1"][data-col="0"] .tbl-cell-view');
      assert.ok(cell);
      assert.equal(cell.textContent?.trim(), value.replaceAll("`", "").replaceAll("**", ""));
      if (value.includes("\n")) assert.equal(cell.querySelectorAll("br").length, 1);
    });
    const changed = view.state.doc.toString();
    assert.equal(sourceRows(view).length, 4);
    assert.equal(sourceRows(view)[1].length, 3);
    assert.equal(undo(view), true);
    await waitFor(() => assert.equal(view.state.doc.toString(), before));
    assert.equal(redo(view), true);
    await waitFor(() => assert.equal(view.state.doc.toString(), changed));
  });
}

for (const [key, shiftKey, row, col] of [
  ["Tab", false, 1, 1],
  ["Tab", true, 0, 2],
  ["Enter", false, 2, 0],
] as const) {
  test(`${shiftKey ? "Shift+" : ""}${key} moves to the expected cell without changing source`, async () => {
    const { view } = await createTableView();
    const before = view.state.doc.toString();
    view.dispatch({ selection: { anchor: before.indexOf("Alpha") } });
    const nested = await activeCellEditor(view, 1, 0);
    fireEvent.keyDown(nested.contentDOM, { key, shiftKey });
    await activeCellEditor(view, row, col);
    assert.equal(view.state.doc.toString(), before);
  });
}

test("a DOM selection on a cell container does not crash or activate an unrelated cell", async () => {
  const { view } = await createTableView();
  await assertTableMatchesSource(view);
  const before = view.state.doc.toString();
  const cell = view.dom.querySelector('.tbl-cell[data-row="1"][data-col="0"]');
  assert.ok(cell);
  const range = document.createRange();
  range.setStart(cell, 0);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  const error = vi.fn();
  window.addEventListener("error", error);
  try {
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(error.mock.calls.length, 0);
    assert.equal(view.state.doc.toString(), before);
    assert.equal(view.dom.querySelector(".tbl-cell-editor"), null);
  } finally {
    window.removeEventListener("error", error);
  }
});

for (const value of ["pasted | text", "first\nsecond"]) {
  test(`plain-text paste ${JSON.stringify(value)} stays within the active cell`, async () => {
    const { view } = await createProductionTableView([
      ["Name", "Value"],
      ["Alpha", "Beta"],
    ]);
    const before = view.state.doc.toString();
    view.dispatch({ selection: { anchor: before.indexOf("Alpha") } });
    const nested = await activeCellEditor(view, 1, 0);
    nested.dispatch({ selection: { anchor: 0, head: nested.state.doc.length } });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { types: ["text/plain"], files: [], getData: (type: string) => (type === "text/plain" ? value : "") },
    });
    nested.contentDOM.dispatchEvent(event);
    await waitFor(() => assert.notEqual(view.state.doc.toString(), before));
    view.dispatch({ selection: { anchor: 0 } });
    await waitFor(() =>
      assert.equal(
        view.dom.querySelector('.tbl-cell[data-row="1"][data-col="0"] .tbl-cell-view')?.textContent?.trim(),
        value,
      ),
    );
    assert.equal(sourceRows(view).length, 2);
    assert.equal(sourceRows(view)[1].length, 2);
    assert.equal(sourceRows(view)[1][1], "Beta");
    assert.equal(undo(view), true);
    await waitFor(() => assert.equal(view.state.doc.toString(), before));
  });
}

test("Tab from the final cell creates one row and undo removes it", async () => {
  const { view } = await createTableView();
  const before = view.state.doc.toString();
  const last = sourceCells(view)[3][2];
  view.dispatch({ selection: { anchor: last.from } });
  const nested = await activeCellEditor(view, 3, 2);
  fireEvent.keyDown(nested.contentDOM, { key: "Tab" });
  await activeCellEditor(view, 4, 0);
  assert.equal(sourceRows(view).length, 5);
  assert.deepEqual(sourceRows(view)[4], ["", "", ""]);
  assert.equal(undo(view), true);
  await waitFor(() => assert.equal(view.state.doc.toString(), before));
});

test("Shift+Tab from the first header exits before the table without inserting a row", async () => {
  const { view } = await createTableView();
  const before = view.state.doc.toString();
  view.dispatch({ selection: { anchor: sourceCells(view)[0][0].from } });
  const nested = await activeCellEditor(view, 0, 0);
  fireEvent.keyDown(nested.contentDOM, { key: "Tab", shiftKey: true });
  await waitFor(() => assert.equal(view.dom.querySelector(".tbl-cell-editor"), null));
  assert.equal(view.state.doc.toString(), before);
  assert.ok(view.state.selection.main.head < before.indexOf("|"));
});

test("row options can be opened, navigated, dismissed, and activated using the keyboard", async () => {
  const { view } = createProductionDocumentView(fixture);
  const before = view.state.doc.toString();
  const handle = await waitFor(() => {
    const element = view.dom.querySelector<HTMLElement>(
      '.tbl-cell[data-row="2"][data-col="0"] .tbl-handle[data-type="header"][data-location="row"]',
    );
    assert.ok(element);
    assert.notEqual(element.getAttribute("aria-hidden"), "true");
    assert.equal(element.tabIndex, 0);
    assert.equal(element.getAttribute("aria-label"), "Row 3 options");
    return element;
  });
  handle.focus();
  fireEvent.keyDown(handle, { key: "Enter" });
  const items = await waitFor(() => {
    const menu = view.dom.querySelector<HTMLElement>('[role="menu"]');
    assert.ok(menu);
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    assert.ok(items.length);
    assert.equal(document.activeElement, items[0]);
    return items;
  });
  fireEvent.keyDown(items[0], { key: "ArrowDown" });
  assert.equal(document.activeElement, items[1]);
  fireEvent.keyDown(items[1], { key: "End" });
  assert.equal(document.activeElement, items.at(-1));
  fireEvent.keyDown(items.at(-1)!, { key: "Escape" });
  await waitFor(() => assert.equal(view.dom.querySelector('[role="menu"]'), null));
  await waitFor(() => assert.equal(document.activeElement, handle));
  assert.equal(handle.getAttribute("aria-expanded"), "false");
  assert.equal(view.state.doc.toString(), before);
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  await waitFor(() => assert.equal(handle.getAttribute("aria-expanded"), "true"));
  fireEvent.keyDown(handle, { key: "Tab" });
  await waitFor(() => assert.equal(view.dom.querySelector('[role="menu"]'), null));
  await waitFor(() => assert.equal(document.activeElement, handle));
  fireEvent.keyDown(handle, { key: " " });
  await waitFor(() => assert.ok(view.dom.querySelector('[role="menu"]')));
  const deletion = [...view.dom.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === "Delete row",
  );
  assert.ok(deletion);
  deletion.focus();
  fireEvent.keyDown(deletion, { key: "Enter" });
  await waitFor(() =>
    assert.deepEqual(
      sourceRows(view).map((row) => row[0]),
      ["Name", "Alpha", "Gamma"],
    ),
  );
  await waitFor(() => assert.equal(document.activeElement, view.dom.querySelector(".tbl-table")));
  fireEvent.keyDown(document.activeElement!, { key: "z", ctrlKey: true });
  await waitFor(() => assert.equal(view.state.doc.toString(), before));
});

test("table menu DOM work is coalesced across repeated mutation deliveries", async () => {
  const render = vi.fn();
  const batch = createTableMenuRenderBatch(render);

  batch.schedule();
  batch.schedule();
  batch.schedule();
  await Promise.resolve();
  assert.equal(render.mock.calls.length, 1);

  batch.schedule();
  batch.destroy();
  await Promise.resolve();
  assert.equal(render.mock.calls.length, 1);
});

test("an unrelated large-document update does not rerender table cell previews", async () => {
  const rows = [
    ["Name", "Destination", "Detail"],
    ...Array.from({ length: 180 }, (_, index) => [
      `Row ${index}`,
      `[Note ${index}](Notes/Note-${index}.md)`,
      `Detail ${index}`,
    ]),
  ];
  const doc = formattedFixture(rows);
  const markdown = obimMarkdown();
  const renderCell = vi.fn(renderTableCellMarkdown);
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdown, tableExtensions(markdown, { renderCell })],
    }),
  });
  views.push(view);

  await waitFor(() => assert.equal(view.dom.querySelectorAll(".tbl-table-row").length, rows.length));
  renderCell.mockClear();

  view.dispatch({ changes: { from: view.state.doc.length, insert: "\n\nUnrelated trailing prose." } });
  await Promise.resolve();

  assert.equal(renderCell.mock.calls.length, 0);
  assert.equal(view.dom.querySelectorAll(".tbl-table-row").length, rows.length);
  assert.equal(view.state.doc.toString().endsWith("Unrelated trailing prose."), true);
});
