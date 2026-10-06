// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";

import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";

const listBuilds = vi.hoisted(() => ({ count: 0 }));

vi.mock("@renderer/features/editor/extensions/shared/syntaxDecorationPlugin", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@renderer/features/editor/extensions/shared/syntaxDecorationPlugin")>();
  return {
    ...actual,
    createSyntaxDecorationPlugin(
      buildDecorations: Parameters<typeof actual.createSyntaxDecorationPlugin>[0],
      options?: Parameters<typeof actual.createSyntaxDecorationPlugin>[1],
    ) {
      return actual.createSyntaxDecorationPlugin((view) => {
        listBuilds.count += 1;
        return buildDecorations(view);
      }, options);
    },
  };
});

import { obimMarkdown } from "@renderer/features/editor/language";
import { createListsExtension } from "@renderer/features/editor/extensions/ListsExtension";

installCodeMirrorDomPolyfills();

const views: EditorView[] = [];

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("rebuilds large-list decorations at most once and retains visible bullet widgets", () => {
  const list = Array.from({ length: 500 }, (_, index) => `- list item ${index}`).join("\n");
  const trailing = Array.from({ length: 500 }, (_, index) => `Trailing paragraph ${index}.`).join("\n\n");
  const doc = `${list}\n\n${trailing}`;
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [obimMarkdown(), createListsExtension(() => false)],
    }),
  });
  views.push(view);

  const visibleBullets = [...view.dom.querySelectorAll<HTMLElement>(".cm-list-bullet")];
  expect(visibleBullets.length).toBeGreaterThan(0);
  listBuilds.count = 0;

  view.dispatch({ changes: { from: view.state.doc.length, insert: "\n\nA final paragraph." } });

  expect(listBuilds.count).toBeLessThanOrEqual(1);
  expect([...view.dom.querySelectorAll(".cm-list-bullet")]).toEqual(visibleBullets);
  expect(view.state.doc.toString()).toContain("A final paragraph.");
});
