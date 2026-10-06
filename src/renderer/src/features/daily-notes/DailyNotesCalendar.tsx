import { useAtomValue } from "jotai";
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DayButton, type DayButtonProps } from "react-day-picker";
import { parseDueDate, toDateInputValue } from "@renderer/shared/date";
import { useTaskBoardWorkspace } from "@renderer/features/task-board/taskBoardWorkspace";
import { type TaskBoardTask } from "@renderer/features/task-board/taskBoardModel";

import { APP_CONFIG_CHANGED_EVENT, getDailyNoteCreationDirectory } from "@renderer/config";
import { useFileOpen } from "@renderer/features/files/fileActions";
import { Calendar } from "@renderer/shared/ui/calendar";
import { workspaceFilesAtom } from "@renderer/store/fileExplorerStore";
import { currentWorkspaceItemAtom } from "@renderer/store/workspaceResourceStore";
import { isFileWorkspaceItem } from "@shared/workspace";

import { dailyNoteDateFromPath, dailyNoteFilename } from "./dailyNotes";
import { useDailyNoteOpen } from "./useDailyNoteOpen";
import "./DailyNotesCalendar.css";

const CalendarTasksContext = createContext<ReadonlyMap<string, TaskBoardTask[]>>(new Map());

function TaskDayButton(props: DayButtonProps) {
  const tasks = useContext(CalendarTasksContext).get(toDateInputValue(props.day.date)) ?? [];
  const summary = tasks.length ? `${tasks.length} open ${tasks.length === 1 ? "task" : "tasks"} due` : "";
  const note = props.modifiers.hasDailyNote ? "Daily note exists" : "";
  return (
    <DayButton
      {...props}
      aria-label={[props["aria-label"], note, summary].filter(Boolean).join(", ")}
      title={[note, summary, ...tasks.map((task) => task.title)].filter(Boolean).join("\n")}
    >
      {props.children}
      <span className="daily-note-day-indicators" aria-hidden="true">
        {props.modifiers.hasDailyNote && <span className="daily-note-dot" />}
        {tasks.length > 0 && <span className="daily-note-task-count">{tasks.length > 9 ? "9+" : tasks.length}</span>}
      </span>
    </DayButton>
  );
}

export const DailyNotesCalendar = ({ initialMonth }: { initialMonth?: Date }) => {
  const { discoveredTasks, error: taskError, isLoading: tasksLoading } = useTaskBoardWorkspace();
  const [inspectedDate, setInspectedDate] = useState<Date | null>(null);
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, TaskBoardTask[]>();
    for (const task of discoveredTasks) {
      if (task.status !== "open" || !parseDueDate(task.dueDate)) continue;
      const key = task.dueDate!;
      grouped.set(key, [...(grouped.get(key) ?? []), task]);
    }
    for (const tasks of grouped.values()) tasks.sort((a, b) => a.title.localeCompare(b.title));
    return grouped;
  }, [discoveredTasks]);
  const files = useAtomValue(workspaceFilesAtom);
  const currentItem = useAtomValue(currentWorkspaceItemAtom);
  const openDailyNote = useDailyNoteOpen();
  const { open } = useFileOpen();
  const [directory, setDirectory] = useState<string | null>(null);
  const [month, setMonth] = useState(() => initialMonth ?? new Date());
  const [openingDateKey, setOpeningDateKey] = useState<string | null>(null);
  const pendingDateKeyRef = useRef<string | null>(null);

  const refreshDirectory = useCallback(() => {
    void getDailyNoteCreationDirectory().then(setDirectory);
  }, []);

  useEffect(() => {
    refreshDirectory();
    const handleConfigChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
      if (detail?.key !== "dailyNoteCreationDirectory") return;
      if (typeof detail.value === "string") setDirectory(detail.value);
      else refreshDirectory();
    };
    window.addEventListener(APP_CONFIG_CHANGED_EVENT, handleConfigChange);
    return () => window.removeEventListener(APP_CONFIG_CHANGED_EVENT, handleConfigChange);
  }, [refreshDirectory]);

  const markedDates = useMemo(
    () =>
      directory === null
        ? []
        : files.flatMap((file) => {
            const date = dailyNoteDateFromPath(file.relativePath, directory);
            return date ? [date] : [];
          }),
    [directory, files],
  );
  const selectedDate = useMemo(() => {
    if (directory === null || !currentItem || !isFileWorkspaceItem(currentItem)) return undefined;
    return dailyNoteDateFromPath(currentItem.file.relativePath, directory) ?? undefined;
  }, [currentItem, directory]);

  const openDate = async (date: Date) => {
    if (directory === null) return;
    const dateKey = dailyNoteFilename(date);
    if (pendingDateKeyRef.current !== null) return;
    pendingDateKeyRef.current = dateKey;
    setOpeningDateKey(dateKey);
    try {
      await openDailyNote(date, directory);
    } finally {
      pendingDateKeyRef.current = null;
      setOpeningDateKey(null);
    }
  };

  const taskDate = inspectedDate ?? selectedDate ?? new Date();
  const dayTasks = tasksByDate.get(toDateInputValue(taskDate)) ?? [];
  const monthKey = toDateInputValue(month).slice(0, 7);
  const monthTaskCount = [...tasksByDate].reduce(
    (count, [date, tasks]) => count + (date.startsWith(`${monthKey}-`) ? tasks.length : 0),
    0,
  );

  return (
    <section className="daily-notes-widget" aria-label="Calendar">
      <div className="daily-notes-calendar-shell" aria-busy={openingDateKey !== null}>
        <CalendarTasksContext.Provider value={tasksByDate}>
          <Calendar
            components={{ DayButton: TaskDayButton }}
            className="daily-notes-calendar"
            mode="single"
            month={month}
            onMonthChange={setMonth}
            selected={inspectedDate ?? selectedDate}
            disabled={directory === null}
            onDayClick={(date) => {
              setInspectedDate(date);
              void openDate(date);
            }}
            modifiers={{
              hasDailyNote: markedDates,
              opening: openingDateKey ? [new Date(`${openingDateKey.slice(0, 10)}T00:00:00`)] : [],
            }}
            modifiersClassNames={{ hasDailyNote: "daily-note-exists", opening: "daily-note-opening" }}
          />
        </CalendarTasksContext.Provider>
      </div>
      <div className="daily-note-calendar-legend">
        <span>
          <span className="daily-note-dot" /> Daily note
        </span>
        <span>
          {taskError ? (
            "Tasks unavailable"
          ) : tasksLoading && !discoveredTasks.length ? (
            "Loading tasks…"
          ) : (
            <>
              <span className="daily-note-task-count">{monthTaskCount}</span>
              {monthTaskCount === 1 ? "task" : "tasks"} due this month
            </>
          )}
        </span>
      </div>
      <section className="daily-note-day-tasks" aria-label="Tasks due on selected day">
        <h3>
          {taskDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · Tasks due{" "}
          <span>{dayTasks.length}</span>
        </h3>
        {taskError ? (
          <p role="status">Tasks could not be loaded.</p>
        ) : tasksLoading && !discoveredTasks.length ? (
          <p role="status">Loading tasks…</p>
        ) : dayTasks.length ? (
          <ul>
            {dayTasks.map((task) => (
              <li key={task.path}>
                <button
                  type="button"
                  onClick={() => void open(task, { focusEditor: true, openInNewTab: true })}
                  title={task.title}
                >
                  <span aria-hidden="true">○</span>
                  {task.title}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No open tasks due.</p>
        )}
      </section>
    </section>
  );
};
