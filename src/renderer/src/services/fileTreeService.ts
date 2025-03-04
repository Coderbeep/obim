import { getNotesDirectoryPath } from "@shared/constants";
import { FileItem } from "@shared/models";

export const findFolderNode = (tree: FileItem[], folderPath: string): FileItem | null => {
    if (folderPath === getNotesDirectoryPath()) return null

    for (const node of tree) {
        if (node.isDirectory && node.path === folderPath) return node;
        if (node.isDirectory && node.children) {
        const found = findFolderNode(node.children, folderPath);
            if (found) return found;
        }
    }
    return null;
};

export const generateUniqueName = (files: FileItem[], baseName: string, extension = ''): string => {
    const existingItems = files.filter(child => child.filename.startsWith(baseName)) || [];
    let num = 1;
    while (existingItems.some(item => item.filename === `${baseName} ${num}${extension}`)) {
        num++;
    }
    return `${baseName} ${num}${extension}`;
};

export const addItemToTree = (tree: FileItem[], folderPath: string, newItem: FileItem): FileItem[] => {
    return tree.map(node => {
        if (node.isDirectory && node.path === folderPath) {
            return { ...node, children: [...(node.children || []), newItem] };
        }
        if (node.isDirectory && node.children) {
            return { ...node, children: addItemToTree(node.children, folderPath, newItem) };
        }
        return node;
    });
};
