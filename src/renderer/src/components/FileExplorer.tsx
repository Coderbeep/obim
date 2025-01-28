import { useFileExplorer } from '@renderer/hooks/useFileExplorer';
import { isVisibleAtom } from '@renderer/store/SearchWindowStore';
import { FileItem } from '@shared/models';
import { useSetAtom } from 'jotai';
import { useState, useEffect, memo, useRef } from 'react';
import { GoSearch, GoPlus, GoFile, GoFileDirectory } from 'react-icons/go';

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
    isOpen: boolean | undefined;
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

const ListDirectory = ({ file, onDirectorySelect, openFile, level, isOpen }: ListDirectoryProps) => (
    <div>
        <div
            className='file-explorer-item'
            style={{ marginLeft: `${level}em` }}
            onClick={() => onDirectorySelect(file.path)}
        >
            <MemoizedGoFileDirectory />
            <span> {file.filename} </span>
        </div>
        {isOpen && file.children && file.children.map((childFile) => (
            childFile.isDirectory ? (
                <ListDirectory
                    key={childFile.path}
                    file={childFile}
                    onDirectorySelect={onDirectorySelect}
                    openFile={openFile}
                    level={level + 1}
                    isOpen={childFile.isOpen}
                />
            ) : (
                <ListFile
                    key={childFile.path}
                    file={childFile}
                    openFile={openFile}
                    level={level + 1}
                />
            )
        ))}
    </div>
);

export const FileExplorer = memo(({ directoryPath }: FileExplorerProps) => {
    const [files, setFiles] = useState<FileItem[]>([]);
    const folderCache = useRef<Map<string, FileItem[]>>(new Map());
    const expandedDirectories = useRef<Set<string>>(new Set());
    const fileLookup = useRef<Map<string, FileItem>>(new Map());
    const { openFile } = useFileExplorer();
    const setIsVisible = useSetAtom(isVisibleAtom);

    const fetchFilesCache = async (directoryPath: string): Promise<FileItem[]> => {
        if (folderCache.current.has(directoryPath)) {
            return folderCache.current.get(directoryPath) as FileItem[];
        }
        const data = await window['api'].getFiles(directoryPath);
        folderCache.current.set(directoryPath, data);
        data.forEach(file => fileLookup.current.set(file.path, file));
        return data;
    };
    
    const onSearchClick = () => {
        setIsVisible((prev) => !prev);
    }

    useEffect(() => {
        const loadFiles = async () => {
            const result = await fetchFilesCache(directoryPath);
            setFiles(result);
        };

        loadFiles();
    }, [directoryPath]);

    const onDirectorySelect = async (directoryPath: string) => {
        if (expandedDirectories.current.has(directoryPath)) {
            expandedDirectories.current.delete(directoryPath);
            const updatedFiles = collapseDirectory(files, directoryPath);
            setFiles(updatedFiles);
        } else {
            const children = await fetchFilesCache(directoryPath);
            expandedDirectories.current.add(directoryPath);
            const updatedFiles = expandDirectory(files, directoryPath, children);
            setFiles(updatedFiles);
        }
    };

    const expandDirectory = (files: FileItem[], directoryPath: string, children: FileItem[]): FileItem[] => {

        const file = fileLookup.current.get(directoryPath);
        if (file) {
            file.isOpen = true;
            file.children = children;
            return [...files];
        }
        return files;
    };

    const collapseDirectory = (files: FileItem[], directoryPath: string): FileItem[] => {
        const file = fileLookup.current.get(directoryPath);
        if (file) {
            file.isOpen = false;
            file.children = [];
            return [...files];
        }
        return files;
    };

    return (
        <div className='file-explorer'>
            <div className="file-explorer-header">
                <div className='file-explorer-button add-button'>
                    <GoPlus />
                    <span> Add content </span>
                </div>
                <div className='file-explorer-button search-button' onClick={onSearchClick}>
                    <GoSearch />
                </div>
            </div>
            <div className="file-explorer-category">
                <span>Notes</span>
            </div>
            <div className='file-explorer-list'>
                {files.map((file) => (
                    file.isDirectory ? (
                        <ListDirectory
                            key={file.path}
                            file={file}
                            onDirectorySelect={onDirectorySelect}
                            openFile={openFile}
                            level={0}
                            isOpen={expandedDirectories.current.has(file.path)}
                        />
                    ) : (
                        <ListFile
                            key={file.path}
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