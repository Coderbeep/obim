import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ createNewFile: vi.fn(async () => undefined) }));

vi.mock("@renderer/features/files/fileActions", () => ({
  useFileCreate: () => ({ createNewFile: state.createNewFile }),
}));

import { useGlobalShortcuts } from "../src/renderer/src/app/useGlobalShortcuts";
import { isVisibleAtom } from "../src/renderer/src/store/SearchWindowStore";
import { shortcutHelpOpenAtom } from "../src/renderer/src/store/appSessionStore";
import { actionRunnerRequestAtom } from "../src/renderer/src/store/actionRunnerStore";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { focusModePaneIdAtom, toggleFocusModeAtom } from "../src/renderer/src/store/focusModeStore";

const setup = () => {
  const store = createStore();
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  renderHook(() => useGlobalShortcuts(), { wrapper });
  return store;
};

afterEach(() => {
  cleanup();
  state.createNewFile.mockClear();
});

const focusSetup = () => {
  const store = setup();
  store.set(workspacePanesAtom, [{ id: "pane-1", tabs: ["tab-1"], activeTabId: "tab-1", size: 1 }]);
  store.set(workspaceTabsByIdAtom, { "tab-1": createEditorTab("tab-1", "note") });
  return store;
};

describe("global shortcuts", () => {
  it("toggles focus mode from an editable target with primary Shift+F", () => {
    const store = focusSetup();
    const { getByRole } = render(<textarea aria-label="Editor" />);
    const editor = getByRole("textbox", { name: "Editor" });
    fireEvent.keyDown(editor, { key: "F", ctrlKey: true, shiftKey: true });
    expect(store.get(focusModePaneIdAtom)).toBe("pane-1");
    fireEvent.keyDown(editor, { key: "F", ctrlKey: true, shiftKey: true });
    expect(store.get(focusModePaneIdAtom)).toBeNull();
  });
  it("requires two consecutive unhandled Escape presses within 600 ms", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const store = focusSetup();
    store.set(toggleFocusModeAtom);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(store.get(focusModePaneIdAtom)).toBe("pane-1");
    now.mockReturnValue(1700);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(store.get(focusModePaneIdAtom)).toBe("pane-1");
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(store.get(focusModePaneIdAtom)).toBe("pane-1");
    now.mockReturnValue(1750);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(store.get(focusModePaneIdAtom)).toBeNull();
    now.mockRestore();
  });
  it.each(["dialog", "search", "commands", "help", "prevented", "repeat", "composition"])(
    "respects Escape ownership for %s",
    (owner) => {
      const store = focusSetup();
      store.set(toggleFocusModeAtom);
      fireEvent.keyDown(window, { key: "Escape" });
      const { unmount, getByRole } = render(
        <textarea aria-label="Overlay input" role={owner === "dialog" ? "dialog" : undefined} />,
      );
      if (owner === "search") store.set(isVisibleAtom, true);
      if (owner === "commands") store.set(actionRunnerRequestAtom, { view: "commands" });
      if (owner === "help") store.set(shortcutHelpOpenAtom, true);
      const target = getByRole(owner === "dialog" ? "dialog" : "textbox");
      if (owner === "prevented") target.addEventListener("keydown", (event) => event.preventDefault());
      fireEvent.keyDown(target, { key: "Escape", repeat: owner === "repeat", isComposing: owner === "composition" });
      expect(store.get(focusModePaneIdAtom)).toBe("pane-1");
      unmount();
      store.set(isVisibleAtom, false);
      store.set(actionRunnerRequestAtom, null);
      store.set(shortcutHelpOpenAtom, false);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(store.get(focusModePaneIdAtom)).toBe("pane-1");
      fireEvent.keyDown(window, { key: "Escape" });
      expect(store.get(focusModePaneIdAtom)).toBeNull();
    },
  );
  it("does not carry an Escape sequence into a new focus session", () => {
    const store = focusSetup();
    store.set(toggleFocusModeAtom);
    fireEvent.keyDown(window, { key: "Escape" });
    store.set(toggleFocusModeAtom);
    store.set(toggleFocusModeAtom);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(store.get(focusModePaneIdAtom)).toBe("pane-1");
  });

  it("creates a new note with the primary N shortcut while the editor target is editable", () => {
    setup();
    const { getByRole } = render(<textarea aria-label="Editor" />);

    fireEvent.keyDown(getByRole("textbox", { name: "Editor" }), { key: "n", ctrlKey: true });

    expect(state.createNewFile).toHaveBeenCalledOnce();
  });

  it("opens file search with the primary P shortcut while the editor target is editable", () => {
    const store = setup();
    const { getByRole } = render(<textarea aria-label="Editor" />);

    fireEvent.keyDown(getByRole("textbox", { name: "Editor" }), { key: "p", ctrlKey: true });

    expect(store.get(isVisibleAtom)).toBe(true);
  });

  it("opens the action menu with the primary Shift+P shortcut and closes file search", () => {
    const store = setup();
    store.set(isVisibleAtom, true);
    const { getByRole } = render(<textarea aria-label="Editor" />);

    fireEvent.keyDown(getByRole("textbox", { name: "Editor" }), { key: "p", ctrlKey: true, shiftKey: true });

    expect(store.get(isVisibleAtom)).toBe(false);
    expect(store.get(actionRunnerRequestAtom)).toEqual({ view: "commands" });
  });

  it("toggles the non-modal shortcut card with the primary slash shortcut and closes it with Escape", () => {
    const store = setup();
    const { getByRole } = render(<textarea aria-label="Editor" />);
    const editor = getByRole("textbox", { name: "Editor" });

    fireEvent.keyDown(editor, { key: "/", ctrlKey: true });
    expect(store.get(shortcutHelpOpenAtom)).toBe(true);

    fireEvent.keyDown(editor, { key: "Escape" });
    expect(store.get(shortcutHelpOpenAtom)).toBe(false);
  });
});
