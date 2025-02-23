import { FileItem } from "@shared/models";
import { useSetAtom } from "jotai";
import { openContextMenuAtom } from "@renderer/store/ContextMenuStore";

interface UseFileContextMenu {
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export const useFileContextMenu = (file: FileItem): UseFileContextMenu => {
  const openContextMenu = useSetAtom(openContextMenuAtom)

  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    openContextMenu(event, file)
  }

  return { onContextMenu };
};