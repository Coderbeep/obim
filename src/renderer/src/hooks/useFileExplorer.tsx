import { currentFilePathAtom, editorNoteTextAtom, fileHistoryAtom, fileTreeAtom, noteTextAtom } from "../store/NotesStore"
import { notesDirectoryPath } from "@shared/constants"
import { FileItem } from "@shared/models"
import { useAtom } from "jotai"

export const useFileExplorer = () => {
    const [text, setText] = useAtom(noteTextAtom)
    const [currentFilename, setCurrentFilename] = useAtom(currentFilePathAtom)
    const [fileHistory, setFileHistory] = useAtom(fileHistoryAtom)
    const [editorNoteText, setEditorNoteText] = useAtom(editorNoteTextAtom)
    const [files, setFiles] = useAtom(fileTreeAtom)

    const createNewFile = async () => {
        const untitledFiles = files.filter(file => file.filename.startsWith('Untitled') && file.isDirectory === false);

        let untitlednum = 1;
        while (untitledFiles.some(file => file.filename === `Untitled ${untitlednum}.md`)) {
            untitlednum++;
        }

        const filename = `Untitled ${untitlednum}.md`;
        try {
            await window['api'].saveFile(filename, '');
            console.log(`File '${filename}' created successfully.`);
            const fileItem: FileItem = {
                filename: filename,
                relativePath: filename,
                path: notesDirectoryPath + '/' + filename,
                isDirectory: false,
            }
            setFiles([...files, fileItem])
        } catch (err) {
            console.error('Error creating file:', err);
        }
    }

    const saveCurrentFile = async () => {
        if (currentFilename) {
            try {
                await window['api'].saveFile(currentFilename, editorNoteText)
                setText(editorNoteText)
            } catch (err) {
                console.error('Error saving file:', err);
            }
        }
    }

    const openFile = async (filePath: string) => {
        try {
            await saveCurrentFile();
            const result = await window['api'].openFile(filePath);

            setFileHistory([...fileHistory, filePath])
            setText(result);
            setEditorNoteText(result);
            setCurrentFilename(filePath)
        } catch (err) {
            console.error('Error opening file:', err);
        }
    }

    return {
        openFile, createNewFile
    }
}