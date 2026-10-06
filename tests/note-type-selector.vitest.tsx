import assert from "node:assert/strict";

import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, test, vi } from "vitest";

import { FrontmatterExtension } from "../src/renderer/src/features/editor/extensions/FrontmatterExtension";
import { createNoteHeaderExtension } from "../src/renderer/src/features/editor/extensions/NoteHeaderExtension";
import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";
import { createNoteDetailsApi } from "./note-details-test-harness";

installCodeMirrorDomPolyfills();
beforeEach(() => vi.stubGlobal("api", createNoteDetailsApi()));

const views: EditorView[] = [];

const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const createView = (doc: string, extra: Extension = []) => {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [obimMarkdown(), FrontmatterExtension, createNoteHeaderExtension(), extra],
    }),
  });
  views.push(view);
  return view;
};

const destroyView = (view: EditorView) => {
  views.splice(views.indexOf(view), 1);
  const parent = view.dom.parentElement;
  view.destroy();
  parent?.remove();
};

const typeButton = (view: EditorView, label: "Clipped note" | "Note" | "Task") =>
  within(view.dom).getByRole("button", { name: `Note type: ${label}` });

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
  await Promise.resolve();
});

test("treats legacy clipped notes as ordinary Markdown without rewriting their type", async () => {
  const user = userEvent.setup();
  const view = createView("---\ntype: clipped-note\npdf: Papers/report.pdf\n---\nBody");
  await settle();

  await user.click(typeButton(view, "Note"));
  assert.equal(screen.queryByRole("menuitemradio", { name: "Clipped note" }), null);
  await user.click(screen.getByRole("menuitemradio", { name: "Note" }));

  assert.match(view.state.doc.toString(), /^type: clipped-note$/m);
  assert.match(view.state.doc.toString(), /^pdf: Papers\/report\.pdf$/m);
  assert.ok(typeButton(view, "Note"));
});

test("shows Task only for the exact value and otherwise falls back to Note", async () => {
  const cases = [
    ["Body", "Note"],
    ["---\ntype: task\n---\nBody", "Task"],
    ["---\ntype: note\n---\nBody", "Note"],
    ["---\ntype: journal\n---\nBody", "Note"],
    ["---\ntype: task # authored context\n---\nBody", "Task"],
    ["---\nType: task\n---\nBody", "Note"],
  ] as const;

  for (const [doc, label] of cases) {
    const view = createView(doc);
    await settle();
    assert.ok(typeButton(view, label));
    destroyView(view);
    await Promise.resolve();
  }
});

test("uses keyboard radio-menu behavior for Note and Task", async () => {
  const user = userEvent.setup();
  const view = createView("Body");
  await settle();

  const trigger = typeButton(view, "Note");
  trigger.focus();
  await user.keyboard("{Enter}");

  const note = screen.getByRole("menuitemradio", { name: "Note" });
  const task = screen.getByRole("menuitemradio", { name: "Task" });
  assert.equal(note.getAttribute("aria-checked"), "true");
  assert.equal(task.getAttribute("aria-checked"), "false");

  await user.keyboard("{ArrowDown}{Enter}");
  assert.match(view.state.doc.toString(), /type: task/);
  assert.ok(typeButton(view, "Task"));

  typeButton(view, "Task").focus();
  await user.keyboard("{Enter}{Home}{Enter}");
  assert.doesNotMatch(view.state.doc.toString(), /type:/);
  assert.ok(typeButton(view, "Note"));
});

test("replaces a fallback value through the ordinary Note to Task transition", async () => {
  const user = userEvent.setup();
  const view = createView("---\ntype: journal # keep\n---\nBody");
  await settle();

  await user.click(typeButton(view, "Note"));
  assert.equal(screen.getByRole("menuitemradio", { name: "Note" }).getAttribute("aria-checked"), "true");
  assert.equal(screen.queryByRole("menuitemradio", { name: "Custom" }), null);
  await user.click(screen.getByRole("menuitemradio", { name: "Task" }));
  assert.match(view.state.doc.toString(), /type: task # keep/);
  assert.ok(typeButton(view, "Task"));
});

test("leaves an authored fallback value untouched while Note remains selected", async () => {
  const user = userEvent.setup();
  const view = createView("---\ntype: note\n---\nBody");
  await settle();

  await user.click(typeButton(view, "Note"));
  assert.equal(screen.getByRole("menuitemradio", { name: "Note" }).getAttribute("aria-checked"), "true");
  assert.match(view.state.doc.toString(), /type: note/);
});

test("edits note type and fields in flow-style frontmatter", async () => {
  const user = userEvent.setup();
  const view = createView("---\n{ type: task, author: Ada }\n---\nBody");
  await settle();

  assert.ok(typeButton(view, "Task"));
  assert.ok(within(view.dom).getByRole("group", { name: "Note details" }));

  await user.click(typeButton(view, "Task"));
  await user.click(screen.getByRole("menuitemradio", { name: "Note" }));
  assert.equal(view.state.doc.toString(), "---\n{ author: Ada }\n---\nBody");
  assert.ok(typeButton(view, "Note"));

  await user.click(typeButton(view, "Note"));
  await user.click(screen.getByRole("menuitemradio", { name: "Task" }));
  assert.match(
    view.state.doc.toString(),
    /^---\n\{ author: Ada, type: task, task-status: open, task-created: \d{4}-\d{2}-\d{2} \}\n---\nBody$/,
  );
  assert.ok(typeButton(view, "Task"));
});

test("converts to a task in one body-preserving editor transaction and keeps task metadata dormant", async () => {
  const user = userEvent.setup();
  const updates: number[] = [];
  const source = "---\nauthor: Ada\n---\n# Supporting heading\n\nBody with [[links]] and `code`.";
  const view = createView(
    source,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) updates.push(update.transactions.length);
    }),
  );
  await settle();

  await user.click(typeButton(view, "Note"));
  await user.click(screen.getByRole("menuitemradio", { name: "Task" }));

  const taskSource = view.state.doc.toString();
  assert.deepEqual(updates, [1]);
  assert.match(taskSource, /type: task/);
  assert.match(taskSource, /task-status: open/);
  assert.match(taskSource, /task-created: \d{4}-\d{2}-\d{2}/);
  assert.ok(taskSource.endsWith("# Supporting heading\n\nBody with [[links]] and `code`."));

  await user.click(typeButton(view, "Task"));
  await user.click(screen.getByRole("menuitemradio", { name: "Note" }));

  const noteSource = view.state.doc.toString();
  assert.doesNotMatch(noteSource, /^type: task$/m);
  assert.match(noteSource, /task-status: open/);
  assert.match(noteSource, /task-created: \d{4}-\d{2}-\d{2}/);
  assert.ok(noteSource.endsWith("# Supporting heading\n\nBody with [[links]] and `code`."));
});
