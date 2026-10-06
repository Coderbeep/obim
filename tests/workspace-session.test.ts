import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { loadRestoredTextFileBuffers, restoreWorkspaceSession } from "../src/renderer/src/app/useWorkspaceSession";
import type { FileItem } from "../src/shared/file-item";
import { createFileWorkspaceItemKey, createTaskBoardWorkspaceItem } from "../src/shared/workspace";
import {
  MAX_WORKSPACE_SESSION_RECENT_FILES,
  WORKSPACE_SESSION_VERSION,
  parseWorkspaceSession,
  type WorkspaceSession,
} from "../src/shared/workspace-session";

const note: Extract<FileItem, { isDirectory: false }> = {
  id: "note",
  filename: "Note",
  relativePath: "Projects/Note.md",
  path: "/notes/Projects/Note.md",
  isDirectory: false,
  mimeType: "text/markdown",
};

const tree: FileItem[] = [
  {
    id: "projects",
    filename: "Projects",
    relativePath: "Projects",
    path: "/notes/Projects",
    isDirectory: true,
    mimeType: null,
    children: [note],
  },
];

const session = (): WorkspaceSession => ({
  activePaneId: "pane-2",
  expandedDirectories: ["Projects", "Missing"],
  explorerSectionSizes: { bookmarks: 1.25, files: 2.5, recent: 0.75 },
  explorerSections: { bookmarks: false, files: true, recent: true },
  fileAccesses: { [note.path]: 1_787_933_300_000, "/notes/Missing.md": 1_787_933_200_000 },
  panes: [
    { id: "pane-1", tabs: ["tab-note"], activeTabId: "tab-note", size: 2 },
    { id: "pane-2", tabs: ["tab-board", "tab-missing"], activeTabId: "tab-board", size: 1 },
  ],
  recentFilePaths: [note.path, "/notes/Missing.md"],
  tabs: [
    {
      id: "tab-note",
      currentResourceKey: createFileWorkspaceItemKey(note.path),
      backStack: [createFileWorkspaceItemKey(note.path)],
      forwardStack: [createFileWorkspaceItemKey("/notes/Missing.md")],
    },
    {
      id: "tab-board",
      currentResourceKey: createTaskBoardWorkspaceItem().key,
      backStack: [createTaskBoardWorkspaceItem().key],
      forwardStack: [],
    },
    {
      id: "tab-missing",
      currentResourceKey: createFileWorkspaceItemKey("/notes/Missing.md"),
      backStack: [createFileWorkspaceItemKey("/notes/Missing.md")],
      forwardStack: [],
    },
  ],
  taskBoard: {
    activeSavedFilterId: "saved-weekly",
    collapsedSubtaskPaths: [note.path],
    dueDateEndFilter: "",
    dueDateFilter: "",
    dueFilter: "week",

    lifecycleView: "closed",
    priorityFilters: ["high", "medium"],
    savedFilters: [
      {
        dueDateEndFilter: "",
        dueDateFilter: "",
        dueFilter: "week",
        id: "saved-weekly",
        lifecycleView: "closed",
        name: "Weekly review",
        priorityFilters: ["high", "medium"],
        searchQuery: "review",
        tagFilters: ["paper", "writing"],
      },
    ],
    searchQuery: "review",
    sortRules: [{ field: "modified", direction: "descending" }],
    tagFilters: ["paper", "writing"],
  },
  version: WORKSPACE_SESSION_VERSION,
});

describe("workspace session", () => {
  test("restores bounded collapsed subtask paths and defaults older sessions to expanded", () => {
    const current = session();
    assert.deepEqual(parseWorkspaceSession(current)?.taskBoard.collapsedSubtaskPaths, [note.path]);
    const older = { ...current, taskBoard: { ...current.taskBoard } };
    delete (older.taskBoard as Partial<WorkspaceSession["taskBoard"]>).collapsedSubtaskPaths;
    assert.deepEqual(parseWorkspaceSession(older)?.taskBoard.collapsedSubtaskPaths, []);
    assert.equal(
      parseWorkspaceSession({
        ...current,
        taskBoard: { ...current.taskBoard, collapsedSubtaskPaths: Array(501).fill(note.path) },
      }),
      null,
    );
    assert.equal(
      parseWorkspaceSession({ ...current, taskBoard: { ...current.taskBoard, collapsedSubtaskPaths: [42] } }),
      null,
    );
  });

  test("round-trips YAML property filters and rejects malformed keys or operators", () => {
    const base = session();
    const rule = { key: "reviewed", operator: "has" } as const;
    const taskBoard = {
      ...base.taskBoard,
      yamlPropertyFilter: rule,
      savedFilters: [{ ...base.taskBoard.savedFilters[0], yamlPropertyFilter: rule }],
    };
    assert.deepEqual(parseWorkspaceSession({ ...base, taskBoard })?.taskBoard.yamlPropertyFilter, rule);
    assert.deepEqual(
      parseWorkspaceSession({ ...base, taskBoard })?.taskBoard.savedFilters[0]?.yamlPropertyFilter,
      rule,
    );
    assert.equal(
      parseWorkspaceSession({
        ...base,
        taskBoard: { ...taskBoard, yamlPropertyFilter: { key: " ", operator: "has" } },
      }),
      null,
    );
    assert.equal(
      parseWorkspaceSession({
        ...base,
        taskBoard: { ...taskBoard, yamlPropertyFilter: { key: "reviewed", operator: "contains" } },
      }),
      null,
    );
  });

  test("accepts bounded ordered sort rules while preserving legacy sessions", () => {
    const currentSession = session();
    const rules = [
      { field: "due", direction: "ascending" },
      { field: "priority", direction: "descending" },
    ];
    const updated = { ...currentSession, taskBoard: { ...currentSession.taskBoard, sortRules: rules } };
    assert.deepEqual(parseWorkspaceSession(updated)?.taskBoard.sortRules, rules);
    const legacyBoard = { ...currentSession.taskBoard } as Record<string, unknown>;
    delete legacyBoard.sortRules;
    const oldSession = {
      ...currentSession,
      taskBoard: { ...legacyBoard, sort: "modified", sortDirection: "descending" },
    };
    assert.deepEqual(parseWorkspaceSession(oldSession)?.taskBoard.sortRules, [
      { field: "modified", direction: "descending" },
    ]);
    assert.equal(
      parseWorkspaceSession({ ...oldSession, taskBoard: { ...oldSession.taskBoard, sortRules: [rules[0], rules[0]] } }),
      null,
    );
    assert.equal(
      parseWorkspaceSession({
        ...oldSession,
        taskBoard: { ...oldSession.taskBoard, sortRules: [{ field: "custom", direction: "ascending" }] },
      }),
      null,
    );
    assert.equal(
      parseWorkspaceSession({
        ...oldSession,
        taskBoard: { ...oldSession.taskBoard, sortRules: Array(7).fill(rules[0]) },
      }),
      null,
    );
  });

  test("validates the durable session boundary", () => {
    assert.deepEqual(parseWorkspaceSession(session()), session());
    assert.equal(parseWorkspaceSession({ ...session(), version: 2 }), null);
    assert.equal(
      parseWorkspaceSession({ ...session(), panes: [{ id: "pane", tabs: [], activeTabId: null, size: 0 }] }),
      null,
    );

    assert.equal(
      parseWorkspaceSession({ ...session(), explorerSectionSizes: { bookmarks: 1, files: 0, recent: 1 } }),
      null,
    );

    assert.equal(
      parseWorkspaceSession({
        ...session(),
        recentFilePaths: Array.from(
          { length: MAX_WORKSPACE_SESSION_RECENT_FILES + 1 },
          (_, index) => `/notes/${index}.md`,
        ),
      }),
      null,
    );
  });

  test("uses stable Explorer section sizes for sessions saved before resizing was available", () => {
    const olderSession: Record<string, unknown> = { ...session() };
    delete olderSession.explorerSectionSizes;

    assert.deepEqual(parseWorkspaceSession(olderSession)?.explorerSectionSizes, {
      bookmarks: 1,
      files: 2,
      recent: 1,
    });
  });

  test("restores an empty file access history for older sessions", () => {
    const olderSession: Record<string, unknown> = { ...session() };
    delete olderSession.fileAccesses;

    assert.deepEqual(parseWorkspaceSession(olderSession)?.fileAccesses, {});
  });

  test("rejects malformed file access history", () => {
    assert.equal(parseWorkspaceSession({ ...session(), fileAccesses: { [note.path]: Number.NaN } }), null);
  });

  test("restores sessions saved before named and multi-choice task filters were available", () => {
    const olderSession = session() as Omit<WorkspaceSession, "taskBoard"> & {
      taskBoard: Partial<WorkspaceSession["taskBoard"]>;
    };
    Object.assign(olderSession.taskBoard, { priorityFilter: "high", tagFilter: "paper" });
    delete olderSession.taskBoard.activeSavedFilterId;
    delete olderSession.taskBoard.dueDateEndFilter;
    delete olderSession.taskBoard.dueDateFilter;
    delete olderSession.taskBoard.priorityFilters;
    delete olderSession.taskBoard.savedFilters;
    delete olderSession.taskBoard.tagFilters;

    assert.deepEqual(parseWorkspaceSession(olderSession)?.taskBoard.savedFilters, []);
    assert.equal(parseWorkspaceSession(olderSession)?.taskBoard.activeSavedFilterId, null);
    assert.deepEqual(parseWorkspaceSession(olderSession)?.taskBoard.priorityFilters, ["high"]);
    assert.deepEqual(parseWorkspaceSession(olderSession)?.taskBoard.tagFilters, ["paper"]);
    const migrated = parseWorkspaceSession(olderSession);
    assert.ok(migrated);
    assert.equal("priorityFilter" in migrated.taskBoard, false);
    assert.equal("tagFilter" in migrated.taskBoard, false);
    assert.equal("savedView" in migrated.taskBoard, false);
    assert.deepEqual(parseWorkspaceSession(JSON.parse(JSON.stringify(migrated))), migrated);
  });

  test("migrates legacy exact-date filters to one-day ranges", () => {
    const legacySession = session();
    const legacyTaskBoard = legacySession.taskBoard as unknown as Record<string, unknown>;
    const legacySavedFilter = legacySession.taskBoard.savedFilters[0] as unknown as Record<string, unknown>;
    legacyTaskBoard.dueFilter = "date";
    legacyTaskBoard.dueDateFilter = "2026-08-28";
    delete legacyTaskBoard.dueDateEndFilter;
    legacySavedFilter.dueFilter = "date";
    legacySavedFilter.dueDateFilter = "2026-08-29";
    delete legacySavedFilter.dueDateEndFilter;

    const parsed = parseWorkspaceSession(legacySession);
    assert.equal(parsed?.taskBoard.dueFilter, "range");
    assert.equal(parsed?.taskBoard.dueDateEndFilter, "2026-08-28");
    assert.equal(parsed?.taskBoard.savedFilters[0]?.dueFilter, "range");
    assert.equal(parsed?.taskBoard.savedFilters[0]?.dueDateEndFilter, "2026-08-29");
  });

  test("completes and orders persisted date ranges", () => {
    const rangedSession = session();
    rangedSession.taskBoard.dueFilter = "range";
    rangedSession.taskBoard.dueDateFilter = "2026-08-28";
    rangedSession.taskBoard.dueDateEndFilter = "2026-08-26";
    rangedSession.taskBoard.savedFilters[0]!.dueFilter = "range";
    rangedSession.taskBoard.savedFilters[0]!.dueDateFilter = "2026-08-27";
    rangedSession.taskBoard.savedFilters[0]!.dueDateEndFilter = "";

    const parsed = parseWorkspaceSession(rangedSession);
    assert.equal(parsed?.taskBoard.dueDateFilter, "2026-08-26");
    assert.equal(parsed?.taskBoard.dueDateEndFilter, "2026-08-28");
    assert.equal(parsed?.taskBoard.savedFilters[0]?.dueDateFilter, "2026-08-27");
    assert.equal(parsed?.taskBoard.savedFilters[0]?.dueDateEndFilter, "2026-08-27");
  });

  test("restores valid resources and preserves missing current notes for load recovery", () => {
    const restored = restoreWorkspaceSession(session(), tree);

    assert.equal(restored.activePaneId, "pane-2");
    assert.deepEqual([...restored.expandedDirectories], ["Projects"]);
    assert.deepEqual(restored.recentFiles, [note]);
    assert.deepEqual(Object.keys(restored.tabsById), ["tab-note", "tab-board", "tab-missing"]);
    assert.deepEqual(restored.panes[1].tabs, ["tab-board", "tab-missing"]);
    assert.deepEqual(restored.tabsById["tab-note"].forwardStack, []);
    assert.deepEqual(restored.explorerSections, { bookmarks: false, files: true, recent: true });
    assert.deepEqual(restored.explorerSectionSizes, { bookmarks: 1.25, files: 2.5, recent: 0.75 });
    assert.deepEqual(restored.fileAccesses, { [note.path]: 1_787_933_300_000 });
    assert.equal(restored.taskBoard.lifecycleView, "closed");
  });

  test("repairs a persisted single pane that retained a fractional split size", () => {
    const brokenSession = session();
    brokenSession.activePaneId = "pane-1";
    brokenSession.panes = [{ id: "pane-1", tabs: [], activeTabId: null, size: 0.6295923502767993 }];
    brokenSession.tabs = [];

    const restored = restoreWorkspaceSession(brokenSession, tree);

    assert.deepEqual(restored.panes, [{ id: "pane-1", tabs: [], activeTabId: null, size: 1 }]);
  });

  test("loads the text buffers for restored editor tabs before they render", async () => {
    const restored = restoreWorkspaceSession(session(), tree);
    const readFile = async (path: string) =>
      path !== note.path
        ? { success: false as const, error: "ENOENT: missing" }
        : {
            success: true as const,
            content: path === note.path ? "restored note contents" : "unexpected",
            version: { id: "restored", mtimeMs: 100, sizeBytes: 22 },
          };

    const buffers = await loadRestoredTextFileBuffers(restored.tabsById, restored.itemsByKey, readFile);

    assert.deepEqual(buffers, [
      {
        path: note.path,
        content: "restored note contents",
        version: { id: "restored", mtimeMs: 100, sizeBytes: 22 },
      },
    ]);
  });
});

test.each(["all", "none"] as const)("preserves %s status selection in workspace and saved filters", (lifecycleView) => {
  const input = session();
  input.taskBoard.lifecycleView = lifecycleView;
  input.taskBoard.savedFilters[0].lifecycleView = lifecycleView;
  const restored = parseWorkspaceSession(JSON.parse(JSON.stringify(input)));
  assert.equal(restored?.taskBoard.lifecycleView, lifecycleView);
  assert.equal(restored?.taskBoard.savedFilters[0].lifecycleView, lifecycleView);
});

test("discards retired List-view preferences while keeping the rest of a legacy session", () => {
  const current = session();
  const legacy = {
    ...current,
    taskBoard: { ...current.taskBoard, viewMode: "list", grouping: "tag", compactMode: true },
  };
  assert.deepEqual(parseWorkspaceSession(legacy), current);
});

test("ignores stale PDF reading state saved by older versions", () => {
  const parsed = parseWorkspaceSession({
    ...session(),
    pdfResearchAccesses: {
      "Papers/report.pdf": {
        accessedAt: 1_787_933_400_000,
        page: 7,
        scale: 1.5,
        zoomMode: "custom",
        spreadMode: "odd",
        activeNoteRelativePath: "Notes/old.md",
        companionOpen: true,
        sessionSplit: 0.6,
      },
    },
  });
  assert.deepEqual(parsed, session());
  assert.equal("pdfResearchAccesses" in (parsed ?? {}), false);
});
