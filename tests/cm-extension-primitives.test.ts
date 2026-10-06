import assert from "node:assert/strict";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { test } from "vitest";

import {
  createBufferedViewport,
  expandViewport,
} from "../src/renderer/src/features/editor/extensions/shared/bufferedViewport";
import {
  ancestorNodeAt,
  blockquoteDepthClass,
  blockquoteMarkerColumns,
  childNode,
  decorationSet,
  directChildren,
  isSyntaxRangeActive,
  iterateVisibleSyntaxTree,
  lastLineInNode,
  pushDecorationRange,
  shouldRebuildSyntaxDecorations,
  visibleDocumentRanges,
  visibleLineSpans,
} from "../src/renderer/src/features/editor/extensions/shared/syntaxDecorationPlugin";
import type { EditorView } from "@codemirror/view";

test("buffered viewport expansion is bounded by the document", () => {
  const options = { minBuffer: 10, maxBuffer: 30, multiplier: 2 };

  assert.deepEqual(expandViewport({ from: 40, to: 50 }, 100, options), { from: 20, to: 70 });
  assert.deepEqual(expandViewport({ from: 2, to: 12 }, 18, options), { from: 0, to: 18 });
});

test("buffered viewport positions map through document changes", () => {
  const viewport = createBufferedViewport({ minBuffer: 10, maxBuffer: 30, multiplier: 2 });
  let state = EditorState.create({ doc: "0123456789", extensions: [viewport.field] });

  state = state.update({ effects: viewport.effect.of({ from: 2, to: 8 }) }).state;
  state = state.update({ changes: { from: 0, insert: "ab" } }).state;
  assert.deepEqual(state.field(viewport.field), { from: 4, to: 10 });

  state = state.update({ changes: { from: 5, to: state.doc.length } }).state;
  assert.deepEqual(state.field(viewport.field), { from: 4, to: 5 });
});

test("syntax helpers traverse both tree nodes and node references", () => {
  const state = EditorState.create({
    doc: "- item",
    extensions: [markdown({ base: markdownLanguage })],
  });
  const tree = syntaxTree(state);
  const bullet = directChildren(tree.topNode, "BulletList")[0];
  const item = directChildren(bullet, "ListItem")[0];
  const paragraph = directChildren(item, "Paragraph")[0];

  assert.ok(childNode(item, "ListMark"));
  assert.equal(childNode(paragraph, "Missing"), null);
  assert.deepEqual(directChildren(paragraph, "Missing"), []);
  assert.equal(ancestorNodeAt(state, state.doc.length, "ListItem")?.name, "ListItem");
  assert.equal(ancestorNodeAt(state, state.doc.length, ["BulletList", "Document"])?.name, "BulletList");
});

test("syntax decoration invalidation observes syntax-tree changes without document changes", () => {
  const startState = EditorState.create({
    doc: "# Heading",
    extensions: [markdown({ base: markdownLanguage })],
  });
  const state = startState.update({ effects: StateEffect.reconfigure.of([]) }).state;

  assert.equal(
    shouldRebuildSyntaxDecorations({
      docChanged: false,
      selectionSet: false,
      viewportChanged: false,
      startState,
      state,
    } as never),
    true,
  );
  assert.equal(
    shouldRebuildSyntaxDecorations({
      docChanged: false,
      selectionSet: false,
      viewportChanged: false,
      startState,
      state: startState,
    } as never),
    false,
  );
});

test("syntax decoration invalidation observes asynchronously completed parse trees", () => {
  const doc = Array.from({ length: 20_000 }, (_, index) => `# heading ${index}`).join("\n");
  const startState = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  });
  const initialTree = syntaxTree(startState);

  assert.ok(initialTree.length < startState.doc.length);
  assert.ok(ensureSyntaxTree(startState, startState.doc.length, 1_000));

  const completedState = startState.update({}).state;
  assert.equal(syntaxTree(completedState).length, completedState.doc.length);
  assert.notEqual(syntaxTree(completedState), initialTree);
  assert.equal(
    shouldRebuildSyntaxDecorations({
      docChanged: false,
      selectionSet: false,
      viewportChanged: false,
      startState,
      state: completedState,
    } as never),
    true,
  );
});

test("syntax range activation observes every selection range", () => {
  const state = EditorState.create({
    doc: "first second",
    selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(8)]),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });

  assert.equal(isSyntaxRangeActive(state, 0, 3), true);
  assert.equal(isSyntaxRangeActive(state, 7, 10), true);
  assert.equal(isSyntaxRangeActive(state, 4, 6), false);
});

test("visible range helpers preserve viewport, visible-range, and empty-range views", () => {
  const state = EditorState.create({ doc: "one\ntwo\nthree" });
  const viewportView = { state, viewport: { from: 4, to: 7 } } as unknown as EditorView;
  const rangesView = {
    state,
    visibleRanges: [
      { from: 8, to: 13 },
      { from: 0, to: 3 },
    ],
  } as unknown as EditorView;
  const emptyView = { state, visibleRanges: [] } as unknown as EditorView;

  assert.deepEqual(visibleDocumentRanges(viewportView), [{ from: 4, to: 7 }]);
  assert.deepEqual(visibleDocumentRanges(rangesView), rangesView.visibleRanges);
  assert.deepEqual(visibleDocumentRanges(emptyView), []);
  assert.deepEqual(visibleLineSpans(viewportView, { from: 0, to: 7 } as never), [
    { first: state.doc.line(2), last: state.doc.line(2) },
  ]);
  assert.deepEqual(visibleLineSpans(viewportView, { from: 8, to: 10 } as never), []);
});

test("visible line spans preserve folded gaps instead of expanding to the whole viewport", () => {
  const state = EditorState.create({ doc: "one\ntwo\nthree\nfour" });
  const view = {
    state,
    viewport: { from: 0, to: state.doc.length },
    visibleRanges: [
      { from: 0, to: 3 },
      { from: 14, to: 18 },
    ],
  } as unknown as EditorView;

  assert.deepEqual(visibleDocumentRanges(view), view.visibleRanges);
  assert.deepEqual(visibleLineSpans(view, { from: 0, to: state.doc.length } as never), [
    { first: state.doc.line(1), last: state.doc.line(1) },
    { first: state.doc.line(4), last: state.doc.line(4) },
  ]);
});

test("visible syntax traversal visits nodes spanning disjoint ranges only once", () => {
  const state = EditorState.create({
    doc: "```ts\none\ntwo\nthree\n```",
    extensions: [markdown({ base: markdownLanguage })],
  });
  const view = {
    state,
    visibleRanges: [
      { from: 0, to: 5 },
      { from: state.doc.length - 3, to: state.doc.length },
    ],
  } as unknown as EditorView;
  const visited: string[] = [];

  iterateVisibleSyntaxTree(view, (node) => {
    visited.push(`${node.name}:${node.from}:${node.to}`);
    if (node.name === "FencedCode") return false;
    return undefined;
  });

  assert.equal(visited.filter((node) => node.startsWith("FencedCode:")).length, 1);
  assert.equal(new Set(visited).size, visited.length);
});

test("decoration helpers discard empty ranges and preserve sorted non-empty ranges", () => {
  const mark = Decoration.mark({ class: "test" });
  const ranges = [];

  pushDecorationRange(ranges, mark, 2, 2);
  pushDecorationRange(ranges, mark, 1, 3);

  assert.equal(decorationSet([]), Decoration.none);
  assert.equal(decorationSet(ranges).size, 1);
});

test("line and blockquote helpers cover trailing newlines and depth limits", () => {
  const state = EditorState.create({ doc: "one\ntwo\n" });
  const view = { state } as unknown as EditorView;

  assert.equal(lastLineInNode(view, { from: 0, to: 4 } as never).number, 2);
  assert.equal(lastLineInNode(view, { from: 0, to: 3 } as never).number, 1);
  assert.equal(blockquoteMarkerColumns("plain"), 0);
  assert.equal(blockquoteMarkerColumns("  > > text"), 6);
  assert.equal(blockquoteDepthClass(9), "cm-blockquote-depth-4");
});
