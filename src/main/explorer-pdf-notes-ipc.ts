import { trustedIpcMain as ipcMain } from "./trusted-ipc";
import {
  attachPdfNote,
  createPdfNote,
  getExplorerSnapshot,
  importPdfNotes,
  movePdfWithNotes,
} from "./explorer-pdf-notes";

/** Explorer commands validate the active workspace independently of generic file operations. */
export const registerExplorerPdfNotesIpc = (getWorkspacePath: () => Promise<string>) => {
  ipcMain.handle("get-explorer-snapshot", async () => getExplorerSnapshot(await getWorkspacePath()));
  ipcMain.handle("create-pdf-note", async (_event, request: unknown) =>
    createPdfNote(await getWorkspacePath(), request),
  );
  ipcMain.handle("attach-pdf-note", async (_event, request: unknown) =>
    attachPdfNote(await getWorkspacePath(), request),
  );
  ipcMain.handle("import-pdf-notes", async (_event, request: unknown) =>
    importPdfNotes(await getWorkspacePath(), request),
  );
  ipcMain.handle("move-pdf-with-notes", async (_event, request: unknown) =>
    movePdfWithNotes(await getWorkspacePath(), request),
  );
};
