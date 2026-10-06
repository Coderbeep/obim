import { trustedIpcMain as ipcMain } from "./trusted-ipc";
import crypto from "node:crypto";
import { app } from "electron";
import { rename, unlink, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

import { parseWorkspaceSession, type WorkspaceSession } from "@shared/workspace-session";

import ConfigManager from "./app-config";

let writeQueue = Promise.resolve();

const requireWorkspaceSession = (value: unknown): WorkspaceSession => {
  const session = parseWorkspaceSession(value);
  if (!session) throw new TypeError("Invalid workspace session");
  return session;
};

const workspaceSessionPath = (workspacePath: string) => {
  const id = crypto.createHash("sha256").update(workspacePath).digest("hex").slice(0, 16);
  return path.join(app.getPath("userData"), `workspace-${id}.session.json`);
};

const readWorkspaceSession = async (): Promise<WorkspaceSession | null> => {
  const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
  try {
    return parseWorkspaceSession(JSON.parse(await readFile(workspaceSessionPath(workspacePath), "utf8")));
  } catch {
    return null;
  }
};

const saveWorkspaceSession = async (value: unknown): Promise<void> => {
  const session = requireWorkspaceSession(value);
  const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
  const destination = workspaceSessionPath(workspacePath);
  const temporary = `${destination}.${process.pid}.tmp`;
  const operation = writeQueue.then(async () => {
    await writeFile(temporary, JSON.stringify(session, null, 2), "utf8");
    try {
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  });
  writeQueue = operation.catch(() => undefined);
  await operation;
};

ipcMain.handle("read-workspace-session", () => readWorkspaceSession());
ipcMain.handle("save-workspace-session", (_event, value: unknown) => saveWorkspaceSession(value));
