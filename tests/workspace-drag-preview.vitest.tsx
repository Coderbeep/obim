import { fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspacePaneGrid } from "../src/renderer/src/features/workspace/WorkspacePaneGrid";
import type { usePaneWorkspace } from "../src/renderer/src/features/workspace/usePaneWorkspace";
import type { WorkspaceItemViewMap } from "../src/renderer/src/features/workspace/workspaceItemView";
import { createFileWorkspaceItem } from "../src/shared/workspace";
import { createEditorTab } from "../src/renderer/src/store/editorTabStore";
import { FILE_DRAG_DATA_MIME, TAB_DRAG_DATA_MIME, TASK_BOARD_TASK_DRAG_DATA_MIME } from "../src/shared/drag-data";
import type { FileItem } from "../src/shared/file-item";
import { AppDndProvider } from "../src/renderer/src/shared/dnd/AppDndProvider";
import { useAppDraggable } from "../src/renderer/src/shared/dnd/useAppDraggable";

const ExplorerSource = () => {
  const props = useAppDraggable<HTMLDivElement>({
    entity: { kind: "explorer-item", id: "Untitled 1.md" },
    preview: { text: "Untitled 1" },
  });
  return <div data-testid="explorer-source" {...props} />;
};

class TestDragEvent extends Event {
  clientX: number;
  clientY: number;
  dataTransfer: DataTransfer | null;

  constructor(
    type: string,
    init: EventInit & { clientX?: number; clientY?: number; dataTransfer?: DataTransfer | null } = {},
  ) {
    super(type, init);
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.dataTransfer = init.dataTransfer ?? null;
  }
}

const file: FileItem = {
  id: "/notes/Untitled 1.md",
  filename: "Untitled 1",
  relativePath: "Untitled 1.md",
  path: "/notes/Untitled 1.md",
  isDirectory: false,
  mimeType: "text/markdown",
};

const createWorkspace = () => {
  const item = createFileWorkspaceItem(file);
  const tab = createEditorTab("tab-1", item.key);
  return {
    panes: [{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }],
    activePaneId: "pane-1",
    tabsById: { [tab.id]: tab },
    openWorkspaceItemsByKey: { [item.key]: item },
    activateTab: vi.fn(),
    closeTab: vi.fn().mockResolvedValue(true),
    closeActiveTab: vi.fn().mockResolvedValue(true),
    onTabDragStart: vi.fn((event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData(TAB_DRAG_DATA_MIME, JSON.stringify({ sourcePaneId: "pane-1", tabId: tab.id }));
    }),
    onPaneDragOver: vi.fn(),
    onPaneDrop: vi.fn(),
    onPaneSplitDrop: vi.fn().mockResolvedValue(true),
    resizePanePair: vi.fn(),
  } as unknown as ReturnType<typeof usePaneWorkspace>;
};

const createSplittableWorkspace = () => {
  const workspace = createWorkspace();
  const secondItem = createFileWorkspaceItem({
    ...file,
    id: "/notes/Untitled 2.md",
    filename: "Untitled 2",
    path: "/notes/Untitled 2.md",
    relativePath: "Untitled 2.md",
  });
  const secondTab = createEditorTab("tab-2", secondItem.key);
  workspace.panes[0].tabs.push(secondTab.id);
  workspace.tabsById[secondTab.id] = secondTab;
  workspace.openWorkspaceItemsByKey[secondItem.key] = secondItem;
  return workspace;
};

const createTwoPaneWorkspace = () => {
  const workspace = createSplittableWorkspace();
  workspace.panes.push({ id: "pane-2", tabs: [], activeTabId: null, size: 1 });
  return workspace;
};

const createEmptyWorkspace = () => {
  const workspace = createWorkspace();
  workspace.panes = [{ id: "pane-1", tabs: [], activeTabId: null, size: 1 }];
  workspace.tabsById = {};
  workspace.openWorkspaceItemsByKey = {};
  return workspace;
};

const renderWorkspaceItem = vi.fn(() => null);
const views: WorkspaceItemViewMap = {
  file: {
    getTitle: () => "Untitled 1",
    render: renderWorkspaceItem,
  },
};

const transfer = (types: string[] = [TAB_DRAG_DATA_MIME], initialValues: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initialValues));
  return {
    effectAllowed: "all",
    getData: vi.fn((type: string) => values.get(type) ?? ""),
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    setDragImage: vi.fn(),
    types,
  } as unknown as DataTransfer;
};

const getPreview = () => document.body.querySelector<HTMLElement>('[aria-hidden="true"].pointer-events-none');

beforeEach(() => {
  vi.stubGlobal("DragEvent", TestDragEvent);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("workspace tab drag preview", () => {
  it("does not reserve an outer scrollbar gutter for self-scrolling workspace views", () => {
    const managedViews: WorkspaceItemViewMap = {
      file: {
        ...views.file,
        managesOwnOverflow: () => true,
      },
    };
    const { container } = render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={managedViews}
          workspace={createWorkspace()}
        />
      </AppDndProvider>,
    );

    const content = container.querySelector(".pane-card-content");
    expect(content?.classList.contains("pane-card-content-managed-overflow")).toBe(true);
    expect(content?.classList.contains("pane-card-content-editor")).toBe(false);
  });

  it("anchors mirrored inspector controls to the outer edges of a split workspace", () => {
    const { container } = render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          tabBarStartContent={<button type="button">Left inspector control</button>}
          tabBarEndContent={<button type="button">Right inspector control</button>}
          views={views}
          workspace={createTwoPaneWorkspace()}
        />
      </AppDndProvider>,
    );
    const panes = container.querySelectorAll(".pane-column");

    expect(panes[0].querySelector(".pane-tabs-start")?.textContent).toContain("Left inspector control");
    expect(panes[0].querySelector(".pane-tabs-end")).toBeNull();
    expect(panes[1].querySelector(".pane-tabs-start")).toBeNull();
    expect(panes[1].querySelector(".pane-tabs-end")?.textContent).toContain("Right inspector control");
  });

  it("activates tabs on primary pointer down and keeps synthetic clicks keyboard-accessible", () => {
    const workspace = createWorkspace();
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={workspace}
        />
      </AppDndProvider>,
    );
    const tab = screen.getByRole("tab", { name: "Untitled 1" });
    expect(tab.getAttribute("draggable")).toBe("true");
    expect(tab.closest(".pane-tab")?.getAttribute("draggable")).toBeNull();
    expect(screen.getByText("Untitled 1").parentElement?.classList.contains("pane-title-with-icon")).toBe(true);

    fireEvent.pointerDown(tab, { button: 0 });
    expect(workspace.activateTab).toHaveBeenCalledWith("pane-1", "tab-1");

    vi.mocked(workspace.activateTab).mockClear();
    fireEvent.click(tab, { detail: 0 });
    expect(workspace.activateTab).toHaveBeenCalledWith("pane-1", "tab-1");
  });

  it("follows document drag events and clears on every terminal drag path", () => {
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={createSplittableWorkspace()}
        />
      </AppDndProvider>,
    );
    const handle = screen.getAllByRole("tab", { name: "Untitled 1" })[0];
    const dataTransfer = transfer();

    fireEvent.dragStart(handle, { clientX: 10, clientY: 20, dataTransfer });
    expect(getPreview()?.style.transform).toContain("22px, 32px");
    const rendersBeforeMove = renderWorkspaceItem.mock.calls.length;

    fireEvent.dragOver(document, { clientX: 70, clientY: 80, dataTransfer });
    expect(getPreview()?.style.transform).toContain("82px, 92px");
    expect(renderWorkspaceItem).toHaveBeenCalledTimes(rendersBeforeMove);

    fireEvent.drop(document, { dataTransfer });
    expect(getPreview()).toBeNull();

    fireEvent.dragStart(handle, { clientX: 10, clientY: 20, dataTransfer });
    fireEvent.dragEnd(document, { dataTransfer });
    expect(getPreview()).toBeNull();

    fireEvent.dragStart(handle, { clientX: 10, clientY: 20, dataTransfer });
    fireEvent.blur(window);
    expect(getPreview()).toBeNull();
  });

  it("shows the insertion indicator at the far-left edge of the tab bar", () => {
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={createWorkspace()}
        />
      </AppDndProvider>,
    );
    const tab = screen.getByText("Untitled 1").closest<HTMLElement>(".pane-tab");
    const handle = screen.getAllByRole("tab", { name: "Untitled 1" })[0];
    const row = document.body.querySelector<HTMLElement>(".pane-tabs-row");
    if (!tab || !row) throw new Error("Expected an editor tab bar");
    vi.spyOn(tab, "getBoundingClientRect").mockReturnValue({
      bottom: 31,
      height: 31,
      left: 20,
      right: 140,
      top: 0,
      width: 120,
      x: 20,
      y: 0,
      toJSON: () => ({}),
    });

    const dataTransfer = transfer();
    fireEvent.dragStart(handle, { clientX: 80, clientY: 16, dataTransfer });
    fireEvent.dragOver(row, { clientX: 2, clientY: 16, dataTransfer });

    const indicator = tab.querySelector<HTMLElement>('[data-side="before"][data-active="true"]');
    expect(indicator?.classList.contains("app-dnd-vertical-insertion-line")).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(row.querySelector('[data-active="true"]')).toBeNull();
  });

  it("shows the final tab boundary and drops at the current pointer position", () => {
    const workspace = createSplittableWorkspace();
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={workspace}
        />
      </AppDndProvider>,
    );
    const row = document.body.querySelector<HTMLElement>(".pane-tabs-row");
    if (!row) throw new Error("Expected an editor tab bar");
    row.querySelectorAll<HTMLElement>(".pane-tab").forEach((tab, index) => {
      vi.spyOn(tab, "getBoundingClientRect").mockReturnValue({
        left: index * 100,
        width: 100,
      } as DOMRect);
    });
    const source = screen.getAllByRole("tab", { name: "Untitled 1" })[0];
    const dataTransfer = transfer();
    fireEvent.dragStart(source, { clientX: 20, clientY: 16, dataTransfer });
    fireEvent.dragOver(row, { clientX: 250, clientY: 16, dataTransfer });
    expect(row.querySelector('[data-side="after"][data-active="true"]')).toBeTruthy();
    fireEvent.dragOver(row, { clientX: 10, clientY: 16, dataTransfer });
    fireEvent.drop(row, { clientX: 250, clientY: 16, dataTransfer });
    expect(workspace.onPaneDrop).toHaveBeenCalledWith(expect.anything(), "pane-1", 2);
    expect(row.querySelector('[data-active="true"]')).toBeNull();
  });

  it("shows the empty target pane boundary for a cross-pane tab move", () => {
    const workspace = createTwoPaneWorkspace();
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={workspace}
        />
      </AppDndProvider>,
    );
    const rows = document.body.querySelectorAll<HTMLElement>(".pane-tabs-row");
    const source = screen.getAllByRole("tab", { name: "Untitled 1" })[0];
    const dataTransfer = transfer();

    fireEvent.dragStart(source, { clientX: 20, clientY: 16, dataTransfer });
    fireEvent.dragOver(rows[1], { clientX: 20, clientY: 16, dataTransfer });
    expect(rows[1].querySelector('[data-side="before"][data-active="true"]')).toBeTruthy();
    fireEvent.drop(rows[1], { clientX: 20, clientY: 16, dataTransfer });

    expect(workspace.onPaneDrop).toHaveBeenCalledWith(expect.anything(), "pane-2", 0);
  });

  it("keeps file drops on the tab row routed to the pane", () => {
    const workspace = createWorkspace();
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={workspace}
        />
      </AppDndProvider>,
    );
    const row = document.body.querySelector<HTMLElement>(".pane-tabs-row");
    if (!row) throw new Error("Expected an editor tab bar");
    const dataTransfer = transfer([FILE_DRAG_DATA_MIME]);

    fireEvent.dragOver(row, { clientX: 20, clientY: 16, dataTransfer });
    expect(row.querySelector('[data-active="true"]')).toBeNull();
    fireEvent.drop(row, { clientX: 20, clientY: 16, dataTransfer });

    expect(workspace.onPaneDrop).toHaveBeenCalledWith(expect.anything(), "pane-1");
  });

  it("keeps symmetric outer split targets mounted before dragging", () => {
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={createSplittableWorkspace()}
        />
      </AppDndProvider>,
    );

    const start = document.body.querySelector<HTMLElement>(".pane-workspace-split-target-start");
    const end = document.body.querySelector<HTMLElement>(".pane-workspace-split-target-end");
    expect(start?.querySelector(".pane-workspace-split-indicator")).toBeTruthy();
    expect(end?.querySelector(".pane-workspace-split-indicator")).toBeTruthy();
    expect(start?.dataset.dropActive).toBeUndefined();
    expect(end?.dataset.dropActive).toBeUndefined();
  });

  it.each([
    ["left", ".pane-workspace-split-target-start", "left"],
    ["right", ".pane-workspace-split-target-end", "right"],
  ] as const)("commits a split from the outer %s target without waiting for a preview render", (_, selector, side) => {
    const workspace = createSplittableWorkspace();
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={workspace}
        />
      </AppDndProvider>,
    );
    const handle = screen.getAllByRole("tab", { name: "Untitled 1" })[0];
    const target = document.body.querySelector<HTMLElement>(selector);
    if (!target) throw new Error("Expected a permanent outer split target");

    const dataTransfer = transfer();
    fireEvent.dragStart(handle, { clientX: 80, clientY: 16, dataTransfer });
    fireEvent.drop(target, { clientX: 4, clientY: 100, dataTransfer });

    expect(workspace.onPaneSplitDrop).toHaveBeenCalledWith(expect.anything(), "pane-1", side);
    expect(workspace.onPaneDrop).not.toHaveBeenCalled();
  });

  it("activates the internal target in place without adding a flex item", () => {
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={createTwoPaneWorkspace()}
        />
      </AppDndProvider>,
    );
    const handle = screen.getAllByRole("tab", { name: "Untitled 1" })[0];
    const divider = document.body.querySelector<HTMLElement>(".pane-resize-divider");
    const target = divider?.querySelector<HTMLElement>(".pane-workspace-split-target-internal");
    if (!target) throw new Error("Expected a permanent internal split target");

    const dataTransfer = transfer();
    fireEvent.dragStart(handle, { clientX: 80, clientY: 16, dataTransfer });
    fireEvent.dragOver(target, { clientX: 200, clientY: 100, dataTransfer });

    expect(target.dataset.dropActive).toBe("valid");
    expect(target.parentElement).toBe(divider);
    expect(document.body.querySelector(".app-dnd-overlay-subtext")?.textContent).toBe("Split into a new pane");
  });

  it("keeps rapid target changes synchronous without rerendering the pane grid", () => {
    const workspace = createSplittableWorkspace();
    const onRender = vi.fn();
    render(
      <AppDndProvider>
        <Profiler id="workspace" onRender={onRender}>
          <WorkspacePaneGrid
            resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
            views={views}
            workspace={workspace}
          />
        </Profiler>
      </AppDndProvider>,
    );
    const handle = screen.getAllByRole("tab", { name: "Untitled 1" })[0];
    const start = document.body.querySelector<HTMLElement>(".pane-workspace-split-target-start");
    const end = document.body.querySelector<HTMLElement>(".pane-workspace-split-target-end");
    if (!start || !end) throw new Error("Expected permanent outer split targets");

    const dataTransfer = transfer();
    fireEvent.dragStart(handle, { clientX: 80, clientY: 16, dataTransfer });
    const rendersBeforeMovement = onRender.mock.calls.length;
    for (let index = 0; index < 100; index += 1) {
      const target = index % 2 === 0 ? start : end;
      fireEvent.dragOver(target, { clientX: index, clientY: 100, dataTransfer });
      expect(target.dataset.dropActive).toBe("valid");
    }
    expect(onRender).toHaveBeenCalledTimes(rendersBeforeMovement);
    expect(start.dataset.dropActive).toBeUndefined();
    expect(end.dataset.dropActive).toBe("valid");
    fireEvent.drop(end, { clientX: 400, clientY: 100, dataTransfer });
    expect(workspace.onPaneSplitDrop).toHaveBeenCalledWith(expect.anything(), "pane-1", "right");
  });

  it("uses the same split target for an Explorer file preview and drop", () => {
    const workspace = createSplittableWorkspace();
    render(
      <AppDndProvider>
        <ExplorerSource />
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={workspace}
        />
      </AppDndProvider>,
    );
    const target = document.body.querySelector<HTMLElement>(".pane-workspace-split-target-end");
    if (!target) throw new Error("Expected a permanent outer split target");
    const dataTransfer = transfer([FILE_DRAG_DATA_MIME], {
      [FILE_DRAG_DATA_MIME]: JSON.stringify({
        filename: file.filename,
        mimeType: file.mimeType,
        path: file.path,
        relativePath: file.relativePath,
      }),
    });

    fireEvent.dragStart(screen.getByTestId("explorer-source"), { dataTransfer });
    fireEvent.dragOver(target, { clientX: 400, clientY: 100, dataTransfer });
    expect(target.dataset.dropActive).toBe("valid");
    fireEvent.drop(target, { clientX: 400, clientY: 100, dataTransfer });

    expect(workspace.onPaneSplitDrop).toHaveBeenCalledWith(expect.anything(), "pane-1", "right");
    expect(workspace.onPaneDrop).not.toHaveBeenCalled();
  });

  it.each([
    ["left", ".pane-workspace-split-target-start", "left"],
    ["right", ".pane-workspace-split-target-end", "right"],
  ] as const)("allows an Explorer file to split beside the only empty pane on the %s", (_, selector, side) => {
    const workspace = createEmptyWorkspace();
    render(
      <AppDndProvider>
        <ExplorerSource />
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={workspace}
        />
      </AppDndProvider>,
    );
    const target = document.body.querySelector<HTMLElement>(selector);
    if (!target) throw new Error("Expected a permanent outer split target");
    const dataTransfer = transfer([FILE_DRAG_DATA_MIME], {
      [FILE_DRAG_DATA_MIME]: JSON.stringify({
        filename: file.filename,
        mimeType: file.mimeType,
        path: file.path,
        relativePath: file.relativePath,
      }),
    });

    fireEvent.dragStart(screen.getByTestId("explorer-source"), { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    expect(target.dataset.dropActive).toBe("valid");
    fireEvent.drop(target, { dataTransfer });

    expect(workspace.onPaneSplitDrop).toHaveBeenCalledWith(expect.anything(), "pane-1", side);
    expect(workspace.onPaneDrop).not.toHaveBeenCalled();
  });

  it("does not substitute a normal pane drop when a displayed split fails", () => {
    const workspace = createSplittableWorkspace();
    vi.mocked(workspace.onPaneSplitDrop).mockResolvedValue(false);
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={workspace}
        />
      </AppDndProvider>,
    );
    const handle = screen.getAllByRole("tab", { name: "Untitled 1" })[0];
    const target = document.body.querySelector<HTMLElement>(".pane-workspace-split-target-end");
    if (!target) throw new Error("Expected a permanent outer split target");
    const dataTransfer = transfer();

    fireEvent.dragStart(handle, { clientX: 80, clientY: 16, dataTransfer });
    fireEvent.dragOver(target, { clientX: 400, clientY: 100, dataTransfer });
    fireEvent.drop(target, { clientX: 400, clientY: 100, dataTransfer });

    expect(workspace.onPaneSplitDrop).toHaveBeenCalledOnce();
    expect(workspace.onPaneDrop).not.toHaveBeenCalled();
  });

  it("ignores Task Board drags in workspace pane and split targets", () => {
    const workspace = createSplittableWorkspace();
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={workspace}
        />
      </AppDndProvider>,
    );
    const paneBody = document.body.querySelector<HTMLElement>(".pane-card-body");
    const splitTarget = document.body.querySelector<HTMLElement>(".pane-workspace-split-target-start");
    if (!paneBody || !splitTarget) throw new Error("Expected workspace drop targets");
    const dataTransfer = transfer([TASK_BOARD_TASK_DRAG_DATA_MIME]);

    fireEvent.dragOver(paneBody, { dataTransfer });
    fireEvent.dragOver(splitTarget, { dataTransfer });
    fireEvent.drop(splitTarget, { dataTransfer });

    expect(workspace.onPaneDragOver).not.toHaveBeenCalled();
    expect(workspace.onPaneSplitDrop).not.toHaveBeenCalled();
    expect(workspace.onPaneDrop).not.toHaveBeenCalled();
    expect(splitTarget.dataset.dropActive).toBeUndefined();
  });

  it("keeps a single-tab pane draggable but rejects its current position", () => {
    const workspace = createWorkspace();
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={workspace}
        />
      </AppDndProvider>,
    );
    const handle = screen.getAllByRole("tab", { name: "Untitled 1" })[0];
    const target = document.body.querySelector<HTMLElement>(".pane-workspace-split-target-start");
    if (!target) throw new Error("Expected a permanent outer split target");

    const dataTransfer = transfer();
    fireEvent.dragStart(handle, { clientX: 200, clientY: 16, dataTransfer });
    fireEvent.dragOver(target, { clientX: 4, clientY: 100, dataTransfer });
    expect(target.dataset.dropActive).toBe("invalid");
    expect(document.body.querySelector(".app-dnd-overlay-subtext")?.textContent).toContain(
      "Pane is already at this position",
    );
    fireEvent.drop(target, { clientX: 4, clientY: 100, dataTransfer });

    expect(workspace.onPaneSplitDrop).not.toHaveBeenCalled();
    expect(workspace.onPaneDrop).not.toHaveBeenCalled();
    expect(target.dataset.dropActive).toBeUndefined();
  });

  it("moves a single-tab pane across its adjacent separator", () => {
    const workspace = createWorkspace();
    workspace.panes.push({ id: "pane-2", tabs: ["tab-2"], activeTabId: "tab-2", size: 1 });
    workspace.tabsById["tab-2"] = createEditorTab("tab-2", "file:/notes/Untitled 2.md");
    render(
      <AppDndProvider>
        <WorkspacePaneGrid
          resolveWorkspaceItem={(workspaceItemKey, items) => items[workspaceItemKey] ?? null}
          views={views}
          workspace={workspace}
        />
      </AppDndProvider>,
    );
    const handle = screen.getAllByRole("tab", { name: "Untitled 1" })[0];
    const target = document.body.querySelector<HTMLElement>(".pane-workspace-split-target-internal");
    if (!target) throw new Error("Expected a permanent internal split target");

    const dataTransfer = transfer();
    fireEvent.dragStart(handle, { clientX: 200, clientY: 16, dataTransfer });
    fireEvent.dragOver(target, { clientX: 400, clientY: 100, dataTransfer });
    expect(target.dataset.dropActive).toBe("valid");
    expect(document.body.querySelector(".app-dnd-overlay-subtext")?.textContent).toBe("Move pane here");
    fireEvent.drop(target, { clientX: 400, clientY: 100, dataTransfer });

    expect(workspace.onPaneSplitDrop).toHaveBeenCalledWith(expect.anything(), "pane-2", "right");
    expect(workspace.onPaneDrop).not.toHaveBeenCalled();
  });
});
