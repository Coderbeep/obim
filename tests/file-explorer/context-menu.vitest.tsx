import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider, useSetAtom } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextMenuHost } from "../../src/renderer/src/features/context-menu/ContextMenuHost";
import { contextMenuRequestAtom, openContextMenuAtom } from "../../src/renderer/src/store/contextMenuStore";

const TestIcon = (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="menu-icon" {...props} />;
const rect = (left: number, top: number, width: number, height: number) =>
  ({
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const MenuAnchor = ({ toggleOnRepeat = false }: { toggleOnRepeat?: boolean }) => {
  const open = useSetAtom(openContextMenuAtom);
  const openMenu = (anchor: HTMLButtonElement) =>
    open({
      key: toggleOnRepeat ? "toggle-anchor" : "regular-anchor",
      anchor,
      position: { x: 10, y: 20 },
      entries: [{ kind: "action", id: "open", label: "Open", icon: TestIcon, onSelect: vi.fn() }],
      toggleOnRepeat,
    });

  return (
    <button
      type="button"
      onClick={(event) => {
        if (toggleOnRepeat) openMenu(event.currentTarget);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(event.currentTarget);
      }}
    >
      {toggleOnRepeat ? "Toggle anchor" : "Regular anchor"}
    </button>
  );
};

describe("context-menu actions", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  });

  it("closes and clears the request before invoking a keyboard-selected action", async () => {
    const store = createStore();
    const action = vi.fn(() => expect(store.get(contextMenuRequestAtom)).toBeNull());
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <ContextMenuHost />
      </Provider>,
    );
    act(() => {
      store.set(openContextMenuAtom, {
        key: "file:note.md",
        anchor: null,
        position: { x: 10, y: 20 },
        entries: [{ kind: "action", id: "rename", label: "Rename", icon: TestIcon, onSelect: action }],
      });
    });

    const item = screen.getByRole("menuitem", { name: "Rename" });
    item.focus();
    await user.keyboard("{Enter}");

    expect(action).toHaveBeenCalledOnce();
    expect(store.get(contextMenuRequestAtom)).toBeNull();
  });

  it("clears captured actions when the menu is dismissed", async () => {
    const store = createStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <ContextMenuHost />
      </Provider>,
    );
    act(() => {
      store.set(openContextMenuAtom, {
        key: "file:note.md",
        anchor: null,
        position: { x: 10, y: 20 },
        entries: [{ kind: "action", id: "delete", label: "Delete", icon: TestIcon, onSelect: vi.fn() }],
      });
    });

    screen.getByRole("menu").focus();
    await user.keyboard("{Escape}");
    expect(store.get(contextMenuRequestAtom)).toBeNull();
  });

  it("closes a regular menu on an anchor left-click without breaking toggle anchors", async () => {
    const store = createStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <MenuAnchor />
        <MenuAnchor toggleOnRepeat />
        <ContextMenuHost />
      </Provider>,
    );

    const regularAnchor = screen.getByRole("button", { name: "Regular anchor" });
    fireEvent.contextMenu(regularAnchor);
    expect(store.get(contextMenuRequestAtom)?.key).toBe("regular-anchor");

    await user.click(regularAnchor);
    expect(store.get(contextMenuRequestAtom)).toBeNull();

    const toggleAnchor = screen.getByRole("button", { name: "Toggle anchor" });
    await user.click(toggleAnchor);
    expect(store.get(contextMenuRequestAtom)?.key).toBe("toggle-anchor");

    await user.click(toggleAnchor);
    expect(store.get(contextMenuRequestAtom)).toBeNull();
  });

  it("uses the shared compact menu style and marks destructive actions", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <ContextMenuHost />
      </Provider>,
    );
    act(() => {
      store.set(openContextMenuAtom, {
        key: "file:note.md",
        anchor: null,
        position: { x: 10, y: 20 },
        entries: [
          { kind: "action", id: "copy", label: "Copy", icon: TestIcon, onSelect: vi.fn() },
          { kind: "action", id: "delete", label: "Delete", icon: TestIcon, danger: true, onSelect: vi.fn() },
        ],
      });
    });

    const normal = screen.getByRole("menuitem", { name: "Copy" });
    const danger = screen.getByRole("menuitem", { name: "Delete" });
    expect(screen.getByRole("menu").classList.contains("menu-surface")).toBe(true);
    expect(screen.getByRole("menu").classList.contains("p-1")).toBe(true);
    expect(normal.classList.contains("menu-option")).toBe(true);
    expect(normal.getAttribute("data-density")).toBe("compact");
    expect(normal.hasAttribute("data-danger")).toBe(false);
    expect(danger.classList.contains("menu-option")).toBe(true);
    expect(danger.getAttribute("data-density")).toBe("compact");
    expect(danger.getAttribute("data-danger")).toBe("true");
    expect(danger.querySelector("svg")?.classList.contains("text-destructive")).toBe(false);
  });

  it("sizes to its widest entry up to the shared maximum and truncates long labels", () => {
    const store = createStore();
    const label = "A context-menu label that is deliberately much wider than the maximum";
    render(
      <Provider store={store}>
        <ContextMenuHost />
      </Provider>,
    );
    act(() => {
      store.set(openContextMenuAtom, {
        key: "file:long-label.md",
        anchor: null,
        position: { x: 10, y: 20 },
        entries: [{ kind: "action", id: "long", label, icon: TestIcon, onSelect: vi.fn() }],
      });
    });

    const menu = screen.getByRole("menu");
    const item = screen.getByRole("menuitem", { name: label });
    const itemLabel = item.querySelector("span");
    expect(menu.classList.contains("w-max")).toBe(true);
    expect(menu.classList.contains("max-w-[min(20rem,calc(100vw-1rem))]")).toBe(true);
    expect(itemLabel?.classList.contains("truncate")).toBe(true);
    expect(itemLabel?.title).toBe(label);
  });

  it("does not execute disabled Paste", async () => {
    const store = createStore();
    const action = vi.fn();
    const user = userEvent.setup();
    render(
      <Provider store={store}>
        <ContextMenuHost />
      </Provider>,
    );
    act(() => {
      store.set(openContextMenuAtom, {
        key: "directory:root",
        anchor: null,
        position: { x: 10, y: 20 },
        entries: [
          {
            kind: "action",
            id: "paste",
            label: "Paste",
            icon: TestIcon,
            disabled: true,
            onSelect: action,
          },
        ],
      });
    });

    const item = screen.getByRole("menuitem", { name: "Paste" });
    await user.click(item);
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(action).not.toHaveBeenCalled();
  });

  it("keeps the root menu inside every viewport edge", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.id === "context-menu" ? rect(0, 0, 200, 160) : rect(0, 0, 0, 0);
    });
    const store = createStore();
    render(
      <Provider store={store}>
        <ContextMenuHost />
      </Provider>,
    );

    act(() => {
      store.set(openContextMenuAtom, {
        key: "file:edge.md",
        anchor: null,
        position: { x: 795, y: 595 },
        entries: [{ kind: "action", id: "open", label: "Open", icon: TestIcon, onSelect: vi.fn() }],
      });
    });

    const menu = screen.getByRole("menu");
    expect(menu.classList.contains("fixed")).toBe(true);
    expect(menu.style.left).toBe("592px");
    expect(menu.style.top).toBe("432px");
    expect(menu.style.visibility).toBe("visible");
  });

  it("opens submenus to the left and shifts them up near the bottom-right corner", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id === "context-menu") return rect(0, 0, 180, 100);
      if (this.getAttribute("role") === "menu") return rect(0, 0, 180, 120);
      if (this.tagName === "BUTTON") return rect(700, 500, 80, 24);
      return rect(0, 0, 0, 0);
    });
    const store = createStore();
    const user = userEvent.setup();
    const childAction = vi.fn();
    render(
      <Provider store={store}>
        <ContextMenuHost />
      </Provider>,
    );
    act(() => {
      store.set(openContextMenuAtom, {
        key: "file:edge.md",
        anchor: null,
        position: { x: 700, y: 500 },
        entries: [
          {
            kind: "action",
            id: "copy-menu",
            label: "Copy",
            icon: TestIcon,
            onSelect: vi.fn(),
            children: [
              {
                kind: "action",
                id: "copy-path",
                label: "Copy path",
                icon: TestIcon,
                onSelect: childAction,
              },
            ],
          },
        ],
      });
    });

    const copyMenu = screen.getByRole("menuitem", { name: "Copy" });
    await user.hover(copyMenu);
    const submenu = screen.getAllByRole("menu")[1];
    expect(copyMenu.getAttribute("aria-expanded")).toBe("true");
    expect(submenu.style.left).toBe("522px");
    expect(submenu.style.top).toBe("472px");
    expect(submenu.style.visibility).toBe("visible");

    await user.click(screen.getByRole("menuitem", { name: "Copy path" }));
    expect(childAction).toHaveBeenCalledOnce();
    expect(store.get(contextMenuRequestAtom)).toBeNull();
  });
});
