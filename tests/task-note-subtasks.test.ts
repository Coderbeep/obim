import { describe, expect, it } from "vitest";
import { resolveTaskNoteSubtask, readTaskNoteSubtasks } from "../src/renderer/src/shared/taskNoteSubtasks";
import { changeTaskNoteSubtasks } from "../src/renderer/src/features/task-board/taskBoardFiles";
import { createTaskMarkdown } from "../src/renderer/src/features/task-board/taskBoardFiles";

describe("subtasks stored in task note Markdown", () => {
  it("finds checkboxes across headings and nested lists, excluding frontmatter and code", () => {
    const source =
      "---\ntype: task\nexample: |\n  - [ ] metadata example\n---\n# Note\n- [ ] First\n  - [x] Nested\n## Later\n* [X] Last\n\n```md\n- [ ] Example\n```\n\n    - [ ] Indented example\n";
    expect(readTaskNoteSubtasks(source).map(({ text, checked, depth }) => ({ text, checked, depth }))).toEqual([
      { text: "First", checked: false, depth: 0 },
      { text: "Nested", checked: true, depth: 1 },
      { text: "Last", checked: true, depth: 0 },
    ]);
  });
  it("appends without headings or IDs and preserves existing content and CRLF", () => {
    const source = "---\r\ntype: task\r\n---\r\nMy notes.";
    expect(changeTaskNoteSubtasks(source, { kind: "append", text: "Review paper: what changed?" })).toBe(
      source + "\r\n\r\n- [ ] Review paper: what changed?\r\n",
    );
    expect(changeTaskNoteSubtasks("- [ ] First\n", { kind: "append", text: "Second" })).toBe(
      "- [ ] First\n- [ ] Second\n",
    );
    expect(createTaskMarkdown({ taskName: "Task" })).not.toContain("task-id");
  });
  it("edits only the selected marker after unrelated writing shifts its position", () => {
    const source = "Some notes.\n\n- [ ] Same\n- [ ] Same\n";
    const expected = readTaskNoteSubtasks(source);
    expect(
      changeTaskNoteSubtasks("New paragraph.\n" + source, { kind: "check", index: 1, checked: true, expected }),
    ).toBe("New paragraph.\nSome notes.\n\n- [ ] Same\n- [x] Same\n");
  });
  it.each([
    ["", "- [ ] Added\n"],
    ["Paragraph", "Paragraph\n\n- [ ] Added\n"],
    ["Paragraph\n", "Paragraph\n\n- [ ] Added\n"],
    ["Paragraph\n\n", "Paragraph\n\n- [ ] Added\n"],
    ["- [ ] First", "- [ ] First\n- [ ] Added\n"],
  ])("appends with readable spacing after %j", (source, expected) => {
    expect(changeTaskNoteSubtasks(source, { kind: "append", text: "Added" })).toBe(expected);
  });
  it("rejects a stale checkbox state even when its text and position match", () => {
    const source = "- [ ] First\n";
    expect(() =>
      changeTaskNoteSubtasks("- [x] First\n", {
        kind: "check",
        index: 0,
        checked: false,
        expected: readTaskNoteSubtasks(source),
      }),
    ).toThrow("checkboxes changed");
  });
  it.each(["Intro 🦉\r\r- [ ] First\r- [ ] Second\r", "Intro 🦉\r\n\r\n- [ ] First\r- [ ] Second\n"])(
    "changes only the requested marker with authored line endings (%j)",
    (source) => {
      const expected = readTaskNoteSubtasks(source);
      expect(expected.map(({ text }) => text)).toEqual(["First", "Second"]);
      expect(changeTaskNoteSubtasks(source, { kind: "check", index: 1, checked: true, expected })).toBe(
        source.replace("- [ ] Second", "- [x] Second"),
      );
    },
  );
  it("rejects conflicting checkbox changes instead of modifying another item", () => {
    const source = "- [ ] First\n- [ ] Second\n";
    expect(() =>
      changeTaskNoteSubtasks(source.replace("First", "Changed"), {
        kind: "check",
        index: 0,
        checked: true,
        expected: readTaskNoteSubtasks(source),
      }),
    ).toThrow("checkboxes changed");
  });
  it("does not append a hidden checkbox into unfinished code or frontmatter", () => {
    for (const source of ["```md\nExample", "---\ntype: task\n", "<!-- unfinished comment"]) {
      expect(() => changeTaskNoteSubtasks(source, { kind: "append", text: "New" })).toThrow();
    }
  });
});

it("resolves the specific duplicate checkbox after unrelated note edits", () => {
  const source = "- [ ] Same\n- [ ] Same\n";
  const target = { index: 1, expected: readTaskNoteSubtasks(source) };
  const updated = "# Extra text\n\n" + source;
  expect(resolveTaskNoteSubtask(updated, target)).toBe(readTaskNoteSubtasks(updated)[1].from);
  expect(resolveTaskNoteSubtask(updated + "- [ ] Same\n", target)).toBeNull();
});
it("finds a unique moved checkbox and rejects a removed checkbox", () => {
  const target = { index: 0, expected: readTaskNoteSubtasks("- [ ] Target\n") };
  const updated = "- [ ] Other\n- [x] Target\n";
  expect(resolveTaskNoteSubtask(updated, target)).toBe(readTaskNoteSubtasks(updated)[1].from);
  expect(resolveTaskNoteSubtask("- [ ] Other\n", target)).toBeNull();
});
