import { atomWithStorage } from "jotai/vanilla/utils";

export interface ExplorerSortPreference {
  by: "name" | "type";
  direction: "ascending" | "descending";
}

export const EXPLORER_SORT_STORAGE_KEY = "obim.explorer.sort";
export const DEFAULT_EXPLORER_SORT: ExplorerSortPreference = {
  by: "name",
  direction: "ascending",
};

const parsePreference = (value: string | null, fallback: ExplorerSortPreference): ExplorerSortPreference => {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const preference = parsed as Partial<ExplorerSortPreference>;
    return {
      by: preference.by === "name" || preference.by === "type" ? preference.by : fallback.by,
      direction:
        preference.direction === "ascending" || preference.direction === "descending"
          ? preference.direction
          : fallback.direction,
    };
  } catch {
    return fallback;
  }
};

const storage = {
  getItem: (key: string, fallback: ExplorerSortPreference) => {
    try {
      return parsePreference(typeof window === "undefined" ? null : window.localStorage.getItem(key), fallback);
    } catch {
      return fallback;
    }
  },
  setItem: (key: string, value: ExplorerSortPreference) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Sorting remains usable when local preference storage is unavailable.
    }
  },
  removeItem: (key: string) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Resetting the current preference must also work without storage.
    }
  },
  subscribe: (key: string, callback: (value: ExplorerSortPreference) => void, fallback: ExplorerSortPreference) => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) callback(parsePreference(event.newValue, fallback));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  },
};

export const explorerSortAtom = atomWithStorage(EXPLORER_SORT_STORAGE_KEY, DEFAULT_EXPLORER_SORT, storage, {
  getOnInit: true,
});
