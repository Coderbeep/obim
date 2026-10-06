import "./TaskBoardInspector.css";
import { IconArrowUpRight, IconCalendar, IconClockArrow, IconFlagFill, IconPin } from "@pierre/icons";
import { useAtomValue, useSetAtom } from "jotai";
import { useState, type CSSProperties, type ReactNode } from "react";
import { RightSidebarWidget, RightSidebarWidgetStack } from "@renderer/features/editor/inspector/WidgetStack";
import { formatDueDate, parseDueDate, toDateInputValue } from "@renderer/shared/date";
import {
  TASK_BOARD_WORKFLOW_COLUMNS,
  taskBoardProjectNameKey,
  type TaskBoardTaskSummary,
} from "@renderer/shared/taskBoard";
import { Button } from "@renderer/shared/ui/button";
import { useLocalDay } from "@renderer/shared/useLocalDay";
import {
  taskBoardAgendaActionsAtom,
  taskBoardInspectorSnapshotAtom,
  taskBoardRevealRequestAtom,
} from "@renderer/store/taskBoardInspectorStore";
import { getTaskBoardProjectColorTheme, TASK_PRIORITY_PRESENTATION } from "./taskBoardModel";

export const TaskBoardInspector = ({ children }: { children?: ReactNode }) => {
  const snapshot = useAtomValue(taskBoardInspectorSnapshotAtom);
  const actions = useAtomValue(taskBoardAgendaActionsAtom);
  const today = useLocalDay();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const retry = async () => {
    if (!actions || retrying) return;
    setRetrying(true);
    setRetryError(false);
    try {
      await actions.refresh();
    } catch {
      setRetryError(true);
    } finally {
      setRetrying(false);
    }
  };
  const loading = (
    <p role="status" className="task-agenda-empty">
      {snapshot?.isLoading ? "Loading task insights…" : "No task data"}
    </p>
  );
  return (
    <div className="task-board-inspector">
      <RightSidebarWidgetStack autoSaveId="task-board-right-sidebar-widget-stack">
        <RightSidebarWidget
          id="task-upcoming"
          title="Agenda"
          icon={IconClockArrow}
          contentClassName="task-agenda-content"
        >
          <h2 className="task-agenda-heading text-ui-control font-semibold">Agenda</h2>
          {(snapshot?.error || retryError) && (
            <div role="alert" className="task-agenda-error">
              {snapshot?.hasLoaded
                ? "Could not refresh. Showing the last available tasks."
                : "Task insights unavailable."}
              {actions && (
                <button
                  type="button"
                  className="task-agenda-link"
                  disabled={retrying || snapshot?.isLoading}
                  onClick={() => void retry()}
                >
                  {retrying ? "Retrying…" : "Retry"}
                </button>
              )}
            </div>
          )}
          {snapshot?.hasLoaded ? <TaskBoardAgenda tasks={snapshot.tasks} today={today} /> : loading}
        </RightSidebarWidget>
        <RightSidebarWidget id="task-pinned" title="Pinned tasks" icon={IconPin} contentClassName="task-agenda-content">
          <h2 className="task-agenda-heading text-ui-control font-semibold">Pinned tasks</h2>
          {snapshot?.hasLoaded ? (
            <TaskBoardWidgetTaskList tasks={snapshot.tasks.filter((task) => task.pinned && task.status === "open")} />
          ) : (
            loading
          )}
        </RightSidebarWidget>
        {children}
      </RightSidebarWidgetStack>
    </div>
  );
};

export type AgendaProps = {
  tasks: readonly TaskBoardTaskSummary[];
  today: Date;
};

function TaskRow({ task }: { task: TaskBoardTaskSummary }) {
  const actions = useAtomValue(taskBoardAgendaActionsAtom);
  const revealTask = useSetAtom(taskBoardRevealRequestAtom);
  const project = actions?.projects.find(
    (project) => taskBoardProjectNameKey(project.name) === taskBoardProjectNameKey(task.project ?? ""),
  );
  const projectColor = getTaskBoardProjectColorTheme(project?.colorId).accent;
  const stage = TASK_BOARD_WORKFLOW_COLUMNS.find(
    ({ id }) => id === (task.status === "done" ? "done" : (task.stage ?? "backlog")),
  );
  return (
    <li className="task-agenda-row group/task-card task-board-task-hover">
      <div className="task-agenda-row-main">
        <button
          type="button"
          className="task-agenda-open"
          aria-label={"Show task on board: " + task.title}
          onClick={() => revealTask({ task, id: crypto.randomUUID() })}
          title={task.title}
        >
          <span className="task-agenda-task-title task-board-task-title line-clamp-2 text-ui-item leading-5 font-semibold text-foreground">
            {task.title}
          </span>
          <span className="task-agenda-meta text-ui-control text-muted-foreground">
            <span
              className="task-agenda-project"
              style={{ "--task-agenda-project-color": projectColor } as CSSProperties}
            >
              {task.project || "No project"}
            </span>
            {stage ? (
              <span className="task-agenda-stage" style={{ "--task-agenda-stage-color": stage.color } as CSSProperties}>
                <span className="task-agenda-stage-dot" aria-hidden="true" />
                {stage.label}
              </span>
            ) : null}
            {task.priority ? (
              <span className={"task-agenda-chip " + TASK_PRIORITY_PRESENTATION[task.priority].className}>
                <IconFlagFill size={14} aria-hidden="true" />
                {TASK_PRIORITY_PRESENTATION[task.priority].label}
              </span>
            ) : null}
            {task.dueDate ? (
              <span className="task-agenda-chip">
                <IconCalendar size={14} aria-hidden="true" />
                {formatDueDate(task.dueDate)}
              </span>
            ) : null}
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!actions}
          className="task-agenda-note opacity-0 group-hover/task-card:opacity-100 group-focus-within/task-card:opacity-100 transition-opacity"
          aria-label={"Open task note: " + task.title}
          title="Open task note"
          onClick={() => void actions?.openTask(task)}
        >
          <IconArrowUpRight size={14} aria-hidden="true" />
        </Button>
      </div>
      {task.metadataIssues.length > 0 && (
        <p className="task-agenda-error">{task.metadataIssues.join(" ")} Open the task to repair.</p>
      )}
    </li>
  );
}
export function TaskBoardWidgetTaskList({ tasks, limit = 5 }: Pick<AgendaProps, "tasks"> & { limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <ul className="task-agenda-list">
        {(expanded ? tasks : tasks.slice(0, limit)).map((task) => (
          <TaskRow key={task.path} task={task} />
        ))}
      </ul>
      {tasks.length > limit && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="task-agenda-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show fewer" : "Show all " + tasks.length}
        </Button>
      )}
    </>
  );
}
export function TaskBoardAgenda({ tasks, today }: AgendaProps) {
  const groups = taskAgendaGroups(tasks, today);
  return (
    <>
      {groups.map((group) => (
        <section key={group.id} className="task-agenda-group" aria-label={group.title}>
          <h3 className="text-ui-control font-semibold">
            {group.title}
            <span>{group.tasks.length}</span>
          </h3>
          {group.tasks.length ? <TaskBoardWidgetTaskList tasks={group.tasks} limit={3} /> : null}
        </section>
      ))}
    </>
  );
}

export const taskAgendaGroups = (tasks: readonly TaskBoardTaskSummary[], today: Date) => {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const todayKey = toDateInputValue(start);
  const scheduled = tasks
    .filter((task) => task.status === "open" && parseDueDate(task.dueDate))
    .sort(
      (a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.title.localeCompare(b.title) || a.path.localeCompare(b.path),
    );
  return [
    { id: "overdue", title: "Overdue", tasks: scheduled.filter((task) => parseDueDate(task.dueDate)! < start) },
    { id: "today", title: "Today", tasks: scheduled.filter((task) => task.dueDate === todayKey) },
    {
      id: "week",
      title: "Next 7 days",
      tasks: scheduled.filter((task) => {
        const date = parseDueDate(task.dueDate)!;
        return date > start && date <= end;
      }),
    },
    { id: "later", title: "Later", tasks: scheduled.filter((task) => parseDueDate(task.dueDate)! > end) },
  ];
};
