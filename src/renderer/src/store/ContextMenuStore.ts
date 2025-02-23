import { ContextMenuTypes } from "@shared/constants";
import { FileItem } from "@shared/models";
import { atom } from "jotai";

export const contextMenuVisibleAtom = atom(false);
export const contextMenuTypeAtom = atom(ContextMenuTypes.FILE);
export const contextMenuPositionAtom = atom<[number, number]>([0, 0]);
export const contextMenuTargetAtom = atom<FileItem | null>(null);

export const openContextMenuAtom = atom(
    null,
    (get, set, event: React.MouseEvent<HTMLDivElement>, file: FileItem) => {
      event.preventDefault();
      set(contextMenuVisibleAtom, true);
      set(contextMenuPositionAtom, [event.clientX, event.clientY]);
      set(contextMenuTargetAtom, file);
      set(contextMenuTypeAtom, file.isDirectory ? ContextMenuTypes.DIRECTORY : ContextMenuTypes.FILE);
    }
  );
  
export const closeContextMenuAtom = atom(null, (_, set) => {
    set(contextMenuVisibleAtom, false);
});