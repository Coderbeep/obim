import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorState } from "../src/renderer/src/features/editor/codemirror-state";
import { EditorView } from "../src/renderer/src/features/editor/codemirror-view";
import { search, openSearchPanel } from "@codemirror/search";
import { createEditorFindPanel } from "../src/renderer/src/features/editor/editorFindPanel";
import { DocumentFindBar } from "../src/renderer/src/features/search/DocumentFindBar";
afterEach(cleanup);
it("reveals PDF navigation only with a query and keeps the row mounted for its exit", () => {
  const next = vi.fn();
  const previous = vi.fn();
  const close = vi.fn();
  const props = {
    inputRef: { current: null },
    onQueryChange: vi.fn(),
    resultLabel: "1 / 3",
    canNavigate: true,
    onNext: next,
    onPrevious: previous,
    onClose: close,
  };
  const result = render(<DocumentFindBar {...props} query="" />);
  expect(screen.queryByRole("button", { name: "Next search result" })).toBeNull();
  const row = result.container.querySelector(".document-find-results")!;
  expect(row.getAttribute("inert")).not.toBeNull();
  result.rerender(<DocumentFindBar {...props} query="test" />);
  expect(screen.getByRole("status").textContent).toBe("1 / 3");
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter", shiftKey: true });
  expect(previous).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Next search result" }));
  expect(next).toHaveBeenCalledOnce();
  result.rerender(<DocumentFindBar {...props} query="" />);
  expect(result.container.querySelector(".document-find-results")).toBe(row);
  expect(screen.queryByRole("status")).toBeNull();
});
it("shows editor counts, navigates matches, and collapses when cleared", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "apple banana apple",
      extensions: [search({ top: true, createPanel: createEditorFindPanel })],
    }),
  });
  try {
    openSearchPanel(view);
    const input = screen.getByRole("searchbox", { name: "Find" });
    expect(screen.queryByRole("button", { name: "Next search result" })).toBeNull();
    fireEvent.input(input, { target: { value: "apple" } });
    expect(screen.getByRole("status").textContent).toBe("2 results");
    fireEvent.click(screen.getByRole("button", { name: "Next search result" }));
    expect(screen.getByRole("status").textContent).toMatch(/\d \/ 2 results/);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("apple");
    fireEvent.input(input, { target: { value: "missing" } });
    expect(screen.getByRole("status").textContent).toBe("No results");
    expect((screen.getByRole("button", { name: "Next search result" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(input, { target: { value: "" } });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
  } finally {
    view.destroy();
    parent.remove();
  }
});
