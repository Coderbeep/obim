import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TaskBoardTaskEditor } from "../src/renderer/src/features/task-board/TaskBoardTaskEditor";
import type { TaskBoardProject } from "../src/renderer/src/shared/taskBoard";
import { createDraftTaskState } from "../src/renderer/src/features/task-board/taskBoardModel";
import { type CreateTaskInput, type DraftTaskState } from "../src/renderer/src/features/task-board/taskBoardModel";

const projects: TaskBoardProject[] = [
  { name: "Research", colorId: "blue" },
  { name: "Personal", colorId: "violet" },
];

const EditorHarness = ({
  addTask = async () => false,
  availableSections = projects,
  initialDate = "",
  initialSection,
  initialTaskName = "Draft task",
  mode = "create",
  showProjectChooser = false,
  loadTags = async () => ["Research", "Writing"],
}: {
  addTask?: (task: CreateTaskInput) => Promise<boolean>;
  availableSections?: TaskBoardProject[];
  initialDate?: string;
  initialSection?: string;
  initialTaskName?: string;
  mode?: "create" | "edit";
  showProjectChooser?: boolean;
  loadTags?: (currentTags?: readonly string[]) => Promise<string[]>;
}) => {
  const [draft, setDraft] = useState<DraftTaskState | null>({
    ...createDraftTaskState(initialSection),
    dueDate: initialDate,
    taskName: initialTaskName,
  });

  if (!draft) return <output data-testid="editor-state">closed</output>;
  return (
    <>
      <TaskBoardTaskEditor
        showProjectChooser={showProjectChooser}
        draft={draft}
        mode={mode}
        loadTags={loadTags}
        onOpenManageProjects={() => undefined}
        onSubmit={addTask}
        projects={availableSections}
        setDraft={setDraft}
      />
      <output data-testid="draft-section">{draft.project ?? ""}</output>
    </>
  );
};

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterAll(() => vi.unstubAllGlobals());

describe("TaskBoardTaskEditor metadata controls", () => {
  afterEach(cleanup);

  it("displays and accepts day-first dates while saving canonical dates", async () => {
    const user = userEvent.setup();
    const addTask = vi.fn(async () => false);
    render(<EditorHarness addTask={addTask} initialDate="2026-09-07" />);
    const input = screen.getByRole("textbox", { name: "Task date" }) as HTMLInputElement;
    expect(input.value).toBe("07-09-2026");
    expect(input.placeholder).toBe("DD-MM-YYYY");
    await user.clear(input);
    await user.type(input, "14-10-2026");
    expect(input.value).toBe("14-10-2026");
    await user.click(screen.getByRole("button", { name: "Add task" }));
    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({ dueDate: "2026-10-14" }));
  });

  it("inserts date separators during typing and allows backspacing and editing the month", async () => {
    const user = userEvent.setup();
    const addTask = vi.fn(async () => false);
    render(<EditorHarness addTask={addTask} />);
    const input = screen.getByRole("textbox", { name: "Task date" }) as HTMLInputElement;
    await user.type(input, "14");
    expect(input.value).toBe("14-");
    await user.keyboard("09");
    expect(input.value).toBe("14-09-");
    await user.keyboard("2026");
    expect(input.value).toBe("14-09-2026");
    input.setSelectionRange(3, 5);
    await user.keyboard("10");
    expect(input.value).toBe("14-10-2026");
    expect(input.selectionStart).toBe(6);
    input.setSelectionRange(10, 10);
    await user.keyboard("{Backspace}{Backspace}");
    expect(input.value).toBe("14-10-20");
    await user.keyboard("27");
    await user.click(screen.getByRole("button", { name: "Add task" }));
    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({ dueDate: "2027-10-14" }));
  });

  it("does not expose task file destination settings", () => {
    render(<EditorHarness />);

    expect(screen.queryByRole("combobox", { name: "Destination folder" })).toBeNull();
    expect(screen.queryByText(/^Path:/)).toBeNull();
    expect(screen.getByRole("radio", { name: "Medium" }).className).toContain("px-0");
    const title = screen.getByRole("textbox", { name: "Task name" });
    const editor = title.closest("[data-task-editor-layout]");
    const tags = screen.getByRole("button", { name: "Choose tags" });
    const date = screen.getByRole("textbox", { name: "Task date" });
    const priority = screen.getByRole("radiogroup", { name: "Choose priority" });
    expect(editor?.className).toContain("grid-cols-[minmax(0,1fr)]");
    expect(editor?.firstElementChild?.className).not.toContain("w-6");
    expect(title.className).not.toContain("pr-");
    expect(screen.queryByRole("textbox", { name: "Task details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose project" })).toBeNull();
    expect(priority.parentElement?.className).toContain("grid-cols-[minmax(0,1fr)_7.5rem]");
    expect(tags.parentElement?.className).toContain("col-start-1");
    expect(date.parentElement?.parentElement?.className).toContain("col-start-2");
    expect(priority.className).toContain("row-start-2");
  });

  it("submits the selected note date and ordinary tags", async () => {
    const user = userEvent.setup();
    const addTask = vi.fn(async () => false);
    const loadTags = vi.fn(async () => ["Research", "Writing"]);
    render(<EditorHarness addTask={addTask} initialDate="2026-07-22" loadTags={loadTags} />);

    await user.click(screen.getByRole("button", { name: "Choose tags" }));
    const researchTag = await screen.findByRole("option", { name: "Research" });
    expect(researchTag.querySelector("svg")).toBeTruthy();
    await user.click(researchTag);
    expect(researchTag.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Escape}");
    expect(loadTags).toHaveBeenCalledWith([]);

    await user.click(screen.getByRole("button", { name: "Choose date" }));
    const julyTwentyThird = document.querySelector<HTMLButtonElement>('[data-day="2026-07-23"] button');
    expect(julyTwentyThird).toBeTruthy();
    await user.click(julyTwentyThird!);
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() =>
      expect(addTask).toHaveBeenCalledWith({
        taskName: "Draft task",
        initialBody: "",
        dueDate: "2026-07-23",
        priority: undefined,
        project: undefined,
        stage: "backlog",
        tags: ["Research"],
      }),
    );
  });

  it("closes the tag selector with Escape without discarding the task draft", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);

    await user.click(screen.getByRole("button", { name: "Choose tags" }));
    expect(await screen.findByRole("listbox", { name: "Tags" })).toBeTruthy();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull());
    expect(screen.getByRole("textbox", { name: "Task name" })).toBeTruthy();
  });

  it("keeps a new empty task neutral until title validation is relevant", async () => {
    render(<EditorHarness initialTaskName="" />);

    const title = screen.getByRole("textbox", { name: "Task name" });
    const date = screen.getByRole("textbox", { name: "Task date" });
    expect(screen.queryByText("Enter a task name.")).toBeNull();
    expect(title.getAttribute("aria-invalid")).toBe("false");
    expect(title.getAttribute("aria-describedby")).toBeNull();
    expect((screen.getByRole("button", { name: "Add task" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(title, { key: "Enter" });
    expect(screen.getByText("Enter a task name.").getAttribute("id")).toBe(title.getAttribute("aria-describedby"));
    expect(title.className).toContain("focus-visible:ring-0");
    expect(title.className).toContain("aria-invalid:ring-0");
    expect(title.className).toContain("aria-invalid:border-none");

    fireEvent.change(title, { target: { value: "bad/name" } });
    expect(title.getAttribute("aria-invalid")).toBe("false");

    fireEvent.change(date, { target: { value: "31-02-2026" } });
    expect(screen.getByText("Enter a real date in DD-MM-YYYY format.").getAttribute("id")).toBe(
      date.getAttribute("aria-describedby"),
    );
    expect((screen.getByRole("button", { name: "Add task" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(["create", "edit"] as const)("closes a changed %s draft with Escape without a system prompt", (mode) => {
    const confirm = vi.spyOn(window, "confirm");
    const addTask = vi.fn(async () => true);
    render(<EditorHarness mode={mode} addTask={addTask} initialTaskName="A considered task" />);

    const title = screen.getByRole("textbox", { name: "Task name" });
    fireEvent.change(title, { target: { value: "Unsaved changes" } });
    fireEvent.keyDown(title, { key: "Escape" });
    expect(confirm).not.toHaveBeenCalled();
    expect(addTask).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor-state").textContent).toBe("closed");
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])("submits a modified Enter only once", async (modifier) => {
    const addTask = vi.fn(async () => false);
    render(<EditorHarness addTask={addTask} />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Task name" }), { key: "Enter", ...modifier });

    await waitFor(() => expect(addTask).toHaveBeenCalledTimes(1));
  });

  it("uses semantic colors in the priority tabs", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);

    const high = screen.getByRole("radio", { name: "High" });
    const medium = screen.getByRole("radio", { name: "Medium" });
    const low = screen.getByRole("radio", { name: "Low" });
    const none = screen.getByRole("radio", { name: "None" });
    expect(high.className).toContain("[color:var(--task-priority-high)]");
    expect(medium.className).toContain("[color:var(--status-info)]");
    expect(low.className).toContain("text-muted-foreground");
    expect(low.className).toContain("justify-center");
    expect(high.className).not.toContain("hover:bg-");
    expect(medium.className).not.toContain("hover:bg-");
    expect(low.className).not.toContain("hover:bg-");
    expect(high.querySelector("svg")?.className.baseVal).toContain("fill-current");
    expect(high.querySelector("path")?.getAttribute("fill-rule")).toBeNull();
    expect(medium.querySelector("svg")?.className.baseVal).toContain("fill-current");
    expect(medium.querySelector("svg")?.className.baseVal).toContain("shrink-0");
    expect(medium.getAttribute("aria-label")).toBe("Medium");
    expect(medium.querySelector(".task-board-priority-label")?.textContent).toBe("Medium");
    expect(none.querySelector("svg")).toBeNull();
    expect(low.querySelector("svg")?.className.baseVal).toContain("fill-current");
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["High", "Medium", "Low", "None"]);
    const indicator = document.querySelector<HTMLElement>("[data-priority-indicator]");
    expect(indicator?.style.transform).toBe("translateX(300%)");
    expect(indicator?.className).toContain("duration-[140ms]");

    await user.click(high);
    expect(high.getAttribute("aria-checked")).toBe("true");
    expect(none.getAttribute("aria-checked")).toBe("false");
    expect(indicator?.style.transform).toBe("translateX(0%)");

    await user.click(low);
    expect(low.getAttribute("aria-checked")).toBe("true");
    expect(indicator?.style.transform).toBe("translateX(200%)");
  });

  it("inherits a named project and can select another project", async () => {
    const user = userEvent.setup();
    const addTask = vi.fn(async () => false);
    render(<EditorHarness showProjectChooser addTask={addTask} initialSection="Research" />);

    expect(screen.getByTestId("draft-section").textContent).toBe("Research");
    await user.click(screen.getByRole("button", { name: "Choose project" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Personal" }));
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() =>
      expect(addTask).toHaveBeenCalledWith({
        taskName: "Draft task",
        initialBody: "",
        dueDate: undefined,
        priority: undefined,
        project: "Personal",
        stage: "backlog",
        tags: [],
      }),
    );
    expect(screen.getByTestId("draft-section").textContent).toBe("Personal");
  });

  it("clears a selected section that is deleted while the draft remains open", async () => {
    const addTask = vi.fn(async () => false);
    const { rerender } = render(<EditorHarness showProjectChooser addTask={addTask} initialSection="Research" />);

    rerender(
      <EditorHarness
        showProjectChooser
        addTask={addTask}
        initialSection="Research"
        availableSections={[projects[1]]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("draft-section").textContent).toBe(""));
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(addTask).toHaveBeenCalledWith({
      taskName: "Draft task",
      initialBody: "",
      dueDate: undefined,
      priority: undefined,
      project: undefined,
      stage: "backlog",
      tags: [],
    });
  });

  it("keeps project values distinct from internal-looking names", async () => {
    const sentinelNamedSection = { name: "__task-board-inbox__", colorId: "teal" };
    const user = userEvent.setup();
    render(<EditorHarness showProjectChooser availableSections={[sentinelNamedSection]} />);

    await user.click(screen.getByRole("button", { name: "Choose project" }));
    await user.click(await screen.findByRole("menuitemradio", { name: sentinelNamedSection.name }));

    await waitFor(() => expect(screen.getByTestId("draft-section").textContent).toBe(sentinelNamedSection.name));
  });
});

describe.each(["board"] as const)("priority shortcuts in %s layout", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it.each(["create", "edit"] as const)("submits %s after clicking a priority flag", async (mode) => {
    const user = userEvent.setup();
    const addTask = vi.fn(async () => true);
    render(<EditorHarness mode={mode} addTask={addTask} />);
    await user.click(screen.getByRole("radio", { name: "High" }));
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "High" }));
    await user.keyboard("{Enter}");
    expect(addTask).toHaveBeenCalledTimes(1);
    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({ priority: "high" }));
    expect(screen.getByTestId("editor-state").textContent).toBe("closed");
  });
  it.each(["create", "edit"] as const)(
    "cancels %s with Escape after choosing priority, without a system prompt",
    async (mode) => {
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, "confirm");
      render(<EditorHarness mode={mode} />);
      await user.click(screen.getByRole("radio", { name: "Medium" }));
      await user.keyboard("{Escape}");
      expect(confirm).not.toHaveBeenCalled();
      expect(screen.getByTestId("editor-state").textContent).toBe("closed");
    },
  );
});

it("creates a tag with Enter without submitting the task and closes the dropdown with Escape", async () => {
  const user = userEvent.setup();
  const addTask = vi.fn(async () => false);
  render(<EditorHarness addTask={addTask} />);
  await user.click(screen.getByRole("button", { name: "Choose tags" }));
  await user.type(screen.getByRole("textbox", { name: "Search tags" }), "New tag{Enter}");
  expect(screen.getByRole("button", { name: "Choose tags" }).textContent).toContain("New tag");
  expect(addTask).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull();
  expect(screen.getByRole("button", { name: "Choose tags" }).textContent).toContain("New tag");
  await user.click(screen.getByRole("button", { name: "Choose tags" }));
  await user.click(screen.getByRole("option", { name: "New tag" }));
  expect(screen.getByRole("option", { name: "New tag" }).getAttribute("aria-selected")).toBe("false");
});

it("reveals the caret at the end of a long title when editing starts", () => {
  cleanup();
  const width = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
  try {
    const name = "A long task title whose ending should be visible when editing starts";
    render(<EditorHarness mode="edit" initialTaskName={name} />);
    const input = screen.getByRole("textbox", { name: "Task name" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(name.length);
    expect(input.selectionEnd).toBe(name.length);
    expect(input.scrollLeft).toBe(900);
  } finally {
    cleanup();
    width.mockRestore();
  }
});
