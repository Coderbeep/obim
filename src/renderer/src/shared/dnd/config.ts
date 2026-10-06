/** Shared values used by the drag overlay and autoscroll engine. */
export const APP_DND_CONFIG = {
  autoscrollMaxSpeed: 18,
  autoscrollThreshold: 40,
  overlayOffset: 12,
} as const;

/** Interactive descendants that do not start a parent drag. */
export const APP_DND_INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='menuitem']",
  "[data-resize-handle]",
  "[data-dnd-no-drag]",
].join(",");
