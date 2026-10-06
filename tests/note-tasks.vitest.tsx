import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NoteTasks } from "../src/renderer/src/features/editor/inspector/NoteTasks";
import type { MarkdownTask } from "../src/renderer/src/features/editor/inspector/documentInfo";

afterEach(cleanup);

const task = (line: number, text: string, checked = false): MarkdownTask => ({
  checked,
  depth: 0,
  line,
  marker: { from: line * 10, to: line * 10 + 3 },
  text,
});

describe("NoteTasks", () => {
  it("preserves completed checklist rows when preceding newlines shift their line numbers", () => {
    const initial = [task(2, "First"), task(4, "Completed item", true)];
    const { rerender } = render(<NoteTasks tasks={initial} />);
    const completedCheckbox = screen.getByRole("checkbox", { name: "Completed item" });
    const completedRow = completedCheckbox.closest("li");

    rerender(<NoteTasks tasks={[task(3, "First"), task(5, "Completed item", true)]} />);

    expect(screen.getByRole("checkbox", { name: "Completed item" })).toBe(completedCheckbox);
    expect(screen.getByRole("checkbox", { name: "Completed item" }).closest("li")).toBe(completedRow);
  });

  it("keeps identical sibling items distinct while their line numbers shift", () => {
    const { rerender } = render(<NoteTasks tasks={[task(2, "Repeat"), task(4, "Repeat", true)]} />);
    const initialCheckboxes = screen.getAllByRole("checkbox", { name: "Repeat" });

    rerender(<NoteTasks tasks={[task(3, "Repeat"), task(5, "Repeat", true)]} />);

    const shiftedCheckboxes = screen.getAllByRole("checkbox", { name: "Repeat" });
    expect(shiftedCheckboxes[0]).toBe(initialCheckboxes[0]);
    expect(shiftedCheckboxes[1]).toBe(initialCheckboxes[1]);
  });
});
