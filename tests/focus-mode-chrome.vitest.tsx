import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "postcss";
import { readFileSync } from "node:fs";
import { FocusModeChrome, useFocusModeBar } from "../src/renderer/src/app/FocusModeChrome";
import { FocusModeControls } from "../src/renderer/src/app/FocusModeControls";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import {
  focusModeLayoutAtom,
  focusModePaneIdAtom,
  focusModeRevealedEdgeAtom,
  toggleFocusModeAtom,
  type FocusModeEdge,
} from "../src/renderer/src/store/focusModeStore";

const Surface = ({ edge }: { edge: FocusModeEdge }) => {
  const { focused, revealed } = useFocusModeBar(edge);
  const className = edge === "bottom" ? "app-status-bar" : edge === "left" ? "sidebar-shell" : "right-sidebar-shell";
  return (
    <div
      className={className}
      data-side={edge}
      data-focus-revealed={revealed || undefined}
      inert={focused && !revealed}
      aria-hidden={(focused && !revealed) || undefined}
    >
      <button>{edge} action</button>
      {edge === "bottom" && <FocusModeControls />}
    </div>
  );
};
const Harness = () => {
  const focused = Boolean(useAtomValue(focusModePaneIdAtom));
  const layout = useAtomValue(focusModeLayoutAtom);
  return (
    <div
      className="app-shell"
      data-focus-mode={focused || undefined}
      data-focus-mode-layout={focused ? layout : undefined}
    >
      <header className="window-title-bar">Obim</header>
      <FocusModeChrome />
      <div className="app-content">
        <main className="root-layout">
          <Surface edge="left" />
          <textarea aria-label="Document" />
          <Surface edge="right" />
        </main>
      </div>
      <Surface edge="bottom" />
    </div>
  );
};
const setup = (layout: "active-pane" | "all-panes" = "active-pane") => {
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
  const surfaceBounds = [
    [".sidebar-shell", { left: 0, top: 0, right: 300, bottom: 700, width: 300, height: 700 }],
    [".right-sidebar-shell", { left: 700, top: 0, right: 1000, bottom: 700, width: 300, height: 700 }],
    [".app-status-bar", { left: 0, top: 672, right: 1000, bottom: 700, width: 1000, height: 28 }],
  ] as const;
  for (const [selector, bounds] of surfaceBounds)
    view.container.querySelector(selector)!.getBoundingClientRect = () => bounds as DOMRect;
  act(() => store.set(toggleFocusModeAtom));
  return { ...view, store };
};
const advance = () => act(() => vi.advanceTimersByTime(200));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("focus mode edge overlays", () => {
  it.each(["active-pane", "all-panes"] as const)(
    "reveals physical edges and hides them after returning to the document in %s",
    (layout) => {
      const { store, container } = setup(layout);
      const doc = screen.getByRole("textbox", { name: "Document" });
      expect(screen.queryByRole("button", { name: "Exit focus mode" })).toBeNull();
      const surfaces = [".sidebar-shell", ".right-sidebar-shell", ".app-status-bar"];
      const positions = [
        { clientX: 1, clientY: 300 },
        { clientX: 999, clientY: 300 },
        { clientX: 500, clientY: 699 },
      ];
      for (const [i, edge] of (["left", "right", "bottom"] as const).entries()) {
        fireEvent.pointerMove(doc, positions[i]);
        expect(store.get(focusModeRevealedEdgeAtom)).toBe(edge);
        const surface = container.querySelector(surfaces[i])!;
        expect(surface.hasAttribute("inert")).toBe(false);
        expect(screen.getByRole("button", { name: `${edge} action` })).toBeTruthy();
        fireEvent.pointerMove(surface, {
          clientX: edge === "right" ? 900 : 100,
          clientY: edge === "bottom" ? 680 : 300,
        });
        advance();
        expect(store.get(focusModeRevealedEdgeAtom)).toBe(edge);
        if (edge === "bottom") expect(screen.getByRole("button", { name: "Exit focus mode" })).toBeTruthy();
        fireEvent.pointerMove(doc, { clientX: 500, clientY: 350 });
        expect(store.get(focusModeRevealedEdgeAtom)).toBe(edge);
        advance();
        expect(store.get(focusModeRevealedEdgeAtom)).toBeNull();
        expect(surface.hasAttribute("inert")).toBe(true);
      }
    },
  );
  it.each([
    [
      "left",
      { clientX: 49, clientY: 350 },
      { clientX: 40, clientY: 350 },
      { clientX: 320, clientY: 350 },
      { clientX: 325, clientY: 350 },
    ],
    [
      "right",
      { clientX: 951, clientY: 350 },
      { clientX: 960, clientY: 350 },
      { clientX: 680, clientY: 350 },
      { clientX: 675, clientY: 350 },
    ],
    [
      "bottom",
      { clientX: 500, clientY: 651 },
      { clientX: 500, clientY: 660 },
      { clientX: 500, clientY: 650 },
      { clientX: 500, clientY: 647 },
    ],
  ] as const)(
    "reveals %s before reaching the edge and tolerates proximity to the open bar",
    (edge, outside, nearEdge, nearBar, away) => {
      const { store } = setup();
      const doc = screen.getByRole("textbox", { name: "Document" });
      fireEvent.pointerMove(doc, outside);
      advance();
      expect(store.get(focusModeRevealedEdgeAtom)).toBeNull();
      fireEvent.pointerMove(doc, nearEdge);
      expect(store.get(focusModeRevealedEdgeAtom)).toBe(edge);
      fireEvent.pointerMove(doc, nearBar);
      advance();
      expect(store.get(focusModeRevealedEdgeAtom)).toBe(edge);
      fireEvent.pointerMove(doc, away);
      advance();
      expect(store.get(focusModeRevealedEdgeAtom)).toBeNull();
    },
  );
  it("keeps sidebar controls usable near the bottom corner, then allows switching bars", () => {
    const { store, container } = setup();
    const doc = screen.getByRole("textbox", { name: "Document" });
    fireEvent.pointerMove(doc, { clientX: 20, clientY: 350 });
    fireEvent.pointerMove(container.querySelector(".sidebar-shell")!, { clientX: 20, clientY: 690 });
    advance();
    expect(store.get(focusModeRevealedEdgeAtom)).toBe("left");
    fireEvent.pointerMove(doc, { clientX: 500, clientY: 680 });
    expect(store.get(focusModeRevealedEdgeAtom)).toBe("bottom");
    fireEvent.pointerMove(doc, { clientX: 980, clientY: 350 });
    expect(store.get(focusModeRevealedEdgeAtom)).toBe("right");
  });
  it("cancels a pending hide when the pointer returns near the bar", () => {
    const { store } = setup();
    const doc = screen.getByRole("textbox", { name: "Document" });
    fireEvent.pointerMove(doc, { clientX: 20, clientY: 350 });
    fireEvent.pointerMove(doc, { clientX: 500, clientY: 350 });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.pointerMove(doc, { clientX: 310, clientY: 350 });
    advance();
    expect(store.get(focusModeRevealedEdgeAtom)).toBe("left");
  });
  it("keeps keyboard and portaled menu interaction usable, and clears the session on exit", () => {
    const { store } = setup();
    act(() => screen.getByRole("button", { name: "Show left sidebar" }).focus());
    const action = screen.getByRole("button", { name: "left action" });
    fireEvent.click(screen.getByRole("button", { name: "Show left sidebar" }));
    act(() => vi.advanceTimersByTime(0));
    expect(document.activeElement).toBe(action);
    const doc = screen.getByRole("textbox", { name: "Document" });
    fireEvent.pointerMove(doc, { clientX: 500, clientY: 350 });
    advance();
    expect(store.get(focusModeRevealedEdgeAtom)).toBe("left");
    const portal = document.createElement("div");
    portal.setAttribute("role", "menu");
    portal.tabIndex = 0;
    document.body.append(portal);
    act(() => portal.focus());
    fireEvent.pointerMove(portal, { clientX: 500, clientY: 350 });
    advance();
    expect(store.get(focusModeRevealedEdgeAtom)).toBe("left");
    portal.remove();
    act(() => doc.focus());
    advance();
    expect(store.get(focusModeRevealedEdgeAtom)).toBeNull();
    fireEvent.pointerMove(doc, { clientX: 500, clientY: 699 });
    fireEvent.click(screen.getByRole("button", { name: "Exit focus mode" }));
    expect(store.get(focusModePaneIdAtom)).toBeNull();
    expect(store.get(focusModeRevealedEdgeAtom)).toBeNull();
    act(() => store.set(toggleFocusModeAtom));
    expect(store.get(focusModeRevealedEdgeAtom)).toBeNull();
  });
  it("does not reveal while selecting/dragging and dismisses on window blur", () => {
    const { store } = setup();
    const doc = screen.getByRole("textbox", { name: "Document" });
    fireEvent.pointerMove(doc, { clientX: 1, clientY: 300, buttons: 1 });
    expect(store.get(focusModeRevealedEdgeAtom)).toBeNull();
    fireEvent.pointerMove(doc, { clientX: 1, clientY: 300 });
    expect(store.get(focusModeRevealedEdgeAtom)).toBe("left");
    fireEvent.blur(window);
    expect(store.get(focusModeRevealedEdgeAtom)).toBeNull();
  });
  it("slides from each physical side and respects the reduced-motion override", () => {
    const css = readFileSync("src/renderer/src/app/FocusMode.css", "utf8");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    try {
      const { container, store } = setup();
      const left = container.querySelector(".sidebar-shell")!;
      const right = container.querySelector(".right-sidebar-shell")!;
      expect(getComputedStyle(left).transform).toBe("translateX(calc(-100% - 24px))");
      expect(getComputedStyle(right).transform).toBe("translateX(calc(100% + 24px))");
      act(() => store.set(focusModeRevealedEdgeAtom, "left"));
      expect(getComputedStyle(left).transform).toBe("translate(0, 0)");
      act(() => store.set(focusModeRevealedEdgeAtom, "right"));
      expect(getComputedStyle(right).transform).toBe("translate(0, 0)");
      // Apply the authored reduced-motion branch directly: jsdom does not evaluate media preferences.
      const reducedRules: string[] = [];
      parse(css).walkAtRules("media", (rule) => {
        if (rule.params === "(prefers-reduced-motion: reduce)")
          rule.nodes?.forEach((node) => reducedRules.push(node.toString()));
      });
      expect(reducedRules.length).toBeGreaterThan(0);
      style.textContent += reducedRules.join("\n");
      for (const selector of [".sidebar-shell", ".right-sidebar-shell", ".app-status-bar"])
        expect(getComputedStyle(container.querySelector(selector)!).transition).toBe("none");
    } finally {
      style.remove();
    }
  });
  it("uses out-of-flow bars and no top reservation in the real focus stylesheet", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/renderer/src/app/FocusMode.css", "utf8");
    document.head.append(style);
    try {
      const { container } = setup();
      expect(getComputedStyle(container.querySelector(".window-title-bar")!).display).toBe("none");
      expect(getComputedStyle(container.querySelector(".app-content")!).paddingTop).toBe("0px");
      for (const selector of [".sidebar-shell", ".right-sidebar-shell", ".app-status-bar"]) {
        expect(getComputedStyle(container.querySelector(selector)!).position).toBe("absolute");
        const css = getComputedStyle(container.querySelector(selector)!);
        expect(css.display).toBe("flex");
        expect(css.visibility).toBe("hidden");
        expect(css.opacity).toBe("0");
        expect(css.pointerEvents).toBe("none");
        expect(css.transition).toContain("transform");
        expect(css.transition).toContain("opacity");
        expect(css.transition).toContain("visibility 0s linear var(--motion-panel-duration)");
      }
      fireEvent.pointerMove(screen.getByRole("textbox"), { clientX: 500, clientY: 699 });
      const footer = container.querySelector(".app-status-bar")!;
      expect(getComputedStyle(footer).visibility).toBe("visible");
      expect(getComputedStyle(footer).opacity).toBe("1");
      expect(getComputedStyle(footer).transform).toBe("translate(0, 0)");
      expect(getComputedStyle(footer).pointerEvents).toBe("auto");
      expect(getComputedStyle(footer).transitionDelay).toBe("0s");
      fireEvent.pointerMove(screen.getByRole("textbox"), { clientX: 500, clientY: 350 });
      advance();
      expect(getComputedStyle(footer).opacity).toBe("0");
      expect(getComputedStyle(footer).transform).toBe("translateY(calc(100% + 18px))");
      expect(footer.hasAttribute("inert")).toBe(true);
    } finally {
      style.remove();
    }
  });
});
