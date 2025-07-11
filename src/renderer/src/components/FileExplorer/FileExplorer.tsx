import { SetStateAction, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, memo, useState, useRef, useMemo } from "react";
import { Folder, File, FolderOpen } from "lucide-react";
import {
  expandedDirectoriesAtom,
  selectedBreadcrumbAtom,
  fileTreeAtom,
  reloadFlagAtom,
  newlyCreatedFileAtom,
  currentFilePathAtom,
} from "@store/NotesStore";
import { FileItem } from "@shared/models";
import { ContextMenuTypes, getNotesDirectoryPath } from "@shared/constants";

import { useFileExplorerDragAndDrop } from "@hooks/useFileExplorerDragAndDrop";
import { useFileOpen } from "@hooks/file-actions-hooks/useFileActions";
import { useFileContextMenu } from "@hooks/file-actions-hooks/useFileContextMenu";

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

interface ListFileProps {
  file: FileItem;
  openFile: (filePath: FileItem) => void;
  level: number;
}

interface ListDirectoryProps {
  file: FileItem;
  onDirectorySelect: (directoryPath: string) => void;
  openFile: (filePath: FileItem) => void;
  level: number;
}

export const ListFile = ({ file, openFile, level }: ListFileProps) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const { onContextMenu } = useFileContextMenu(file, ContextMenuTypes.FILE);
  const fileRef = useRef<HTMLDivElement>(null);
  const [newlyCreatedFile, setNewlyCreatedFile] = useAtom(newlyCreatedFileAtom);
  const [isHighlighted, setIsHighlighted] = useState(false);
  const currentFilePath = useAtomValue(currentFilePathAtom);

  useEffect(() => {
    if (fileRef.current && file.path === newlyCreatedFile) {
      console.log("Scrolling to newly created file: ", `'${file.path}'`);
      fileRef.current.scrollIntoView({ behavior: "smooth", block: "end" });

      setIsHighlighted(true);
      setTimeout(() => {
        setNewlyCreatedFile("");
        setIsHighlighted(false);
      }, 3000);
    }
  }, [newlyCreatedFile]);

  const onDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    console.log("Started dragging file: ", `'${file.path}'`);
    event.dataTransfer.setData("application/json", JSON.stringify(file));
  };

  return (
    <div
      ref={fileRef}
      draggable
      onDragStart={onDragStart}
      className={`file-explorer-item
                ${isHighlighted ? "bg-blue-200" : ""}
                ${currentFilePath === file.path ? "active" : ""}`}
      style={{ marginLeft: `${level * 1.5}em` }}
      onClick={() => !isRenaming && openFile(file)}
      onContextMenu={onContextMenu}
    >
      <div className="bg-gray-100 p-[0.15rem] rounded-md">
        <MemoizedFile size={14} />
      </div>
      <RenameableFilename file={file} onRenamingStateChange={setIsRenaming} />
    </div>
  );
};

const openDirectoryAndParents = (
  directoryPath: string,
  setExpandedDirectories: (update: SetStateAction<Set<string>>) => void,
) => {
  const parts = directoryPath.split("/").slice(1);
  let currentPath = "";
  const newDirs = new Set<string>();

  for (let i = 0; i < parts.length; i++) {
    currentPath += "/" + parts[i];
    newDirs.add(currentPath);
  }

  setExpandedDirectories((prev) => {
    const updated = new Set(prev);
    newDirs.forEach((dir) => updated.add(dir));
    return updated;
  });
};

const ListDirectory = ({
  file,
  onDirectorySelect,
  openFile,
  level,
}: ListDirectoryProps) => {
  const expandedDirectories = useAtomValue(expandedDirectoriesAtom);
  const selectedBreadcrumb = useAtomValue(selectedBreadcrumbAtom);
  const isOpen = expandedDirectories.has(file.relativePath);
  const [, setIsRenaming] = useState(false);
  const directoryRef = useRef<HTMLDivElement>(null);

  const { onContextMenu } = useFileContextMenu(
    file,
    ContextMenuTypes.DIRECTORY,
  );

  const { dragCounter, onDragEnter, onDragOver, onDragLeave, onDrop } =
    useFileExplorerDragAndDrop({ targetDirectoryPath: file.path });

  const onDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData("application/json", JSON.stringify(file));
    console.log("Started dragging directory: ", `'${file.path}'`);
  };

  useEffect(() => {
    if (selectedBreadcrumb === file.relativePath) {
      directoryRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [selectedBreadcrumb]);

  return (
    <div
      className={`file-explorer-group ${dragCounter > 0 ? "bg-blue-100" : ""}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        ref={directoryRef}
        className={`file-explorer-item transition-colors duration-75 border ${selectedBreadcrumb === file.relativePath ? "bg-blue-200 border-blue-400" : "border-transparent"}`}
        style={{ marginLeft: `${level * 1.5}em` }}
        onClick={() => onDirectorySelect(file.relativePath)}
        draggable={true}
        onDragStart={onDragStart}
        onContextMenu={onContextMenu}
      >
        <div className="bg-blue-100 p-[0.15rem] rounded-md">
          {isOpen ? (
            <MemoizedOpenFileDirectory color="#00459f" size={14} />
          ) : (
            <MemoizedFileDirectory color="#00459f" size={14} />
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
                onDirectorySelect={onDirectorySelect}
                openFile={openFile}
                level={level + 1}
              />
            ) : (
              <ListFile
                key={childFile.relativePath}
                file={childFile}
                openFile={openFile}
                level={level + 1}
              />
            ),
          )}
      </div>
    </div>
  );
};

export const FileExplorer = memo(({ directoryPath }: FileExplorerProps) => {
  const { open } = useFileOpen();
  const selectedBreadcrumb = useAtomValue(selectedBreadcrumbAtom);
  const [fileTree, setFileTree] = useAtom(fileTreeAtom);
  const setExpandedDirectories = useSetAtom(expandedDirectoriesAtom);
  const reloadFlag = useAtomValue(reloadFlagAtom);
  const notesDirectoryPath = useMemo(() => getNotesDirectoryPath(), []);

  const { onContextMenu } = useFileContextMenu(
    null,
    ContextMenuTypes.FILEEXPLORER,
  );

  useEffect(() => {
    const loadFiles = async () => {
      const result = await window["api"].getFilesRecursiveAsTree(
        getNotesDirectoryPath(),
      );
      console.log("RESULTS");
      setFileTree(result);
    };

    loadFiles();
  }, [directoryPath, reloadFlag]);

  useEffect(() => {
    if (selectedBreadcrumb != "") {
      openDirectoryAndParents(selectedBreadcrumb, setExpandedDirectories);
    }
  }, [selectedBreadcrumb]);

  const onDirectorySelect = (directoryPath: string) => {
    setExpandedDirectories((prev) => {
      if (prev.has(directoryPath)) {
        prev.delete(directoryPath);
      } else {
        prev.add(directoryPath);
      }
      return new Set(prev);
    });
  };

  const { onDragEnter, onDragOver, onDragLeave, onDrop } =
    useFileExplorerDragAndDrop({ targetDirectoryPath: notesDirectoryPath });

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
              <ListDirectory
                key={file.relativePath}
                file={file}
                onDirectorySelect={onDirectorySelect}
                openFile={open}
                level={0}
              />
            ) : (
              <ListFile
                key={file.relativePath}
                file={file}
                openFile={open}
                level={0}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
});
