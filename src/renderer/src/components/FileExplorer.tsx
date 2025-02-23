import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
    expandedDirectoriesAtom,
    selectedBreadcrumbAtom,
    fileTreeAtom,
    reloadFlagAtom,
    contextMenuVisibleAtom,
    contextMenuPositionAtom,
    contextMenuTargetAtom,
    contextMenuTypeAtom,
} from "../store/NotesStore";
import { useFileExplorer } from "../hooks/useFileExplorer";
import { isVisibleAtom } from "../store/SearchWindowStore";
import { useEffect, memo, useRef, useState } from "react";
import { GoSearch, GoPlus, GoFile, GoFileDirectory } from "react-icons/go";
import { FileItem } from "@shared/models";
import { notesDirectoryPath } from "@shared/constants";
import { useFileExplorerDragAndDrop } from "@renderer/hooks/useFileExplorerDragAndDrop";
import { moveFile } from "@renderer/services/fileService";
import { ContextMenuTypes } from "./ContextMenu";
import { RenameableText } from "@renderer/ui/common/RenameableText";
import { useFileOpen } from "@renderer/hooks/file-actions-hooks/useFileActions";

const MemoizedGoFile = memo(GoFile);
const MemoizedGoFileDirectory = memo(GoFileDirectory);

interface FileExplorerProps {
    directoryPath: string;
}

interface ListFileProps {
    file: FileItem;
    openFile: (filePath: string) => void;
    level: number;
}

interface ListDirectoryProps {
    file: FileItem;
    onDirectorySelect: (directoryPath: string) => void;
    openFile: (filePath: string) => void;
    level: number;
}

const ListFile = ({ file, openFile, level }: ListFileProps) => {
    const setContextMenuVisible = useSetAtom(contextMenuVisibleAtom)
    const setContextMenuTarget = useSetAtom(contextMenuTargetAtom)
    const [contextMenuType, setContextMenuType] = useAtom(contextMenuTypeAtom);
    const [contextMenuPosition, setContextMenuPosition] = useAtom(contextMenuPositionAtom);
    const [isRenaming, setIsRenaming] = useState(false);


    const onDragStart = (event: React.DragEvent<HTMLDivElement>) => {
        console.log("Started dragging file: ", `'${file.path}'`);
        event.dataTransfer.setData("application/json", JSON.stringify(file));
    };

    const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();

        setContextMenuVisible(true);
        setContextMenuPosition([event.clientX, event.clientY]);
        setContextMenuTarget(file);
        setContextMenuType(ContextMenuTypes.FILE);
    }

    return (
        <div
            draggable
            onDragStart={onDragStart}
            className="file-explorer-item flex"
            style={{ marginLeft: `${level}em` }}
            onClick={() => !isRenaming && openFile(file.path)}
            onContextMenu={onContextMenu}
        >
            <MemoizedGoFile size={16}/>
            <RenameableText
                file={file}
                onRenamingStateChange={setIsRenaming}
            />
        </div>
    );
};

const openDirectoryAndParents = (
    directoryPath: string,
    setExpandedDirectories: any,
) => {
    const parts = directoryPath.split("/").slice(1);
    let currentPath = "";
    for (let i = 0; i < parts.length; i++) {
        currentPath += "/";
        currentPath += parts[i];
        setExpandedDirectories((prev) => {
            prev.add(currentPath);
            return new Set(prev);
        });
    }
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
    const setContextMenuVisible = useSetAtom(contextMenuVisibleAtom)
    const setContextMenuTarget = useSetAtom(contextMenuTargetAtom)
    const [contextMenuType, setContextMenuType] = useAtom(contextMenuTypeAtom);
    const [contextMenuPosition, setContextMenuPosition] = useAtom(contextMenuPositionAtom);
    const [isRenaming, setIsRenaming] = useState(false);

    const { dragCounter, onDragEnter, onDragOver, onDragLeave, onDrop } =
        useFileExplorerDragAndDrop({
            onDropCallback: (droppedFile) => {
                moveFile(droppedFile.path, file.path)
            },
        });

    const onDragStart = (event: React.DragEvent<HTMLDivElement>) => {
        event.dataTransfer.setData("application/json", JSON.stringify(file));
        console.log("Started dragging directory: ", `'${file.path}'`);
    }

    const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        setContextMenuVisible(true);
        setContextMenuPosition([event.clientX, event.clientY]);
        setContextMenuTarget(file);
        setContextMenuType(ContextMenuTypes
            .DIRECTORY);
    }

    return (
        <div
            className={`file-explorer-group ${dragCounter > 0 ? "bg-blue-100" : ""}`}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}

        >
            <div
                className={`file-explorer-item transition-colors duration-75 border ${selectedBreadcrumb === file.relativePath ? "bg-blue-200 border-blue-400" : "border-transparent"}`}
                style={{ marginLeft: `${level}em` }}
                onClick={() => onDirectorySelect(file.relativePath)}
                draggable={true}
                onDragStart={onDragStart}
                onContextMenu={onContextMenu}
            >
                <MemoizedGoFileDirectory size={16} />
                <RenameableText
                    file={file} 
                    onRenamingStateChange={setIsRenaming}/>
            </div>
            <div className={`file-explorer-children ${isOpen ? "open" : ""}`}>
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
    const { createNewFile } = useFileExplorer();
    const { open } = useFileOpen();
    const selectedBreadcrumb = useAtomValue(selectedBreadcrumbAtom);
    const [fileTree, setFileTree] = useAtom(fileTreeAtom);
    const setExpandedDirectories = useSetAtom(expandedDirectoriesAtom);
    const setIsVisible = useSetAtom(isVisibleAtom);
    const reloadFlag = useAtomValue(reloadFlagAtom);


    useEffect(() => {
        const loadFiles = async () => {
            const result =
                await window["api"].getFilesRecursiveAsTree(notesDirectoryPath);
            console.log("RESULTS")
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

    const { dragCounter, onDragEnter, onDragOver, onDragLeave, onDrop } =
        useFileExplorerDragAndDrop({
            onDropCallback: (droppedFile) => {
                moveFile(droppedFile.path, notesDirectoryPath)
            },
        });


    return (
        <div className="file-explorer h-full"
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}>
            <div className="file-explorer-header">
                <div
                    className="file-explorer-button add-button"
                    onClick={createNewFile}
                >
                    <GoPlus />
                    <span> Add content </span>
                </div>
                <div
                    className="file-explorer-button search-button"
                    onClick={() => {
                        setIsVisible((prev) => !prev);
                    }}
                >
                    <GoSearch />
                </div>
            </div>
            <div className="file-explorer-category">
                <span>Notes</span>
            </div>
            <div className="file-explorer-list pr-4">
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
    );
});
