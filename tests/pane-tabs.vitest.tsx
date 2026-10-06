// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PaneTabs } from "../src/renderer/src/features/workspace/PaneTabs";
import { contextMenuRequestAtom } from "../src/renderer/src/store/contextMenuStore";
import type { WorkspacePaneState } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab } from "../src/renderer/src/store/editorTabStore";
import { createFileWorkspaceItem, createTaskBoardWorkspaceItem } from "../src/shared/workspace";
import type { FileItem } from "../src/shared/file-item";

const note = (name: string): Extract<FileItem, { isDirectory: false }> => ({
  id: `/notes/${name}.md`,
  filename: `${name}.md`,
  relativePath: `${name}.md`,
  path: `/notes/${name}.md`,
  isDirectory: false,
  mimeType: "text/markdown",
});

const files = [note("Alpha"), note("Beta"), note("Gamma")];
const items = files.map(createFileWorkspaceItem);
const tabsById = Object.fromEntries(
  items.map((item, index) => [`tab-${index + 1}`, createEditorTab(`tab-${index + 1}`, item.key)]),
);
const pane: WorkspacePaneState = { id: "pane-1", tabs: Object.keys(tabsById), activeTabId: "tab-1", size: 1 };
const secondPane: WorkspacePaneState = { id: "pane-2", tabs: [], activeTabId: null, size: 1 };

const setup = () => {
  const store = createStore();
  const actions = {
    activateTab: vi.fn(),
    closeTab: vi.fn(),
    closeOtherTabs: vi.fn(),
    movePane: vi.fn(() => true),
    moveTab: vi.fn(),
    moveTabToNewPane: vi.fn(() => true),
    reopenLastClosedTab: vi.fn(),
  };
  render(
    <Provider store={store}>
      <PaneTabs
        {...actions}
        canReopenClosedTab
        isActive
        onPaneDragOver={vi.fn()}
        onPaneDrop={vi.fn()}
        onTabDragStart={vi.fn()}
        openWorkspaceItemsByKey={Object.fromEntries(items.map((item) => [item.key, item]))}
        pane={pane}
        panes={[pane, secondPane]}
        resolveWorkspaceItem={(key, openItems) => openItems[key] ?? null}
        tabsById={tabsById}
        views={{ file: { render: () => null, getTitle: (item) => ("file" in item ? item.file.filename : item.key) } }}
      />
    </Provider>,
  );
  return { actions, store };
};

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe("PaneTabs accessibility and overflow", () => {
  it("leaves Arrow, Home, and End keys unhandled by workspace tabs", () => {
    const { actions } = setup();
    const alpha = screen.getByRole("tab", { name: "Alpha.md" });
    alpha.focus();
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(fireEvent.keyDown(alpha, { key })).toBe(true);
      expect(document.activeElement).toBe(alpha);
    }
    expect(actions.activateTab).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Beta.md" }));
    expect(actions.activateTab).toHaveBeenCalledWith("pane-1", "tab-2");
  });

  it("provides an all-tabs list and common close actions", async () => {
    const user = userEvent.setup();
    const { actions } = setup();

    const overflow = screen.getByRole("button", { name: "Show all tabs and tab actions" });
    expect(overflow.querySelectorAll("svg")).toHaveLength(1);
    await user.click(overflow);
    expect(screen.getByRole("menuitem", { name: /Alpha.md/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Beta.md" })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "Close other tabs" }));
    expect(actions.closeOtherTabs).toHaveBeenCalledWith("pane-1", "tab-1");
  });

  it("keeps the tab context menu focused on an icon-bearing close action", () => {
    const { store, actions } = setup();
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Beta.md" }).closest(".pane-tab")!);
    const entries = store.get(contextMenuRequestAtom)?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "action", id: "close-tab", label: "Close tab" });
    if (entries[0].kind === "action") {
      expect(entries[0].icon).toBeTruthy();
      entries[0].onSelect();
    }
    expect(actions.closeTab).toHaveBeenCalledWith("pane-1", "tab-2");
  });

  it("pins app tabs as icons before document tabs", () => {
    const store = createStore();
    const taskBoard = createTaskBoardWorkspaceItem();
    const appItems = [items[0], taskBoard, items[1]];
    const appTabs = Object.fromEntries(
      appItems.map((item, index) => [`app-tab-${index}`, createEditorTab(`app-tab-${index}`, item.key)]),
    );
    const appPane: WorkspacePaneState = {
      id: "pane-apps",
      tabs: Object.keys(appTabs),
      activeTabId: "app-tab-1",
      size: 1,
    };
    const AppIcon = ({ size }: { size?: number }) => <svg data-size={size} />;
    const closeTab = vi.fn();

    const { container } = render(
      <Provider store={store}>
        <PaneTabs
          activateTab={vi.fn()}
          canReopenClosedTab={false}
          closeOtherTabs={vi.fn()}
          closeTab={closeTab}
          isActive
          movePane={vi.fn(() => true)}
          moveTab={vi.fn()}
          moveTabToNewPane={vi.fn(() => true)}
          onPaneDragOver={vi.fn()}
          onPaneDrop={vi.fn()}
          onTabDragStart={vi.fn()}
          openWorkspaceItemsByKey={Object.fromEntries(appItems.map((item) => [item.key, item]))}
          pane={appPane}
          panes={[appPane]}
          reopenLastClosedTab={vi.fn()}
          resolveWorkspaceItem={(key, openItems) => openItems[key] ?? null}
          tabsById={appTabs}
          views={{
            file: { render: () => null, getTitle: (item) => ("file" in item ? item.file.filename : item.key) },
            [taskBoard.kind]: { render: () => null, getTabIcon: () => AppIcon, getTitle: () => "Task Board" },
          }}
        />
      </Provider>,
    );

    const pinned = container.querySelector(".pane-tabs-apps");
    const documentRow = container.querySelector(".pane-tabs-row");
    expect(pinned?.nextElementSibling).toBe(documentRow);
    expect([...pinned!.querySelectorAll("[role='tab']")].map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Task Board",
    ]);
    expect(pinned?.querySelectorAll(".pane-tab-title")).toHaveLength(0);
    expect([...documentRow!.querySelectorAll("[role='tab']")].map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Alpha.md",
      "Beta.md",
    ]);

    const taskBoardTab = screen.getByRole("tab", { name: "Task Board" });
    vi.spyOn(taskBoardTab.closest<HTMLElement>(".pane-tab")!, "getBoundingClientRect").mockReturnValue({
      bottom: 31,
      height: 31,
      left: 0,
      right: 34,
      top: 0,
      width: 34,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.mouseUp(taskBoardTab, { button: 1, clientX: 17, clientY: 15 });
    expect(closeTab).toHaveBeenCalledWith("pane-apps", "app-tab-1");
    expect(documentRow?.classList.contains("pane-tabs-row-freeze")).toBe(false);
  });
});
