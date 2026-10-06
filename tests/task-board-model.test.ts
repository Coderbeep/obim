import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  DEFAULT_TASK_BOARD_PROJECT_COLOR,
  TASK_BOARD_CONFIG_RELATIVE_PATH,
  parseTaskBoardConfigSource,
  pruneTaskOrderPaths,
  remapTaskOrderPaths,
  removeTaskOrderPaths,
  type TaskBoardProject,
} from "../src/renderer/src/shared/taskBoard";
import { applyTaskOrder, boardColumnIndexToGlobalIndex, moveTaskInSequence, replaceTaskOrderSlots } from "../src/renderer/src/features/task-board/taskBoardModel";
import { deriveTaskBoardProjects, deriveTaskBoardWorkflowColumns, filterTaskBoardTasks, sortTaskBoardTasks } from "../src/renderer/src/features/task-board/taskBoardModel";
import type { TaskBoardTask } from "../src/renderer/src/features/task-board/taskBoardModel";

const task = (id: string, project?: string): TaskBoardTask => ({
  id,
  filename: id,
  relativePath: `${id}.md`,
  path: `/notes/${id}.md`,
  isDirectory: false,
  mimeType: "text/markdown",
  title: id,
  status: "open",
  metadataIssues: [],
  ...(project === undefined ? {} : { project }),
});

const parseConfig = (source: string) => {
  const parsed = parseTaskBoardConfigSource(source);
  if (parsed.status !== "valid") assert.fail("Expected valid Task Board config");
  return parsed.config;
};

describe("Task Board presentation config", () => {
  test.each(["", "not json", "null", "[]", "{}", '{"sections":{}}', '{"labels":[],"listOrder":[]}'])(
    "rejects malformed config: %s",
    (source) => {
      assert.deepEqual(parseTaskBoardConfigSource(source), { status: "invalid" });
    },
  );

  test("accepts only normalized named projects with palette colors", () => {
    const config = parseConfig(
      JSON.stringify({
        projects: [
          { name: "  Research   Notes ", colorId: " blue " },
          { name: "Writing", colorId: "rose" },
          { name: "research notes", colorId: "amber" },
          { name: "Inbox", colorId: "teal" },
          { name: "Unknown color", colorId: "green" },
          { name: "", colorId: "teal" },
          { name: 3, colorId: "teal" },
          null,
        ],
        labels: [{ name: "Legacy", colorId: "teal" }],
        listOrder: ["legacy"],
      }),
    );

    assert.deepEqual(config, {
      projects: [
        { name: "Research Notes", colorId: "blue" },
        { name: "Writing", colorId: "rose" },
        { name: "Inbox", colorId: "teal" },
      ],
      taskOrder: [],
    });
    assert.equal(
      config.projects.some(({ name }) => name.toLocaleLowerCase() === "inbox"),
      true,
    );
  });

  test("loads optional hidden projects while keeping malformed values visible", () => {
    assert.deepEqual(
      parseConfig(
        JSON.stringify({
          projects: [
            { name: "Legacy", colorId: "blue" },
            { name: "Hidden", colorId: "rose", hidden: true },
            { name: "Explicitly visible", colorId: "amber", hidden: false },
            { name: "Malformed", colorId: "teal", hidden: "true" },
          ],
        }),
      ),
      {
        projects: [
          { name: "Legacy", colorId: "blue" },
          { name: "Hidden", colorId: "rose", hidden: true },
          { name: "Explicitly visible", colorId: "amber" },
          { name: "Malformed", colorId: "teal" },
        ],
        taskOrder: [],
      },
    );
  });

  test("keeps the fixed paths and defaults out of persisted project data", () => {
    assert.equal(TASK_BOARD_CONFIG_RELATIVE_PATH, ".todo/taskboard.json");
    assert.equal(DEFAULT_TASK_BOARD_PROJECT_COLOR, "teal");
    assert.deepEqual(parseConfig('{"projects":[]}'), {
      projects: [],
      taskOrder: [],
    });
  });

  test("does not read former sections as projects", () => {
    assert.deepEqual(parseTaskBoardConfigSource('{"sections":[{"name":"Research","colorId":"blue"}]}'), {
      status: "invalid",
    });
  });
});

describe("Task Board manual order", () => {
  test("validates manifest paths while ignoring duplicates, traversal, absolute paths, and legacy order", () => {
    assert.deepEqual(
      parseConfig(
        JSON.stringify({
          projects: [],
          taskOrder: [
            "Tasks/one.md",
            "Tasks/one.md",
            "/absolute.md",
            "C:/absolute.md",
            "../outside.md",
            "Tasks/../outside.md",
            "Tasks\\windows.md",
            "Projects/two.md",
          ],
          listOrder: ["legacy.md"],
        }),
      ).taskOrder,
      ["Tasks/one.md", "Projects/two.md"],
    );
  });

  test("keeps unlisted tasks first and applies canonical board order", () => {
    const tasks = [task("one", "Research"), task("external"), task("two", "Research"), task("three")];
    const ordered = applyTaskOrder(tasks, ["two.md", "one.md", "three.md", "stale.md"]);

    assert.deepEqual(
      ordered.map(({ id }) => id),
      ["external", "two", "one", "three"],
    );
    assert.deepEqual(deriveTaskBoardProjects(ordered, [{ name: "Research", colorId: "blue" }]), [
      { name: "Research", colorId: "blue" },
    ]);
  });

  test("inserts globally and within populated or empty board columns without disturbing other tasks", () => {
    const tasks = [task("a"), task("r1", "Research"), task("b"), task("r2", "Research")];
    assert.deepEqual(
      moveTaskInSequence(tasks, tasks[3], { kind: "board", index: 0 }).map(({ id }) => id),
      ["r2", "a", "r1", "b"],
    );
    assert.deepEqual(
      moveTaskInSequence(tasks, tasks[0], { kind: "board", project: "Research", index: 1 }).map(({ id }) => id),
      ["r1", "b", "a", "r2"],
    );
    assert.equal(boardColumnIndexToGlobalIndex(tasks, "Writing", 0), 0);
  });

  test("retains hidden lifecycle slots while active tasks reorder", () => {
    assert.deepEqual(
      replaceTaskOrderSlots(
        ["active-a.md", "done.md", "active-b.md", "cancelled.md"],
        new Set(["active-a.md", "active-b.md"]),
        ["active-b.md", "active-a.md"],
      ),
      ["active-b.md", "done.md", "active-a.md", "cancelled.md"],
    );
  });

  test("remaps file and directory paths and prunes only missing or removed task paths", () => {
    const order = ["Tasks/One.md", "Tasks/Nested/Two.md", "Closed.md"];
    assert.deepEqual(remapTaskOrderPaths(order, "Tasks", "Archive/Tasks", true), [
      "Archive/Tasks/One.md",
      "Archive/Tasks/Nested/Two.md",
      "Closed.md",
    ]);
    assert.deepEqual(remapTaskOrderPaths(order, "Closed.md", "Done.md"), [
      "Tasks/One.md",
      "Tasks/Nested/Two.md",
      "Done.md",
    ]);
    assert.deepEqual(pruneTaskOrderPaths(order, new Set(["Tasks/Nested/Two.md", "Closed.md"])), [
      "Tasks/Nested/Two.md",
      "Closed.md",
    ]);
    assert.deepEqual(removeTaskOrderPaths(order, "Tasks", true), ["Closed.md"]);
  });
});

describe("Task Board sorting", () => {
  const alpha = {
    ...task("alpha", "Research"),
    title: "Alpha",
    createdDate: "2026-08-02",
    dueDate: "2026-08-11",
    modifiedAtMs: 20,
    priority: "low" as const,
    tags: ["Zeta", "Extra"],
  };
  const beta = {
    ...task("beta", "Research"),
    title: "beta",
    createdDate: "2026-08-03",
    dueDate: "2026-08-10",
    modifiedAtMs: 30,
    priority: "high" as const,
    tags: ["Alpha"],
  };
  const gamma = { ...task("gamma"), title: "Gamma" };
  const tasks = [alpha, gamma, beta];
  test.each([
    ["due", "ascending", ["beta", "alpha", "gamma"]],
    ["due", "descending", ["alpha", "beta", "gamma"]],
    ["created", "descending", ["beta", "alpha", "gamma"]],
    ["modified", "descending", ["beta", "alpha", "gamma"]],
    ["title", "ascending", ["alpha", "beta", "gamma"]],
    ["tag", "ascending", ["beta", "alpha", "gamma"]],
    ["priority", "ascending", ["beta", "alpha", "gamma"]],
    ["custom", "ascending", ["alpha", "gamma", "beta"]],
  ] as const)("sorts by %s %s with missing values last", (sort, direction, expected) => {
    assert.deepEqual(
      sortTaskBoardTasks(tasks, sort === "custom" ? [] : [{ field: sort, direction }]).map(({ id }) => id),
      expected,
    );
  });
});

describe("Task Board columns", () => {
  test("derives the fixed workflow for one project and excludes cancelled tasks", () => {
    const backlog = task("backlog", "PCSS");
    const doing = { ...task("doing", "PCSS"), stage: "doing" as const };
    const review = { ...task("review", "PCSS"), stage: "review" as const };
    const done = { ...task("done", "PCSS"), status: "done" as const };
    const other = task("other", "Weather");
    const cancelled = { ...task("cancelled", "PCSS"), status: "cancelled" as const };

    assert.deepEqual(
      deriveTaskBoardWorkflowColumns([backlog, doing, review, done, other, cancelled], "PCSS").map(
        ({ name, stage, tasks }) => [name, stage, tasks.map(({ id }) => id)],
      ),
      [
        ["Backlog", "backlog", ["backlog"]],
        ["Doing", "doing", ["doing"]],
        ["Review", "review", ["review"]],
        ["Done", "done", ["done"]],
      ],
    );
  });

  const configured: TaskBoardProject[] = [
    { name: "Research", colorId: "blue" },
    { name: "Writing", colorId: "rose" },
  ];

  test("preserves configured order and appends task-discovered projects", () => {
    assert.deepEqual(
      deriveTaskBoardProjects(
        [task("zeta-1", "Zeta"), task("alpha", "alpha"), task("research", "Research"), task("zeta-2", "zeta")],
        configured,
      ),
      [
        { name: "Research", colorId: "blue" },
        { name: "Writing", colorId: "rose" },
        { name: "alpha", colorId: "teal" },
        { name: "Zeta", colorId: "teal" },
      ],
    );
  });

  test("uses case-insensitive identity and permits Inbox as an ordinary project", () => {
    assert.deepEqual(
      deriveTaskBoardProjects(
        [task("one", "research"), task("two", " RESEARCH "), task("three", "inbox")],
        [
          { name: "Research", colorId: "blue" },
          { name: " research ", colorId: "rose" },
          { name: "INBOX", colorId: "amber" },
        ],
      ),
      [
        { name: "Research", colorId: "blue" },
        { name: "INBOX", colorId: "amber" },
      ],
    );
  });
});

describe("Task Board filters", () => {
  const tasks: TaskBoardTask[] = [
    {
      ...task("release", "Writing"),
      title: "Ship release notes",
      preview: "Polish the migration guide",
      dueDate: "2026-08-27",
      priority: "high",
      tags: ["Docs"],
      frontmatterKeys: ["type", "reviewed", "task-due"],
    },
    {
      ...task("invoice"),
      title: "Pay invoice",
      dueDate: "2026-08-26",
      priority: "low",
      tags: ["Admin"],
      frontmatterKeys: ["type"],
    },
    { ...task("ideas", "Research"), title: "Explore ideas" },
  ];
  const all = {
    dueDateEndFilter: "",
    dueDateFilter: "",
    dueFilter: "all",
    priorityFilters: [],
    searchQuery: "",
    tagFilters: [],
  } as const;
  const today = new Date(2026, 7, 27);

  test("searches titles, previews, sections, and tags without changing order", () => {
    assert.deepEqual(
      filterTaskBoardTasks(tasks, { ...all, searchQuery: "migration" }, today).map(({ id }) => id),
      ["release"],
    );
    assert.deepEqual(
      filterTaskBoardTasks(tasks, { ...all, searchQuery: "research" }, today).map(({ id }) => id),
      ["ideas"],
    );
  });

  test("filters tasks by exact YAML key presence, including empty-valued properties", () => {
    assert.deepEqual(
      filterTaskBoardTasks(tasks, { ...all, yamlPropertyFilter: { key: "reviewed", operator: "has" } }, today).map(
        ({ id }) => id,
      ),
      ["release"],
    );
    assert.deepEqual(
      filterTaskBoardTasks(
        tasks,
        { ...all, yamlPropertyFilter: { key: "reviewed", operator: "does not have" } },
        today,
      ).map(({ id }) => id),
      ["invoice", "ideas"],
    );
  });

  test("combines multi-choice priority, tag, and missing-metadata filters", () => {
    assert.deepEqual(
      filterTaskBoardTasks(tasks, { ...all, priorityFilters: ["high"], tagFilters: ["docs"] }, today).map(
        ({ id }) => id,
      ),
      ["release"],
    );
    assert.deepEqual(
      filterTaskBoardTasks(tasks, { ...all, priorityFilters: ["none"], tagFilters: ["__untagged__"] }, today).map(
        ({ id }) => id,
      ),
      ["ideas"],
    );
    assert.deepEqual(
      filterTaskBoardTasks(
        tasks,
        { ...all, priorityFilters: ["high", "low"], tagFilters: ["docs", "admin"] },
        today,
      ).map(({ id }) => id),
      ["release", "invoice"],
    );
  });

  test("distinguishes overdue, today, upcoming, and undated tasks", () => {
    assert.deepEqual(
      filterTaskBoardTasks(tasks, { ...all, dueFilter: "overdue" }, today).map(({ id }) => id),
      ["invoice"],
    );
    assert.deepEqual(
      filterTaskBoardTasks(tasks, { ...all, dueFilter: "today" }, today).map(({ id }) => id),
      ["release"],
    );
    assert.deepEqual(
      filterTaskBoardTasks(tasks, { ...all, dueFilter: "no-date" }, today).map(({ id }) => id),
      ["ideas"],
    );
    assert.deepEqual(
      filterTaskBoardTasks(
        tasks,
        {
          ...all,
          dueDateFilter: "2026-08-26",
          dueDateEndFilter: "2026-08-27",
          dueFilter: "range",
        },
        today,
      ).map(({ id }) => id),
      ["release", "invoice"],
    );
  });
});

describe("mixed lifecycle display ordering", () => {
  const mixed: TaskBoardTask[] = [
    { ...task("A closed"), status: "done", dueDate: "2026-01-01", priority: "high" },
    { ...task("Z active"), dueDate: "2026-12-01", priority: "low" },
    { ...task("Z closed"), status: "cancelled", dueDate: "2026-12-31", priority: "low" },
    { ...task("A active"), dueDate: "2026-02-01", priority: "high" },
  ];
  test.each(["custom", "due", "created", "modified", "title", "tag", "priority"] as const)(
    "keeps closed tasks below active tasks for %s in either direction",
    (sort) => {
      for (const direction of ["ascending", "descending"] as const) {
        const sorted = sortTaskBoardTasks(mixed, sort === "custom" ? [] : [{ field: sort, direction }]);
        assert.deepEqual(
          sorted.slice(0, 2).map(({ status }) => status),
          ["open", "open"],
        );
        assert.ok(sorted.slice(2).every(({ status }) => status !== "open"));
        for (const open of [true, false]) {
          assert.deepEqual(
            sorted.filter(({ status }) => (status === "open") === open),
            sortTaskBoardTasks(
              mixed.filter(({ status }) => (status === "open") === open),
              sort === "custom" ? [] : [{ field: sort, direction }],
            ),
          );
        }
      }
    },
  );

});

test("pinned tasks lead every sort and preserve custom order within each group", () => {
  const tasks = [task("A"), { ...task("Z"), pinned: true }, { ...task("B"), pinned: true }, task("C")];
  for (const sort of ["custom", "due", "created", "modified", "title", "tag", "priority"] as const) {
    for (const direction of ["ascending", "descending"] as const) {
      const sorted = sortTaskBoardTasks(tasks, sort === "custom" ? [] : [{ field: sort, direction }]);
      assert.deepEqual(
        sorted.map((task) => Boolean(task.pinned)),
        [true, true, false, false],
      );
    }
  }
  assert.deepEqual(
    sortTaskBoardTasks(tasks, []).map((task) => task.id),
    ["Z", "B", "A", "C"],
  );
});

test("ordered sort rules break ties in sequence and keep missing values last", () => {
  const tasks = [
    { ...task("B low"), dueDate: "2026-10-01", priority: "low" as const },
    { ...task("A high"), dueDate: "2026-10-01", priority: "high" as const },
    { ...task("Undated"), priority: "high" as const },
    { ...task("Earlier"), dueDate: "2026-09-01", priority: "low" as const },
  ];
  const dueThenPriority = [
    { field: "due" as const, direction: "ascending" as const },
    { field: "priority" as const, direction: "ascending" as const },
  ];
  assert.deepEqual(
    sortTaskBoardTasks(tasks, dueThenPriority).map(({ id }) => id),
    ["Earlier", "A high", "B low", "Undated"],
  );
  assert.deepEqual(
    sortTaskBoardTasks(tasks, [...dueThenPriority].reverse()).map(({ id }) => id),
    ["A high", "Undated", "Earlier", "B low"],
  );
  assert.deepEqual(
    sortTaskBoardTasks(tasks, []).map(({ id }) => id),
    tasks.map(({ id }) => id),
  );
  const pinned = { ...task("Pinned"), pinned: true };
  const closed = { ...task("Closed"), status: "done" as const, dueDate: "2026-08-01" };
  assert.deepEqual(
    sortTaskBoardTasks([closed, ...tasks, pinned], dueThenPriority).map(({ id }) => id),
    ["Pinned", "Earlier", "A high", "B low", "Undated", "Closed"],
  );
});

test("board settings sanitize and preserve pinned task paths", () => {
  const parsed = parseTaskBoardConfigSource(
    JSON.stringify({ projects: [], taskOrder: [], pinnedTasks: ["tasks/A.md", "../escape.md", "tasks/A.md", 42] }),
  );
  assert.equal(parsed.status, "valid");
  if (parsed.status === "valid") assert.deepEqual(parsed.config.pinnedTasks, ["tasks/A.md"]);
});


describe("Task move anchors", () => {
  test("uses canonical anchors when pinned display positions differ", () => {
    const tasks = [task("A", "Research"), { ...task("Pinned", "Research"), pinned: true }, task("Moved", "Research")];
    assert.deepEqual(moveTaskInSequence(tasks, tasks[2], { kind: "board", project: "Research", stage: "backlog", index: 1, beforePath: tasks[0].path }).map(({ id }) => id), ["Moved", "A", "Pinned"]);
  });

  test("rebases against new canonical neighbors, and skips anchors that changed columns", () => {
    const tasks = [task("Concurrent", "Research"), task("Anchor", "Writing"), task("Next", "Research"), task("Moved", "Research")];
    assert.deepEqual(moveTaskInSequence(tasks, tasks[3], { kind: "board", project: "Research", stage: "backlog", index: 0, beforePath: tasks[1].path }).map(({ id }) => id), ["Concurrent", "Anchor", "Moved", "Next"]);
  });

  test.each([null, "/notes/missing.md"])("appends when the anchor is absent: %s", (beforePath) => {
    const tasks = [task("Moved", "Research"), task("Other", "Research")];
    assert.deepEqual(moveTaskInSequence(tasks, tasks[0], { kind: "board", project: "Research", stage: "backlog", index: 0, beforePath }).map(({ id }) => id), ["Other", "Moved"]);
  });
});

test("resolves a cancelled anchor against the full sequence while retaining its persisted slot", () => {
  const moved = task("Moved", "Research");
  const cancelled = { ...task("Cancelled", "Research"), status: "cancelled" as const };
  const next = task("Next", "Research");
  const last = task("Last", "Research");
  const canonical = [moved, cancelled, next, last];
  const active = canonical.filter(({ status }) => status !== "cancelled");
  const reordered = moveTaskInSequence(active, last, { kind: "board", project: "Research", stage: "backlog", index: 1, beforePath: cancelled.path }, canonical);
  assert.deepEqual(replaceTaskOrderSlots(canonical.map(({ relativePath }) => relativePath), new Set(active.map(({ relativePath }) => relativePath)), reordered.map(({ relativePath }) => relativePath)), ["Moved.md", "Cancelled.md", "Last.md", "Next.md"]);
});
