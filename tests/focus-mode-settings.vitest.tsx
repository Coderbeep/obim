import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "../src/renderer/src/app/SettingsDialog";
import { activePaneIdAtom, workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import {
  focusModeLayoutAtom,
  focusModePaneIdAtom,
  toggleFocusModeAtom,
} from "../src/renderer/src/store/focusModeStore";
import type { FocusModeLayout } from "../src/shared/config";

let savedLayout: FocusModeLayout;
const updateConfig = vi.fn();
beforeEach(() => {
  savedLayout = "all-panes";
  updateConfig.mockReset();
  updateConfig.mockImplementation(async (_key: string, layout: FocusModeLayout) => {
    savedLayout = layout;
  });
  window.config = {
    isMacOS: false,
    getFocusModeLayoutSync: () => savedLayout,
    getThemeSync: () => "light",
    getSidebarPlacementSync: () => "explorer-left",
    getConfigValue: async () => undefined,
    updateConfig,
  } as unknown as Window["config"];
});
afterEach(cleanup);
const open = () => {
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
  return within(screen.getByRole("radiogroup", { name: "Focus mode layout" }));
};
describe("focus layout settings", () => {
  it("defaults to all panes, is searchable by zen, and reloads a saved choice in a fresh store", async () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <SettingsDialog />
      </Provider>,
    );
    const choices = open();
    expect(choices.getByRole("radio", { name: "All panes" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), { target: { value: "zen" } });
    expect(screen.getByRole("button", { name: "Appearance" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Workspace" })).toBeNull();
    fireEvent.click(choices.getByRole("radio", { name: "Active pane" }));
    await waitFor(() => expect(store.get(focusModeLayoutAtom)).toBe("active-pane"));
    expect(updateConfig).toHaveBeenCalledWith("focusModeLayout", "active-pane");
    cleanup();
    const restored = createStore();
    render(
      <Provider store={restored}>
        <SettingsDialog />
      </Provider>,
    );
    expect(open().getByRole("radio", { name: "Active pane" }).getAttribute("aria-checked")).toBe("true");
    expect(restored.get(focusModeLayoutAtom)).toBe("active-pane");
    expect(restored.get(focusModePaneIdAtom)).toBeNull();
  });
  it("applies a keyboard-selected layout to the current focused pane after persistence succeeds", async () => {
    const store = createStore();
    store.set(activePaneIdAtom, "one");
    store.set(workspacePanesAtom, [
      { id: "one", tabs: ["a"], activeTabId: "a", size: 1 },
      { id: "two", tabs: ["b"], activeTabId: "b", size: 2 },
    ]);
    store.set(workspaceTabsByIdAtom, { a: createEditorTab("a", "file:a"), b: createEditorTab("b", "file:b") });
    render(
      <Provider store={store}>
        <SettingsDialog />
        <div data-workspace-pane-id="two">
          <div className="pane-card-content">
            <textarea aria-label="Current note" defaultValue="Keep writing." />
          </div>
        </div>
      </Provider>,
    );
    const choices = open();
    act(() => {
      store.set(toggleFocusModeAtom);
      store.set(activePaneIdAtom, "two");
    });
    const panes = store.get(workspacePanesAtom);
    fireEvent.keyDown(choices.getByRole("radio", { name: "All panes" }), { key: "ArrowRight" });
    await waitFor(() =>
      expect(choices.getByRole("radio", { name: "Active pane" }).getAttribute("aria-checked")).toBe("true"),
    );
    expect(store.get(focusModePaneIdAtom)).toBe("two");
    expect(store.get(workspacePanesAtom)).toBe(panes);
    fireEvent.click(choices.getByRole("radio", { name: "All panes" }));
    await waitFor(() => expect(store.get(focusModeLayoutAtom)).toBe("all-panes"));
    expect(store.get(focusModePaneIdAtom)).toBe("two");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Current note" })));
  });
  it("retains the saved choice on failure and permits retry", async () => {
    updateConfig.mockRejectedValueOnce(new Error("Disk full"));
    const store = createStore();
    render(
      <Provider store={store}>
        <SettingsDialog />
      </Provider>,
    );
    const choices = open();
    fireEvent.click(choices.getByRole("radio", { name: "Active pane" }));
    expect((await screen.findByRole("alert")).textContent).toContain("previous choice is still selected");
    expect(store.get(focusModeLayoutAtom)).toBe("all-panes");
    expect(savedLayout).toBe("all-panes");
    fireEvent.click(choices.getByRole("radio", { name: "Active pane" }));
    await waitFor(() => expect(store.get(focusModeLayoutAtom)).toBe("active-pane"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("serializes pending changes without displaying an unsaved choice", async () => {
    let resolveSave!: () => void;
    updateConfig.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const store = createStore();
    render(
      <Provider store={store}>
        <SettingsDialog />
      </Provider>,
    );
    const choices = open();
    fireEvent.click(choices.getByRole("radio", { name: "Active pane" }));
    expect((choices.getByRole("radio", { name: "All panes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((choices.getByRole("radio", { name: "Active pane" }) as HTMLButtonElement).disabled).toBe(true);
    expect(store.get(focusModeLayoutAtom)).toBe("all-panes");
    expect(updateConfig).toHaveBeenCalledTimes(1);
    await act(async () => resolveSave());
    expect(store.get(focusModeLayoutAtom)).toBe("active-pane");
    expect((choices.getByRole("radio", { name: "All panes" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
