import {
  apiMocks,
  note,
  taskSource,
  renderBoard,
  fixtures,
  resetTaskBoardFixtures,
  cleanupTaskBoardFixtures,
} from "./fixtures";
import { act, waitFor } from "@testing-library/react";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileBuffersByPathAtom } from "../../src/renderer/src/store/fileBufferStore";
import { fileTreeAtom, reloadRevisionAtom } from "../../src/renderer/src/store/fileExplorerStore";
import type { IndexedDocument, WorkspacePropertyQuery } from "../../src/shared/workspace-index";

beforeEach(resetTaskBoardFixtures);
afterEach(cleanupTaskBoardFixtures);

describe("Task Board refresh", () => {
  it("renders Markdown tasks without overwriting malformed board config", async () => {
    const file = note("/notes/Research.md");
    fixtures.sources[file.path] = taskSource("Research", "Research");
    fixtures.configExists = true;
    fixtures.configSource = "{not json";

    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks.map(({ path }) => path)).toEqual([file.path]));

    expect(result.current.projects.some(({ name }) => name === "Research")).toBe(true);
    expect(apiMocks.upsertFile).not.toHaveBeenCalled();
    expect(fixtures.configSource).toBe("{not json");
  });

  it("keeps an indexed Markdown task visible when invalid YAML prevents a property match", async () => {
    const file = note("/notes/Broken.md");
    fixtures.sources[file.path] = "---\ntype: task\nbroken: [\n---\nSupporting text.";
    const store = createStore();
    store.set(fileTreeAtom, [file]);

    const { result } = renderBoard(store);

    await waitFor(() => expect(result.current.allTasks.map(({ path }) => path)).toEqual([file.path]));
    expect(result.current.allTasks[0].metadataIssues).not.toHaveLength(0);
    expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalled();
    expect(apiMocks.readIndexedDocuments).toHaveBeenCalledWith([file.path]);
  });

  it("reads only indexed task candidates in a large non-task workspace", async () => {
    for (let index = 0; index < 250; index += 1) {
      fixtures.sources[`/notes/Note-${index}.md`] = `---\ntype: note\n---\n# Note ${index}`;
    }
    const task = note("/notes/Task.md");
    fixtures.sources[task.path] = taskSource("Task");

    const { result } = renderBoard();

    await waitFor(() => expect(result.current.allTasks.map(({ path }) => path)).toEqual([task.path]));
    expect(apiMocks.readIndexedDocuments).toHaveBeenCalledTimes(1);
    expect(apiMocks.readIndexedDocuments).toHaveBeenCalledWith([task.path]);
  });

  it("applies one manifest order and keeps unlisted Markdown tasks at the top", async () => {
    const first = note("/notes/First.md");
    const second = note("/notes/Second.md");
    const external = note("/notes/External.md");
    fixtures.sources[first.path] = taskSource("First", "Research");
    fixtures.sources[second.path] = taskSource("Second", "Research");
    fixtures.sources[external.path] = taskSource("External");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [{ name: "Research", colorId: "blue" }],
      taskOrder: [second.relativePath, first.relativePath],
    });
    const { result } = renderBoard();

    await waitFor(() =>
      expect(result.current.allTasks.map(({ title }) => title)).toEqual(["External", "Second", "First"]),
    );
    expect(result.current.allTasks.filter(({ project }) => project === "Research").map(({ title }) => title)).toEqual([
      "External",
      "Second",
      "First",
    ]);
  });

  it("prunes an externally stale path without hiding the moved task and incorporates its new path on reorder", async () => {
    const moved = note("/notes/Moved.md");
    const other = note("/notes/Other.md");
    fixtures.sources[moved.path] = taskSource("Moved");
    fixtures.sources[other.path] = taskSource("Other");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [],
      taskOrder: ["Old.md", other.relativePath],
    });
    const store = createStore();
    store.set(fileTreeAtom, [moved, other]);
    const { result } = renderBoard(store);

    await waitFor(() => expect(result.current.allTasks.map(({ path }) => path)).toEqual([moved.path, other.path]));
    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[1], {
          kind: "board",
          project: "Research",
          index: 0,
        }),
      ).toBe(true),
    );

    expect(JSON.parse(fixtures.configSource).taskOrder).toEqual([other.relativePath, moved.relativePath]);
  });

  it("loads every task and tag page with exact reserved-key queries", async () => {
    for (let index = 0; index < 101; index += 1) {
      const path = `/notes/Task-${String(index).padStart(3, "0")}.md`;
      fixtures.sources[path] = taskSource(`Task ${index}`).replace(
        "---\n#",
        `tags: [tag-${String(index).padStart(3, "0")}]\n---\n#`,
      );
    }
    const { result } = renderBoard();

    await waitFor(() => expect(result.current.allTasks).toHaveLength(101));
    expect(apiMocks.readIndexedDocuments.mock.calls.map(([paths]) => paths.length)).toEqual([100, 1]);
    const typeRequests = apiMocks.queryWorkspaceProperty.mock.calls
      .map(([request]) => request as WorkspacePropertyQuery)
      .filter(({ key }) => key === "type");
    expect(typeRequests.map(({ offset }) => offset)).toEqual([0, 100]);
    expect(
      typeRequests.every(({ limit, value }) => limit === 100 && value?.type === "string" && value.value === "task"),
    ).toBe(true);

    let tags: string[] = [];
    await act(async () => {
      tags = await result.current.taskActions.loadTags();
    });
    expect(tags).toContain("tag-100");
    const tagRequests = apiMocks.queryWorkspaceProperty.mock.calls
      .map(([request]) => request as WorkspacePropertyQuery)
      .filter(({ key }) => key === "tags");
    expect(tagRequests.map(({ offset }) => offset)).toEqual([0, 100]);
    expect(tagRequests.every(({ limit, value }) => limit === 100 && !value)).toBe(true);
  });

  it("refreshes the index only on reload requests and applies open-buffer task edits locally", async () => {
    const file = note("/notes/Research.md");
    const source = taskSource("Research");
    fixtures.sources[file.path] = source;
    const { result, store } = renderBoard();

    await waitFor(() => expect(result.current.allTasks.map(({ path }) => path)).toEqual([file.path]));
    const beforeTree = apiMocks.queryWorkspaceProperty.mock.calls.length;

    act(() => store.set(fileTreeAtom, [file]));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(beforeTree);

    act(() => store.set(reloadRevisionAtom, (revision) => revision + 1));
    await waitFor(() => expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(beforeTree + 1));

    const beforeBuffer = apiMocks.queryWorkspaceProperty.mock.calls.length;
    act(() =>
      store.set(fileBuffersByPathAtom, {
        [file.path]: { savedText: source, editorText: source },
      }),
    );
    expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(beforeBuffer);

    const editedSource = source.replace(
      "task-project: Research\n---\n# Research",
      "tags: [fast]\ntask-project: Focus\ntask-priority: high\ntask-due: 2026-08-01\n---\n# Research",
    );
    await act(async () => {
      store.set(fileBuffersByPathAtom, {
        [file.path]: { savedText: source, editorText: editedSource },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(beforeBuffer);
    expect(result.current.allTasks[0]?.tags).toEqual(["fast"]);
    expect(result.current.allTasks[0]?.project).toBe("Focus");
    expect(result.current.allTasks[0]?.priority).toBe("high");
    expect(result.current.allTasks[0]?.dueDate).toBe("2026-08-01");

    act(() =>
      store.set(fileBuffersByPathAtom, {
        [file.path]: { savedText: editedSource, editorText: editedSource },
      }),
    );
    expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(beforeBuffer);

    const converted = note("/notes/Converted.md");
    fixtures.sources[converted.path] = "# Converted\n";
    act(() =>
      store.set(fileBuffersByPathAtom, {
        [file.path]: { savedText: editedSource, editorText: editedSource },
        [converted.path]: { savedText: "# Converted\n", editorText: taskSource("Converted") },
      }),
    );
    await waitFor(() => expect(result.current.allTasks.map(({ path }) => path)).toContain(converted.path));
    expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(beforeBuffer);

    act(() =>
      store.set(fileBuffersByPathAtom, {
        [file.path]: { savedText: source, editorText: "# Research\n" },
        [converted.path]: { savedText: fixtures.sources[converted.path], editorText: taskSource("Converted") },
      }),
    );
    await waitFor(() => expect(result.current.allTasks.map(({ path }) => path)).toEqual([converted.path]));

    act(() => store.set(fileBuffersByPathAtom, {}));
    await waitFor(() => expect(result.current.allTasks.map(({ path }) => path)).toEqual([file.path]));
    expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(beforeBuffer);
  });

  it("keeps the newest index snapshot when an older request finishes last", async () => {
    const oldFile = note("/notes/Old.md");
    const newFile = note("/notes/New.md");
    const { result, store } = renderBoard();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let resolveOld!: (entries: unknown[]) => void;
    apiMocks.queryWorkspaceProperty.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    act(() => store.set(reloadRevisionAtom, (revision) => revision + 1));
    await waitFor(() => expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(2));

    fixtures.sources[newFile.path] = taskSource("New");
    apiMocks.queryWorkspaceProperty.mockResolvedValueOnce([
      { file: newFile, values: [{ type: "string", value: "task" }] },
    ]);
    act(() => store.set(reloadRevisionAtom, (revision) => revision + 1));
    await waitFor(() => expect(result.current.allTasks.map(({ path }) => path)).toEqual([newFile.path]));

    const configReadsBeforeOldFinished = apiMocks.doesFileExist.mock.calls.length;
    await act(async () => {
      fixtures.sources[oldFile.path] = taskSource("Old");
      resolveOld([{ file: oldFile, values: [{ type: "string", value: "task" }] }]);
    });
    await waitFor(() => expect(apiMocks.doesFileExist).toHaveBeenCalledTimes(configReadsBeforeOldFinished + 1));
    expect(result.current.allTasks.map(({ path }) => path)).toEqual([newFile.path]);
  });

  it("does not let a refresh overwrite a task mutation that finished later", async () => {
    const file = note("/notes/Task.md");
    const staleSource = taskSource("Task");
    fixtures.sources[file.path] = staleSource;
    const { result, store } = renderBoard();
    await waitFor(() => expect(result.current.allTasks).toHaveLength(1));

    let resolveSnapshot!: (documents: IndexedDocument[]) => void;
    let snapshotRequested = false;
    apiMocks.readIndexedDocuments.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          snapshotRequested = true;
          resolveSnapshot = resolve;
        }),
    );
    act(() => store.set(reloadRevisionAtom, (revision) => revision + 1));
    await waitFor(() => expect(snapshotRequested).toBe(true));

    await act(async () => expect(await result.current.taskActions.completeTask(result.current.allTasks[0])).toBe(true));
    expect(result.current.allTasks[0].status).toBe("done");

    await act(async () => resolveSnapshot([{ file, source: staleSource }]));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allTasks[0].status).toBe("done");

    expect(result.current.allTasks).toHaveLength(1);
    expect(result.current.allTasks[0].status).toBe("done");
  });
});

it("keeps legacy child files as ordinary tasks without interpreting or rewriting their IDs", async () => {
  fixtures.sources["/notes/Parent.md"] = taskSource("Parent").replace("type: task", "type: task\ntask-id: parent");
  fixtures.sources["/notes/Child.md"] = taskSource("Child").replace("type: task", "type: task\ntask-parent: parent");
  const before = { ...fixtures.sources };
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(2));
  expect(result.current.allTasks.every((task) => !task.subtasks?.length)).toBe(true);
  expect(fixtures.sources).toEqual(before);
});
