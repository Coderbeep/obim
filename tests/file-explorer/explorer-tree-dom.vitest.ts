import { describe, expect, it } from "vitest";

import {
  getExplorerTreeEventTarget,
  getExplorerTreeRowElement,
  getExplorerTreeRowSelector,
  getExplorerTreeScrollElement,
  isExplorerTreeBackgroundEvent,
} from "../../src/renderer/src/features/files/explorer/tree/explorerTreeDom";

const eventWithPath = (...path: EventTarget[]) => ({ composedPath: () => path }) as unknown as Event;

describe("explorer tree DOM boundary", () => {
  it("extracts canonical row identity and icon intent from a composed path", () => {
    const label = document.createElement("span");
    const icon = document.createElement("span");
    const row = document.createElement("div");
    icon.dataset.itemSection = "icon";
    row.dataset.type = "item";
    row.dataset.itemPath = "Projects/plan.md";

    expect(getExplorerTreeEventTarget(eventWithPath(label, icon, row, document.body))).toEqual({
      clickedIcon: true,
      rowPath: "Projects/plan.md",
    });
    expect(getExplorerTreeEventTarget(eventWithPath(label, row))).toEqual({
      clickedIcon: false,
      rowPath: "Projects/plan.md",
    });
  });

  it("ignores context-menu triggers, missing rows, and rows without identity", () => {
    const trigger = document.createElement("button");
    const row = document.createElement("div");
    const unidentifiedRow = document.createElement("div");
    trigger.dataset.type = "context-menu-trigger";
    row.dataset.type = "item";
    row.dataset.itemPath = "note.md";
    unidentifiedRow.dataset.type = "item";

    expect(getExplorerTreeEventTarget(eventWithPath(trigger, row))).toBeNull();
    expect(getExplorerTreeEventTarget(eventWithPath(document.createElement("span")))).toBeNull();
    expect(getExplorerTreeEventTarget(eventWithPath(document.createElement("span"), unidentifiedRow))).toBeNull();
    expect(getExplorerTreeEventTarget(eventWithPath(window, document))).toBeNull();
  });

  it("uses the nearest item identity while retaining icon intent from the entire path", () => {
    const icon = document.createElement("span");
    const inner = document.createElement("div");
    const outer = document.createElement("div");
    icon.dataset.itemSection = "icon";
    inner.dataset.type = "item";
    inner.dataset.itemPath = "nearest.md";
    outer.dataset.type = "item";
    outer.dataset.itemPath = "outer.md";

    expect(getExplorerTreeEventTarget(eventWithPath(icon, inner, outer))).toEqual({
      clickedIcon: true,
      rowPath: "nearest.md",
    });
  });

  it.each([
    "folder/note.md",
    'folder/quote"note.md',
    "folder/back\\slash.md",
    "folder/line\nbreak.md",
    "folder/tab\tnote.md",
    "folder/delete\u007fnote.md",
    "Zażółć/🚀.md",
  ])("finds a shadow row with selector-sensitive path %j", (rowPath) => {
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const row = document.createElement("div");
    row.dataset.type = "item";
    row.dataset.itemPath = rowPath;
    shadowRoot.append(row);

    const model = { getFileTreeContainer: () => host };
    expect(shadowRoot.querySelector(getExplorerTreeRowSelector(rowPath))).toBe(row);
    expect(getExplorerTreeRowElement(model as never, rowPath)).toBe(row);
  });

  it("returns null when Pierre's host or shadow tree is unavailable", () => {
    expect(getExplorerTreeRowElement({ getFileTreeContainer: () => null } as never, "note.md")).toBeNull();
    expect(
      getExplorerTreeRowElement({ getFileTreeContainer: () => document.createElement("div") } as never, "note.md"),
    ).toBeNull();
    expect(getExplorerTreeScrollElement({ getFileTreeContainer: () => null } as never)).toBeNull();
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" });
    expect(getExplorerTreeScrollElement({ getFileTreeContainer: () => host } as never)).toBeNull();
  });

  it("replaces a null byte in CSS string selectors", () => {
    expect(getExplorerTreeRowSelector("bad\0path")).toContain("bad\uFFFDpath");
  });

  it("finds only Pierre's virtualized scroll owner", () => {
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const decoy = document.createElement("div");
    const scroll = document.createElement("div");
    scroll.dataset.fileTreeVirtualizedScroll = "true";
    shadowRoot.append(decoy, scroll);

    expect(getExplorerTreeScrollElement({ getFileTreeContainer: () => host } as never)).toBe(scroll);
  });

  it("recognizes only blank virtual-scroll events as root context-menu requests", () => {
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const scroll = document.createElement("div");
    const blank = document.createElement("div");
    const row = document.createElement("div");
    const trigger = document.createElement("button");
    const unrelated = document.createElement("div");
    scroll.dataset.fileTreeVirtualizedScroll = "true";
    row.dataset.type = "item";
    row.dataset.itemPath = "note.md";
    trigger.dataset.type = "context-menu-trigger";
    scroll.append(blank, row, trigger);
    shadowRoot.append(scroll, unrelated);
    const model = { getFileTreeContainer: () => host } as never;

    expect(isExplorerTreeBackgroundEvent(eventWithPath(blank, scroll, shadowRoot), model)).toBe(true);
    expect(isExplorerTreeBackgroundEvent(eventWithPath(row, scroll, shadowRoot), model)).toBe(false);
    expect(isExplorerTreeBackgroundEvent(eventWithPath(trigger, scroll, shadowRoot), model)).toBe(false);
    expect(isExplorerTreeBackgroundEvent(eventWithPath(unrelated, shadowRoot), model)).toBe(false);
  });
});
