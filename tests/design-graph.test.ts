import { describe, expect, it } from "vitest";

import { DESIGN_GRAPH_INDEX, matchesDesignGraphEntry } from "../src/renderer/src/design-graph/designGraphIndex";

describe("design graph index", () => {
  it("keeps component and state identifiers unique and searchable", () => {
    expect(new Set(DESIGN_GRAPH_INDEX.map(({ id }) => id)).size).toBe(DESIGN_GRAPH_INDEX.length);
    DESIGN_GRAPH_INDEX.forEach((entry) => {
      expect(new Set(entry.states).size).toBe(entry.states.length);
    });

    expect(
      DESIGN_GRAPH_INDEX.filter((entry) => matchesDesignGraphEntry(entry, "disabled")).map(({ id }) => id),
    ).toEqual(["settings", "button", "input", "badge", "navigation"]);
    expect(DESIGN_GRAPH_INDEX.every((entry) => matchesDesignGraphEntry(entry, "  "))).toBe(true);
    expect(DESIGN_GRAPH_INDEX.map(({ id }) => id)).not.toContain("editor-controls");
    expect(DESIGN_GRAPH_INDEX.flatMap(({ states }) => states)).not.toEqual(
      expect.arrayContaining(["selection-formatting", "unavailable-formatting", "link-editing", "existing-link"]),
    );
    expect(DESIGN_GRAPH_INDEX.find(({ id }) => id === "context-menu")?.states).toEqual([
      "file-actions",
      "directory-actions",
      "workspace-root-actions",
      "note-tab-actions",
      "task-actions",
      "unavailable-actions",
    ]);
    expect(DESIGN_GRAPH_INDEX.find(({ id }) => id === "navigation")?.states).toEqual([
      "file-explorer-explorer",
      "file-explorer-bookmarks",
      "file-explorer-recent",
      "task-lifecycle-active",
      "task-lifecycle-closed",
      "task-layout-board",
      "task-layout-list",
      "task-layout-board-disabled",
      "task-layout-list-disabled",
    ]);
    expect(DESIGN_GRAPH_INDEX.find(({ id }) => id === "button")?.states).toEqual([
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
    ]);
    expect(DESIGN_GRAPH_INDEX.find(({ id }) => id === "drag-drop")?.states).toEqual([
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
    ]);
  });
});
