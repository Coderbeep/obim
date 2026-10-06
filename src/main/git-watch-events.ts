export interface GitWatchEventClassification {
  historyMayHaveChanged?: boolean;
  path?: string;
  treeMayHaveChanged: boolean;
}

const isHistoryMetadataPath = (relativePath: string) => {
  const normalized = relativePath.replace(/^\.git\//u, "");
  return (
    normalized === "HEAD" ||
    normalized === "packed-refs" ||
    normalized.startsWith("refs/") ||
    normalized === "logs/HEAD" ||
    normalized.startsWith("logs/refs/")
  );
};

/** Filters application-owned writes and classifies the remaining filesystem signal. */
export const classifyGitWatchEvent = (
  eventType: string,
  filename: string | Buffer | null,
  worktree: boolean,
): GitWatchEventClassification | null => {
  const relativePath = filename?.toString().replace(/\\/gu, "/") ?? "";
  const gitMetadata = relativePath === ".git" || relativePath.startsWith(".git/");
  const applicationMetadata = relativePath === ".obim" || relativePath.startsWith(".obim/");
  const temporaryWrite = relativePath
    .split("/")
    .some((segment) => segment.startsWith(".obim-write-") || segment.startsWith(".obim-import-"));
  if (temporaryWrite || (worktree && applicationMetadata)) return null;

  if (!worktree || gitMetadata) {
    return {
      treeMayHaveChanged: false,
      ...(isHistoryMetadataPath(relativePath) ? { historyMayHaveChanged: true } : {}),
    };
  }
  return {
    treeMayHaveChanged: eventType === "rename",
    ...(relativePath ? { path: relativePath } : {}),
  };
};
