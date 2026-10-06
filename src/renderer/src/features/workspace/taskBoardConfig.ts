import { workspaceMutationApi } from "@renderer/features/files/workspaceMutationApi";
import {
  TASK_BOARD_CONFIG_RELATIVE_PATH,
  parseTaskBoardConfigSource,
  remapTaskOrderPaths,
  removeTaskOrderPaths,
  type TaskBoardConfig,
} from "@renderer/shared/taskBoard";
import { getRelativePathFromPath } from "@shared/pathUtils";

export type TaskBoardConfigReadResult =
  { status: "missing" } | { status: "invalid" } | { status: "valid"; config: TaskBoardConfig };

type TaskBoardConfigUpdateResult = { config?: TaskBoardConfig; success: boolean };

let configQueue = Promise.resolve();
const listeners = new Set<(result: TaskBoardConfigReadResult, workspace: string) => void>();
export const subscribeTaskBoardConfig = (listener: (result: TaskBoardConfigReadResult, workspace: string) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publishConfig = (result: TaskBoardConfigReadResult) => {
  const workspace = window.config.getMainDirectoryPathSync();
  for (const listener of listeners) listener(result, workspace);
};

const serializeConfigAccess = <T>(operation: () => Promise<T>) => {
  const result = configQueue.then(operation);
  configQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const readTaskBoardConfigFile = async (): Promise<TaskBoardConfigReadResult> => {
  if (!(await window.api.doesFileExist(TASK_BOARD_CONFIG_RELATIVE_PATH))) return { status: "missing" };
  return parseTaskBoardConfigSource(await window.api.openFile(TASK_BOARD_CONFIG_RELATIVE_PATH));
};

export const readTaskBoardConfig = () => serializeConfigAccess(readTaskBoardConfigFile);

export const updateTaskBoardConfig = (
  transform: (config: TaskBoardConfig) => TaskBoardConfig | Promise<TaskBoardConfig>,
  createIfMissing = false,
) =>
  serializeConfigAccess(async (): Promise<TaskBoardConfigUpdateResult> => {
    try {
      const loaded = await readTaskBoardConfigFile();
      if (loaded.status === "invalid") {
        publishConfig(loaded);
        return { success: false };
      }
      if (loaded.status === "missing" && !createIfMissing) return { success: true };
      const next = await transform(loaded.status === "valid" ? loaded.config : { projects: [], taskOrder: [] });
      const success = await workspaceMutationApi.upsertFile(
        TASK_BOARD_CONFIG_RELATIVE_PATH,
        `${JSON.stringify(next, null, 2)}\n`,
      );
      if (success) publishConfig({ status: "valid", config: next });
      return success ? { config: next, success: true } : { success: false };
    } catch {
      return { success: false };
    }
  });

const relativeWorkspacePath = (path: string) =>
  getRelativePathFromPath(path, window.config.getMainDirectoryPathSync().replaceAll("\\", "/")).replaceAll("\\", "/");

export const remapTaskBoardOrderAfterFileMoves = (
  moves: readonly { fromPath: string; toPath: string; directory: boolean }[],
) =>
  updateTaskBoardConfig((config) => ({
    ...config,
    ...(config.pinnedTasks
      ? {
          pinnedTasks: moves.reduce(
            (paths, move) =>
              remapTaskOrderPaths(
                paths,
                relativeWorkspacePath(move.fromPath),
                relativeWorkspacePath(move.toPath),
                move.directory,
              ),
            config.pinnedTasks,
          ),
        }
      : {}),
    taskOrder: moves.reduce(
      (taskOrder, move) =>
        remapTaskOrderPaths(
          taskOrder,
          relativeWorkspacePath(move.fromPath),
          relativeWorkspacePath(move.toPath),
          move.directory,
        ),
      config.taskOrder,
    ),
  })).then(({ success }) => success);

export const remapTaskBoardOrderAfterFileMove = (fromPath: string, toPath: string, directory: boolean) =>
  remapTaskBoardOrderAfterFileMoves([{ fromPath, toPath, directory }]);

export const pruneTaskBoardOrderAfterTrashes = (items: readonly { path: string; directory: boolean }[]) =>
  updateTaskBoardConfig((config) => ({
    ...config,
    ...(config.pinnedTasks
      ? {
          pinnedTasks: items.reduce(
            (paths, item) => removeTaskOrderPaths(paths, relativeWorkspacePath(item.path), item.directory),
            config.pinnedTasks,
          ),
        }
      : {}),
    taskOrder: items.reduce(
      (taskOrder, item) => removeTaskOrderPaths(taskOrder, relativeWorkspacePath(item.path), item.directory),
      config.taskOrder,
    ),
  })).then(({ success }) => success);
