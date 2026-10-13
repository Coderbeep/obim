import { createStore } from "jotai";
import { expect, it } from "vitest";
import {
  createEditorTab,
  saveWorkspaceViewPositionAtom,
  workspaceTabsByIdAtom,
} from "../src/renderer/src/store/editorTabStore";
import { workspaceViewPositionsAtom, type PdfViewPosition } from "../src/renderer/src/store/workspaceViewStateStore";
import { remapWorkspaceFileReferencesAtom } from "../src/renderer/src/store/workspaceActionStore";
import { createFileWorkspaceItemKey } from "../src/shared/workspace";

const key = createFileWorkspaceItemKey("/notes/a.pdf");
const position: PdfViewPosition = {
  kind: "pdf",
  page: 2,
  anchor: { pageNumber: 2, pageX: 0.5, pageY: 0.4, localX: 300, localY: 200 },
  scale: 1,
  zoomMode: "custom",
  spreadMode: "none",
};

it("releases closed tab positions and rejects late viewer cleanup", () => {
  const store = createStore();
  store.set(workspaceTabsByIdAtom, { a: createEditorTab("a", key), b: createEditorTab("b", key) });
  for (const tabId of ["a", "b"]) store.set(saveWorkspaceViewPositionAtom, { tabId, resourceKey: key, position });
  store.set(workspaceTabsByIdAtom, (tabs) => ({ b: tabs.b }));
  store.set(saveWorkspaceViewPositionAtom, { tabId: "a", resourceKey: key, position });
  expect(store.get(workspaceViewPositionsAtom)).toEqual({ b: { [key]: position } });
  store.set(workspaceTabsByIdAtom, {});
  expect(store.get(workspaceViewPositionsAtom)).toEqual({});
});

it("keeps positions for back/forward navigation and removes discarded history", () => {
  const store = createStore();
  const other = createFileWorkspaceItemKey("/notes/b.pdf");
  store.set(workspaceTabsByIdAtom, { a: { ...createEditorTab("a", other), backStack: [key, other] } });
  store.set(saveWorkspaceViewPositionAtom, { tabId: "a", resourceKey: key, position });
  store.set(workspaceTabsByIdAtom, (tabs) => ({
    a: { ...tabs.a, currentResourceKey: key, backStack: [key], forwardStack: [other] },
  }));
  expect(store.get(workspaceViewPositionsAtom).a[key]).toBe(position);
  store.set(workspaceTabsByIdAtom, { a: createEditorTab("a", other) });
  expect(store.get(workspaceViewPositionsAtom).a[key]).toBeUndefined();
});

it("carries a tab's position through a file rename", () => {
  const store = createStore();
  store.set(workspaceTabsByIdAtom, { a: createEditorTab("a", key) });
  store.set(saveWorkspaceViewPositionAtom, { tabId: "a", resourceKey: key, position });
  store.set(remapWorkspaceFileReferencesAtom, {
    notesDirectoryPath: "/notes",
    remapPath: (path) => (path === "/notes/a.pdf" ? "/notes/renamed.pdf" : path),
  });
  expect(store.get(workspaceViewPositionsAtom).a).toEqual({
    [createFileWorkspaceItemKey("/notes/renamed.pdf")]: position,
  });
});
