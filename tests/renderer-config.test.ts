import { expect, it } from "vitest";
import { assertRendererConfigKey, validateRendererConfigUpdate } from "../src/main/renderer-config";
it.each([
  "mainDirectory",
  "recentWorkspaces",
  "gitAutoSyncByWorkspace",
  "gitSyncOutcomesByWorkspace",
  "gitAutoSyncIntervalMinutes",
  "__proto__",
  "unknown",
])("does not let generic renderer writes change %s", (key) =>
  expect(() => validateRendererConfigUpdate(key, {})).toThrow(),
);
it.each(["gitAutoSyncByWorkspace", "gitSyncOutcomesByWorkspace", "constructor", "unknown"])(
  "hides internal configuration key %s",
  (key) => expect(() => assertRendererConfigKey(key)).toThrow(),
);
it.each([
  ["keyboardShortcuts", { "new-note": ["Mod+Alt+N"], bold: [] }],
  ["theme", "dark"],
  ["sidebarPlacement", "explorer-left"],
  ["zoomFactor", 1.5],
])("validates public setting %s", (key, value) => expect(validateRendererConfigUpdate(key, value)).toBe(key));
it.each([
  ["keyboardShortcuts", { "new-note": "Mod+N" }],
  ["keyboardShortcuts", { unknown: ["Mod+N"] }],
  ["theme", "execute"],
  ["taskCreationDirectory", "/outside"],
  ["zoomFactor", {}],
  ["showWindowControls", 1],
])("rejects malformed setting %s", (key, value) => expect(() => validateRendererConfigUpdate(key, value)).toThrow());

it("accepts only supported task opening modes", () => {
  expect(validateRendererConfigUpdate("taskBoardOpenMode", "tab")).toBe("taskBoardOpenMode");
  expect(validateRendererConfigUpdate("taskBoardOpenMode", "hover")).toBe("taskBoardOpenMode");
  expect(() => validateRendererConfigUpdate("taskBoardOpenMode", "external")).toThrow();
});
