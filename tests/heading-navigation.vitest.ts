import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "../src/renderer/src/features/editor/codemirror-state";
import { EditorView } from "../src/renderer/src/features/editor/codemirror-view";
import { headingLineForFragment, navigateToHeading } from "../src/renderer/src/features/editor/headingNavigation";
import { OutlineNavigationExtension } from "../src/renderer/src/features/editor/extensions/OutlineNavigationExtension";

import { getHeadingTargets } from "../src/renderer/src/shared/markdownHeadingTargets";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("same-note heading links", () => {
  it("matches ATX and setext headings while excluding code blocks", () => {
    const source = "# Note\n\n```md\n## Tasks\n```\n\n## Tasks\n\nDetails\n-------";
    expect(headingLineForFragment(source, "#tasks")).toBe(7);
    expect(headingLineForFragment(source, "#details")).toBe(9);
    expect(headingLineForFragment(source, "#missing")).toBeNull();
  });
  it("handles formatted headings, Unicode fragments and repeated headings", () => {
    const source = "## **Tasks** & [Notes](./Notes.md)\n## Café\n## Tasks\n## Tasks\n## Tasks-1\n## Tasks";
    expect(headingLineForFragment(source, "#tasks--notes")).toBe(1);
    expect(headingLineForFragment(source, "#caf%C3%A9")).toBe(2);
    expect(headingLineForFragment(source, "#tasks-1")).toBe(4);
    expect(headingLineForFragment(source, "#tasks-2")).toBe(6);
    expect(headingLineForFragment(source, "#%broken")).toBeNull();
    expect(headingLineForFragment(source, "#")).toBe(1);
  });
  it("moves the caret and highlights the destination without changing note contents", () => {
    vi.useFakeTimers();
    const source = "[Jump to tasks](#tasks)\n\n## Tasks\n- [ ] Example";
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: source, extensions: [OutlineNavigationExtension] }),
    });
    expect(navigateToHeading(view, "#tasks")).toBe(true);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from);
    expect(view.dom.querySelector(".cm-outline-target-line")?.textContent).toBe("## Tasks");
    expect(view.state.doc.toString()).toBe(source);
    expect(navigateToHeading(view, "#missing")).toBe(false);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from);
  });
});

it("uses the same unique targets for search and navigation, excluding frontmatter", () => {
  const source = "---\ntitle: Note\n---\n# !!!\n# Café\n# Café\n# Long heading\n";
  const targets = getHeadingTargets(source);
  expect(targets.map(({ fragment }) => fragment)).toEqual(["#section", "#caf%C3%A9", "#caf%C3%A9-1", "#long-heading"]);
  for (const target of targets) expect(headingLineForFragment(source, target.fragment)).toBe(target.line);
  expect(headingLineForFragment(source, "#Long%20heading")).toBe(7);
});
