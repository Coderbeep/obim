import "./TaskBoard.css";
import { IconCalendar, IconFlagFill, IconPlus, IconTag, IconX } from "@pierre/icons";
import { useCallback, useEffect, useId, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { cn } from "@renderer/shared/classNames";
import { taskBoardProjectNameKey, type TaskBoardProject } from "@renderer/shared/taskBoard";
import { useLocalDay } from "@renderer/shared/useLocalDay";
import { Badge } from "@renderer/shared/ui/badge";
import { Button } from "@renderer/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@renderer/shared/ui/card";
import { CompactToolbarSearch } from "@renderer/shared/ui/CompactToolbarSearch";
import { RecoveryState } from "@renderer/shared/ui/RecoveryState";
import { HorizontalInsertionLine } from "@renderer/shared/dnd/DropIndicator";
import { getVerticalInsertIndex } from "@renderer/shared/dnd/geometry";
import { useAppDropZone } from "@renderer/shared/dnd/useAppDropZone";
import { TaskNoteHoverWindow } from "./TaskNoteHoverWindow";
import { TaskBoardProjectRecovery, TaskBoardProjectsPopover, TaskBoardProjectTabs } from "./TaskBoardProjects";
import { TaskBoardNoteTask } from "./TaskBoardTask";
import { TaskBoardTaskEditor, useTaskEditorDraft } from "./TaskBoardTaskEditor";
import { TaskBoardFilters } from "./TaskBoardFilters";
import { TaskBoardSortSelector } from "./TaskBoardSortSelector";
import {
  clearFilterProperty,
  createDraftTaskState,
  PRIORITY_OPTIONS,
  type CreateTaskInput,
  type FilterPatch,
  type TaskBoardColumn as TaskBoardColumnModel,
  type TaskMoveIntent,
} from "./taskBoardModel";
import {
  useTaskBoard,
  useTaskBoardDnd,
  useTaskBoardPreferences,
  useTaskBoardView,
  useTaskBoardReveal,
  type TaskBoardPreferenceControls,
} from "./useTaskBoard";

export const TaskBoard = () => {
  const board = useTaskBoard();
  const root = useRef<HTMLDivElement>(null);
  const today = useLocalDay();
  const [projectsOpen, setProjectsOpen] = useState(false);
  const controls = useTaskBoardPreferences(board.preferences, board.setPreferences);
  const view = useTaskBoardView({
    preferences: board.preferences,
    setPreferences: board.setPreferences,
    hasLoaded: board.hasLoaded,
    tasks: board.allTasks,
    projects: board.projects,
    filters: controls.filters,
    sortRules: controls.sortRules,
    today,
  });
  const revealRequest = useTaskBoardReveal({
    root,
    columns: view.columns,
    filters: controls.filters,
    today,
    clearFilters: controls.clearFilters,
    revealProject: view.revealProject,
    agendaActions: { openTask: board.taskActions.openTask, refresh: board.refresh, projects: board.projects },
  });
  const updateFilters = useCallback(
    (patch: FilterPatch) => {
      view.clearRevealedProject();
      controls.updateFilters(patch);
    },
    [view.clearRevealedProject, controls.updateFilters],
  );
  const clearFilters = useCallback(() => {
    view.clearRevealedProject();
    controls.clearFilters();
  }, [view.clearRevealedProject, controls.clearFilters]);
  const applySavedFilter = useCallback(
    (saved: Parameters<typeof controls.applySavedFilter>[0]) => {
      view.clearRevealedProject();
      controls.applySavedFilter(saved);
    },
    [view.clearRevealedProject, controls.applySavedFilter],
  );
  const dnd = useTaskBoardDnd({
    allowReorder:
      controls.sortRules.length === 0 && !controls.filters.searchQuery.trim() && controls.activeRows.length === 0,
    moveTask: board.taskActions.moveTask,
    tasks: board.allTasks,
  });
  const taskCardProps = {
    isMoving: board.isMoving || board.canEditLayout === false,
    taskActions: board.taskActions,
    searchQuery: controls.filters.searchQuery,
  };
  return (
    <div
      ref={root}
      className="task-board box-border flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden rounded-none"
    >
      <TaskBoardToolbar
        hasLoaded={board.hasLoaded}
        canEditLayout={board.canEditLayout !== false}
        projectControls={{
          projects: board.projects,
          usageCountByProjectName: board.usageCountByProjectName,
          createProject: board.createProject,
          updateProject: board.updateProject,
          deleteProject: board.deleteProject,
          moveProject: board.moveProject,
        }}
        projectsOpen={projectsOpen}
        onProjectsOpenChange={setProjectsOpen}
        visibleProjects={view.visibleProjects}
        selectedProject={view.selectedProject}
        onSelectProject={view.setSelectedProject}
        onProjectRenamed={view.projectRenamed}
        availableTags={view.availableTags}
        availableYamlKeys={view.availableYamlKeys}
        loadTags={board.taskActions.loadTags}
        controls={{ ...controls, updateFilters, clearFilters, applySavedFilter }}
      />

      {board.layoutError ? (
        <div>
          <RecoveryState
            compact
            title="Board layout needs repair"
            description={board.layoutError}
            actionLabel="Reveal configuration file"
            onAction={() => void board.revealLayoutFile()}
          />
          <Button variant="outline" size="xs" className="mx-2 mb-2" onClick={() => void board.refresh()}>
            Reload layout
          </Button>
        </div>
      ) : null}
      {board.projectRecovery ? (
        <TaskBoardProjectRecovery
          recovery={board.projectRecovery}
          onOpenFile={board.openRecoveryFile}
          onRevealLayout={() => void board.revealLayoutFile()}
          onDismiss={board.dismissProjectRecovery}
        />
      ) : null}
      {board.error && !board.projectRecovery ? (
        <RecoveryState
          compact
          title="Tasks couldn't be refreshed"
          description={board.error}
          onAction={() => void board.refresh()}
        />
      ) : null}

      {!board.hasLoaded ? (
        <div
          className="flex min-h-0 flex-1 items-center justify-center text-ui-control text-muted-foreground"
          role="status"
        >
          {board.isLoading ? "Loading tasks…" : "Tasks unavailable."}
        </div>
      ) : !view.selectedProject ? (
        <div className="task-board-filter-empty">
          <strong>Create your first project</strong>
          <span>Projects keep one workflow focused at a time.</span>
          <Button type="button" variant="outline" size="xs" onClick={() => setProjectsOpen(true)}>
            Create project
          </Button>
        </div>
      ) : (
        <div className="task-board-canvas min-h-0 w-full flex-1 overflow-x-auto overflow-y-auto" data-task-board-scroll>
          <div className="task-board-columns flex min-h-full min-w-full w-max flex-row items-stretch">
            {view.columns.map((column) => (
              <div
                key={column.name.toLocaleLowerCase()}
                className="task-board-column-slot box-border flex min-h-0 flex-col self-stretch"
              >
                <TaskBoardColumn
                  addTask={board.taskActions.createTask}
                  canCreate
                  column={column}
                  revealRequest={
                    revealRequest &&
                    taskBoardProjectNameKey(revealRequest.task.project || "") ===
                      taskBoardProjectNameKey(view.selectedProject) &&
                    (revealRequest.task.status === "done" ? "done" : (revealRequest.task.stage ?? "backlog")) ===
                      column.stage
                      ? revealRequest
                      : null
                  }
                  dnd={dnd}
                  draggable={board.canEditLayout !== false}
                  taskCardProps={taskCardProps}
                  onOpenManageProjects={() => setProjectsOpen(true)}
                  projects={board.projects}
                  project={view.selectedProject}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {board.hoverTask ? (
        <TaskNoteHoverWindow key={board.hoverTask.task.path} request={board.hoverTask} onClose={board.closeHoverTask} />
      ) : null}
    </div>
  );
};

export interface TaskBoardProjectControls {
  projects: TaskBoardProject[];
  usageCountByProjectName: Record<string, number>;
  createProject(input: { name: string; colorId?: string }): Promise<TaskBoardProject | null>;
  updateProject(name: string, patch: Partial<TaskBoardProject>): Promise<boolean>;
  deleteProject(name: string): Promise<boolean>;
  moveProject(name: string, targetName: string): Promise<boolean>;
}

const TaskBoardToolbar = ({
  hasLoaded,
  canEditLayout,
  projectControls,
  projectsOpen,
  onProjectsOpenChange,
  visibleProjects,
  selectedProject,
  onSelectProject,
  onProjectRenamed,
  availableTags,
  availableYamlKeys,
  loadTags,
  controls,
}: {
  hasLoaded: boolean;
  canEditLayout: boolean;
  projectControls: TaskBoardProjectControls;
  projectsOpen: boolean;
  onProjectsOpenChange(open: boolean): void;
  visibleProjects: TaskBoardProject[];
  selectedProject: string;
  onSelectProject(name: string): void;
  onProjectRenamed(from: string, to: string): void;
  availableTags: readonly string[];
  availableYamlKeys: readonly string[];
  loadTags(currentTags?: readonly string[]): Promise<string[]>;
  controls: TaskBoardPreferenceControls;
}) => (
  <div className="task-board-commandbar" data-task-board-view="board" role="toolbar" aria-label="Task board controls">
    <div className="task-board-toolbar-start">
      <TaskBoardProjectsPopover
        open={projectsOpen}
        onOpenChange={onProjectsOpenChange}
        disabled={!hasLoaded || !canEditLayout}
        projects={projectControls.projects}
        usageCountByProjectName={projectControls.usageCountByProjectName}
        onCreateProject={projectControls.createProject}
        onUpdateProject={projectControls.updateProject}
        onDeleteProject={projectControls.deleteProject}
        onProjectRenamed={onProjectRenamed}
      />
      <TaskBoardProjectTabs
        projects={visibleProjects}
        selectedProject={selectedProject}
        canReorder={hasLoaded && canEditLayout}
        onMove={projectControls.moveProject}
        onSelect={onSelectProject}
      />
    </div>
    <div className="task-board-filterbar" aria-label="Task filters">
      {hasLoaded ? <TaskBoardSortSelector rules={controls.sortRules} onChange={controls.setSortRules} /> : null}
      <TaskBoardFilters
        availableYamlKeys={availableYamlKeys}
        availableTags={availableTags}
        loadTags={loadTags}
        onApplySavedFilter={controls.applySavedFilter}
        onChange={controls.updateFilters}
        onClear={controls.clearFilters}
        onDeleteSavedFilter={controls.deleteSavedFilter}
        onSaveCurrentFilter={controls.saveCurrentFilter}
        filters={controls.filters}
        savedFilters={controls.savedFilters}
        activeSavedFilterId={controls.activeSavedFilterId}
      />
      {controls.activeRows
        .filter((row) => row.chipLabel)
        .map((row) => (
          <Button
            key={row.id}
            type="button"
            variant="badgelike"
            size="xs"
            className="task-board-active-filter"
            onClick={() => controls.updateFilters(clearFilterProperty(row.property))}
            aria-label={row.removeLabel}
          >
            {row.property === "priority" ? (
              <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                {PRIORITY_OPTIONS.filter(({ value }) => controls.filters.priorityFilters.includes(value)).map(
                  (option) => (
                    <IconFlagFill
                      key={option.value}
                      className={`task-board-filter-priority-flag ${option.flagClassName}`}
                    />
                  ),
                )}
              </span>
            ) : row.property === "due" ? (
              <IconCalendar size={13} aria-hidden="true" />
            ) : (
              <IconTag size={13} aria-hidden="true" />
            )}
            {row.chipLabel}
            <IconX size={12} aria-hidden="true" />
          </Button>
        ))}
    </div>
    <CompactToolbarSearch
      label="Search tasks"
      clearLabel="Clear task search"
      placeholder="Type to search..."
      value={controls.filters.searchQuery}
      onValueChange={(searchQuery) => controls.updateFilters({ searchQuery })}
    />
  </div>
);

type TaskBoardDnd = ReturnType<typeof useTaskBoardDnd>;
type TaskCardProps = Omit<
  ComponentProps<typeof TaskBoardNoteTask>,
  "item" | "dnd" | "projects" | "subtaskProgress" | "onAddSubtask"
>;

/** One fixed workflow stage within the selected project. */
export const TaskBoardColumn = ({
  taskCardProps,
  addTask,
  column,
  canCreate = true,
  dnd,
  draggable = true,
  onOpenManageProjects,
  projects,
  revealRequest,
  project,
}: {
  revealRequest?: { id: string } | null;
  taskCardProps: TaskCardProps;
  addTask: (task: CreateTaskInput, intent?: TaskMoveIntent) => Promise<boolean>;
  column: TaskBoardColumnModel;
  canCreate?: boolean;
  dnd: TaskBoardDnd;
  draggable?: boolean;
  onOpenManageProjects: () => void;
  projects: TaskBoardProject[];
  project: string;
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useTaskEditorDraft();
  const [isFloatingMenuOpen, setIsFloatingMenuOpen] = useState(false);
  const draftTop = useRef<HTMLDivElement>(null);
  const contentId = useId();

  useEffect(() => {
    if (revealRequest) setCollapsed(false);
  }, [revealRequest]);
  useEffect(() => {
    if (draft) draftTop.current?.scrollIntoView?.({ block: "nearest" });
  }, [draft]);

  const remainingTasks = column.tasks.filter((task) => task.path !== dnd.draggedPath);
  const dropTaskCount = remainingTasks.length;
  const zone = useAppDropZone<HTMLDivElement, { path: string; intent: TaskMoveIntent }>({
    accepts: (entity) => entity.kind === "task",
    resolve: (event, entity) => {
      if (!draggable || event.defaultPrevented || entity.kind !== "task") return null;
      const taskRows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-task-drop-row]")].filter(
        (row) => row.dataset.taskDropRow !== entity.id,
      );
      const nextRow = taskRows[getVerticalInsertIndex(taskRows, event.clientY)];
      const beforePath = nextRow?.dataset.taskDropRow ?? null;
      const index = beforePath === null ? dropTaskCount : remainingTasks.findIndex((task) => task.path === beforePath);
      const intent = dnd.resolveIntent(entity.id, { kind: "board", project, stage: column.stage, index, beforePath });
      if (!intent) return null;
      const label = intent.projectOnly
        ? `Move to ${intent.stage ?? intent.project ?? "project"}`
        : `${intent.stage ?? intent.project ?? "project"}, position ${intent.index + 1}`;
      return {
        key: `task:${intent.project ?? ""}:${intent.stage ?? ""}:${intent.index}:${intent.beforePath ?? ""}`,
        valid: true,
        label,
        operation: { path: entity.id, intent },
      };
    },
    onDrop: (_event, { path, intent }) => {
      void dnd.commit(path, intent);
    },
  });
  const dropTarget = zone.intent?.intent;
  const targetIsColumn = dropTarget?.kind === "board";
  const preview = (position: number) => targetIsColumn && dropTarget?.index === position && !dropTarget.projectOnly;
  const placeholder = (position: number) => (preview(position) ? <HorizontalInsertionLine className="-top-1" /> : null);
  const openDraft = () => {
    if (!canCreate) return;
    setDraft((current) => current ?? createDraftTaskState(project, column.stage));
  };

  return (
    <Card
      data-task-board-column={column.stage}
      data-collapsed={collapsed ? "true" : undefined}
      data-project-task-drop={targetIsColumn && dropTarget?.projectOnly ? "true" : undefined}
      data-task-board-drop-zone
      className="task-board-column group/column-card relative flex min-h-[260px] flex-col gap-0 rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-0 shadow-none"
      style={{ "--taskboard-column-accent": column.accent } as CSSProperties}
      {...zone.handlers}
    >
      <CardHeader className="task-board-column-header flex h-9 flex-row items-center justify-between space-y-0 border-b border-[var(--border-subtle)] pl-4 pr-2 py-0">
        <CardTitle className="min-w-0 text-ui-section font-bold text-foreground">
          <button
            type="button"
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${column.name}`}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            onClick={() => setCollapsed((current) => !current)}
            className="task-board-column-toggle flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md bg-transparent text-left"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full [background:var(--taskboard-column-accent)]"
            />
            <span className="task-board-column-name truncate">{column.name}</span>
            <Badge
              variant="compact"
              className="task-board-column-count flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-transparent px-0 py-0 font-mono text-ui-meta font-semibold tabular-nums text-muted-foreground"
            >
              {column.tasks.length}
            </Badge>
          </button>
        </CardTitle>
        <div
          className={cn(
            "flex items-center gap-0.5 opacity-60 transition-opacity duration-200 ease-out group-hover/column-card:opacity-100 group-focus-within/column-card:opacity-100",
            isFloatingMenuOpen && "translate-y-0 opacity-100 pointer-events-auto",
          )}
        >
          {canCreate ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="task-board-header-add rounded-[var(--radius-control)]"
              data-empty={column.tasks.length === 0 ? "true" : undefined}
              onClick={openDraft}
              aria-label={`Add task to ${column.name}`}
              title="Add task"
            >
              <IconPlus size={16} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent
        id={contentId}
        hidden={collapsed}
        className={cn("min-h-0 flex-1 flex-col p-0", collapsed ? "hidden" : "flex")}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5" data-task-board-column-scroll>
          <div ref={draftTop} className="relative rounded-[var(--radius-control)]">
            {canCreate && draft ? (
              <TaskBoardTaskEditor
                draft={draft}
                loadTags={taskCardProps.taskActions.loadTags}
                onFloatingMenuOpenChange={setIsFloatingMenuOpen}
                onOpenManageProjects={onOpenManageProjects}
                onSubmit={(input) => addTask(input, { kind: "board", project, stage: column.stage, index: 0 })}
                projects={projects}
                setDraft={setDraft}
              />
            ) : null}
            {column.tasks.length === 0 && draft ? placeholder(0) : null}
          </div>
          {column.tasks.length === 0 && !draft ? (
            <div className="relative flex min-h-28 flex-col items-center justify-center gap-2 rounded-[var(--radius-control)] bg-transparent px-4 text-center text-ui-control text-muted-foreground/80">
              {placeholder(0)}
              <span>No tasks in {column.name.toLocaleLowerCase()}</span>
              {draggable ? <span className="text-ui-meta text-muted-foreground/70">or drop tasks here</span> : null}
            </div>
          ) : null}
          {column.tasks.map((task) => {
            const beforeIndex = remainingTasks.findIndex((entry) => entry.path === task.path);
            return (
              <div key={task.path} className="relative task-board-hierarchy-row" data-task-drop-row={task.path}>
                {placeholder(beforeIndex)}
                <TaskBoardNoteTask
                  {...taskCardProps}
                  dnd={draggable ? dnd : undefined}
                  item={task}
                  projects={projects}
                />
              </div>
            );
          })}
          {column.tasks.length > 0 ? <div className="relative">{placeholder(dropTaskCount)}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
};
