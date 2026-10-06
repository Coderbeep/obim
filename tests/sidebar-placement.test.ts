// @vitest-environment jsdom

import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import {
  initializeSidebarPlacement,
  persistSidebarPlacement,
  readSidebarPlacement,
} from "../src/renderer/src/app/sidebarPlacement";

afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset.sidebarPlacement;
});

test("new and legacy configurations keep the explorer on the left", () => {
  window.config = {} as Window["config"];

  assert.equal(readSidebarPlacement(), "explorer-left");
  assert.equal(initializeSidebarPlacement(), "explorer-left");
  assert.equal(document.documentElement.dataset.sidebarPlacement, "explorer-left");
});

test("a saved mirrored layout is applied during startup and can be persisted", async () => {
  const setSidebarPlacement = vi.fn(async () => undefined);
  window.config = {
    getSidebarPlacementSync: () => "explorer-right",
    setSidebarPlacement,
  } as unknown as Window["config"];

  assert.equal(initializeSidebarPlacement(), "explorer-right");
  assert.equal(document.documentElement.dataset.sidebarPlacement, "explorer-right");

  await persistSidebarPlacement("explorer-left");
  assert.deepEqual(setSidebarPlacement.mock.calls, [["explorer-left"]]);
});
