/**
 * Feature-local workspace suggestion readers.
 *
 * Both loaders treat unsaved Markdown buffers as newer than the disk index.
 */
import { useStore } from "jotai";
import { useCallback } from "react";

import {
  loadCurrentWorkspaceFrontmatterFields,
  loadCurrentWorkspacePropertySuggestions,
} from "@renderer/features/workspace/workspaceIndexOverlay";
import { readTaskBoardConfig } from "@renderer/features/workspace/taskBoardConfig";
import { taskBoardProjectNameKey } from "@renderer/shared/taskBoard";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import type { SupportedFrontmatterFieldType } from "@shared/frontmatter-fields";
import { TASK_NOTE_FIELD_KEYS, TASK_NOTE_PRIORITIES } from "@shared/note-type-templates";

/** Returns exact authored field names with an unambiguous observed type hint. */
export const useWorkspaceFieldsLoader = () => {
  const store = useStore();
  return useCallback(async () => {
    const observations = await loadCurrentWorkspaceFrontmatterFields({
      fileBuffersByPath: store.get(fileBuffersByPathAtom),
    });
    const typesByKey = new Map<string, Set<string>>();
    for (const { key, type } of observations) {
      const types = typesByKey.get(key) ?? new Set<string>();
      types.add(type);
      typesByKey.set(key, types);
    }
    return [...typesByKey].map(([key, types]) => ({
      key,
      type: (types.size === 1 && !types.has("unsupported") ? [...types][0] : "text") as SupportedFrontmatterFieldType,
    }));
  }, [store]);
};

/**
 * Returns a stable value-suggestion loader for one field.
 *
 * Task projects additionally include configured board projects, while still
 * falling back to indexed values if the task-board config cannot be read.
 */
export const useWorkspaceValuesLoader = () => {
  const store = useStore();
  return useCallback(
    async (key: string) => {
      if (key === TASK_NOTE_FIELD_KEYS.priority) return [...TASK_NOTE_PRIORITIES];

      const fileBuffersByPath = store.get(fileBuffersByPathAtom);
      const indexedValues = await loadCurrentWorkspacePropertySuggestions({
        fileBuffersByPath,
        query: {
          key,
        },
      });
      if (key !== TASK_NOTE_FIELD_KEYS.project) return indexedValues;

      let configuredProjects: string[] = [];
      try {
        const loaded = await readTaskBoardConfig();
        if (loaded.status === "valid") configuredProjects = loaded.config.projects.map(({ name }) => name);
      } catch {
        // Indexed project values remain available when the presentation manifest cannot be read.
      }

      return [
        ...new Map(
          [...configuredProjects, ...indexedValues].map((name) => [taskBoardProjectNameKey(name), name]),
        ).values(),
      ];
    },
    [store],
  );
};
