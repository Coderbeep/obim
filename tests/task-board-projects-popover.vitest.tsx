import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskBoardProjectsPopover } from "../src/renderer/src/features/task-board/TaskBoardProjects";

afterEach(cleanup);
const setup = (overrides = {}) => {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    disabled: false,
    projects: [{ name: "Research", colorId: "blue" }],
    usageCountByProjectName: { Research: 2 },
    onCreateProject: vi.fn(async () => ({ name: "Writing", colorId: "teal" })),
    onUpdateProject: vi.fn(async () => true),
    onDeleteProject: vi.fn(async () => true),
    ...overrides,
  };
  render(<TaskBoardProjectsPopover {...props} />);
  return { props, user: userEvent.setup() };
};
describe("TaskBoardProjectsPopover", () => {
  it("explains visibility scope and toggles the actual project", async () => {
    const { user, props } = setup();
    expect(screen.queryByText(/Choose which sections appear on the board/)).toBeNull();
    const row = screen
      .getByRole("button", { name: "Hide Research project" })
      .closest<HTMLElement>(".task-board-project-manager-row")!;
    expect(row.draggable).toBe(false);
    expect(row.querySelector("[data-app-drag-handle]")).toBeNull();
    expect(row.hasAttribute("data-project-drop-edge")).toBe(false);
    expect(screen.queryByRole("button", { name: /Drag .* project to reorder/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Hide Research project" }));
    expect(props.onUpdateProject).toHaveBeenCalledWith("Research", { hidden: true });
  });
  it("filters and creates a project from the search field", async () => {
    const { user, props } = setup();
    await user.type(screen.getByRole("textbox"), "Writing");
    expect(screen.queryByRole("button", { name: "Hide Research project" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add project" }));
    expect(props.onCreateProject).toHaveBeenCalledWith({ name: "Writing", colorId: "teal" });
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });
  it("rejects duplicate names and allows Inbox as a project", async () => {
    const { user, props } = setup();
    await user.type(screen.getByRole("textbox"), "research");
    expect((screen.getByRole("button", { name: "Add project" }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Inbox");
    await user.click(screen.getByRole("button", { name: "Add project" }));
    expect(props.onCreateProject).toHaveBeenCalledWith({ name: "Inbox", colorId: "teal" });
  });
  it("retains a failed creation draft and displays recovery feedback", async () => {
    const { user } = setup({ onCreateProject: vi.fn(async () => null) });
    await user.type(screen.getByRole("textbox"), "Writing");
    await user.click(screen.getByRole("button", { name: "Add project" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Writing");
  });
  it("prevents duplicate visibility writes while saving", async () => {
    let finish!: (success: boolean) => void;
    const onUpdateProject = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const { user } = setup({ onUpdateProject });
    const toggle = screen.getByRole("button", { name: "Hide Research project" });
    await user.click(toggle);
    await user.click(toggle);
    expect(onUpdateProject).toHaveBeenCalledOnce();
    finish(true);
  });
  it("renames from the name and recolors from the swatch", async () => {
    const onProjectRenamed = vi.fn();
    const { user, props } = setup({ onProjectRenamed });
    expect(screen.queryByRole("button", { name: "Edit Research project" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Rename Research project" }));
    const name = screen.getByRole("textbox", { name: "Project name for Research" });
    await waitFor(() => expect(document.activeElement).toBe(name));
    fireEvent.change(name, { target: { value: "Writing" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(props.onUpdateProject).toHaveBeenCalledWith("Research", { name: "Writing" }));
    await waitFor(() => expect(onProjectRenamed).toHaveBeenCalledWith("Research", "Writing"));

    await user.click(screen.getByRole("button", { name: "Change color for Research" }));
    await user.click(screen.getByRole("button", { name: "Use Red for Research" }));
    expect(props.onUpdateProject).toHaveBeenCalledWith("Research", { colorId: "rose" });
  });

  it("requires confirmation before deleting a project", async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole("button", { name: "Delete Research project" }));
    expect(props.onDeleteProject).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("dialog", { name: "Delete Research project" });
    expect(confirmation.classList).toContain("task-board-project-delete-popover");
    expect(confirmation.dataset.side).toBe("bottom");
    expect(document.querySelector(".task-board-project-danger")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDeleteProject).toHaveBeenCalledWith("Research");
  });
});
