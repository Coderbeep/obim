import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, memo, useState, useRef, useCallback } from "react";
import { Folder, File, FolderOpen } from "lucide-react";
import {
  expandedDirectoriesAtom,
  fileTreeAtom,
  reloadFlagAtom,
  selectedBredcrumbMatchAtomFamily,
  isDirectoryExpandedAtomFamily,
  isActiveFileAtomFamily,
} from "@store/NotesStore";
import { FileItem } from "@shared/models";
import { ContextMenuTypes } from "@shared/constants";

import {
  useFileExplorerDragSource,
  useFileExplorerDropTarget,
} from "@hooks/useFileExplorerDragAndDrop";
import { useFileOpen } from "@hooks/file-actions-hooks/useFileActions";
import { useFileContextMenu } from "@hooks/file-actions-hooks/useFileContextMenu";

import _ from "lodash";

import {
  FileExplorerHeader,
  FileExplorerBookmarks,
  RenameableFilename,
} from "@components/FileExplorer/.";

const MemoizedFile = memo(File);
const MemoizedFileDirectory = memo(Folder);
const MemoizedOpenFileDirectory = memo(FolderOpen);

interface FileExplorerProps {
  directoryPath: string;
}

interface ListItem {
  file: FileItem;
  level: number;
}

export const ListFile = memo(({ file, level }: ListItem) => {
  const { open } = useFileOpen();
  const [isRenaming, setIsRenaming] = useState(false);
  const { onContextMenu } = useFileContextMenu(file, ContextMenuTypes.FILE);
  const fileRef = useRef<HTMLDivElement>(null);
  const isActive = useAtomValue(isActiveFileAtomFamily(file.path));

  useEffect(() => {
    console.log("[RENDER] ListFile");
  }, []);

  const { onDragStart, onDrag, onDragEnd } = useFileExplorerDragSource(file);

  return (
    <div
      ref={fileRef}
      draggable
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      className={`file-explorer-item
                ${isActive ? "active" : ""}`}
      style={{ marginLeft: `${level * 1.5}em` }}
      onClick={() => !isRenaming && open(file)}
      onContextMenu={onContextMenu}
    >
      <div className="p-[0.15rem] rounded-[var(--radius)]">
        <MemoizedFile size={14} />
      </div>
      <RenameableFilename file={file} onRenamingStateChange={setIsRenaming} />
    </div>
  );
});

const ListDirectory = memo(({ file, level }: ListItem) => {
  const isOpen = useAtomValue(isDirectoryExpandedAtomFamily(file.relativePath));
  const isSelectedByBreadcrumb = useAtomValue(
    selectedBredcrumbMatchAtomFamily(file.relativePath)
  );
  const setExpandedDirectories = useSetAtom(expandedDirectoriesAtom);

  const [, setIsRenaming] = useState(false);
  const directoryRef = useRef<HTMLDivElement>(null);
  const { onContextMenu } = useFileContextMenu(
    file,
    ContextMenuTypes.DIRECTORY
  );

  useEffect(() => {
    console.log("[RENDER] ListDirectory");
  });

  const onDirectorySelect = useCallback((directoryPath: string) => {
    setExpandedDirectories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(directoryPath)) {
        newSet.delete(directoryPath);
      } else {
        newSet.add(directoryPath);
      }
      return newSet;
    });
  }, []);

  const { onDragStart, onDrag, onDragEnd } = useFileExplorerDragSource(file);
  const { dragCounter, onDragEnter, onDragOver, onDragLeave, onDrop } =
    useFileExplorerDropTarget(file.path);

  useEffect(() => {
    if (isSelectedByBreadcrumb) {
      directoryRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [isSelectedByBreadcrumb]);

  return (
    <div
      className={`file-explorer-group rounded-[var(--radius)] border-1 z-10 ${
        dragCounter
          ? "bg-blue-100! border-[var(--sidebar-ring)]"
          : "border-transparent"
      }`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        ref={directoryRef}
        className={`file-explorer-item transition-colors duration-75 border ${
          isSelectedByBreadcrumb
            ? "border-[var(--sidebar-ring)] bg-blue-100!"
            : "border-transparent"
        }`}
        style={{ marginLeft: `${level * 1.5}em` }}
        onClick={() => onDirectorySelect(file.relativePath)}
        draggable={true}
        onDragStart={onDragStart}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        onContextMenu={onContextMenu}
      >
        <div className="p-[0.15rem] rounded-[var(--radius)]">
          {isOpen ? (
            <MemoizedOpenFileDirectory size={14} />
          ) : (
            <MemoizedFileDirectory size={14} />
          )}
        </div>
        <RenameableFilename file={file} onRenamingStateChange={setIsRenaming} />
      </div>
      <div
        className={`file-explorer-children-${level} ${isOpen ? "open" : ""}`}
      >
        {isOpen &&
          file.children &&
          file.children.map((childFile) =>
            childFile.isDirectory ? (
              <ListDirectory
                key={childFile.relativePath}
                file={childFile}
                level={level + 1}
              />
            ) : (
              <ListFile
                key={childFile.relativePath}
                file={childFile}
                level={level + 1}
              />
            )
          )}
      </div>
    </div>
  );
});

export const FileExplorer = memo(({ directoryPath }: FileExplorerProps) => {
  const [fileTree, setFileTree] = useAtom(fileTreeAtom);
  const reloadFlag = useAtomValue(reloadFlagAtom);

  const { onContextMenu } = useFileContextMenu(
    null,
    ContextMenuTypes.FILEEXPLORER
  );

  useEffect(() => {
    console.log("[RENDER] Explorer");
  });

  useEffect(() => {
    const loadFiles = async () => {
      const result = await window["api"].getFilesRecursiveAsTree(directoryPath);
      setFileTree((prev) => (_.isEqual(prev, result) ? prev : result));
    };
    loadFiles();
  }, [directoryPath, reloadFlag]);

  const { onDragEnter, onDragOver, onDragLeave, onDrop } =
    useFileExplorerDropTarget(directoryPath);

  return (
    <div
      className="file-explorer h-full"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <FileExplorerHeader />
      <div className="file-explorer-list">
        <FileExplorerBookmarks />
        <div className="file-explorer-category text-weird">
          <span>Notes</span>
        </div>
        <div className="pr-4" onContextMenu={onContextMenu}>
          {fileTree.map((file) =>
            file.isDirectory ? (
              <ListDirectory key={file.relativePath} file={file} level={0} />
            ) : (
              <ListFile key={file.relativePath} file={file} level={0} />
            )
          )}
        </div>
      </div>
    </div>
  );
});
