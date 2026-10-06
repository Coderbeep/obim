import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { useRef, useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskBoardFilters } from "../src/renderer/src/features/task-board/TaskBoardFilters";
import {
  activeTaskFilterRows,
  applyTaskFilter,
  clearFilterProperty,
  emptyTaskFilters,
  savedFilterSummary,
  saveTaskFilter,
  selectTaskFilters,
} from "../src/renderer/src/features/task-board/taskBoardModel";
import { useTaskBoardPreferences } from "../src/renderer/src/features/task-board/useTaskBoard";
import { useTaskBoardReveal } from "../src/renderer/src/features/task-board/useTaskBoard";
import { useTaskBoardView } from "../src/renderer/src/features/task-board/useTaskBoard";
import { filterTaskBoardTasks } from "../src/renderer/src/features/task-board/taskBoardModel";
import { type TaskBoardTask } from "../src/renderer/src/features/task-board/taskBoardModel";
import {
  DEFAULT_TASK_BOARD_PREFERENCES,
  type TaskBoardPreferences,
} from "../src/renderer/src/store/taskBoardPreferencesStore";
import {
  taskBoardAgendaActionsAtom,
  taskBoardRevealRequestAtom,
} from "../src/renderer/src/store/taskBoardInspectorStore";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const preferences = (patch: Partial<TaskBoardPreferences> = {}): TaskBoardPreferences => ({
  ...DEFAULT_TASK_BOARD_PREFERENCES,
  collapsedSubtaskPaths: ["/notes/Parent.md"],
  sortRules: [{ field: "title", direction: "ascending" }],
  ...patch,
});
const task = (title: string, patch: Partial<TaskBoardTask> = {}): TaskBoardTask => ({
  id: title,
  path: `/notes/${title}.md`,
  relativePath: `${title}.md`,
  filename: `${title}.md`,
  title,
  isDirectory: false,
  mimeType: "text/markdown",
  status: "open",
  metadataIssues: [],
  project: "Research",
  ...patch,
});

it("selects only runtime filter fields and round-trips date, empty, multi-choice and YAML filters", () => {
  const current = preferences({
    dueFilter: "range",
    dueDateFilter: "2026-09-27",
    dueDateEndFilter: "",
    priorityFilters: ["none", "high"],
    tagFilters: ["paper", "__untagged__"],
    yamlPropertyFilter: { key: "Empty key", operator: "does not have" },
    searchQuery: "query",
    lifecycleView: "closed",
  });
  const savedState = saveTaskFilter(current, "saved", "Review");
  const saved = savedState.savedFilters[0];
  expect(selectTaskFilters(saved)).toEqual(selectTaskFilters(current));
  expect(selectTaskFilters(saved)).not.toHaveProperty("id");
  expect(selectTaskFilters(saved)).not.toHaveProperty("lifecycleView");
  const applied = applyTaskFilter(preferences(), saved);
  expect(selectTaskFilters(applied)).toEqual(selectTaskFilters(current));
  expect(applied.activeSavedFilterId).toBe("saved");
  expect(applied.lifecycleView).toBe("closed");
  expect(applied.sortRules).toEqual(preferences().sortRules);
  expect(applied.collapsedSubtaskPaths).toEqual(preferences().collapsedSubtaskPaths);
});

it("derives counts, row labels and saved summaries from the same active fields", () => {
  const filters = {
    ...emptyTaskFilters(),
    priorityFilters: ["none" as const],
    tagFilters: ["__untagged__"],
    dueFilter: "no-date" as const,
    yamlPropertyFilter: { key: "review", operator: "has" as const },
    searchQuery: "  plan  ",
  };
  const rows = activeTaskFilterRows(filters);
  expect(rows).toHaveLength(4);
  expect(rows.map(({ property, operator, value }) => ({ property, operator, value }))).toEqual([
    { property: "priority", operator: "is", value: "None" },
    { property: "due", operator: "is empty", value: "No date" },
    { property: "tag", operator: "is empty", value: "No tags" },
    { property: "yaml", operator: "has", value: "review" },
  ]);
  expect(savedFilterSummary(filters)).toBe("none · No date · No tags · YAML has review · Search: “plan”");
  expect(rows.find(({ property }) => property === "yaml")?.chipLabel).toBeUndefined();
});

it("clears one property without changing other filters or dormant date bounds", () => {
  const filters = {
    ...emptyTaskFilters(),
    dueFilter: "range" as const,
    dueDateFilter: "2026-09-27",
    dueDateEndFilter: "2026-09-30",
    tagFilters: ["paper"],
  };
  expect({ ...filters, ...clearFilterProperty("due") }).toEqual({ ...filters, dueFilter: "all" });
  expect(activeTaskFilterRows({ ...filters, ...clearFilterProperty("due") }).map(({ property }) => property)).toEqual([
    "tag",
  ]);
});

it("keeps the most recent 50 saved definitions", () => {
  const current = preferences();
  const one = saveTaskFilter(current, "template", "Template").savedFilters[0];
  current.savedFilters = Array.from({ length: 50 }, (_, index) => ({ ...one, id: String(index) }));
  const saved = saveTaskFilter(current, "new", "New");
  expect(saved.savedFilters).toHaveLength(50);
  expect(saved.savedFilters[0].id).toBe("1");
  expect(saved.savedFilters.at(-1)?.id).toBe("new");
});

it("applies stale control callbacks against the latest unrelated preferences", () => {
  const { result } = renderHook(() => {
    const [current, setPreferences] = useState(preferences());
    return { current, setPreferences, controls: useTaskBoardPreferences(current, setPreferences) };
  });
  const original = result.current.controls;
  const existing = saveTaskFilter(preferences(), "existing", "Existing").savedFilters[0];
  act(() =>
    result.current.setPreferences((current) => ({
      ...current,
      collapsedSubtaskPaths: ["/notes/Other.md"],
      savedFilters: [existing],
      sortRules: [{ field: "due", direction: "descending" }],
    })),
  );
  act(() => {
    original.updateFilters({ priorityFilters: ["high"] });
    original.saveCurrentFilter("High");
  });
  expect(result.current.current.priorityFilters).toEqual(["high"]);
  expect(result.current.current.savedFilters.map(({ name }) => name)).toEqual(["Existing", "High"]);
  expect(result.current.current.savedFilters.at(-1)?.priorityFilters).toEqual(["high"]);
  expect(result.current.current.collapsedSubtaskPaths).toEqual(["/notes/Other.md"]);
  expect(result.current.current.sortRules).toEqual([{ field: "due", direction: "descending" }]);
  act(() => original.applySavedFilter(existing));
  expect(result.current.current.collapsedSubtaskPaths).toEqual(["/notes/Other.md"]);
  expect(result.current.current.sortRules).toEqual([{ field: "due", direction: "descending" }]);
  act(() => original.clearFilters());
  expect(selectTaskFilters(result.current.current)).toEqual(emptyTaskFilters());
  expect(result.current.current.activeSavedFilterId).toBeNull();
  expect(result.current.current.savedFilters).toHaveLength(2);
});

it("deletes saved definitions and changes sorting without discarding newer state", () => {
  const first = saveTaskFilter(preferences(), "first", "First").savedFilters[0];
  const second = { ...first, id: "second", name: "Second" };
  const { result } = renderHook(() => {
    const [current, setPreferences] = useState(preferences({ savedFilters: [first], activeSavedFilterId: "first" }));
    return { current, setPreferences, controls: useTaskBoardPreferences(current, setPreferences) };
  });
  const original = result.current.controls;
  act(() =>
    result.current.setPreferences((current) => ({ ...current, savedFilters: [first, second], tagFilters: ["new"] })),
  );
  act(() => {
    original.deleteSavedFilter("first");
    original.setSortRules([]);
  });
  expect(result.current.current.savedFilters).toEqual([second]);
  expect(result.current.current.activeSavedFilterId).toBeNull();
  expect(result.current.current.tagFilters).toEqual(["new"]);
  expect(result.current.current.collapsedSubtaskPaths).toEqual(["/notes/Parent.md"]);
});

it("keeps tag choices as OR and YAML presence exact, including empty-valued keys", () => {
  const tasks = [
    task("Paper", { tags: ["paper"], frontmatterKeys: ["review"] }),
    task("Empty", { frontmatterKeys: ["Review"] }),
    task("Other", { tags: ["other"] }),
  ];
  expect(
    filterTaskBoardTasks(tasks, { ...emptyTaskFilters(), tagFilters: ["paper", "__untagged__"] }).map(
      ({ title }) => title,
    ),
  ).toEqual(["Paper", "Empty"]);
  expect(
    filterTaskBoardTasks(tasks, { ...emptyTaskFilters(), yamlPropertyFilter: { key: "review", operator: "has" } }).map(
      ({ title }) => title,
    ),
  ).toEqual(["Paper"]);
});

it("recomputes date views when the local day changes and retains stable sorted ties", () => {
  const tasks = [
    task("Same", { id: "first", dueDate: "2026-09-27" }),
    task("Same", { id: "second", dueDate: "2026-09-27" }),
    task("Tomorrow", { dueDate: "2026-09-28" }),
  ];
  const projects = [{ name: "Research", colorId: "blue" }];
  const filters = { ...emptyTaskFilters(), dueFilter: "today" as const };
  const sortRules = [{ field: "title" as const, direction: "ascending" as const }];
  const { result, rerender } = renderHook(
    ({ today }) => useTaskBoardView({ tasks, projects, filters, sortRules, today }),
    { initialProps: { today: new Date(2026, 8, 27) } },
  );
  expect(result.current.columns[0].tasks.map(({ id }) => id)).toEqual(["first", "second"]);
  rerender({ today: new Date(2026, 8, 28) });
  expect(result.current.columns[0].tasks.map(({ title }) => title)).toEqual(["Tomorrow"]);
});

it("reveals a hidden project once, preserving sorts and collapse state and allowing later filter changes", async () => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const store = createStore();
  const requested = task("Hidden task", { project: "Hidden" });
  const tasks = [requested];
  const projects = [
    { name: "Visible", colorId: "blue" },
    { name: "Hidden", colorId: "rose", hidden: true },
  ];
  const actions = { openTask: vi.fn(async () => {}), refresh: vi.fn(async () => {}), projects };
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
  const { result, unmount } = renderHook(
    () => {
      const [current, setPreferences] = useState(preferences({ searchQuery: "no match", lifecycleView: "closed" }));
      const controls = useTaskBoardPreferences(current, setPreferences);
      const view = useTaskBoardView({
        tasks,
        projects,
        filters: controls.filters,
        sortRules: controls.sortRules,
        today: new Date(2026, 8, 27),
      });
      const root = useRef<HTMLDivElement>(null);
      useTaskBoardReveal({
        root,
        columns: view.columns,
        filters: controls.filters,
        today: new Date(2026, 8, 27),
        clearFilters: controls.clearFilters,
        revealProject: view.revealProject,
        agendaActions: actions,
      });
      return { current, controls, view };
    },
    { wrapper },
  );
  expect(result.current.view.visibleProjects.map(({ name }) => name)).toEqual(["Visible"]);
  act(() => store.set(taskBoardRevealRequestAtom, { id: "request", task: requested }));
  await waitFor(() => expect(result.current.view.selectedProject).toBe("Hidden"));
  expect(result.current.current.searchQuery).toBe("");
  expect(result.current.current.lifecycleView).toBe("closed");
  expect(result.current.current.sortRules).toEqual(preferences().sortRules);
  expect(result.current.current.collapsedSubtaskPaths).toEqual(preferences().collapsedSubtaskPaths);
  act(() => {
    result.current.view.clearRevealedProject();
    result.current.controls.updateFilters({ searchQuery: "later" });
  });
  expect(result.current.current.searchQuery).toBe("later");
  expect(result.current.view.visibleProjects.map(({ name }) => name)).toEqual(["Visible"]);
  expect(result.current.view.selectedProject).toBe("Visible");
  expect(store.get(taskBoardAgendaActionsAtom)).toEqual(actions);
  unmount();
  expect(store.get(taskBoardRevealRequestAtom)).toBeNull();
  expect(store.get(taskBoardAgendaActionsAtom)).toBeNull();
});

it("keeps a pending replacement draft local until its value is chosen and restores value focus", async () => {
  const user = userEvent.setup();
  let current = preferences({ priorityFilters: ["high"] });
  const onChange = vi.fn();
  const Harness = () => {
    const [value, setValue] = useState(current);
    current = value;
    return (
      <TaskBoardFilters
        filters={selectTaskFilters(value)}
        savedFilters={[]}
        activeSavedFilterId={null}
        availableTags={["paper"]}
        availableYamlKeys={[]}
        loadTags={async () => ["paper"]}
        onChange={(patch) => {
          onChange(patch);
          setValue((previous) => ({ ...previous, ...patch }));
        }}
        onClear={vi.fn()}
        onApplySavedFilter={vi.fn()}
        onDeleteSavedFilter={vi.fn()}
        onSaveCurrentFilter={vi.fn()}
      />
    );
  };
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: /Filter tasks/ }));
  await user.click(screen.getByRole("button", { name: "Filter property 1: Priority" }));
  await user.click(screen.getByRole("option", { name: "Tag" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(current.priorityFilters).toEqual(["high"]);
  await user.click(screen.getByRole("button", { name: "Filter value 1: Choose value" }));
  await user.click(screen.getByRole("button", { name: "paper" }));
  expect(onChange).toHaveBeenCalledWith({ priorityFilters: [], tagFilters: ["paper"] });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Filter value 1: paper" }));
});
