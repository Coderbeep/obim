import { useSetAtom } from "jotai";
import type { FileItem } from "@shared/file-item";
import { notePdfExportRequestAtom } from "@renderer/store/notePdfExportStore";

export const useNotePdfExport = () => {
  const setRequest = useSetAtom(notePdfExportRequestAtom);
  return { openNotePdfExport: (file: FileItem) => setRequest(file) };
};
