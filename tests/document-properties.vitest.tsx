import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  DocumentProperties,
  updateNoteProperty,
} from "../src/renderer/src/features/editor/inspector/DocumentProperties";
import { FrontmatterExtension } from "../src/renderer/src/features/editor/extensions/FrontmatterExtension";
import { EditorState } from "../src/renderer/src/features/editor/codemirror-state";
import { EditorView } from "../src/renderer/src/features/editor/codemirror-view";
import { parseFrontmatter, getFrontmatterStringList } from "../src/shared/frontmatter";
let view: EditorView | undefined;
afterEach(() => {
  cleanup();
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
});
function mountEditor(doc: string, readOnly = false) {
  const pane = document.createElement("div");
  pane.className = "pane-card-active";
  document.body.append(pane);
  view = new EditorView({
    parent: pane,
    state: EditorState.create({ doc, extensions: [EditorState.readOnly.of(readOnly), FrontmatterExtension] }),
  });
}
it("shows only frontmatter fields in their original order", () => {
  render(
    <DocumentProperties
      text={"---\nauthor: Ada\ntags: [test, sidebar]\nstatus: Draft\ncreated: 2026-09-08\nreviewed: false\n---\n# Note"}
    />,
  );
  expect(screen.getByText("test")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Edit note status" }).textContent).toBe("Draft");
  expect([...document.querySelectorAll("dt")].map((element) => element.textContent)).toEqual([
    "author",
    "tags",
    "status",
    "created",
    "reviewed",
  ]);
  expect(screen.getByText("Ada")).toBeTruthy();
  expect(screen.getByText("2026-09-08")).toBeTruthy();
  expect(screen.getByText("false")).toBeTruthy();
});
it("removes old properties immediately when switching to a plain note", () => {
  const { rerender } = render(<DocumentProperties text={"---\ntags: [old-tag]\n---\n# Old note"} />);
  expect(screen.getByText("old-tag")).toBeTruthy();
  rerender(<DocumentProperties text="# Current note" />);
  expect(screen.queryByText("old-tag")).toBeNull();
  expect(document.querySelectorAll("dt")).toHaveLength(0);
  expect(screen.getByText("No frontmatter properties in this note.")).toBeTruthy();
});
it("edits properties through the editor without changing the body or unrelated YAML", () => {
  const source = "---\ntags: [test, sidebar]\nauthor: Ada # keep this\n---\n# Body";
  mountEditor(source);
  render(<DocumentProperties text={source} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove tag test" }));
  const updated = view!.state.doc.toString();
  expect(getFrontmatterStringList(parseFrontmatter(updated), "tags")).toEqual(["sidebar"]);
  expect(updated).toContain("author: Ada # keep this");
  expect(updated).toContain("# Body");
});
it("creates frontmatter for a plain note and rejects stale or read-only edits", () => {
  mountEditor("# Body");
  expect(updateNoteProperty("# Body", "tags", ["test"])).toBeNull();
  expect(getFrontmatterStringList(parseFrontmatter(view!.state.doc.toString()), "tags")).toEqual(["test"]);
  expect(updateNoteProperty("# Body", "status", "Draft")).toContain("changed");
  view!.destroy();
  document.body.replaceChildren();
  mountEditor("# Body", true);
  expect(updateNoteProperty("# Body", "tags", ["test"])).toContain("editable");
  expect(view!.state.doc.toString()).toBe("# Body");
});
it("shows unsupported YAML from the source without substituting defaults", () => {
  render(<DocumentProperties text={"---\ntags: {nested: value}\n---\n# Body"} />);
  expect(screen.getByText("{nested: value}")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add tag" })).toBeNull();
});

it("adds tags and edits status from the property popovers", () => {
  const source = '---\ntags: []\nstatus: ""\n---\n# Body';
  mountEditor(source);
  const { rerender } = render(<DocumentProperties text={source} />);
  fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Add tag" }), { target: { value: "research" } });
  fireEvent.submit(screen.getByRole("textbox", { name: "Add tag" }).closest("form")!);
  const tagged = view!.state.doc.toString();
  expect(getFrontmatterStringList(parseFrontmatter(tagged), "tags")).toEqual(["research"]);
  rerender(<DocumentProperties text={tagged} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit note status" }));
  fireEvent.change(screen.getByLabelText("Note status"), { target: { value: "Draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(view!.state.doc.toString()).toContain("status: Draft");
  expect(view!.state.doc.toString()).toContain("# Body");
});
