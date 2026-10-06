import {
  boundaryMocks,
  apiMocks,
  note,
  openedVersion,
  taskSource,
  renderBoard,
  frontmatterString,
  isContextMenuAction,
  fixtures,
  resetTaskBoardFixtures,
  cleanupTaskBoardFixtures,
} from "./fixtures";
import { editorSubtaskRequestAtom } from "../../src/renderer/src/store/editorPaneStore";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskBoard } from "../../src/renderer/src/features/task-board/TaskBoard";
import { getFrontmatterProperty, getFrontmatterStringList, parseFrontmatter } from "../../src/shared/frontmatter";
import { fileBuffersByPathAtom } from "../../src/renderer/src/store/fileBufferStore";
import { fileTreeAtom } from "../../src/renderer/src/store/fileExplorerStore";
import { notificationsAtom } from "../../src/renderer/src/store/NotificationsStore";
import { contextMenuRequestAtom } from "../../src/renderer/src/store/contextMenuStore";

beforeEach(resetTaskBoardFixtures);
afterEach(cleanupTaskBoardFixtures);

describe("Task Board task actions", () => {
  it("reorders within a project by writing only the shared manifest", async () => {
    const first = note("/notes/First.md");
    const second = note("/notes/Second.md");
    fixtures.sources[first.path] = taskSource("First", "Research");
    fixtures.sources[second.path] = taskSource("Second", "Research");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks).toHaveLength(2));

    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[1], {
          kind: "board",
          project: "Research",
          index: 0,
        }),
      ).toBe(true),
    );

    expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
    expect(JSON.parse(fixtures.configSource).taskOrder).toEqual([second.relativePath, first.relativePath]);
    expect(result.current.allTasks.map(({ title }) => title)).toEqual(["Second", "First"]);
  });

  it("does not persist a no-op move when a closed task occupies an order slot", async () => {
    const first = note("/notes/First.md");
    const completed = note("/notes/Completed.md");
    const second = note("/notes/Second.md");
    fixtures.sources[first.path] = taskSource("First", "Research");
    fixtures.sources[completed.path] = taskSource("Completed", "Research", true);
    fixtures.sources[second.path] = taskSource("Second", "Research");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [{ name: "Research", colorId: "blue" }],
      taskOrder: [first.relativePath, completed.relativePath, second.relativePath],
    });
    const { result } = renderBoard();
    await waitFor(() =>
      expect(result.current.allTasks.map(({ path }) => path)).toEqual([first.path, completed.path, second.path]),
    );
    const writes = apiMocks.upsertFile.mock.calls.length;

    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[0], {
          kind: "board",
          project: "Research",
          index: 0,
        }),
      ).toBe(true),
    );

    expect(apiMocks.upsertFile).toHaveBeenCalledTimes(writes);
    expect(JSON.parse(fixtures.configSource).taskOrder).toEqual([
      first.relativePath,
      completed.relativePath,
      second.relativePath,
    ]);
  });

  it("keeps a successful project change when saving its position fails", async () => {
    const file = note("/notes/Task.md");
    fixtures.sources[file.path] = taskSource("Task", "Personal");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });
    apiMocks.upsertFile.mockResolvedValueOnce(false);
    const { result, store } = renderBoard();
    await waitFor(() => expect(result.current.allTasks).toHaveLength(1));

    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[0], {
          kind: "board",
          project: "Research",
          index: 0,
        }),
      ).toBe(false),
    );

    await waitFor(() => expect(boundaryMocks.saveFile).toHaveBeenCalledOnce());
    expect(frontmatterString(fixtures.sources[file.path], "task-project")).toBe("Research");
    expect(result.current.allTasks[0].project).toBe("Research");
    expect(store.get(notificationsAtom).at(-1)?.title).toBe("Task position not saved");
  });

  it("serializes simultaneous project and order writes without overwriting either patch", async () => {
    const first = note("/notes/First.md");
    const second = note("/notes/Second.md");
    fixtures.sources[first.path] = taskSource("First", "Research");
    fixtures.sources[second.path] = taskSource("Second", "Research");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [{ name: "Research", colorId: "blue" }],
      taskOrder: [first.relativePath, second.relativePath],
    });
    let resolveFirst!: (saved: boolean) => void;
    apiMocks.upsertFile
      .mockImplementationOnce(
        async (_path: string, content: string) =>
          new Promise<boolean>((resolve) => {
            fixtures.configSource = content;
            resolveFirst = resolve;
          }),
      )
      .mockImplementation(async (_path: string, content: string) => {
        fixtures.configSource = content;
        return true;
      });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks).toHaveLength(2));

    let move!: Promise<boolean>;
    let recolor!: Promise<boolean>;
    act(() => {
      move = result.current.taskActions.moveTask(result.current.allTasks[1], {
        kind: "board",
        project: "Research",
        index: 0,
      });
      recolor = result.current.updateProject("Research", { colorId: "rose" });
    });
    await waitFor(() => expect(apiMocks.upsertFile).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveFirst(true);
      expect(await move).toBe(true);
      expect(await recolor).toBe(true);
    });

    expect(JSON.parse(fixtures.configSource)).toEqual({
      projects: [{ name: "Research", colorId: "rose" }],
      taskOrder: [second.relativePath, first.relativePath],
    });
  });

  it("completes a task by saving the same path", async () => {
    const file = note("/notes/Task.md");
    fixtures.sources[file.path] = taskSource("Task");
    const store = createStore();
    store.set(fileTreeAtom, [file]);
    const { result } = renderBoard(store);
    await waitFor(() => expect(result.current.allTasks).toHaveLength(1));
    const indexQueriesBeforeCompletion = apiMocks.queryWorkspaceProperty.mock.calls.length;

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.taskActions.completeTask(result.current.allTasks[0]);
    });

    expect(succeeded).toBe(true);
    expect(boundaryMocks.saveFile).toHaveBeenCalledOnce();
    expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(indexQueriesBeforeCompletion);
    expect(boundaryMocks.saveFile.mock.calls[0][0]).toBe(file.path);
    expect(frontmatterString(boundaryMocks.saveFile.mock.calls[0][1], "task-status")).toBe("done");
    expect(
      getFrontmatterProperty(parseFrontmatter(boundaryMocks.saveFile.mock.calls[0][1]), "task-closed"),
    ).toBeTruthy();
    await waitFor(() => expect(result.current.allTasks[0].status).toBe("done"));
  });

  it("keeps completed tasks reversible without dropping manual order", async () => {
    const first = note("/notes/First.md");
    const second = note("/notes/Second.md");
    const completed = note("/notes/Completed.md");
    fixtures.sources[first.path] = taskSource("First");
    fixtures.sources[second.path] = taskSource("Second");
    fixtures.sources[completed.path] = [
      "---",
      "type: task",
      "task-status: done",
      "task-closed: 2026-08-01",
      "---",
      "Completed body",
    ].join("\n");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [],
      taskOrder: [first.relativePath, second.relativePath, completed.relativePath],
    });
    const { result } = renderBoard();
    await waitFor(() =>
      expect(result.current.orderedTasks.map(({ path }) => path)).toEqual([first.path, second.path, completed.path]),
    );

    await act(async () =>
      expect(await result.current.taskActions.cancelTask(result.current.orderedTasks[0])).toBe(true),
    );
    expect(JSON.parse(fixtures.configSource).taskOrder).toEqual([
      first.relativePath,
      second.relativePath,
      completed.relativePath,
    ]);
    expect(result.current.allTasks.map(({ path }) => path)).toEqual([second.path, completed.path]);

    expect(result.current.orderedTasks.find(({ path }) => path === first.path)?.status).toBe("cancelled");
    expect(result.current.orderedTasks[0].status).toBe("cancelled");
    expect(result.current.orderedTasks[0].closedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await act(async () =>
      expect(
        await result.current.taskActions.reopenTask(
          result.current.orderedTasks.find(({ path }) => path === completed.path)!,
        ),
      ).toBe(true),
    );
    expect(result.current.orderedTasks.find(({ path }) => path === completed.path)?.status).toBe("open");

    await act(async () =>
      expect(await result.current.taskActions.reopenTask(result.current.orderedTasks[0])).toBe(true),
    );
    expect(result.current.allTasks).toHaveLength(3);
    await waitFor(() =>
      expect(result.current.orderedTasks.map(({ path }) => path)).toEqual([first.path, second.path, completed.path]),
    );
    expect(result.current.orderedTasks[0].status).toBe("open");
    expect(result.current.orderedTasks[0].closedDate).toBeUndefined();
    expect(JSON.parse(fixtures.configSource).taskOrder).toEqual([
      first.relativePath,
      second.relativePath,
      completed.relativePath,
    ]);
  });

  it("blocks lifecycle edits for authored metadata that cannot be changed safely", async () => {
    const file = note("/notes/Broken.md");
    fixtures.sources[file.path] = "---\ntype: task\ntask-status: [open]\n---\nBody";
    const { result, store } = renderBoard();
    await waitFor(() => expect(result.current.allTasks).toHaveLength(1));

    await act(async () =>
      expect(await result.current.taskActions.completeTask(result.current.allTasks[0])).toBe(false),
    );

    expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
    expect(store.get(notificationsAtom).at(-1)?.title).toBe("Task completion failed");
    expect(result.current.allTasks[0].status).toBe("open");
  });

  it("deletes a task through the generic file removal flow", async () => {
    const file = note("/notes/Task.md");
    fixtures.sources[file.path] = taskSource("Task");
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks).toHaveLength(1));

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.taskActions.deleteTask(result.current.allTasks[0]);
    });

    expect(succeeded).toBe(true);
    expect(boundaryMocks.remove).toHaveBeenCalledOnce();
    expect(boundaryMocks.remove).toHaveBeenCalledWith(expect.objectContaining({ path: file.path }));
  });

  it("saves a display title without renaming the task file", async () => {
    const file = note("/notes/Task.md");
    fixtures.sources[file.path] = taskSource("Task");
    boundaryMocks.saveRename.mockResolvedValueOnce({ success: true, newPath: "/notes/Renamed.md" });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks).toHaveLength(1));

    await act(async () =>
      expect(
        await result.current.taskActions.updateTask(result.current.allTasks[0], { taskName: "Renamed", tags: [] }),
      ).toBe(true),
    );

    expect(boundaryMocks.saveRename).not.toHaveBeenCalled();
    expect(frontmatterString(fixtures.sources[file.path], "task-title")).toBe("Renamed");
    expect(result.current.allTasks[0].title).toBe("Renamed");
  });

  it("creates an ordinary Markdown task under Tasks through the generic action", async () => {
    const created = note("/notes/Tasks/Read Paper.md");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }] });
    boundaryMocks.createMarkdownFile.mockResolvedValue(created);
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.projects).toEqual([{ name: "Research", colorId: "blue" }]));

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.taskActions.createTask({
        taskName: "Read Paper",
        dueDate: "2026-07-23",
        initialBody: "Capture the claims.",
        priority: "high",
        project: "Research",
        tags: ["paper", "reading"],
      });
    });

    expect(succeeded).toBe(true);
    expect(boundaryMocks.createMarkdownFile).toHaveBeenCalledOnce();
    const [directory, filename, content, openAfterCreation] = boundaryMocks.createMarkdownFile.mock.calls[0];
    expect(directory).toBe("/notes/Tasks");
    expect(filename).toBe("Read Paper.md");
    expect(openAfterCreation).toBe(false);
    expect(frontmatterString(content, "type")).toBe("task");
    expect(frontmatterString(content, "task-project")).toBe("Research");
    expect(frontmatterString(content, "task-priority")).toBe("high");
    expect(frontmatterString(content, "task-status")).toBe("open");
    expect(content.endsWith("Capture the claims.")).toBe(true);
    expect(content).not.toContain("# Read Paper");
    expect(getFrontmatterProperty(parseFrontmatter(content), "task-due")?.value).toEqual({
      kind: "date",
      dateOnly: true,
      source: "2026-07-23",
      value: "2026-07-23",
    });
    expect(getFrontmatterStringList(parseFrontmatter(content), "tags")).toEqual(["paper", "reading"]);
    expect(result.current.allTasks.map(({ path }) => path)).toEqual([created.path]);
    expect(JSON.parse(fixtures.configSource).taskOrder).toEqual([created.relativePath]);
    expect(JSON.parse(fixtures.configSource)).not.toHaveProperty("newTaskFolder");
  });

  it("creates new tasks in the configured workspace folder", async () => {
    const created = note("/notes/Planning/Read Paper.md");
    window.config = {
      getMainDirectoryPathSync: () => "/notes",
      getConfigValue: vi.fn(async () => "Planning"),
    } as unknown as Window["config"];
    boundaryMocks.createMarkdownFile.mockResolvedValue(created);
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    await act(async () => {
      expect(
        await result.current.taskActions.createTask({ taskName: "Read Paper", initialBody: "Capture the claims." }),
      ).toBe(true);
    });

    expect(boundaryMocks.createMarkdownFile).toHaveBeenCalledWith(
      "/notes/Planning",
      "Read Paper.md",
      expect.any(String),
      false,
      { numberOnCollision: true },
    );
  });

  it("rejects empty and multiline task names before filesystem creation", async () => {
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    for (const taskName of ["", "  ", "Two\nlines"]) {
      await act(async () =>
        expect(
          await result.current.taskActions.createTask({
            taskName,
            initialBody: "Body",
          }),
        ).toBe(false),
      );
    }

    expect(boundaryMocks.createMarkdownFile).not.toHaveBeenCalled();
  });

  it("moves one task by editing only that Markdown note", async () => {
    const first = note("/notes/First.md");
    const second = note("/notes/Second.md");
    fixtures.sources[first.path] = taskSource("First", "Personal");
    fixtures.sources[second.path] = taskSource("Second", "Research");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [
        { name: "Research", colorId: "blue" },
        { name: "Personal", colorId: "violet" },
      ],
    });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks).toHaveLength(2));

    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[0], {
          kind: "board",
          project: "Research",
          index: 0,
        }),
      ).toBe(true),
    );

    await waitFor(() => expect(boundaryMocks.saveFile).toHaveBeenCalledOnce());
    expect(boundaryMocks.saveFile.mock.calls[0][0]).toBe(first.path);
    expect(frontmatterString(fixtures.sources[first.path], "task-project")).toBe("Research");
    expect(frontmatterString(fixtures.sources[second.path], "task-project")).toBe("Research");

    boundaryMocks.saveFile.mockClear();
    const moved = result.current.allTasks.find(({ path }) => path === first.path)!;
    await act(async () =>
      expect(await result.current.taskActions.moveTask(moved, { kind: "board", project: "Personal", index: 0 })).toBe(
        true,
      ),
    );
    expect(boundaryMocks.saveFile).toHaveBeenCalledOnce();
    expect(frontmatterString(fixtures.sources[first.path], "task-project")).toBe("Personal");
  });

  it("rejects an unassigned move without changing the buffered project", async () => {
    const file = note("/notes/Open.md");
    const source = taskSource("Open task", "Research");
    fixtures.sources[file.path] = source;
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });
    const store = createStore();
    store.set(fileTreeAtom, [file]);
    store.set(fileBuffersByPathAtom, { [file.path]: { savedText: source, editorText: source } });
    const { result } = renderBoard(store);
    await waitFor(() => expect(result.current.allTasks[0]?.project).toBe("Research"));

    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[0], {
          kind: "board",
          project: undefined,
          index: 0,
        }),
      ).toBe(false),
    );

    expect(frontmatterString(fixtures.sources[file.path], "task-project")).toBe("Research");
    expect(frontmatterString(store.get(fileBuffersByPathAtom)[file.path].editorText, "task-project")).toBe("Research");
    expect(result.current.allTasks[0]?.project).toBe("Research");
  });

  it("keeps a cross-project move at its intended position while both writes settle", async () => {
    const first = note("/notes/First.md");
    const second = note("/notes/Second.md");
    const third = note("/notes/Third.md");
    fixtures.sources[first.path] = taskSource("First", "Personal");
    fixtures.sources[second.path] = taskSource("Second", "Research");
    fixtures.sources[third.path] = taskSource("Third", "Research");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });

    let resolveSave!: () => void;
    boundaryMocks.saveFile.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          fixtures.sources[path] = content;
          resolveSave = () => resolve({ success: true });
        }),
    );
    let resolveConfig!: () => void;
    apiMocks.upsertFile.mockImplementationOnce(
      (_path: string, content: string) =>
        new Promise((resolve) => {
          fixtures.configSource = content;
          resolveConfig = () => resolve(true);
        }),
    );

    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks).toHaveLength(3));
    const researchTitles = () =>
      result.current.allTasks.filter(({ project }) => project === "Research").map(({ title }) => title);

    let move!: Promise<boolean>;
    act(() => {
      move = result.current.taskActions.moveTask(result.current.allTasks[0], {
        kind: "board",
        project: "Research",
        index: 1,
      });
    });
    await waitFor(() => expect(researchTitles()).toEqual(["Second", "First", "Third"]));

    await act(async () => resolveSave());
    await waitFor(() => expect(apiMocks.upsertFile).toHaveBeenCalledOnce());
    expect(researchTitles()).toEqual(["Second", "First", "Third"]);

    await act(async () => {
      resolveConfig();
      expect(await move).toBe(true);
    });
    expect(researchTitles()).toEqual(["Second", "First", "Third"]);
  });

  it("settles an open-buffer edit without erasing typing that arrives during the save", async () => {
    const file = note("/notes/Open.md");
    const source = `${taskSource("Open task")}Draft details.`;
    fixtures.sources[file.path] = source;
    const store = createStore();
    store.set(fileTreeAtom, [file]);
    store.set(fileBuffersByPathAtom, {
      [file.path]: { savedText: source, editorText: source },
    });
    const { result } = renderBoard(store);
    await waitFor(() => expect(result.current.allTasks).toHaveLength(1));

    let resolveSave!: (result: { success: true }) => void;
    boundaryMocks.saveFile.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    let completion!: Promise<boolean>;
    act(() => {
      completion = result.current.taskActions.completeTask(result.current.allTasks[0]);
    });
    await waitFor(() => expect(boundaryMocks.saveFile).toHaveBeenCalledOnce());

    const staged = store.get(fileBuffersByPathAtom)[file.path];
    expect(staged.savedText).toBe(source);
    expect(frontmatterString(staged.editorText, "task-status")).toBe("done");

    const typedText = `${staged.editorText}\nTyped while saving.`;
    act(() =>
      store.set(fileBuffersByPathAtom, {
        [file.path]: { ...staged, editorText: typedText },
      }),
    );
    await act(async () => {
      resolveSave({ success: true });
      expect(await completion).toBe(true);
    });

    expect(store.get(fileBuffersByPathAtom)[file.path]).toEqual({
      savedText: staged.editorText,
      editorText: typedText,
    });
  });
});

it("reports successful creation outside a date filter and offers the saved note", async () => {
  const created = note("/notes/Tasks/New task.md");
  boundaryMocks.createMarkdownFile.mockResolvedValue(created);
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });
  const { result, store } = renderBoard();
  await waitFor(() => expect(result.current.hasLoaded).toBe(true));
  act(() => result.current.setPreferences({ ...result.current.preferences, dueFilter: "today" }));
  await act(async () => {
    expect(await result.current.taskActions.createTask({ taskName: "New task" })).toBe(true);
  });
  const notification = store.get(notificationsAtom).find((item) => item.title === "Task created outside this view");
  expect(notification?.message).toContain("does not match");
  notification?.action?.onClick();
  expect(boundaryMocks.open).toHaveBeenCalledWith(expect.objectContaining({ path: created.path }));
});

it("changes project without rewriting canonical order for a filtered drag", async () => {
  fixtures.sources["/notes/A.md"] = taskSource("A");
  fixtures.sources["/notes/B.md"] = taskSource("B", "Research");
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({
    projects: [{ name: "Research", colorId: "blue" }],
    taskOrder: ["A.md", "B.md"],
  });
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(2));
  const before = fixtures.configSource;
  await act(async () => {
    expect(
      await result.current.taskActions.moveTask(result.current.allTasks[0], {
        kind: "board",
        project: "Research",
        index: 99,
        projectOnly: true,
      }),
    ).toBe(true);
  });
  expect(frontmatterString(fixtures.sources["/notes/A.md"], "task-project")).toBe("Research");
  expect(fixtures.configSource).toBe(before);
});

it("reads note checkboxes as subtasks, saves checks in place, and appends UI additions without a heading", async () => {
  fixtures.sources["/notes/Parent.md"] =
    taskSource("Parent") + "\nNotes before.\n\n- [ ] First\n\n## Later\n- [x] Second\n";
  const { result, store } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(1));
  render(
    <Provider store={store}>
      <TaskBoard />
    </Provider>,
  );
  await screen.findByRole("checkbox", { name: "Complete subtask First" });
  expect(screen.queryByRole("button", { name: "Change priority for Parent" })).toBeNull();
  expect(screen.getByText("1/2")).toBeTruthy();
  expect(
    screen.getByRole("checkbox", { name: "Uncheck subtask Second" }).querySelector('[data-celebrate="true"]'),
  ).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Complete subtask First" }));
  expect(
    screen.getByRole("checkbox", { name: "Uncheck subtask First" }).querySelector('[data-celebrate="true"]'),
  ).toBeTruthy();
  expect(screen.getByText("2/2")).toBeTruthy();
  await waitFor(() => expect(fixtures.sources["/notes/Parent.md"]).toContain("- [x] First"));
  expect(
    screen.getByRole("checkbox", { name: "Uncheck subtask First" }).querySelector('[data-celebrate="true"]'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "2 of 2 subtasks completed" }));
  expect(screen.queryByRole("checkbox", { name: "Uncheck subtask First" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "2 of 2 subtasks completed" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Uncheck subtask First" }));
  expect(screen.getByText("1/2")).toBeTruthy();
  await waitFor(() => expect(fixtures.sources["/notes/Parent.md"]).toContain("- [ ] First"));
  expect(screen.queryByRole("button", { name: "Add subtask" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Task actions for Parent" }));
  const addSubtask = store
    .get(contextMenuRequestAtom)
    ?.entries.filter(isContextMenuAction)
    .find((entry) => entry.id === "add-subtask");
  expect(addSubtask).toBeDefined();
  act(() => {
    void addSubtask?.onSelect?.();
  });
  fireEvent.change(screen.getByRole("textbox", { name: "New subtask for Parent" }), {
    target: { value: "Third: review?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add subtask" }));
  await waitFor(() => expect(fixtures.sources["/notes/Parent.md"]).toMatch(/- \[ \] Third: review\?\n$/));
  expect(fixtures.sources["/notes/Parent.md"]).not.toContain("## Subtasks");
  expect(fixtures.sources["/notes/Parent.md"]).not.toContain("task-parent");
  expect(screen.getByText("1/3")).toBeTruthy();
});

it("restores the checkbox and count when its note cannot be saved", async () => {
  fixtures.sources["/notes/Parent.md"] = taskSource("Parent") + "\n- [ ] First\n";
  const { result, store } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(1));
  render(
    <Provider store={store}>
      <TaskBoard />
    </Provider>,
  );
  await screen.findByRole("checkbox", { name: "Complete subtask First" });
  boundaryMocks.saveFile.mockResolvedValueOnce({ success: false, error: "Disk unavailable" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Complete subtask First" }));
  expect(screen.getByText("1/1")).toBeTruthy();
  await waitFor(() => expect(screen.getByText("0/1")).toBeTruthy());
  expect(fixtures.sources["/notes/Parent.md"]).toContain("- [ ] First");
  expect(screen.getByText("Could not save the subtask. Try again.")).toBeTruthy();
});

it("persists pins only in board settings and restores them on refresh", async () => {
  const file = note("/notes/Pinned.md");
  const original = taskSource("Pinned");
  fixtures.sources[file.path] = original;
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(1));
  await act(async () => {
    expect(await result.current.taskActions.pinTask(result.current.allTasks[0], true)).toBe(true);
  });
  expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual(["Pinned.md"]);
  expect(result.current.allTasks[0].pinned).toBe(true);
  expect(fixtures.sources[file.path]).toBe(original);
  expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.allTasks[0].pinned).toBe(true);
  await act(async () => {
    expect(await result.current.taskActions.pinTask(result.current.allTasks[0], false)).toBe(true);
  });
  expect(result.current.allTasks[0].pinned).toBe(false);
  expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([]);
  expect(fixtures.sources[file.path]).toBe(original);
});

it.each([
  { label: "completed", close: "completeTask" as const, status: "done" },
  { label: "cancelled", close: "cancelTask" as const, status: "cancelled" },
])("removes a pin when a task is $label and does not restore it on reopen", async ({ close, status }) => {
  const file = note("/notes/Pinned.md");
  fixtures.sources[file.path] = taskSource("Pinned");
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({
    projects: [],
    taskOrder: [file.relativePath],
    pinnedTasks: [file.relativePath],
  });
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.orderedTasks[0]?.pinned).toBe(true));

  await act(async () => expect(await result.current.taskActions[close](result.current.orderedTasks[0])).toBe(true));
  await waitFor(() => expect(result.current.orderedTasks[0]?.status).toBe(status));
  expect(result.current.orderedTasks[0].pinned).toBe(false);
  expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([]);
  expect(JSON.parse(fixtures.configSource).taskOrder).toEqual([file.relativePath]);

  await act(async () => expect(await result.current.taskActions.reopenTask(result.current.orderedTasks[0])).toBe(true));
  await waitFor(() => expect(result.current.orderedTasks[0]?.status).toBe("open"));
  expect(result.current.orderedTasks[0].pinned).toBe(false);
});

it("ignores a stale saved pin on an already completed task", async () => {
  const file = note("/notes/Done.md");
  fixtures.sources[file.path] = taskSource("Done", undefined, true);
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({ projects: [], taskOrder: [], pinnedTasks: [file.relativePath] });
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.allTasks[0]?.status).toBe("done"));
  expect(result.current.allTasks[0].pinned).toBe(false);
  await act(async () => expect(await result.current.taskActions.pinTask(result.current.allTasks[0], true)).toBe(false));
  expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([file.relativePath]);
  await act(async () => expect(await result.current.taskActions.reopenTask(result.current.allTasks[0])).toBe(true));
  await waitFor(() => expect(result.current.allTasks[0]?.status).toBe("open"));
  expect(result.current.allTasks[0].pinned).toBe(false);
  expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([]);
});

it("retains a pin when task completion cannot be saved", async () => {
  const file = note("/notes/Pinned.md");
  fixtures.sources[file.path] = taskSource("Pinned");
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({ projects: [], taskOrder: [], pinnedTasks: [file.relativePath] });
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.allTasks[0]?.pinned).toBe(true));
  boundaryMocks.saveFile.mockResolvedValueOnce({ success: false, error: "Disk unavailable" });
  await act(async () => expect(await result.current.taskActions.completeTask(result.current.allTasks[0])).toBe(false));
  expect(result.current.allTasks[0].pinned).toBe(true);
  expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([file.relativePath]);
});

it("reports a partial close when removing the saved pin fails", async () => {
  const file = note("/notes/Pinned.md");
  fixtures.sources[file.path] = taskSource("Pinned");
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({ projects: [], taskOrder: [], pinnedTasks: [file.relativePath] });
  const { result, store } = renderBoard();
  await waitFor(() => expect(result.current.allTasks[0]?.pinned).toBe(true));
  apiMocks.upsertFile.mockResolvedValueOnce(false);

  await act(async () => expect(await result.current.taskActions.completeTask(result.current.allTasks[0])).toBe(true));
  await waitFor(() => expect(result.current.allTasks[0]?.status).toBe("done"));
  expect(result.current.allTasks[0].pinned).toBe(false);
  expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([file.relativePath]);
  expect(store.get(notificationsAtom).some((notification) => notification.title === "Pin removal failed")).toBe(true);
});

it("queues the selected subtask for the opened parent note", async () => {
  fixtures.sources["/notes/Parent.md"] = taskSource("Parent") + "\n- [ ] First\n- [ ] Second\n";
  boundaryMocks.open.mockResolvedValue(true);
  const { result, store } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(1));
  const task = result.current.allTasks[0];
  const target = { index: 1, expected: task.subtasks! };
  await act(async () => {
    await result.current.taskActions.openTask(task, target);
  });
  expect(boundaryMocks.open).toHaveBeenCalledWith(task);
  expect(store.get(editorSubtaskRequestAtom)).toEqual(expect.objectContaining({ filePath: task.path, target }));
  store.set(editorSubtaskRequestAtom, null);
  boundaryMocks.open.mockResolvedValue(false);
  await act(async () => {
    await result.current.taskActions.openTask(task, target);
  });
  expect(store.get(editorSubtaskRequestAtom)).toBeNull();
});

it("opens tasks in a hover window when selected without opening a tab", async () => {
  window.config.getConfigValue = vi.fn(async () => "hover") as typeof window.config.getConfigValue;
  fixtures.sources["/notes/Hover.md"] = taskSource("Hover") + "\n- [ ] Child\n";
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(1));
  const task = result.current.allTasks[0];
  const target = { index: 0, expected: task.subtasks! };
  await act(async () => {
    await result.current.taskActions.openTask(task, target);
  });
  expect(result.current.hoverTask).toEqual({ task, target });
  expect(boundaryMocks.open).not.toHaveBeenCalled();
  act(() => result.current.closeHoverTask());
  expect(result.current.hoverTask).toBeNull();
});

it.each([false, true])(
  "removes a saved pin after a workflow close and keeps reopen unpinned (membership only: %s)",
  async (projectOnly) => {
    const file = note("/notes/PinnedWorkflow.md");
    fixtures.sources[file.path] = taskSource("Pinned workflow");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [{ name: "Research", colorId: "blue" }],
      taskOrder: [file.relativePath],
      pinnedTasks: [file.relativePath],
    });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks[0]?.pinned).toBe(true));
    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[0], {
          kind: "board",
          project: "Research",
          stage: "done",
          index: 0,
          projectOnly,
        }),
      ).toBe(true),
    );
    expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([]);
    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[0], {
          kind: "board",
          project: "Research",
          stage: "doing",
          index: 0,
          projectOnly,
        }),
      ).toBe(true),
    );
    expect(result.current.allTasks[0]).toMatchObject({ status: "open", pinned: false, stage: "doing" });
    expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([]);
  },
);

it("honors a visible insertion anchor when pins differ from canonical order", async () => {
  for (const title of ["A", "Pinned", "Moved"]) fixtures.sources[`/notes/${title}.md`] = taskSource(title);
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({
    projects: [{ name: "Research", colorId: "blue" }],
    taskOrder: ["A.md", "Pinned.md", "Moved.md"],
    pinnedTasks: ["Pinned.md"],
  });
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(3));
  await act(async () =>
    expect(
      await result.current.taskActions.moveTask(result.current.allTasks[2], {
        kind: "board",
        project: "Research",
        stage: "backlog",
        index: 1,
        beforePath: "/notes/A.md",
      }),
    ).toBe(true),
  );
  expect(JSON.parse(fixtures.configSource).taskOrder).toEqual(["Moved.md", "A.md", "Pinned.md"]);
});

it.each([false, true])("retains saved pins on failed workflow writes (membership only: %s)", async (projectOnly) => {
  const file = note("/notes/PinnedFailure.md");
  fixtures.sources[file.path] = taskSource("Pinned failure");
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({
    projects: [{ name: "Research", colorId: "blue" }],
    taskOrder: [file.relativePath],
    pinnedTasks: [file.relativePath],
  });
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.allTasks[0]?.pinned).toBe(true));
  boundaryMocks.saveFile.mockResolvedValueOnce({ success: false, error: "Disk unavailable" });
  await act(async () =>
    expect(
      await result.current.taskActions.moveTask(result.current.allTasks[0], {
        kind: "board",
        project: "Research",
        stage: "done",
        index: 0,
        projectOnly,
      }),
    ).toBe(false),
  );
  expect(result.current.allTasks[0]).toMatchObject({ status: "open", pinned: true });
  expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([file.relativePath]);
  expect(apiMocks.upsertFile).not.toHaveBeenCalled();
});

it.each([false, true])(
  "reports workflow pin/layout failure after a successful note write (membership only: %s)",
  async (projectOnly) => {
    const file = note("/notes/PinnedPartial.md");
    fixtures.sources[file.path] = taskSource("Pinned partial");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [{ name: "Research", colorId: "blue" }],
      taskOrder: [file.relativePath],
      pinnedTasks: [file.relativePath],
    });
    const { result, store } = renderBoard();
    await waitFor(() => expect(result.current.allTasks[0]?.pinned).toBe(true));
    apiMocks.upsertFile.mockResolvedValueOnce(false);
    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[0], {
          kind: "board",
          project: "Research",
          stage: "done",
          index: 0,
          projectOnly,
        }),
      ).toBe(projectOnly),
    );
    expect(frontmatterString(fixtures.sources[file.path], "task-status")).toBe("done");
    expect(result.current.allTasks[0]).toMatchObject({ status: "done", pinned: false });
    expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([file.relativePath]);
    expect(
      store
        .get(notificationsAtom)
        .some(({ title }) => title === (projectOnly ? "Pin removal failed" : "Task position not saved")),
    ).toBe(true);
  },
);

it("rebases the visible anchor against concurrent canonical order and newly indexed tasks", async () => {
  for (const title of ["A", "B", "Moved"]) fixtures.sources[`/notes/${title}.md`] = taskSource(title);
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({
    projects: [{ name: "Research", colorId: "blue" }],
    taskOrder: ["A.md", "B.md", "Moved.md"],
  });
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(3));
  let resolveRead!: () => void;
  boundaryMocks.readTextFile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = () =>
          resolve({ success: true, content: fixtures.sources["/notes/Moved.md"], version: openedVersion });
      }),
  );
  let move!: Promise<boolean>;
  act(() => {
    move = result.current.taskActions.moveTask(result.current.allTasks[2], {
      kind: "board",
      project: "Research",
      stage: "backlog",
      index: 1,
      beforePath: "/notes/B.md",
    });
  });
  await waitFor(() => expect(result.current.allTasks.map(({ title }) => title)).toEqual(["A", "Moved", "B"]));
  fixtures.sources["/notes/Concurrent.md"] = taskSource("Concurrent");
  fixtures.configSource = JSON.stringify({
    projects: [{ name: "Research", colorId: "rose" }],
    taskOrder: ["A.md", "Concurrent.md", "B.md", "Moved.md"],
  });
  await act(async () => {
    resolveRead();
    expect(await move).toBe(true);
  });
  expect(JSON.parse(fixtures.configSource)).toEqual({
    projects: [{ name: "Research", colorId: "rose" }],
    taskOrder: ["A.md", "Concurrent.md", "Moved.md", "B.md"],
  });
});

it.each([false, true])(
  "uses latest lifecycle when reopening through workflow (membership only: %s)",
  async (projectOnly) => {
    const file = note("/notes/StaleLifecycle.md");
    fixtures.sources[file.path] = taskSource("Stale lifecycle");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [{ name: "Research", colorId: "blue" }],
      taskOrder: [file.relativePath],
      pinnedTasks: [file.relativePath],
    });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks[0]?.status).toBe("open"));
    fixtures.sources[file.path] = taskSource("Stale lifecycle", "Research", true);
    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[0], {
          kind: "board",
          project: "Research",
          stage: "doing",
          index: 0,
          projectOnly,
        }),
      ).toBe(true),
    );
    expect(result.current.allTasks[0]).toMatchObject({ status: "open", stage: "doing", pinned: false });
    expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([]);
  },
);

it.each(["complete", "move"])("rejects a latest source that stopped being a task during %s", async (operation) => {
  const file = note("/notes/FormerTask.md");
  fixtures.sources[file.path] = taskSource("Former task");
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({
    projects: [{ name: "Research", colorId: "blue" }],
    taskOrder: [file.relativePath],
    pinnedTasks: [file.relativePath],
  });
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(1));
  fixtures.sources[file.path] = "---\ntype: note\n---\nAuthored note";
  await act(async () =>
    expect(
      await (operation === "complete"
        ? result.current.taskActions.completeTask(result.current.allTasks[0])
        : result.current.taskActions.moveTask(result.current.allTasks[0], {
            kind: "board",
            project: "Research",
            stage: "done",
            index: 0,
          })),
    ).toBe(false),
  );
  expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
  expect(apiMocks.upsertFile).not.toHaveBeenCalled();
  expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([file.relativePath]);
});

it.each(["completeTask", "cancelTask"] as const)(
  "offers Undo after %s without restoring a saved pin",
  async (operation) => {
    const file = note("/notes/Undo.md");
    fixtures.sources[file.path] = taskSource("Undo");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [],
      taskOrder: [file.relativePath],
      pinnedTasks: [file.relativePath],
    });
    const { result, store } = renderBoard();
    await waitFor(() => expect(result.current.allTasks[0]?.pinned).toBe(true));
    await act(async () => expect(await result.current.taskActions[operation](result.current.allTasks[0])).toBe(true));
    const undo = store.get(notificationsAtom).find(({ action }) => action?.label === "Undo");
    expect(undo?.action).toBeDefined();
    await act(async () => {
      await undo!.action!.onClick();
    });
    expect(result.current.allTasks[0]).toMatchObject({ status: "open", pinned: false });
    expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([]);
  },
);

it("does not rewrite an already closed latest task or offer another Undo", async () => {
  const file = note("/notes/AlreadyClosed.md");
  fixtures.sources[file.path] = taskSource("Already closed");
  const { result, store } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(1));
  fixtures.sources[file.path] = taskSource("Already closed", "Research", true);
  await act(async () => expect(await result.current.taskActions.completeTask(result.current.allTasks[0])).toBe(false));
  expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
  expect(store.get(notificationsAtom)).toEqual([]);
  expect(result.current.allTasks[0].status).toBe("done");
});

it("rejects a workflow move when latest source has become cancelled", async () => {
  const file = note("/notes/CancelledDuringMove.md");
  fixtures.sources[file.path] = taskSource("Cancelled during move");
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({
    projects: [{ name: "Research", colorId: "blue" }],
    taskOrder: [file.relativePath],
    pinnedTasks: [file.relativePath],
  });
  const { result } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(1));
  fixtures.sources[file.path] = "---\ntype: task\ntask-project: Research\ntask-status: cancelled\n---\nAuthored body";
  await act(async () =>
    expect(
      await result.current.taskActions.moveTask(result.current.allTasks[0], {
        kind: "board",
        project: "Research",
        stage: "doing",
        index: 0,
      }),
    ).toBe(false),
  );
  expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
  expect(apiMocks.upsertFile).not.toHaveBeenCalled();
});

it.each([false, true])(
  "validates latest task type even for a same-position move (membership only: %s)",
  async (projectOnly) => {
    const file = note("/notes/NoopFormerTask.md");
    fixtures.sources[file.path] = taskSource("Noop former task");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [{ name: "Research", colorId: "blue" }],
      taskOrder: [file.relativePath],
      pinnedTasks: [file.relativePath],
    });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks).toHaveLength(1));
    fixtures.sources[file.path] = "---\ntype: note\n---\nAuthored note";
    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[0], {
          kind: "board",
          project: "Research",
          stage: "backlog",
          index: 0,
          projectOnly,
        }),
      ).toBe(false),
    );
    expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
    expect(apiMocks.upsertFile).not.toHaveBeenCalled();
    expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([file.relativePath]);
  },
);

it.each([false, true])(
  "reopens latest completed source even when a cached move looks unchanged (membership only: %s)",
  async (projectOnly) => {
    const file = note("/notes/NoopLatestDone.md");
    fixtures.sources[file.path] = taskSource("Noop latest done");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [{ name: "Research", colorId: "blue" }],
      taskOrder: [file.relativePath],
      pinnedTasks: [file.relativePath],
    });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks[0]?.status).toBe("open"));
    fixtures.sources[file.path] = taskSource("Noop latest done", "Research", true);
    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[0], {
          kind: "board",
          project: "Research",
          stage: "backlog",
          index: 0,
          projectOnly,
        }),
      ).toBe(true),
    );
    expect(result.current.allTasks[0]).toMatchObject({ status: "open", pinned: false });
    expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([]);
  },
);

it.each([false, true])(
  "preserves latest lifecycle when moving projects without a stage (membership only: %s)",
  async (projectOnly) => {
    const file = note("/notes/LatestProjectDone.md");
    fixtures.sources[file.path] = taskSource("Latest project done");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [
        { name: "Research", colorId: "blue" },
        { name: "Writing", colorId: "rose" },
      ],
      taskOrder: [file.relativePath],
      pinnedTasks: [file.relativePath],
    });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks[0]?.status).toBe("open"));
    fixtures.sources[file.path] = taskSource("Latest project done", "Research", true);
    await act(async () =>
      expect(
        await result.current.taskActions.moveTask(result.current.allTasks[0], {
          kind: "board",
          project: "Writing",
          index: 0,
          projectOnly,
        }),
      ).toBe(true),
    );
    expect(result.current.allTasks[0]).toMatchObject({ status: "done", project: "Writing", pinned: false });
    expect(JSON.parse(fixtures.configSource).pinnedTasks).toEqual([]);
  },
);
