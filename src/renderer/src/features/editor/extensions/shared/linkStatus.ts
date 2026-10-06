import type { WorkspaceLinkStatus } from "@renderer/features/files/workspaceFileResolver";

export interface LinkStatusPort {
  resolve(destination: string, syntax: "markdown" | "wiki"): WorkspaceLinkStatus;
  subscribe(listener: () => void): () => void;
}

export function linkStatusPresentation(status?: WorkspaceLinkStatus) {
  if (status?.status === "missing") return { className: "cm-link-missing", title: "Note not found" };
  if (status?.status === "ambiguous")
    return {
      className: "cm-link-ambiguous",
      title: `${status.matches} notes match “${status.target}”`,
    };
  return { className: "", title: "" };
}
