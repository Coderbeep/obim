import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveWorkspaceItemFromState } from "../src/renderer/src/features/files/workspaceFileResolver";
import type { WorkspacePaneState } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, type WorkspaceTabState } from "../src/renderer/src/store/editorTabStore";
import { createFileWorkspaceItem, createGitConflictWorkspaceItem } from "../src/shared/workspace";
import {
  activateWorkspaceResource,
  closeWorkspaceTab,
  commitWorkspaceHistoryNavigation,
  getWorkspaceHistoryTarget,
  moveWorkspaceTab,
  openWorkspaceResource,
  splitWorkspaceTab,
  type WorkspaceState,
} from "../src/renderer/src/store/workspaceTransitions";
import type { FileItem } from "../src/shared/file-item";

const note = (path: string): FileItem => ({
  id: path,
  filename: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const state = (
  panes: WorkspacePaneState[],
  tabsById: Record<string, WorkspaceTabState>,
  activePaneId = panes[0]?.id ?? "pane-1",
): WorkspaceState => ({ activePaneId, panes, tabsById, openItemsByKey: {} });

test("activating an open resource focuses its existing tab without duplication", () => {
  const item = createFileWorkspaceItem(note("/notes/a.md"));
  const existing = createEditorTab("tab-a", item.key);
  const initial = state(
    [
      { id: "pane-1", tabs: [], activeTabId: null, size: 1 },
      { id: "pane-2", tabs: [existing.id], activeTabId: existing.id, size: 1 },
    ],
    { [existing.id]: existing },
  );

  const next = activateWorkspaceResource(initial, {
    item,
    resourceKey: item.key,
    paneId: "pane-1",
    newTabId: "unused",
  });

  assert.equal(next.activatedTabId, existing.id);
  assert.equal(next.activePaneId, "pane-2");
  assert.deepEqual(Object.keys(next.tabsById), [existing.id]);
});

test("resource replacement and back-forward transitions retain deterministic history", () => {
  const first = createFileWorkspaceItem(note("/notes/a.md"));
  const second = createFileWorkspaceItem(note("/notes/b.md"));
  const tab = createEditorTab("tab-1", first.key);
  const initial = state([{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }], { [tab.id]: tab });
  const opened = openWorkspaceResource(initial, { item: second, newTabId: "unused" });
  const current = opened.tabsById[tab.id];

  assert.deepEqual(current.backStack, [first.key, second.key]);
  assert.equal(getWorkspaceHistoryTarget(current, "back"), first.key);

  const afterOpenBackTarget = { ...current, currentResourceKey: first.key };
  const backward = commitWorkspaceHistoryNavigation(afterOpenBackTarget, "back", first.key);
  assert.deepEqual(backward.backStack, [first.key]);
  assert.deepEqual(backward.forwardStack, [second.key]);

  const afterOpenForwardTarget = { ...backward, currentResourceKey: second.key };
  const forward = commitWorkspaceHistoryNavigation(afterOpenForwardTarget, "forward", second.key);
  assert.deepEqual(forward.backStack, [first.key, second.key]);
  assert.deepEqual(forward.forwardStack, []);
});

test("closing a tab chooses its left neighbor and removes an empty secondary pane", () => {
  const first = createEditorTab("tab-1", "file:a");
  const second = createEditorTab("tab-2", "file:b");
  const third = createEditorTab("tab-3", "file:c");
  const initial = state(
    [
      { id: "pane-1", tabs: [first.id, second.id], activeTabId: second.id, size: 0.63 },
      { id: "pane-2", tabs: [third.id], activeTabId: third.id, size: 0.37 },
    ],
    { [first.id]: first, [second.id]: second, [third.id]: third },
    "pane-2",
  );

  const afterSecond = closeWorkspaceTab(initial, "pane-1", second.id);
  assert.equal(afterSecond.panes[0].activeTabId, first.id);

  const afterThird = closeWorkspaceTab(afterSecond, "pane-2", third.id);
  assert.deepEqual(
    afterThird.panes.map((pane) => pane.id),
    ["pane-1"],
  );
  assert.equal(afterThird.activePaneId, "pane-1");
  assert.equal(afterThird.panes[0].size, 1);
});

test("closing a tab through a pane that does not own it is a no-op", () => {
  const first = createEditorTab("tab-1", "file:a");
  const second = createEditorTab("tab-2", "file:b");
  const initial = state(
    [
      { id: "pane-1", tabs: [first.id], activeTabId: first.id, size: 1 },
      { id: "pane-2", tabs: [second.id], activeTabId: second.id, size: 1 },
    ],
    { [first.id]: first, [second.id]: second },
  );

  assert.equal(closeWorkspaceTab(initial, "pane-1", second.id), initial);
});

test("tabs move and split without leaving empty source panes", () => {
  const panes: WorkspacePaneState[] = [
    { id: "pane-1", tabs: ["tab-1"], activeTabId: "tab-1", size: 0.4 },
    { id: "pane-2", tabs: ["tab-2"], activeTabId: "tab-2", size: 0.6 },
  ];
  const moved = moveWorkspaceTab(panes, "pane-1", "pane-2", "tab-1", 0);
  assert.deepEqual(
    moved.map((pane) => pane.id),
    ["pane-2"],
  );
  assert.deepEqual(moved[0].tabs, ["tab-1", "tab-2"]);
  assert.equal(moved[0].size, 1);

  const split = splitWorkspaceTab(moved, "pane-2", "pane-2", "tab-1", "left", "pane-3");
  assert.deepEqual(
    split.map((pane) => pane.id),
    ["pane-3", "pane-2"],
  );
  assert.deepEqual(split[0].tabs, ["tab-1"]);
  assert.deepEqual(split[1].tabs, ["tab-2"]);

  const reordered = splitWorkspaceTab(split, "pane-3", "pane-3", "tab-1", "right", "unused-pane");
  assert.deepEqual(
    reordered.map((pane) => pane.id),
    ["pane-2", "pane-3"],
  );
  assert.equal(reordered[1], split[0]);
});

test("file-backed resource resolution lives outside workspace state", () => {
  const file = note("/notes/folder/a.md");
  const directory: FileItem = {
    id: "/notes/folder",
    filename: "folder",
    relativePath: "folder",
    path: "/notes/folder",
    isDirectory: true,
    mimeType: null,
    children: [file],
  };
  const item = createFileWorkspaceItem(file);
  assert.deepEqual(resolveWorkspaceItemFromState(item.key, {}, [directory]), item);
});

test("conflict resource resolution keeps working when the file is deleted on one side", () => {
  const item = createGitConflictWorkspaceItem("/notes/folder/deleted.md", "folder/deleted.md");
  assert.deepEqual(resolveWorkspaceItemFromState(item.key, {}, [], "/notes"), item);
});
