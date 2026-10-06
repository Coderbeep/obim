import type { FileItem } from "@shared/file-item";
import { basename } from "@shared/pathUtils";

/** Finds any file or directory node by path. */
export const findItemNode = (tree: FileItem[], itemPath: string): FileItem | null => {
  for (const node of tree) {
    if (node.path === itemPath) return node;
    if (node.isDirectory && node.children) {
      const found = findItemNode(node.children, itemPath);
      if (found) return found;
    }
  }
  return null;
};

/** Finds a directory node by path. */
export const findDirectoryNode = (tree: FileItem[], directoryPath: string): FileItem | null => {
  const item = findItemNode(tree, directoryPath);
  return item?.isDirectory ? item : null;
};

/** Removes duplicates and descendants whose selected parent directory already contains them. */
export const filterTopLevelItems = (items: FileItem[]): FileItem[] => {
  const unique = Array.from(new Map(items.map((item) => [item.path, item])).values());
  return unique.filter(
    (item) =>
      !unique.some(
        (candidate) =>
          candidate.path !== item.path && candidate.isDirectory && item.path.startsWith(`${candidate.path}/`),
      ),
  );
};

/** Generates a numbered name that does not collide with sibling display names or full basenames. */
export const generateNumberedName = (files: FileItem[], baseName: string, extension = ""): string => {
  const existingNames = new Set(files.flatMap((file) => [file.filename, basename(file.path)]));

  let num = 1;
  let name = `${baseName} ${num}`;
  let candidate = extension ? `${name}${extension}` : name;

  while (existingNames.has(name) || existingNames.has(candidate)) {
    num++;
    name = `${baseName} ${num}`;
    candidate = extension ? `${name}${extension}` : name;
  }

  return candidate;
};
