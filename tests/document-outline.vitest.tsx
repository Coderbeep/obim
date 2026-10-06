import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/features/editor/inspector/WidgetStack", () => ({
  RightSidebarWidget: ({ actions, children, title }: { actions?: ReactNode; children: ReactNode; title: string }) => (
    <section aria-label={title}>
      {actions}
      {children}
    </section>
  ),
}));

import { DocumentOutline } from "../src/renderer/src/features/editor/inspector/DocumentOutline";
import { OutlineNavigationExtension } from "../src/renderer/src/features/editor/extensions/OutlineNavigationExtension";

const headings = [
  { level: 1, line: 1, text: "Page" },
  { level: 2, line: 3, text: "Setup" },
  { level: 3, line: 5, text: "Install" },
  { level: 1, line: 7, text: "Page" },
];

let editor: EditorView | null = null;

afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

describe("DocumentOutline", () => {
  it("renders one semantic tree and an explicit empty state", () => {
    const { container, rerender } = render(<DocumentOutline headings={headings} />);

    expect(screen.getByRole("navigation", { name: "Document outline" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Page \d/ })).toHaveLength(2);
    expect(screen.queryByText("4 headings")).toBeNull();
    expect(screen.getAllByText("H1")).toHaveLength(2);
    expect(screen.getAllByText("H1")[0].getAttribute("data-level")).toBe("1");
    expect(screen.getByText("H3").getAttribute("data-level")).toBe("3");
    expect(screen.getByText("L3")).toBeTruthy();
    expect(container.querySelectorAll("nav")).toHaveLength(1);
    expect(container.querySelector(".outline-tree-children > .outline-tree-node")).toBeTruthy();
    expect(container.querySelector("pierre-tree")).toBeNull();

    rerender(<DocumentOutline headings={[]} />);
    expect(screen.queryByRole("navigation", { name: "Document outline" })).toBeNull();
    expect(screen.getByText("No headings")).toBeTruthy();
  });

  it("supports pointer and arrow-key expansion without a fallback renderer", () => {
    render(<DocumentOutline headings={headings} />);
    const collapsePage = screen.getAllByRole("button", { name: "Collapse Page" })[0];
    expect(collapsePage.querySelector("svg")?.classList.contains("-rotate-90")).toBe(false);

    fireEvent.click(collapsePage);
    expect(screen.queryByRole("button", { name: "Setup" })).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Expand Page" })[0].querySelector("svg")?.classList.contains("-rotate-90"),
    ).toBe(true);

    const page = screen.getAllByRole("button", { name: /^Page \d/ })[0];
    fireEvent.keyDown(page, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /^Setup \d/ })).toBeTruthy();

    fireEvent.keyDown(page, { key: "ArrowLeft" });
    expect(screen.queryByRole("button", { name: /^Setup \d/ })).toBeNull();
  });

  it("preserves expansion state when heading values have not changed", () => {
    const { rerender } = render(<DocumentOutline headings={headings} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Collapse Page" })[0]);
    rerender(<DocumentOutline headings={headings.map((heading) => ({ ...heading }))} />);

    expect(screen.queryByRole("button", { name: /^Setup \d/ })).toBeNull();
  });

  it("navigates the active editor and marks the current section", () => {
    const pane = document.body.appendChild(document.createElement("div"));
    pane.className = "pane-card-active";
    const parent = pane.appendChild(document.createElement("div"));
    editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: "# Page\n\n## Setup\n\n### Install\n\n# Page",
        extensions: [OutlineNavigationExtension],
      }),
    });
    render(<DocumentOutline headings={headings} />);

    fireEvent.click(screen.getByRole("button", { name: /^Setup \d/ }));

    expect(editor.state.selection.main.head).toBe(editor.state.doc.line(3).from);
    expect(screen.getByRole("button", { name: /^Setup \d/ }).getAttribute("aria-current")).toBe("location");
    expect(editor.hasFocus).toBe(true);
  });
});
