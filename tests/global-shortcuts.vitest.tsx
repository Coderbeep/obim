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

describe("global shortcuts", () => {
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
