import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { expandedDirectoriesAtom, selectedBreadcrumbAtom, fileTreeAtom } from '../store/NotesStore';
import { useFileExplorer } from '../hooks/useFileExplorer';
import { isVisibleAtom } from '../store/SearchWindowStore';
import { useEffect, memo } from 'react';
import { GoSearch, GoPlus, GoFile, GoFileDirectory } from 'react-icons/go';
import { FileItem } from '@shared/models';
import { notesDirectoryPath } from '@shared/constants';
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

const ListFile = ({ file, openFile, level }: ListFileProps) => (
    <div
        className='file-explorer-item'
        style={{ marginLeft: `${level}em` }}
        onClick={() => openFile(file.path)}
    >
        <MemoizedGoFile />
        <span> {file.filename} </span>
    </div>
);

const openDirectoryAndParents = (directoryPath: string, setExpandedDirectories: any) => {
    const parts = directoryPath.split('/').slice(1)
    let currentPath = '';
    for (let i = 0; i < parts.length; i++) {
        currentPath += '/';
        currentPath += parts[i];
        setExpandedDirectories((prev) => {
            prev.add(currentPath);
            return new Set(prev);
        })
    }
}

const ListDirectory = ({ file, onDirectorySelect, openFile, level }: ListDirectoryProps) => {
    const expandedDirectories = useAtomValue(expandedDirectoriesAtom)
    const selectedBreadcrumb = useAtomValue(selectedBreadcrumbAtom)
    const isOpen = expandedDirectories.has(file.relativePath);

    return (
        <div>
            <div
                className={`file-explorer-item transition-colors duration-75 border ${selectedBreadcrumb === file.relativePath ? 'bg-blue-200 border-blue-400' : 'border-transparent'}`}
                style={{ marginLeft: `${level}em` }}
                onClick={() => onDirectorySelect(file.relativePath)}
            >
                <MemoizedGoFileDirectory />
                <span> {file.filename} </span>
            </div>
            <div className={`file-explorer-children ${isOpen ? 'open' : ''}`}>
                {isOpen && file.children && file.children.map((childFile) => (
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
                    )
                ))}
            </div>
        </div>
    );
}

export const FileExplorer = memo(({ directoryPath }: FileExplorerProps) => {
    const { openFile, createNewFile } = useFileExplorer();
    const selectedBreadcrumb = useAtomValue(selectedBreadcrumbAtom)
    const [fileTree, setFileTree] = useAtom(fileTreeAtom);
    const setExpandedDirectories = useSetAtom(expandedDirectoriesAtom);
    const setIsVisible = useSetAtom(isVisibleAtom);

    useEffect(() => {
        const loadFiles = async () => {
            const result = await window['api'].getFilesRecursiveAsTree(notesDirectoryPath);
            setFileTree(result);
        };

        loadFiles();
    }, [directoryPath]);

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
        })
    };

    return (
        <div className='file-explorer'>
            <div className="file-explorer-header">
                <div className='file-explorer-button add-button' onClick={createNewFile}>
                    <GoPlus />
                    <span> Add content </span>
                </div>
                <div className='file-explorer-button search-button' onClick={() => { setIsVisible((prev) => !prev) }}>
                    <GoSearch />
                </div>
            </div>
            <div className="file-explorer-category">
                <span>Notes</span>
            </div>
            <div className='file-explorer-list pr-4'>
                {fileTree.map((file) => (
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
                    )
                ))}
            </div>
        </div>
    );
});