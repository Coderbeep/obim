import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_EXPLORER_SORT,
  EXPLORER_SORT_STORAGE_KEY,
  explorerSortAtom,
} from "../../src/renderer/src/store/explorerSortStore";

const mountedStore = () => {
  const store = createStore();
  const unsubscribe = store.sub(explorerSortAtom, () => {});
  return { store, unsubscribe };
};

describe("saved explorer sorting", () => {
  beforeEach(() => localStorage.removeItem(EXPLORER_SORT_STORAGE_KEY));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(EXPLORER_SORT_STORAGE_KEY);
  });

  it("defaults to name order and restores sort mode and direction in a new store", () => {
    const first = mountedStore();
    expect(first.store.get(explorerSortAtom)).toEqual(DEFAULT_EXPLORER_SORT);
    const preference = { by: "type", direction: "descending" } as const;
    first.store.set(explorerSortAtom, preference);
    expect(JSON.parse(localStorage.getItem(EXPLORER_SORT_STORAGE_KEY)!)).toEqual(preference);
    first.unsubscribe();
    const reopened = mountedStore();
    expect(reopened.store.get(explorerSortAtom)).toEqual(preference);
    reopened.unsubscribe();
  });

  it.each(["{broken", "null", "[]", '"type"', '{"by":"size","direction":23}'])(
    "falls back safely for invalid stored data: %s",
    (value) => {
      localStorage.setItem(EXPLORER_SORT_STORAGE_KEY, value);
      const { store, unsubscribe } = mountedStore();
      expect(store.get(explorerSortAtom)).toEqual(DEFAULT_EXPLORER_SORT);
      unsubscribe();
    },
  );

  it("retains valid settings while replacing invalid fields", () => {
    localStorage.setItem(EXPLORER_SORT_STORAGE_KEY, '{"by":"type","direction":"invalid"}');
    const { store, unsubscribe } = mountedStore();
    expect(store.get(explorerSortAtom)).toEqual({ by: "type", direction: "ascending" });
    unsubscribe();
  });

  it("ignores the removed folder-order setting while retaining saved sort mode and direction", () => {
    localStorage.setItem(EXPLORER_SORT_STORAGE_KEY, '{"by":"type","direction":"descending","foldersFirst":false}');
    const { store, unsubscribe } = mountedStore();
    expect(store.get(explorerSortAtom)).toEqual({ by: "type", direction: "descending" });
    store.set(explorerSortAtom, (current) => ({ ...current, direction: "ascending" }));
    expect(JSON.parse(localStorage.getItem(EXPLORER_SORT_STORAGE_KEY)!)).toEqual({
      by: "type",
      direction: "ascending",
    });
    unsubscribe();
  });

  it("keeps sorting usable when preference storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Full");
    });
    const { store, unsubscribe } = mountedStore();
    expect(store.get(explorerSortAtom)).toEqual(DEFAULT_EXPLORER_SORT);
    expect(() => store.set(explorerSortAtom, { ...DEFAULT_EXPLORER_SORT, by: "type" })).not.toThrow();
    expect(store.get(explorerSortAtom).by).toBe("type");
    unsubscribe();
  });

  it("updates from another window and resets safely when storage is cleared", () => {
    const { store, unsubscribe } = mountedStore();
    const preference = { by: "type", direction: "descending" } as const;
    window.dispatchEvent(
      new StorageEvent("storage", { key: EXPLORER_SORT_STORAGE_KEY, newValue: JSON.stringify(preference) }),
    );
    expect(store.get(explorerSortAtom)).toEqual(preference);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "null" }));
    expect(store.get(explorerSortAtom)).toEqual(preference);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(store.get(explorerSortAtom)).toEqual(DEFAULT_EXPLORER_SORT);
    unsubscribe();
  });
});
