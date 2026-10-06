import assert from "node:assert/strict";

import { cursorCharLeft, cursorCharRight, history, historyKeymap, selectAll } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, test, vi } from "vitest";

import { EmphasisExtension } from "../src/renderer/src/features/editor/extensions/EmphasisExtension";
import { FrontmatterExtension } from "../src/renderer/src/features/editor/extensions/FrontmatterExtension";
import { createImageExtension } from "../src/renderer/src/features/editor/extensions/ImageExtension";
import type { EditorOverlayPort } from "../src/renderer/src/store/editorOverlayStore";
import { isMathBlockLine, MathBlockExtension } from "../src/renderer/src/features/editor/extensions/MathExpression";
import {
  createNoteHeaderExtension,
  requestNoteTitleEditEffect,
} from "../src/renderer/src/features/editor/extensions/NoteHeaderExtension";
import {
  clearOutlineLineHighlightEffect,
  OUTLINE_ACTIVE_LINE_EVENT,
  OutlineNavigationExtension,
  showOutlineLineHighlightEffect,
} from "../src/renderer/src/features/editor/extensions/OutlineNavigationExtension";
import {
  moveDownIntoTargetLine,
  moveUpIntoTargetLine,
} from "../src/renderer/src/features/editor/extensions/shared/lineNavigation";
import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";

installCodeMirrorDomPolyfills();

const views: EditorView[] = [];
const overlay: EditorOverlayPort = { open() {}, close() {}, hotkey() {} };
const ImageExtension = createImageExtension({ owner: "plugin-test", overlay }).extension;

beforeEach(() => {
  vi.stubGlobal("api", {
    doesFileExist: vi.fn(async () => true),
    openFile: vi.fn(async () =>
      JSON.stringify({
        author: "text",
        count: "number",
        date: "date",
        status: "text",
        tags: "list",
        title: "text",
      }),
    ),
    queryWorkspaceProperty: vi.fn(async () => []),
    listWorkspaceFrontmatterFields: vi.fn(async () => []),
    upsertFile: vi.fn(async () => true),
  });
});

function createView(doc: string, extension: Extension, selection = 0) {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: selection },
      extensions: [obimMarkdown(), extension],
    }),
  });
  views.push(view);
  return view;
}

function widgetNamesFrom(view: EditorView, from: number) {
  const names: string[] = [];
  for (const source of view.state.facet(EditorView.decorations)) {
    const decorations = typeof source === "function" ? source(view) : source;
    decorations.between(from, view.state.doc.length, (_from, _to, decoration) => {
      const name = decoration.spec.widget?.constructor.name;
      if (name) names.push(name);
    });
  }
  return names;
}

function decorationSourceForWidget(view: EditorView, widgetName: string) {
  for (const source of view.state.facet(EditorView.decorations)) {
    const decorations = typeof source === "function" ? source(view) : source;
    let found = false;
    decorations.between(0, view.state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget?.constructor.name === widgetName) found = true;
    });
    if (found) return decorations;
  }
  assert.fail(`Expected ${widgetName} decorations`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

function walkCaret(view: EditorView, assertAt: (position: number) => void) {
  for (let position = 0; position <= view.state.doc.length; position += 1) {
    assert.equal(view.state.selection.main.head, position);
    assertAt(position);
    if (position < view.state.doc.length) assert.equal(cursorCharRight(view), true);
  }

  for (let position = view.state.doc.length; position >= 0; position -= 1) {
    assert.equal(view.state.selection.main.head, position);
    assertAt(position);
    if (position > 0) assert.equal(cursorCharLeft(view), true);
  }
}

test("the decoration plugin rebuilds syntax while ArrowRight and ArrowLeft cross it", () => {
  const doc = "x **bold** y";
  const syntaxFrom = doc.indexOf("**bold**");
  const syntaxTo = syntaxFrom + "**bold**".length;
  const view = createView(doc, EmphasisExtension);
  const syntaxIsVisible = () => view.dom.querySelectorAll(".cm-formatting-emphasis-mark").length === 2;

  walkCaret(view, (position) => {
    assert.equal(syntaxIsVisible(), position >= syntaxFrom && position <= syntaxTo);
  });
});

test("ArrowRight and ArrowLeft visit every position through an image widget", async () => {
  const doc = "before ![alt](image.png) after";
  const imageFrom = doc.indexOf("![");
  const imageTo = imageFrom + "![alt](image.png)".length;
  const view = createView(doc, ImageExtension);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  walkCaret(view, (position) => {
    const isActive = position >= imageFrom && position <= imageTo;
    assert.equal(view.dom.querySelectorAll(".cm-formatting-image-mark").length === 3, isActive);
    assert.equal(Boolean(view.dom.querySelector(".cm-image-widget")), !isActive);
  });
});

test("ArrowRight and ArrowLeft visit every position through an inline math widget", async () => {
  const doc = "before $x + 1$ after";
  const mathFrom = doc.indexOf("$");
  const mathTo = doc.lastIndexOf("$") + 1;
  const view = createView(doc, MathBlockExtension);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  walkCaret(view, (position) => {
    const isActive = position >= mathFrom && position <= mathTo;
    assert.equal(view.dom.querySelectorAll(".cm-formatting-math-mark").length === 2, isActive);
    assert.equal(Boolean(view.dom.querySelector(".cm-math-widget-inline")), !isActive);
  });
});

test("ArrowRight and ArrowLeft visit every position through a block math widget", async () => {
  const doc = "before\n$$\nx + 1\n$$\nafter";
  const mathFrom = doc.indexOf("$$");
  const mathTo = doc.lastIndexOf("$$") + 2;
  const view = createView(doc, MathBlockExtension);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  walkCaret(view, (position) => {
    const isActive = position >= mathFrom && position <= mathTo;
    assert.equal(view.dom.querySelectorAll(".cm-formatting-math-mark").length === 2, isActive);
    assert.equal(Boolean(view.dom.querySelector(".cm-math-widget-block:not(.cm-math-widget-live-preview)")), !isActive);
  });
});

test("math block replacements stay bounded to the viewport after ordinary edits", () => {
  const doc = `$$\nfirst\n$$\n${"ordinary paragraph\n".repeat(400)}$$\nlast\n$$`;
  const view = createView(doc, MathBlockExtension);
  const lastBlock = () => view.state.doc.toString().lastIndexOf("$$\nlast");

  assert.deepEqual(widgetNamesFrom(view, lastBlock()), []);

  view.dispatch({ changes: { from: doc.indexOf("ordinary"), insert: "edited " } });

  assert.deepEqual(widgetNamesFrom(view, lastBlock()), []);
});

test("vertical movement enters collapsed block math from both directions", async () => {
  const doc = "\n$$\nx + 1\n$$\n";
  const view = createView(doc, MathBlockExtension);
  const moveToLine = (lineNumber: number) => (movingView: EditorView) => {
    const line = movingView.state.doc.line(lineNumber);
    movingView.dispatch({ selection: { anchor: Math.min(line.to, line.from + 2) } });
    return true;
  };

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.ok(view.dom.querySelector(".cm-math-widget-block"));

  assert.equal(moveDownIntoTargetLine(view, isMathBlockLine, moveToLine(5)), true);
  assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, 2);
  assert.equal(view.dom.querySelectorAll(".cm-formatting-math-mark").length, 2);

  view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
  assert.ok(view.dom.querySelector(".cm-math-widget-block"));

  assert.equal(moveUpIntoTargetLine(view, isMathBlockLine, moveToLine(1)), true);
  assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, 4);
  assert.equal(view.dom.querySelectorAll(".cm-formatting-math-mark").length, 2);
});

test("the note header keeps supported frontmatter behind note details", async () => {
  const user = userEvent.setup();
  const doc = "---\ntags: [one, two]\ndate: 2026-07-14\n---\nbody";
  const body = doc.indexOf("body");
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension("Meeting notes")], body);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  assert.match(syntaxTree(view.state).toString(), /Frontmatter/);
  assert.equal(view.dom.querySelector(".cm-note-header-title")?.textContent, "Meeting notes");
  assert.deepEqual(
    Array.from(view.dom.querySelectorAll(".note-details-summary-tag"), (tag) => tag.textContent),
    ["one", "two"],
  );
  const disclosure = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Show note details']");
  assert.ok(disclosure);
  assert.equal(disclosure.getAttribute("aria-expanded"), "false");
  await user.click(disclosure);
  assert.deepEqual(
    Array.from(
      view.dom.querySelectorAll(".note-details-key"),
      (key) => key.querySelector<HTMLInputElement>(".note-details-property-key-input")?.value ?? key.textContent,
    ),
    ["tags", "date"],
  );
  view.dispatch({ selection: { anchor: doc.length } });
  view.dom.querySelector<HTMLButtonElement>("button[aria-label='Hide note details']")?.focus();
  await user.keyboard("{Escape}");
  assert.equal(view.state.selection.main.head, doc.length);
  assert.equal(document.activeElement, view.contentDOM);
  assert.ok(view.dom.querySelector("button[aria-label='Show note details']"));
  await user.keyboard("{ArrowUp}");
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.ok(view.dom.querySelector("button[aria-label='Hide note details']"));
  assert.equal(document.activeElement, view.dom.querySelector(".note-details-actions button"));
  await user.keyboard("{ArrowDown}");
  assert.equal(view.state.selection.main.head, doc.length);
  assert.equal(document.activeElement, view.contentDOM);
  assert.ok(view.dom.querySelector("button[aria-label='Show note details']"));
  assert.doesNotMatch(view.contentDOM.textContent ?? "", /tags: \[one, two\]/);
  assert.match(view.contentDOM.textContent ?? "", /body/);
  assert.deepEqual(widgetNamesFrom(view, 0), ["NoteHeaderWidget"]);

  view.dispatch({ selection: { anchor: doc.indexOf("one") } });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.equal(view.state.selection.main.head, body);
  assert.doesNotMatch(view.contentDOM.textContent ?? "", /tags: \[one, two\]/);
  assert.equal(view.dom.querySelector(".cm-note-header-title")?.textContent, "Meeting notes");
  assert.ok(view.dom.querySelector("[aria-label='Note details']"));

  view.dispatch({ selection: { anchor: 0 } });
  assert.equal(view.state.selection.main.head, body);

  view.dispatch({ selection: { anchor: body } });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.doesNotMatch(view.contentDOM.textContent ?? "", /tags: \[one, two\]/);
  assert.ok(view.dom.querySelector("[aria-label='Note details']"));
});

test("Edit YAML is available only from expanded note details", async () => {
  const user = userEvent.setup();
  const doc = "---\nstatus: draft\n---\nbody";
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension()], doc.length);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.equal(screen.queryByRole("button", { name: "Edit YAML" }), null);

  await user.click(screen.getByRole("button", { name: "Show note details" }));
  const editYaml = screen.getByRole("button", { name: "Edit YAML" });
  await user.click(editYaml);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  assert.equal(view.state.selection.main.head, doc.indexOf("status: draft"));
  assert.match(view.contentDOM.textContent ?? "", /status: draft/);
  assert.equal(view.dom.querySelector(".cm-frontmatter-source-only"), null);
  assert.ok(screen.getByRole("button", { name: "Done" }));
  const draft = view.state.doc.toString().indexOf("draft");
  view.dispatch({ changes: { from: draft, to: draft + 5, insert: "published" }, userEvent: "input.type" });
  assert.match(view.state.doc.toString(), /status: published/);

  await user.click(screen.getByRole("button", { name: "Done" }));
  assert.doesNotMatch(view.contentDOM.textContent ?? "", /status: published/);
  assert.ok(screen.getByRole("button", { name: "Edit YAML" }));
});

test("select all selects the visible body while preserving hidden frontmatter", () => {
  const doc = "---\nstatus: draft\n---\nbody";
  const view = createView(doc, FrontmatterExtension, doc.length);

  assert.equal(selectAll(view), true);
  assert.equal(view.state.selection.main.from, doc.indexOf("body"));
  assert.equal(view.state.selection.main.to, doc.length);
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "body");
});

test("typing an opening frontmatter fence starts the note-details field workflow", async () => {
  const user = userEvent.setup();
  const view = createView("", [createNoteHeaderExtension(), FrontmatterExtension]);

  view.focus();
  await user.keyboard("---");
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  assert.equal(view.state.doc.toString(), "---\n---\n");
  assert.doesNotMatch(view.contentDOM.textContent ?? "", /---/);
  assert.ok(view.dom.querySelector("button[aria-label='Hide note details']"));
  assert.equal(document.activeElement?.getAttribute("aria-label"), "New field name");
});

test("pasted complete frontmatter is adopted without rewriting it", async () => {
  const frontmatter = "---\nauthor: Ada\n---\n";
  const view = createView("Body", [FrontmatterExtension, createNoteHeaderExtension()]);

  view.dispatch({ changes: { from: 0, insert: frontmatter }, userEvent: "input.paste" });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  assert.equal(view.state.doc.toString(), `${frontmatter}Body`);
  assert.doesNotMatch(view.contentDOM.textContent ?? "", /author: Ada/);
  assert.match(view.dom.querySelector(".note-details-summary")?.textContent ?? "", /1 field/);
  assert.ok(view.dom.querySelector("button[aria-label='Show note details']"));
});

test("the note title leads the object bar and the type selector writes only the task type", async () => {
  const user = userEvent.setup();
  const renameTitle = vi.fn(async () => true);
  const view = createView("", createNoteHeaderExtension("Agency meeting", renameTitle));

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const selector = screen.getByRole("button", { name: "Note type: Note" });
  const title = view.dom.querySelector(".cm-note-header-title");
  assert.equal(title?.textContent, "Agency meeting");
  const renameButton = screen.getByRole("button", { name: "Rename Agency meeting" });
  const titleText = renameButton.firstChild;
  assert.ok(titleText);
  const caretRangeFromPoint = Object.getOwnPropertyDescriptor(document, "caretRangeFromPoint");
  Object.defineProperty(document, "caretRangeFromPoint", {
    configurable: true,
    value: () => ({ startContainer: titleText, startOffset: 6 }),
  });
  await user.click(renameButton);
  if (caretRangeFromPoint) Object.defineProperty(document, "caretRangeFromPoint", caretRangeFromPoint);
  else Reflect.deleteProperty(document, "caretRangeFromPoint");
  const titleInput = screen.getByRole<HTMLInputElement>("textbox", { name: "Rename Agency meeting" });
  assert.equal(title?.querySelector("input"), titleInput);
  assert.equal(titleInput.selectionStart, 6);
  assert.equal(titleInput.selectionEnd, 6);
  assert.equal(renameTitle.mock.calls.length, 0);
  await user.clear(titleInput);
  await user.type(titleInput, "Renamed meeting{Enter}");
  await vi.waitFor(() => assert.deepEqual(renameTitle.mock.calls, [["Renamed meeting"]]));
  assert.equal(screen.queryByRole("textbox", { name: "Rename Agency meeting" }), null);
  assert.equal(title?.nextElementSibling, selector.closest(".cm-note-header-bar"));
  assert.ok(selector.closest(".cm-note-header-bar"));
  assert.ok(view.dom.querySelector(".cm-note-header-details"));
  assert.ok(selector.classList.contains("h-7"));
  assert.equal(selector.querySelector(".cm-note-header-type-main")?.textContent, "Note");
  assert.equal(selector.querySelector(".cm-note-header-type-chevron"), null);

  await user.click(selector);
  const taskItem = screen.getByRole("menuitemradio", { name: "Task" });
  const typeMenu = taskItem.closest<HTMLElement>("[role='menu']");
  assert.ok(typeMenu?.classList.contains("p-1"));
  assert.ok(taskItem.classList.contains("py-1.5"));
  assert.ok(taskItem.classList.contains("px-2"));
  assert.ok(taskItem.classList.contains("gap-1.5"));
  assert.equal(taskItem.getAttribute("aria-checked"), "false");
  await user.click(taskItem);
  assert.match(view.state.doc.toString(), /type: task/);
  assert.ok(screen.getByRole("button", { name: "Note type: Task" }));

  await user.click(screen.getByRole("button", { name: "Note type: Task" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Note" }));
  assert.doesNotMatch(view.state.doc.toString(), /type:/);
  assert.ok(screen.getByRole("button", { name: "Note type: Note" }));
});

test("the note title accepts a filename change when focus leaves the input", async () => {
  const user = userEvent.setup();
  const renameTitle = vi.fn(async () => true);
  createView("", createNoteHeaderExtension("Agency meeting", renameTitle));

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await user.click(screen.getByRole("button", { name: "Rename Agency meeting" }));
  const titleInput = screen.getByRole<HTMLInputElement>("textbox", { name: "Rename Agency meeting" });
  await user.clear(titleInput);
  await user.type(titleInput, "Renamed on blur");
  await user.tab();

  await vi.waitFor(() => assert.deepEqual(renameTitle.mock.calls, [["Renamed on blur"]]));
  assert.equal(screen.queryByRole("textbox", { name: "Rename Agency meeting" }), null);
});

test("a requested note-title edit selects the complete filename", async () => {
  const renameTitle = vi.fn(async () => true);
  const requestStarted = vi.fn();
  const view = createView("", createNoteHeaderExtension("Untitled 1", renameTitle, requestStarted));

  view.dispatch({ effects: requestNoteTitleEditEffect.of(1) });
  await vi.waitFor(() => assert.ok(screen.getByRole("textbox", { name: "Rename Untitled 1" })));

  const titleInput = screen.getByRole<HTMLInputElement>("textbox", { name: "Rename Untitled 1" });
  assert.equal(document.activeElement, titleInput);
  assert.equal(titleInput.selectionStart, 0);
  assert.equal(titleInput.selectionEnd, titleInput.value.length);
  assert.equal(requestStarted.mock.calls.length, 1);
});

test("accepting a requested note-title edit places the caret in the note body", async () => {
  const user = userEvent.setup();
  const renameTitle = vi.fn(async () => true);
  const view = createView("", createNoteHeaderExtension("Untitled 1", renameTitle));

  view.dispatch({ effects: requestNoteTitleEditEffect.of(1) });
  const titleInput = await screen.findByRole<HTMLInputElement>("textbox", { name: "Rename Untitled 1" });
  await user.clear(titleInput);
  await user.type(titleInput, "Project brief{Enter}");

  await vi.waitFor(() => assert.deepEqual(renameTitle.mock.calls, [["Project brief"]]));
  await vi.waitFor(() => assert.equal(view.hasFocus, true));
  assert.equal(view.state.selection.main.head, 0);
});

test("ArrowUp from the first body line enters and opens note details", async () => {
  const user = userEvent.setup();
  const doc = "---\nstatus: draft\n---\nbody\nsecond line";
  const body = doc.indexOf("body");
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension()], body + 2);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const disclosure = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Show note details']");
  assert.ok(disclosure);

  view.focus();
  assert.equal(document.activeElement, view.contentDOM);
  await user.keyboard("{ArrowUp}");
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.ok(view.dom.querySelector("button[aria-label='Hide note details']"));
  assert.equal(document.activeElement, view.dom.querySelector(".note-details-actions button"));

  await user.keyboard("{ArrowDown}");
  assert.ok(view.dom.querySelector("button[aria-label='Show note details']"));
  assert.equal(document.activeElement, view.contentDOM);
  assert.equal(view.state.selection.main.head, body + 2);

  await user.keyboard("{ArrowUp}");
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.ok(view.dom.querySelector("button[aria-label='Hide note details']"));
  assert.equal(document.activeElement, view.dom.querySelector(".note-details-actions button"));

  await user.keyboard("{ArrowUp}");
  const statusRow = view.dom.querySelector<HTMLElement>("[data-property-key='status']");
  assert.equal(document.activeElement, statusRow);
  await user.keyboard("{Enter}");
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Edit status value");

  disclosure.focus();
  await user.keyboard("{Escape}");
  assert.equal(document.activeElement, view.contentDOM);
});

test("ArrowUp visits visible blank body lines before entering note details", async () => {
  const user = userEvent.setup();
  const doc = "---\nstatus: draft\n---\n\n\nbody";
  const body = doc.indexOf("body");
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension()], body);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const arrowUp = view.state
    .facet(keymap)
    .flat()
    .find((binding) => binding.key === "ArrowUp")?.run;
  assert.ok(arrowUp);

  assert.equal(arrowUp(view), false);
  assert.ok(view.dom.querySelector("button[aria-label='Show note details']"));

  view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
  view.focus();
  await user.keyboard("{ArrowUp}");
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.ok(view.dom.querySelector("button[aria-label='Hide note details']"));
});

test("ArrowUp stays in a wrapped visual row on the first body line", async () => {
  const user = userEvent.setup();
  const doc = "first body line that wraps";
  const view = createView(doc, createNoteHeaderExtension(), 20);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const disclosure = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Show note details']");
  assert.ok(disclosure);
  vi.spyOn(view, "moveToLineBoundary").mockReturnValue(EditorSelection.cursor(5));

  view.focus();
  await user.keyboard("{ArrowUp}");

  assert.equal(document.activeElement, view.contentDOM);
  assert.notEqual(document.activeElement, disclosure);
});

test("ArrowUp enters note details from any column of an unwrapped first body line", async () => {
  const user = userEvent.setup();
  const doc = "first body line";
  const view = createView(doc, createNoteHeaderExtension(), 10);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const disclosure = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Show note details']");
  assert.ok(disclosure);
  vi.spyOn(view, "moveToLineBoundary").mockReturnValue(EditorSelection.cursor(0));

  view.focus();
  await user.keyboard("{ArrowUp}");
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  assert.ok(view.dom.querySelector("button[aria-label='Hide note details']"));
  assert.equal(document.activeElement?.getAttribute("aria-label"), "New field name");
});

test("typed note-detail edits update the owning editor", async () => {
  const user = userEvent.setup();
  const doc = "---\nstatus: draft\n---\nbody";
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension()], doc.length);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const disclosure = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Show note details']");
  assert.ok(disclosure);
  await user.click(disclosure);

  const status = view.dom.querySelector<HTMLInputElement>("input[aria-label='Edit status value']");
  assert.ok(status);
  await user.clear(status);
  await user.type(status, "published{Enter}");

  assert.match(view.state.doc.toString(), /status: published/);
  assert.doesNotMatch(view.contentDOM.textContent ?? "", /status: published/);
});

test("removed list tokens participate in editor undo history", async () => {
  const user = userEvent.setup();
  const doc = "---\ntags: [research, history]\n---\nbody";
  const view = createView(doc, [
    history(),
    keymap.of(historyKeymap),
    FrontmatterExtension,
    createNoteHeaderExtension(),
  ]);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await user.click(screen.getByRole("button", { name: "Show note details" }));
  await user.click(screen.getByRole("button", { name: "Remove research" }));
  assert.doesNotMatch(view.state.doc.toString(), /research/);

  await user.keyboard("{Control>}z{/Control}");
  // Removing a token leaves focus in the list input, which owns its native Undo.
  assert.doesNotMatch(view.state.doc.toString(), /research/);
  const row = view.dom.querySelector<HTMLElement>("[data-property-key='tags']");
  assert.ok(row);
  row.focus();
  assert.equal(document.activeElement, row);
  await user.keyboard("{Control>}z{/Control}");
  assert.match(view.state.doc.toString(), /tags: \[research, history\]/);
});

test("the note header exists for empty notes and keeps its DOM through body edits", async () => {
  const user = userEvent.setup();
  const view = createView("", createNoteHeaderExtension());

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const header = view.dom.querySelector(".cm-note-header");
  assert.equal(header?.querySelector("h1"), null);
  assert.ok(header?.querySelector(".cm-note-header-bar"));
  const disclosure = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Show note details']");
  assert.ok(disclosure);
  await user.click(disclosure);
  assert.ok(view.dom.querySelector("input[aria-label='New field name']"));
  assert.deepEqual(
    Array.from(view.dom.querySelectorAll(".note-details-key"), (key) => key.textContent),
    [""],
  );

  view.dispatch({ changes: { from: 0, insert: "Body" } });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.equal(view.dom.querySelector(".cm-note-header"), header);
  assert.ok(view.dom.querySelector("button[aria-label='Hide note details']"));
});

test("the note header retains its decoration set until rendered header state changes", () => {
  const view = createView("Body", createNoteHeaderExtension());
  const initial = decorationSourceForWidget(view, "NoteHeaderWidget");

  view.dispatch({ selection: { anchor: 2 } });
  assert.strictEqual(decorationSourceForWidget(view, "NoteHeaderWidget"), initial);

  view.dispatch({ changes: { from: view.state.doc.length, insert: " text" } });
  assert.strictEqual(decorationSourceForWidget(view, "NoteHeaderWidget"), initial);

  view.dispatch({ effects: requestNoteTitleEditEffect.of(1) });
  assert.notStrictEqual(decorationSourceForWidget(view, "NoteHeaderWidget"), initial);
});

test("frontmatter widgets stay stable across inert transactions", async () => {
  const user = userEvent.setup();
  const doc = "---\nstatus: draft\n---\nbody";
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension()], doc.length);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const header = view.dom.querySelector(".cm-note-header");
  const disclosure = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Show note details']");
  assert.ok(header);
  assert.ok(disclosure);
  await user.click(disclosure);
  assert.ok(view.dom.querySelector(".note-details-actions"));

  view.dispatch({});
  assert.equal(view.dom.querySelector(".cm-note-header"), header);
});

test("frontmatter diagnostics handle empty and unclosed documents without stealing input", () => {
  const empty = createView("", FrontmatterExtension);
  empty.dispatch({});
  assert.equal(empty.dom.querySelector(".cm-frontmatter-error"), null);

  const unclosed = createView("---\ntitle: [", FrontmatterExtension, 1);
  const diagnostic = unclosed.dom.querySelector<HTMLElement>(".cm-frontmatter-error");
  assert.ok(diagnostic);
  assert.match(diagnostic.textContent ?? "", /missing its closing/i);

  unclosed.dispatch({ selection: { anchor: 2 } });
  assert.equal(unclosed.dom.querySelector(".cm-frontmatter-error"), diagnostic);
  diagnostic.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  assert.equal(unclosed.state.selection.main.head, 2);
});

test("valid nested frontmatter remains visible and editable as source", async () => {
  const doc = "---\ntitle: Example\nauthor:\n  name: Ada\n---\nbody";
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension()], doc.length);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  assert.equal(view.dom.querySelector(".cm-frontmatter-error"), null);
  const sourceOnly = view.dom.querySelector(".cm-frontmatter-source-only");
  assert.equal(sourceOnly?.getAttribute("role"), "status");
  assert.match(sourceOnly?.textContent ?? "", /edit the source directly/i);
  assert.equal(view.dom.querySelector("[aria-label='Note details']"), null);
  assert.match(view.contentDOM.textContent ?? "", /author:.*name:/s);

  const name = doc.indexOf("Ada");
  view.dispatch({ selection: { anchor: name } });
  assert.equal(view.state.selection.main.head, name);
  view.dispatch({ changes: { from: name, to: name + 3, insert: "Grace" }, userEvent: "input.type" });
  assert.match(view.state.doc.toString(), /name: Grace/);
});

test("ArrowUp enters note details only from an empty selection on the first body line", async () => {
  const doc = "---\nstatus: draft\n---\nfirst line\nsecond line";
  const body = doc.indexOf("first line");
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension()], body);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const arrowUp = view.state
    .facet(keymap)
    .flat()
    .find((binding) => binding.key === "ArrowUp")?.run;
  assert.ok(arrowUp);

  view.dispatch({ selection: { anchor: body, head: body + 2 } });
  assert.equal(arrowUp(view), false);

  view.dispatch({ selection: { anchor: doc.indexOf("second line") } });
  assert.equal(arrowUp(view), false);

  view.dispatch({ selection: { anchor: body } });
  view.dom.querySelector(".note-details-disclosure")?.remove();
  assert.equal(arrowUp(view), false);
});

test("the note header edits flow-style frontmatter without normalizing it", async () => {
  const user = userEvent.setup();
  const doc = "---\n{ author: [ Radia Perlman ], status: draft }\n---\nbody";
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension()], doc.length);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.equal(view.dom.querySelector(".cm-frontmatter-error"), null);
  assert.doesNotMatch(view.contentDOM.textContent ?? "", /status: draft/);
  const disclosure = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Show note details']");
  assert.ok(disclosure);
  await user.click(disclosure);
  assert.ok(within(view.dom).getByRole("button", { name: "Add field" }));

  const status = within(view.dom).getByRole("combobox", { name: "Edit status value" });
  await user.clear(status);
  await user.type(status, "published{Enter}");
  assert.match(view.state.doc.toString(), /\{ author: \[ Radia Perlman \], status: published \}/);
});

test("the note header edits a numeric scalar with a number control", async () => {
  const user = userEvent.setup();
  const doc = "---\ncount: 2\n---\n# Body";
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension("Numbers")], doc.length);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  vi.spyOn(view, "requestMeasure").mockImplementation(() => {});
  const disclosure = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Show note details']");
  assert.ok(disclosure);
  await user.click(disclosure);

  const countRow = view.dom.querySelector<HTMLElement>("[data-property-key='count']");
  assert.equal(countRow?.querySelector<HTMLInputElement>("[data-note-details-primary]")?.value, "2");
  assert.ok(view.dom.querySelector("[aria-label='Note details']"));
  assert.equal(view.dom.querySelector(".cm-note-header-title")?.textContent, "Numbers");
});

test("the note header observes animated size changes and releases the observer", async () => {
  const observers: Array<{
    callback: ResizeObserverCallback;
    disconnect: ReturnType<typeof vi.fn>;
    observe: ReturnType<typeof vi.fn>;
  }> = [];

  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: ResizeObserverCallback;
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
    },
  );

  const view = createView("Body", createNoteHeaderExtension());
  const requestMeasure = vi.spyOn(view, "requestMeasure").mockImplementation(() => {});
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  requestMeasure.mockClear();

  const observesHeaderRoot = ({ observe }: (typeof observers)[number]) =>
    (observe.mock.calls[0]?.[0] as HTMLElement | undefined)?.firstElementChild?.classList.contains("cm-note-header") ??
    false;
  const headerObserver = observers.find(observesHeaderRoot);
  assert.ok(headerObserver);
  assert.equal(headerObserver.observe.mock.calls.length, 1);
  headerObserver.callback([], headerObserver as unknown as ResizeObserver);
  assert.equal(requestMeasure.mock.calls.length, 1);

  view.dispatch({ changes: { from: view.state.doc.length, insert: " edited" } });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assert.equal(observers.filter(observesHeaderRoot).length, 1);

  const parent = view.dom.parentElement;
  views.splice(views.indexOf(view), 1);
  view.destroy();
  parent?.remove();
  assert.equal(headerObserver.disconnect.mock.calls.length, 1);
});

test("frontmatter is atomic and selections cannot enter its source", () => {
  const doc = "---\ntitle: Test\n---\nbody";
  const body = doc.indexOf("body");
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension()]);
  assert.doesNotMatch(view.contentDOM.textContent ?? "", /title: Test/);

  assert.equal(cursorCharRight(view), true);
  assert.equal(view.state.selection.main.head, body);
  assert.equal(cursorCharLeft(view), true);
  assert.equal(view.state.selection.main.head, body);

  view.dispatch({ selection: { anchor: doc.indexOf("Test") } });
  assert.equal(view.state.selection.main.head, body);
  assert.doesNotMatch(view.contentDOM.textContent ?? "", /title: Test/);

  view.dispatch({
    changes: { from: doc.indexOf("Test"), to: doc.indexOf("Test") + 4, insert: "Lost" },
    userEvent: "input.type",
  });
  assert.equal(view.state.doc.toString(), doc);

  view.dispatch({ changes: { from: body, insert: "Editable " }, userEvent: "input.type" });
  assert.equal(view.state.doc.toString(), `${doc.slice(0, body)}Editable body`);
});

test("focusing a document cannot leave the caret hidden inside managed frontmatter", () => {
  const doc = "---\ntitle: Test\n---\nbody";
  const body = doc.indexOf("body");
  const view = createView(doc, FrontmatterExtension);

  assert.equal(view.state.selection.main.head, 0);
  view.focus();

  assert.equal(view.state.selection.main.head, body);
});

test("managed frontmatter preserves an editable line when the note body is empty", () => {
  const doc = "---\nstatus: open\ntags: [editor]\n---\n";
  const view = createView(doc, FrontmatterExtension);

  view.focus();

  assert.equal(view.state.selection.main.head, doc.length);
  assert.ok(view.contentDOM.querySelector(".cm-line"));
  assert.doesNotMatch(view.contentDOM.textContent ?? "", /status: open|tags:/);
});

test("flow-style frontmatter is atomic and selections cannot enter its source", () => {
  const doc = "---\n{ title: Test }\n---\nbody";
  const body = doc.indexOf("body");
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension()]);

  view.dispatch({ selection: { anchor: doc.indexOf("Test") } });
  assert.equal(view.state.selection.main.head, body);
  view.dispatch({
    changes: { from: doc.indexOf("Test"), to: doc.indexOf("Test") + 4, insert: "Lost" },
    userEvent: "input.type",
  });
  assert.equal(view.state.doc.toString(), doc);
});

test("invalid frontmatter keeps the title, remains raw, and reports its diagnostic", async () => {
  const doc = "---\ntitle: [\n---\nbody";
  const view = createView(doc, [FrontmatterExtension, createNoteHeaderExtension("Broken details")], doc.length);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const diagnostic = view.dom.querySelector(".cm-frontmatter-error");
  assert.equal(diagnostic?.getAttribute("role"), "alert");
  assert.match(diagnostic?.textContent ?? "", /fix note details.*(?:flow sequence|unexpected)/i);
  assert.match(view.contentDOM.textContent ?? "", /title:/);
  assert.equal(view.dom.querySelector(".cm-note-header-title")?.textContent, "Broken details");
  assert.equal(view.dom.querySelector("[aria-label='Note details']"), null);

  const arrowUp = view.state
    .facet(keymap)
    .flat()
    .find((binding) => binding.key === "ArrowUp")?.run;
  assert.ok(arrowUp);
  assert.equal(arrowUp(view), false);
});

test("outline highlighting maps through edits and ignores stale clear effects", () => {
  const doc = "first\nsecond\nthird";
  const token = 7;
  const view = createView(doc, OutlineNavigationExtension);

  view.dispatch({ effects: showOutlineLineHighlightEffect.of({ from: doc.indexOf("second") + 2, token }) });
  assert.equal(view.dom.querySelector(".cm-outline-target-line")?.textContent, "second");

  view.dispatch({ changes: { from: 0, insert: "before\n" } });
  assert.equal(view.dom.querySelector(".cm-outline-target-line")?.textContent, "second");

  view.dispatch({ effects: clearOutlineLineHighlightEffect.of(token + 1) });
  assert.ok(view.dom.querySelector(".cm-outline-target-line"));

  view.dispatch({ effects: clearOutlineLineHighlightEffect.of(token) });
  assert.equal(view.dom.querySelector(".cm-outline-target-line"), null);
});

test("outline active-line events publish only when focus or the active line changes", () => {
  const view = createView("first\nsecond\nthird", OutlineNavigationExtension);
  const listener = vi.fn();
  window.addEventListener(OUTLINE_ACTIVE_LINE_EVENT, listener);

  try {
    view.focus();
    assert.equal(listener.mock.calls.length, 1);
    listener.mockClear();

    view.dispatch({ selection: { anchor: 2 } });
    view.dispatch({ changes: { from: 0, insert: "x" } });
    assert.equal(listener.mock.calls.length, 0);

    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    assert.equal(listener.mock.calls.length, 1);
    listener.mockClear();

    view.dispatch({ changes: { from: 0, insert: "\n" } });
    assert.equal(listener.mock.calls.length, 1);
  } finally {
    window.removeEventListener(OUTLINE_ACTIVE_LINE_EVENT, listener);
  }
});
