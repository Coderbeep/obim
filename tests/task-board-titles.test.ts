import { describe, expect, it } from "vitest";
import {
  createTaskMarkdown,
  parseTaskMarkdown,
  taskFilenameForTitle,
  setTaskTitle,
  updateTaskMetadata,
} from "../src/renderer/src/features/task-board/taskBoardFiles";
import { isValidFilename } from "../src/shared/pathUtils";
const file = {
  id: "one",
  path: "/one.md",
  relativePath: "one.md",
  filename: "one",
  isDirectory: false as const,
  mimeType: "text/markdown",
};
const original = "---\ntype: task\n---\n# Context\n\n- [ ] Existing checkbox\n";
describe("natural task titles", () => {
  it.each(["Review paper: what changed?", "Folder/Task", "CON", "Already.md", "🦉".repeat(300)])(
    "creates a safe path while preserving %s",
    (taskName) => {
      const filename = taskFilenameForTitle(taskName);
      expect(isValidFilename(filename)).toBe(true);
      expect(new TextEncoder().encode(filename).length).toBeLessThan(255);
      expect(filename).not.toMatch(/[/:?]/);
      expect(parseTaskMarkdown(createTaskMarkdown({ taskName }), file)?.title).toBe(taskName);
    },
  );
  it("uses filename fallback and detects concurrent title edits", () => {
    expect(parseTaskMarkdown(original, file)?.title).toBe("one");
    const first = updateTaskMetadata(original, { taskName: "New: title?", original: { taskName: "one" } }, "one");
    expect(parseTaskMarkdown(first, file)?.title).toBe("New: title?");
    expect(() => updateTaskMetadata(first, { taskName: "Other", original: { taskName: "one" } }, "one")).toThrow(
      /title changed/,
    );
  });
  it.each(["", "   ", "One\nTwo", "One\tTwo"])("rejects an invalid task title %j", (title) => {
    expect(() => setTaskTitle(original, title)).toThrow(/task name/);
  });
});
