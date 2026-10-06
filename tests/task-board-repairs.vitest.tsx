import { createTaskActions } from "./task-board-actions-test-support";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskBoard } from "../src/renderer/src/features/task-board/TaskBoard";
import { ContextMenuHost } from "../src/renderer/src/features/context-menu/ContextMenuHost";
import * as taskBoardHook from "../src/renderer/src/features/task-board/useTaskBoard";
import { parseFrontmatter, type FrontmatterValue } from "../src/shared/frontmatter";
import { reloadRevisionAtom } from "../src/renderer/src/store/fileExplorerStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import type { FileItem } from "../src/shared/file-item";
import type { FrontmatterScalar, IndexedDocument, WorkspacePropertyQuery } from "../src/shared/workspace-index";

type Store = ReturnType<typeof createStore>;

const boundaryMocks = vi.hoisted(() => ({
  createMarkdownFile: vi.fn(),
  open: vi.fn(),
  readTextFile: vi.fn(),
  remove: vi.fn(),
  saveRename: vi.fn(),
  saveFile: vi.fn(),
  startRenaming: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  doesFileExist: vi.fn(),
  queryWorkspaceProperty: vi.fn(),
  readIndexedDocuments: vi.fn(),
  openFile: vi.fn(),
  upsertFile: vi.fn(),
}));

vi.mock("@renderer/features/files/workspaceFileService", () => ({
  readTextFile: boundaryMocks.readTextFile,
  saveFile: boundaryMocks.saveFile,
}));

vi.mock("@renderer/features/files/fileActions", () => ({
  useFileCreate: () => ({ createMarkdownFile: boundaryMocks.createMarkdownFile }),
  useFileOpen: () => ({ open: boundaryMocks.open }),
  useFileRemove: () => ({ remove: boundaryMocks.remove }),
  useFileRename: () => ({ saveRename: boundaryMocks.saveRename, startRenaming: boundaryMocks.startRenaming }),
}));

const note = (path: string): Extract<FileItem, { isDirectory: false }> => ({
  id: path,
  filename: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const openedVersion = { id: "opened", mtimeMs: 100, sizeBytes: 10 };
const savedVersion = { id: "saved", mtimeMs: 200, sizeBytes: 20 };

const taskSource = (title: string, section = "Research", completed = false) =>
  [
    "---",
    "type: task",
    ...(section ? [`task-project: ${section}`] : []),
    ...(completed ? ["task-status: done"] : []),
    "---",
    `# ${title}`,
    "",
  ].join("\n");

const renderBoard = (store: Store = createStore()) => {
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  return { store, ...renderHook(() => taskBoardHook.useTaskBoard(), { wrapper }) };
};

let sources: Record<string, string>;
let configExists: boolean;
let configSource: string;

const scalarValues = (value: FrontmatterValue): FrontmatterScalar[] => {
  if (value.kind === "list") return value.value.flatMap(scalarValues);
  if (value.kind === "unsupported") return [];
  if (value.kind === "date") return [{ type: "date", value: value.source }];
  if (value.kind === "string") return [{ type: "string", value: value.value }];
  if (value.kind === "number") return [{ type: "number", value: value.value }];
  if (value.kind === "boolean") return [{ type: "boolean", value: value.value }];
  return [{ type: "null", value: null }];
};

const scalarMatches = (actual: FrontmatterScalar, expected: FrontmatterScalar) =>
  actual.type === expected.type &&
  (actual.type === "string" || actual.type === "date"
    ? String(actual.value).trim().toLocaleLowerCase() === String(expected.value).trim().toLocaleLowerCase()
    : actual.value === expected.value);

const propertyMatchesFromSources = (request: WorkspacePropertyQuery) => {
  const matches = Object.entries(sources).flatMap(([path, source]) => {
    const frontmatter = parseFrontmatter(source);
    if (
      request.includeInvalidTaskCandidates &&
      frontmatter.kind === "invalid" &&
      /^type:[ \t]+(?:task|"task"|'task')[ \t]*(?:#.*)?$/m.test(source)
    )
      return [{ file: note(path), values: [] }];
    if (frontmatter.kind !== "valid") return [];
    const properties = frontmatter.properties.filter(({ key }) => key === request.key);
    const values = properties.flatMap(({ value }) => scalarValues(value));
    return properties.length && (!request.value || values.some((value) => scalarMatches(value, request.value!)))
      ? [{ file: note(path), values }]
      : [];
  });
  const offset = request.offset ?? 0;
  return matches.slice(offset, offset + (request.limit ?? 100));
};

const indexedDocument = (path: string): IndexedDocument | undefined => {
  const source = sources[path];
  if (source === undefined) return undefined;
  return {
    file: note(path),
    source,
  };
};

beforeEach(() => {
  sources = {};
  configExists = false;
  configSource = "";

  window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
  window.api = {
    doesFileExist: apiMocks.doesFileExist,
    queryWorkspaceProperty: apiMocks.queryWorkspaceProperty,
    readIndexedDocuments: apiMocks.readIndexedDocuments,
    openFile: apiMocks.openFile,
    upsertFile: apiMocks.upsertFile,
  } as unknown as Window["api"];

  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
  vi.spyOn(window, "confirm").mockReturnValue(true);

  apiMocks.doesFileExist.mockImplementation(async () => configExists);
  apiMocks.queryWorkspaceProperty.mockImplementation(async (request: WorkspacePropertyQuery) =>
    propertyMatchesFromSources(request),
  );
  apiMocks.readIndexedDocuments.mockImplementation(async (paths: string[]) =>
    paths.flatMap((path) => {
      const document = indexedDocument(path);
      return document ? [document] : [];
    }),
  );
  apiMocks.openFile.mockImplementation(async () => configSource);
  apiMocks.upsertFile.mockImplementation(async (_path: string, content: string) => {
    configExists = true;
    configSource = content;
    return true;
  });
  boundaryMocks.createMarkdownFile.mockResolvedValue(null);
  boundaryMocks.open.mockResolvedValue(undefined);
  boundaryMocks.remove.mockReset().mockResolvedValue(true);
  boundaryMocks.saveRename.mockReset().mockResolvedValue({ success: false, error: "rename failed" });
  boundaryMocks.startRenaming.mockReset();
  boundaryMocks.readTextFile.mockImplementation(async (path: string) =>
    path in sources
      ? { success: true, content: sources[path], version: openedVersion }
      : { success: false, error: `Missing fixture: ${path}` },
  );
  boundaryMocks.saveFile.mockImplementation(async (path: string, content: string) => {
    sources[path] = content;
    return { success: true, version: savedVersion };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("task board repair regressions", () => {
  it("retries a refresh interrupted by an unrelated buffer change", async () => {
    sources["/notes/A.md"] = taskSource("A");
    const { result, store } = renderBoard();
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));
    sources["/notes/B.md"] = taskSource("B");
    let resolveQuery!: (value: unknown[]) => void;
    apiMocks.queryWorkspaceProperty.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refresh();
    });
    act(() => store.set(fileBuffersByPathAtom, { "/notes/Unrelated.md": { savedText: "", editorText: "typing" } }));
    await act(async () => {
      resolveQuery(propertyMatchesFromSources({ key: "type", value: { type: "string", value: "task" } }));
      await pending;
    });
    expect(result.current.orderedTasks.map((task) => task.title)).toEqual(["A", "B"]);
    expect(result.current.isLoading).toBe(false);
    expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(3);
  });
  it("preserves a newer due date when an older draft changes only priority", async () => {
    sources["/notes/A.md"] = "---\ntype: task\ntask-due: 2026-09-10\n---\nBody";
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));
    const oldTask = result.current.orderedTasks[0];
    sources[oldTask.path] = sources[oldTask.path].replace("2026-09-10", "2026-09-20");
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.orderedTasks[0].dueDate).toBe("2026-09-20");
    await act(async () => {
      expect(
        await result.current.taskActions.updateTask(result.current.orderedTasks[0], {
          taskName: "A",
          dueDate: oldTask.dueDate,
          priority: "high",
          tags: [],
          original: { taskName: oldTask.title, dueDate: oldTask.dueDate, tags: [] },
        }),
      ).toBe(true);
    });
    expect(sources[oldTask.path]).toContain("task-due: 2026-09-20");
  });
  it("preserves both concurrent section additions and publishes them to both controllers", async () => {
    const store = createStore();
    const first = renderBoard(store);
    const second = renderBoard(store);
    await waitFor(() => expect(first.result.current.hasLoaded && second.result.current.hasLoaded).toBe(true));
    await act(async () => {
      const results = await Promise.all([
        first.result.current.createProject({ name: "One" }),
        second.result.current.createProject({ name: "Two" }),
      ]);
      expect(results.every(Boolean)).toBe(true);
    });
    expect(JSON.parse(configSource).projects.map((project: { name: string }) => project.name)).toEqual(["One", "Two"]);
    expect(first.result.current.projects.map(({ name }) => name)).toEqual(["One", "Two"]);
    expect(second.result.current.projects.map(({ name }) => name)).toEqual(["One", "Two"]);
  });
  it("exposes malformed layout configuration and blocks layout mutations", async () => {
    configExists = true;
    configSource = "{broken";
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));
    expect(result.current.layoutError).toContain(".todo/taskboard.json");
    expect(result.current.canEditLayout).toBe(false);
    expect(result.current.projects).toEqual([]);
    expect(await result.current.createProject({ name: "Test" })).toBe(null);
  });
});

import { TaskBoardTask as ReviewTaskCard } from "../src/renderer/src/features/task-board/TaskBoardTask";
import {
  parseTaskMarkdown as reviewParse,
  setTaskDueDate as reviewSetDue,
} from "../src/renderer/src/features/task-board/taskBoardFiles";
it("completion accepts repaired metadata without remounting the card", async () => {
  vi.useFakeTimers();
  const parsed = reviewParse(taskSource("A"), note("/notes/A.md"))!;
  const complete = vi
    .fn<(task: NonNullable<ReturnType<typeof reviewParse>>) => Promise<boolean>>()
    .mockResolvedValue(true);
  const props = {
    taskActions: createTaskActions({
      loadTags: async () => [],
      completeTask: complete,
      reopenTask: async () => true,
      cancelTask: async () => true,
      deleteTask: async () => true,
      moveTask: async () => true,
      openTask: () => {},
      updateTask: async () => true,
    }),
    projects: [],
  };
  const view = render(
    <>
      <ReviewTaskCard {...props} item={{ ...parsed, metadataIssues: ["invalid priority"] }} />
      <ContextMenuHost />
    </>,
  );
  view.rerender(
    <>
      <ReviewTaskCard {...props} item={parsed} />
      <ContextMenuHost />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Task actions for A" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Complete task" }));
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(complete.mock.calls[0][0].metadataIssues).toEqual([]);
});
it("quoted dates can be changed safely", () => {
  const source = '---\ntype: task\ntask-due: "2026-09-10"\n---\nBody';
  expect(reviewParse(source, note("/notes/A.md"))?.metadataIssues).toEqual([]);
  expect(reviewParse(reviewSetDue(source, "2026-09-20"), note("/notes/A.md"))?.dueDate).toBe("2026-09-20");
});
it("a finished save publishes the newest editor metadata", async () => {
  const path = "/notes/A.md";
  const source = taskSource("A");
  sources[path] = source;
  const store = createStore();
  store.set(fileBuffersByPathAtom, { [path]: { savedText: source, editorText: source } });
  const { result } = renderBoard(store);
  await waitFor(() => expect(result.current.hasLoaded).toBe(true));
  let resolveSave!: (result: { success: true }) => void;
  boundaryMocks.saveFile.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveSave = resolve;
    }),
  );
  let save!: Promise<boolean>;
  act(() => {
    save = result.current.taskActions.updateTask(result.current.orderedTasks[0], { priority: "high", tags: [] });
  });
  await waitFor(() => expect(boundaryMocks.saveFile).toHaveBeenCalledOnce());
  const staged = store.get(fileBuffersByPathAtom)[path];
  const newer = staged.editorText.replace("task-priority: high", "task-priority: low");
  act(() => store.set(fileBuffersByPathAtom, { [path]: { ...staged, editorText: newer } }));
  expect(result.current.orderedTasks[0].priority).toBe("low");
  await act(async () => {
    resolveSave({ success: true });
    await save;
  });
  expect(store.get(fileBuffersByPathAtom)[path].editorText).toContain("task-priority: low");
  expect(result.current.orderedTasks[0].priority).toBe("low");
});

it("rejects concurrent changes to the same draft field without writing other fields", async () => {
  const path = "/notes/A.md";
  sources[path] = "---\ntype: task\ntask-project: Research\ntask-due: 2026-09-10\n---\nBody";
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.hasLoaded).toBe(true));
  const task = result.current.orderedTasks[0];
  sources[path] = sources[path].replace("2026-09-10", "2026-09-20");
  await act(async () => {
    expect(
      await result.current.taskActions.updateTask(task, {
        dueDate: "2026-09-30",
        priority: "high",
        original: { taskName: "A", dueDate: "2026-09-10" },
      }),
    ).toBe(false);
  });
  expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
  expect(result.current.error).toContain("changed since editing began");
  expect(sources[path]).toContain("2026-09-20");
});

it("merges concurrent changes to different section properties", async () => {
  configExists = true;
  configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });
  const store = createStore();
  const first = renderBoard(store);
  const second = renderBoard(store);
  await waitFor(() => expect(first.result.current.hasLoaded && second.result.current.hasLoaded).toBe(true));
  await act(async () => {
    expect(
      await Promise.all([
        first.result.current.updateProject("Research", { colorId: "rose" }),
        second.result.current.updateProject("Research", { hidden: true }),
      ]),
    ).toEqual([true, true]);
  });
  expect(JSON.parse(configSource).projects).toEqual([{ name: "Research", colorId: "rose", hidden: true }]);
});

it("shows a repair path for invalid layout while keeping task files usable, then recovers", async () => {
  configExists = true;
  configSource = "{broken";
  sources["/notes/A.md"] = taskSource("A");
  const reveal = vi.fn(async () => ({ success: true as const }));
  window.api.revealInSystemFileManager = reveal;
  render(
    <Provider store={createStore()}>
      <TaskBoard />
    </Provider>,
  );
  await screen.findByText("Board layout needs repair");
  expect((screen.getByRole("button", { name: "Manage projects" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reveal configuration file" }));
  expect(reveal).toHaveBeenCalledWith("/notes/.todo/taskboard.json");
  fireEvent.click(screen.getByRole("button", { name: "Open task A" }));
  await waitFor(() => expect(boundaryMocks.open).toHaveBeenCalled());
  expect(configSource).toBe("{broken");
  configSource = JSON.stringify({ projects: [{ name: "Recovered", colorId: "blue" }], taskOrder: [] });
  fireEvent.click(screen.getByRole("button", { name: "Reload layout" }));
  await waitFor(() => expect(screen.queryByText("Board layout needs repair")).toBeNull());
  expect((screen.getByRole("button", { name: "Manage projects" }) as HTMLButtonElement).disabled).toBe(false);
});

it("keeps a renamed section consistent across mounted consumers without rediscovering its old name", async () => {
  sources["/notes/A.md"] = taskSource("A", "Research");
  configExists = true;
  configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });
  const store = createStore();
  const first = renderBoard(store);
  const second = renderBoard(store);
  await waitFor(() => expect(first.result.current.hasLoaded && second.result.current.hasLoaded).toBe(true));
  await act(async () => {
    expect(await first.result.current.updateProject("Research", { name: "Writing" })).toBe(true);
  });
  expect(first.result.current.orderedTasks[0].project).toBe("Writing");
  expect(second.result.current.orderedTasks[0].project).toBe("Writing");
  expect(JSON.parse(configSource).projects).toEqual([{ name: "Writing", colorId: "blue" }]);
});

it("preserves both concurrent task creations and shares their files and manual order", async () => {
  configExists = true;
  configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });
  boundaryMocks.createMarkdownFile.mockImplementation(async (_directory, filename, content) => {
    const file = note(`/notes/${filename}`);
    sources[file.path] = content;
    return file;
  });
  const store = createStore();
  const first = renderBoard(store);
  const second = renderBoard(store);
  await waitFor(() => expect(first.result.current.hasLoaded && second.result.current.hasLoaded).toBe(true));
  await act(async () => {
    expect(
      await Promise.all([
        first.result.current.taskActions.createTask({ taskName: "One", project: "Research" }),
        second.result.current.taskActions.createTask({ taskName: "Two", project: "Research" }),
      ]),
    ).toEqual([true, true]);
  });
  expect(JSON.parse(configSource).taskOrder).toEqual(["Two.md", "One.md"]);
  expect(first.result.current.orderedTasks.map(({ title }) => title)).toEqual(["Two", "One"]);
  expect(second.result.current.orderedTasks.map(({ title }) => title)).toEqual(["Two", "One"]);
});

it("retains the original draft baseline through a live board refresh", async () => {
  const path = "/notes/A.md";
  sources[path] = "---\ntype: task\ntask-project: Research\ntask-due: 2026-09-10\n---\nBody";
  const store = createStore();
  render(
    <Provider store={store}>
      <TaskBoard />
    </Provider>,
  );
  const card = await screen.findByRole("button", { name: "Open task A" });
  fireEvent.keyDown(card, { key: "F2" });
  await screen.findByRole("textbox", { name: "Task name" });
  fireEvent.click(screen.getByRole("radio", { name: "High" }));
  sources[path] = sources[path].replace("2026-09-10", "2026-09-20");
  const previousReads = apiMocks.readIndexedDocuments.mock.calls.length;
  act(() => store.set(reloadRevisionAtom, (revision) => revision + 1));
  await waitFor(() => expect(apiMocks.readIndexedDocuments.mock.calls.length).toBeGreaterThan(previousReads));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(boundaryMocks.saveFile).toHaveBeenCalledOnce());
  expect(sources[path]).toContain("task-due: 2026-09-20");
  expect(sources[path]).toContain("task-priority: high");
});

it("shares discovery across consumers and releases its subscriptions after the final unmount", async () => {
  sources["/notes/A.md"] = taskSource("A");
  const store = createStore();
  const first = renderBoard(store);
  const second = renderBoard(store);
  await waitFor(() => expect(second.result.current.orderedTasks).toHaveLength(1));
  expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledOnce();
  first.unmount();
  await act(async () => {
    store.set(reloadRevisionAtom, (value) => value + 1);
  });
  await waitFor(() => expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(2));
  second.unmount();
  await act(async () => {
    await Promise.resolve();
    store.set(reloadRevisionAtom, (value) => value + 1);
  });
  expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(2);
  const third = renderBoard(store);
  await waitFor(() => expect(third.result.current.orderedTasks).toHaveLength(1));
  expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(3);
});

it("retains a manifest-only section recovery across navigation and never rewrites successful files", async () => {
  sources["/notes/A.md"] = taskSource("A", "Research");
  configExists = true;
  configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });
  const store = createStore();
  const first = renderBoard(store);
  await waitFor(() => expect(first.result.current.orderedTasks).toHaveLength(1));
  apiMocks.upsertFile.mockResolvedValueOnce(false);
  await act(async () => expect(await first.result.current.updateProject("Research", { name: "Writing" })).toBe(false));
  expect(first.result.current.projectRecovery?.layoutPending).toBe(true);
  expect(first.result.current.projectRecovery?.files).toHaveLength(0);
  first.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  const second = renderBoard(store);
  await waitFor(() => expect(second.result.current.hasLoaded).toBe(true));
  await act(async () => expect(await second.result.current.projectRecovery!.retry()).toBe(true));
  expect(boundaryMocks.saveFile).toHaveBeenCalledOnce();
  expect(second.result.current.projectRecovery).toBeNull();
  expect(JSON.parse(configSource).projects).toEqual([{ name: "Writing", colorId: "blue" }]);
});

it("presents failed section files with open and retry actions", async () => {
  const { TaskBoardProjectRecovery } =
    await import("../src/renderer/src/features/task-board/TaskBoardProjects");
  const file = { ...note("/notes/Blocked.md"), title: "Blocked", status: "open" as const, metadataIssues: [] };
  const retry = vi.fn(async () => false);
  const open = vi.fn();
  const dismiss = vi.fn();
  render(
    <TaskBoardProjectRecovery
      recovery={{ title: "Section rename incomplete", files: [file], layoutPending: false, busy: false, retry }}
      onOpenFile={open}
      onRevealLayout={vi.fn()}
      onDismiss={dismiss}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open file Blocked.md" }));
  expect(open).toHaveBeenCalledWith(file);
  fireEvent.click(screen.getByRole("button", { name: "Retry remaining" }));
  expect(retry).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(dismiss).toHaveBeenCalledOnce();
});

it("does not duplicate initial discovery during StrictMode's effect replay", async () => {
  const { StrictMode } = await import("react");
  sources["/notes/A.md"] = taskSource("A");
  const store = createStore();
  const { result } = renderHook(taskBoardHook.useTaskBoard, {
    wrapper: ({ children }) => (
      <StrictMode>
        <Provider store={store}>{children}</Provider>
      </StrictMode>
    ),
  });
  await waitFor(() => expect(result.current.orderedTasks).toHaveLength(1));
  expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledOnce();
});

it("publishes board pins to the shared widget snapshot", async () => {
  const { taskBoardInspectorSnapshotAtom } = await import("../src/renderer/src/store/taskBoardInspectorStore");
  sources["/notes/A.md"] = taskSource("A");
  configExists = true;
  configSource = JSON.stringify({ projects: [], taskOrder: [], pinnedTasks: ["A.md"] });
  const { result, store } = renderBoard();
  await waitFor(() => expect(result.current.hasLoaded).toBe(true));
  expect(store.get(taskBoardInspectorSnapshotAtom)?.tasks[0].pinned).toBe(true);
  await act(async () => {
    await result.current.taskActions.pinTask(result.current.orderedTasks[0], false);
  });
  expect(store.get(taskBoardInspectorSnapshotAtom)?.tasks[0].pinned).toBe(false);
});
it("uses the current opening setting for the shared board open action", async () => {
  const config = await import("../src/renderer/src/config");
  const mode = vi.spyOn(config, "getTaskBoardOpenMode").mockResolvedValue("hover");
  sources["/notes/A.md"] = taskSource("A");
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.hasLoaded).toBe(true));
  const current = result.current.orderedTasks[0];
  await act(async () => {
    await result.current.taskActions.openTask(current);
  });
  expect(result.current.hoverTask?.task.path).toBe(current.path);
  expect(boundaryMocks.open).not.toHaveBeenCalled();
  act(() => result.current.closeHoverTask());
  mode.mockResolvedValue("tab");
  await act(async () => {
    await result.current.taskActions.openTask(current);
  });
  expect(boundaryMocks.open).toHaveBeenCalledWith(current);
  expect(result.current.hoverTask).toBeNull();
});
