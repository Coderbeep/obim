import "./TaskBoardTask.css";
import * as Tooltip from "@radix-ui/react-tooltip";
import { IconChevron, IconEllipsisSm, IconPin, IconRefresh, IconTag } from "@pierre/icons";
import { useAtomValue, useSetAtom } from "jotai";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { cn } from "@renderer/shared/classNames";
import { IconSubtasks } from "@renderer/shared/icons/IconSubtasks";
import type { TaskBoardProject } from "@renderer/shared/taskBoard";
import { badgeVariants } from "@renderer/shared/ui/badge";
import { Button } from "@renderer/shared/ui/button";
import { Card } from "@renderer/shared/ui/card";
import { Input } from "@renderer/shared/ui/input";
import { popoverContentVariants } from "@renderer/shared/ui/popover";
import { useAppDraggable } from "@renderer/shared/dnd/useAppDraggable";
import { contextMenuRequestAtom, openContextMenuAtom } from "@renderer/store/contextMenuStore";
import { setTaskBoardSubtasksCollapsedAtom, taskBoardPreferencesAtom } from "@renderer/store/taskBoardPreferencesStore";
import { TaskBoardTaskEditor, useTaskEditorDraft } from "./TaskBoardTaskEditor";
import { taskActionsMenu, TaskBoardQuickMetadata } from "./TaskBoardTaskMenu";
import {
  taskBoardDetailsPreview,
  type TaskActions,
  type TaskBoardTask as TaskBoardTaskModel,
  type TaskMoveIntent,
  type TaskNoteSubtaskChange,
  type UpdateTaskMetadataInput,
} from "./taskBoardModel";
import type { useTaskBoardDnd } from "./useTaskBoard";

type TaskBoardDnd = Pick<ReturnType<typeof useTaskBoardDnd>, "clear" | "draggedPath" | "startDrag">;
export const TaskBoardTask = ({
  subtaskProgress,
  onAddSubtask,
  dnd,
  isMoving = false,
  item,
  taskActions,
  projects,
}: {
  subtaskProgress?: ReactNode;
  onAddSubtask?: () => void;
  dnd?: TaskBoardDnd;
  isMoving?: boolean;
  item: TaskBoardTaskModel;
  taskActions: TaskActions;
  projects: TaskBoardProject[];
}) => {
  const {
    completeTask,
    deleteTask: removeTask,
    repairMetadata: repairTask,
    pinTask,
    openTask,
    moveTask,
    updateTask,
    loadTags,
  } = taskActions;
  const [isCompleting, setIsCompleting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const pinSaving = useRef(false);
  const [pinError, setPinError] = useState(false);
  const [editDraft, setEditDraft] = useTaskEditorDraft();
  const openContextMenu = useSetAtom(openContextMenuAtom);
  const contextMenuRequest = useAtomValue(contextMenuRequestAtom);
  const menuKey = `task-board-task:${item.path}`;
  const isContextMenuOpen = contextMenuRequest?.key === menuKey;
  const complete = async () => {
    if (isCompleting || isDeleting) return;
    setIsCompleting(true);
    try {
      await completeTask(item);
    } finally {
      setIsCompleting(false);
    }
  };
  const deleteTask = async () => {
    if (isCompleting || isDeleting) return;
    setIsDeleting(true);
    if (!(await removeTask(item))) setIsDeleting(false);
  };
  const repairMetadata = async () => {
    if (isRepairing) return;
    setIsRepairing(true);
    await repairTask(item);
    setIsRepairing(false);
  };
  const beginEdit = useCallback(
    () =>
      setEditDraft(
        (current) =>
          current ?? {
            original: {
              taskName: item.title,
              dueDate: item.dueDate,
              priority: item.priority,
              project: item.project,
              tags: [...(item.tags ?? [])],
            },
            taskName: item.title,
            initialBody: "",
            dueDate: item.dueDate ?? "",
            priority: item.priority,
            project: item.project,
            tags: [...(item.tags ?? [])],
          },
      ),
    [item.dueDate, item.priority, item.project, item.tags, item.title, setEditDraft],
  );
  const togglePin = useCallback(() => {
    if (
      pinSaving.current ||
      isRepairing ||
      isMoving ||
      isCompleting ||
      isDeleting ||
      item.status !== "open" ||
      item.metadataIssues.length
    )
      return;
    pinSaving.current = true;
    setPinError(false);
    void (async () => {
      try {
        const success = await pinTask(item, !item.pinned);
        setPinError(!success);
      } catch {
        setPinError(true);
      } finally {
        pinSaving.current = false;
      }
    })();
  }, [item, pinTask, isRepairing, isMoving, isCompleting, isDeleting]);
  useEffect(() => {
    if (!isHovered || editDraft || isCompleting || isDeleting) return;
    const handleEditShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !["e", "p", "enter"].includes(event.key.toLowerCase()) ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Enter") {
        if (contextMenuRequest || isRepairing || isMoving) return;
        if (
          target instanceof HTMLElement &&
          target.closest("button, a, [role='button'], [role='menuitem'], [role='checkbox']")
        )
          return;
        event.preventDefault();
        void openTask(item);
        return;
      }
      if (event.key.toLowerCase() === "p") {
        if (pinSaving.current || isRepairing || isMoving || contextMenuRequest || item.metadataIssues.length) return;
        event.preventDefault();
        togglePin();
        return;
      }
      event.preventDefault();
      beginEdit();
    };
    window.addEventListener("keydown", handleEditShortcut);
    return () => window.removeEventListener("keydown", handleEditShortcut);
  }, [
    beginEdit,
    togglePin,
    editDraft,
    isCompleting,
    isDeleting,
    isHovered,
    isRepairing,
    isMoving,
    contextMenuRequest,
    item,
    openTask,
  ]);
  const move = async (intent: TaskMoveIntent) => {
    const success = await moveTask(item, intent);
    if (success) {
      window.requestAnimationFrame(() => {
        const moved = [...document.querySelectorAll<HTMLElement>("[data-task-path]")].find(
          (element) => element.dataset.taskPath === item.path,
        );
        moved?.focus();
      });
    }
  };
  const isMovable = item.status !== "cancelled";
  const dragProps = useAppDraggable<HTMLDivElement>({
    enabled: Boolean(dnd && isMovable && !editDraft && !isCompleting),
    entity: { kind: "task", id: item.path },
    preview: { text: item.title, subtext: "Choose a position" },
    onCancel: dnd?.clear,
    onDragEnd: dnd?.clear,
    onDragStart: (event) => dnd?.startDrag(event, item),
  });
  const menuEntries = taskActionsMenu({
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
  });
  const openTaskContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const isRightClick = event.type === "contextmenu";
    openContextMenu({
      key: menuKey,
      anchor: event.currentTarget,
      entries: menuEntries,
      position: isRightClick
        ? { x: event.clientX, y: event.clientY }
        : { x: rect.right, y: rect.bottom + 4, alignX: "right" },
      toggleOnRepeat: !isRightClick,
    });
  };
  return (
    <Card
      data-task-path={item.path}
      data-task-layout="board"
      data-editing={editDraft ? "true" : undefined}
      role="button"
      {...dragProps}
      className={cn(
        "group/task-card relative w-full min-w-0 max-w-full transition-[background-color,border-color,opacity] duration-[40ms] focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none",
        "mb-1.5 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-3)] px-2.5 py-2 shadow-none",
        editDraft
          ? "cursor-default border border-[var(--border-strong)] bg-[var(--surface-1)]"
          : isCompleting
            ? "cursor-default"
            : "task-board-task-hover hover:border-[var(--border-strong)] cursor-pointer",
        (isDeleting || isRepairing) && "pointer-events-none opacity-60",
      )}
      onClick={() => {
        if (!isCompleting && !isDeleting && !isRepairing && !editDraft) void openTask(item);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onContextMenu={editDraft || isCompleting ? undefined : openTaskContextMenu}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "F2" && !editDraft && !isCompleting) {
          event.preventDefault();
          beginEdit();
        } else if (
          (event.key === "Enter" || event.key === " ") &&
          event.target === event.currentTarget &&
          !editDraft &&
          !isCompleting &&
          !isDeleting
        ) {
          event.preventDefault();
          void openTask(item);
        }
      }}
      tabIndex={editDraft ? -1 : 0}
      aria-label={`Open task ${item.title}`}
    >
      {editDraft ? (
        <TaskBoardTaskEditor
          draft={editDraft}
          loadTags={loadTags}
          mode="edit"
          onSubmit={(input) =>
            updateTask(item, {
              original: input.original,
              taskName: input.taskName,
              dueDate: input.dueDate,
              priority: input.priority,
              project: input.project,
              tags: input.tags,
            })
          }
          projects={projects}
          setDraft={setEditDraft}
        />
      ) : (
        <TaskBoardTaskContent
          subtaskProgress={subtaskProgress}
          isContextMenuOpen={isContextMenuOpen}
          item={item}
          onQuickUpdate={(input) => updateTask(item, input)}
          onOpenActions={openTaskContextMenu}
          onRepair={(event) => {
            event.stopPropagation();
            void repairMetadata();
          }}
        />
      )}
      {pinError ? (
        <p role="alert" className="mt-1 text-ui-meta text-destructive">
          Could not save pin. Press P to retry.
        </p>
      ) : null}
    </Card>
  );
};

type Props = ComponentProps<typeof TaskBoardTask> & {
  searchQuery?: string;
};
export function TaskBoardNoteTask({ searchQuery, ...props }: Props) {
  const { item, taskActions } = props;
  const tasks = item.subtasks ?? [];
  const collapsed = useAtomValue(taskBoardPreferencesAtom).collapsedSubtaskPaths.includes(item.path);
  const setCollapsed = useSetAtom(setTaskBoardSubtasksCollapsedAtom);
  const [searchReveal, setSearchReveal] = useState(() => Boolean(searchQuery?.trim()));
  const expanded = searchReveal || !collapsed;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [optimistic, setOptimistic] = useState<{ index: number; checked: boolean } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setSearchReveal(Boolean(searchQuery?.trim()));
  }, [searchQuery]);
  const checked = (index: number) => (optimistic?.index === index ? optimistic.checked : tasks[index].checked);
  const completed = tasks.filter((_, index) => checked(index)).length;
  const save = async (change: TaskNoteSubtaskChange) => {
    if (pending) return false;
    setPending(true);
    setError("");
    if (change.kind === "check") setOptimistic({ index: change.index, checked: change.checked });
    try {
      const success = await taskActions.updateSubtasks(item, change);
      if (!success) setError("Could not save the subtask. Try again.");
      return success;
    } catch {
      setError("Could not save the subtask. Try again.");
      return false;
    } finally {
      setPending(false);
      setOptimistic(null);
    }
  };
  return (
    <>
      <TaskBoardTask
        {...props}
        onAddSubtask={() => {
          setCollapsed(item.path, false);
          setSearchReveal(false);
          setAdding(true);
        }}
        subtaskProgress={
          tasks.length ? (
            <button
              type="button"
              className="task-board-children-toggle"
              aria-label={`${completed} of ${tasks.length} subtasks completed`}
              title={`${expanded ? "Hide" : "Show"} subtasks`}
              aria-expanded={expanded}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setSearchReveal(false);
                setCollapsed(item.path, expanded);
              }}
            >
              <span className="task-board-children-toggle-icon" aria-hidden="true">
                <IconSubtasks size={14} className="task-board-children-branch" />
                <IconChevron size={14} className="task-board-children-chevron" />
              </span>
              {completed}/{tasks.length}
            </button>
          ) : null
        }
      />
      {expanded && tasks.length > 0 ? (
        <div className="task-board-note-subtasks" aria-label={`Subtasks of ${item.title}`}>
          {tasks.map((task, index) => (
            <div key={index} className="task-board-note-subtask" style={{ marginLeft: Math.min(task.depth, 5) * 16 }}>
              <TaskBoardCompletionCircle
                role="checkbox"
                ariaHidden={false}
                tabIndex={0}
                checked={checked(index)}
                disabled={pending}
                ariaLabel={`${checked(index) ? "Uncheck" : "Complete"} subtask ${task.text || "Untitled"}`}
                onClick={() => {
                  void save({ kind: "check", index, checked: !checked(index), expected: tasks });
                }}
              />
              <button
                type="button"
                className="task-board-note-subtask-title task-board-task-title text-ui-item font-semibold text-foreground"
                data-checked={checked(index)}
                onClick={() => taskActions.openTask(item, { index, expected: tasks })}
              >
                {task.text || "Untitled subtask"}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {adding ? (
        <form
          className="task-board-note-subtask-form"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              setAdding(false);
              setDraft("");
            }
          }}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!draft.trim() || pending) return;
            if (await save({ kind: "append", text: draft })) setDraft("");
          }}
        >
          <TaskBoardCompletionCircle />
          <Input
            className="task-board-name-input h-6 border-none bg-transparent px-0 py-0 text-ui-item font-semibold leading-6 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-none focus-visible:ring-0"
            autoFocus
            aria-label={`New subtask for ${item.title}`}
            placeholder="Subtask name"
            value={draft}
            readOnly={pending}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="col-span-full mt-2 flex items-center justify-end gap-1 border-t border-[var(--border-subtle)] pt-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-6"
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="xs" className="h-6" disabled={pending || !draft.trim()}>
              Add subtask <span aria-hidden="true">↵</span>
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-ui-meta text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

const TaskBoardTaskContent = ({
  subtaskProgress,
  isContextMenuOpen,
  item,
  onOpenActions,
  onRepair,
  onQuickUpdate,
}: {
  subtaskProgress?: ReactNode;
  isContextMenuOpen: boolean;
  item: TaskBoardTaskModel;
  onOpenActions: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onRepair: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onQuickUpdate: (input: UpdateTaskMetadataInput) => Promise<boolean>;
}) => {
  const tags = item.tags ?? [];
  const preview = item.preview;
  return (
    <div className={cn("grid min-w-0 items-start gap-x-2", "grid-cols-[minmax(0,1fr)_24px] gap-x-2")}>
      <div className="min-w-0">
        <div
          className={cn(
            "task-board-task-title min-w-0 font-semibold text-foreground [overflow-wrap:anywhere]",
            "line-clamp-2 text-ui-item leading-5",
          )}
          data-completed={item.status !== "open" ? "true" : undefined}
        >
          {item.title}
        </div>
        {preview ? (
          <div
            className={cn(
              "task-board-task-details text-ui-body mt-0.5 min-w-0 font-normal text-muted-foreground [overflow-wrap:anywhere]",
              "mt-1 line-clamp-2",
            )}
            title={preview}
          >
            {taskBoardDetailsPreview(preview)}
          </div>
        ) : null}
        {item.metadataIssues.length ? (
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-left text-ui-meta font-semibold text-[var(--status-warning)] hover:underline"
            title={item.metadataIssues.join(" ")}
            aria-label={`Repair metadata for ${item.title}: ${item.metadataIssues.join(" ")}`}
            onClick={onRepair}
          >
            <IconRefresh size={12} aria-hidden="true" />
            Repair metadata
          </button>
        ) : null}
        {tags.length > 0 || item.priority || item.dueDate || subtaskProgress ? (
          <div
            className={cn("task-board-task-metadata mt-1.5 min-w-0 items-start gap-1", "mt-1 flex flex-wrap gap-x-3")}
          >
            {subtaskProgress}
            <TaskBoardQuickMetadata
              item={item}
              disabled={item.status === "cancelled" || Boolean(item.metadataIssues.length)}
              onUpdate={onQuickUpdate}
            />
            {tags.length ? <TaskBoardTags tags={tags} /> : null}
          </div>
        ) : null}
      </div>
      <div className="relative">
        {item.pinned ? (
          <span
            role="img"
            aria-label="Pinned task"
            title="Pinned task"
            className="pointer-events-none absolute inset-0 flex h-6 items-center justify-center text-muted-foreground group-hover/task-card:hidden group-focus-within/task-card:hidden"
          >
            <IconPin className="size-4" />
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Task actions for ${item.title}`}
          title="Task actions"
          className={cn(
            "transition-opacity",
            "opacity-0 group-hover/task-card:opacity-100 group-focus-within/task-card:opacity-100",
            isContextMenuOpen && "opacity-100",
          )}
          onClick={onOpenActions}
        >
          <IconEllipsisSm />
        </Button>
      </div>
    </div>
  );
};

interface TaskBoardCompletionCircleProps {
  checked?: boolean;
  role?: "checkbox";
  celebrate?: boolean;
  disabled?: boolean;
  ariaHidden?: boolean;
  ariaLabel?: string;
  tabIndex?: number;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}
export const TaskBoardCompletionCircle = ({
  checked = false,
  role,
  celebrate = false,
  disabled = false,
  ariaHidden = true,
  ariaLabel,
  tabIndex = -1,
  onClick,
}: TaskBoardCompletionCircleProps) => {
  const [hovered, setHovered] = useState(false);
  const previousChecked = useRef(checked);
  const [justCompleted, setJustCompleted] = useState(false);
  useLayoutEffect(() => {
    setJustCompleted(checked && !previousChecked.current);
    previousChecked.current = checked;
  }, [checked]);
  const showCheck = checked || hovered;
  const visualState = checked ? "checked" : hovered ? "preview" : "idle";
  const sharedClassName = cn(
    "task-completion-control inline-flex h-6 w-6 shrink-0 items-center justify-center text-[var(--icon-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:text-[var(--text-disabled)]",
  );
  const inner = (
    <div
      className="task-completion-bubble relative inline-flex h-5 w-5 items-center justify-center rounded-full"
      data-state={visualState}
      data-celebrate={checked && (celebrate || justCompleted) ? "true" : undefined}
    >
      <span className="task-completion-halo" aria-hidden="true" data-task-completion-halo />
      <span className="task-completion-ring" aria-hidden="true" data-task-completion-circle />
      {showCheck ? (
        <svg
          viewBox="0 0 20 20"
          className="task-completion-check absolute h-5 w-5"
          aria-hidden="true"
          data-task-completion-check
        >
          <path d="m5.4 10.2 2.8 2.8 6.4-6.6" pathLength="1" />
        </svg>
      ) : null}
    </div>
  );
  if (!onClick) {
    return (
      <div
        className={sharedClassName}
        aria-hidden={ariaHidden}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "checkbox" ? checked : undefined}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      disabled={disabled}
      className={sharedClassName}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {inner}
    </button>
  );
};

const useFittingTagCount = (tags: readonly string[], fallbackVisibleCount: number, fallbackGap: number) => {
  const [visibleCount, setVisibleCount] = useState(fallbackVisibleCount);
  const rowRef = useRef<HTMLDivElement>(null);
  const overflowMeasureRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const fitTags = () => {
      const availableWidth = row.clientWidth;
      if (!availableWidth) {
        setVisibleCount(fallbackVisibleCount);
        return;
      }
      const gap = Number.parseFloat(window.getComputedStyle(row).columnGap) || fallbackGap;
      const tagWidths = [...row.querySelectorAll<HTMLElement>("[data-task-tag-measure]")].map((tag) => tag.offsetWidth);
      const overflowWidth = overflowMeasureRef.current?.offsetWidth ?? 0;
      let usedWidth = 0;
      let nextVisibleCount = 0;
      tagWidths.forEach((tagWidth, index) => {
        if (nextVisibleCount !== index || index >= fallbackVisibleCount) return;
        const nextWidth = usedWidth + (index ? gap : 0) + tagWidth;
        const hasRemainingTags = index + 1 < tagWidths.length;
        const widthWithOverflow = nextWidth + (hasRemainingTags ? gap + overflowWidth : 0);
        if (widthWithOverflow > availableWidth) return;
        usedWidth = nextWidth;
        nextVisibleCount += 1;
      });
      setVisibleCount(nextVisibleCount);
    };
    fitTags();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitTags);
    observer.observe(row);
    return () => observer.disconnect();
  }, [fallbackGap, fallbackVisibleCount, tags]);
  return { overflowMeasureRef, rowRef, visibleCount: Math.min(visibleCount, tags.length) };
};
const TaskBoardTagsPopover = ({
  tags,
  label,
  className,
  hidden,
  measure,
  children,
}: {
  tags: readonly string[];
  label: string;
  className: string;
  hidden?: boolean;
  measure?: boolean;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className={className}
            data-app-drag-handle=""
            data-task-tag-measure={measure || undefined}
            aria-hidden={hidden}
            tabIndex={hidden ? -1 : undefined}
            aria-expanded={open}
            aria-label={label}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") setOpen(false);
            }}
          >
            {children}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            className={cn(popoverContentVariants({ size: "sm", padding: "none" }), "p-3")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <div className="mb-2 text-ui-meta font-medium text-muted-foreground">Tags</div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    badgeVariants({ variant: "category" }),
                    "h-auto min-h-5 max-w-full whitespace-normal font-medium [overflow-wrap:anywhere]",
                  )}
                >
                  <IconTag aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0">{tag}</span>
                </span>
              ))}
            </div>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};
const TaskBoardTags = ({ tags }: { tags: readonly string[] }) => {
  const fallbackVisibleCount = Math.min(tags.length, 2);
  const { overflowMeasureRef, rowRef, visibleCount: shownCount } = useFittingTagCount(tags, fallbackVisibleCount, 6);
  const remainingCount = tags.length - shownCount;
  return (
    <div className={cn("min-w-0", "min-w-20 flex-1")} onClick={(event) => event.stopPropagation()}>
      <div
        ref={rowRef}
        className="task-board-task-tags relative flex h-5 min-w-0 flex-nowrap items-center gap-x-1.5 overflow-hidden"
      >
        {tags.map((tag, index) => (
          <TaskBoardTagsPopover
            key={tag}
            tags={tags}
            label={`Show all tags: ${tag}`}
            measure
            hidden={index >= shownCount}
            className={cn(
              badgeVariants({ variant: "category" }),
              "task-board-tag-text max-w-full cursor-pointer font-medium",
              index >= shownCount && "invisible absolute left-0 top-0 pointer-events-none",
            )}
          >
            <IconTag aria-hidden="true" className="shrink-0" />
            <span className="min-w-0">{tag}</span>
          </TaskBoardTagsPopover>
        ))}
        {remainingCount > 0 ? (
          <TaskBoardTagsPopover
            tags={tags}
            label={`Show ${remainingCount} more tags`}
            className={cn(badgeVariants({ variant: "category" }), "task-board-tags-trigger cursor-pointer font-medium")}
          >
            +{remainingCount}
          </TaskBoardTagsPopover>
        ) : null}
        <span
          ref={overflowMeasureRef}
          aria-hidden="true"
          className={cn(
            badgeVariants({ variant: "category" }),
            "invisible absolute left-0 top-0 font-medium pointer-events-none",
          )}
        >
          +{tags.length}
        </span>
      </div>
    </div>
  );
};
