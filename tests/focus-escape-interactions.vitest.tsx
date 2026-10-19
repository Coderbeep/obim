import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEditorExtensions } from "../src/renderer/src/features/editor/setup";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";
import { FocusModeChrome, useFocusModeBar } from "../src/renderer/src/app/FocusModeChrome";
import { useGlobalShortcuts } from "../src/renderer/src/app/useGlobalShortcuts";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import {
  focusModeLayoutAtom,
  focusModePaneIdAtom,
  focusModeRevealedEdgeAtom,
  toggleFocusModeAtom,
  type FocusModeEdge,
} from "../src/renderer/src/store/focusModeStore";

const callbacks = vi.hoisted(() => ({ createNewFile: vi.fn() }));
// The production hook returns a new callback each render.
vi.mock("@renderer/features/files/fileActions", () => ({
  useFileCreate: () => {
    const callback = callbacks.createNewFile;
    return { createNewFile: () => callback() };
  },
}));

const Bar = ({ edge }: { edge: FocusModeEdge }) => {
  const { focused, revealed } = useFocusModeBar(edge);
  return (
    <aside
      className={edge === "bottom" ? "app-status-bar" : edge === "left" ? "sidebar-shell" : "right-sidebar-shell"}
      data-side={edge}
      inert={focused && !revealed}
      aria-hidden={(focused && !revealed) || undefined}
    >
      <button>{edge} action</button>
    </aside>
  );
};
const Harness = () => {
  useGlobalShortcuts();
  const focused = useAtomValue(focusModePaneIdAtom);
  const [revision, update] = useState(0);
  return (
    <div className="app-shell" data-focus-mode={focused ? "true" : undefined}>
      <FocusModeChrome />
      <textarea aria-label="Document" />
      <button onClick={() => update(revision + 1)}>Update app {revision}</button>
      <Bar edge="left" />
      <Bar edge="right" />
      <Bar edge="bottom" />
    </div>
  );
};
const setup = (layout: "active-pane" | "all-panes") => {
  const store = createStore();
  store.set(focusModeLayoutAtom, layout);
  store.set(workspacePanesAtom, [{ id: "pane-1", tabs: ["tab"], activeTabId: "tab", size: 1 }]);
  store.set(workspaceTabsByIdAtom, { tab: createEditorTab("tab", "note") });
  const view = render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  );
  view.container.querySelector(".app-shell")!.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 }) as DOMRect;
  act(() => store.set(toggleFocusModeAtom));
  return { ...view, store };
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  callbacks.createNewFile = vi.fn();
});

describe("focus Escape integration", () => {
  it.each([false, true])(
    "exits from the production editor after Find is toggled closed (Markdown=%s)",
    (isMarkdown) => {
      installCodeMirrorDomPolyfills();
      const { store, container } = setup("active-pane");
      const parent = container.appendChild(document.createElement("div"));
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc: "Keep writing.",
          extensions: createEditorExtensions({
            isMarkdown,
            owner: "escape",
            overlay: { open() {}, close() {}, hotkey() {} },
            notify() {},
            openResource() {},
            openExternal() {},
            noteHeader: [],
          }),
        }),
      });
      try {
        fireEvent.keyDown(view.contentDOM, { key: "f", ctrlKey: true });
        fireEvent.keyDown(screen.getByRole("searchbox", { name: "Find" }), { key: "f", ctrlKey: true });
        expect(screen.queryByRole("searchbox", { name: "Find" })).toBeNull();
        fireEvent.keyDown(view.contentDOM, { key: "Escape" });
        expect(store.get(focusModePaneIdAtom)).toBe("pane-1");
        fireEvent.keyDown(view.contentDOM, { key: "Escape" });
        expect(store.get(focusModePaneIdAtom)).toBeNull();
      } finally {
        view.destroy();
        parent.remove();
      }
    },
  );
  it("keeps the current new-note callback without resetting Escape listeners", () => {
    setup("active-pane");
    const previous = callbacks.createNewFile;
    callbacks.createNewFile = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "Update app 0" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "n", ctrlKey: true });
    expect(callbacks.createNewFile).toHaveBeenCalledOnce();
    expect(previous).not.toHaveBeenCalled();
  });
  it.each(["active-pane", "all-panes"] as const)("keeps double Escape armed through an app render in %s", (layout) => {
    const { store } = setup(layout);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Document" }), { key: "Escape" });
    expect(store.get(focusModePaneIdAtom)).toBe("pane-1");
    fireEvent.click(screen.getByRole("button", { name: "Update app 0" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Document" }), { key: "Escape" });
    expect(store.get(focusModePaneIdAtom)).toBeNull();
  });
  it.each(["left", "right", "bottom"] as const)("exits with double Escape from the revealed %s bar", (edge) => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const { store } = setup("all-panes");
    const positions = { left: [30, 350], right: [970, 350], bottom: [500, 670] };
    const [clientX, clientY] = positions[edge];
    fireEvent.pointerMove(screen.getByRole("textbox"), { clientX, clientY });
    expect(store.get(focusModeRevealedEdgeAtom)).toBe(edge);
    const action = screen.getByRole("button", { name: `${edge} action` });
    act(() => action.focus());
    fireEvent.keyDown(action, { key: "Escape" });
    expect(store.get(focusModePaneIdAtom)).toBe("pane-1");
    fireEvent.keyDown(action, { key: "Escape" });
    expect(store.get(focusModePaneIdAtom)).toBeNull();
    expect(store.get(focusModeRevealedEdgeAtom)).toBeNull();
  });
});
