import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupNoteDetailsTestHarness,
  NoteDetailsHarness,
  setupNoteDetailsTestHarness,
} from "./note-details-test-harness";

beforeEach(setupNoteDetailsTestHarness);
afterEach(cleanupNoteDetailsTestHarness);

describe("E03 property draft undo ownership", () => {
  it.each(["count", "name"])("leaves undo and redo with the focused %s input", async (key) => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const onSourceChange = vi.fn();
    render(
      <NoteDetailsHarness
        initialSource={"---\ncount: 12\nname: Original\n---\nBody edit"}
        onUndo={onUndo}
        onSourceChange={onSourceChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Show note details" }));
    const input = screen.getByLabelText(`Edit ${key} value`);
    await user.click(input);
    // Even an unchanged input owns Undo; it must never fall through to body history.
    expect(fireEvent.keyDown(input, { key: "z", metaKey: true })).toBe(true);
    await user.clear(input);
    await user.type(input, key === "count" ? "99" : "Draft");
    for (const modifiers of [
      { metaKey: true },
      { ctrlKey: true },
      { metaKey: true, shiftKey: true },
      { ctrlKey: true, shiftKey: true },
    ]) {
      expect(fireEvent.keyDown(input, { key: "z", ...modifiers })).toBe(true);
    }
    expect(onUndo).not.toHaveBeenCalled();
    expect(onSourceChange).not.toHaveBeenCalled();
  });
});

describe("E04 Escape cancellation precedes blur", () => {
  it("cancels a list-token draft and then allows a later blur to commit", async () => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(<NoteDetailsHarness initialSource={"---\nauthors: [Ada]\n---\nBody"} onSourceChange={onSourceChange} />);
    await user.click(screen.getByRole("button", { name: "Show note details" }));
    await user.click(screen.getByRole("button", { name: "Edit Ada" }));
    const input = await screen.findByRole("combobox", { name: "Edit authors item Ada" });
    await user.clear(input);
    await user.type(input, "Grace");
    if (input.getAttribute("aria-expanded") === "true") await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(onSourceChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit Ada" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit Ada" }));
    const next = await screen.findByRole("combobox", { name: "Edit authors item Ada" });
    await user.clear(next);
    await user.type(next, "Grace");
    await user.click(screen.getByRole("button", { name: "Hide note details" }));
    expect(onSourceChange.mock.lastCall?.[0]).toContain("Grace");
  });

  it("cancels a key rename without committing on focus transfer", async () => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(<NoteDetailsHarness initialSource={"---\ncount: 12\n---\nBody"} onSourceChange={onSourceChange} />);
    await user.click(screen.getByRole("button", { name: "Show note details" }));
    const input = screen.getByLabelText("Edit count field name") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "renamed");
    if (input.getAttribute("aria-expanded") === "true") await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(input.value).toBe("count");
    expect(onSourceChange).not.toHaveBeenCalled();
  });

  it.each(["Enter", "Tab", "click"])("still commits through %s", async (action) => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(<NoteDetailsHarness initialSource={"---\ncount: 12\n---\nBody"} onSourceChange={onSourceChange} />);
    await user.click(screen.getByRole("button", { name: "Show note details" }));
    const input = screen.getByLabelText("Edit count value");
    await user.clear(input);
    await user.type(input, "99");
    if (action === "click") await user.click(screen.getByRole("button", { name: "Hide note details" }));
    else await user.keyboard(`{${action}}`);
    expect(onSourceChange.mock.lastCall?.[0]).toContain("count: 99");
  });

  it.each([
    ["count", "12", "99"],
    ["published", "2026-09-08", "2026-10-09"],
    ["timestamp", "2026-09-08T12:30:00Z", "2026-10-09T13:40:00"],
    ["name", "Original", "Draft"],
  ])("cancels %s without persisting its draft", async (key, value, draft) => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    const { container } = render(
      <NoteDetailsHarness initialSource={`---\n${key}: ${value}\n---\nBody`} onSourceChange={onSourceChange} />,
    );
    await user.click(screen.getByRole("button", { name: "Show note details" }));
    const input = screen.getByLabelText(`Edit ${key} value`) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, draft);
    // A picker consumes the first Escape without committing/cancelling the field.
    if (input.getAttribute("aria-expanded") === "true") await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    expect(onSourceChange).not.toHaveBeenCalled();
    expect(input.value).toBe(value.replace(/Z$/, ""));
    expect(document.activeElement).toBe(container.querySelector(`[data-property-key='${key}']`));
    fireEvent.blur(input);
    expect(onSourceChange).not.toHaveBeenCalled();
  });
});
