import { afterEach, beforeAll, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorState } from "../src/renderer/src/features/editor/codemirror-state";
import { EditorView } from "../src/renderer/src/features/editor/codemirror-view";
import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import { getMarkdownSidebarInfo } from "../src/renderer/src/features/editor/inspector/documentInfo";
import { NoteTasks, toggleInspectorTask } from "../src/renderer/src/features/editor/inspector/NoteTasks";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";
beforeAll(installCodeMirrorDomPolyfills);
let view: EditorView;
afterEach(() => {
  cleanup();
  view?.destroy();
  document.body.replaceChildren();
});
const mountEditor = (doc: string, readOnly = false) => {
  const pane = document.createElement("div");
  pane.className = "pane-card-active";
  document.body.append(pane);
  view = new EditorView({
    parent: pane,
    state: EditorState.create({ doc, extensions: [obimMarkdown(), EditorState.readOnly.of(readOnly)] }),
  });
};
it("navigates to a nested task from its text and row without changing completion", () => {
  const doc = "- [ ] Parent\n  - [ ] Child\n- [x] Sibling";
  mountEditor(doc);
  render(<NoteTasks tasks={getMarkdownSidebarInfo(doc).tasks} />);
  fireEvent.click(screen.getByText("Child"));
  expect(view.state.doc.toString()).toBe(doc);
  expect(view.state.selection.main.head).toBe(view.state.doc.line(2).from);
  expect(view.hasFocus).toBe(true);

  fireEvent.click(screen.getByText("Sibling").closest(".note-task-row")!);
  expect(view.state.doc.toString()).toBe(doc);
  expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from);
});
it("toggles only the checkbox while preserving its parent, siblings and editor selection", () => {
  const doc = "- [ ] Parent\n  - [ ] Child\n- [x] Sibling";
  mountEditor(doc);
  render(<NoteTasks tasks={getMarkdownSidebarInfo(doc).tasks} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Child" }).closest(".cm-task-list-checkbox-shell")!);
  expect(view.state.doc.toString()).toBe("- [ ] Parent\n  - [x] Child\n- [x] Sibling");
  expect((screen.getByRole("checkbox", { name: "Child" }) as HTMLInputElement).checked).toBe(true);
  expect(view.state.selection.main.head).toBe(0);
  fireEvent.click(screen.getByRole("checkbox", { name: "Child" }));
  expect(view.state.doc.toString()).toBe(doc);
});
it("supports keyboard navigation and checkbox toggling as separate controls", async () => {
  const user = userEvent.setup();
  const doc = "Introduction\n\n- [ ] Task";
  mountEditor(doc);
  render(<NoteTasks tasks={getMarkdownSidebarInfo(doc).tasks} />);
  const navigate = screen.getByRole("button", { name: "Go to Task, line 3" });
  navigate.focus();
  await user.keyboard("{Enter}");
  expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from);
  expect(view.hasFocus).toBe(true);
  expect(view.state.doc.toString()).toBe(doc);

  navigate.focus();
  await user.keyboard(" ");
  expect(view.hasFocus).toBe(true);
  expect(view.state.doc.toString()).toBe(doc);

  screen.getByRole("checkbox", { name: "Task" }).focus();
  await user.keyboard(" ");
  expect(view.state.doc.toString()).toBe(doc.replace("[ ]", "[x]"));
  expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from);
});
it("navigates from a parent progress badge and from a read-only checklist", () => {
  const doc = "Introduction\n\n- [ ] Parent\n  - [x] Child";
  mountEditor(doc, true);
  render(<NoteTasks tasks={getMarkdownSidebarInfo(doc).tasks} />);
  expect(screen.getByRole("button", { name: "Go to Parent, line 3, 1 of 1 subtasks completed" })).toBeTruthy();
  fireEvent.click(screen.getByLabelText("1 of 1 subtasks completed"));
  expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from);
  expect(view.hasFocus).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Child" }));
  expect(view.state.doc.toString()).toBe(doc);
});
it("does not toggle stale task locations or read-only notes", () => {
  mountEditor("- [ ] Different task");
  expect(toggleInspectorTask({ depth: 0, checked: false, text: "Old task", line: 1 })).toBe(false);
  view.destroy();
  document.body.replaceChildren();
  mountEditor("- [ ] Old task", true);
  expect(toggleInspectorTask({ depth: 0, checked: false, text: "Old task", line: 1 })).toBe(false);
});

it("counts all descendants in parent pills and updates when tasks change", () => {
  const doc = "- [ ] Parent\n  - [ ] Child\n    - [x] Grandchild\n  - [x] Other child\n- [x] Separate task";
  const { rerender } = render(<NoteTasks tasks={getMarkdownSidebarInfo(doc).tasks} />);
  expect(screen.getByLabelText("2 of 3 subtasks completed").textContent).toBe("2/3");
  expect(screen.getByLabelText("1 of 1 subtasks completed").textContent).toBe("1/1");
  expect(document.querySelectorAll(".note-task-progress")).toHaveLength(2);
  rerender(<NoteTasks tasks={getMarkdownSidebarInfo(doc.replace("[ ] Child", "[x] Child")).tasks} />);
  expect(screen.getByLabelText("3 of 3 subtasks completed").textContent).toBe("3/3");
});
it.each([
  "- [ ] A\n- Plain item\n  - [x] B",
  "1. [ ] A\n2. Plain item\n   - [x] B",
  "- [ ] A\n\nParagraph\n\n  - [x] B",
])("keeps tasks under unrelated non-task or separate list branches separate: %s", (doc) => {
  mountEditor(doc);
  render(<NoteTasks tasks={getMarkdownSidebarInfo(doc).tasks} />);
  expect(document.querySelectorAll(".note-task-tree-children")).toHaveLength(0);
  expect(document.querySelectorAll(".note-task-progress")).toHaveLength(0);
  fireEvent.click(screen.getByRole("checkbox", { name: "B" }));
  expect(view.state.doc.toString()).toBe(doc.replace("[x] B", "[ ] B"));
});
it("keeps genuine task ancestry through intervening ordinary list items and mixed lists", () => {
  const doc = "1. [ ] A\n   - Non-task\n     - [x] B\n   - [ ] C\n2. [x] D";
  const { rerender } = render(<NoteTasks tasks={getMarkdownSidebarInfo(doc).tasks} />);
  expect(screen.getByLabelText("1 of 2 subtasks completed")).toBeTruthy();
  expect(document.querySelectorAll(".note-task-progress")).toHaveLength(1);
  const edited = `Preface\n\n${doc}`;
  mountEditor(edited);
  rerender(<NoteTasks tasks={getMarkdownSidebarInfo(edited).tasks} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "B" }));
  expect(view.state.doc.toString()).toBe(edited.replace("[x] B", "[ ] B"));
});
it("rejects an old marker range after edits and accepts the refreshed structure", () => {
  const original = "- [ ] A\n- [x] B";
  const stale = getMarkdownSidebarInfo(original).tasks[1];
  mountEditor(original.replace("A", "Longer A"));
  expect(toggleInspectorTask(stale)).toBe(false);
  const current = getMarkdownSidebarInfo(view.state.doc.toString()).tasks[1];
  expect(toggleInspectorTask(current)).toBe(true);
  expect(view.state.doc.toString()).toBe("- [ ] Longer A\n- [ ] B");
});
