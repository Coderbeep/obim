import {
  DEFAULT_DAILY_NOTE_CREATION_DIRECTORY,
  DEFAULT_TASK_CREATION_DIRECTORY,
  normalizeCreationDirectory,
  type AppConfig,
  type ConfigKey,
} from "@shared/config";

export const getConfigValue = <K extends ConfigKey>(key: K) => window.config.getConfigValue(key);

export const APP_CONFIG_CHANGED_EVENT = "obim-app-config-changed";

export const updateConfig = async <K extends ConfigKey>(key: K, value: AppConfig[K]) => {
  await window.config.updateConfig(key, value);
  window.dispatchEvent(new CustomEvent(APP_CONFIG_CHANGED_EVENT, { detail: { key, value } }));
};

const readCreationDirectory = async (key: "dailyNoteCreationDirectory" | "taskCreationDirectory", fallback: string) => {
  try {
    const value = await window.config.getConfigValue?.(key);
    return normalizeCreationDirectory(value) ?? fallback;
  } catch {
    return fallback;
  }
};

export const getTaskCreationDirectory = () =>
  readCreationDirectory("taskCreationDirectory", DEFAULT_TASK_CREATION_DIRECTORY);

export const getDailyNoteCreationDirectory = () =>
  readCreationDirectory("dailyNoteCreationDirectory", DEFAULT_DAILY_NOTE_CREATION_DIRECTORY);

export const getWorkspacePath = () => window.config.getMainDirectoryPathSync().replace(/\\/g, "/");

export const getTaskBoardOpenMode = async (): Promise<"tab" | "hover"> => {
  try {
    return (await window.config.getConfigValue?.("taskBoardOpenMode")) === "hover" ? "hover" : "tab";
  } catch {
    return "tab";
  }
};
