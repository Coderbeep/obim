import {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react";
import { useAtom, useStore, useAtomValue, useSetAtom } from "jotai";
import { getWorkspacePath, getTaskBoardOpenMode } from "@renderer/config";
import { NotificationLevel, addNotificationAtom } from "@renderer/store/NotificationsStore";
import { taskBoardPreferencesAtom, type TaskBoardPreferences } from "@renderer/store/taskBoardPreferencesStore";
import {
  TASK_BOARD_CONFIG_RELATIVE_PATH,
  taskBoardProjectNameKey,
  type TaskBoardProject,
} from "@renderer/shared/taskBoard";
import { joinFsPath } from "@shared/pathUtils";
import {
  deriveTaskBoardProjects,
  activeTaskFilterRows,
  applyTaskFilter,
  emptyTaskFilters,
  saveTaskFilter,
  selectTaskFilters,
  deriveTaskBoardWorkflowColumns,
  filterTaskBoardTasks,
  sortTaskBoardTasks,
  type TaskActions,
  type TaskBoardTask,
  type ActiveFilterRow,
  type FilterPatch,
  type TaskFilters,
  type TaskBoardSortRule,
  type TaskBoardColumn,
  type TaskMoveIntent,
} from "./taskBoardModel";
import { useTaskBoardWorkspace } from "./taskBoardWorkspace";
import { useTaskBoardProjects } from "./useTaskBoardProjects";
import { useTaskFileMutation, useTaskActions } from "./useTaskActions";
import { useFileOpen } from "@renderer/features/files/fileActions";
import { activePaneIdAtom, workspacePanesAtom, editorSubtaskRequestAtom } from "@renderer/store/editorPaneStore";
import type { TaskNoteSubtaskTarget } from "@renderer/shared/taskNoteSubtasks";
import type { WorkspaceSessionTaskSavedFilter, WorkspaceSessionTaskSortRule } from "@shared/workspace-session";
import { NOTE_TYPE_FIELD_KEY } from "@shared/note-type-templates";
import {
  taskBoardAgendaActionsAtom,
  taskBoardRevealRequestAtom,
  type TaskBoardAgendaActions,
} from "@renderer/store/taskBoardInspectorStore";
import { TASK_BOARD_TASK_DRAG_DATA_MIME, type TaskBoardTaskDragData } from "@shared/drag-data";

export const useTaskBoard = () => {
  const store = useStore();
  const [preferences, setPreferences] = useAtom(taskBoardPreferencesAtom);
  const workspace = useTaskBoardWorkspace();
  const navigation = useTaskNavigation();
  const notifyError = useCallback(
    (title: string, message: string) => {
      workspace.setError(message);
      store.set(addNotificationAtom, {
        id: crypto.randomUUID(),
        level: NotificationLevel.ERROR,
        title,
        message,
        timestamp: Date.now(),
      });
    },
    [store, workspace.setError],
  );
  const { mutateTaskFile } = useTaskFileMutation({
    publishTaskSource: workspace.publishTaskSource,
    refresh: workspace.refresh,
  });
  const projects = useMemo<TaskBoardProject[]>(
    () => deriveTaskBoardProjects(workspace.orderedTasks, workspace.configuredProjects),
    [workspace.configuredProjects, workspace.orderedTasks],
  );
  const { actions, allTasks, isMoving } = useTaskActions({ workspace, projects, mutateTaskFile, notifyError });
  const taskActions = { ...actions, openTask: navigation.openTask } satisfies TaskActions;
  const projectActions = useTaskBoardProjects({ workspace, mutateTaskFile, notifyError });
  const usageCountByProjectName = useMemo(
    () =>
      Object.fromEntries(
        projects.map((project) => [
          project.name,
          workspace.orderedTasks.filter(
            (task) => taskBoardProjectNameKey(task.project ?? "") === taskBoardProjectNameKey(project.name),
          ).length,
        ]),
      ),
    [workspace.orderedTasks, projects],
  );
  return {
    ...projectActions,
    taskActions,
    projectRecovery: workspace.projectRecovery,
    dismissProjectRecovery: () => {
      workspace.setProjectRecovery(null);
      workspace.setError(null);
    },
    openRecoveryFile: (file: import("@shared/file-item").FileItem) => {
      void navigation.openFile(file);
    },
    layoutError:
      workspace.configStatus === "invalid"
        ? `${TASK_BOARD_CONFIG_RELATIVE_PATH} is invalid. Repair its JSON to restore projects and ordering. Task files remain available.`
        : null,
    canEditLayout: workspace.configStatus !== "invalid",
    revealLayoutFile: () =>
      window.api.revealInSystemFileManager(joinFsPath(getWorkspacePath(), TASK_BOARD_CONFIG_RELATIVE_PATH)),
    error: workspace.error,
    hasLoaded: workspace.hasLoaded,
    isLoading: workspace.isLoading,
    isMoving,
    hoverTask: navigation.hoverTask,
    closeHoverTask: navigation.closeHoverTask,
    preferences,
    setPreferences,
    refresh: workspace.refresh,
    allTasks,
    orderedTasks: workspace.orderedTasks,
    projects,
    usageCountByProjectName,
  };
};

const useTaskNavigation = () => {
  const store = useStore();
  const { open } = useFileOpen();
  const [hoverTask, setHoverTask] = useState<{ task: TaskBoardTask; target?: TaskNoteSubtaskTarget } | null>(null);
  const openTask = useCallback(
    async (task: TaskBoardTask, target?: TaskNoteSubtaskTarget) => {
      if ((await getTaskBoardOpenMode()) === "hover") {
        setHoverTask({ task, target });
        return;
      }
      const opened = await open(task);
      if (opened && target)
        store.set(editorSubtaskRequestAtom, {
          filePath: task.path,
          paneId: store.get(activePaneIdAtom) || store.get(workspacePanesAtom)[0]?.id || "",
          target,
        });
    },
    [open, store],
  );
  return { openTask, openFile: open, hoverTask, closeHoverTask: () => setHoverTask(null) };
};

export type SetTaskBoardPreferences = Dispatch<SetStateAction<TaskBoardPreferences>>;

export interface TaskBoardPreferenceControls {
  filters: TaskFilters;
  activeRows: readonly ActiveFilterRow[];
  savedFilters: readonly WorkspaceSessionTaskSavedFilter[];
  activeSavedFilterId: string | null;
  sortRules: WorkspaceSessionTaskSortRule[];
  updateFilters(patch: FilterPatch): void;
  clearFilters(): void;
  saveCurrentFilter(name: string): void;
  applySavedFilter(saved: WorkspaceSessionTaskSavedFilter): void;
  deleteSavedFilter(id: string): void;
  setSortRules(rules: WorkspaceSessionTaskSortRule[]): void;
}

export const useTaskBoardPreferences = (
  preferences: TaskBoardPreferences,
  setPreferences: SetTaskBoardPreferences,
): TaskBoardPreferenceControls => {
  const filters = useMemo(
    () => selectTaskFilters(preferences),
    [
      preferences.dueDateEndFilter,
      preferences.dueDateFilter,
      preferences.dueFilter,
      preferences.priorityFilters,
      preferences.searchQuery,
      preferences.tagFilters,
      preferences.yamlPropertyFilter,
    ],
  );
  const activeRows = useMemo(() => activeTaskFilterRows(filters), [filters]);
  const updateFilters = useCallback(
    (patch: FilterPatch) => {
      setPreferences((current) => ({ ...current, ...patch, activeSavedFilterId: null }));
    },
    [setPreferences],
  );
  const clearFilters = useCallback(() => {
    setPreferences((current) => ({ ...current, ...emptyTaskFilters(), activeSavedFilterId: null }));
  }, [setPreferences]);
  const saveCurrentFilter = useCallback(
    (name: string) => {
      const id = crypto.randomUUID();
      setPreferences((current) => saveTaskFilter(current, id, name));
    },
    [setPreferences],
  );
  const applySavedFilter = useCallback(
    (saved: WorkspaceSessionTaskSavedFilter) => {
      setPreferences((current) => applyTaskFilter(current, saved));
    },
    [setPreferences],
  );
  const deleteSavedFilter = useCallback(
    (id: string) => {
      setPreferences((current) => ({
        ...current,
        activeSavedFilterId: current.activeSavedFilterId === id ? null : current.activeSavedFilterId,
        savedFilters: current.savedFilters.filter((saved) => saved.id !== id),
      }));
    },
    [setPreferences],
  );
  const setSortRules = useCallback(
    (sortRules: WorkspaceSessionTaskSortRule[]) => {
      setPreferences((current) => ({ ...current, sortRules }));
    },
    [setPreferences],
  );
  return {
    savedFilters: preferences.savedFilters,
    activeSavedFilterId: preferences.activeSavedFilterId,
    sortRules: preferences.sortRules,
    filters,
    activeRows,
    updateFilters,
    clearFilters,
    saveCurrentFilter,
    applySavedFilter,
    deleteSavedFilter,
    setSortRules,
  };
};

export const useTaskBoardView = ({
  preferences,
  setPreferences,
  hasLoaded,
  tasks,
  projects,
  filters,
  sortRules,
  today,
}: {
  preferences: TaskBoardPreferences;
  setPreferences: SetTaskBoardPreferences;
  hasLoaded: boolean;
  tasks: readonly TaskBoardTask[];
  projects: TaskBoardProject[];
  filters: TaskFilters;
  sortRules: readonly TaskBoardSortRule[];
  today: Date;
}) => {
  const selectedProject = preferences.selectedProject;
  const setSelectedProject = useCallback<Dispatch<SetStateAction<string>>>(
    (next) => {
      setPreferences((current) => {
        const selectedProject = typeof next === "function" ? next(current.selectedProject) : next;
        return selectedProject === current.selectedProject ? current : { ...current, selectedProject };
      });
    },
    [setPreferences],
  );
  const [revealedProject, setRevealedProject] = useState<string | null>(null);
  const visibleProjects = useMemo(
    () =>
      projects.filter(
        ({ hidden, name }) =>
          !hidden || (revealedProject && taskBoardProjectNameKey(name) === taskBoardProjectNameKey(revealedProject)),
      ),
    [projects, revealedProject],
  );
  useEffect(() => {
    if (!hasLoaded) return;
    if (visibleProjects.some(({ name }) => taskBoardProjectNameKey(name) === taskBoardProjectNameKey(selectedProject)))
      return;
    const fallback = visibleProjects[0]?.name ?? "";
    if (selectedProject !== fallback) setSelectedProject(fallback);
  }, [hasLoaded, selectedProject, setSelectedProject, visibleProjects]);
  const filteredTasks = useMemo(() => filterTaskBoardTasks(tasks, filters, today), [tasks, filters, today]);
  const columns = useMemo(
    () =>
      deriveTaskBoardWorkflowColumns(filteredTasks, selectedProject).map((column) => ({
        ...column,
        tasks: sortTaskBoardTasks(column.tasks, sortRules),
      })),
    [filteredTasks, selectedProject, sortRules],
  );
  const availableTags = useMemo(
    () => [...new Set(tasks.flatMap((task) => task.tags ?? []))].sort((left, right) => left.localeCompare(right)),
    [tasks],
  );
  const availableYamlKeys = useMemo(
    () =>
      [...new Set(tasks.flatMap((task) => task.frontmatterKeys ?? []))]
        .filter((key) => key !== NOTE_TYPE_FIELD_KEY)
        .sort((left, right) => left.localeCompare(right)),
    [tasks],
  );
  const revealProject = useCallback(
    (name: string) => {
      setRevealedProject(name);
      setSelectedProject(name);
    },
    [setSelectedProject],
  );
  const clearRevealedProject = useCallback(() => setRevealedProject(null), []);
  const projectRenamed = useCallback(
    (from: string, to: string) => {
      setSelectedProject((current) =>
        taskBoardProjectNameKey(current) === taskBoardProjectNameKey(from) ? to : current,
      );
    },
    [setSelectedProject],
  );
  return {
    columns,
    visibleProjects,
    selectedProject,
    setSelectedProject,
    revealProject,
    clearRevealedProject,
    projectRenamed,
    availableTags,
    availableYamlKeys,
  };
};

export const useTaskBoardReveal = ({
  root,
  columns,
  filters,
  today,
  clearFilters,
  revealProject,
  agendaActions,
}: {
  root: RefObject<HTMLDivElement | null>;
  columns: readonly TaskBoardColumn[];
  filters: TaskFilters;
  today: Date;
  clearFilters(): void;
  revealProject(name: string): void;
  agendaActions: TaskBoardAgendaActions;
}) => {
  const publishAgendaActions = useSetAtom(taskBoardAgendaActionsAtom);
  const revealRequest = useAtomValue(taskBoardRevealRequestAtom);
  const clearRevealRequest = useSetAtom(taskBoardRevealRequestAtom);
  const filteredRequestId = useRef<string | null>(null);
  const projectRequestId = useRef<string | null>(null);
  const { openTask, refresh, projects } = agendaActions;
  useEffect(() => {
    publishAgendaActions({ openTask, refresh, projects });
    return () => publishAgendaActions(null);
  }, [publishAgendaActions, openTask, refresh, projects]);
  useEffect(() => () => clearRevealRequest(null), [clearRevealRequest]);
  useEffect(() => {
    if (!revealRequest || filteredRequestId.current === revealRequest.id) return;
    filteredRequestId.current = revealRequest.id;
    if (!filterTaskBoardTasks([revealRequest.task], filters, today).length) clearFilters();
  }, [revealRequest, filters, today, clearFilters]);
  useEffect(() => {
    if (!revealRequest || projectRequestId.current === revealRequest.id) return;
    const project = projects.find(
      ({ name }) => taskBoardProjectNameKey(name) === taskBoardProjectNameKey(revealRequest.task.project ?? ""),
    );
    if (!project) return;
    projectRequestId.current = revealRequest.id;
    revealProject(project.name);
  }, [revealRequest, projects, revealProject]);
  useEffect(() => {
    if (!revealRequest) return;
    let card: HTMLElement | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      card = [...(root.current?.querySelectorAll<HTMLElement>("[data-task-path]") ?? [])].find(
        (item) => item.dataset.taskPath === revealRequest.task.path,
      );
      if (!card) return;
      card.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
      card.focus({ preventScroll: true });
      card.dataset.agendaHighlighted = "true";
      timeout = setTimeout(() => card?.removeAttribute("data-agenda-highlighted"), 3000);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
      card?.removeAttribute("data-agenda-highlighted");
    };
  }, [revealRequest, columns, root]);
  return revealRequest;
};

/** Owns the native task payload and the Task Board's domain move policy. */
export const useTaskBoardDnd = ({
  moveTask,
  tasks,
  allowReorder = true,
}: {
  allowReorder?: boolean;
  moveTask: (task: TaskBoardTask, intent: TaskMoveIntent) => Promise<boolean>;
  tasks: readonly TaskBoardTask[];
}) => {
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const clear = useCallback(() => setDraggedPath(null), []);
  const startDrag = useCallback((event: React.DragEvent<HTMLElement>, task: TaskBoardTask) => {
    const data: TaskBoardTaskDragData = { path: task.path };
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TASK_BOARD_TASK_DRAG_DATA_MIME, JSON.stringify(data));
    setDraggedPath(task.path);
  }, []);
  const resolveIntent = useCallback(
    (path: string, intent: TaskMoveIntent): TaskMoveIntent | null => {
      const task = tasks.find((entry) => entry.path === path);
      if (!task) return null;
      if (allowReorder) return intent;
      const destinationStage = intent.stage ?? (task.status === "done" ? "done" : (task.stage ?? "backlog"));
      if (
        (task.project ?? "").toLocaleLowerCase() === (intent.project ?? "").toLocaleLowerCase() &&
        (task.status === "done" ? "done" : (task.stage ?? "backlog")) === destinationStage
      )
        return null;
      return { ...intent, stage: destinationStage, projectOnly: true, index: 0 };
    },
    [allowReorder, tasks],
  );
  const commit = useCallback(
    async (path: string, intent: TaskMoveIntent) => {
      const task = tasks.find((entry) => entry.path === path);
      if (!task) return false;
      clear();
      return moveTask(task, intent);
    },
    [clear, moveTask, tasks],
  );
  return { draggedPath, startDrag, clear, resolveIntent, commit };
};
