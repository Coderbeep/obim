import { useState } from "react"

export const useFileExplorer = () => {
    const [text, setText] = useState('')
    const [currentFilename, setCurrentFilename] = useState<string>('')
    const [fileHistory, setFileHistory] = useState<string[]>([])

    const openFile = async (filePath: string) => {
        console.log(currentFilename + ' is the current filename')
        try {
            if (fileHistory) {
                const lastFile = fileHistory[fileHistory.length - 1]
                window['api'].saveFile(lastFile, text)
            }
            const result = await window['api'].openFile(filePath);
            setFileHistory([...fileHistory, filePath])
            setText(result);

        } catch (err) {
            console.error('Error opening file:', err);
        }
        setCurrentFilename(filePath)
    }

    return {
        text,
        setText,
        openFile,
        fileHistory,
        currentFilename
    }
}