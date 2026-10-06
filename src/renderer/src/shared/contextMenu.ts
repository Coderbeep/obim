import type { IconComponent } from "./icons/types";

/** Viewport coordinates and horizontal alignment used to place a context menu. */
export type ContextMenuPosition = {
  /** Horizontal viewport coordinate used as the menu's alignment edge. */
  x: number;
  /** Vertical viewport coordinate used as the menu's top edge. */
  y: number;
  /** Whether `x` identifies the menu's left or right edge. */
  alignX?: "left" | "right";
};

/** Selectable context-menu entry, optionally containing a nested submenu. */
export type ContextMenuAction = {
  kind: "action";
  /** Stable identifier used for rendering and menu inspection. */
  id: string;
  label: string;
  icon?: IconComponent;
  /** Visible keyboard hint for an existing shortcut. */
  shortcut?: string;
  /** Operation invoked after the menu closes. */
  onSelect: () => void | Promise<unknown>;
  /** Displays the action as a selected radio-style menu item when defined. */
  checked?: boolean;
  children?: ContextMenuEntry[];
  danger?: boolean;
  disabled?: boolean;
  indicatorColor?: string;
};

/** Action, visual separator, or non-interactive message rendered in a context menu. */
export type ContextMenuEntry =
  | ContextMenuAction
  | { kind: "separator" }
  | { kind: "message"; id: string; text: string };

/** Complete description of a context menu requested by a feature. */
export type ContextMenuRequest = {
  /** Logical menu identity used to detect repeated open requests. */
  key: string;
  /** Element that triggered the menu, when the request is anchored to one. */
  anchor: HTMLElement | null;
  position: ContextMenuPosition;
  entries: ContextMenuEntry[];
  /** Closes the same menu when its anchor requests it again. */
  toggleOnRepeat?: boolean;
};
