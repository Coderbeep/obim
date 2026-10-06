import crypto from "node:crypto";
import { cp, lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceBackupResult } from "@shared/config";
import { publishStagedWorkspaceItem } from "./workspace-publication";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isInside = (candidate: string, base: string) => {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const assertNoSymlinks = async (directory: string): Promise<void> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    // Exports contain working files, never repository history or administrative pointers.
    if (entry.name === ".git") continue;
    const entryPath = path.join(directory, entry.name);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink())
      throw new Error(`Backup stopped because the workspace contains a symbolic link: ${entryPath}`);
    if (stats.isDirectory()) await assertNoSymlinks(entryPath);
  }
};

const backupTimestamp = (date: Date) => {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}${pad(date.getSeconds())}`;
};

/** Resolve existing ancestors before containment checks, including uncreated destinations. */
const resolveDestination = async (destination: string): Promise<string> => {
  try {
    return await realpath(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(destination);
    if (parent === destination) throw error;
    return path.join(await resolveDestination(parent), path.basename(destination));
  }
};

export const createWorkspaceBackup = async (
  workspacePath: string,
  destinationDirectory: string,
  now = new Date(),
): Promise<WorkspaceBackupResult> => {
  let stagingPath: string | undefined;
  try {
    const source = await realpath(path.resolve(workspacePath));
    const destination = await resolveDestination(path.resolve(destinationDirectory));
    if (!(await lstat(source)).isDirectory()) throw new Error("The workspace is not a directory.");
    if (isInside(destination, source)) throw new Error("Choose a backup destination outside the current workspace.");
    await assertNoSymlinks(source);
    await mkdir(destination, { recursive: true });
    const actualDestination = await realpath(destination);
    if (isInside(actualDestination, source))
      throw new Error("Choose a backup destination outside the current workspace.");
    stagingPath = path.join(actualDestination, `.obim-backup-${crypto.randomUUID()}.tmp`);
    await cp(source, stagingPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (entry) => entry === source || path.basename(entry) !== ".git",
    });
    if (!(await lstat(stagingPath)).isDirectory()) throw new Error("Backup did not create an independent directory.");
    await assertNoSymlinks(stagingPath);
    const finalPath = await publishStagedWorkspaceItem(
      stagingPath,
      path.join(actualDestination, `Obim Backup ${backupTimestamp(now)}`),
      2,
    );
    return { status: "created", path: finalPath };
  } catch (error) {
    return { status: "error", error: errorMessage(error) };
  } finally {
    if (stagingPath) await rm(stagingPath, { force: true, recursive: true }).catch(() => undefined);
  }
};
