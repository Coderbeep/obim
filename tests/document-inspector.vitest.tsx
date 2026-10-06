import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = ReturnType<typeof createStore>;

const analyzeMarkdown = vi.hoisted(() => vi.fn());

vi.mock("../src/renderer/src/features/editor/inspector/documentInfo", () => ({
  getMarkdownSidebarInfo: analyzeMarkdown,
}));

vi.mock("../src/renderer/src/features/daily-notes/DailyNotesCalendar", () => ({
  DailyNotesCalendar: () => <input aria-label="Calendar month" defaultValue="September" />,
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Separator: () => <div role="separator" />,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));

import { DocumentInspector } from "../src/renderer/src/features/editor/inspector/DocumentInspector";
import { workspacePanesAtom } from "../src/renderer/src/store/editorPaneStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { taskBoardInspectorSnapshotAtom } from "../src/renderer/src/store/taskBoardInspectorStore";
import { openWorkspaceItemsByKeyAtom } from "../src/renderer/src/store/workspaceResourceStore";
import type { FileItem } from "../src/shared/file-item";
import { MAX_FULL_TEXT_EDITOR_BYTES } from "../src/shared/large-files";
import { createFileWorkspaceItem, createTaskBoardWorkspaceItem } from "../src/shared/workspace";

const file = (path: string, mimeType: string): FileItem => ({
  id: path,
  filename: path.split("/").at(-1) ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  isDirectory: false,
  mimeType,
});

const renderInspector = (selectedFile: FileItem, text: string) => {
  const store = createStore();
  const item = createFileWorkspaceItem(selectedFile);
  const tab = createEditorTab("tab-1", item.key);
  store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }]);
  store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
  store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
  store.set(fileBuffersByPathAtom, { [selectedFile.path]: { savedText: text, editorText: text } });

  return {
    store,
    ...render(
      <Provider store={store}>
        <DocumentInspector />
      </Provider>,
    ),
  };
};

const updateText = (store: Store, path: string, text: string) =>
  act(() => {
    store.set(fileBuffersByPathAtom, (buffers) => ({
      ...buffers,
      [path]: { savedText: buffers[path]?.savedText ?? "", editorText: text },
    }));
  });

beforeEach(() => {
  analyzeMarkdown.mockReset();
  analyzeMarkdown.mockImplementation((text: string) => ({
    headings: [
      { level: 1, line: 1, text: text.startsWith("# Changed") ? "Changed" : "Page" },
      { level: 2, line: 3, text: "Setup" },
    ],
    stats: {
      words: 2,
      characters: text.length,
      lines: 3,
      readingMinutes: 1,
      links: 0,
      images: 0,
      tasks: 0,
      completedTasks: 0,
      codeBlocks: 0,
    },
  }));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("DocumentInspector", () => {
  it("preserves the calendar when switching notes and immediately updates the outline", () => {
    const { store } = renderInspector(file("/notes/page.md", "text/markdown"), "# Page");
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    const calendar = screen.getByRole("textbox", { name: "Calendar month" });
    fireEvent.change(calendar, { target: { value: "October" } });
    const next = file("/notes/other.md", "text/markdown");
    const item = createFileWorkspaceItem(next);
    act(() => {
      store.set(fileBuffersByPathAtom, {
        [next.path]: { savedText: "# Changed", editorText: "# Changed" },
      });
      store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
      store.set(workspaceTabsByIdAtom, { "tab-1": createEditorTab("tab-1", item.key) });
    });
    expect(screen.getByRole("textbox", { name: "Calendar month" })).toBe(calendar);
    expect((calendar as HTMLInputElement).value).toBe("October");
    expect(analyzeMarkdown).toHaveBeenLastCalledWith("# Changed");
    fireEvent.click(screen.getByRole("tab", { name: "Outline" }));
    expect(screen.getByRole("button", { name: "Collapse Changed" })).toBeTruthy();
  });

  it("analyzes Markdown once for note widgets without a Stats tab", () => {
    renderInspector(file("/notes/page.md", "text/markdown"), "# Page\n\n## Setup");

    expect(analyzeMarkdown).toHaveBeenCalledOnce();
    expect(analyzeMarkdown).toHaveBeenCalledWith("# Page\n\n## Setup");
    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Outline",
      "Checklist",
      "Links",
      "Properties",
      "Calendar",
    ]);
    expect(screen.getByRole("button", { name: /^Setup \d/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Stats" })).toBeNull();
  });

  it("does not analyze non-Markdown files", () => {
    renderInspector(file("/notes/page.txt", "text/plain"), "plain text");

    expect(analyzeMarkdown).not.toHaveBeenCalled();
    expect(screen.getByText("No markdown outline")).toBeTruthy();
  });

  it("does not analyze oversized Markdown previews", () => {
    renderInspector({ ...file("/notes/large.md", "text/markdown"), sizeBytes: MAX_FULL_TEXT_EDITOR_BYTES + 1 }, "");

    expect(analyzeMarkdown).not.toHaveBeenCalled();
    expect(screen.getByText("Large-file preview")).toBeTruthy();
  });

  it("shows task board widgets for the task board workspace item", () => {
    const store = createStore();
    const item = createTaskBoardWorkspaceItem();
    const tab = createEditorTab("task-board-tab", item.key);
    store.set(workspacePanesAtom, [{ id: "pane-1", tabs: [tab.id], activeTabId: tab.id, size: 1 }]);
    store.set(workspaceTabsByIdAtom, { [tab.id]: tab });
    store.set(openWorkspaceItemsByKeyAtom, { [item.key]: item });
    store.set(taskBoardInspectorSnapshotAtom, { error: null, hasLoaded: true, isLoading: false, tasks: [] });

    render(
      <Provider store={store}>
        <DocumentInspector />
      </Provider>,
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Agenda",
      "Pinned tasks",
      "Calendar",
    ]);
    expect(screen.queryByRole("region", { name: "Overview" })).toBeNull();
    expect(screen.queryByText("No file metadata")).toBeNull();
  });

  it("keeps manual expansion through body edits and resets it for a changed outline", () => {
    vi.useFakeTimers();
    const path = "/notes/page.md";
    const { store } = renderInspector(file(path, "text/markdown"), "# Page\n\n## Setup");
    fireEvent.click(screen.getByRole("button", { name: "Collapse Page" }));

    updateText(store, path, "# Page\n\n## Setup\nbody change 1");
    updateText(store, path, "# Page\n\n## Setup\nbody change 2");
    expect(analyzeMarkdown).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(119));
    expect(analyzeMarkdown).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(1));
    expect(analyzeMarkdown).toHaveBeenCalledTimes(2);
    expect(analyzeMarkdown).toHaveBeenLastCalledWith("# Page\n\n## Setup\nbody change 2");
    expect(screen.queryByRole("button", { name: /^Setup \d/ })).toBeNull();

    updateText(store, path, "# Changed\n\n## Setup");
    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByRole("button", { name: "Collapse Changed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Setup \d/ })).toBeTruthy();
  });
});
