import { createTaskActions } from "../task-board-actions-test-support";
import {
  apiMocks,
  note,
  taskSource,
  renderBoard,
  isContextMenuAction,
  fixtures,
  resetTaskBoardFixtures,
  cleanupTaskBoardFixtures,
} from "./fixtures";
import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskBoard } from "../../src/renderer/src/features/task-board/TaskBoard";
import { AppDndProvider } from "../../src/renderer/src/shared/dnd/AppDndProvider";
import { createWorkspaceItemViews } from "../../src/renderer/src/app/workspaceItemViews";
import { ContextMenuHost } from "../../src/renderer/src/features/context-menu/ContextMenuHost";
import {
  TASK_BOARD_DETAILS_PREVIEW_LIMIT,
  getTaskBoardProjectColorTheme,
  taskBoardDetailsPreview,
} from "../../src/renderer/src/features/task-board/taskBoardModel";
import * as taskBoardHook from "../../src/renderer/src/features/task-board/useTaskBoard";
import {
  DEFAULT_TASK_BOARD_PREFERENCES,
  taskBoardPreferencesAtom,
} from "../../src/renderer/src/store/taskBoardPreferencesStore";
import { contextMenuRequestAtom } from "../../src/renderer/src/store/contextMenuStore";
import { TASK_BOARD_PROJECT_DRAG_DATA_MIME } from "../../src/shared/drag-data";

beforeEach(resetTaskBoardFixtures);
afterEach(cleanupTaskBoardFixtures);

describe("Task Board composition", () => {
  it("uses the board controls without a redundant pane header", () => {
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    expect(views.taskboard.renderHeader).toBeUndefined();
  });

  it("uses one hook instance and renders each task once on the board", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-15T12:00:00"));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const inboxTask = {
      ...note("/notes/Inbox.md"),
      title: "Inbox task",
      status: "open" as const,
      metadataIssues: [],
      project: "Writing",
    };
    const researchTask = {
      ...note("/notes/Research.md"),
      title: "Research task",
      preview: "a".repeat(TASK_BOARD_DETAILS_PREVIEW_LIMIT + 20),
      status: "open" as const,
      metadataIssues: [],
      dueDate: "2026-07-23",
      project: "Research",
      tags: ["paper"],
    };
    const createTask = vi.fn(async () => true);
    const createProject = vi.fn(async ({ name }: { name: string }) => ({ name, colorId: "teal" }));
    const loadTags = vi.fn(async () => ["Workspace tag", "paper"]);
    const moveTask = vi.fn(async () => true);
    const moveProject = vi.fn(async () => true);
    const updateTask = vi.fn(async () => true);
    const updateProject = vi.fn(async () => true);
    const deleteProject = vi.fn(async () => true);
    const useTaskBoard = vi.spyOn(taskBoardHook, "useTaskBoard").mockImplementation(() => {
      const [preferences, setPreferences] = useState(DEFAULT_TASK_BOARD_PREFERENCES);
      const taskActions = {
        ...createTaskActions({
          cancelTask: vi.fn(async () => true),
          completeTask: vi.fn(async () => true),
          createTask,
          deleteTask: vi.fn(async () => true),
          loadTags,
          moveTask,
          openTask: vi.fn(async () => undefined),
          repairMetadata: vi.fn(async () => true),
          reopenTask: vi.fn(async () => true),
          pinTask: vi.fn(async () => true),
          updateTask,
          updateSubtasks: vi.fn(async () => true),
        }),
        openTask: vi.fn(async () => undefined),
      };
      return {
        taskActions,
        projectRecovery: null,
        dismissProjectRecovery: vi.fn(),
        openRecoveryFile: vi.fn(),
        layoutError: null,
        canEditLayout: true,
        revealLayoutFile: vi.fn(async () => ({ success: true as const })),
        createProject,
        deleteProject,
        error: null,
        hasLoaded: true,
        isMoving: false,
        isLoading: false,
        moveProject,
        preferences,
        refresh: vi.fn(async () => undefined),
        projects: [
          { name: "Research", colorId: "blue" },
          { name: "Writing", colorId: "rose" },
        ],
        setPreferences,
        allTasks: [inboxTask, researchTask],
        hoverTask: null,
        closeHoverTask: vi.fn(),
        updateProject,
        usageCountByProjectName: { Research: 1, Writing: 0 },
        orderedTasks: [inboxTask, researchTask],
      };
    });
    const user = userEvent.setup();
    const store = createStore();

    render(
      <Provider store={store}>
        <AppDndProvider>
          <TaskBoard />
          <ContextMenuHost />
        </AppDndProvider>
      </Provider>,
    );
    // Store subscriptions may render again on mount; rows below verify single task instances.
    expect(useTaskBoard).toHaveBeenCalled();
    const sectionToggle = screen.getByRole("button", { name: "Collapse Backlog" });
    const sectionBody = document.getElementById(sectionToggle.getAttribute("aria-controls")!)!;
    const mountedTask = sectionBody.querySelector("[data-task-path]");
    await user.click(sectionToggle);
    expect(sectionBody.hidden).toBe(true);
    expect(sectionToggle.getAttribute("aria-expanded")).toBe("false");
    await user.keyboard("{Enter}");
    expect(sectionBody.hidden).toBe(false);
    expect(sectionToggle.getAttribute("aria-expanded")).toBe("true");
    expect(sectionBody.querySelector("[data-task-path]")).toBe(mountedTask);
    expect(screen.queryByRole("tab", { name: "Active" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Closed" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compact" })).toBeNull();
    expect(screen.queryByText("2 of 2")).toBeNull();
    const commandbar = screen.getByRole("toolbar", { name: "Task board controls" });
    expect(commandbar.dataset.taskBoardView).toBe("board");
    expect(within(commandbar).getByRole("button", { name: "Search tasks" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(within(commandbar).queryByRole("textbox", { name: "Search tasks" })).toBeNull();
    const filterButton = within(commandbar).getByRole("button", { name: /Filter tasks/ });
    expect(filterButton.textContent).toBe("");
    expect(filterButton.dataset.filtered).toBe("false");
    const sectionsButton = within(commandbar).getByRole("button", { name: "Manage projects" });
    expect(sectionsButton.textContent).toBe("");
    const projectTabs = within(commandbar).getByRole("group", { name: "Projects" });
    expect(sectionsButton.compareDocumentPosition(projectTabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const sortButton = within(commandbar).getByRole("button", { name: "Sort by" });
    expect(sortButton.textContent).toBe("");
    expect(sortButton.dataset.sorted).toBe("false");
    const searchButton = within(commandbar).getByRole("button", { name: "Search tasks" });
    expect(sectionsButton.compareDocumentPosition(searchButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sortButton.compareDocumentPosition(filterButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(filterButton.compareDocumentPosition(searchButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sectionsButton.closest(".task-board-toolbar-start")).toBeTruthy();
    expect(searchButton.closest(".task-board-toolbar-start")).toBeNull();
    expect(commandbar.lastElementChild?.classList.contains("compact-toolbar-search")).toBe(true);
    expect(within(commandbar).queryByRole("button", { name: /Sort ascending|Sort descending/ })).toBeNull();
    expect(within(commandbar).queryByRole("button", { name: /Group by:/ })).toBeNull();
    expect(within(commandbar).queryByRole("tab")).toBeNull();
    expect(commandbar.querySelector(".task-board-filterbar")).toBeTruthy();
    const boardViewport = document.querySelector<HTMLElement>(".task-board-canvas");
    expect(boardViewport?.className).toContain("overflow-y-auto");
    expect(boardViewport?.className).not.toContain("overflow-y-hidden");
    await user.click(screen.getByRole("button", { name: /Filter tasks/ }));
    expect(screen.queryByText("No filters yet")).toBeNull();
    expect(screen.queryByText("Add a filter to narrow your results.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add filter" }));
    const filterPropertySearch = screen.getByRole("textbox", { name: "Search filter properties" });
    await user.type(filterPropertySearch, "prio");
    expect(screen.getByRole("option", { name: "Priority" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Due date" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Priority" }));
    expect(screen.getByRole("button", { name: "Filter property 1: Priority" })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Filter rule 1" })).getByText("is")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Filter operator 1: is" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Filter value 1: Choose value" }));
    const priorityValues = screen.getByRole("group", { name: "Priority values" });
    const highPriority = within(priorityValues).getByRole("button", { name: "High" });
    expect(highPriority.querySelector("svg")?.classList.contains("task-board-filter-priority-flag")).toBe(true);
    await user.click(highPriority);
    expect(screen.getByRole("button", { name: /Filter tasks/ }).dataset.filtered).toBe("true");
    expect(screen.getByRole("button", { name: "Filter value 1: High" })).toBeTruthy();
    expect(document.querySelector(".task-board-view-notice")).toBeNull();
    expect(document.querySelector(".task-board-result-count")).toBeNull();
    expect(screen.queryByText(/matching tasks?$/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add filter" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));
    expect(screen.getByRole("button", { name: "Filter operator 2: has" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Filter value 2: Choose value" }));
    const tagSearch = screen.getByRole("textbox", { name: "Search tags" });
    await user.type(tagSearch, "work");
    expect(await screen.findByRole("button", { name: "Workspace tag" })).toBeTruthy();
    expect(loadTags).toHaveBeenCalledWith([]);
    await user.click(screen.getByRole("button", { name: "Workspace tag" }));
    await user.click(screen.getByRole("button", { name: "Filter value 2: Workspace tag" }));
    await user.click(screen.getByRole("button", { name: "No tags" }));
    expect(screen.getByRole("button", { name: "Filter value 2: Workspace tag, No tags" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add filter" }));
    await user.click(screen.getByRole("option", { name: "Due date" }));
    await user.click(screen.getByRole("button", { name: "Filter value 3: Choose value" }));
    await user.click(screen.getByRole("button", { name: /Custom date range/ }));
    const rangeStart = document.querySelector<HTMLButtonElement>('[data-day="2026-08-26"] button');
    const rangeEnd = document.querySelector<HTMLButtonElement>('[data-day="2026-08-28"] button');
    expect(rangeStart).toBeTruthy();
    expect(rangeEnd).toBeTruthy();
    await user.click(rangeStart!);
    expect(screen.getByRole("button", { name: "Apply range" }).hasAttribute("disabled")).toBe(true);
    await user.click(rangeEnd!);
    expect(screen.getByRole("button", { name: "Apply range" }).hasAttribute("disabled")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Apply range" }));
    expect(screen.getByRole("button", { name: /Filter value 2: 26-08-2026/ })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Filter value 2: 26-08-2026/ }));
    expect(screen.getByRole("button", { name: "Filter value 1: High" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter value 3: Workspace tag, No tags" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Filter operator 2: is" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Filter operator 2: is" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Filter operator 2: is" }));
    await user.click(screen.getByRole("button", { name: "Is empty" }));
    expect(screen.getByRole("button", { name: "Filter operator 2: is empty" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter value 2: No date" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save filter..." }));
    await user.type(screen.getByLabelText("Save this filter"), "Weekly review");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Inbox task")).toBeNull();
    expect(screen.getAllByText("Research task")).toHaveLength(1);
    expect(screen.getAllByText("paper")).toHaveLength(1);
    const dueDate = screen.getByTitle("task-due: 23-07-2026");
    expect(dueDate.className).toContain("text-muted-foreground");
    expect(screen.queryByText("Not saved in board layout")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save to board" })).toBeNull();
    const writingColumn = document.querySelector<HTMLElement>('[data-task-board-column="done"]');
    expect(writingColumn).not.toBeNull();
    expect(writingColumn?.className).toContain("bg-[var(--surface-2)]");
    expect(writingColumn?.className).toContain("border-[var(--border-subtle)]");
    expect(writingColumn?.className).toContain("rounded-[var(--radius-panel)]");
    expect(writingColumn?.className).not.toContain("elevation-surface");
    expect(screen.getByRole("button", { name: "Manage projects" }).className).toContain(
      "size-[var(--control-height-compact)]",
    );
    const researchColumn = document.querySelector<HTMLElement>('[data-task-board-column="backlog"]')!;
    const addInResearch = within(researchColumn).getByRole("button", { name: "Add task to Backlog" });
    const existingTask = within(researchColumn).getByRole("button", { name: "Open task Research task" });
    expect(addInResearch.closest(".task-board-column-header")).toBeTruthy();
    expect(researchColumn.querySelector(".task-board-add-task")).toBeNull();
    expect(Boolean(addInResearch.compareDocumentPosition(existingTask) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    await user.click(addInResearch);
    const newTaskName = within(researchColumn).getByRole("textbox", { name: "Task name" });
    expect(Boolean(newTaskName.compareDocumentPosition(existingTask) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    await user.type(newTaskName, "Follow-up task");
    await user.click(within(researchColumn).getByRole("button", { name: "Add task" }));
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskName: "Follow-up task", project: "Research" }),
      {
        kind: "board",
        project: "Research",
        stage: "backlog",
        index: 0,
      },
    );
    const preview = screen.getByTitle(researchTask.preview);
    expect(preview.textContent).toBe(taskBoardDetailsPreview(researchTask.preview));
    expect(Array.from(preview.textContent ?? "")).toHaveLength(TASK_BOARD_DETAILS_PREVIEW_LIMIT);
    expect(preview.className).toContain("[overflow-wrap:anywhere]");
    expect(preview.closest(".group\\/task-card")?.className).toContain("max-w-full");

    await user.click(screen.getByRole("button", { name: "Manage projects" }));
    const sectionInput = screen.getByRole("textbox", { name: "Search or create projects" });
    await user.type(sectionInput, "Editing{Enter}");
    await waitFor(() => expect(createProject).toHaveBeenCalledWith({ name: "Editing", colorId: "teal" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: "Column actions" })).toBeNull();
    const selectedProject = screen.getByRole("button", { name: "Research", pressed: true });
    expect(selectedProject).toBeTruthy();
    expect(selectedProject.querySelector(".task-board-project-dot")).toBeNull();
    expect(selectedProject.style.getPropertyValue("--task-board-project-color")).toBe(
      getTaskBoardProjectColorTheme("blue").accent,
    );
    const writingProject = screen.getByRole("button", { name: "Writing" });
    const projectGroup = screen.getByRole("group", { name: "Projects" });
    const projectOrder = () =>
      [...projectGroup.querySelectorAll<HTMLElement>(".task-board-project-tab")].map((project) => project.textContent);
    const projectOrderBeforeDrag = projectOrder();
    const projectDragValues = new Map<string, string>();
    const projectDragTypes: string[] = [];
    const projectTransfer = {
      types: projectDragTypes,
      effectAllowed: "none",
      dropEffect: "none",
      setDragImage: vi.fn(),
      setData: (type: string, value: string) => {
        projectDragValues.set(type, value);
        if (!projectDragTypes.includes(type)) projectDragTypes.push(type);
      },
      getData: (type: string) => projectDragValues.get(type) ?? "",
    } as unknown as DataTransfer;
    fireEvent.dragStart(writingProject, { clientX: 10, clientY: 10, dataTransfer: projectTransfer });
    const projectSlots = [...projectGroup.querySelectorAll<HTMLElement>("[data-task-board-project-tab]")];
    projectSlots.forEach((slot, index) => {
      vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({
        left: 100 + index * 100,
        width: 80,
      } as DOMRect);
    });
    const projectDragOver = createEvent.dragOver(projectGroup, { dataTransfer: projectTransfer });
    Object.defineProperty(projectDragOver, "clientX", { value: 110 });
    fireEvent(projectGroup, projectDragOver);
    expect(projectSlots[0].querySelector('[data-side="before"]')?.getAttribute("data-active")).toBe("true");
    expect(projectOrder()).toEqual(projectOrderBeforeDrag);
    expect(moveProject).not.toHaveBeenCalled();
    const projectDrop = createEvent.drop(projectGroup, { dataTransfer: projectTransfer });
    Object.defineProperty(projectDrop, "clientX", { value: 110 });
    fireEvent(projectGroup, projectDrop);
    expect(moveProject).toHaveBeenCalledWith("Writing", "Research");

    fireEvent.dragEnd(writingProject, { dataTransfer: projectTransfer });
    const finalTransfer = {
      ...projectTransfer,
      types: [TASK_BOARD_PROJECT_DRAG_DATA_MIME],
      getData: (type: string) => (type === TASK_BOARD_PROJECT_DRAG_DATA_MIME ? "Research" : ""),
    } as DataTransfer;
    fireEvent.dragStart(selectedProject, { clientX: 110, clientY: 10, dataTransfer: finalTransfer });
    const finalOver = createEvent.dragOver(projectGroup, { dataTransfer: finalTransfer });
    Object.defineProperty(finalOver, "clientX", { value: 500 });
    fireEvent(projectGroup, finalOver);
    expect(
      projectSlots[projectSlots.length - 1].querySelector('[data-side="after"]')?.getAttribute("data-active"),
    ).toBe("true");
    const finalDrop = createEvent.drop(projectGroup, { dataTransfer: finalTransfer });
    Object.defineProperty(finalDrop, "clientX", { value: 500 });
    fireEvent(projectGroup, finalDrop);
    expect(moveProject).toHaveBeenCalledWith("Research", "Writing");

    const taskActions = screen.getByRole("button", { name: "Task actions for Research task" });
    expect(taskActions.className).toContain("opacity-0");
    await user.click(taskActions);
    const taskMenu = store.get(contextMenuRequestAtom);
    const taskMenuActions = taskMenu?.entries.filter(isContextMenuAction) ?? [];
    expect(taskMenuActions.slice(0, 4).map((entry) => entry.label)).toEqual([
      "Open task",
      "Pin task",
      "Complete task",
      "Cancel task",
    ]);
    expect(taskMenuActions.find((entry) => entry.id === "open")?.icon).toBeDefined();
    expect(taskMenuActions.find((entry) => entry.id === "cancel")?.icon).toBeDefined();
    expect(taskMenuActions.some((entry) => entry.id === "rename")).toBe(false);
    const moveMenu = taskMenuActions.find((entry) => entry.id === "move");
    expect(moveMenu?.children?.filter(isContextMenuAction).map((entry) => entry.indicatorColor)).toEqual([
      getTaskBoardProjectColorTheme("blue").accent,
      getTaskBoardProjectColorTheme("rose").accent,
    ]);
    const stageMenu = taskMenuActions.find((entry) => entry.id === "move-stage");
    expect(stageMenu?.children?.filter(isContextMenuAction).map((entry) => entry.label)).toEqual([
      "Backlog",
      "Doing",
      "Review",
      "Done",
    ]);
    expect(screen.getByRole("menuitem", { name: "Open task" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Rename file…" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Edit task" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Move to top" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Move earlier" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Move later" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Move to bottom" })).toBeNull();
    const moveToWriting = screen.getByRole("menuitem", { name: "Move to" });
    await user.hover(moveToWriting);
    await user.click(await screen.findByRole("menuitemradio", { name: "Writing" }));
    await waitFor(() =>
      expect(moveTask).toHaveBeenCalledWith(researchTask, {
        kind: "board",
        project: "Writing",
        stage: "backlog",
        index: 0,
      }),
    );
    await user.click(taskActions);
    const moveTo = screen.getByRole("menuitem", { name: "Move to" });
    await user.hover(moveTo);
    expect((await screen.findByRole("menuitemradio", { name: "Research" })).getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{Escape}");
    const moveToDoing = stageMenu?.children
      ?.filter(isContextMenuAction)
      .find((entry) => entry.id === "move-stage:doing");
    if (!moveToDoing) throw new Error("Expected Doing stage action");
    await act(async () => moveToDoing.onSelect());
    expect(moveTask).toHaveBeenCalledWith(researchTask, {
      kind: "board",
      project: "Research",
      stage: "doing",
      index: 0,
    });
    const editAction = taskMenuActions.find((entry) => entry.id === "edit");
    if (!editAction) throw new Error("Expected Edit task action");
    act(() => editAction.onSelect());
    expect(screen.queryByRole("dialog")).toBeNull();
    const titleInput = screen.getByRole("textbox", { name: "Task name" });
    const editCard = titleInput.closest("[data-task-editor-layout]");
    const completion = editCard?.querySelector("[data-task-completion-circle]");
    expect(completion).toBeNull();
    expect(screen.queryByRole("button", { name: "Drag Research task" })).toBeNull();
    expect(titleInput.className).toContain("h-6");
    expect(screen.queryByRole("textbox", { name: "Task details" })).toBeNull();
    expect(screen.getByRole("button", { name: "Choose date" })).toBeTruthy();
    const priorityGroup = screen.getByRole("radiogroup", { name: "Choose priority" });
    expect(priorityGroup.parentElement?.parentElement?.className).toContain("col-start-1");
    expect(priorityGroup.className).toContain("w-full");
    expect(screen.getByRole("textbox", { name: "Task date" }).className).toContain("flex-1");
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["High", "Medium", "Low", "None"]);
    const tagsPicker = screen.getByRole("button", { name: "Choose tags" });
    expect(tagsPicker.className).toContain("w-full");
    expect(tagsPicker.textContent).toContain("paper");
    expect(priorityGroup.parentElement?.className).toContain("grid-cols-[minmax(0,1fr)_7.5rem]");
    expect(screen.getByRole("textbox", { name: "Task date" }).parentElement?.parentElement?.className).toContain(
      "col-start-2",
    );
    expect(screen.queryByRole("button", { name: "Choose section" })).toBeNull();
    expect(screen.queryByText(/to cancel/)).toBeNull();
    const saveButton = screen.getByRole("button", { name: "Save changes" });
    expect(saveButton.className).toContain("h-6");
    expect(saveButton.textContent).toContain("↵");
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("h-6");
    await user.click(saveButton);
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith(
        researchTask,
        expect.objectContaining({
          taskName: "Research task",
          dueDate: "2026-07-23",
          project: "Research",
          tags: ["paper"],
        }),
      ),
    );
    const submitted = updateTask.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(submitted[1]).not.toHaveProperty("stage");
    expect(screen.queryByRole("tab", { name: "List view" })).toBeNull();
  });

  it("sorts board columns while keeping manual order draggable", async () => {
    const zebra = {
      ...note("/notes/Zebra.md"),
      title: "Zebra",
      status: "open" as const,
      metadataIssues: [],
      priority: "low" as const,
      project: "Research",
      tags: ["Zeta"],
    };
    const alpha = {
      ...note("/notes/Alpha.md"),
      title: "Alpha",
      status: "open" as const,
      metadataIssues: [],
      priority: "high" as const,
      project: "Research",
      tags: ["Paper"],
    };
    const inbox = {
      ...note("/notes/Inbox.md"),
      title: "Inbox",
      status: "open" as const,
      metadataIssues: [],
      project: "Writing",
    };
    vi.spyOn(taskBoardHook, "useTaskBoard").mockImplementation(() => {
      const [preferences, setPreferences] = useState(DEFAULT_TASK_BOARD_PREFERENCES);
      const taskActions = {
        ...createTaskActions({
          cancelTask: vi.fn(async () => true),
          completeTask: vi.fn(async () => true),
          createTask: vi.fn(async () => true),
          deleteTask: vi.fn(async () => true),
          loadTags: vi.fn(async () => []),
          moveTask: vi.fn(async () => true),
          openTask: vi.fn(),
          repairMetadata: vi.fn(async () => true),
          reopenTask: vi.fn(async () => true),
          pinTask: vi.fn(async () => true),
          updateTask: vi.fn(async () => true),
          updateSubtasks: vi.fn(async () => true),
        }),
        openTask: vi.fn(async () => undefined),
      };
      return {
        taskActions,
        projectRecovery: null,
        dismissProjectRecovery: vi.fn(),
        openRecoveryFile: vi.fn(),
        layoutError: null,
        canEditLayout: true,
        revealLayoutFile: vi.fn(async () => ({ success: true as const })),
        createProject: vi.fn(async () => null),
        deleteProject: vi.fn(async () => true),
        error: null,
        hasLoaded: true,
        isMoving: false,
        isLoading: false,
        moveProject: vi.fn(async () => true),
        preferences,
        refresh: vi.fn(async () => undefined),
        projects: [
          { name: "Research", colorId: "blue" },
          { name: "Writing", colorId: "rose" },
        ],
        setPreferences,
        allTasks: [inbox, zebra, alpha],
        hoverTask: null,
        closeHoverTask: vi.fn(),
        updateProject: vi.fn(async () => true),
        usageCountByProjectName: { Research: 2, Writing: 0 },
        orderedTasks: [inbox, zebra, alpha],
      };
    });
    const user = userEvent.setup();
    render(<TaskBoard />);

    const boardResearchTitles = () =>
      Array.from(document.querySelectorAll('[data-task-board-column="backlog"] [data-task-path]')).map((row) =>
        row.getAttribute("data-task-path"),
      );
    expect(boardResearchTitles()).toEqual([zebra.path, alpha.path]);
    expect(document.querySelectorAll('[data-task-path][draggable="true"]')).toHaveLength(2);

    expect(screen.queryByRole("button", { name: "Complete Zebra" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Sort by" }));
    const sortSearch = screen.getByRole("textbox", { name: "Search sort options" });
    const sortOptions = screen.getByRole("listbox", { name: "Sort options" });
    expect(document.activeElement).toBe(sortSearch);
    expect(within(sortOptions).queryByRole("option", { name: "Custom" })).toBeNull();
    expect(
      within(sortOptions)
        .getAllByRole("option")
        .every((option) => option.getAttribute("aria-selected") === "false"),
    ).toBe(true);
    expect(within(sortOptions).getByRole("option", { name: "Due date" }).querySelector("svg")).toBeTruthy();
    await user.type(sortSearch, "nothing matches");
    expect(within(sortOptions).queryAllByRole("option")).toHaveLength(0);
    expect(within(sortOptions).getByText("No matching sort options")).toBeTruthy();
    await user.clear(sortSearch);
    await user.type(sortSearch, "tit");
    expect(within(sortOptions).getByRole("option", { name: "Title" })).toBeTruthy();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.queryByRole("listbox", { name: "Sort options" })).toBeNull();
    expect(boardResearchTitles()).toEqual([alpha.path, zebra.path]);
    expect(document.querySelectorAll('[data-task-path][draggable="true"]')).toHaveLength(2);
    const activeSortButton = screen.getByRole("button", { name: "Sort by: Title" });
    expect(activeSortButton.textContent).toBe("");
    expect(activeSortButton.dataset.sorted).toBe("true");

    expect(screen.getByRole("button", { name: "Sort field 1: Title" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sort order 1: A to Z" }));
    expect(screen.getByRole("button", { name: "Add sort" })).toBeTruthy();
    const direction = screen.getByRole("group", { name: "Sort direction 1" });
    expect(within(direction).getByRole("button", { name: "A to Z" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(direction).getByRole("button", { name: "Z to A" }));
    expect(screen.getByRole("button", { name: "Sort order 1: Z to A" }).getAttribute("aria-expanded")).toBe("false");
    expect(boardResearchTitles()).toEqual([zebra.path, alpha.path]);

    await user.click(screen.getByRole("button", { name: "Sort field 1: Title" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search sort options" }));
    expect((screen.getByRole("textbox", { name: "Search sort options" }) as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Clear sorts" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Search sort options" })).toBeNull();
    expect(screen.getByRole("button", { name: "Clear sorts" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Sort by: Title" }));
    expect(screen.getByRole("button", { name: "Sort order 1: Z to A" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear sorts" }));
    expect(screen.getByRole("button", { name: "Sort by" }).dataset.sorted).toBe("false");
    expect(boardResearchTitles()).toEqual([zebra.path, alpha.path]);
    await user.click(screen.getByRole("button", { name: "Sort by" }));
    await user.click(screen.getByRole("option", { name: "Due date" }));
    expect(screen.getByRole("button", { name: "Sort order 1: Earliest first" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add sort" }));
    expect(screen.queryByRole("option", { name: "Due date" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Priority" }));
    expect(screen.getByRole("button", { name: "Sort by: Due date, Priority" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Sort rule 2" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Move sort rule 2 up" }));
    expect(screen.getByRole("button", { name: "Sort field 1: Priority" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove sort rule 1" }));
    expect(screen.getByRole("button", { name: "Sort by: Due date" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear sorts" }));
    expect(document.querySelectorAll('[data-task-path][draggable="true"]')).toHaveLength(2);
    expect(screen.queryByRole("tab", { name: "List view" })).toBeNull();
  });

  it("shows one loading state instead of a partial Inbox before the first index snapshot", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const research = note("/notes/Research.md");
    let resolveSnapshot!: (entries: unknown[]) => void;
    apiMocks.queryWorkspaceProperty.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    render(
      <Provider store={createStore()}>
        <TaskBoard />
      </Provider>,
    );

    expect(screen.getByRole("status").textContent).toContain("Loading tasks…");
    expect(screen.queryByText("Inbox")).toBeNull();
    expect((screen.getByRole("button", { name: "Manage projects" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("tab", { name: "List view" })).toBeNull();

    await act(async () => {
      fixtures.sources[research.path] = taskSource("Research task", "Research");
      resolveSnapshot([{ file: research, values: [{ type: "string", value: "task" }] }]);
    });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getAllByText("Research").length).toBeGreaterThan(0);
  });

  it("keeps config mutations unavailable when the first snapshot fails", async () => {
    apiMocks.queryWorkspaceProperty.mockRejectedValueOnce(new Error("index unavailable"));

    render(
      <Provider store={createStore()}>
        <TaskBoard />
      </Provider>,
    );

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Tasks unavailable."));
    expect((screen.getByRole("button", { name: "Manage projects" }) as HTMLButtonElement).disabled).toBe(true);
    expect(apiMocks.upsertFile).not.toHaveBeenCalled();
  });
});

it("keeps lifecycle in the fixed workflow columns instead of the filter builder", async () => {
  fixtures.sources["/notes/Active task.md"] = taskSource("Active task");
  fixtures.sources["/notes/Finished task.md"] = taskSource("Finished task", "Research", true);
  const user = userEvent.setup();
  render(<TaskBoard />);

  const active = await screen.findByRole("button", { name: "Open task Active task" });
  const finished = await screen.findByRole("button", { name: "Open task Finished task" });
  expect(active.closest('[data-task-board-column="backlog"]')).toBeTruthy();
  expect(finished.closest('[data-task-board-column="done"]')).toBeTruthy();

  await user.click(screen.getByRole("button", { name: /Filter tasks/ }));
  await user.click(screen.getByRole("button", { name: "Add filter" }));
  expect(screen.queryByRole("option", { name: "Status" })).toBeNull();
  expect(screen.getByRole("option", { name: "Due date" })).toBeTruthy();
  await user.keyboard("{Escape}");
});

it("filters by YAML property presence and lets the operator change in place", async () => {
  fixtures.sources["/notes/Reviewed.md"] = taskSource("Reviewed").replace("type: task", "type: task\nreviewed:");
  fixtures.sources["/notes/Unreviewed.md"] = taskSource("Unreviewed");
  const user = userEvent.setup();
  render(<TaskBoard />);
  await screen.findByRole("button", { name: "Open task Reviewed" });
  await user.click(screen.getByRole("button", { name: /Filter tasks/ }));
  await user.click(screen.getByRole("button", { name: "Add filter" }));
  await user.click(screen.getByRole("option", { name: "YAML property" }));
  expect(screen.getByRole("button", { name: "Filter operator 1: has" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Filter value 1: Choose value" }));
  await user.click(screen.getByRole("button", { name: "reviewed" }));
  expect(screen.getByRole("button", { name: "Open task Reviewed" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open task Unreviewed" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Filter operator 1: has" }));
  await user.click(screen.getByRole("button", { name: "Does not have" }));
  expect(screen.queryByRole("button", { name: "Open task Reviewed" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open task Unreviewed" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save filter..." }));
  await user.type(screen.getByLabelText("Save this filter"), "Needs review");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Remove YAML property filter" }));
  expect(screen.getByRole("button", { name: "Open task Reviewed" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Apply saved filter Needs review" }));
  expect(screen.queryByRole("button", { name: "Open task Reviewed" })).toBeNull();
});

it("expands task search on demand and collapses it when cleared", async () => {
  const user = userEvent.setup();
  render(<TaskBoard />);
  const trigger = screen.getByRole("button", { name: "Search tasks" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("textbox", { name: "Search tasks" })).toBeNull();

  await user.click(trigger);
  const input = screen.getByRole("textbox", { name: "Search tasks" });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(input);
  await user.type(input, "Research");
  await user.click(screen.getByRole("button", { name: /Filter tasks/ }));
  expect(screen.getByRole("textbox", { name: "Search tasks" })).toHaveProperty("value", "Research");

  await user.click(screen.getByRole("button", { name: "Clear task search" }));
  expect(input).toHaveProperty("value", "");
  expect(document.activeElement).toBe(input);
  await user.click(screen.getByRole("button", { name: /Filter tasks/ }));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await user.click(trigger);
  expect(document.activeElement).toBe(input);
  await user.keyboard("{Escape}");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("textbox", { name: "Search tasks" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("keeps a restored task search visible", () => {
  const store = createStore();
  store.set(taskBoardPreferencesAtom, { ...DEFAULT_TASK_BOARD_PREFERENCES, searchQuery: "Research" });
  render(
    <Provider store={store}>
      <TaskBoard />
    </Provider>,
  );
  expect(screen.getByRole("button", { name: "Search tasks" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("textbox", { name: "Search tasks" })).toHaveProperty("value", "Research");
});

it("keeps hidden search matches out of view until their project is shown", async () => {
  const user = userEvent.setup();
  fixtures.sources["/notes/Hidden.md"] = taskSource("Hidden", "Research");
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({
    projects: [{ name: "Research", colorId: "blue", hidden: true }],
    taskOrder: [],
  });
  render(<TaskBoard />);
  await screen.findByRole("button", { name: "Manage projects" });
  await user.click(screen.getByRole("button", { name: "Search tasks" }));
  await user.type(screen.getByRole("textbox", { name: "Search tasks" }), "Hidden");
  expect(screen.queryByRole("button", { name: "Open task Hidden" })).toBeNull();
  expect(screen.queryByText(/matching task is in hidden sections/i)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Manage projects" }));
  await user.click(screen.getByRole("button", { name: "Show Research project" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Open task Hidden" })).toBeTruthy());
  expect(JSON.parse(fixtures.configSource).projects[0].hidden).not.toBe(true);
});

it("remembers each task's collapsed subtasks when the board is reopened", async () => {
  fixtures.sources["/notes/Parent.md"] = taskSource("Parent") + "\n- [ ] First\n";
  fixtures.sources["/notes/Other.md"] = taskSource("Other") + "\n- [ ] Second\n";
  const { result, store } = renderBoard();
  await waitFor(() => expect(result.current.allTasks).toHaveLength(2));
  const board = render(
    <Provider store={store}>
      <TaskBoard />
    </Provider>,
  );
  await screen.findByRole("checkbox", { name: "Complete subtask First" });
  fireEvent.click(
    within(screen.getByRole("button", { name: "Open task Parent" })).getByRole("button", {
      name: "0 of 1 subtasks completed",
    }),
  );
  expect(screen.queryByRole("checkbox", { name: "Complete subtask First" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Complete subtask Second" })).toBeTruthy();
  expect(store.get(taskBoardPreferencesAtom).collapsedSubtaskPaths).toEqual(["/notes/Parent.md"]);

  act(() => store.set(taskBoardPreferencesAtom, (current) => ({ ...current, searchQuery: "Parent" })));
  expect(screen.getByRole("checkbox", { name: "Complete subtask First" })).toBeTruthy();
  expect(store.get(taskBoardPreferencesAtom).collapsedSubtaskPaths).toEqual(["/notes/Parent.md"]);
  act(() => store.set(taskBoardPreferencesAtom, (current) => ({ ...current, searchQuery: "" })));
  expect(screen.queryByRole("checkbox", { name: "Complete subtask First" })).toBeNull();

  board.unmount();
  render(
    <Provider store={store}>
      <TaskBoard />
    </Provider>,
  );
  expect(screen.queryByRole("checkbox", { name: "Complete subtask First" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Complete subtask Second" })).toBeTruthy();
});

it("shows completed search matches in Done without a lifecycle filter", async () => {
  const user = userEvent.setup();
  fixtures.sources["/notes/Finished.md"] = taskSource("Finished", "Research", true);
  fixtures.configExists = true;
  fixtures.configSource = JSON.stringify({ projects: [{ name: "Research", colorId: "blue" }], taskOrder: [] });
  render(
    <Provider store={createStore()}>
      <TaskBoard />
    </Provider>,
  );

  await user.click(screen.getByRole("button", { name: "Search tasks" }));
  await user.type(screen.getByRole("textbox", { name: "Search tasks" }), "Finished");
  const task = await screen.findByRole("button", { name: "Open task Finished" });
  expect(task.closest('[data-task-board-column="done"]')).toBeTruthy();
  expect(screen.queryByText(/completed task also matches this search/i)).toBeNull();
});
