import { lstatSync } from "fs";
import path from "path";

const isPathInside = (candidatePath: string, parentPath: string) => {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

/** Resolves a workspace path without allowing symlink traversal below its root. */
export const resolveWorkspacePath = (workspacePath: string, requestedPath: string) => {
  const rootPath = path.resolve(workspacePath);
  const fullPath = path.resolve(rootPath, requestedPath);

  if (!isPathInside(fullPath, rootPath)) {
    throw new Error(`Path is outside the notes directory: ${requestedPath}`);
  }

  const relativePath = path.relative(rootPath, fullPath);
  if (!relativePath) return fullPath;

  let currentPath = rootPath;
  for (const segment of relativePath.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    try {
      if (lstatSync(currentPath).isSymbolicLink()) {
        throw new Error(`Symbolic links are not supported in the notes directory: ${requestedPath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }

  return fullPath;
};
