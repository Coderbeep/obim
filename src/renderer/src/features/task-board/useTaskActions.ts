import { useCallback, useMemo, useRef, useState } from "react";
import { useStore } from "jotai";
import { readTextFile, saveFile } from "@renderer/features/files/workspaceFileService";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { settleExternalFileEditAtom, stageExternalFileEditAtom } from "@renderer/store/fileLifecycleStore";
import type { WorkspaceFileVersion } from "@shared/file-item";
import {
  applyTaskOrder,
  moveTaskInSequence,
  replaceTaskOrderSlots,
  taskOrderFromTasks,
  taskOrderPath,
  filterTaskBoardTasks,
  getTaskNameValidationMessage,
  type TaskBoardTask,
  type TaskFileMutation,
  type TaskMutationResult,
  type TaskActions,
  type TaskNoteSubtaskChange,
  type TaskMoveIntent,
  type CreateTaskInput,
  type UpdateTaskMetadataInput,
} from "./taskBoardModel";
import { useFileCreate, useFileOpen, useFileRemove } from "@renderer/features/files/fileActions";
import { NotificationLevel, addNotificationAtom } from "@renderer/store/NotificationsStore";
import { taskBoardPreferencesAtom } from "@renderer/store/taskBoardPreferencesStore";
import {
  loadCurrentWorkspacePropertySuggestions,
  readIndexedDocuments,
} from "@renderer/features/workspace/workspaceIndexOverlay";
import { getTaskCreationDirectory, getWorkspacePath } from "@renderer/config";
import { taskBoardProjectNameKey, type TaskBoardProject, type TaskBoardConfig } from "@renderer/shared/taskBoard";
import { joinFsPath } from "@shared/pathUtils";
import { TASK_NOTE_FIELD_KEYS } from "@shared/note-type-templates";
import {
  changeTaskNoteSubtasks,
  createTaskMarkdown,
  parseTaskMarkdown,
  repairTaskMetadata,
  updateTaskMetadata,
  taskFilenameForTitle,
  changeTaskWorkflow,
  type TaskWorkflowChange,
} from "./taskBoardFiles";

export const useTaskFileMutation = ({
  publishTaskSource,
  refresh,
}: {
  publishTaskSource: (task: TaskBoardTask, source: string, modifiedAtMs?: number) => void;
  refresh: () => Promise<void>;
}) => {
  const store = useStore();
  const readTaskSource = useCallback(
    async (
      task: TaskBoardTask,
    ): Promise<
      TaskMutationResult & {
        source?: string;
        version?: WorkspaceFileVersion;
      }
    > => {
      const buffer = store.get(fileBuffersByPathAtom)[task.path];
      if (buffer) return { success: true, source: buffer.editorText, version: buffer.version };
      const result = await readTextFile(task.path);
      if (!result.success) return result;
      const currentBuffer = store.get(fileBuffersByPathAtom)[task.path];
      return {
        success: true,
        source: currentBuffer?.editorText ?? result.content,
        version: currentBuffer?.version ?? result.version,
      };
    },
    [store],
  );
  const mutateTaskFile: TaskFileMutation = useCallback(
    async (
      task: TaskBoardTask,
      transform: (source: string) => string,
      {
        refreshAfter = true,
      }: {
        refreshAfter?: boolean;
      } = {},
    ): Promise<TaskMutationResult> => {
      const loaded = await readTaskSource(task);
      if (!loaded.success || loaded.source === undefined) {
        if (refreshAfter) await refresh();
        return { success: false, error: loaded.error };
      }
      const source = loaded.source;
      let nextSource: string;
      try {
        nextSource = transform(source);
      } catch (cause) {
        return { success: false, error: cause instanceof Error ? cause.message : String(cause) };
      }
      if (nextSource === source) {
        publishTaskSource(task, source);
        return { success: true };
      }
      const hasBuffer = Boolean(store.get(fileBuffersByPathAtom)[task.path]);
      const staged = hasBuffer
        ? store.set(stageExternalFileEditAtom, {
            path: task.path,
            expectedText: source,
            nextText: nextSource,
          })
        : false;
      if (hasBuffer && !staged) {
        if (refreshAfter) await refresh();
        return { success: false, error: `Open content changed before ${task.path} could be updated.` };
      }
      let saveSucceeded = false;
      let saveError: string | undefined;
      let savedVersion: WorkspaceFileVersion | undefined;
      try {
        const result = await saveFile(task.path, nextSource, loaded.version);
        saveSucceeded = result.success;
        if (result.success) savedVersion = result.version;
        else saveError = result.error;
      } catch (cause) {
        saveError = cause instanceof Error ? cause.message : String(cause);
      }
      if (staged) {
        store.set(settleExternalFileEditAtom, {
          path: task.path,
          expectedText: source,
          nextText: nextSource,
          success: saveSucceeded,
          ...(savedVersion ? { version: savedVersion } : {}),
        });
      }
      if (!saveSucceeded) {
        if (refreshAfter) await refresh();
        return { success: false, error: saveError ?? `Could not save ${task.path}` };
      }
      publishTaskSource(task, nextSource, Date.now());
      return { success: true };
    },
    [publishTaskSource, readTaskSource, refresh, store],
  );
  return { mutateTaskFile };
};

export interface TaskActionWorkspace {
  configStatus: "valid" | "invalid" | "missing";
  taskOrder: readonly string[];
  orderedTasks: TaskBoardTask[];
  discoverTaskFiles: () => TaskBoardTask[];
  getSnapshot: () => { pinnedTasks: readonly string[] };
  persistConfig: (
    transform: (config: TaskBoardConfig) => TaskBoardConfig | Promise<TaskBoardConfig>,
  ) => Promise<boolean>;
  publishTaskSource: (task: TaskBoardTask, source: string, modifiedAtMs?: number) => void;
}

/** Rebase one move on the latest persisted order, preserving unknown and closed slots. */
const orderAfterMove = async (
  config: TaskBoardConfig,
  available: TaskBoardTask[],
  task: TaskBoardTask,
  intent: TaskMoveIntent,
) => {
  const byPath = new Map(available.map((entry) => [entry.path, entry]));
  const known = new Set(available.map(taskOrderPath));
  const unknown = config.taskOrder.filter((path) => !known.has(path));
  if (unknown.length) {
    const documents = await readIndexedDocuments(unknown.map((path) => joinFsPath(getWorkspacePath(), path)));
    for (const { file, source } of documents) {
      const parsed = parseTaskMarkdown(source, file);
      if (parsed) byPath.set(parsed.path, parsed);
    }
  }
  byPath.set(task.path, task);
  const ordered = applyTaskOrder([...byPath.values()], config.taskOrder);
  const active = ordered.filter((entry) => entry.status !== "cancelled");
  const knownPaths = taskOrderFromTasks(ordered);
  const persisted = new Set(config.taskOrder);
  const fullOrder = [
    ...knownPaths.filter((path) => !persisted.has(path)),
    ...config.taskOrder.filter((path) => knownPaths.includes(path)),
  ];
  return replaceTaskOrderSlots(
    fullOrder,
    new Set(active.map(taskOrderPath)),
    taskOrderFromTasks(moveTaskInSequence(active, task, intent, ordered)),
  );
};

export const useTaskActions = ({
  workspace,
  projects,
  mutateTaskFile,
  notifyError,
}: {
  workspace: TaskActionWorkspace;
  projects: readonly TaskBoardProject[];
  mutateTaskFile: TaskFileMutation;
  notifyError: (title: string, message: string) => void;
}) => {
  const store = useStore();
  const { createMarkdownFile } = useFileCreate();
  const { open } = useFileOpen();
  const { remove } = useFileRemove();
  const { configStatus, taskOrder, orderedTasks, discoverTaskFiles, persistConfig, publishTaskSource } = workspace;
  const [pendingMove, setPendingMove] = useState<{
    intent: TaskMoveIntent;
    path: string;
  } | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const moving = useRef(false);
  const activeTasks = useMemo(() => {
    const visible = orderedTasks.filter((task) => task.status !== "cancelled");
    if (!pendingMove) return visible;
    const task = visible.find(({ path }) => path === pendingMove.path);
    return task ? moveTaskInSequence(visible, task, pendingMove.intent, orderedTasks) : visible;
  }, [orderedTasks, pendingMove]);
  const loadTags = useCallback(
    (currentTags: readonly string[] = []) =>
      loadCurrentWorkspacePropertySuggestions({
        currentValues: currentTags,
        fileBuffersByPath: store.get(fileBuffersByPathAtom),
        query: { key: TASK_NOTE_FIELD_KEYS.tags },
      }),
    [store],
  );
  const createTask = useCallback(
    async (
      input: CreateTaskInput,
      intent: TaskMoveIntent = { kind: "board", project: input.project, stage: input.stage, index: 0 },
    ) => {
      const taskName = input.taskName.trim();
      const titleError = getTaskNameValidationMessage(taskName);
      if (titleError) {
        notifyError("Task creation failed", titleError);
        return false;
      }
      const requestedProjectKey = taskBoardProjectNameKey(input.project ?? "");
      const matchingProject = requestedProjectKey
        ? projects.find((project) => taskBoardProjectNameKey(project.name) === requestedProjectKey)
        : projects[0];
      if (!matchingProject) {
        notifyError("Task creation failed", "Choose a project before adding a task.");
        return false;
      }
      const stage = intent.stage ?? input.stage ?? "backlog";
      const content = createTaskMarkdown({ ...input, project: matchingProject.name, stage });
      const creationDirectory = await getTaskCreationDirectory();
      const file = await createMarkdownFile(
        joinFsPath(getWorkspacePath(), creationDirectory),
        taskFilenameForTitle(taskName),
        content,
        false,
        { numberOnCollision: true },
      );
      if (!file || file.isDirectory) {
        notifyError("Task creation failed", "The task file could not be created.");
        return false;
      }
      const task = parseTaskMarkdown(content, file);
      if (!task) return true;
      publishTaskSource(task, content, Date.now());
      const currentPreferences = store.get(taskBoardPreferencesAtom);
      const inView = filterTaskBoardTasks([task], currentPreferences).length > 0 && !matchingProject.hidden;
      if (!inView)
        store.set(addNotificationAtom, {
          id: crypto.randomUUID(),
          level: NotificationLevel.INFO,
          title: "Task created outside this view",
          message: `${task.title} was saved${matchingProject.hidden ? " in a hidden project" : ", but does not match the current filters"}.`,
          action: {
            label: "Open task",
            onClick: () => {
              void open(task);
            },
          },
          timeout: 12000,
          timestamp: Date.now(),
        });
      if (configStatus === "invalid") return true;
      const normalizedIntent: TaskMoveIntent = {
        ...intent,
        kind: "board",
        project: matchingProject.name,
        stage,
        index: intent.index,
      };
      if (
        !(await persistConfig(async (config) => ({
          ...config,
          taskOrder: await orderAfterMove(config, discoverTaskFiles(), task, normalizedIntent),
        })))
      ) {
        notifyError("Task layout not saved", "The task was created, but its manual position could not be saved.");
      }
      return true;
    },
    [
      projects,
      configStatus,
      createMarkdownFile,
      discoverTaskFiles,
      notifyError,
      persistConfig,
      publishTaskSource,
      store,
      open,
    ],
  );
  const writeWorkflow = useCallback(
    async (task: TaskBoardTask, change: TaskWorkflowChange, title: string, intent?: TaskMoveIntent) => {
      let next: ReturnType<typeof changeTaskWorkflow> | undefined;
      const result = await mutateTaskFile(task, (source) => {
        next = changeTaskWorkflow(source, task, change);
        return next.source;
      });
      if (!result.success || !next) {
        notifyError(title, result.error ?? `Could not update ${task.path}`);
        return { success: false, changed: false };
      }
      const workflow = next;
      const placement =
        intent && change.kind === "move" && change.stage === undefined
          ? {
              ...intent,
              stage: workflow.task.status === "done" ? ("done" as const) : (workflow.task.stage ?? "backlog"),
            }
          : intent;
      const removePin = workflow.removePin && workspace.getSnapshot().pinnedTasks.includes(taskOrderPath(task));
      if (!intent && !removePin) return { success: true, changed: workflow.changed };
      const persisted = await persistConfig(async (config) => ({
        ...config,
        ...(placement
          ? { taskOrder: await orderAfterMove(config, discoverTaskFiles(), workflow.task, placement) }
          : {}),
        ...(workflow.removePin
          ? { pinnedTasks: (config.pinnedTasks ?? []).filter((path) => path !== taskOrderPath(task)) }
          : {}),
      }));
      if (!persisted)
        notifyError(
          intent ? "Task position not saved" : "Pin removal failed",
          intent
            ? workflow.changed
              ? "The task changed workflow position, but its manual position and pin settings could not be saved."
              : "The task position could not be saved."
            : "The task changed status, but its pin could not be removed from board settings.",
        );
      return { success: intent ? persisted : true, changed: workflow.changed };
    },
    [mutateTaskFile, workspace, notifyError, persistConfig, discoverTaskFiles],
  );
  const changeLifecycle = useCallback(
    async (task: TaskBoardTask, status: "open" | "done" | "cancelled", title: string) => {
      const result = await writeWorkflow(task, { kind: "lifecycle", status }, title);
      return result.success && result.changed;
    },
    [writeWorkflow],
  );
  const closeTask = useCallback(
    async (task: TaskBoardTask, status: "done" | "cancelled") => {
      const completed = status === "done";
      const changed = await changeLifecycle(
        task,
        status,
        completed ? "Task completion failed" : "Task cancellation failed",
      );
      if (changed)
        store.set(addNotificationAtom, {
          id: crypto.randomUUID(),
          level: NotificationLevel.INFO,
          title: completed ? "Task completed" : "Task cancelled",
          message: task.title,
          action: {
            label: "Undo",
            onClick: async () => {
              await changeLifecycle(task, "open", "Undo failed");
            },
          },
          timeout: 8000,
          timestamp: Date.now(),
        });
      return changed;
    },
    [changeLifecycle, store],
  );
  const completeTask = useCallback((task: TaskBoardTask) => closeTask(task, "done"), [closeTask]);
  const cancelTask = useCallback((task: TaskBoardTask) => closeTask(task, "cancelled"), [closeTask]);
  const reopenTask = useCallback(
    (task: TaskBoardTask) => changeLifecycle(task, "open", "Task reopen failed"),
    [changeLifecycle],
  );
  const repairMetadata = useCallback(
    async (task: TaskBoardTask) => {
      const result = await mutateTaskFile(task, (source) => repairTaskMetadata(source, task));
      if (!result.success) {
        notifyError("Metadata repair failed", result.error ?? `Could not repair ${task.path}`);
      } else {
        store.set(addNotificationAtom, {
          id: crypto.randomUUID(),
          level: NotificationLevel.INFO,
          title: "Task metadata repaired",
          message: task.title,
          timestamp: Date.now(),
        });
      }
      return result.success;
    },
    [mutateTaskFile, notifyError, store],
  );
  const deleteTask = useCallback(
    async (task: TaskBoardTask) => {
      const success = await remove(task);
      if (!success) notifyError("Task trash failed", `Could not move ${task.path} to Trash`);
      return success;
    },
    [notifyError, remove],
  );
  const moveTask = useCallback(
    async (task: TaskBoardTask, intent: TaskMoveIntent) => {
      if (configStatus === "invalid" || moving.current || task.status === "cancelled" || !intent.project) return false;
      const destinationProject = intent.project;
      const target = projects.find(
        (project) => taskBoardProjectNameKey(project.name) === taskBoardProjectNameKey(destinationProject),
      );
      if (!target) return false;
      const targetStage = intent.stage ?? (task.status === "done" ? "done" : (task.stage ?? "backlog"));
      const normalizedIntent: TaskMoveIntent = {
        ...intent,
        kind: "board",
        project: target.name,
        stage: targetStage,
        index: intent.index,
      };
      const projectChanged =
        taskBoardProjectNameKey(task.project ?? "") !== taskBoardProjectNameKey(normalizedIntent.project ?? "");
      const stageChanged = (task.status === "done" ? "done" : (task.stage ?? "backlog")) !== normalizedIntent.stage;
      const columnTasks = activeTasks.filter(
        (entry) =>
          taskBoardProjectNameKey(entry.project ?? "") === taskBoardProjectNameKey(target.name) &&
          (targetStage === "done"
            ? entry.status === "done"
            : entry.status === "open" && (entry.stage ?? "backlog") === targetStage),
      );
      const sameColumnPosition =
        !projectChanged &&
        !stageChanged &&
        intent.beforePath === undefined &&
        columnTasks.findIndex(({ path }) => path === task.path) ===
          Math.min(Math.max(intent.index, 0), Math.max(columnTasks.length - 1, 0));
      const nextTasks = moveTaskInSequence(activeTasks, task, normalizedIntent, orderedTasks);
      const previousOrder = taskOrderFromTasks(orderedTasks);
      const activePaths = new Set(activeTasks.map(taskOrderPath));
      const nextOrder = replaceTaskOrderSlots(previousOrder, activePaths, taskOrderFromTasks(nextTasks));
      const orderChanged =
        !sameColumnPosition &&
        (projectChanged ||
          stageChanged ||
          !taskOrder.every((path) => previousOrder.includes(path)) ||
          !previousOrder.every((path, index) => path === nextOrder[index]));
      moving.current = true;
      setIsMoving(true);
      if (!intent.projectOnly && orderChanged) setPendingMove({ intent: normalizedIntent, path: task.path });
      try {
        const result = await writeWorkflow(
          task,
          { kind: "move", project: target.name, stage: intent.stage },
          "Task move failed",
          intent.projectOnly || !orderChanged ? undefined : normalizedIntent,
        );
        return result.success;
      } finally {
        setPendingMove(null);
        moving.current = false;
        setIsMoving(false);
      }
    },
    [
      activeTasks,
      projects,
      configStatus,
      discoverTaskFiles,
      mutateTaskFile,
      notifyError,
      orderedTasks,
      persistConfig,
      writeWorkflow,
      taskOrder,
    ],
  );
  const pinTask = useCallback(
    async (task: TaskBoardTask, pinned: boolean) => {
      if (pinned && task.status !== "open") return false;
      const success = await persistConfig((config) => ({
        ...config,
        pinnedTasks: pinned
          ? [...new Set([...(config.pinnedTasks ?? []), taskOrderPath(task)])]
          : (config.pinnedTasks ?? []).filter((path) => path !== taskOrderPath(task)),
      }));
      if (!success) notifyError("Pin not saved", "Could not save the task board settings. Try again.");
      return success;
    },
    [persistConfig, notifyError],
  );
  const updateTask = useCallback(
    async (task: TaskBoardTask, input: UpdateTaskMetadataInput) => {
      const original = input.original ?? {
        taskName: task.title,
        dueDate: task.dueDate,
        priority: task.priority,
        project: task.project,
        tags: task.tags,
      };
      const result = await mutateTaskFile(task, (source) =>
        updateTaskMetadata(source, { ...input, original }, task.filename),
      );
      if (!result.success) notifyError("Task update failed", result.error ?? `Could not update ${task.path}`);
      if (!result.success) return false;
      return true;
    },
    [mutateTaskFile, notifyError],
  );
  const updateSubtasks = useCallback(
    async (task: TaskBoardTask, change: TaskNoteSubtaskChange) => {
      const result = await mutateTaskFile(task, (source) => changeTaskNoteSubtasks(source, change));
      if (!result.success)
        notifyError("Subtask update failed", result.error ?? "Could not save the checkbox in the note.");
      return result.success;
    },
    [mutateTaskFile, notifyError],
  );

  const actions: Omit<TaskActions, "openTask"> = {
    createTask,
    completeTask,
    cancelTask,
    reopenTask,
    repairMetadata,
    deleteTask,
    moveTask,
    pinTask,
    updateTask,
    updateSubtasks,
    loadTags,
  };
  return { actions, allTasks: activeTasks, isMoving };
};
