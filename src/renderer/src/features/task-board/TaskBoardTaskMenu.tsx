import "./TaskBoardTask.css";
import {
  IconBan,
  IconCalendar,
  IconCheckbox,
  IconFileText,
  IconFlagFill,
  IconListUnordered,
  IconPencil,
  IconPin,
  IconRefresh,
  IconTrash,
} from "@pierre/icons";
import { useState } from "react";
import { ACTION_LABELS } from "@renderer/shared/actionLabels";
import { cn } from "@renderer/shared/classNames";
import type { ContextMenuEntry } from "@renderer/shared/contextMenu";
import { formatDueDate, parseDueDate, toDateInputValue } from "@renderer/shared/date";
import { IconSubtasks } from "@renderer/shared/icons/IconSubtasks";
import {
  TASK_BOARD_WORKFLOW_COLUMNS,
  TASK_PRIORITIES,
  taskBoardProjectNameKey,
  type TaskBoardProject,
} from "@renderer/shared/taskBoard";
import { Button } from "@renderer/shared/ui/button";
import { Calendar } from "@renderer/shared/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/shared/ui/popover";
import { TASK_NOTE_FIELD_KEYS } from "@shared/note-type-templates";
import {
  getTaskBoardProjectColorTheme,
  TASK_PRIORITY_PRESENTATION,
  type TaskActions,
  type TaskBoardTask,
  type TaskMoveIntent,
  type UpdateTaskMetadataInput,
} from "./taskBoardModel";

/** Domain actions; the card supplies wrappers for its local pending and focus state. */
export const taskActionsMenu = ({
  item,
  projects,
  taskActions,
  isMoving,
  isCompleting,
  isDeleting,
  isRepairing,
  complete,
  deleteTask,
  repairMetadata,
  beginEdit,
  togglePin,
  move,
  onAddSubtask,
}: {
  item: TaskBoardTask;
  projects: readonly TaskBoardProject[];
  taskActions: TaskActions;
  isMoving: boolean;
  isCompleting: boolean;
  isDeleting: boolean;
  isRepairing: boolean;
  complete: () => Promise<void>;
  deleteTask: () => Promise<void>;
  repairMetadata: () => Promise<void>;
  beginEdit: () => void;
  togglePin: () => void;
  move: (intent: TaskMoveIntent) => Promise<void>;
  onAddSubtask?: () => void;
}): ContextMenuEntry[] => {
  const isActive = item.status === "open";
  const isMovable = item.status !== "cancelled";
  const currentStage = item.status === "done" ? "done" : (item.stage ?? "backlog");
  const lifecycleDisabled = isCompleting || isDeleting || isRepairing || Boolean(item.metadataIssues.length);
  const moveEntries: ContextMenuEntry[] = [
    ...(projects.length
      ? [
          {
            kind: "action" as const,
            id: "move",
            label: "Move to",
            icon: IconListUnordered,
            onSelect: () => undefined,
            children: projects.map((project) => ({
              kind: "action" as const,
              id: `move:${taskBoardProjectNameKey(project.name)}`,
              label: project.name,
              checked: taskBoardProjectNameKey(project.name) === taskBoardProjectNameKey(item.project ?? ""),
              indicatorColor: getTaskBoardProjectColorTheme(project.colorId).accent,
              disabled: isMoving || isCompleting,
              onSelect: () => move({ kind: "board", project: project.name, stage: currentStage, index: 0 }),
            })),
          },
        ]
      : []),
    ...(item.project
      ? [
          {
            kind: "action" as const,
            id: "move-stage",
            label: "Move to stage",
            icon: IconListUnordered,
            onSelect: () => undefined,
            children: TASK_BOARD_WORKFLOW_COLUMNS.map((stage) => ({
              kind: "action" as const,
              id: `move-stage:${stage.id}`,
              label: stage.label,
              checked: currentStage === stage.id,
              indicatorColor: stage.color,
              disabled: isMoving || lifecycleDisabled,
              onSelect: () => move({ kind: "board", project: item.project, stage: stage.id, index: 0 }),
            })),
          },
        ]
      : []),
  ];
  return [
    {
      kind: "action",
      id: "open",
      label: "Open task",
      icon: IconFileText,
      shortcut: "↵",
      onSelect: () => taskActions.openTask(item),
    },
    {
      kind: "action",
      id: "pin",
      label: item.pinned ? "Unpin task" : "Pin task",
      icon: IconPin,
      shortcut: "P",
      disabled: !isActive || lifecycleDisabled || isMoving,
      onSelect: togglePin,
    },
    isActive
      ? {
          kind: "action",
          id: "complete",
          label: "Complete task",
          icon: IconCheckbox,
          disabled: lifecycleDisabled,
          onSelect: () => void complete(),
        }
      : {
          kind: "action",
          id: "reopen",
          label: "Reopen task",
          disabled: Boolean(item.metadataIssues.length),
          onSelect: () => taskActions.reopenTask(item),
        },
    ...(isActive
      ? [
          {
            kind: "action" as const,
            id: "cancel",
            label: "Cancel task",
            icon: IconBan,
            disabled: lifecycleDisabled,
            onSelect: () => taskActions.cancelTask(item),
          },
        ]
      : []),
    { kind: "separator" },
    ...(item.metadataIssues.length
      ? [
          {
            kind: "action" as const,
            id: "repair-metadata",
            label: "Repair metadata",
            icon: IconRefresh,
            disabled: isRepairing,
            onSelect: repairMetadata,
          },
          { kind: "separator" as const },
        ]
      : []),
    {
      kind: "action",
      id: "edit",
      label: "Edit task",
      shortcut: "E",
      icon: IconPencil,
      disabled: isCompleting,
      onSelect: beginEdit,
    },
    ...(onAddSubtask
      ? [
          {
            kind: "action" as const,
            id: "add-subtask",
            label: "Add subtask",
            icon: IconSubtasks,
            onSelect: onAddSubtask,
          },
        ]
      : []),
    ...(isMovable && moveEntries.length ? [{ kind: "separator" as const }, ...moveEntries] : []),
    { kind: "separator" },
    {
      kind: "action",
      id: "trash",
      label: ACTION_LABELS.moveToTrash,
      icon: IconTrash,
      danger: true,
      disabled: isCompleting || isDeleting,
      onSelect: deleteTask,
    },
  ];
};

export const TaskBoardQuickMetadata = ({
  item,
  disabled,
  onUpdate,
}: {
  item: TaskBoardTask;
  disabled: boolean;
  onUpdate: (input: UpdateTaskMetadataInput) => Promise<boolean>;
}) => {
  const [open, setOpen] = useState<"priority" | "date" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const save = async (patch: UpdateTaskMetadataInput) => {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      const success = await onUpdate({
        ...patch,
        original: {
          taskName: item.title,
          project: item.project,
          tags: item.tags,
          priority: item.priority,
          dueDate: item.dueDate,
        },
      });
      if (success) setOpen(null);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  const triggerClass =
    "inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-[var(--chip-neutral)] px-1.5 text-ui-meta font-medium hover:bg-[var(--surface-hover)] [&>svg]:size-3.5";
  return (
    <>
      {(["priority", "date"] as const)
        .filter((field) => Boolean(field === "priority" ? item.priority : item.dueDate))
        .map((field) => (
          <Popover
            key={field}
            open={open === field}
            onOpenChange={(next) => {
              if (!saving) {
                setOpen(next ? field : null);
                setError(false);
              }
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                data-app-drag-handle=""
                disabled={disabled || saving}
                onClick={(event) => event.stopPropagation()}
                aria-label={(field === "priority" ? "Change priority for " : "Change due date for ") + item.title}
                className={cn(
                  triggerClass,
                  field === "priority" && item.priority
                    ? TASK_PRIORITY_PRESENTATION[item.priority].className
                    : "text-muted-foreground",
                )}
                title={
                  field === "priority"
                    ? `${TASK_NOTE_FIELD_KEYS.priority}: ${item.priority ?? "none"}`
                    : `${TASK_NOTE_FIELD_KEYS.due}: ${formatDueDate(item.dueDate) || "none"}`
                }
              >
                {field === "priority" ? (
                  <>
                    <IconFlagFill />
                    {item.priority ? TASK_PRIORITY_PRESENTATION[item.priority].label : null}
                  </>
                ) : (
                  <>
                    <IconCalendar />
                    {item.dueDate ? formatDueDate(item.dueDate) : null}
                  </>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              size="auto"
              padding="none"
              align="start"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {field === "priority" ? (
                <div className="min-w-[8rem] p-1" role="group" aria-label="Task priority">
                  {[...TASK_PRIORITIES, undefined].map((priority) => (
                    <button
                      key={priority ?? "none"}
                      type="button"
                      disabled={saving}
                      aria-pressed={item.priority === priority}
                      className="flex min-h-[var(--control-height-compact)] w-full items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-ui-control text-popover-foreground hover:bg-[var(--surface-hover)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                      onClick={() => void save({ priority })}
                    >
                      {priority ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-2",
                            TASK_PRIORITY_PRESENTATION[priority].className,
                          )}
                        >
                          <IconFlagFill className="h-4 w-4 shrink-0" />
                          {TASK_PRIORITY_PRESENTATION[priority].label}
                        </span>
                      ) : (
                        <>
                          <span aria-hidden="true" className="h-4 w-4 shrink-0" />
                          None
                        </>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <Calendar
                    autoFocus
                    mode="single"
                    disabled={saving}
                    selected={parseDueDate(item.dueDate)}
                    defaultMonth={parseDueDate(item.dueDate)}
                    onSelect={(date) => void save({ dueDate: date ? toDateInputValue(date) : "" })}
                  />
                  <div className="border-t border-[var(--border-default)] p-2">
                    <Button
                      variant="ghost"
                      disabled={saving || !item.dueDate}
                      onClick={() => void save({ dueDate: "" })}
                    >
                      Clear date
                    </Button>
                  </div>
                </>
              )}
              {error ? (
                <p role="alert" className="px-3 pb-2 text-ui-meta text-destructive">
                  Could not save. Try again.
                </p>
              ) : null}
            </PopoverContent>
          </Popover>
        ))}
    </>
  );
};
