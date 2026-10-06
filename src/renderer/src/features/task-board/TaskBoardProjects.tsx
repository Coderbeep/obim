import "./TaskBoard.css";
import { IconEye, IconEyeSlash, IconPlus, IconSearch, IconTrash } from "@pierre/icons";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@renderer/shared/ui/button";
import { ColorSwatches } from "@renderer/shared/ui/color-swatches";
import { Input } from "@renderer/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/shared/ui/popover";
import {
  DEFAULT_TASK_BOARD_PROJECT_COLOR,
  TASK_BOARD_PROJECT_COLOR_OPTIONS,
  normalizeTaskBoardProjectName,
  taskBoardProjectNameKey,
  type TaskBoardProject,
} from "@renderer/shared/taskBoard";
import { getTaskBoardProjectColorTheme } from "./taskBoardModel";
import { VerticalInsertionLine } from "@renderer/shared/dnd/DropIndicator";
import { getHorizontalInsertIndex } from "@renderer/shared/dnd/geometry";
import { useAppDropZone } from "@renderer/shared/dnd/useAppDropZone";
import { useAppDraggable } from "@renderer/shared/dnd/useAppDraggable";
import { TASK_BOARD_PROJECT_DRAG_DATA_MIME } from "@shared/drag-data";
import { type FileItem } from "@shared/file-item";
import { type ProjectRecovery } from "./taskBoardWorkspace";

const ProjectManagerRow = ({
  project,
  projects,
  usageCount,
  isBusy,
  onToggleVisibility,
  onUpdate,
  onDelete,
  onRenamed,
}: {
  project: TaskBoardProject;
  projects: TaskBoardProject[];
  usageCount: number;
  isBusy: boolean;
  onToggleVisibility: () => Promise<boolean>;
  onUpdate: (patch: Partial<TaskBoardProject>) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onRenamed: (nextName: string) => void;
}) => {
  const [draftName, setDraftName] = useState(project.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const renamePending = useRef(false);
  const cancelRename = useRef(false);
  useEffect(() => {
    setDraftName(project.name);
  }, [project.name]);

  useEffect(() => {
    if (!isRenaming) return;
    const frame = requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [isRenaming]);

  const saveName = async () => {
    if (renamePending.current || cancelRename.current) {
      cancelRename.current = false;
      return;
    }
    const name = normalizeTaskBoardProjectName(draftName);
    if (
      !name ||
      projects.some(
        (candidate) =>
          taskBoardProjectNameKey(candidate.name) !== taskBoardProjectNameKey(project.name) &&
          taskBoardProjectNameKey(candidate.name) === taskBoardProjectNameKey(name),
      )
    ) {
      setMessage("Choose a unique project name.");
      return;
    }
    if (name === project.name) {
      setIsRenaming(false);
      return;
    }
    setMessage(null);
    renamePending.current = true;
    try {
      if (await onUpdate({ name })) {
        onRenamed(name);
        setIsRenaming(false);
      } else setMessage("Could not rename this project.");
    } finally {
      renamePending.current = false;
    }
  };

  const updateColor = async (colorId: string) => {
    if (colorId === project.colorId) {
      setColorOpen(false);
      return;
    }
    setMessage(null);
    if (await onUpdate({ colorId })) setColorOpen(false);
    else setMessage("Could not change this project color.");
  };

  return (
    <div className="task-board-project-manager-row">
      <div className="task-board-project-manager-summary">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={isBusy}
          aria-label={`${project.hidden ? "Show" : "Hide"} ${project.name} project`}
          aria-pressed={!project.hidden}
          onClick={() => void onToggleVisibility()}
        >
          {project.hidden ? <IconEyeSlash size={14} aria-hidden="true" /> : <IconEye size={14} aria-hidden="true" />}
        </Button>
        <div className="task-board-project-manager-identity">
          <Popover open={colorOpen} onOpenChange={(next) => !isBusy && setColorOpen(next)}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="task-board-projects-color"
                disabled={isBusy}
                aria-label={`Change color for ${project.name}`}
                title="Change color"
                style={{ backgroundColor: getTaskBoardProjectColorTheme(project.colorId).accent }}
              />
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="right"
              sideOffset={6}
              size="auto"
              className="task-board-project-color-popover"
              aria-label={`Color for ${project.name}`}
            >
              <ColorSwatches
                label={`Color for ${project.name}`}
                options={TASK_BOARD_PROJECT_COLOR_OPTIONS.map((color) => ({
                  id: color.id,
                  label: `Use ${color.label} for ${project.name}`,
                  title: color.label,
                  color: color.accent,
                }))}
                value={project.colorId}
                disabled={isBusy}
                onChange={(color) => void updateColor(color)}
              />
            </PopoverContent>
          </Popover>
          {isRenaming ? (
            <Input
              ref={nameRef}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelRename.current = true;
                  setDraftName(project.name);
                  setIsRenaming(false);
                }
              }}
              disabled={isBusy}
              aria-label={`Project name for ${project.name}`}
              className="task-board-project-name-input"
            />
          ) : (
            <button
              type="button"
              className="task-board-projects-name"
              disabled={isBusy}
              aria-label={`Rename ${project.name} project`}
              title="Rename project"
              onClick={() => {
                setDraftName(project.name);
                setMessage(null);
                setConfirmDelete(false);
                setIsRenaming(true);
              }}
            >
              {project.name}
            </button>
          )}
          <span className="task-board-projects-count" aria-label={`${usageCount} tasks`}>
            {usageCount}
          </span>
        </div>
        <Popover
          open={confirmDelete}
          onOpenChange={(next) => {
            if (isBusy) return;
            setConfirmDelete(next);
            if (next) {
              setIsRenaming(false);
              setMessage(null);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost-destructive"
              size="icon-sm"
              disabled={isBusy}
              aria-label={`Delete ${project.name} project`}
            >
              <IconTrash size={14} aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="bottom"
            sideOffset={6}
            className="task-board-project-delete-popover"
            aria-label={`Delete ${project.name} project`}
          >
            <strong>Delete “{project.name}”?</strong>
            <p className="task-board-project-delete-confirmation">
              {usageCount
                ? `${usageCount} ${usageCount === 1 ? "task" : "tasks"} will lose their project assignment.`
                : "This project is empty."}
            </p>
            <div className="task-board-project-delete-actions">
              <Button type="button" variant="ghost" size="xs" disabled={isBusy} onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                disabled={isBusy}
                onClick={async () => {
                  setMessage(null);
                  if (!(await onDelete())) setMessage("Could not delete this project.");
                }}
              >
                Delete
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {message ? (
        <p role="alert" className="task-board-project-message">
          {message}
        </p>
      ) : null}
    </div>
  );
};

export const TaskBoardProjectsPopover = ({
  open,
  onOpenChange,
  disabled,
  projects,
  usageCountByProjectName,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onProjectRenamed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  projects: TaskBoardProject[];
  usageCountByProjectName: Record<string, number>;
  onCreateProject: (input: { name: string; colorId?: string }) => Promise<TaskBoardProject | null>;
  onUpdateProject: (name: string, patch: Partial<TaskBoardProject>) => Promise<boolean>;
  onDeleteProject: (name: string) => Promise<boolean>;
  onProjectRenamed?: (from: string, to: string) => void;
}) => {
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const pending = useRef(false);
  const normalizedSearchQuery = normalizeTaskBoardProjectName(searchQuery);
  const query = normalizedSearchQuery.toLocaleLowerCase();
  const filteredProjects = query
    ? projects.filter((project) => project.name.toLocaleLowerCase().includes(query))
    : projects;
  const hasDuplicateSearchProject = projects.some(
    (project) => taskBoardProjectNameKey(project.name) === taskBoardProjectNameKey(normalizedSearchQuery),
  );
  const canCreateFromSearch = Boolean(normalizedSearchQuery) && !hasDuplicateSearchProject;
  const invalidCreateMessage =
    !canCreateFromSearch && normalizedSearchQuery ? `Project "${normalizedSearchQuery}" already exists.` : null;
  const run = async (operation: () => Promise<boolean>) => {
    if (pending.current) return false;
    pending.current = true;
    setIsBusy(true);
    try {
      return await operation();
    } finally {
      pending.current = false;
      setIsBusy(false);
    }
  };
  const handleCreate = () =>
    run(async () => {
      if (!canCreateFromSearch) return false;
      const created = await onCreateProject({ name: normalizedSearchQuery, colorId: DEFAULT_TASK_BOARD_PROJECT_COLOR });
      if (created) setSearchQuery("");
      return Boolean(created);
    });
  const handleToggleVisibility = (project: TaskBoardProject) =>
    run(() => onUpdateProject(project.name, { hidden: !project.hidden }));
  const handleUpdate = (name: string, patch: Partial<TaskBoardProject>) => run(() => onUpdateProject(name, patch));
  const handleDelete = (name: string) => run(() => onDeleteProject(name));
  const runAndReport = async (operation: () => Promise<boolean>) => {
    setError(false);
    try {
      const success = await operation();
      setError(!success);
      return success;
    } catch {
      setError(true);
      return false;
    }
  };
  const runWithInlineFeedback = async (operation: () => Promise<boolean>) => {
    try {
      return await operation();
    } catch {
      return false;
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setSearchQuery("");
          setError(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label="Manage projects" title="Manage projects">
          <IconPlus size={16} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        size="auto"
        padding="none"
        className="task-board-projects-popover"
        aria-label="Projects"
      >
        <div className="menu-header">
          <strong>Projects</strong>
        </div>
        <form
          className="menu-search task-board-projects-search"
          onSubmit={(event) => {
            event.preventDefault();
            void runAndReport(handleCreate);
          }}
        >
          <div className="task-board-projects-search-field">
            <IconSearch size={14} aria-hidden="true" />
            <Input
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              readOnly={isBusy}
              aria-label="Search or create projects"
              placeholder="Find or add a project…"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            size="icon-sm"
            className="task-board-projects-add"
            disabled={!canCreateFromSearch || isBusy}
            aria-label="Add project"
          >
            <IconPlus />
          </Button>
        </form>
        {invalidCreateMessage ? <p className="task-board-projects-message">{invalidCreateMessage}</p> : null}
        <div className="menu-list task-board-projects-list" aria-label="Manage projects">
          {filteredProjects.map((project) => (
            <ProjectManagerRow
              key={project.name}
              project={project}
              projects={projects}
              usageCount={usageCountByProjectName[project.name] ?? 0}
              isBusy={isBusy}
              onToggleVisibility={() => runAndReport(() => handleToggleVisibility(project))}
              onUpdate={(patch) => runWithInlineFeedback(() => handleUpdate(project.name, patch))}
              onDelete={() => runWithInlineFeedback(() => handleDelete(project.name))}
              onRenamed={(nextName) => onProjectRenamed?.(project.name, nextName)}
            />
          ))}
          {!filteredProjects.length ? (
            <p className="task-board-projects-message">
              {projects.length ? "No matching projects." : "Add your first project above."}
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="task-board-projects-error">
            Could not save project changes. Try again.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};

const TaskBoardProjectTab = ({
  project,
  projects,
  index,
  dragInsertIndex,
  selected,
  canReorder,
  onDragFinish,
  onSelect,
}: {
  project: TaskBoardProject;
  projects: TaskBoardProject[];
  index: number;
  dragInsertIndex: number | null;
  selected: boolean;
  canReorder: boolean;
  onDragFinish: () => void;
  onSelect: () => void;
}) => {
  const dragProps = useAppDraggable<HTMLButtonElement>({
    enabled: canReorder,
    entity: { kind: "task-project", id: project.name },
    preview: { text: project.name, subtext: "Move project" },
    onCancel: onDragFinish,
    onDragEnd: onDragFinish,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(TASK_BOARD_PROJECT_DRAG_DATA_MIME, project.name);
    },
  });
  return (
    <div className="task-board-project-tab-slot" data-task-board-project-tab data-project-name={project.name}>
      <VerticalInsertionLine side="before" active={dragInsertIndex === index} />
      {index === projects.length - 1 ? (
        <VerticalInsertionLine side="after" active={dragInsertIndex === projects.length} />
      ) : null}
      <button
        {...dragProps}
        type="button"
        className="task-board-project-tab"
        style={
          {
            "--task-board-project-color": getTaskBoardProjectColorTheme(project.colorId).accent,
          } as CSSProperties
        }
        aria-pressed={selected}
        data-app-drag-handle
        onClick={onSelect}
      >
        <span>{project.name}</span>
      </button>
    </div>
  );
};

export const TaskBoardProjectTabs = ({
  projects,
  selectedProject,
  canReorder,
  onMove,
  onSelect,
}: {
  projects: TaskBoardProject[];
  selectedProject: string;
  canReorder: boolean;
  onMove: (name: string, targetName: string) => Promise<boolean>;
  onSelect: (name: string) => void;
}) => {
  const zone = useAppDropZone<HTMLDivElement, { source: string; insertionIndex: number }>({
    accepts: (entity) => entity.kind === "task-project",
    resolve: (event, entity) => {
      if (!canReorder) return null;
      if (entity.kind !== "task-project") return null;
      const source = entity.id;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-task-board-project-tab]")];
      const index = getHorizontalInsertIndex(items, event.clientX);
      const reference = projects[Math.min(index, projects.length - 1)];
      if (!source || !reference) return null;
      const side = index === projects.length ? "after" : "before";
      return {
        key: `task-project-tab:${reference.name}:${side}`,
        valid: true,
        label: `Move ${source} ${side} ${reference.name}`,
        operation: { source, insertionIndex: index },
      };
    },
    onDrop: (_event, { source, insertionIndex }) => {
      const sourceIndex = projects.findIndex(
        ({ name }) => taskBoardProjectNameKey(name) === taskBoardProjectNameKey(source),
      );
      if (!source || sourceIndex < 0) return;
      const targetIndex = insertionIndex > sourceIndex ? insertionIndex - 1 : insertionIndex;
      const target = projects[targetIndex];
      if (target && targetIndex !== sourceIndex) void onMove(source, target.name);
    },
  });

  return (
    <div className="task-board-project-tabs" role="group" aria-label="Projects" {...zone.handlers}>
      {projects.map((project, index) => (
        <TaskBoardProjectTab
          key={project.name.toLocaleLowerCase()}
          project={project}
          projects={projects}
          index={index}
          dragInsertIndex={zone.intent?.insertionIndex ?? null}
          selected={taskBoardProjectNameKey(project.name) === taskBoardProjectNameKey(selectedProject)}
          canReorder={canReorder}
          onDragFinish={zone.clearHover}
          onSelect={() => onSelect(project.name)}
        />
      ))}
    </div>
  );
};

export const TaskBoardProjectRecovery = ({
  recovery,
  onOpenFile,
  onRevealLayout,
  onDismiss,
}: {
  recovery: ProjectRecovery;
  onOpenFile: (file: FileItem) => void;
  onRevealLayout: () => void;
  onDismiss: () => void;
}) => (
  <section
    role="alert"
    aria-label={recovery.title}
    className="m-2 shrink-0 rounded-[var(--radius-card)] border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] p-3 text-ui-control"
  >
    <strong>{recovery.title}</strong>
    <p className="mt-1 text-muted-foreground">
      {recovery.layoutPending
        ? "All task files were updated. Only the board layout remains to be saved."
        : "Completed changes are kept. Open the affected files to resolve the problem, then retry the remaining work."}
    </p>
    <ul className="my-2 max-h-36 overflow-y-auto">
      {recovery.files.map((file) => (
        <li key={file.path} className="flex items-center justify-between gap-3 py-1">
          <span className="min-w-0 truncate" title={file.path}>
            {file.relativePath}
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => onOpenFile(file)}
            aria-label={`Open file ${file.relativePath}`}
          >
            Open file
          </Button>
        </li>
      ))}
    </ul>
    <div className="flex gap-2">
      <Button size="xs" disabled={recovery.busy} onClick={() => void recovery.retry()}>
        {recovery.busy ? "Retrying…" : "Retry remaining"}
      </Button>
      {recovery.layoutPending ? (
        <Button variant="outline" size="xs" onClick={onRevealLayout}>
          Open layout location
        </Button>
      ) : null}
      <Button variant="ghost" size="xs" disabled={recovery.busy} onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  </section>
);
