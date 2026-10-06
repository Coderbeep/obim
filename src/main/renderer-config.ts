import {
  isAppTheme,
  isSidebarPlacement,
  normalizeCreationDirectory,
  normalizeZoomFactor,
  type ConfigKey,
} from "@shared/config";
import { isShortcutOverrides } from "@shared/keyboard-shortcuts";
const creationKeys = new Set(["taskCreationDirectory", "dailyNoteCreationDirectory"]);
const writableKeys = new Set([
  ...creationKeys,
  "keyboardShortcuts",
  "taskBoardOpenMode",
  "showWindowControls",
  "theme",
  "sidebarPlacement",
  "zoomFactor",
]);
const readableKeys = new Set([...writableKeys, "mainDirectory", "recentWorkspaces"]);

export function assertRendererConfigKey(key: unknown): asserts key is ConfigKey {
  if (typeof key !== "string" || !readableKeys.has(key))
    throw new TypeError("This setting is not exposed to the renderer.");
}
export function validateRendererConfigUpdate(key: unknown, value: unknown): ConfigKey {
  if (typeof key !== "string" || !writableKeys.has(key))
    throw new TypeError("This setting must use its dedicated application action.");
  const valid =
    key === "taskBoardOpenMode"
      ? value === "tab" || value === "hover"
      : key === "keyboardShortcuts"
        ? isShortcutOverrides(value)
        : creationKeys.has(key)
          ? normalizeCreationDirectory(value) !== null
          : key === "showWindowControls"
            ? typeof value === "boolean"
            : key === "theme"
              ? isAppTheme(value)
              : key === "sidebarPlacement"
                ? isSidebarPlacement(value)
                : normalizeZoomFactor(value) !== null;
  if (!valid) throw new TypeError("Invalid setting value.");
  return key as ConfigKey;
}
