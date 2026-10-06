import { useMemo } from "react";
import { useStore } from "jotai";
import { taskBoardProjectMutationCountAtom } from "@renderer/store/taskBoardProjectMutationStore";
import {
  DEFAULT_TASK_BOARD_PROJECT_COLOR,
  TASK_BOARD_PROJECT_COLOR_OPTIONS,
  normalizeTaskBoardProjectName,
  taskBoardProjectNameKey,
  type TaskBoardConfig,
} from "@renderer/shared/taskBoard";
import { deriveTaskBoardProjects } from "./taskBoardModel";
import type { TaskBoardTask, TaskFileMutation } from "./taskBoardModel";
import { parseTaskMarkdown, setTaskBoardProject } from "./taskBoardFiles";
import type { useTaskBoardWorkspace } from "./taskBoardWorkspace";
type ProjectPatch = {
  colorId?: string;
  hidden?: boolean;
  name?: string;
};
export const useTaskBoardProjects = ({
  workspace,
  mutateTaskFile,
  notifyError,
}: {
  workspace: ReturnType<typeof useTaskBoardWorkspace>;
  mutateTaskFile: TaskFileMutation;
  notifyError: (title: string, message: string) => void;
}) => {
  const store = useStore();
  const { configuredProjects, discoveredTasks, persistConfig, refresh } = workspace;
  const projects = useMemo(
    () => deriveTaskBoardProjects(discoveredTasks, configuredProjects),
    [discoveredTasks, configuredProjects],
  );
  const editable = () => workspace.getSnapshot().hasLoaded && workspace.getSnapshot().configStatus !== "invalid";
  const find = (name: string) =>
    projects.find((project) => taskBoardProjectNameKey(project.name) === taskBoardProjectNameKey(name));
  const createProject = async ({
    name,
    colorId = DEFAULT_TASK_BOARD_PROJECT_COLOR,
  }: {
    name: string;
    colorId?: string;
  }) => {
    if (!editable()) return null;
    name = normalizeTaskBoardProjectName(name);
    const existing = find(name);
    if (
      !name ||
      configuredProjects.some((project) => taskBoardProjectNameKey(project.name) === taskBoardProjectNameKey(name)) ||
      !TASK_BOARD_PROJECT_COLOR_OPTIONS.some((color) => color.id === colorId)
    )
      return null;
    const project = { name: existing?.name ?? name, colorId };
    if (
      !(await persistConfig((config) =>
        config.projects.some((item) => taskBoardProjectNameKey(item.name) === taskBoardProjectNameKey(name))
          ? config
          : { ...config, projects: [...config.projects, project] },
      ))
    ) {
      notifyError("Project creation failed", "The Task Board configuration could not be saved.");
      return null;
    }
    return project;
  };
  /** Retain the accepted operation and retry only files that did not finish (or just its manifest). */
  const changeAssignments = async (
    from: string,
    to: string | undefined,
    finalize: (config: TaskBoardConfig) => TaskBoardConfig,
  ) => {
    if (workspace.getSnapshot().projectRecovery || store.get(taskBoardProjectMutationCountAtom)) {
      notifyError(
        "Project operation pending",
        "Finish or dismiss the current project operation before starting another.",
      );
      return false;
    }
    const kind = to === undefined ? "deletion" : "rename";
    const title = `Project ${kind} incomplete`;
    const initial = workspace
      .discoverTaskFiles()
      .filter((task) => taskBoardProjectNameKey(task.project ?? "") === taskBoardProjectNameKey(from));
    const perform = async (pending: TaskBoardTask[]): Promise<boolean> => {
      const recovery = workspace.getSnapshot().projectRecovery;
      if (recovery?.busy) return false;
      if (recovery) workspace.setProjectRecovery({ ...recovery, busy: true });
      store.set(taskBoardProjectMutationCountAtom, (count) => count + 1);
      try {
        const failures = (
          await Promise.all(
            pending.map(async (task) => {
              try {
                const result = await mutateTaskFile(
                  task,
                  (source) => {
                    const current = parseTaskMarkdown(source, task);
                    return current && taskBoardProjectNameKey(current.project ?? "") === taskBoardProjectNameKey(from)
                      ? setTaskBoardProject(source, to)
                      : source;
                  },
                  { refreshAfter: false },
                );
                return result.success ? null : task;
              } catch {
                return task;
              }
            }),
          )
        ).filter((task): task is TaskBoardTask => task !== null);
        const layoutPending = failures.length === 0 && !(await persistConfig(finalize));
        if (failures.length || layoutPending) {
          workspace.setProjectRecovery({
            title,
            files: failures,
            layoutPending,
            busy: false,
            retry: () => perform(failures),
          });
          await refresh();
          notifyError(
            title,
            failures.length
              ? `Could not update: ${failures.map(({ path }) => path).join(", ")}`
              : "Task files were updated, but the board layout still needs to be saved.",
          );
          return false;
        }
        workspace.setProjectRecovery(null);
        workspace.setError(null);
        return true;
      } finally {
        store.set(taskBoardProjectMutationCountAtom, (count) => count - 1);
      }
    };
    return perform(initial);
  };
  const updateProject = async (name: string, patch: ProjectPatch) => {
    if (!editable()) return false;
    const current = find(name);
    if (!current) return false;
    const nextName = patch.name === undefined ? current.name : normalizeTaskBoardProjectName(patch.name);
    const nextColor = patch.colorId ?? current.colorId;
    if (
      !nextName ||
      !TASK_BOARD_PROJECT_COLOR_OPTIONS.some(({ id }) => id === nextColor) ||
      projects.some(
        (entry) =>
          taskBoardProjectNameKey(entry.name) !== taskBoardProjectNameKey(current.name) &&
          taskBoardProjectNameKey(entry.name) === taskBoardProjectNameKey(nextName),
      )
    )
      return false;
    const finalize = (config: TaskBoardConfig) => {
      const key = taskBoardProjectNameKey(current.name);
      const latest = config.projects.find((entry) => taskBoardProjectNameKey(entry.name) === key);
      const destination = config.projects.find(
        (entry) =>
          taskBoardProjectNameKey(entry.name) !== key &&
          taskBoardProjectNameKey(entry.name) === taskBoardProjectNameKey(nextName),
      );
      if (destination && !latest) return config; // The user already repaired the manifest.
      if (destination || (!latest && configuredProjects.some((entry) => taskBoardProjectNameKey(entry.name) === key)))
        throw new Error("Project changed while editing.");
      const next = { ...(latest ?? { name: current.name, colorId: current.colorId }), ...patch, name: nextName };
      if (!next.hidden) delete next.hidden;
      return {
        ...config,
        projects: latest
          ? config.projects.map((entry) => (taskBoardProjectNameKey(entry.name) === key ? next : entry))
          : [...config.projects, next],
      };
    };
    if (nextName !== current.name) return changeAssignments(current.name, nextName, finalize);
    const success = await persistConfig(finalize);
    if (!success) notifyError("Project update failed", "The board layout could not be saved.");
    return success;
  };
  const deleteProject = async (name: string) => {
    if (!editable()) return false;
    const current = find(name);
    if (!current) return false;
    return changeAssignments(current.name, undefined, (config) => ({
      ...config,
      projects: config.projects.filter(
        (entry) => taskBoardProjectNameKey(entry.name) !== taskBoardProjectNameKey(current.name),
      ),
    }));
  };
  const moveProject = async (name: string, targetName: string) => {
    if (!editable() || taskBoardProjectNameKey(name) === taskBoardProjectNameKey(targetName)) return false;
    const success = await persistConfig((config) => {
      const next = [...config.projects];
      const from = next.findIndex((entry) => taskBoardProjectNameKey(entry.name) === taskBoardProjectNameKey(name));
      const to = next.findIndex((entry) => taskBoardProjectNameKey(entry.name) === taskBoardProjectNameKey(targetName));
      if (from < 0 || to < 0) throw new Error("Project changed while moving.");
      const [project] = next.splice(from, 1);
      next.splice(to, 0, project);
      return { ...config, projects: next };
    });
    if (!success) notifyError("Project reorder failed", "The board order could not be saved.");
    return success;
  };
  return { createProject, updateProject, deleteProject, moveProject };
};
