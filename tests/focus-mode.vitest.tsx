import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { useLayoutEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "postcss";
import { FocusModeControls } from "../src/renderer/src/app/FocusModeControls";
import { useFocusModeLayout } from "../src/renderer/src/app/useFocusModeLayout";
import { useFocusMode } from "../src/renderer/src/app/useFocusMode";
import { useGlobalShortcuts } from "../src/renderer/src/app/useGlobalShortcuts";
import { WorkspacePaneGrid } from "../src/renderer/src/features/workspace/WorkspacePaneGrid";
import { usePaneWorkspace } from "../src/renderer/src/features/workspace/usePaneWorkspace";
import type { WorkspaceItemViewMap } from "../src/renderer/src/features/workspace/workspaceItemView";
import { versionHistoryOpenRequestAtom } from "../src/renderer/src/store/appSessionStore";
import { activePaneIdAtom, workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { fileSaveStatesByPathAtom, fileConflictReviewRequestAtom } from "../src/renderer/src/store/fileSaveStore";
import {
  canEnterFocusModeAtom,
  focusModeLayoutAtom,
  focusModePaneIdAtom,
  focusModeTargetPaneIdAtom,
  toggleFocusModeAtom,
} from "../src/renderer/src/store/focusModeStore";
import { openWorkspaceItemsByKeyAtom } from "../src/renderer/src/store/workspaceResourceStore";
import type { FocusModeLayout } from "../src/shared/config";
import { createFileWorkspaceItem, type WorkspaceItem } from "../src/shared/workspace";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";

const focusModeStyles = readFileSync("src/renderer/src/app/FocusMode.css", "utf8");
// Include the real frame cascade; jsdom cannot parse unrelated nested CSS.
const workspaceFrameStyles = parse(readFileSync("src/renderer/src/styles/workspace.css", "utf8"))
  .nodes.filter(
    (node) =>
      node.type === "rule" &&
      [".app-shell", ".root-layout", ".content", ".pane-workspace", ".pane-column", ".pane-resize-divider"].includes(
        node.selector,
      ),
  )
  .map((node) => node.toString())
  .join("\n");
const workspacePolishStyles = readFileSync("src/renderer/src/styles/workspace-polish.css", "utf8");
const workspaceExperimentStyles = readFileSync("src/renderer/src/app/MainWorkspaceExperiment.css", "utf8");
const editors = new Map<string, EditorView>();
const destroyed = vi.fn();
let workspacePath = "/notes";
const resolve = (key: string, items: Readonly<Record<string, WorkspaceItem>>) => items[key] ?? null;
const MountedEditor = ({ paneId }: { paneId: string }) => {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: "Keep writing.", extensions: [history()] }),
    });
    editors.set(paneId, view);
    return () => {
      view.destroy();
      destroyed(paneId);
    };
  }, [paneId]);
  return <div className="editor-comp" ref={host} />;
};
const views: WorkspaceItemViewMap = {
  file: {
    getTitle: (item) => item.key,
    isEditorContent: () => true,
    renderHeader: () => <div className="pane-card-header">Navigation header</div>,
    render: (_item, paneId) => <MountedEditor paneId={paneId} />,
  },
};
const Harness = ({ enabled = true }: { enabled?: boolean }) => {
  const layout = useAtomValue(focusModeLayoutAtom);
  const focusedPane = useFocusMode({ enabled });
  useGlobalShortcuts({ enabled });
  const workspace = usePaneWorkspace({ openDroppedFile: vi.fn(), resolveWorkspaceItem: resolve, views });
  return (
    <div
      className="app-shell workspace-soft-experiment"
      data-focus-mode={focusedPane ? "true" : undefined}
      data-focus-mode-layout={focusedPane ? layout : undefined}
    >
      <main className="root-layout">
        <div className="content">
          <WorkspacePaneGrid
            workspace={workspace}
            views={views}
            resolveWorkspaceItem={resolve}
            tabBarStartContent={<button>Explorer toggle</button>}
            tabBarEndContent={<button>Inspector toggle</button>}
          />
        </div>
      </main>
      <aside className="sidebar-shell">Explorer</aside>
      <aside className="right-sidebar-shell">Inspector</aside>
      <footer className="app-status-bar">Status</footer>
      <FocusModeControls />
    </div>
  );
};
const setup = (layout: FocusModeLayout = "active-pane") => {
  const store = createStore();
  store.set(focusModeLayoutAtom, layout);
  const items = ["one", "two"].map((name) =>
    createFileWorkspaceItem({
      id: name,
      filename: `${name}.md`,
      relativePath: `${name}.md`,
      path: `/notes/${name}.md`,
      isDirectory: false,
      mimeType: "text/markdown",
    }),
  );
  store.set(activePaneIdAtom, "pane-one");
  store.set(
    workspacePanesAtom,
    items.map((_item, index) => ({
      id: index ? "pane-two" : "pane-one",
      tabs: [`tab-${index}`],
      activeTabId: `tab-${index}`,
      size: index ? 2 : 1,
    })),
  );
  store.set(
    workspaceTabsByIdAtom,
    Object.fromEntries(items.map((item, index) => [`tab-${index}`, createEditorTab(`tab-${index}`, item.key)])),
  );
  store.set(openWorkspaceItemsByKeyAtom, Object.fromEntries(items.map((item) => [item.key, item])));
  store.set(fileBuffersByPathAtom, { "/notes/one.md": { savedText: "Keep writing.", editorText: "Keep writing." } });
  return store;
};
beforeEach(() => {
  workspacePath = "/notes";
  destroyed.mockClear();
  editors.clear();
  installCodeMirrorDomPolyfills();
  window.requestAnimationFrame ??= (callback) => window.setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame ??= (id) => window.clearTimeout(id);
  Object.defineProperty(window, "config", {
    configurable: true,
    value: { isMacOS: false, getMainDirectoryPathSync: () => workspacePath },
  });
});
afterEach(cleanup);

describe("focus mode", () => {
  it("keeps normal pane frames in all-pane focus and removes frames/tabs/dividers only in single-pane focus", () => {
    const style = document.createElement("style");
    // Substitute border colors only: jsdom cannot resolve variables in border shorthands.
    style.textContent = [workspaceFrameStyles, workspacePolishStyles, workspaceExperimentStyles, focusModeStyles]
      .join("\n")
      .replace(/var\(--border-[\w-]+\)/g, "currentColor");
    document.head.append(style);
    try {
      const store = setup("all-panes");
      const { container } = render(
        <Provider store={store}>
          <Harness />
        </Provider>,
      );
      const frames = () =>
        Array.from(container.querySelectorAll(".pane-column"), (pane) => {
          const { borderWidth, borderStyle, borderRadius } = getComputedStyle(pane);
          return { borderWidth, borderStyle, borderRadius };
        });
      const normalFrames = frames();
      expect(normalFrames).toEqual([
        { borderWidth: "1px", borderStyle: "solid", borderRadius: "14px" },
        { borderWidth: "1px", borderStyle: "solid", borderRadius: "14px" },
      ]);
      act(() => store.set(toggleFocusModeAtom));
      expect(frames()).toEqual(normalFrames);
      expect(getComputedStyle(container.querySelector(".content")!).padding).toBe("var(--space-2)");
      expect(getComputedStyle(container.querySelector(".pane-workspace")!).gap).toBe("6px");
      expect(getComputedStyle(container.querySelector(".root-layout")!).background).toBe("var(--surface-canvas)");
      for (const selector of [".sidebar-shell", ".right-sidebar-shell", ".app-status-bar"])
        expect(getComputedStyle(container.querySelector(selector)!).visibility, selector).toBe("hidden");
      for (const selector of [".pane-card-header", ".pane-tabs-start", ".pane-tabs-end"])
        expect(getComputedStyle(container.querySelector(selector)!).display, selector).toBe("none");
      expect(getComputedStyle(container.querySelector(".pane-tabs-container")!).display).not.toBe("none");
      expect(getComputedStyle(container.querySelector(".pane-resize-divider")!).display).not.toBe("none");
      act(() => store.set(focusModeLayoutAtom, "active-pane"));
      for (const frame of frames()) {
        expect(frame.borderWidth).toBe("0px");
        expect(frame.borderRadius).toBe("0");
      }
      expect(getComputedStyle(container.querySelector(".content")!).padding).toBe("0px");
      expect(getComputedStyle(container.querySelector(".root-layout")!).background).toBe("var(--surface-1)");
      expect(getComputedStyle(container.querySelector(".pane-tabs-container")!).display).toBe("none");
      expect(getComputedStyle(container.querySelector(".pane-resize-divider")!).display).toBe("none");
      act(() => store.set(toggleFocusModeAtom));
      expect(frames()).toEqual(normalFrames);
      expect(getComputedStyle(container.querySelector(".app-status-bar")!).display).not.toBe("none");
      expect(getComputedStyle(container.querySelector(".pane-tabs-container")!).display).not.toBe("none");
    } finally {
      style.remove();
    }
  });
  it("defaults to all panes and initializes saved preferences before paint", () => {
    const store = setup("all-panes");
    Object.defineProperty(window, "config", {
      configurable: true,
      value: { ...window.config, getFocusModeLayoutSync: () => "active-pane" },
    });
    const Preference = () => <span>{useFocusModeLayout()}</span>;
    render(
      <Provider store={store}>
        <Preference />
      </Provider>,
    );
    expect(store.get(focusModeLayoutAtom)).toBe("active-pane");
    expect(screen.getByText("active-pane")).toBeTruthy();
    expect(createStore().get(focusModeLayoutAtom)).toBe("all-panes");
  });
  it("keeps every pane, tabs, navigation and dimensions available in all-pane focus", () => {
    const store = setup("all-panes");
    const { container } = render(
      <Provider store={store}>
        <Harness />
      </Provider>,
    );
    const panes = store.get(workspacePanesAtom);
    act(() => store.set(toggleFocusModeAtom));
    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(container.querySelector('[data-workspace-pane-id="pane-one"]')!.getAttribute("style")).toContain("1 1 0%");
    expect(container.querySelector('[data-workspace-pane-id="pane-two"]')!.getAttribute("style")).toContain("2 1 0%");
    expect(store.get(workspacePanesAtom)).toBe(panes);
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(store.get(focusModePaneIdAtom)).toBe("pane-two");
    expect(container.querySelector(".app-shell")?.getAttribute("data-focus-mode-layout")).toBe("all-panes");
    expect(container.querySelectorAll(".pane-navigation-header[hidden][inert]")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Exit focus mode" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("tab")[0]);
    expect(store.get(focusModePaneIdAtom)).toBe("pane-one");
  });
  it("allows intentional resizing in all-pane focus without resetting sizes on exit", () => {
    const store = setup("all-panes");
    const { container } = render(
      <Provider store={store}>
        <Harness />
      </Provider>,
    );
    Object.defineProperty(container.querySelector(".pane-workspace"), "clientWidth", {
      configurable: true,
      value: 1200,
    });
    act(() => store.set(toggleFocusModeAtom));
    fireEvent.mouseDown(container.querySelector(".pane-resize-handle")!, { clientX: 400 });
    fireEvent.mouseMove(window, { clientX: 520 });
    fireEvent.mouseUp(window);
    const resized = store.get(workspacePanesAtom);
    expect(resized[0].size).toBeGreaterThan(1);
    expect(resized[1].size).toBeLessThan(2);
    fireEvent.click(screen.getByRole("button", { name: "Exit focus mode" }));
    expect(store.get(workspacePanesAtom)).toBe(resized);
  });
  it("changes layouts around the current pane without remounting or changing layout state", () => {
    const store = setup("all-panes");
    const { container } = render(
      <Provider store={store}>
        <Harness />
      </Provider>,
    );
    const one = editors.get("pane-one"),
      two = editors.get("pane-two");
    const panes = store.get(workspacePanesAtom);
    act(() => {
      store.set(toggleFocusModeAtom);
      store.set(activePaneIdAtom, "pane-two");
    });
    act(() => store.set(focusModeLayoutAtom, "active-pane"));
    expect(store.get(focusModePaneIdAtom)).toBe("pane-two");
    expect(store.get(focusModeTargetPaneIdAtom)).toBe("pane-two");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(container.querySelector('[data-workspace-pane-id="pane-one"]')!.hasAttribute("hidden")).toBe(true);
    act(() => store.set(focusModeLayoutAtom, "all-panes"));
    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    expect(store.get(focusModePaneIdAtom)).toBe("pane-two");
    expect(editors.get("pane-one")).toBe(one);
    expect(editors.get("pane-two")).toBe(two);
    expect(destroyed).not.toHaveBeenCalled();
    expect(store.get(workspacePanesAtom)).toBe(panes);
  });
  it("stays in all-pane focus when the entry pane empties or is removed, until the last view closes", () => {
    const store = setup("all-panes");
    render(
      <Provider store={store}>
        <Harness />
      </Provider>,
    );
    act(() => store.set(toggleFocusModeAtom));
    act(() =>
      store.set(workspacePanesAtom, (panes) =>
        panes.map((pane) => (pane.id === "pane-one" ? { ...pane, tabs: [], activeTabId: null } : pane)),
      ),
    );
    expect(store.get(focusModePaneIdAtom)).toBe("pane-one");
    act(() => {
      store.set(activePaneIdAtom, "pane-two");
      store.set(workspacePanesAtom, (panes) => panes.filter((pane) => pane.id !== "pane-one"));
    });
    expect(store.get(focusModePaneIdAtom)).toBe("pane-two");
    act(() =>
      store.set(workspacePanesAtom, (panes) => panes.map((pane) => ({ ...pane, tabs: [], activeTabId: null }))),
    );
    expect(store.get(focusModePaneIdAtom)).toBeNull();
    expect(store.get(focusModeTargetPaneIdAtom)).toBeNull();
  });
  it("handles the keyboard toggle and double Escape from CodeMirror's content element", async () => {
    const store = setup();
    render(
      <Provider store={store}>
        <Harness />
      </Provider>,
    );
    const editor = editors.get("pane-one")!;
    act(() => editor.focus());
    fireEvent.keyDown(editor.contentDOM, { key: "F", ctrlKey: true, shiftKey: true });
    expect(store.get(focusModePaneIdAtom)).toBe("pane-one");
    fireEvent.keyDown(editor.contentDOM, { key: "Escape" });
    expect(store.get(focusModePaneIdAtom)).toBe("pane-one");
    fireEvent.keyDown(editor.contentDOM, { key: "Escape" });
    expect(store.get(focusModePaneIdAtom)).toBeNull();
  });
  it("rejects empty/missing panes and never rewrites workspace state when toggling", () => {
    const empty = createStore();
    expect(empty.get(canEnterFocusModeAtom)).toBe(false);
    empty.set(toggleFocusModeAtom);
    expect(empty.get(focusModePaneIdAtom)).toBeNull();
    const store = setup();
    const panes = store.get(workspacePanesAtom),
      tabs = store.get(workspaceTabsByIdAtom),
      buffers = store.get(fileBuffersByPathAtom);
    store.set(toggleFocusModeAtom, "missing");
    expect(store.get(focusModePaneIdAtom)).toBeNull();
    store.set(toggleFocusModeAtom, "pane-two");
    expect(store.get(focusModePaneIdAtom)).toBe("pane-two");
    store.set(toggleFocusModeAtom);
    expect(store.get(focusModePaneIdAtom)).toBeNull();
    expect(store.get(workspacePanesAtom)).toBe(panes);
    expect(store.get(workspaceTabsByIdAtom)).toBe(tabs);
    expect(store.get(fileBuffersByPathAtom)).toBe(buffers);
  });
  it.each(["active-pane", "all-panes"] as const)(
    "preserves both CodeMirror instances, text, selection, scroll, and undo in %s",
    async (layout) => {
      const store = setup(layout);
      const { container } = render(
        <Provider store={store}>
          <Harness />
        </Provider>,
      );
      const one = editors.get("pane-one")!,
        two = editors.get("pane-two")!;
      two.dispatch({ changes: { from: 13, insert: " More." }, selection: { anchor: 2, head: 7 } });
      two.scrollDOM.scrollTop = 80;
      const panes = store.get(workspacePanesAtom);
      for (let i = 0; i < 3; i += 1) {
        fireEvent.click(screen.getAllByRole("button", { name: "Enter focus mode" })[1]);
        expect(store.get(focusModePaneIdAtom)).toBe("pane-two");
        const hiddenPane = container.querySelector('[data-workspace-pane-id="pane-one"]')!;
        expect(hiddenPane.hasAttribute("hidden")).toBe(layout === "active-pane");
        expect(hiddenPane.hasAttribute("inert")).toBe(layout === "active-pane");
        expect(hiddenPane.getAttribute("aria-hidden")).toBe(layout === "active-pane" ? "true" : null);
        expect(screen.queryAllByRole("tablist")).toHaveLength(layout === "active-pane" ? 0 : 2);
        expect(screen.queryByRole("button", { name: "Explorer toggle" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Inspector toggle" })).toBeNull();
        await waitFor(() => expect(document.activeElement).toBe(two.contentDOM));
        fireEvent.click(screen.getByRole("button", { name: "Exit focus mode" }));
        await waitFor(() => expect(document.activeElement).toBe(two.contentDOM));
        expect(screen.getAllByRole("tablist")).toHaveLength(2);
        expect(two.state.selection.main.from).toBe(2);
        expect(two.state.selection.main.to).toBe(7);
        expect(two.scrollDOM.scrollTop).toBe(80);
      }
      expect(editors.get("pane-one")).toBe(one);
      expect(editors.get("pane-two")).toBe(two);
      expect(destroyed).not.toHaveBeenCalled();
      expect(store.get(workspacePanesAtom)).toBe(panes);
      expect(two.state.doc.toString()).toBe("Keep writing. More.");
      expect(undo(two)).toBe(true);
      expect(two.state.doc.toString()).toBe("Keep writing.");
    },
  );
  it.each([
    ["active-pane", "other-pane"],
    ["active-pane", "empty-pane"],
    ["active-pane", "removed-pane"],
    ["active-pane", "workspace"],
    ["active-pane", "version-history"],
    ["active-pane", "disabled"],
    ["all-panes", "workspace"],
    ["all-panes", "version-history"],
    ["all-panes", "disabled"],
  ] as const)("%s recovers permanently after %s", (layout, reason) => {
    const store = setup(layout);
    const { rerender } = render(
      <Provider store={store}>
        <Harness />
      </Provider>,
    );
    act(() => store.set(toggleFocusModeAtom));
    expect(store.get(focusModePaneIdAtom)).toBe("pane-one");
    act(() => {
      if (reason === "other-pane") store.set(activePaneIdAtom, "pane-two");
      if (reason === "empty-pane")
        store.set(workspacePanesAtom, (panes) =>
          panes.map((pane) => (pane.id === "pane-one" ? { ...pane, tabs: [], activeTabId: null } : pane)),
        );
      if (reason === "removed-pane")
        store.set(workspacePanesAtom, (panes) => panes.filter((pane) => pane.id !== "pane-one"));
      if (reason === "workspace") workspacePath = "/different";
      if (reason === "version-history") store.set(versionHistoryOpenRequestAtom, 1);
    });
    rerender(
      <Provider store={store}>
        <Harness enabled={reason !== "disabled"} />
      </Provider>,
    );
    expect(store.get(focusModePaneIdAtom)).toBeNull();
    expect(store.get(focusModeTargetPaneIdAtom)).toBeNull();
    act(() => store.set(activePaneIdAtom, "pane-one"));
    expect(store.get(focusModePaneIdAtom)).toBeNull();
  });
  it("retains focus for navigation inside the same pane", () => {
    const store = setup();
    render(
      <Provider store={store}>
        <Harness />
      </Provider>,
    );
    act(() => {
      store.set(toggleFocusModeAtom);
      store.set(workspaceTabsByIdAtom, (tabs) => ({
        ...tabs,
        "tab-0": { ...tabs["tab-0"], currentResourceKey: tabs["tab-1"].currentResourceKey },
      }));
    });
    expect(store.get(focusModePaneIdAtom)).toBe("pane-one");
  });
  it("shows save errors and actionable conflicts while omitting the Saved indicator", () => {
    const store = setup();
    render(
      <Provider store={store}>
        <Harness />
      </Provider>,
    );
    act(() => store.set(toggleFocusModeAtom));
    expect(screen.queryByText("Saved")).toBeNull();
    act(() => store.set(fileSaveStatesByPathAtom, { "/notes/one.md": { phase: "error", message: "Disk full" } }));
    expect(screen.getByRole("alert").textContent).toContain("Save failed");
    act(() =>
      store.set(fileSaveStatesByPathAtom, { "/notes/one.md": { phase: "conflict", message: "Changed externally" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Changed on disk" }));
    expect(store.get(fileConflictReviewRequestAtom)).toEqual({ path: "/notes/one.md" });
  });
});
