/** Finder metadata is an operating-system implementation detail, not workspace content. */
export const isIgnoredWorkspaceEntry = (filename: string) => filename === ".DS_Store";
