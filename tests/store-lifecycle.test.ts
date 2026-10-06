import { createStore } from "jotai/vanilla";
import assert from "node:assert/strict";
import { test } from "vitest";

import { bookmarksAtom } from "../src/renderer/src/store/bookmarkStore";
import { contextMenuRequestAtom } from "../src/renderer/src/store/contextMenuStore";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import {
  expandedDirectoriesAtom,
  explorerSelectionPathsAtom,
  fileAccessesAtom,
  recentFilesAtom,
} from "../src/renderer/src/store/fileExplorerStore";
import {
  remapFileReferencesAtom,
  removeFileReferencesAtom,
  settleExternalFileEditAtom,
  stageExternalFileEditAtom,
} from "../src/renderer/src/store/fileLifecycleStore";
import { openWorkspaceItemsByKeyAtom } from "../src/renderer/src/store/workspaceResourceStore";
import type { FileItem } from "../src/shared/file-item";
import { createFileWorkspaceItem, createFileWorkspaceItemKey } from "../src/shared/workspace";

function installWindow() {
  const globals = globalThis as unknown as { window?: unknown };
  const hadWindow = "window" in globals;
  const previousWindow = globals.window;

  globals.window = {
    config: {
      getMainDirectoryPathSync: () => "/notes-root",
    },
  };

  return () => {
    if (hadWindow) globals.window = previousWindow;
    else delete globals.window;
  };
}

const note = (path: string): FileItem => ({
  id: path,
  filename: path.split("/").pop()?.replace(/\.md$/, "") ?? path,
  relativePath: path.replace("/notes-root/", ""),
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

test("delete repairs tabs, histories, buffers, bookmarks, and selection without owning context-menu state", () => {
  const restoreWindow = installWindow();
  const store = createStore();
  const keep = note("/notes-root/keep.md");
  const remove = note("/notes-root/remove.md");
  const keepKey = createFileWorkspaceItemKey(keep.path);
  const removeKey = createFileWorkspaceItemKey(remove.path);

  try {
    store.set(workspaceTabsByIdAtom, {
      "tab-1": {
        id: "tab-1",
        currentResourceKey: keepKey,
        backStack: [removeKey, keepKey],
        forwardStack: [removeKey],
      },
      "tab-2": {
        id: "tab-2",
        currentResourceKey: removeKey,
        backStack: [removeKey],
        forwardStack: [],
      },
    });
    store.set(workspacePanesAtom, [{ id: "pane-1", tabs: ["tab-1", "tab-2"], activeTabId: "tab-2", size: 1 }]);
    store.set(openWorkspaceItemsByKeyAtom, {
      [keepKey]: createFileWorkspaceItem(keep),
      [removeKey]: createFileWorkspaceItem(remove),
    });
    store.set(fileBuffersByPathAtom, {
      [keep.path]: { savedText: "keep", editorText: "keep" },
      [remove.path]: { savedText: "remove", editorText: "remove" },
    });
    store.set(bookmarksAtom, [keep, remove]);
    store.set(recentFilesAtom, [remove, keep]);
    store.set(fileAccessesAtom, { [keep.path]: 100, [remove.path]: 200 });
    store.set(explorerSelectionPathsAtom, [keep.path, remove.path]);
    store.set(contextMenuRequestAtom, {
      key: "remove-file",
      anchor: null,
      position: { x: 0, y: 0 },
      entries: [],
    });

    store.set(removeFileReferencesAtom, { removedItems: [remove], notesDirectoryPath: "/notes-root" });

    assert.deepEqual(store.get(workspacePanesAtom), [{ id: "pane-1", tabs: ["tab-1"], activeTabId: "tab-1", size: 1 }]);
    assert.deepEqual(store.get(workspaceTabsByIdAtom)["tab-1"].backStack, [keepKey]);
    assert.deepEqual(store.get(workspaceTabsByIdAtom)["tab-1"].forwardStack, []);
    assert.equal(store.get(openWorkspaceItemsByKeyAtom)[removeKey], undefined);
    assert.equal(store.get(fileBuffersByPathAtom)[remove.path], undefined);
    assert.deepEqual(store.get(bookmarksAtom), [keep]);
    assert.deepEqual(store.get(recentFilesAtom), [keep]);
    assert.deepEqual(store.get(fileAccessesAtom), { [keep.path]: 100 });
    assert.deepEqual(store.get(explorerSelectionPathsAtom), [keep.path]);

    assert.equal(store.get(contextMenuRequestAtom)?.key, "remove-file");
  } finally {
    restoreWindow();
  }
});

test("rename remaps resource keys, history, buffers, bookmarks, selection, and expanded dirs", () => {
  const restoreWindow = installWindow();
  const store = createStore();
  const oldFile = note("/notes-root/folder/today.md");
  const oldKey = createFileWorkspaceItemKey(oldFile.path);
  const newPath = "/notes-root/renamed/today.md";
  const newKey = createFileWorkspaceItemKey(newPath);
  const remapPath = (path: string) =>
    path === "/notes-root/folder" || path.startsWith("/notes-root/folder/")
      ? "/notes-root/renamed" + path.slice("/notes-root/folder".length)
      : path;

  try {
    store.set(workspaceTabsByIdAtom, {
      "tab-1": {
        id: "tab-1",
        currentResourceKey: oldKey,
        backStack: [oldKey],
        forwardStack: [oldKey],
      },
    });
    store.set(openWorkspaceItemsByKeyAtom, {
      [oldKey]: createFileWorkspaceItem(oldFile),
    });
    store.set(fileBuffersByPathAtom, {
      [oldFile.path]: { savedText: "text", editorText: "text" },
    });
    store.set(bookmarksAtom, [oldFile]);
    store.set(recentFilesAtom, [oldFile]);
    store.set(fileAccessesAtom, { [oldFile.path]: 200 });
    store.set(explorerSelectionPathsAtom, [oldFile.path]);
    store.set(expandedDirectoriesAtom, new Set(["folder", "folder/sub"]));

    store.set(remapFileReferencesAtom, { remapPath, notesDirectoryPath: "/notes-root" });

    assert.equal(store.get(workspaceTabsByIdAtom)["tab-1"].currentResourceKey, newKey);
    assert.deepEqual(store.get(workspaceTabsByIdAtom)["tab-1"].backStack, [newKey]);
    assert.deepEqual(Object.keys(store.get(openWorkspaceItemsByKeyAtom)), [newKey]);
    assert.deepEqual(Object.keys(store.get(fileBuffersByPathAtom)), [newPath]);
    assert.equal(store.get(bookmarksAtom)[0].path, newPath);
    assert.equal(store.get(recentFilesAtom)[0].path, newPath);
    assert.deepEqual(store.get(fileAccessesAtom), { [newPath]: 200 });
    assert.deepEqual(store.get(explorerSelectionPathsAtom), [newPath]);
    assert.deepEqual(Array.from(store.get(expandedDirectoriesAtom)).sort(), ["renamed", "renamed/sub"]);
  } finally {
    restoreWindow();
  }
});

test("external edits stage only against the expected open-buffer text", () => {
  const store = createStore();
  const path = "/notes-root/task.md";
  const version = { id: "opened", mtimeMs: 100, sizeBytes: 5 };
  const original = { savedText: "saved", editorText: "draft", version };
  store.set(fileBuffersByPathAtom, { [path]: original });

  const rejected = store.set(stageExternalFileEditAtom, {
    path,
    expectedText: "stale draft",
    nextText: "changed",
  });

  assert.equal(rejected, false);
  assert.equal(store.get(fileBuffersByPathAtom)[path], original);

  const staged = store.set(stageExternalFileEditAtom, {
    path,
    expectedText: "draft",
    nextText: "task-board edit",
  });

  assert.equal(staged, true);
  assert.deepEqual(store.get(fileBuffersByPathAtom)[path], {
    savedText: "saved",
    editorText: "task-board edit",
    version,
  });
});

test("a successful external edit records the persisted text without erasing newer typing", () => {
  const store = createStore();
  const path = "/notes-root/task.md";
  const openedVersion = { id: "opened", mtimeMs: 100, sizeBytes: 5 };
  const savedVersion = { id: "saved", mtimeMs: 200, sizeBytes: 15 };
  store.set(fileBuffersByPathAtom, {
    [path]: { savedText: "saved", editorText: "draft", version: openedVersion },
  });
  store.set(stageExternalFileEditAtom, { path, expectedText: "draft", nextText: "task-board edit" });
  store.set(fileBuffersByPathAtom, (buffers) => ({
    ...buffers,
    [path]: { ...buffers[path], editorText: "task-board edit plus typing" },
  }));

  store.set(settleExternalFileEditAtom, {
    path,
    expectedText: "draft",
    nextText: "task-board edit",
    success: true,
    version: savedVersion,
  });

  assert.deepEqual(store.get(fileBuffersByPathAtom)[path], {
    savedText: "task-board edit",
    editorText: "task-board edit plus typing",
    version: savedVersion,
  });
});

test("a failed external edit rolls back only while its optimistic text is current", () => {
  const path = "/notes-root/task.md";
  const settleFailure = (store: ReturnType<typeof createStore>) =>
    store.set(settleExternalFileEditAtom, {
      path,
      expectedText: "draft",
      nextText: "task-board edit",
      success: false,
    });

  const unchangedStore = createStore();
  unchangedStore.set(fileBuffersByPathAtom, { [path]: { savedText: "saved", editorText: "draft" } });
  unchangedStore.set(stageExternalFileEditAtom, {
    path,
    expectedText: "draft",
    nextText: "task-board edit",
  });
  settleFailure(unchangedStore);
  assert.deepEqual(unchangedStore.get(fileBuffersByPathAtom)[path], {
    savedText: "saved",
    editorText: "draft",
  });

  const typedStore = createStore();
  typedStore.set(fileBuffersByPathAtom, { [path]: { savedText: "saved", editorText: "draft" } });
  typedStore.set(stageExternalFileEditAtom, { path, expectedText: "draft", nextText: "task-board edit" });
  typedStore.set(fileBuffersByPathAtom, (buffers) => ({
    ...buffers,
    [path]: { ...buffers[path], editorText: "newer typing" },
  }));
  settleFailure(typedStore);
  assert.deepEqual(typedStore.get(fileBuffersByPathAtom)[path], {
    savedText: "saved",
    editorText: "newer typing",
  });
});
