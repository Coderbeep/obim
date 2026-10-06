import { FileSaveStatus } from "@renderer/features/files/FileSaveStatus";
import { currentFileAtom } from "@renderer/store/workspaceResourceStore";
import { useAtomValue } from "jotai";

import { useWindowControls } from "./useWindowControls";

export const WindowTitleBar = () => {
  const windowControls = useWindowControls();
  const currentFile = useAtomValue(currentFileAtom);
  if (!windowControls.isMacOS || !windowControls.visible) return null;

  return (
    <header className="window-title-bar" aria-label="Window title bar">
      <span>Obim</span>
      {currentFile ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="max-w-64 truncate">{currentFile.filename}</span>
          <FileSaveStatus path={currentFile.path} />
        </>
      ) : null}
    </header>
  );
};
