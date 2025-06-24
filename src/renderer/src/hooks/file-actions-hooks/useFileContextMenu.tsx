import { FileItem } from "@shared/models";
import { useSetAtom } from "jotai";
import { openContextMenuAtom } from "../../store/ContextMenuStore";
import { ContextMenuTypes } from "@shared/constants";

interface UseFileContextMenu {
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
}

export const useFileContextMenu = (
  file: FileItem | null,
  type: ContextMenuTypes,
): UseFileContextMenu => {
  const openContextMenu = useSetAtom(openContextMenuAtom);

  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    openContextMenu(event, file, type);
  };

  return { onContextMenu };
};
