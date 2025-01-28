import { currentFilePathAtom, editorNoteTextAtom, fileHistoryAtom, noteTextAtom } from "@renderer/store/notes"
import { useAtom } from "jotai"

export const useFileExplorer = () => {
    const [text, setText] = useAtom(noteTextAtom)
    const [currentFilename, setCurrentFilename] = useAtom(currentFilePathAtom)
    const [fileHistory, setFileHistory] = useAtom(fileHistoryAtom)
    const [editorNoteText, setEditorNoteText] = useAtom(editorNoteTextAtom)

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
        openFile,
    }
}