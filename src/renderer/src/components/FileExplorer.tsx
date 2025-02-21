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
    renameCallbackAtom,
    currentFilePathAtom,
} from "../store/NotesStore";
import { useFileExplorer } from "../hooks/useFileExplorer";
import { isVisibleAtom } from "../store/SearchWindowStore";
import { useEffect, memo, useState, useRef } from "react";
import { GoSearch, GoPlus, GoFile, GoFileDirectory } from "react-icons/go";
import { FileItem } from "@shared/models";
import { notesDirectoryPath } from "@shared/constants";
import { useFileExplorerDragAndDrop } from "@renderer/hooks/useFileExplorerDragAndDrop";
import { moveFile, renameFile } from "@renderer/services/fileService";
import { ContextMenuTypes } from "./ContextMenu";
import { set } from "lodash";

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
    const setRenameCallback = useSetAtom(renameCallbackAtom);
    const [isEditing, setIsEditing] = useState(false);
    const nameRef = useRef(null);
    const [ reloadFlag, setReloadFlag ] = useAtom(reloadFlagAtom);
    const [ currentFilePath, setCurrentFilePath ] = useAtom(currentFilePathAtom);
    
    const onDragStart = (event: React.DragEvent<HTMLDivElement>) => {
        console.log("Started dragging file: ", `'${file.path}'`);
        event.dataTransfer.setData("application/json", JSON.stringify(file));
    };

    const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        
        const renameCallback = () => {
            console.log("Setting new name");
            setIsEditing(true); 
            setTimeout(() => {
                nameRef.current?.focus();
    
                const range = document.createRange();
                const selection = window.getSelection();
                if (selection && nameRef.current) {
                    range.selectNodeContents(nameRef.current);
                    range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }, 0);
        }
        
        setContextMenuVisible(true);
        setContextMenuPosition([event.clientX, event.clientY]);
        setContextMenuTarget(file);
        setContextMenuType(ContextMenuTypes.FILE);
        setRenameCallback(() => renameCallback)
    }

    const handleRename = async () => {
        setIsEditing(false);
        const newName = nameRef.current?.innerText.trim();
    
        if (newName && newName !== file.filename) {
            const result = await renameFile(file.path, newName);
            console.log("RESULT: ", result)
            if (!result.success) {
                nameRef.current.innerText = file.filename;
            } else {
                setReloadFlag((prev) => !prev);
                if (currentFilePath === file.path) {
                    setCurrentFilePath(result.output);
                }
            }
        } else {
            nameRef.current.innerText = file.filename;
        }
    };
    

    return (
        <div
            draggable={true}
            onDragStart={onDragStart}
            className={`file-explorer-item`}
            style={{ marginLeft: `${level}em` }}
            onClick={() => !isEditing && openFile(file.path)}
            onContextMenu={onContextMenu}
        >
            <MemoizedGoFile />
            <div
                ref={nameRef}
                className={`truncate ${isEditing ? "bg-blue-100 focus:outline-none" : ""}`}
                contentEditable={isEditing}
                spellCheck={false}
                suppressContentEditableWarning={true}
                onBlur={handleRename}
                onKeyDown={(event) => {event.key === "Enter" && nameRef.current?.blur()}}
                > 
                {file.filename} 
            </div>
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
                <MemoizedGoFileDirectory size={16}/>
                <span> {file.filename} </span>
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
    const { openFile, createNewFile } = useFileExplorer();
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
                            openFile={openFile}
                            level={0}
                        />
                    ) : (
                        <ListFile
                            key={file.relativePath}
                            file={file}
                            openFile={openFile}
                            level={0}
                        />
                    ),
                )}
            </div>
        </div>
    );
});
