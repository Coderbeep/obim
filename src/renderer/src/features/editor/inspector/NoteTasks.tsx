import { useEffect, useState } from "react";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "../codemirror-view";
import { Badge } from "@renderer/shared/ui/badge";
import { cn } from "@renderer/shared/classNames";
import type { MarkdownTask } from "./documentInfo";
import { focusActiveEditorLine } from "./DocumentOutline";
import "../styles/Lists.css";
import "./NoteTasks.css";

export function toggleInspectorTask(task: MarkdownTask): boolean {
  const element = document.querySelector<HTMLElement>(".pane-card-active .cm-editor");
  const view = element ? EditorView.findFromDOM(element) : null;
  if (!view || view.state.readOnly || task.line > view.state.doc.lines) return false;
  const line = view.state.doc.line(task.line);
  let marker: { from: number; to: number } | null = null;
  syntaxTree(view.state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (
        node.name === "TaskMarker" &&
        (!task.marker || (task.marker.from === node.from && task.marker.to === node.to)) &&
        view.state.doc.sliceString(node.to, line.to).trim() === task.text
      ) {
        marker = { from: node.from, to: node.to };
      }
    },
  });
  if (!marker) return false;
  const range = marker as { from: number; to: number };
  const checked = /x/i.test(view.state.doc.sliceString(range.from, range.to));
  view.dispatch({ changes: { ...range, insert: checked ? "[ ]" : "[x]" }, userEvent: "input.task" });
  return true;
}

type TaskNode = {
  task: MarkdownTask;
  children: TaskNode[];
  progress: { completed: number; total: number };
};
export function buildTaskTree(tasks: readonly MarkdownTask[]) {
  const roots: TaskNode[] = [];
  const nodesByLine = new Map<number, TaskNode>();
  for (const task of tasks) {
    const node: TaskNode = { task, children: [], progress: { completed: 0, total: 0 } };
    const parent = task.parentLine === undefined ? undefined : nodesByLine.get(task.parentLine);
    (parent?.children ?? roots).push(node);
    nodesByLine.set(task.line, node);
  }
  const summarize = (node: TaskNode) => {
    for (const child of node.children) {
      summarize(child);
      node.progress.total += 1 + child.progress.total;
      node.progress.completed += Number(child.task.checked) + child.progress.completed;
    }
  };
  roots.forEach(summarize);
  return roots;
}

const TaskRow = ({ task, progress }: Pick<TaskNode, "task" | "progress">) => {
  const [transition, setTransition] = useState<"checking" | "unchecking" | undefined>();
  useEffect(() => {
    if (!transition) return;
    const timeout = window.setTimeout(() => setTransition(undefined), 500);
    return () => window.clearTimeout(timeout);
  }, [transition]);
  const checked = transition ? transition === "checking" : task.checked;
  return (
    <div
      data-branch={progress.total > 0 || undefined}
      className="note-task-row relative flex min-w-0 cursor-pointer items-start gap-1.5 rounded-md px-1.5 py-1 text-ui-body hover:bg-[var(--surface-hover)]"
      onClick={() => focusActiveEditorLine(task.line)}
    >
      <label
        className="cm-task-list-checkbox-shell flex-none"
        data-transition={transition}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          type="checkbox"
          className="cm-task-list-checkbox"
          checked={checked}
          aria-label={task.text || "Untitled task"}
          onChange={() => {
            if (toggleInspectorTask(task)) setTransition(checked ? "unchecking" : "checking");
          }}
        />
        <span className="cm-task-list-checkbox-visual" aria-hidden="true">
          <span className="cm-task-list-checkbox-halo" />
          <span className="cm-task-list-checkbox-face" />
          <svg className="cm-task-list-checkbox-check" viewBox="0 0 16 16">
            <path d="m4.1 8.1 2.35 2.35 5.45-5.6" pathLength="1" />
          </svg>
        </span>
      </label>
      <button
        type="button"
        aria-label={`Go to ${task.text || "Untitled task"}, line ${task.line}${
          progress.total > 0 ? `, ${progress.completed} of ${progress.total} subtasks completed` : ""
        }`}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-1.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
      >
        <span className="min-w-0 flex-1 break-words">
          <span
            className={cn(
              checked && "cm-task-list-content-checked",
              transition === "checking" && "cm-task-list-content-checking",
            )}
          >
            {task.text || "Untitled task"}
          </span>
        </span>
        {progress.total > 0 && (
          <Badge
            variant="compact"
            className="note-task-progress"
            aria-label={`${progress.completed} of ${progress.total} subtasks completed`}
            title={`${progress.completed} of ${progress.total} subtasks completed`}
          >
            {progress.completed}/{progress.total}
          </Badge>
        )}
      </button>
    </div>
  );
};

const TaskTree = ({ nodes, nested = false }: { nodes: TaskNode[]; nested?: boolean }) => {
  const occurrences = new Map<string, number>();
  return (
    <ol className={cn("note-task-tree", nested && "note-task-tree-children")}>
      {nodes.map(({ task, children, progress }) => {
        const occurrence = occurrences.get(task.text) ?? 0;
        occurrences.set(task.text, occurrence + 1);
        return (
          <li key={`${task.text}\0${occurrence}`} className="note-task-node">
            <TaskRow task={task} progress={progress} />
            {children.length ? <TaskTree nodes={children} nested /> : null}
          </li>
        );
      })}
    </ol>
  );
};

export const NoteTasks = ({ tasks }: { tasks: readonly MarkdownTask[] }) =>
  tasks.length ? (
    <TaskTree nodes={buildTaskTree(tasks)} />
  ) : (
    <div className="px-1.5 text-ui-body text-muted-foreground">No checklist items in this note</div>
  );
