export type WorkspaceFileChange = {
  kind: "change" | "rename" | "unknown";
  path?: string;
};
