import { useStore, type createStore } from "jotai";
import { getWorkspacePath } from "@renderer/config";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { reloadRevisionAtom } from "@renderer/store/fileExplorerStore";
import { taskBoardInspectorSnapshotAtom } from "@renderer/store/taskBoardInspectorStore";
import {
  loadCurrentWorkspaceDocuments,
  readIndexedDocuments,
} from "@renderer/features/workspace/workspaceIndexOverlay";
import {
  readTaskBoardConfig,
  subscribeTaskBoardConfig,
  updateTaskBoardConfig,
  type TaskBoardConfigReadResult,
} from "@renderer/features/workspace/taskBoardConfig";
import { pruneTaskOrderPaths, type TaskBoardConfig, type TaskBoardProject } from "@renderer/shared/taskBoard";
import type { IndexedDocument } from "@shared/workspace-index";
import { TASK_NOTE_FIELD_KEYS, TASK_NOTE_TYPE } from "@shared/note-type-templates";
import {
  parseTaskMarkdown,
  changedBufferPaths,
  getEditorBufferSnapshot,
  reconcileChangedTasks,
  discoverWorkspaceTaskFiles,
} from "./taskBoardFiles";
import { applyTaskOrder, taskOrderPath, type TaskBoardTask } from "./taskBoardModel";
import { useEffect, useSyncExternalStore } from "react";

export interface ProjectRecovery {
  title: string;
  files: TaskBoardTask[];
  layoutPending: boolean;
  busy: boolean;
  retry: () => Promise<boolean>;
}

export interface TaskBoardWorkspaceSnapshot {
  discoveredTasks: TaskBoardTask[];
  orderedTasks: TaskBoardTask[];
  configuredProjects: TaskBoardProject[];
  taskOrder: string[];
  pinnedTasks: string[];
  configStatus: TaskBoardConfigReadResult["status"];
  error: string | null;
  hasLoaded: boolean;
  isLoading: boolean;
  projectRecovery: ProjectRecovery | null;
}

const initialSnapshot = (): TaskBoardWorkspaceSnapshot => ({
  discoveredTasks: [],
  orderedTasks: [],
  configuredProjects: [],
  taskOrder: [],
  pinnedTasks: [],
  configStatus: "missing",
  error: null,
  hasLoaded: false,
  isLoading: true,
  projectRecovery: null,
});

/** One discovery/configuration owner per workspace and Jotai store. UI drafts remain local. */
export function createTaskBoardWorkspaceService(store: ReturnType<typeof createStore>, workspacePath: string) {
  let snapshot = initialSnapshot();
  let documents: IndexedDocument[] = [];
  let request = 0;
  let revision = 0;
  let consumers = 0;
  let running = false;
  const bufferVersions = new Map<string, number>();
  const listeners = new Set<() => void>();
  let unsubscribe: Array<() => void> = [];
  const currentWorkspace = () => running && getWorkspacePath() === workspacePath;
  const commit = (patch: Partial<Omit<TaskBoardWorkspaceSnapshot, "orderedTasks">>) => {
    snapshot = { ...snapshot, ...patch };
    if (patch.discoveredTasks || patch.taskOrder || patch.pinnedTasks) {
      const pinned = new Set(snapshot.pinnedTasks);
      snapshot.orderedTasks = applyTaskOrder(snapshot.discoveredTasks, snapshot.taskOrder).map((task) => ({
        ...task,
        pinned: task.status === "open" && pinned.has(taskOrderPath(task)),
      }));
    }
    store.set(taskBoardInspectorSnapshotAtom, {
      error: snapshot.error,
      hasLoaded: snapshot.hasLoaded,
      isLoading: snapshot.isLoading,
      tasks: snapshot.orderedTasks,
    });
    for (const listener of listeners) listener();
  };
  const loadConfig = (loaded: TaskBoardConfigReadResult) => {
    const config = loaded.status === "valid" ? loaded.config : { projects: [], taskOrder: [] };
    commit({
      configStatus: loaded.status,
      configuredProjects: config.projects,
      taskOrder: config.taskOrder,
      pinnedTasks: config.pinnedTasks ?? [],
    });
  };
  const persistConfig = async (transform: (config: TaskBoardConfig) => TaskBoardConfig | Promise<TaskBoardConfig>) => {
    if (!currentWorkspace()) return false;
    const result = await updateTaskBoardConfig(transform, true);
    return result.success;
  };
  const refresh = async (): Promise<void> => {
    if (!currentWorkspace()) return;
    const id = ++request;
    const startedRevision = revision;
    commit({ isLoading: true });
    try {
      const buffers = store.get(fileBuffersByPathAtom);
      const nextDocuments = await loadCurrentWorkspaceDocuments({
        fileBuffersByPath: buffers,
        workspacePath,
        query: {
          key: TASK_NOTE_FIELD_KEYS.type,
          value: { type: "string", value: TASK_NOTE_TYPE },
          includeInvalidTaskCandidates: true,
        },
      });
      const tasks = discoverWorkspaceTaskFiles({ documents: nextDocuments, fileBuffersByPath: buffers, workspacePath });
      const config = await readTaskBoardConfig();
      if (!currentWorkspace() || id !== request) return;
      if (revision !== startedRevision) {
        await refresh();
        return;
      }
      if (config.status === "valid")
        config.config.taskOrder = pruneTaskOrderPaths(config.config.taskOrder, new Set(tasks.map(taskOrderPath)));
      documents = nextDocuments;
      // Publish discovered tasks and their current layout in one snapshot.
      const layout = config.status === "valid" ? config.config : { projects: [], taskOrder: [] };
      commit({
        discoveredTasks: tasks,
        configuredProjects: layout.projects,
        taskOrder: layout.taskOrder,
        pinnedTasks: layout.pinnedTasks ?? [],
        configStatus: config.status,
        hasLoaded: true,
        error: null,
      });
    } catch (cause) {
      if (currentWorkspace() && id === request)
        commit({ error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      if (currentWorkspace() && id === request) commit({ isLoading: false });
    }
  };
  const publishTaskSource = (task: TaskBoardTask, source: string, modifiedAtMs = task.modifiedAtMs) => {
    if (!currentWorkspace()) return;
    const effective = store.get(fileBuffersByPathAtom)[task.path]?.editorText ?? source;
    const parsed = parseTaskMarkdown(effective, { ...task, modifiedAtMs });
    revision += 1;
    documents = [...documents.filter(({ file }) => file.path !== task.path), { file: task, source, modifiedAtMs }];
    commit({ discoveredTasks: reconcileChangedTasks(snapshot.discoveredTasks, [task.path], parsed ? [parsed] : []) });
  };
  const subscribeBuffers = () => {
    let previous = getEditorBufferSnapshot(store.get(fileBuffersByPathAtom));
    return store.sub(fileBuffersByPathAtom, () => {
      if (!currentWorkspace()) return;
      const buffers = store.get(fileBuffersByPathAtom);
      const next = getEditorBufferSnapshot(buffers);
      const paths = changedBufferPaths(previous, next);
      previous = next;
      if (!paths.length) return;
      revision += 1;
      for (const path of paths) bufferVersions.set(path, (bufferVersions.get(path) ?? 0) + 1);
      const open = paths.filter((path) => buffers[path]);
      if (open.length) {
        const changed = new Set(open);
        const tasks = discoverWorkspaceTaskFiles({
          documents: documents.filter(({ file }) => changed.has(file.path)),
          fileBuffersByPath: Object.fromEntries(open.map((path) => [path, buffers[path]])),
          workspacePath,
        });
        commit({ discoveredTasks: reconcileChangedTasks(snapshot.discoveredTasks, open, tasks) });
      }
      const closed = paths.filter((path) => !buffers[path]);
      if (!closed.length) return;
      const versions = new Map(closed.map((path) => [path, bufferVersions.get(path)]));
      void readIndexedDocuments(closed)
        .then((restored) => {
          if (!currentWorkspace()) return;
          const current = closed.filter((path) => versions.get(path) === bufferVersions.get(path));
          if (!current.length) return;
          const changed = new Set(current);
          const disk = restored.filter(({ file }) => changed.has(file.path));
          documents = [...documents.filter(({ file }) => !changed.has(file.path)), ...disk];
          const tasks = discoverWorkspaceTaskFiles({ documents: disk, fileBuffersByPath: {}, workspacePath });
          commit({ discoveredTasks: reconcileChangedTasks(snapshot.discoveredTasks, current, tasks) });
        })
        .catch(() => void refresh());
    });
  };
  const acquire = () => {
    consumers += 1;
    if (!running) {
      running = true;
      unsubscribe = [
        subscribeBuffers(),
        store.sub(reloadRevisionAtom, () => void refresh()),
        subscribeTaskBoardConfig((result, workspace) => {
          if (currentWorkspace() && workspace.replaceAll("\\", "/") === workspacePath) loadConfig(result);
        }),
      ];
      void refresh();
    }
    return () => {
      consumers -= 1;
      // StrictMode's immediate reacquire must not start a second discovery request.
      queueMicrotask(() => {
        if (consumers) return;
        running = false;
        request += 1;
        unsubscribe.forEach((stop) => stop());
        unsubscribe = [];
        documents = [];
        snapshot = { ...initialSnapshot(), projectRecovery: snapshot.projectRecovery };
        bufferVersions.clear();
      });
    };
  };
  return {
    acquire,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    refresh,
    persistConfig,
    publishTaskSource,
    setError: (error: string | null) => commit({ error }),
    setProjectRecovery: (projectRecovery: ProjectRecovery | null) => commit({ projectRecovery }),
    discoverTaskFiles: () =>
      discoverWorkspaceTaskFiles({ documents, fileBuffersByPath: store.get(fileBuffersByPathAtom), workspacePath }),
  };
}

type Service = ReturnType<typeof createTaskBoardWorkspaceService>;

const workspaces = new WeakMap<ReturnType<typeof useStore>, Map<string, Service>>();

export const useTaskBoardWorkspace = () => {
  const store = useStore();
  const path = getWorkspacePath();
  let services = workspaces.get(store);
  if (!services) {
    services = new Map();
    workspaces.set(store, services);
  }
  let service = services.get(path);
  if (!service) {
    service = createTaskBoardWorkspaceService(store, path);
    services.set(path, service);
  }
  useEffect(service.acquire, [service]);
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  return { ...snapshot, ...service };
};
