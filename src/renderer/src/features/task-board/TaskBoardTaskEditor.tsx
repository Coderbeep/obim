import "./TaskBoardTask.css";
import "./TaskBoard.css";
import { IconCalendar, IconChevron, IconFlagFill, IconGear, IconCheck, IconPlus, IconTag } from "@pierre/icons";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import { cn } from "@renderer/shared/classNames";
import {
  assistDateInput,
  dateInputToStorage,
  formatDueDate,
  parseDueDate,
  toDateInputValue,
} from "@renderer/shared/date";
import { Button } from "@renderer/shared/ui/button";
import { Calendar } from "@renderer/shared/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/shared/ui/dropdown-menu";
import { Input } from "@renderer/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/shared/ui/popover";
import { TASK_PRIORITIES, taskBoardProjectNameKey, type TaskBoardProject } from "@renderer/shared/taskBoard";
import {
  getTaskBoardProjectColorTheme,
  getTaskNameValidationMessage,
  TASK_PRIORITY_PRESENTATION,
  type CreateTaskInput,
  type DraftTaskState,
  normalizeTaskTag,
  normalizeTaskTags,
  taskTagKey,
} from "./taskBoardModel";
import { focusListboxOption } from "@renderer/shared/ui/menu-navigation";
import { useAtomValue, useSetAtom } from "jotai";
import { taskEditorAtom, createTaskEditorSessionAtom } from "@renderer/store/taskBoardEditorStore";

const projectMenuValue = (sectionName: string) => `project:${sectionName}`;
const ProjectColorDot = ({ colorId }: { colorId?: string }) => (
  <span
    aria-hidden="true"
    className="inline-block size-2 shrink-0 rounded-full"
    style={{ backgroundColor: getTaskBoardProjectColorTheme(colorId).accent }}
  />
);
interface TaskBoardEditorProps {
  draft: DraftTaskState;
  loadTags: (currentTags?: readonly string[]) => Promise<string[]>;
  mode?: "create" | "edit";
  showProjectChooser?: boolean;
  onFloatingMenuOpenChange?: (open: boolean) => void;
  onOpenManageProjects?: () => void;
  onSubmit: (task: CreateTaskInput) => Promise<boolean>;
  projects: TaskBoardProject[];
  setDraft: React.Dispatch<React.SetStateAction<DraftTaskState | null>>;
}
export const TaskBoardTaskEditor = ({
  draft,
  loadTags,
  mode = "create",
  showProjectChooser = false,
  onFloatingMenuOpenChange,
  onOpenManageProjects,
  onSubmit,
  projects,
  setDraft,
}: TaskBoardEditorProps) => {
  const [isSaving, setIsSaving] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [tagsMenuOpen, setTagsMenuOpen] = useState(false);
  const [titleValidationRevealed, setTitleValidationRevealed] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const dateCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (dateCaret.current === null) return;
    dateInputRef.current?.setSelectionRange(dateCaret.current, dateCaret.current);
    dateCaret.current = null;
  });
  const titleErrorId = useId();
  const dateErrorId = useId();
  const editing = mode === "edit";
  const creating = !editing;
  const submitLabel = editing ? "Save changes" : "Add task";
  const priorityIndex = draft.priority ? TASK_PRIORITIES.indexOf(draft.priority) : TASK_PRIORITIES.length;
  const taskName = draft.taskName.trim();
  const parsedDueDate = parseDueDate(draft.dueDate);
  const titleValidationMessage = getTaskNameValidationMessage(draft.taskName);
  const titleError = titleValidationRevealed || draft.taskName.length > 0 ? titleValidationMessage : null;
  const dateError = draft.dueDate !== "" && !parsedDueDate ? "Enter a real date in DD-MM-YYYY format." : null;
  const submitDisabled = isSaving || Boolean(titleValidationMessage) || Boolean(dateError);
  useLayoutEffect(() => {
    const input = titleInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollLeft = input.scrollWidth;
  }, []);
  useEffect(() => {
    onFloatingMenuOpenChange?.(datePickerOpen || projectMenuOpen || tagsMenuOpen);
    return () => onFloatingMenuOpenChange?.(false);
  }, [datePickerOpen, onFloatingMenuOpenChange, projectMenuOpen, tagsMenuOpen]);
  useEffect(() => {
    if (editing || !draft.project) return;
    const selected = projects.find(
      (project) => taskBoardProjectNameKey(project.name) === taskBoardProjectNameKey(draft.project ?? ""),
    );
    if (selected?.name === draft.project) return;
    setDraft((current) => {
      if (!current || current.project !== draft.project) return current;
      return { ...current, project: selected?.name };
    });
  }, [draft.project, editing, projects, setDraft]);
  const closeDraft = () => setDraft(null);
  const updateDraft = (patch: Partial<DraftTaskState>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };
  const updateTaskName = (nextTaskName: string) => {
    setTitleValidationRevealed(true);
    updateDraft({ taskName: nextTaskName });
  };
  const submitTask = async () => {
    setTitleValidationRevealed(true);
    if (submitDisabled) return;
    setIsSaving(true);
    const input: CreateTaskInput = {
      ...(draft.original ? { original: draft.original } : {}),
      taskName,
      initialBody: draft.initialBody,
      dueDate: draft.dueDate || undefined,
      priority: draft.priority,
      project: draft.project,
      stage: draft.stage,
      tags: draft.tags,
    };
    const success = await onSubmit(input);
    setIsSaving(false);
    if (success) closeDraft();
  };
  return (
    <div
      data-task-editor-layout="board"
      data-task-editor-mode={mode}
      className={cn(
        "task-board-composer grid min-w-0 items-start gap-x-2",
        "relative grid-cols-[minmax(0,1fr)]",
        !editing &&
          "mb-1.5 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-3)] p-3 shadow-none",
      )}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        const priorityFocused = event.target instanceof HTMLElement && Boolean(event.target.closest('[role="radio"]'));
        if (event.key === "Enter" && !event.shiftKey && (event.metaKey || event.ctrlKey || priorityFocused)) {
          event.preventDefault();
          void submitTask();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeDraft();
        }
      }}
    >
      <div className="col-start-1 flex min-w-0 flex-1 flex-col gap-1">
        <Input
          ref={titleInputRef}
          value={draft.taskName}
          onChange={(event) => updateTaskName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submitTask();
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              closeDraft();
            }
          }}
          placeholder="Task name"
          aria-label="Task name"
          aria-invalid={Boolean(titleError)}
          aria-describedby={titleError ? titleErrorId : undefined}
          className={cn(
            "task-board-name-input border-none bg-transparent px-0 py-0 font-semibold text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-none focus-visible:ring-0 aria-invalid:border-none aria-invalid:ring-0",
            "h-6 text-ui-item leading-6",
          )}
        />
        <div className="task-board-composer-metadata mt-1 grid grid-cols-[minmax(0,1fr)_7.5rem] gap-1">
          {showProjectChooser ? (
            <DropdownMenu modal={false} open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="xsm"
                  variant="ghost"
                  aria-label="Choose project"
                  title={draft.project ?? "Choose project"}
                  className={cn(
                    "text-ui-meta h-6 cursor-pointer gap-0 overflow-hidden rounded-[var(--radius-control)] border! border-solid! border-[var(--border-default)]! bg-[var(--surface-2)] p-0 font-medium text-foreground tabular-nums hover:bg-[var(--surface-hover)] hover:text-foreground data-[state=open]:bg-[var(--surface-selected)]",
                    creating && "col-span-full row-start-3 w-full",
                  )}
                >
                  <span className={cn("inline-flex h-full min-w-0 items-center gap-1 px-2", creating && "flex-1")}>
                    <ProjectColorDot
                      colorId={
                        projects.find(
                          (project) =>
                            taskBoardProjectNameKey(project.name) === taskBoardProjectNameKey(draft.project ?? ""),
                        )?.colorId
                      }
                    />
                    <span className="truncate">{draft.project ?? "Choose project"}</span>
                  </span>
                  <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-secondary-foreground/20" />
                  <span aria-hidden="true" className="grid h-full w-6 shrink-0 place-items-center">
                    <IconChevron className="size-3!" />
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuRadioGroup
                  value={draft.project ? projectMenuValue(draft.project) : ""}
                  onValueChange={(value) => updateDraft({ project: value.slice("project:".length) })}
                >
                  {projects.map((project) => (
                    <DropdownMenuRadioItem
                      key={project.name.toLocaleLowerCase()}
                      value={projectMenuValue(project.name)}
                    >
                      <ProjectColorDot colorId={project.colorId} />
                      {project.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                {onOpenManageProjects ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        setProjectMenuOpen(false);
                        window.requestAnimationFrame(onOpenManageProjects);
                      }}
                    >
                      <IconGear />
                      Projects
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <div
            className={cn("flex min-w-0 flex-wrap items-center gap-1", "col-start-1 row-start-1 w-full flex-nowrap")}
          >
            <TaskTagSelector
              selected={draft.tags}
              onChange={(tags) => updateDraft({ tags })}
              loadTags={loadTags}
              onOpenChange={(open) => {
                setTagsMenuOpen(open);
              }}
              emptyLabel="Tags"
              className={cn("w-full min-w-0")}
            />
          </div>

          <div className={cn("flex flex-wrap items-center gap-1", "col-start-2 row-start-1 w-full")}>
            <span
              className={cn(
                "text-ui-meta inline-flex h-6 items-center overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-2)] font-medium text-foreground",
                "w-full",
              )}
            >
              <input
                type="text"
                inputMode="numeric"
                ref={dateInputRef}
                aria-label="Task date"
                autoComplete="off"
                placeholder="DD-MM-YYYY"
                spellCheck={false}
                value={formatDueDate(draft.dueDate)}
                aria-invalid={draft.dueDate !== "" && !parsedDueDate}
                aria-describedby={dateError ? dateErrorId : undefined}
                onChange={(event) => {
                  const input = event.currentTarget;
                  const native = event.nativeEvent as InputEvent;
                  if (native.isComposing) return;
                  const next = assistDateInput(
                    input.value,
                    input.selectionStart ?? input.value.length,
                    native.inputType?.startsWith("delete"),
                  );
                  dateCaret.current = next.caret;
                  input.value = next.value;
                  input.setSelectionRange(next.caret, next.caret);
                  updateDraft({ dueDate: dateInputToStorage(next.value) });
                }}
                className={cn(
                  "task-board-date-input h-full min-w-0 border-0 bg-transparent px-2 font-medium text-inherit tabular-nums outline-none",
                  "flex-1",
                )}
              />
              <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-[var(--border-strong)]" />
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="xsm"
                    variant="ghost"
                    aria-label="Choose date"
                    className="h-full w-6 rounded-[var(--radius-control)] px-0 text-inherit hover:bg-[var(--surface-hover)] hover:text-inherit focus-visible:bg-secondary-foreground/15 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0"
                  >
                    <IconCalendar className="size-3!" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent size="auto" padding="none" align="start">
                  <Calendar
                    autoFocus
                    mode="single"
                    selected={parsedDueDate}
                    defaultMonth={parsedDueDate}
                    onSelect={(date) => {
                      updateDraft({ dueDate: date ? toDateInputValue(date) : "" });
                      setDatePickerOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </span>
          </div>

          <div
            role="radiogroup"
            aria-label="Choose priority"
            className={cn(
              "task-board-priority-picker relative isolate inline-grid h-6 grid-cols-4 overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-2)] p-0.5",
              "col-span-2 row-start-2 w-full",
            )}
          >
            <span
              aria-hidden="true"
              data-priority-indicator
              className="absolute inset-y-0.5 left-0.5 -z-[1] rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--surface-1)] transition-transform duration-[140ms] ease-[cubic-bezier(0.2,0,0,1)] will-change-transform"
              style={{
                width: `calc((100% - 4px) / ${TASK_PRIORITIES.length + 1})`,
                transform: `translateX(${priorityIndex * 100}%)`,
              }}
            />
            {TASK_PRIORITIES.map((priority) => {
              const selected = draft.priority === priority;
              return (
                <button
                  key={priority}
                  type="button"
                  role="radio"
                  aria-label={TASK_PRIORITY_PRESENTATION[priority].label}
                  aria-checked={selected}
                  onClick={() => updateDraft({ priority })}
                  className={cn(
                    "task-board-priority-option text-ui-meta z-[1] inline-flex h-[18px] min-w-0 items-center justify-center gap-1 rounded-[calc(var(--radius)-0.125rem)] px-0 font-semibold transition-colors duration-[90ms] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                    editing && "flex-1",
                    TASK_PRIORITY_PRESENTATION[priority].className,
                  )}
                >
                  <IconFlagFill className="size-3! shrink-0 fill-current" aria-hidden="true" />
                  <span className="task-board-priority-label">{TASK_PRIORITY_PRESENTATION[priority].label}</span>
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={draft.priority === undefined}
              onClick={() => updateDraft({ priority: undefined })}
              className={cn(
                "text-ui-meta z-[1] h-[18px] min-w-0 rounded-[calc(var(--radius)-0.125rem)] px-0 font-semibold text-muted-foreground transition-colors duration-[90ms] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                editing && "flex-1",
                draft.priority === undefined && "text-foreground",
              )}
            >
              None
            </button>
          </div>
        </div>
      </div>
      {titleError || dateError ? (
        <div className={cn("text-ui-meta text-[var(--status-danger)]", "col-span-full mt-1.5")} role="alert">
          {titleError ? <p id={titleErrorId}>{titleError}</p> : null}
          {dateError ? <p id={dateErrorId}>{dateError}</p> : null}
        </div>
      ) : null}
      <div
        className={cn(
          "flex items-center justify-end border-t border-[var(--border-subtle)]",
          "task-board-composer-actions col-span-full mt-2 pt-2",
        )}
      >
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" className="h-6" onClick={closeDraft}>
            Cancel
          </Button>
          <Button
            size="xs"
            className="h-6"
            aria-label={submitLabel}
            onClick={() => void submitTask()}
            disabled={submitDisabled}
          >
            {submitLabel}
            <span aria-hidden="true">↵</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

const EMPTY_TAGS: readonly string[] = [];

export interface TaskTagSelectorProps {
  allowCreate?: boolean;
  ariaLabel?: string;
  className?: string;
  emptyLabel?: string;
  loadTags?: (currentTags?: readonly string[]) => Promise<string[]>;
  onChange: (selected: string[]) => void;
  onOpenChange?: (open: boolean) => void;
  options?: readonly string[];
  selected: readonly string[];
}

export const TaskTagSelector = ({
  allowCreate = true,
  ariaLabel = "Choose tags",
  className,
  emptyLabel = "Add tags",
  loadTags,
  onChange,
  onOpenChange,
  options = EMPTY_TAGS,
  selected,
}: TaskTagSelectorProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loadedOptions, setLoadedOptions] = useState(() => normalizeTaskTags(options));
  const selectedTags = useMemo(() => normalizeTaskTags(selected), [selected]);
  const allTags = useMemo(
    () => normalizeTaskTags([...loadedOptions, ...options, ...selectedTags]),
    [loadedOptions, options, selectedTags],
  );
  const normalizedSearch = normalizeTaskTag(search);
  const searchKey = taskTagKey(normalizedSearch);
  const visibleTags = searchKey ? allTags.filter((tag) => taskTagKey(tag).includes(searchKey)) : allTags;
  const canCreate = allowCreate && normalizedSearch.length > 0 && !allTags.some((tag) => taskTagKey(tag) === searchKey);
  const selectionCount = selectedTags.length;
  const selectedLabels = selectedTags;
  const summary = selectionCount ? selectedLabels.join(", ") : emptyLabel;

  useEffect(() => {
    setLoadedOptions(normalizeTaskTags(options));
  }, [options]);

  const setOpenState = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (nextOpen) {
      if (loadTags) {
        void loadTags(selectedTags).then(
          (tags) => setLoadedOptions(normalizeTaskTags([...tags, ...selectedTags])),
          () => setLoadedOptions(normalizeTaskTags([...options, ...selectedTags])),
        );
      }
    } else {
      setSearch("");
    }
  };

  const toggleTag = (tag: string) => {
    const key = taskTagKey(tag);
    const isSelected = selectedTags.some((value) => taskTagKey(value) === key);
    onChange(
      isSelected ? selectedTags.filter((value) => taskTagKey(value) !== key) : [...selectedTags, normalizeTaskTag(tag)],
    );
  };

  const createTag = () => {
    if (!canCreate) return;
    onChange(normalizeTaskTags([...selectedTags, normalizedSearch]));
    setLoadedOptions((current) => normalizeTaskTags([...current, normalizedSearch]));
    setSearch("");
  };

  const optionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    focusListboxOption(listRef.current, event.key === "ArrowDown" ? "next" : "previous", event.currentTarget);
  };

  return (
    <Popover open={open} onOpenChange={setOpenState}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("task-tag-selector-trigger", className)}
          aria-label={ariaLabel}
          aria-expanded={open}
          title={selectionCount ? selectedLabels.join(", ") : emptyLabel}
        >
          <IconTag size={13} aria-hidden="true" className="task-tag-selector-trigger-icon" />
          <span className="task-tag-selector-summary" data-placeholder={selectionCount ? "false" : "true"}>
            {summary}
          </span>
          {selectionCount > 1 ? <span className="task-tag-selector-count">{selectionCount}</span> : null}
          <IconChevron
            size={12}
            aria-hidden="true"
            className="task-tag-selector-chevron"
            data-open={open ? "true" : "false"}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        size="auto"
        padding="none"
        className="task-tag-selector-popover"
        aria-label="Tag selector"
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="menu-search">
          <Input
            autoFocus
            value={search}
            aria-label="Search tags"
            placeholder="Search tags"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canCreate && !event.nativeEvent.isComposing) {
                event.preventDefault();
                createTag();
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                focusListboxOption(listRef.current, event.key === "ArrowDown" ? "first" : "last");
              }
            }}
          />
        </div>
        <div
          ref={listRef}
          className="menu-list task-tag-selector-list"
          role="listbox"
          aria-label="Tags"
          aria-multiselectable="true"
        >
          {visibleTags.map((tag) => {
            const isSelected = selectedTags.some((value) => taskTagKey(value) === taskTagKey(tag));
            return (
              <button
                key={taskTagKey(tag)}
                type="button"
                role="option"
                aria-selected={isSelected}
                className="menu-option task-tag-selector-option"
                data-selected={isSelected ? "true" : "false"}
                onClick={() => toggleTag(tag)}
                onKeyDown={optionKeyDown}
              >
                <IconTag size={13} aria-hidden="true" />
                <span>{tag}</span>
                {isSelected ? <IconCheck size={14} aria-hidden="true" className="task-tag-selector-check" /> : null}
              </button>
            );
          })}
          {canCreate ? (
            <button
              type="button"
              role="option"
              aria-selected="false"
              className="menu-option task-tag-selector-option task-tag-selector-create"
              onClick={createTag}
              onKeyDown={optionKeyDown}
            >
              <IconPlus size={13} aria-hidden="true" />
              <span>
                Create <strong>{normalizedSearch}</strong>
              </span>
            </button>
          ) : null}
          {!visibleTags.length && !canCreate ? <div className="menu-empty">No matching tags</div> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** One visible editor; inactive drafts survive until their owning card unmounts. */
export function useTaskEditorDraft(): [DraftTaskState | null, Dispatch<SetStateAction<DraftTaskState | null>>] {
  const owner = useId();
  const ownEditorAtom = useMemo(() => createTaskEditorSessionAtom(owner), [owner]);
  const { active, session } = useAtomValue(ownEditorAtom);
  const setState = useSetAtom(taskEditorAtom);
  const token = session?.token;
  const setDraft = useCallback<Dispatch<SetStateAction<DraftTaskState | null>>>(
    (update) => {
      setState((current) => {
        const previous = current.sessions.get(owner);
        // A save finishing in an old editor must not dismiss a reopened draft.
        if (update === null && previous?.token !== token) return current;
        const draft = typeof update === "function" ? update(previous?.draft ?? null) : update;
        const sessions = new Map(current.sessions);
        if (!draft) {
          sessions.delete(owner);
          return { active: current.active === owner ? null : current.active, sessions };
        }
        sessions.set(owner, {
          token: current.active === owner && previous ? previous.token : Symbol(),
          draft,
        });
        return { active: owner, sessions };
      });
    },
    [owner, setState, token],
  );
  useEffect(
    () => () => {
      setState((current) => {
        if (!current.sessions.has(owner)) return current;
        const sessions = new Map(current.sessions);
        sessions.delete(owner);
        return { active: current.active === owner ? null : current.active, sessions };
      });
    },
    [owner, setState],
  );
  return [active ? (session?.draft ?? null) : null, setDraft];
}
