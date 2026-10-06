import { parser, TaskList } from "@lezer/markdown";
import { locateFrontmatter } from "@shared/frontmatter";

const taskParser = parser.configure([TaskList]);

export interface TaskNoteSubtask {
  text: string;
  checked: boolean;
  depth: number;
  from: number;
  to: number;
}

/** Read actual Markdown task markers, excluding frontmatter and code examples. */
export function readTaskNoteSubtasks(source: string): TaskNoteSubtask[] {
  const envelope = locateFrontmatter(source);
  const offset = envelope?.range.to ?? 0;
  const body = source.slice(offset);
  const tasks: TaskNoteSubtask[] = [];
  // Lezer splits lines on LF; normalize lone CR without changing source offsets.
  taskParser.parse(body.replace(/\r(?!\n)/g, "\n")).iterate({
    enter(node) {
      if (node.name !== "TaskMarker") return;
      const from = offset + node.from;
      const to = offset + node.to;
      const end = source.slice(to).search(/[\r\n]/);
      let depth = -1;
      for (let parent = node.node.parent; parent; parent = parent.parent) {
        if (parent.name === "ListItem") depth++;
      }
      tasks.push({
        from,
        to,
        text: source.slice(to, end < 0 ? source.length : to + end).trim(),
        checked: /x/i.test(source.slice(from, to)),
        depth: Math.max(0, depth),
      });
    },
  });
  return tasks;
}

export interface TaskNoteSubtaskTarget {
  index: number;
  expected: readonly Pick<TaskNoteSubtask, "text" | "depth">[];
}

/** Resolve against the live note so edits above a checkbox cannot shift the highlight. */
export function resolveTaskNoteSubtask(source: string, target: TaskNoteSubtaskTarget): number | null {
  const tasks = readTaskNoteSubtasks(source);
  const expected = target.expected[target.index];
  if (!expected) return null;
  const matches = (task: Pick<TaskNoteSubtask, "text" | "depth">) =>
    task.text === expected.text && task.depth === expected.depth;
  if (
    tasks.length === target.expected.length &&
    tasks.every(
      (task, index) => task.text === target.expected[index].text && task.depth === target.expected[index].depth,
    )
  )
    return tasks[target.index].from;
  const candidates = tasks.filter(matches);
  return candidates.length === 1 ? candidates[0].from : null;
}
