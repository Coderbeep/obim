import { expect, it } from "vitest";
import { parseTaskMarkdown } from "../src/renderer/src/features/task-board/taskBoardFiles";
import { changeTaskWorkflow } from "../src/renderer/src/features/task-board/taskBoardFiles";

const file = {
  id: "authored",
  path: "/notes/Authored.md",
  relativePath: "Authored.md",
  filename: "Authored",
  isDirectory: false as const,
  mimeType: "text/markdown",
};

it.each([
  "task-project: research # Keep this author's casing\ntask-stage: backlog # Authored stage",
  "task-project: Research\ntask-stage: [backlog] # Repair separately",
])("preserves authored fields when a move only changes order: %s", (fields) => {
  const source = `---\ntype: task\n${fields}\n---\n# Authored\n`;
  const task = parseTaskMarkdown(source, file)!;
  expect(changeTaskWorkflow(source, task, { kind: "move", project: "Research", stage: "backlog" })).toMatchObject({
    source,
    changed: false,
    removePin: false,
  });
});
