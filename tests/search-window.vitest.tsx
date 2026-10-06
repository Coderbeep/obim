import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const search = vi.hoisted(() => ({
  onQueryChange: vi.fn(),
  statuses: new Map<string, "open" | "done" | "cancelled">(),
}));
vi.mock("@renderer/features/search/useSearchTaskStatuses", () => ({
  useSearchTaskStatuses: () => ({ statuses: search.statuses, error: null, loading: false }),
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useFileOpen: () => ({ open: vi.fn() }),
}));

vi.mock("@renderer/features/search/useFileSearch", () => ({
  useFileSearch: () => ({
    isSearching: false,
    matchesByPath: new Map(),
    onQueryChange: search.onQueryChange,
    searchError: null,
  }),
}));

import SearchWindow from "../src/renderer/src/features/search/SearchWindow";
import { recentFilesAtom } from "../src/renderer/src/store/fileExplorerStore";
import { isVisibleAtom } from "../src/renderer/src/store/SearchWindowStore";

beforeEach(() => {
  search.statuses.clear();
  Object.defineProperty(window, "config", {
    configurable: true,
    value: { isMacOS: true },
  });
});

afterEach(() => {
  cleanup();
  search.onQueryChange.mockClear();
});

it("cycles file filters with Tab and Shift+Tab while retaining search focus", () => {
  const store = createStore();
  store.set(isVisibleAtom, true);

  render(
    <Provider store={store}>
      <SearchWindow />
    </Provider>,
  );

  const input = screen.getByRole("combobox", { name: "Search workspace" });
  const all = screen.getByRole("button", { name: "All" });
  const notes = screen.getByRole("button", { name: "Notes" });
  const images = screen.getByRole("button", { name: "Images" });

  expect(all.getAttribute("aria-pressed")).toBe("true");

  fireEvent.keyDown(input, { key: "Tab" });
  expect(notes.getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(input);

  fireEvent.keyDown(input, { key: "Tab" });
  expect(images.getAttribute("aria-pressed")).toBe("true");

  fireEvent.keyDown(input, { key: "Tab" });
  expect(all.getAttribute("aria-pressed")).toBe("true");

  fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
  expect(images.getAttribute("aria-pressed")).toBe("true");
});

it("labels completed recent notes and hides them only when requested", () => {
  const store = createStore();
  store.set(isVisibleAtom, true);
  store.set(recentFilesAtom, [
    {
      id: "done",
      filename: "Finished",
      relativePath: "Finished.md",
      path: "/notes/Finished.md",
      isDirectory: false,
      mimeType: "text/markdown",
    },
    {
      id: "open",
      filename: "Active",
      relativePath: "Active.md",
      path: "/notes/Active.md",
      isDirectory: false,
      mimeType: "text/markdown",
    },
  ]);
  search.statuses.set("/notes/Finished.md", "done");
  render(
    <Provider store={store}>
      <SearchWindow />
    </Provider>,
  );
  expect(screen.getByText("Completed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide completed tasks" }));
  expect(screen.queryByText("Finished")).toBeNull();
  expect(screen.getByText("Active")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide completed tasks" }));
  expect(screen.getByText("Finished")).toBeTruthy();
});
