import { noteTextAtom } from "@renderer/store/notes";
import { useAtom } from "jotai";

export const saveFile = async (filaname: string, content: string): Promise<void> => {
    try {
        await window['api'].saveFile(filaname, content);
        console.log(`File '${filaname}' saved successfully.`);
    } catch (err) {
        console.error('Error saving file:', err);
    }
}

export const openFile = async (filePath: string): Promise<string> => {
    try {
        return await window['api'].openFile(filePath);
    } catch (err) {
        console.error('Error opening file:', err);
        throw err
    }
}