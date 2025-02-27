import { ContextMenuTypes } from "@shared/constants";
import { FileItem } from "@shared/models";
import { atom } from "jotai";

export const contextMenuVisibleAtom = atom(false);
export const contextMenuTypeAtom = atom(ContextMenuTypes.FILE);
export const contextMenuPositionAtom = atom<[number, number]>([0, 0]);
export const contextMenuTargetAtom = atom<FileItem | null>(null);

export const openContextMenuAtom = atom(
    null,
    (_, set, event: React.MouseEvent<HTMLDivElement>, file: FileItem | null, type: ContextMenuTypes) => {
      event.preventDefault();
      set(contextMenuVisibleAtom, true);
      set(contextMenuPositionAtom, [event.clientX, event.clientY]);
      set(contextMenuTargetAtom, file);
      set(contextMenuTypeAtom, type);
    }
  );
  
export const closeContextMenuAtom = atom(null, (_, set) => {
    set(contextMenuVisibleAtom, false);
});