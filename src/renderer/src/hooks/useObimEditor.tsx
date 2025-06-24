import { saveFile } from "@renderer/services/fileService";
import { currentFilePathAtom } from "@renderer/store/NotesStore";
import { useAtom } from "jotai";
import { debounce } from "lodash";
import { useEffect, useRef } from "react";

export const useObimEditor = () => {
  const [currentFilePath] = useAtom(currentFilePathAtom);
  const currentFilePathRef = useRef(currentFilePath);

  useEffect(() => {
    currentFilePathRef.current = currentFilePath;
  }, [currentFilePath]);

  const handleAutoSave = debounce(async (content: string) => {
    const currentFilePath = currentFilePathRef.current;
    console.log("Auto-saving file:", currentFilePath);
    await saveFile(currentFilePath, content);
  }, 2000);

  return { handleAutoSave };
};
