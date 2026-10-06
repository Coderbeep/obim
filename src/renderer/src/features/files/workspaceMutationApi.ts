import { runWorkspaceMutation } from "@renderer/store/workspaceTransitionStore";

/** Mutating bridge calls share one transition boundary, including Git and internal workspace files. */
export const workspaceMutationApi = new Proxy({} as Window["api"], {
  get(_target, key: keyof Window["api"]) {
    const operation = window.api[key];
    return typeof operation === "function"
      ? (...args: unknown[]) => runWorkspaceMutation(() => Reflect.apply(operation, window.api, args))
      : operation;
  },
});
