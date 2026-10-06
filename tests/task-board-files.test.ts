import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  createTaskMarkdown,
  parseTaskMarkdown,
  repairTaskMetadata,
  setTaskBoardProject,
  setTaskBoardStage,
  setTaskLifecycle,
  setTaskDueDate,
  setTaskPriority,
  setTaskTags,
  updateTaskMetadata,
} from "../src/renderer/src/features/task-board/taskBoardFiles";
import { getFrontmatterProperty, getFrontmatterStringList, parseFrontmatter } from "../src/shared/frontmatter";
import type { FileItem } from "../src/shared/file-item";

const file: Extract<FileItem, { isDirectory: false }> = {
  id: "/notes/Fallback.md",
  filename: "Fallback",
  relativePath: "Fallback.md",
  path: "/notes/Fallback.md",
  isDirectory: false,
  mimeType: "text/markdown",
};

const sourceWith = (properties: string, body = "# Read the paper\n\nCapture the claims.") =>
  `---\n${properties}\n---\n${body}`;

describe("task identity", () => {
  test.each([
    ["plain scalar", "type: task", true],
    ["quoted value with extra whitespace", 'type: "  task  "', false],
    ["case-sensitive value", "type: Task", false],
    ["missing property", "tags: [task]", false],
    ["list", "type: [task]", false],
    ["number", "type: 1", false],
    ["boolean", "type: true", false],
    ["task-due", "type: 2026-07-22", false],
    ["null", "type:", false],
  ])("recognizes only type: task as a string (%s)", (_name, properties, expected) => {
    assert.equal(Boolean(parseTaskMarkdown(sourceWith(properties), file)), expected);
  });

  test("keeps invalid task frontmatter visible with a warning", () => {
    const task = parseTaskMarkdown("---\ntype: task\nbroken: [\n---\n# Hidden", file);
    assert.ok(task);
    assert.equal(task.status, "open");
    assert.ok(task.metadataIssues.length);
    assert.deepEqual(task.frontmatterKeys, []);

    assert.ok(parseTaskMarkdown('---\ntype: "task"\nbroken: [\n---\n# Hidden', file));
  });
});

describe("task metadata", () => {
  test("does not interpret the former task-section field as project membership", () => {
    assert.equal(parseTaskMarkdown(sourceWith("type: task\ntask-section: Research"), file)?.project, undefined);
  });

  test.each([
    ["task-project: Research", "Research"],
    ['task-project: "  Research   Notes  "', "Research Notes"],
    ['task-project: ""', undefined],
    ["task-project: Inbox", "Inbox"],
    ['task-project: "  iNbOx  "', "iNbOx"],
    ["task-project: [Research]", undefined],
    ["task-project: 2026-07-22", undefined],
    ["task-project: true", undefined],
  ])("uses only a normalized string project (%s)", (sectionProperty, expected) => {
    assert.equal(parseTaskMarkdown(sourceWith(`type: task\n${sectionProperty}`), file)?.project, expected);
  });

  test("retains completed task metadata for file-preserving bulk edits", () => {
    const parsed = parseTaskMarkdown(sourceWith("type: task\ntask-project: Research\ntask-status: done"), file);

    assert.deepEqual(parsed, {
      ...file,
      title: "Fallback",
      preview: "# Read the paper\n\nCapture the claims.",
      status: "done",
      metadataIssues: [],
      frontmatterKeys: ["type", "task-project", "task-status"],
      project: "Research",
    });
  });

  test("does not inherit stale task fields from file metadata", () => {
    const staleTask = {
      ...file,
      title: "Old title",
      details: "Old details",
      dueDate: "2026-08-10",
      priority: "high" as const,
      project: "Research",
      tags: ["old"],
    };

    assert.deepEqual(parseTaskMarkdown(sourceWith("type: task", "# Current title"), staleTask), {
      ...file,
      title: "Fallback",
      preview: "# Current title",
      status: "open",
      metadataIssues: [],
      frontmatterKeys: ["type"],
    });
  });

  test("reads a genuine date-only date and normalized lowercase string-list tags", () => {
    const task = parseTaskMarkdown(
      sourceWith('type: task\ntask-due: 2026-08-03\ntags: [Research, "  Deep   Work  ", research, "", Writing]'),
      file,
    );

    assert.ok(task);
    assert.equal(task.dueDate, "2026-08-03");
    assert.deepEqual(task.tags, ["Research", "Deep Work", "Writing"]);
  });

  test("records YAML property presence even when the value is empty", () => {
    const task = parseTaskMarkdown(sourceWith("type: task\nreviewed:\ncustom-field: false"), file);
    assert.deepEqual(task?.frontmatterKeys, ["type", "reviewed", "custom-field"]);
  });

  test.each([
    ["task-priority: urgent", "high"],
    ['task-priority: "  HIGH  "', "high"],
    ["task-priority: Medium", "medium"],
    ["task-priority: low", "low"],
    ["task-priority: someday", undefined],
    ["task-priority: [high]", undefined],
    ["task-priority: 1", undefined],
  ] as const)("parses only supported priority text (%s)", (property, expected) => {
    assert.equal(parseTaskMarkdown(sourceWith(`type: task\n${property}`), file)?.priority, expected);
  });

  test("reports unsupported authored priorities as task metadata errors", () => {
    const task = parseTaskMarkdown(sourceWith("type: task\ntask-priority: custom"), file);
    assert.deepEqual(task?.metadataIssues, ["“task-priority” must be high, medium, or low."]);
  });

  test.each([
    ["task-due: 2026-08-03T12:00:00Z", "timestamp"],
    ["task-due: soon", "plain string"],
    ["task-due: [2026-08-03]", "list"],
    ["Date: 2026-08-03", "different key casing"],
  ])("ignores malformed or non-date-only date metadata (%s: %s)", (property) => {
    assert.equal(parseTaskMarkdown(sourceWith(`type: task\n${property}`), file)?.dueDate, undefined);
  });

  test.each([
    ["tags: [Research, 3]", "mixed list"],
    ["tags: 2026-08-03", "task-due"],
    ["Tags: [Research]", "different key casing"],
  ])("ignores malformed or non-string-list tags metadata (%s: %s)", (property) => {
    assert.equal(parseTaskMarkdown(sourceWith(`type: task\n${property}`), file)?.tags, undefined);
  });

  test("ignores legacy Task Board properties", () => {
    const task = parseTaskMarkdown(
      sourceWith(
        "type: task\nLabels: [Research]\nlabels: [Writing]\nlist: Done\ndueDate: 2026-08-01\ntask-completed: true",
      ),
      file,
    );

    assert.ok(task);
    assert.equal(task.dueDate, undefined);
    assert.equal(task.project, undefined);
    assert.equal(task.status, "open");
    assert.equal(task.tags, undefined);
    assert.equal(task.preview, "# Read the paper\n\nCapture the claims.");
  });

  test("always uses the filename and omits only a duplicate leading H1 from preview", () => {
    assert.deepEqual(parseTaskMarkdown(sourceWith("type: task", "# Heading\n\nLine one.\nLine two."), file), {
      ...file,
      title: "Fallback",
      preview: "# Heading\n\nLine one.\nLine two.",
      status: "open",
      metadataIssues: [],
      frontmatterKeys: ["type"],
    });
    assert.deepEqual(parseTaskMarkdown(sourceWith("type: task", "# Fallback\n\nBody without a heading."), file), {
      ...file,
      title: "Fallback",
      preview: "Body without a heading.",
      status: "open",
      metadataIssues: [],
      frontmatterKeys: ["type"],
    });
  });

  test.each(["\n", "\r\n", "\r"])(
    "keeps preview headings and code examples independent of subtasks (%j)",
    (newline) => {
      const body = [
        "# Authored title",
        "",
        "## Notes",
        "Keep this text.",
        "",
        "```md",
        "# Code heading",
        "- [ ] Example",
        "```",
      ].join(newline);
      const source = sourceWith("type: task\ntask-title: Authored title", body);
      const preview = body.slice(body.indexOf("## Notes"));
      assert.equal(parseTaskMarkdown(source, file)?.preview, preview);
      const withSubtasks = source + newline + newline + "- [ ] Real" + newline + "  - [x] Nested" + newline;
      assert.equal(parseTaskMarkdown(withSubtasks, file)?.preview, preview);
      assert.deepEqual(
        parseTaskMarkdown(withSubtasks, file)?.subtasks?.map(({ text }) => text),
        ["Real", "Nested"],
      );
    },
  );

  test("omits checkbox-only previews without hiding unrelated headings", () => {
    assert.equal(parseTaskMarkdown(sourceWith("type: task", "- [ ] One\n- [x] Two"), file)?.preview, undefined);
    assert.equal(parseTaskMarkdown(sourceWith("type: task", "# Context\n- [ ] One"), file)?.preview, "# Context");
  });

  test.each(["    ", "\t"])("keeps a leading indented heading example (%j)", (indent) => {
    const body = `${indent}# Authored title`;
    const source = sourceWith("type: task\ntask-title: Authored title", body);
    assert.equal(parseTaskMarkdown(source, file)?.preview, body);
    assert.equal(parseTaskMarkdown(source + "\n\n- [ ] Real\n", file)?.preview, body);
  });

  test("preserves mixed line endings and continuation text while omitting an EOF checkbox", () => {
    const body = "# Fallback\r\n\r\nNotes\r- [ ] Real\nContinuation text.\r\n- [x] EOF";
    const task = parseTaskMarkdown(sourceWith("type: task", body), file);
    assert.equal(task?.preview, "Notes\rContinuation text.");
    assert.deepEqual(
      task?.subtasks?.map(({ text }) => text),
      ["Real", "EOF"],
    );
  });
});

describe("task Markdown edits", () => {
  test("writes project and active workflow stage while Done remains lifecycle state", () => {
    const created = createTaskMarkdown({ taskName: "Ship it", project: "PCSS", stage: "review" }, "2026-09-25");
    assert.match(created, /task-project: PCSS/);
    assert.match(created, /task-stage: review/);
    assert.equal(parseTaskMarkdown(created, file)?.stage, "review");

    const done = setTaskLifecycle(setTaskBoardStage(created, "doing"), "done", "2026-09-25");
    const parsed = parseTaskMarkdown(done, file);
    assert.equal(parsed?.status, "done");
    assert.equal(parsed?.stage, "doing");
    assert.equal(parsed?.closedDate, "2026-09-25");
  });

  test("T01 repair changes only a safely interpretable invalid field and is idempotent", () => {
    const source = sourceWith(
      '# Keep this comment\ntype: task\ntask-status: [open]\ntask-created: "2026-08-01"\ntask-due: "2026-08-10"\ntags: paper\nowner: Ada\ncustom: { value: yes }',
    );
    const task = parseTaskMarkdown(source, file)!;
    const repaired = repairTaskMetadata(source, task);
    assert.equal(repaired, source.replace("task-status: [open]", "task-status: open"));
    const parsed = parseTaskMarkdown(repaired, file)!;
    assert.equal(parsed.dueDate, "2026-08-10");
    assert.deepEqual(parsed.tags, ["paper"]);
    assert.deepEqual(parsed.metadataIssues, []);
    assert.equal(repairTaskMetadata(repaired, parsed), repaired);
  });

  test("T01 ambiguous invalid values remain authored and produce a manual-repair explanation", () => {
    const source = sourceWith("type: task\ntask-status: [open, done]\ntask-due: soon\ntags: [paper, writing]");
    assert.throws(
      () => repairTaskMetadata(source, parseTaskMarkdown(source, file)!),
      /cannot.*repair.*automatically|manually/i,
    );
  });

  test("T01 several unambiguous fields normalize without changing comments, shared list tags or unknown values", () => {
    const source = sourceWith(
      "# Authored note\ntype: task\ntask-status: [done]\ntask-due: [2026-08-10]\ntask-priority: [high]\ntags: [paper, writing] # shared metadata\ncustom: { value: yes }",
    );
    const repaired = repairTaskMetadata(source, parseTaskMarkdown(source, file)!);
    assert.equal(
      repaired,
      source.replace("[done]", "done").replace("[2026-08-10]", "2026-08-10").replace("[high]", "high"),
    );
    const ordinaryDetails = parseFrontmatter(repaired);
    assert.equal(getFrontmatterProperty(ordinaryDetails, "task-status")?.value.kind, "string");
    assert.deepEqual(getFrontmatterStringList(ordinaryDetails, "tags"), ["paper", "writing"]);
    assert.deepEqual(parseTaskMarkdown(repaired, file)?.metadataIssues, []);
  });

  test("T01 an authored closure date on an open task is retained for explicit review", () => {
    const source = sourceWith('type: task\ntask-status: open\ntask-closed: "2026-08-10"');
    const parsed = parseTaskMarkdown(source, file)!;
    assert.ok(parsed.metadataIssues.includes("Open tasks cannot have “task-closed”."));
    assert.throws(() => repairTaskMetadata(source, parsed), /conflict.*cannot be repaired automatically/);
  });

  test("creates ordinary task Markdown with Inbox as a project", () => {
    const inbox = createTaskMarkdown(
      {
        initialBody: "Capture the important claims.",
        project: " inbox ",
      },
      "2026-08-03",
    );
    const task = parseTaskMarkdown(inbox, file);

    assert.ok(task);
    assert.equal(task.title, "Fallback");
    assert.equal(task.preview, "Capture the important claims.");
    assert.equal(task.createdDate, "2026-08-03");
    assert.doesNotMatch(inbox, /^# Read the paper/m);
    assert.equal(task.project, "inbox");
    assert.equal(getFrontmatterProperty(parseFrontmatter(inbox), "type")?.value.kind, "string");
    assert.equal(getFrontmatterProperty(parseFrontmatter(inbox), "task-due"), undefined);
    assert.equal(getFrontmatterProperty(parseFrontmatter(inbox), "task-project")?.value.kind, "string");
    assert.equal(getFrontmatterProperty(parseFrontmatter(inbox), "tags"), undefined);
  });

  test("creates and round-trips a genuine date and normalized tags", () => {
    const source = createTaskMarkdown(
      {
        dueDate: "2026-08-03",
        tags: [" Research ", "Deep   Work", "research", ""],
      },
      "2026-08-03",
    );
    const frontmatter = parseFrontmatter(source);
    const date = getFrontmatterProperty(frontmatter, "task-due")?.value;

    assert.deepEqual(date, {
      kind: "date",
      value: "2026-08-03",
      dateOnly: true,
      source: "2026-08-03",
    });
    assert.deepEqual(getFrontmatterStringList(frontmatter, "tags"), ["Research", "Deep Work"]);
    assert.doesNotMatch(source, /task-due: ["']2026-08-03["']/);
    assert.deepEqual(parseTaskMarkdown(source, file), {
      ...file,
      title: "Fallback",
      status: "open",
      createdDate: "2026-08-03",
      metadataIssues: [],
      frontmatterKeys: ["type", "task-status", "task-created", "task-due", "tags"],
      dueDate: "2026-08-03",
      tags: ["Research", "Deep Work"],
    });
  });

  test("rejects an invalid date instead of writing it as text", () => {
    assert.throws(() => createTaskMarkdown({ dueDate: "tomorrow" }), /YYYY-MM-DD/);
  });

  test("creates and round-trips a normalized named section", () => {
    const source = createTaskMarkdown({ project: "  Research   Notes " });
    const section = getFrontmatterProperty(parseFrontmatter(source), "task-project")?.value;

    assert.equal(section?.kind === "string" ? section.value : undefined, "Research Notes");
    assert.equal(parseTaskMarkdown(source, file)?.project, "Research Notes");
  });

  test("creates, canonicalizes, changes, and removes priority", () => {
    const created = createTaskMarkdown({ priority: "high" });
    assert.match(created, /task-priority: high/);
    assert.equal(parseTaskMarkdown(created, file)?.priority, "high");

    const high = setTaskPriority(created, "high");
    assert.match(high, /task-priority: high/);
    assert.equal(parseTaskMarkdown(high, file)?.priority, "high");
    assert.equal(getFrontmatterProperty(parseFrontmatter(setTaskPriority(high)), "task-priority"), undefined);
  });

  test("preserves unknown authored priority during unrelated edits and blocks unsafe priority changes", () => {
    const unknown = sourceWith("type: task\ntask-priority: custom # keep\nowner: Ada");
    const updated = updateTaskMetadata(unknown, {
      tags: [],
    });
    assert.match(updated, /task-priority: custom # keep/);
    assert.throws(() => setTaskPriority(unknown, "high"), /through task fields/);
    assert.throws(() => setTaskPriority(sourceWith("type: task\ntask-priority: [high]"), "low"), /through task fields/);
  });

  test("semantic priority no-ops preserve authored casing and bytes", () => {
    const source = sourceWith('type: task\ntask-priority: " HIGH "\nowner: Ada');
    assert.equal(setTaskPriority(source, "high"), source);
  });

  test("semantic no-ops preserve commented metadata before applying shape guards", () => {
    const source = sourceWith(
      "type: task\ntask-project: Research # project\ntask-stage: doing # stage\ntask-priority: high # priority\ntask-due: 2026-08-10 # due\ntags: [paper] # tags",
    );
    assert.equal(setTaskBoardProject(source, "Research"), source);
    assert.equal(setTaskBoardStage(source, "doing"), source);
    assert.equal(setTaskPriority(source, "high"), source);
    assert.equal(setTaskDueDate(source, "2026-08-10"), source);
    assert.equal(setTaskTags(source, ["paper"]), source);
  });

  test("optional-field no-ops leave uninterpretable authored values untouched", () => {
    const source = sourceWith(
      "type: task\ntask-project: [Research]\ntask-priority: [high]\ntask-due: soon\ntags: {name: paper}",
    );
    assert.equal(setTaskBoardProject(source), source);
    assert.equal(setTaskPriority(source), source);
    assert.equal(setTaskDueDate(source), source);
    assert.equal(setTaskTags(source), source);
  });

  test("sets and removes section and completion properties without changing other content", () => {
    const original = [
      "---",
      "# keep this comment",
      "type: task",
      "tags: [paper, reading]",
      "owner: Ada",
      "---",
      "# Read",
      "",
      "Keep this body exactly.",
    ].join("\n");
    const sectioned = setTaskBoardProject(original, "  Deep   Work ");
    const completed = setTaskLifecycle(sectioned, "done");

    assert.match(sectioned, /task-project: Deep Work/);
    assert.match(completed, /task-status: done/);
    assert.match(completed, /task-closed: \d{4}-\d{2}-\d{2}/);
    assert.match(completed, /# keep this comment\ntype: task\ntags: \[paper, reading\]\nowner: Ada/);
    assert.ok(completed.endsWith("# Read\n\nKeep this body exactly."));
    assert.equal(parseTaskMarkdown(completed, file)?.status, "done");

    const active = setTaskLifecycle(completed, "open");
    const inbox = setTaskBoardProject(active, "Inbox");
    assert.equal(getFrontmatterProperty(parseFrontmatter(inbox), "task-project")?.value.kind, "string");
    assert.equal(parseTaskMarkdown(inbox, file)?.project, "Inbox");
    assert.equal(parseTaskMarkdown(inbox, file)?.title, "Fallback");
    assert.equal(parseTaskMarkdown(inbox, file)?.status, "open");
  });

  test("updates metadata while leaving the Markdown body byte-identical", () => {
    const original = [
      "---",
      "# keep this comment",
      "type: task",
      "owner: Ada",
      "---",
      "# Read",
      "",
      "Keep this body.",
    ].join("\r\n");
    const updated = updateTaskMetadata(original, {
      dueDate: "2026-08-10",
      project: "Research",
      tags: ["paper", "reading"],
    });
    const parsed = parseTaskMarkdown(updated, file);

    assert.match(updated, /# keep this comment\r\ntype: task\r\nowner: Ada/);
    assert.ok(updated.endsWith("# Read\r\n\r\nKeep this body."));
    assert.equal(parsed?.title, "Fallback");
    assert.equal(parsed?.preview, "# Read\r\n\r\nKeep this body.");
    assert.equal(parsed?.dueDate, "2026-08-10");
    assert.equal(parsed?.project, "Research");
    assert.deepEqual(parsed?.tags, ["paper", "reading"]);
  });

  test("removing absent optional properties is a no-op", () => {
    const source = sourceWith("type: task");
    assert.equal(setTaskBoardProject(source), source);
    assert.match(setTaskLifecycle(source, "open"), /task-status: open/);
  });

  test("edits reject invalid frontmatter instead of replacing it", () => {
    const invalid = "---\ntype: task\nbroken: [\n---\n# Task";
    assert.throws(() => setTaskBoardProject(invalid, "Research"), /Unexpected|flow|collection|end/i);
    assert.throws(() => setTaskLifecycle(invalid, "open"), /Unexpected|flow|collection|end/i);
  });

  test("unchanged task edits preserve every authored byte", () => {
    const source = [
      "---",
      "# metadata comment",
      "type: task",
      "task-project: Research",
      "task-due: 2026-08-10",
      "tags: [paper, reading]",
      "owner: Ada",
      "---",
      "# Read",
      "",
      "Keep this body.",
    ].join("\n");

    assert.equal(
      updateTaskMetadata(source, {
        project: "Research",
        dueDate: "2026-08-10",
        tags: ["paper", "reading"],
      }),
      source,
    );
    assert.equal(setTaskBoardProject(source, "Research"), source);
    assert.equal(setTaskDueDate(source, "2026-08-10"), source);
    assert.equal(setTaskTags(source, ["paper", "reading"]), source);
  });

  test("metadata editing never exposes a title or body replacement path", () => {
    const source = sourceWith(
      "type: task\ntask-project: Research # keep\ntask-due: 2026-08-10\ntags: [paper, reading]\nowner: Ada",
      "# Read\n\nKeep this body.",
    );
    const before = parseFrontmatter(source);
    const updated = updateTaskMetadata(source, {
      project: "Research",
      dueDate: "2026-08-10",
      tags: ["paper", "reading"],
    });
    const after = parseFrontmatter(updated);

    assert.equal(before.kind, "valid");
    assert.equal(after.kind, "valid");
    if (before.kind !== "valid" || after.kind !== "valid") return;
    assert.equal(updated.slice(0, after.envelope.range.to), source.slice(0, before.envelope.range.to));
    assert.ok(updated.endsWith("# Read\n\nKeep this body."));
  });

  test("a tags-only change leaves section and due YAML untouched", () => {
    const source = sourceWith(
      "type: task\ntask-project: Research\ntask-due: 2026-08-10\n# tag note\ntags: [paper]\nowner: Ada",
    );
    const updated = updateTaskMetadata(source, {
      project: "Research",
      dueDate: "2026-08-10",
      tags: ["paper", "reading"],
    });

    assert.match(
      updated,
      /task-project: Research\ntask-due: 2026-08-10\n# tag note\ntags: \[ paper, reading \]\nowner: Ada/,
    );
  });

  test("accepts a concurrent tag update already matching the desired ordered tags", () => {
    const source = sourceWith("type: task\ntags: [reading, paper] # keep");
    const updated = updateTaskMetadata(
      source,
      {
        tags: ["reading", "paper"],
        original: { taskName: "Fallback", tags: ["paper"] },
      },
      "Fallback",
    );
    assert.equal(updated, source);
  });

  test("treats tag order as authored metadata and rejects a competing tag edit", () => {
    const source = sourceWith("type: task\ntags: [paper, reading]");
    const updated = updateTaskMetadata(
      source,
      {
        tags: ["reading", "paper"],
        original: { taskName: "Fallback", tags: ["paper", "reading"] },
      },
      "Fallback",
    );
    assert.deepEqual(parseTaskMarkdown(updated, file)?.tags, ["reading", "paper"]);
    assert.throws(
      () =>
        updateTaskMetadata(
          updated,
          {
            tags: ["paper", "writing"],
            original: { taskName: "Fallback", tags: ["paper", "reading"] },
          },
          "Fallback",
        ),
      /tags changed since editing began/,
    );
  });

  test("unsafe lifecycle YAML is visible but blocked from mutation", () => {
    const active = sourceWith("type: task\ntask-status: [open]");
    const inbox = sourceWith("type: task\ntask-project: [Inbox]");

    assert.throws(() => setTaskLifecycle(active, "open"), /through task fields/);
    assert.throws(() => setTaskBoardProject(inbox, "Inbox"), /through task fields/);
  });

  test.each(["2026-08-10 # keep", "[2026-08-10]", "soon"])(
    "blocks lifecycle edits when the closure date cannot be safely changed (%s)",
    (closed) => {
      const source = sourceWith(`type: task\ntask-status: done\ntask-closed: ${closed}`);
      assert.throws(() => setTaskLifecycle(source, "open"), /task-closed.*through task fields/);
    },
  );

  test.each([
    ["section comment", "task-project: Research # keep", () => "Planning", setTaskBoardProject],
    ["section shape", "task-project: [Research]", () => "Planning", setTaskBoardProject],
    ["due comment", "task-due: 2026-08-10 # keep", () => "2026-08-11", setTaskDueDate],
    ["due shape", "task-due: [2026-08-10]", () => "2026-08-11", setTaskDueDate],
    ["tags comment", "tags: [paper] # keep", () => ["reading"], setTaskTags],
    ["tags shape", "tags: {name: paper}", () => ["reading"], setTaskTags],
  ] as const)("blocks an actual managed-field change for %s", (_name, property, nextValue, setter) => {
    assert.throws(
      () =>
        (setter as (source: string, value: string | boolean | readonly string[]) => string)(
          sourceWith(`type: task\n${property}`),
          nextValue(),
        ),
      /through task fields/,
    );
  });

  test.each([
    ["status comment", "task-status: open # keep", "done"],
    ["status shape", "task-status: [open]", "done"],
  ] as const)("blocks an actual managed-field change for %s", (_name, property, status) => {
    assert.throws(() => setTaskLifecycle(sourceWith(`type: task\n${property}`), status), /through task fields/);
  });

  test("supports reversible closure", () => {
    const active = sourceWith("type: task\ntask-status: open");
    const cancelled = setTaskLifecycle(active, "cancelled", "2026-08-04");
    assert.match(cancelled, /task-status: cancelled/);
    assert.match(cancelled, /task-closed: 2026-08-04/);

    const reopened = setTaskLifecycle(cancelled, "open", "2026-08-06");
    assert.doesNotMatch(reopened, /task-closed/);
    assert.match(reopened, /task-status: open/);
  });

  test("repairs Task Board-owned fields while preserving custom metadata and the body", () => {
    const source = sourceWith(
      'type: task\ntask-status: [open]\ntask-due: "2026-08-10"\ntags: paper\nowner: Ada',
      "# Repair me\n\nKeep every word.",
    );
    const damaged = parseTaskMarkdown(source, file);
    assert.ok(damaged);
    assert.ok(damaged.metadataIssues.length > 0);

    const repaired = repairTaskMetadata(source, damaged);
    const parsed = parseTaskMarkdown(repaired, file);
    assert.ok(parsed);
    assert.deepEqual(parsed.metadataIssues, []);
    assert.match(repaired, /owner: Ada/);
    assert.match(repaired, /task-status: open/);
    assert.doesNotMatch(repaired, /task-created:/);
    assert.match(repaired, /task-due: "2026-08-10"/);
    assert.match(repaired, /tags: paper/);
    assert.ok(repaired.endsWith("# Repair me\n\nKeep every word."));
  });

  test("explains when invalid YAML must be repaired manually", () => {
    const source = "---\ntype: task\nbroken: [\n---\n# Repair me";
    const damaged = parseTaskMarkdown(source, file);
    assert.ok(damaged);

    assert.throws(
      () => repairTaskMetadata(source, damaged),
      /YAML syntax must be fixed.*before metadata can be repaired automatically/,
    );
  });
});

test("edits and clears quoted dates and scalar tags while preserving unrelated source", () => {
  const source = '---\ntype: task\ntask-due: "2026-09-10"\ntags: research\nowner: Ada # keep\n---\nBody';
  const changed = setTaskTags(setTaskDueDate(source, "2026-09-20"), ["research", "reading"]);
  assert.equal(parseTaskMarkdown(changed, file)?.dueDate, "2026-09-20");
  assert.deepEqual(parseTaskMarkdown(changed, file)?.tags, ["research", "reading"]);
  assert.ok(changed.includes("owner: Ada # keep"));
  assert.ok(changed.endsWith("Body"));
  assert.equal(parseTaskMarkdown(setTaskTags(setTaskDueDate(source), []), file)?.dueDate, undefined);
  assert.equal(parseTaskMarkdown(setTaskTags(source, []), file)?.tags, undefined);
  const closed = '---\ntype: task\ntask-status: done\ntask-closed: "2026-09-10"\n---\nBody';
  assert.equal(parseTaskMarkdown(setTaskLifecycle(closed, "open"), file)?.closedDate, undefined);
});
