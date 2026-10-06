import { atom } from "jotai";

import type { TaskBoardProject, TaskBoardTaskSummary } from "@renderer/shared/taskBoard";

export interface TaskBoardInspectorSnapshot {
  error: string | null;
  hasLoaded: boolean;
  isLoading: boolean;
  tasks: readonly TaskBoardTaskSummary[];
}

export const taskBoardInspectorSnapshotAtom = atom<TaskBoardInspectorSnapshot | null>(null);

export interface TaskBoardAgendaActions {
  openTask(task: TaskBoardTaskSummary): Promise<void>;
  refresh(): Promise<void>;
  projects: readonly TaskBoardProject[];
}
export const taskBoardAgendaActionsAtom = atom<TaskBoardAgendaActions | null>(null);

export const taskBoardRevealRequestAtom = atom<{ task: TaskBoardTaskSummary; id: string } | null>(null);
