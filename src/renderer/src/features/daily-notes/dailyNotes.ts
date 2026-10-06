import { format } from "date-fns";

import { joinFsPath } from "@shared/pathUtils";

const DAILY_NOTE_FILENAME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})\.md$/u;

export const dailyNoteFilename = (date: Date) => `${format(date, "yyyy-MM-dd")}.md`;

export const dailyNoteRelativePath = (date: Date, directory: string) => joinFsPath(directory, dailyNoteFilename(date));

export const dailyNoteInitialContent = (date: Date) => `# ${format(date, "EEEE, MMMM d, yyyy")}\n\n`;

export const dailyNoteDateFromPath = (relativePath: string, directory: string): Date | null => {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const normalizedDirectory = directory.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
  const prefix = normalizedDirectory ? `${normalizedDirectory}/` : "";
  if (!normalizedPath.startsWith(prefix)) return null;

  const filename = normalizedPath.slice(prefix.length);
  if (filename.includes("/")) return null;
  const match = DAILY_NOTE_FILENAME_PATTERN.exec(filename);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  return date.getFullYear() === year && date.getMonth() === monthIndex && date.getDate() === day ? date : null;
};
