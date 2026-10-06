import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Panel: ({ children, className, id }: { children: ReactNode; className?: string; id?: string }) => (
    <div className={className} data-widget-field={id}>
      {children}
    </div>
  ),
  Separator: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div role="separator" className={className} {...props} />
  ),
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));

import { RightSidebarWidget, RightSidebarWidgetStack } from "../src/renderer/src/features/editor/inspector/WidgetStack";
import { AppDndProvider } from "../src/renderer/src/shared/dnd/AppDndProvider";

const TestIcon = () => <svg aria-hidden="true" />;

const renderStack = () =>
  render(
    <AppDndProvider>
      <RightSidebarWidgetStack autoSaveId="test-widget-stack">
        <RightSidebarWidget id="outline" title="Outline" icon={TestIcon}>
          Outline content
        </RightSidebarWidget>
        <RightSidebarWidget id="tasks" title="Tasks" icon={TestIcon}>
          Tasks content
        </RightSidebarWidget>
        <RightSidebarWidget id="links" title="Links" icon={TestIcon}>
          Links content
        </RightSidebarWidget>
      </RightSidebarWidgetStack>
    </AppDndProvider>,
  );

const dataTransfer = () => {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
    setDragImage: vi.fn(),
    get types() {
      return [...values.keys()];
    },
  };
};

const rect = (left: number, top: number, width: number, height: number) => ({
  bottom: top + height,
  height,
  left,
  right: left + width,
  top,
  width,
  x: left,
  y: top,
  toJSON: () => ({}),
});

const mockTabBarBounds = (tabList: HTMLElement) => {
  vi.spyOn(tabList, "getBoundingClientRect").mockReturnValue(rect(0, 0, 300, 28));
  [...tabList.querySelectorAll<HTMLElement>("[data-widget-tab]")].forEach((tab, index) => {
    vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(rect(12 + index * 88, 0, 84, 28));
  });
};

const fireDragAt = (
  target: HTMLElement,
  type: "dragOver" | "drop",
  transfer: ReturnType<typeof dataTransfer>,
  position: { x: number; y: number },
) => {
  const event =
    type === "dragOver"
      ? createEvent.dragOver(target, { dataTransfer: transfer })
      : createEvent.drop(target, { dataTransfer: transfer });
  Object.defineProperties(event, {
    clientX: { value: position.x },
    clientY: { value: position.y },
  });
  fireEvent(target, event);
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("RightSidebarWidgetStack", () => {
  it("locks widget scrolling during a drag and restores it afterward", () => {
    const { container } = renderStack();
    const content = screen.getByText("Outline content");
    Object.defineProperties(content, {
      scrollHeight: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 200 },
    });
    content.style.overflow = "auto";
    content.scrollTop = 120;
    const source = screen.getByRole("tab", { name: "Links" });
    const transfer = dataTransfer();
    fireEvent.dragStart(source, { clientX: 20, clientY: 20, dataTransfer: transfer });
    expect(content.style.overflow).toBe("hidden");
    content.scrollTop = 200;
    fireEvent.scroll(content);
    expect(content.scrollTop).toBe(120);
    const stack = container.querySelector("[data-widget-stack-drop-zone]")!;
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 });
    fireEvent(stack, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    fireEvent.dragEnd(source, { dataTransfer: transfer });
    expect(content.style.overflow).toBe("auto");
    expect(content.scrollTop).toBe(120);
    const after = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 });
    fireEvent(stack, after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("shows one widget per field and switches it from an accessible tab bar", () => {
    renderStack();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.every((tab) => tab.getAttribute("draggable") === "true")).toBe(true);
    expect(tabs.every((tab) => tab.closest("[data-widget-tab]")?.getAttribute("draggable") === null)).toBe(true);
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual(["Outline", "Tasks", "Links"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].closest("[data-widget-tab]")?.className).toContain("text-muted-foreground");
    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(3);

    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(screen.getByRole("tab", { name: "Tasks" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain("Tasks content");

    const tasks = screen.getByRole("tab", { name: "Tasks" });
    tasks.focus();
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(fireEvent.keyDown(tasks, { key })).toBe(true);
      expect(document.activeElement).toBe(tasks);
      expect(tasks.getAttribute("aria-selected")).toBe("true");
    }

  });

  it("reorders tabs and splits a dragged widget into a new vertical field", () => {
    const { container } = renderStack();
    const transfer = dataTransfer();
    const tasks = screen.getByRole("tab", { name: "Tasks" }).closest<HTMLElement>("[draggable]");
    if (!tasks) throw new Error("Expected draggable widget tabs");

    fireEvent.dragStart(tasks, { clientX: 20, clientY: 20, dataTransfer: transfer });
    expect(screen.getByText("Drop in a tab bar or between fields")).toBeTruthy();
    const tabList = screen.getByRole("tablist");
    mockTabBarBounds(tabList);
    fireDragAt(tabList, "dragOver", transfer, { x: 4, y: 14 });
    const farLeftIndicator = tabList.querySelector<HTMLElement>('[data-side="before"][data-active="true"]');
    expect(farLeftIndicator?.className).toContain("app-dnd-vertical-insertion-line");
    expect(screen.getByText("Insert at position 1")).toBeTruthy();

    fireDragAt(tabList, "dragOver", transfer, { x: 296, y: 14 });
    const farRightIndicator = tabList.querySelector<HTMLElement>("[data-widget-tab-end-insert-marker]");
    expect(farRightIndicator?.dataset.active).toBe("true");
    expect(screen.getByText("Insert at position 4")).toBeTruthy();

    fireDragAt(tabList, "dragOver", transfer, { x: 4, y: 14 });
    fireDragAt(tabList, "drop", transfer, { x: 4, y: 14 });
    expect(
      within(screen.getByRole("tablist"))
        .getAllByRole("tab")
        .map((tab) => tab.getAttribute("aria-label")),
    ).toEqual(["Tasks", "Outline", "Links"]);

    const splitTransfer = dataTransfer();
    const links = screen.getByRole("tab", { name: "Links" }).closest<HTMLElement>("[draggable]");
    let paneContent = container.querySelector<HTMLElement>("[data-widget-pane-content]");
    if (!links || !paneContent) throw new Error("Expected a widget tab and field content");
    fireEvent.dragStart(links, { clientX: 20, clientY: 20, dataTransfer: splitTransfer });
    paneContent = container.querySelector<HTMLElement>("[data-widget-pane-content]");
    if (!paneContent) throw new Error("Expected widget field content after drag start");
    vi.spyOn(paneContent, "getBoundingClientRect").mockReturnValue(rect(0, 0, 300, 300));
    fireDragAt(paneContent, "dragOver", splitTransfer, { x: 150, y: 280 });
    expect(screen.getByText("Place field below")).toBeTruthy();
    const outerPlaceholder = container.querySelector<HTMLElement>('[data-widget-field-placeholder="bottom"]');
    expect(outerPlaceholder?.className).toContain("app-dnd-split-indicator");
    expect(outerPlaceholder?.dataset.splitOrientation).toBe("horizontal");
    fireDragAt(paneContent, "drop", splitTransfer, { x: 150, y: 280 });

    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    expect(screen.getAllByRole("tab", { name: "Links" })).toHaveLength(1);
    expect(screen.getByRole("separator").className).toContain("app-dnd-widget-split-slot");
    expect(screen.getByRole("separator").getAttribute("data-drop-active")).toBeNull();

    const fieldTransfer = dataTransfer();
    const tasksField = screen.getByRole("tab", { name: "Tasks" }).closest<HTMLElement>("[draggable]");
    const separator = screen.getByRole("separator");
    if (!tasksField) throw new Error("Expected a widget to dock between fields");
    fireEvent.dragStart(tasksField, { clientX: 20, clientY: 20, dataTransfer: fieldTransfer });
    fireDragAt(separator, "dragOver", fieldTransfer, { x: 150, y: 300 });
    expect(separator.getAttribute("data-drop-active")).toBe("valid");
    expect(separator.className).not.toContain("transition-");
    const separatorSurface = separator.querySelector<HTMLElement>("[data-widget-field-placeholder-surface]");
    expect(separatorSurface?.className).toContain("app-dnd-split-indicator");
    expect(separatorSurface?.dataset.splitOrientation).toBe("horizontal");
    expect(separatorSurface?.dataset.splitOverlap).toBeUndefined();
    fireDragAt(separator, "drop", fieldTransfer, { x: 150, y: 300 });
    expect(screen.getAllByRole("tablist")).toHaveLength(3);
    expect(
      screen.getAllByRole("tablist").map((tabList) =>
        within(tabList)
          .getAllByRole("tab")
          .map((tab) => tab.getAttribute("aria-label")),
      ),
    ).toEqual([["Outline"], ["Tasks"], ["Links"]]);

    const reorderTransfer = dataTransfer();
    const linksField = screen.getByRole("tab", { name: "Links" }).closest<HTMLElement>("[draggable]");
    const firstSeparator = screen.getAllByRole("separator")[0];
    if (!linksField) throw new Error("Expected the single-widget field to remain draggable");
    fireEvent.dragStart(linksField, { clientX: 20, clientY: 500, dataTransfer: reorderTransfer });
    fireDragAt(firstSeparator, "dragOver", reorderTransfer, { x: 150, y: 200 });
    expect(firstSeparator.getAttribute("data-drop-active")).toBe("valid");
    expect(screen.getByText("Move field here")).toBeTruthy();
    fireDragAt(firstSeparator, "drop", reorderTransfer, { x: 150, y: 200 });
    expect(
      screen.getAllByRole("tablist").map((tabList) =>
        within(tabList)
          .getAllByRole("tab")
          .map((tab) => tab.getAttribute("aria-label")),
      ),
    ).toEqual([["Outline"], ["Links"], ["Tasks"]]);
  });

  it("commits the current far-right boundary even when the last hover was at the left", () => {
    renderStack();
    const transfer = dataTransfer();
    const source = screen.getByRole("tab", { name: "Outline" });
    const tabList = screen.getByRole("tablist");
    mockTabBarBounds(tabList);

    fireEvent.dragStart(source, { clientX: 20, clientY: 14, dataTransfer: transfer });
    fireDragAt(tabList, "dragOver", transfer, { x: 4, y: 14 });
    expect(tabList.querySelector('[data-side="before"][data-active="true"]')).toBeTruthy();
    fireDragAt(tabList, "drop", transfer, { x: 296, y: 14 });

    expect(
      within(tabList)
        .getAllByRole("tab")
        .map((tab) => tab.getAttribute("aria-label")),
    ).toEqual(["Tasks", "Links", "Outline"]);
    expect(tabList.querySelector('[data-active="true"]')).toBeNull();
  });

  it("moves a tab from another field directly before the first tab", () => {
    const { container } = renderStack();
    const splitTransfer = dataTransfer();
    const links = screen.getByRole("tab", { name: "Links" }).closest<HTMLElement>("[draggable]");
    let paneContent = container.querySelector<HTMLElement>("[data-widget-pane-content]");
    if (!links || !paneContent) throw new Error("Expected a widget tab and field content");

    fireEvent.dragStart(links, { clientX: 20, clientY: 20, dataTransfer: splitTransfer });
    paneContent = container.querySelector<HTMLElement>("[data-widget-pane-content]");
    if (!paneContent) throw new Error("Expected widget field content after drag start");
    vi.spyOn(paneContent, "getBoundingClientRect").mockReturnValue(rect(0, 0, 300, 300));
    fireDragAt(paneContent, "drop", splitTransfer, { x: 150, y: 280 });
    expect(screen.getAllByRole("tablist")).toHaveLength(2);

    const moveTransfer = dataTransfer();
    const movedLinks = screen.getByRole("tab", { name: "Links" }).closest<HTMLElement>("[draggable]");
    if (!movedLinks) throw new Error("Expected Links in its split field");
    fireEvent.dragStart(movedLinks, { clientX: 20, clientY: 320, dataTransfer: moveTransfer });

    const targetTabList = screen.getAllByRole("tablist")[0];
    mockTabBarBounds(targetTabList);
    fireDragAt(targetTabList, "dragOver", moveTransfer, { x: 4, y: 14 });
    fireDragAt(targetTabList, "drop", moveTransfer, { x: 4, y: 14 });

    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(
      within(screen.getByRole("tablist"))
        .getAllByRole("tab")
        .map((tab) => tab.getAttribute("aria-label")),
    ).toEqual(["Links", "Outline", "Tasks"]);
  });

  it("keeps a single-widget field at its adjacent separator instead of swapping fields", () => {
    const { container } = renderStack();
    const firstTransfer = dataTransfer();
    const links = screen.getByRole("tab", { name: "Links" }).closest<HTMLElement>("[draggable]");
    const firstContent = container.querySelector<HTMLElement>("[data-widget-pane-content]");
    if (!links || !firstContent) throw new Error("Expected a widget tab and field content");
    fireEvent.dragStart(links, { clientX: 20, clientY: 20, dataTransfer: firstTransfer });
    vi.spyOn(firstContent, "getBoundingClientRect").mockReturnValue(rect(0, 0, 300, 300));
    fireDragAt(firstContent, "drop", firstTransfer, { x: 150, y: 280 });

    const moveTransfer = dataTransfer();
    const movedLinks = screen.getByRole("tab", { name: "Links" }).closest<HTMLElement>("[draggable]");
    const separator = screen.getByRole("separator");
    if (!movedLinks) throw new Error("Expected the split widget tab");
    fireEvent.dragStart(movedLinks, { clientX: 20, clientY: 320, dataTransfer: moveTransfer });
    fireDragAt(separator, "dragOver", moveTransfer, { x: 150, y: 300 });

    expect(separator.getAttribute("data-drop-active")).toBe("invalid");
    expect(separator.querySelector("[data-widget-field-placeholder-surface]")).toBeNull();

    fireDragAt(separator, "drop", moveTransfer, { x: 150, y: 300 });
    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    expect(
      screen.getAllByRole("tablist").map((tabList) =>
        within(tabList)
          .getAllByRole("tab")
          .map((tab) => tab.getAttribute("aria-label")),
      ),
    ).toEqual([["Outline", "Tasks"], ["Links"]]);
  });

  it.each([
    [0, false, ["Outline", "Tasks", "Links"]],
    [1, true, ["Tasks", "Outline", "Links"]],
  ] as const)("places the first field at separator %s exactly as previewed", (separatorIndex, valid, expected) => {
    window.localStorage.setItem(
      "test-widget-stack:dock-layout:1",
      JSON.stringify(["outline", "tasks", "links"].map((id) => ({ id, tabs: [id], activeTabId: id, size: 1 }))),
    );
    renderStack();
    const transfer = dataTransfer();
    const source = screen.getByRole("tab", { name: "Outline" });
    fireEvent.dragStart(source, { clientX: 20, clientY: 20, dataTransfer: transfer });
    const separator = screen.getAllByRole("separator")[separatorIndex];
    fireDragAt(separator, "dragOver", transfer, { x: 150, y: 300 });
    expect(separator.getAttribute("data-drop-active")).toBe(valid ? "valid" : "invalid");
    fireDragAt(separator, "drop", transfer, { x: 150, y: 300 });
    expect(
      screen.getAllByRole("tablist").map((list) => within(list).getByRole("tab").getAttribute("aria-label")),
    ).toEqual(expected);
  });

  it.each(["top", "bottom"] as const)("shows an external %s placeholder and drops at that position", (edge) => {
    const { container } = renderStack();
    const transfer = dataTransfer();
    fireEvent.dragStart(screen.getByRole("tab", { name: "Links" }), {
      clientX: 20,
      clientY: 20,
      dataTransfer: transfer,
    });
    const slot = container.querySelector<HTMLElement>(`[data-widget-outer-drop-edge="${edge}"]`);
    if (!slot) throw new Error("Expected outer drop slot");
    fireDragAt(slot, "dragOver", transfer, { x: 150, y: edge === "top" ? 0 : 600 });
    const placeholder = container.querySelector(`[data-widget-field-placeholder="${edge}"]`);
    expect(placeholder).toBeTruthy();
    expect(placeholder?.closest("[data-widget-pane]")).toBeNull();
    fireDragAt(slot, "drop", transfer, { x: 150, y: edge === "top" ? 0 : 600 });
    const order = screen.getAllByRole("tablist").map((list) =>
      within(list)
        .getAllByRole("tab")
        .map((tab) => tab.getAttribute("aria-label")),
    );
    expect(order).toEqual(edge === "top" ? [["Links"], ["Outline", "Tasks"]] : [["Outline", "Tasks"], ["Links"]]);
    expect(container.querySelector("[data-widget-field-placeholder]")).toBeNull();
  });

  it("opens and keeps a field placeholder only at the bottom of a widget", () => {
    const { container } = renderStack();
    const splitTransfer = dataTransfer();
    const links = screen.getByRole("tab", { name: "Links" }).closest<HTMLElement>("[draggable]");
    const initialContent = container.querySelector<HTMLElement>("[data-widget-pane-content]");
    if (!links || !initialContent) throw new Error("Expected a widget tab and field content");

    fireEvent.dragStart(links, { clientX: 20, clientY: 20, dataTransfer: splitTransfer });
    vi.spyOn(initialContent, "getBoundingClientRect").mockReturnValue(rect(0, 0, 300, 300));
    fireDragAt(initialContent, "drop", splitTransfer, { x: 150, y: 280 });

    const moveTransfer = dataTransfer();
    const movedOutline = screen.getByRole("tab", { name: "Outline" }).closest<HTMLElement>("[draggable]");
    const secondContent = container.querySelectorAll<HTMLElement>("[data-widget-pane-content]")[1];
    if (!movedOutline || !secondContent) throw new Error("Expected the detached widget and second field");
    vi.spyOn(secondContent, "getBoundingClientRect").mockReturnValue(rect(0, 300, 300, 300));

    fireEvent.dragStart(movedOutline, { clientX: 20, clientY: 20, dataTransfer: moveTransfer });
    fireDragAt(secondContent, "dragOver", moveTransfer, { x: 150, y: 340 });
    expect(container.querySelector("[data-widget-field-placeholder]")).toBeNull();

    fireDragAt(secondContent, "dragOver", moveTransfer, { x: 150, y: 590 });

    const placeholder = container.querySelector<HTMLElement>('[data-widget-field-placeholder="bottom"]');
    expect(placeholder?.className).toContain("app-dnd-split-indicator");
    expect(placeholder?.dataset.splitOrientation).toBe("horizontal");
    expect(placeholder?.dataset.splitOverlap).toBeUndefined();
    expect(screen.getByText("Place field below")).toBeTruthy();

    fireEvent.dragLeave(secondContent, { dataTransfer: moveTransfer, relatedTarget: placeholder });
    expect(container.querySelector('[data-widget-field-placeholder="bottom"]')).toBeTruthy();

    fireDragAt(secondContent, "drop", moveTransfer, { x: 150, y: 590 });
    expect(
      screen.getAllByRole("tablist").map((tabList) =>
        within(tabList)
          .getAllByRole("tab")
          .map((tab) => tab.getAttribute("aria-label")),
      ),
    ).toEqual([["Tasks"], ["Links"], ["Outline"]]);
  });
});
