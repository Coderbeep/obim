import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "../src/renderer/src/features/editor/codemirror-state";
import { EditorView } from "../src/renderer/src/features/editor/codemirror-view";
import FormattingKeymap from "../src/renderer/src/features/editor/extensions/InlineFormattingWrap";
import { KeyboardShortcutSettings } from "../src/renderer/src/app/KeyboardShortcutSettings";
import { saveKeyboardShortcuts, isShortcut } from "../src/renderer/src/shared/keyboardShortcuts";
import {
  isShortcutOverrides,
  matchesShortcut,
  shortcutBindingError,
  shortcutFromEvent,
} from "../src/shared/keyboard-shortcuts";
const updateConfig = vi.fn(async () => undefined);
const recording = vi.fn();
const key = (key: string, extra = {}) => ({
  key,
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});
beforeEach(async () => {
  window.config = { ...window.config, isMacOS: false, updateConfig, setShortcutRecording: recording };
  updateConfig.mockResolvedValue(undefined);
  await act(async () => saveKeyboardShortcuts({}));
  updateConfig.mockClear();
  recording.mockClear();
});
afterEach(cleanup);
const recordEdit = (label = "New note", binding = "Ctrl + N", combination = key("j")) => {
  fireEvent.click(screen.getByRole("button", { name: `Edit ${label} shortcut ${binding}` }));
  fireEvent.keyDown(window, combination);
};
describe("editable keyboard shortcuts", () => {
  it("searches commands, replaces a binding without firing it, and updates runtime matching", async () => {
    render(<KeyboardShortcutSettings />);
    expect(screen.getAllByRole("heading", { name: "Application" })).toHaveLength(1);
    expect(screen.getAllByText("Application", { exact: true })).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox", { name: "Search shortcuts" }), { target: { value: "new note" } });
    expect(screen.queryByRole("region", { name: "Bold" })).toBeNull();
    const run = vi.fn();
    window.addEventListener("keydown", run);
    expect(screen.queryByRole("button", { name: /Add shortcut for/ })).toBeNull();
    const edit = screen.getByRole("button", { name: "Edit New note shortcut Ctrl + N" });
    fireEvent.click(edit);
    const capture = within(screen.getByRole("region", { name: "New note" })).getByRole("button", {
      name: "Record shortcut for New note",
    });
    expect(capture).toBe(edit);
    expect(within(capture).getByText("Press shortcut")).toBeTruthy();
    expect(capture.closest("[data-recording='true']")).toBeTruthy();
    expect(document.activeElement).toBe(capture);
    expect(screen.queryByRole("button", { name: "Edit New note shortcut Ctrl + N" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save shortcut" })).toBeNull();
    fireEvent.keyDown(window, key("j"));
    expect(run).not.toHaveBeenCalled();
    window.removeEventListener("keydown", run);
    expect(recording).toHaveBeenCalledWith(true);
    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith("keyboardShortcuts", { "new-note": ["Mod+J"] }));
    await waitFor(() => expect(recording).toHaveBeenLastCalledWith(false));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit New note shortcut Ctrl + J" })),
    );
    expect(isShortcut("new-note", key("j"))).toBe(true);
    expect(isShortcut("new-note", key("n"))).toBe(false);
  });
  it("rejects collisions and reserved keys, and Escape leaves the binding untouched", async () => {
    render(<KeyboardShortcutSettings />);
    recordEdit("New note", "Ctrl + N", key("p"));
    expect(screen.getByRole("alert").textContent).toContain("Search files");
    expect(updateConfig).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Record shortcut for New note" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit New note shortcut Ctrl + N" }));
    recordEdit("New note", "Ctrl + N", key("q"));
    expect(screen.getByRole("alert").textContent).toContain("reserved");
    expect(screen.getByRole("button", { name: "Record shortcut for New note" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit New note shortcut Ctrl + N" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Record shortcut for New note" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit New note shortcut Ctrl + N" })).toBeTruthy();
    expect(updateConfig).not.toHaveBeenCalled();
  });
  it("removes bindings, edits unassigned commands, and resets to defaults", async () => {
    render(<KeyboardShortcutSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Remove New note shortcut Ctrl + N" }));
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "New note" })).getByText("Unassigned")).toBeTruthy(),
    );
    expect(isShortcut("new-note", key("n"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Edit New note shortcut" }));
    fireEvent.keyDown(window, key("j"));
    await waitFor(() => expect(isShortcut("new-note", key("j"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Reset all to defaults" }));
    await waitFor(() => expect(isShortcut("new-note", key("n"))).toBe(true));
  });
  it("keeps old bindings when persistence fails", async () => {
    updateConfig.mockRejectedValueOnce(new Error("disk full"));
    render(<KeyboardShortcutSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Remove New note shortcut Ctrl + N" }));
    await screen.findByRole("alert");
    expect(isShortcut("new-note", key("n"))).toBe(true);
  });
  it("updates an already-open editor and disables the previous formatting binding", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: "hello", selection: { anchor: 0, head: 5 }, extensions: [FormattingKeymap] }),
    });
    try {
      await act(async () => saveKeyboardShortcuts({ bold: ["Mod+J"] }));
      fireEvent.keyDown(view.contentDOM, key("b"));
      expect(view.state.doc.toString()).toBe("hello");
      fireEvent.keyDown(view.contentDOM, key("j"));
      expect(view.state.doc.toString()).toBe("**hello**");
      await act(async () => saveKeyboardShortcuts({ bold: [] }));
      fireEvent.keyDown(view.contentDOM, key("j"));
      expect(view.state.doc.toString()).toBe("**hello**");
    } finally {
      view.destroy();
      parent.remove();
    }
  });
  it("normalizes macOS modifiers and validates persisted settings", () => {
    expect(shortcutFromEvent(key("j", { metaKey: true, ctrlKey: false, altKey: true }), true)).toBe("Mod+Alt+J");
    expect(
      matchesShortcut(
        "close-current-tab",
        key("x", { shiftKey: true }),
        { "close-current-tab": ["Mod+Shift+X"] },
        false,
      ),
    ).toBe(true);
    expect(matchesShortcut("close-current-tab", key("w"), { "close-current-tab": [] }, false)).toBe(false);
    expect(isShortcutOverrides({ bold: [] })).toBe(true);
    expect(isShortcutOverrides({ bold: "Mod+B" })).toBe(false);
    expect(isShortcutOverrides({ unknown: [] })).toBe(false);
    expect(shortcutBindingError("A")).toContain("Include");
  });
});
