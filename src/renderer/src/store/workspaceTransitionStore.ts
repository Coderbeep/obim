import { atom, type useStore } from "jotai";

type Store = ReturnType<typeof useStore>;

export type WorkspaceTransition = {
  label: string;
  phase: "preparing" | "committing";
  cancel: () => void;
};
export const workspaceTransitionAtom = atom<WorkspaceTransition | null>(null);
export const WORKSPACE_TRANSITION_MESSAGE = "Wait for the workspace operation to finish, then try again.";

let activeTransition: WorkspaceTransitionLease | null = null;
let generation = 0;
const pendingActivity = new Set<Promise<unknown>>();

export interface WorkspaceTransitionLease {
  readonly cancelled: boolean;
  readonly cancellation: Promise<void>;
  commit(): boolean;
  release(): void;
}

export const isWorkspaceTransitionActive = () => activeTransition !== null;
export const getWorkspaceTransitionGeneration = () => generation;

/** Freeze synchronously, before React renders feedback or any asynchronous work begins. */
export const beginWorkspaceTransition = (store: Store, label: string): WorkspaceTransitionLease | null => {
  if (activeTransition) return null;
  let cancelled = false;
  let committed = false;
  let signalCancellation!: () => void;
  const cancellation = new Promise<void>((resolve) => {
    signalCancellation = resolve;
  });
  const lease: WorkspaceTransitionLease = {
    cancellation,
    get cancelled() {
      return cancelled;
    },
    commit() {
      if (cancelled || activeTransition !== lease) return false;
      committed = true;
      store.set(workspaceTransitionAtom, { label, phase: "committing", cancel });
      return true;
    },
    release() {
      if (activeTransition !== lease) return;
      activeTransition = null;
      store.set(workspaceTransitionAtom, null);
    },
  };
  const cancel = () => {
    if (!committed) {
      cancelled = true;
      signalCancellation();
      lease.release();
    }
  };
  activeTransition = lease;
  generation += 1;
  store.set(workspaceTransitionAtom, { label, phase: "preparing", cancel });
  return lease;
};

/** Includes asynchronous completion work, such as placing an imported image in its owning editor. */
export const trackWorkspaceActivity = <T>(operation: () => Promise<T>): Promise<T> => {
  let promise: Promise<T>;
  try {
    promise = Promise.resolve(operation());
  } catch (error) {
    promise = Promise.reject(error);
  }
  pendingActivity.add(promise);
  void promise.then(
    () => pendingActivity.delete(promise),
    () => pendingActivity.delete(promise),
  );
  return promise;
};

export const waitForWorkspaceActivity = async () => {
  while (pendingActivity.size) await Promise.allSettled([...pendingActivity]);
};

/** Only the owner of a frozen snapshot may write while it drains saves or captures a copy. */
export const runWorkspaceMutation = <T>(operation: () => Promise<T>, lease?: WorkspaceTransitionLease): Promise<T> => {
  if (activeTransition && activeTransition !== lease) return Promise.reject(new Error(WORKSPACE_TRANSITION_MESSAGE));
  if (lease?.cancelled) return Promise.reject(new Error("Workspace operation cancelled."));
  return trackWorkspaceActivity(operation);
};
