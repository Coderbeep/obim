export type DesignGraphEntry = {
  group: "Foundations" | "Primitives" | "Compositions";
  id: string;
  label: string;
  states: readonly string[];
};

export const DESIGN_GRAPH_INDEX = [
  {
    id: "settings",
    label: "Settings · proposal",
    group: "Compositions",
    states: [
      "foundations",
      "segmented-choice",
      "binary-choice",
      "switch",
      "number-stepper",
      "select",
      "range",
      "text",
      "search",
      "folder-picker",
      "validated-text",
      "multiline",
      "radio-cards",
      "checkbox",
      "shortcut",
      "disabled",
      "read-only",
      "feedback",
      "destructive-action",
      "interaction-contract",
    ],
  },
  { id: "overlays", label: "Overlays and recovery", group: "Compositions", states: ["dialog", "popover", "recovery"] },
  {
    id: "surfaces",
    label: "Surface roles",
    group: "Foundations",
    states: ["canvas", "surface-1", "surface-2", "surface-3", "raised", "selected"],
  },
  {
    id: "button",
    label: "Button",
    group: "Primitives",
    states: [
      "default-xs",
      "outline-xs",
      "destructive-xs",
      "ghost-xs",
      "ghost-xsm",
      "ghost-destructive-xs",
      "default-icon-sm",
      "outline-icon-sm",
      "ghost-icon-sm",
      "default-xs-disabled",
      "ghost-xs-disabled",
      "ghost-destructive-xs-disabled",
      "default-icon-sm-disabled",
      "ghost-icon-sm-disabled",
    ],
  },
  {
    id: "input",
    label: "Input",
    group: "Primitives",
    states: ["empty", "populated", "search", "invalid", "disabled"],
  },
  {
    id: "badge",
    label: "Badge",
    group: "Primitives",
    states: [
      "default",
      "secondary",
      "category",
      "selected",
      "status",
      "warning",
      "destructive",
      "interactive-off",
      "interactive-on",
      "disabled",
      "outline",
      "compact",
    ],
  },
  {
    id: "navigation",
    label: "Tabs",
    group: "Primitives",
    states: [
      "file-explorer-explorer",
      "file-explorer-bookmarks",
      "file-explorer-recent",
      "task-lifecycle-active",
      "task-lifecycle-closed",
      "task-layout-board",
      "task-layout-list",
      "task-layout-board-disabled",
      "task-layout-list-disabled",
    ],
  },
  {
    id: "context-menu",
    label: "Context menus",
    group: "Compositions",
    states: [
      "file-actions",
      "directory-actions",
      "workspace-root-actions",
      "note-tab-actions",
      "task-actions",
      "unavailable-actions",
    ],
  },
  {
    id: "drag-drop",
    label: "Drag and drop",
    group: "Compositions",
    states: [
      "file-preview-move",
      "file-preview-link",
      "folder-preview",
      "note-tab-preview",
      "task-preview-awaiting",
      "task-preview-target",
      "task-source",
      "task-board-slot",
      "task-list-slot",
      "note-tab-slot",
      "pane-split-slot",
    ],
  },
  {
    id: "task-card",
    label: "Task card",
    group: "Compositions",
    states: ["default", "warning", "closed"],
  },
  {
    id: "notification",
    label: "Notification",
    group: "Compositions",
    states: ["info", "busy", "warning", "error"],
  },
] as const satisfies readonly DesignGraphEntry[];

export const matchesDesignGraphEntry = (entry: DesignGraphEntry, query: string) => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [entry.label, entry.group, entry.id, ...entry.states].some((value) =>
    value.toLocaleLowerCase().includes(normalized),
  );
};
