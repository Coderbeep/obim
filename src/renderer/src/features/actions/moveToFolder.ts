import { rankFiles } from "@renderer/features/search/fileRanking";
import type { FileItem } from "@shared/file-item";
import { getPathWithoutFilename, isPathWithinBase } from "@shared/pathUtils";

export const flattenDirectories = (items: readonly FileItem[]): FileItem[] =>
  items.flatMap((item) => (item.isDirectory ? [item, ...flattenDirectories(item.children ?? [])] : []));

const workspaceRootItem = (workspacePath: string): FileItem => ({
  id: "action-runner:workspace-root",
  filename: "Workspace root",
  relativePath: "",
  path: workspacePath,
  isDirectory: true,
  mimeType: null,
  children: [],
});

const canMoveAnythingTo = (destination: FileItem, targets: readonly FileItem[]) =>
  targets.some((target) => getPathWithoutFilename(target.path) !== destination.path);

const isInsideMovedDirectory = (destination: FileItem, targets: readonly FileItem[]) =>
  targets.some((target) => target.isDirectory && isPathWithinBase(destination.path, target.path));

export const getMoveDestinations = (
  fileTree: readonly FileItem[],
  workspacePath: string,
  targets: readonly FileItem[],
  query: string,
) => {
  const directories = [workspaceRootItem(workspacePath), ...flattenDirectories(fileTree)].filter(
    (directory) => canMoveAnythingTo(directory, targets) && !isInsideMovedDirectory(directory, targets),
  );
  return rankFiles(directories, query);
};

export const getTargetsForDestination = (targets: readonly FileItem[], destinationPath: string) =>
  targets.filter((target) => getPathWithoutFilename(target.path) !== destinationPath);
