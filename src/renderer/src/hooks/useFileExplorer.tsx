import { fileTreeAtom } from "../store/NotesStore"
import { notesDirectoryPath } from "@shared/constants"
import { FileItem } from "@shared/models"
import { useAtom } from "jotai"

export const useFileExplorer = () => {
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

    return {
        createNewFile
    }
}