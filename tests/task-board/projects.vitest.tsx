import {
  boundaryMocks,
  apiMocks,
  note,
  taskSource,
  renderBoard,
  frontmatterString,
  fixtures,
  resetTaskBoardFixtures,
  cleanupTaskBoardFixtures,
} from "./fixtures";
import { act, waitFor } from "@testing-library/react";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFrontmatterProperty, parseFrontmatter } from "../../src/shared/frontmatter";
import { fileBuffersByPathAtom } from "../../src/renderer/src/store/fileBufferStore";
import { fileTreeAtom } from "../../src/renderer/src/store/fileExplorerStore";
import { notificationsAtom } from "../../src/renderer/src/store/NotificationsStore";

beforeEach(resetTaskBoardFixtures);
afterEach(cleanupTaskBoardFixtures);

describe("Task Board project mutations", () => {
  it("keeps hidden-project tasks out of board columns without losing indexed tasks or usage", async () => {
    const inbox = note("/notes/Inbox.md");
    const active = note("/notes/Active Research.md");
    const closed = note("/notes/Closed Research.md");
    fixtures.sources[inbox.path] = taskSource("Inbox task", "");
    fixtures.sources[active.path] = taskSource("Active research", "Research");
    fixtures.sources[closed.path] = taskSource("Closed research", "Research", true);
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [
        { name: "Research", colorId: "blue", hidden: true },
        { name: "Writing", colorId: "rose" },
      ],
      taskOrder: [],
    });

    const { result } = renderBoard();
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.projects.filter(({ hidden }) => !hidden).map(({ name }) => name)).toEqual(["Writing"]);
    expect(result.current.allTasks.map(({ path }) => path)).toEqual([inbox.path, active.path, closed.path]);
    expect(result.current.projects).toEqual([
      { name: "Research", colorId: "blue", hidden: true },
      { name: "Writing", colorId: "rose" },
    ]);
    expect(result.current.usageCountByProjectName.Research).toBe(2);
    expect(apiMocks.upsertFile).not.toHaveBeenCalled();
    expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
  });

  it("persists project reordering while preserving colors, hidden projects, and task files", async () => {
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [
        { name: "Research", colorId: "blue" },
        { name: "Writing", colorId: "rose", hidden: true },
      ],
      taskOrder: [],
    });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));
    await act(async () => expect(await result.current.moveProject("Writing", "Research")).toBe(true));
    expect(JSON.parse(fixtures.configSource).projects).toEqual([
      { name: "Writing", colorId: "rose", hidden: true },
      { name: "Research", colorId: "blue" },
    ]);
    expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
    await act(async () => expect(await result.current.moveProject("Inbox", "Research")).toBe(false));
  });

  it("round-trips project visibility and preserves it through recolor and rename", async () => {
    const file = note("/notes/Research.md");
    fixtures.sources[file.path] = taskSource("Research task", "Research");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.allTasks).toHaveLength(1));

    await act(async () => expect(await result.current.updateProject("Research", { hidden: true })).toBe(true));
    expect(JSON.parse(fixtures.configSource).projects).toEqual([{ name: "Research", colorId: "blue", hidden: true }]);
    expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
    expect(result.current.projects.filter(({ hidden }) => !hidden).map(({ name }) => name)).toEqual([]);

    await act(async () => expect(await result.current.updateProject("Research", { colorId: "rose" })).toBe(true));
    expect(JSON.parse(fixtures.configSource).projects).toEqual([{ name: "Research", colorId: "rose", hidden: true }]);
    expect(boundaryMocks.saveFile).not.toHaveBeenCalled();

    await act(async () => expect(await result.current.updateProject("Research", { name: "Ideas" })).toBe(true));
    expect(JSON.parse(fixtures.configSource).projects).toEqual([{ name: "Ideas", colorId: "rose", hidden: true }]);
    expect(boundaryMocks.saveFile).toHaveBeenCalledOnce();
    expect(frontmatterString(fixtures.sources[file.path], "task-project")).toBe("Ideas");
    expect(result.current.projects.filter(({ hidden }) => !hidden).map(({ name }) => name)).toEqual([]);

    await act(async () => expect(await result.current.updateProject("Ideas", { hidden: false })).toBe(true));
    expect(JSON.parse(fixtures.configSource).projects).toEqual([{ name: "Ideas", colorId: "rose" }]);
    expect(boundaryMocks.saveFile).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(result.current.projects.filter(({ hidden }) => !hidden).map(({ name }) => name)).toEqual(["Ideas"]),
    );
  });

  it("keeps note-discovered projects read-only until they are explicitly added", async () => {
    const someday = note("/notes/Someday.md");
    fixtures.sources[someday.path] = taskSource("Someday task", "Someday");
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.projects.map(({ name }) => name)).toEqual(["Someday"]));
    expect(fixtures.configExists).toBe(false);
    expect(apiMocks.upsertFile).not.toHaveBeenCalled();

    await act(async () =>
      expect(await result.current.createProject({ name: "Someday", colorId: "teal" })).toEqual({
        name: "Someday",
        colorId: "teal",
      }),
    );
    expect(JSON.parse(fixtures.configSource).projects).toEqual([{ name: "Someday", colorId: "teal" }]);

    await act(async () =>
      expect(await result.current.createProject({ name: "Writing", colorId: "rose" })).toEqual({
        name: "Writing",
        colorId: "rose",
      }),
    );
    expect(JSON.parse(fixtures.configSource)).toEqual({
      projects: [
        { name: "Someday", colorId: "teal" },
        { name: "Writing", colorId: "rose" },
      ],
      taskOrder: [],
    });
    expect(fixtures.configSource).not.toContain(someday.path);
    expect(fixtures.configSource).not.toContain("Someday task");
    expect(boundaryMocks.createMarkdownFile).not.toHaveBeenCalled();
  });

  it("renames and deletes task projects sequentially before persisting config", async () => {
    const first = note("/notes/First.md");
    const second = note("/notes/Second.md");
    const completed = note("/notes/Completed.md");
    fixtures.sources[first.path] = taskSource("First", "Research");
    fixtures.sources[second.path] = taskSource("Second", "Research");
    fixtures.sources[completed.path] = taskSource("Completed", "Research", true);
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }] });
    const events: string[] = [];
    boundaryMocks.saveFile.mockImplementation(async (path: string, content: string) => {
      events.push(`save:${path}`);
      fixtures.sources[path] = content;
      return { success: true };
    });
    apiMocks.upsertFile.mockImplementation(async (_path: string, content: string) => {
      events.push("config");
      fixtures.configSource = content;
      return true;
    });
    const store = createStore();
    store.set(fileTreeAtom, [first, second, completed]);
    const { result } = renderBoard(store);
    await waitFor(() => expect(result.current.allTasks).toHaveLength(3));
    const snapshotsBeforeRename = apiMocks.queryWorkspaceProperty.mock.calls.length;

    await act(async () => expect(await result.current.updateProject("Research", { name: "Writing" })).toBe(true));
    expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(snapshotsBeforeRename);
    expect(events).toEqual([`save:${first.path}`, `save:${second.path}`, `save:${completed.path}`, "config"]);
    expect(frontmatterString(fixtures.sources[first.path], "task-project")).toBe("Writing");
    expect(frontmatterString(fixtures.sources[second.path], "task-project")).toBe("Writing");
    expect(frontmatterString(fixtures.sources[completed.path], "task-project")).toBe("Writing");

    events.length = 0;
    const snapshotsBeforeDelete = apiMocks.queryWorkspaceProperty.mock.calls.length;
    await act(async () => expect(await result.current.deleteProject("Writing")).toBe(true));
    expect(apiMocks.queryWorkspaceProperty).toHaveBeenCalledTimes(snapshotsBeforeDelete);
    expect(events).toEqual([`save:${first.path}`, `save:${second.path}`, `save:${completed.path}`, "config"]);
    expect(getFrontmatterProperty(parseFrontmatter(fixtures.sources[first.path]), "task-project")).toBeUndefined();
    expect(getFrontmatterProperty(parseFrontmatter(fixtures.sources[second.path]), "task-project")).toBeUndefined();
    expect(getFrontmatterProperty(parseFrontmatter(fixtures.sources[completed.path]), "task-project")).toBeUndefined();
    expect(Object.keys(fixtures.sources)).toEqual([first.path, second.path, completed.path]);
  });

  it("does not overwrite an unsaved project change during rename", async () => {
    const file = note("/notes/Open.md");
    const research = taskSource("Open", "Research");
    const personal = taskSource("Open", "Personal");
    fixtures.sources[file.path] = research;
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }] });
    const store = createStore();
    store.set(fileTreeAtom, [file]);
    store.set(fileBuffersByPathAtom, { [file.path]: { savedText: research, editorText: research } });
    const { result } = renderBoard(store);
    await waitFor(() => expect(result.current.allTasks[0]?.project).toBe("Research"));

    act(() => store.set(fileBuffersByPathAtom, { [file.path]: { savedText: research, editorText: personal } }));
    await act(async () => expect(await result.current.updateProject("Research", { name: "Writing" })).toBe(true));

    expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
    expect(frontmatterString(store.get(fileBuffersByPathAtom)[file.path].editorText, "task-project")).toBe("Personal");
  });

  it("does not overwrite an unsaved project change during deletion", async () => {
    const file = note("/notes/Open.md");
    const research = taskSource("Open", "Research");
    const personal = taskSource("Open", "Personal");
    fixtures.sources[file.path] = research;
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }] });
    const store = createStore();
    store.set(fileTreeAtom, [file]);
    store.set(fileBuffersByPathAtom, { [file.path]: { savedText: research, editorText: research } });
    const { result } = renderBoard(store);
    await waitFor(() => expect(result.current.allTasks[0]?.project).toBe("Research"));

    act(() => store.set(fileBuffersByPathAtom, { [file.path]: { savedText: research, editorText: personal } }));
    await act(async () => expect(await result.current.deleteProject("Research")).toBe(true));

    expect(window.confirm).not.toHaveBeenCalled();
    expect(boundaryMocks.saveFile).not.toHaveBeenCalled();
    expect(frontmatterString(store.get(fileBuffersByPathAtom)[file.path].editorText, "task-project")).toBe("Personal");
  });

  it("accepts Inbox as a regular project while rejecting duplicates", async () => {
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({
      projects: [
        { name: "Research", colorId: "blue" },
        { name: "Writing", colorId: "rose" },
      ],
      taskOrder: [],
    });
    const { result } = renderBoard();
    await waitFor(() => expect(result.current.projects).toHaveLength(2));

    await act(async () => {
      expect(await result.current.createProject({ name: " " })).toBeNull();
      expect(await result.current.createProject({ name: " inbox " })).toEqual({ name: "inbox", colorId: "teal" });
      expect(await result.current.createProject({ name: "research" })).toBeNull();
      expect(await result.current.updateProject("Inbox", { name: "Elsewhere" })).toBe(true);
      expect(await result.current.updateProject("Writing", { name: "RESEARCH" })).toBe(false);
      expect(await result.current.deleteProject("Elsewhere")).toBe(true);
    });

    expect(apiMocks.upsertFile).toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("reconciles the truthful projects after a partial rename failure", async () => {
    const first = note("/notes/First.md");
    const second = note("/notes/Second.md");
    fixtures.sources[first.path] = taskSource("First", "Research");
    fixtures.sources[second.path] = taskSource("Second", "Research");
    fixtures.configExists = true;
    fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }] });
    boundaryMocks.saveFile.mockImplementation(async (path: string, content: string) => {
      if (path === second.path) return { success: false, error: "disk full" };
      fixtures.sources[path] = content;
      return { success: true };
    });
    const store = createStore();
    store.set(fileTreeAtom, [first, second]);
    const { result } = renderBoard(store);
    await waitFor(() => expect(result.current.allTasks).toHaveLength(2));
    const refreshesBefore = apiMocks.doesFileExist.mock.calls.length;

    await act(async () => expect(await result.current.updateProject("Research", { name: "Writing" })).toBe(false));

    expect(boundaryMocks.saveFile.mock.calls.map(([path]) => path)).toEqual([first.path, second.path]);
    expect(apiMocks.upsertFile).not.toHaveBeenCalled();
    expect(JSON.parse(fixtures.configSource).projects).toEqual([{ name: "Research", colorId: "blue" }]);
    expect(result.current.projectRecovery?.files.map(({ path }) => path)).toEqual([second.path]);
    expect(apiMocks.doesFileExist.mock.calls.length).toBeGreaterThan(refreshesBefore);
    expect(result.current.projects).toEqual([
      { name: "Research", colorId: "blue" },
      { name: "Writing", colorId: "teal" },
    ]);
    expect(frontmatterString(fixtures.sources[first.path], "task-project")).toBe("Writing");
    expect(frontmatterString(fixtures.sources[second.path], "task-project")).toBe("Research");
    expect(store.get(notificationsAtom).at(-1)?.title).toBe("Project rename incomplete");
    expect(result.current.error).toBe("Could not update: /notes/Second.md");
    boundaryMocks.saveFile.mockImplementation(async (path: string, content: string) => {
      fixtures.sources[path] = content;
      return { success: true };
    });
    await act(async () => expect(await result.current.projectRecovery!.retry()).toBe(true));
    expect(boundaryMocks.saveFile.mock.calls.map(([path]) => path)).toEqual([first.path, second.path, second.path]);
    expect(result.current.projectRecovery).toBeNull();
    expect(JSON.parse(fixtures.configSource).projects).toEqual([{ name: "Writing", colorId: "blue" }]);
  });
});
