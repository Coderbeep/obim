import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFrontmatterProperty, getFrontmatterStringList, parseFrontmatter } from "../src/shared/frontmatter";
import {
  cleanupNoteDetailsTestHarness,
  NoteDetailsHarness,
  overrideNoteDetailsApi,
  setWorkspaceFields,
  setupNoteDetailsTestHarness,
} from "./note-details-test-harness";

const latestSource = (onSourceChange: ReturnType<typeof vi.fn>) => onSourceChange.mock.lastCall?.[0] as string;

const openDetails = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Show note details" }));
};

const addNamedField = async (user: ReturnType<typeof userEvent.setup>, key: string) => {
  const input = screen.getByRole("combobox", { name: "New field name" });
  await user.type(input, key);
  await user.keyboard("{Enter}");
};

const openTypeMenu = async (user: ReturnType<typeof userEvent.setup>, key: string) => {
  await user.click(screen.getByRole("button", { name: `Open ${key} field menu` }));
  await user.hover(screen.getByRole("menuitem", { name: "Field type" }));
  await screen.findAllByRole("menuitemradio");
};

describe("Note Details", () => {
  beforeEach(setupNoteDetailsTestHarness);
  afterEach(cleanupNoteDetailsTestHarness);

  it("shows managed properties in source order and keeps type in its dedicated control", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <NoteDetailsHarness initialSource={"---\ntype: task\nstatus: draft\ntags: [one, two]\n---\nBody"} />,
    );

    expect(container.querySelector(".note-details-summary")?.textContent).toContain("2 fields");
    await openDetails(user);

    expect(
      Array.from(
        container.querySelectorAll<HTMLInputElement>(".note-details-property-key-input"),
        ({ value }) => value,
      ),
    ).toEqual(["status", "tags"]);
    expect(screen.queryByDisplayValue("type")).toBeNull();
  });

  it("creates built-ins with their required local type", async () => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(<NoteDetailsHarness initialSource="# Note" onSourceChange={onSourceChange} />);

    await openDetails(user);
    await user.click(screen.getByRole("option", { name: "tags" }));

    expect(getFrontmatterStringList(parseFrontmatter(latestSource(onSourceChange)), "tags")).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Add tags item" }));
  });

  it("turns Add details into a stable Hide details toggle for an empty note", async () => {
    const user = userEvent.setup();
    render(<NoteDetailsHarness initialSource="# Note" />);

    const show = screen.getByRole("button", { name: "Show note details" });
    expect(show.textContent).toContain("Add details");
    await user.click(show);

    const hide = screen.getByRole("button", { name: "Hide note details" });
    expect(hide.textContent).toContain("Hide details");
    expect(screen.getByRole("form", { name: "Add note field" })).toBeTruthy();
    await user.click(hide);

    expect(screen.queryByRole("form", { name: "Add note field" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show note details" }).textContent).toContain("Add details");
  });

  it("creates an unknown field as Text even when workspace suggestions fail", async () => {
    overrideNoteDetailsApi({ listWorkspaceFrontmatterFields: vi.fn(async () => Promise.reject(new Error("offline"))) });
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(<NoteDetailsHarness initialSource="# Note" onSourceChange={onSourceChange} />);

    await openDetails(user);
    await addNamedField(user, "citation-key");

    expect(getFrontmatterProperty(parseFrontmatter(latestSource(onSourceChange)), "citation-key")?.value).toEqual({
      kind: "string",
      value: "",
    });
  });

  it("uses an exact unanimous observed type only as a creation hint", async () => {
    setWorkspaceFields({ projects: "list" });
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(<NoteDetailsHarness initialSource="# Note" onSourceChange={onSourceChange} />);

    await openDetails(user);
    await user.click(await screen.findByRole("option", { name: "projects" }));

    expect(getFrontmatterStringList(parseFrontmatter(latestSource(onSourceChange)), "projects")).toEqual([]);
    expect(window.api.saveFile).not.toHaveBeenCalled();
    expect(window.api.upsertFile).not.toHaveBeenCalled();
  });

  it("creates a dismissed workspace suggestion as directly entered Text", async () => {
    setWorkspaceFields({ author: "list" });
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(<NoteDetailsHarness initialSource="# Note" onSourceChange={onSourceChange} />);

    await openDetails(user);
    const input = screen.getByRole("combobox", { name: "New field name" });
    await user.type(input, "author");
    await screen.findByRole("option", { name: "author" });
    await user.keyboard("{Escape}{Enter}");

    expect(getFrontmatterProperty(parseFrontmatter(latestSource(onSourceChange)), "author")?.value).toEqual({
      kind: "string",
      value: "",
    });
  });

  it("falls back to Text for mixed observations of the same exact key", async () => {
    overrideNoteDetailsApi({
      listWorkspaceFrontmatterFields: vi.fn<Window["api"]["listWorkspaceFrontmatterFields"]>(async () => [
        { key: "rating", type: "number", count: 1 },
        { key: "rating", type: "text", count: 2 },
      ]),
    });
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(<NoteDetailsHarness initialSource="# Note" onSourceChange={onSourceChange} />);

    await openDetails(user);
    await user.click(await screen.findByRole("option", { name: "rating" }));

    expect(getFrontmatterProperty(parseFrontmatter(latestSource(onSourceChange)), "rating")?.value).toEqual({
      kind: "string",
      value: "",
    });
  });

  it("changes a type only in the current note and ignores workspace observations", async () => {
    setWorkspaceFields({ author: "number" });
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(<NoteDetailsHarness initialSource={'---\nauthor: "Ada"\n---\nBody'} onSourceChange={onSourceChange} />);

    await openDetails(user);
    await openTypeMenu(user, "author");
    expect(screen.getByRole("menuitemradio", { name: "Number" }).getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "List" }));
    await waitFor(() => expect(onSourceChange).toHaveBeenCalledTimes(1));

    expect(getFrontmatterStringList(parseFrontmatter(latestSource(onSourceChange)), "author")).toEqual(["Ada"]);
    expect(window.api.saveFile).not.toHaveBeenCalled();
    expect(window.api.upsertFile).not.toHaveBeenCalled();
  });

  it("confirms before discarding a current-note value for a type change", async () => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(
      <NoteDetailsHarness initialSource={"---\nprojects: [one, two]\n---\nBody"} onSourceChange={onSourceChange} />,
    );

    await openDetails(user);
    await openTypeMenu(user, "projects");

    for (const label of ["Date", "Date & time", "Number", "Checkbox", "Text"]) {
      expect(screen.getByRole("menuitemradio", { name: label }).getAttribute("aria-disabled")).toBeNull();
    }

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Checkbox" }));
    expect(screen.getByRole("alertdialog", { name: "Change projects to Checkbox?" })).toBeTruthy();
    expect(screen.getByText(/will discard its current value in this note/i)).toBeTruthy();
    expect(onSourceChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSourceChange).not.toHaveBeenCalled();

    await openTypeMenu(user, "projects");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Checkbox" }));
    await user.click(screen.getByRole("button", { name: "Change type" }));

    await waitFor(() => expect(onSourceChange).toHaveBeenCalledTimes(1));
    expect(getFrontmatterProperty(parseFrontmatter(latestSource(onSourceChange)), "projects")?.value).toEqual({
      kind: "boolean",
      value: false,
    });
  });

  it("changes an empty value to any type without confirmation", async () => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(<NoteDetailsHarness initialSource={"---\nprojects: []\n---\nBody"} onSourceChange={onSourceChange} />);

    await openDetails(user);
    await openTypeMenu(user, "projects");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Checkbox" }));

    await waitFor(() => expect(onSourceChange).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(getFrontmatterProperty(parseFrontmatter(latestSource(onSourceChange)), "projects")?.value).toEqual({
      kind: "boolean",
      value: false,
    });
  });

  it("renames locally without adopting the observed type of the destination name", async () => {
    setWorkspaceFields({ projects: "list" });
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(<NoteDetailsHarness initialSource={'---\nauthor: "Ada"\n---\nBody'} onSourceChange={onSourceChange} />);

    await openDetails(user);
    const keyInput = screen.getByRole("combobox", { name: "Edit author field name" });
    await user.clear(keyInput);
    await user.type(keyInput, "projects");
    await user.click(await screen.findByRole("option", { name: "projects" }));

    expect(getFrontmatterProperty(parseFrontmatter(latestSource(onSourceChange)), "projects")?.value).toEqual({
      kind: "string",
      value: "Ada",
    });
  });

  it("rejects case-insensitive UI collisions and the selector-owned type field", async () => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(
      <NoteDetailsHarness
        initialSource={'---\nAuthor: "Ada"\nproject: "Obim"\n---\nBody'}
        onSourceChange={onSourceChange}
      />,
    );

    await openDetails(user);
    const projectKey = screen.getByRole("combobox", { name: "Edit project field name" });
    await user.clear(projectKey);
    await user.type(projectKey, "author{Enter}");
    expect(screen.getByText("Field “author” already exists.")).toBeTruthy();

    await user.clear(projectKey);
    await user.type(projectKey, "type{Enter}");
    expect(screen.getByText("Use the note type selector to change the type field.")).toBeTruthy();
    expect(onSourceChange).not.toHaveBeenCalled();
  });

  it("edits each managed scalar through its value-native control", async () => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    const { container } = render(
      <NoteDetailsHarness
        initialSource={
          "---\nstatus: draft\ncount: 2\npublished: false\ndue: 2026-07-14\ncreated: 2026-07-14T10:30:00Z\n---\nBody"
        }
        onSourceChange={onSourceChange}
      />,
    );

    await openDetails(user);
    const row = (key: string) => container.querySelector<HTMLElement>(`[data-property-key='${key}']`);

    const status = screen.getByRole("combobox", { name: "Edit status value" });
    await user.clear(status);
    await user.type(status, "false{Enter}");
    expect(document.activeElement).toBe(row("status"));

    const count = screen.getByRole("spinbutton", { name: "Edit count value" });
    await user.clear(count);
    await user.type(count, "3.5{Enter}");

    const published = screen.getByRole("checkbox", { name: "Edit published value" });
    await user.click(published);

    const due = screen.getByRole("textbox", { name: "Edit due value" });
    await user.clear(due);
    await user.type(due, "2026-07-16{Enter}");

    const created = screen.getByLabelText<HTMLInputElement>("Edit created value");
    expect(created.type).toBe("text");
    created.focus();
    fireEvent.change(created, { target: { value: "2026-07-15T11:45:00" } });
    fireEvent.keyDown(created, { key: "Enter" });

    const parsed = parseFrontmatter(latestSource(onSourceChange));
    expect(getFrontmatterProperty(parsed, "status")?.value).toEqual({ kind: "string", value: "false" });
    expect(getFrontmatterProperty(parsed, "count")?.value).toEqual({ kind: "number", source: "3.5", value: 3.5 });
    expect(getFrontmatterProperty(parsed, "published")?.value).toEqual({ kind: "boolean", value: true });
    expect(getFrontmatterProperty(parsed, "due")?.value).toMatchObject({
      kind: "date",
      dateOnly: true,
      source: "2026-07-16",
    });
    expect(getFrontmatterProperty(parsed, "created")?.value).toMatchObject({
      kind: "date",
      dateOnly: false,
      value: "2026-07-15T11:45:00.000Z",
    });
  });

  it("uses the app calendar and time controls for date-time fields", async () => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(
      <NoteDetailsHarness
        initialSource={"---\ncreated: 2026-07-14T10:30:45Z\n---\nBody"}
        onSourceChange={onSourceChange}
      />,
    );

    await openDetails(user);
    await user.click(screen.getByRole("button", { name: "Open created calendar" }));
    expect(document.querySelector(".task-calendar")).toBeTruthy();

    const julyFifteenth = document.querySelector<HTMLButtonElement>('[data-day="2026-07-15"] button');
    expect(julyFifteenth).toBeTruthy();
    await user.click(julyFifteenth!);
    const time = screen.getByRole("textbox", { name: "Edit created time" });
    expect((time as HTMLInputElement).value).toBe("10:30:45");
    fireEvent.change(time, { target: { value: "12:15:30" } });
    expect(onSourceChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Apply date and time" }));

    expect(getFrontmatterProperty(parseFrontmatter(latestSource(onSourceChange)), "created")?.value).toMatchObject({
      kind: "date",
      dateOnly: false,
      value: "2026-07-15T12:15:30.000Z",
    });
  });

  it("restricts task priority to the predefined values", async () => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(
      <NoteDetailsHarness
        initialSource={"---\ntype: task\ntask-priority: high\n---\nBody"}
        onSourceChange={onSourceChange}
      />,
    );

    await openDetails(user);
    const priority = screen.getByRole("combobox", { name: "Edit task-priority value" });
    expect(priority.getAttribute("readonly")).not.toBeNull();
    priority.focus();
    await user.keyboard("custom");
    expect((priority as HTMLInputElement).value).toBe("high");

    await user.click(priority);
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "high",
      "medium",
      "low",
    ]);
    await user.click(priority);
    await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
    await user.click(priority);
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "high",
      "medium",
      "low",
    ]);
    expect(screen.queryByRole("option", { name: "custom" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "medium" }));

    expect(getFrontmatterProperty(parseFrontmatter(latestSource(onSourceChange)), "task-priority")?.value).toEqual({
      kind: "string",
      value: "medium",
    });
  });

  it("keeps list drafts local until accepted and supports item editing", async () => {
    overrideNoteDetailsApi({
      queryWorkspaceProperty: vi.fn<Window["api"]["queryWorkspaceProperty"]>(async ({ key }) =>
        key === "tags"
          ? [
              {
                file: {
                  id: "/workspace/notes/suggestions.md",
                  path: "/workspace/notes/suggestions.md",
                  relativePath: "notes/suggestions.md",
                  filename: "suggestions",
                  isDirectory: false,
                  mimeType: "text/markdown",
                },
                values: [
                  { type: "string", value: "research" },
                  { type: "string", value: "writing" },
                ],
              },
            ]
          : [],
      ),
    });
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    render(
      <NoteDetailsHarness
        initialSource={'---\ntags: [one]\nauthors: ["Ada Lovelace"]\n---\nBody'}
        onSourceChange={onSourceChange}
      />,
    );

    await openDetails(user);
    const tags = screen.getByRole("combobox", { name: "Add tags item" });
    const authors = screen.getByRole("combobox", { name: "Add authors item" });

    await user.type(tags, "machine learning");
    await user.click(authors);
    expect(onSourceChange).not.toHaveBeenCalled();
    expect((tags as HTMLInputElement).value).toBe("machine learning");

    await user.click(tags);
    await user.keyboard("{Enter}");
    expect(getFrontmatterStringList(parseFrontmatter(latestSource(onSourceChange)), "tags")).toEqual([
      "one",
      "machine learning",
    ]);
    expect(await screen.findByRole("option", { name: "research" })).toBeTruthy();
    expect(document.activeElement).toBe(tags);

    await user.click(screen.getByRole("button", { name: "Edit Ada Lovelace" }));
    const editAuthor = screen.getByRole("combobox", { name: "Edit authors item Ada Lovelace" });
    expect(
      editAuthor.closest(".note-details-token")?.querySelector(".note-details-token-remove-placeholder"),
    ).toBeTruthy();
    await user.clear(editAuthor);
    await user.type(editAuthor, "Grace Hopper{Enter}");

    expect(getFrontmatterStringList(parseFrontmatter(latestSource(onSourceChange)), "authors")).toEqual([
      "Grace Hopper",
    ]);
  });

  it("preserves row keyboard navigation after the field model simplification", async () => {
    const user = userEvent.setup();
    const { container } = render(<NoteDetailsHarness initialSource={"---\nstatus: draft\nauthor: Ada\n---\nBody"} />);

    await openDetails(user);
    await user.keyboard("{ArrowDown}");
    const statusRow = container.querySelector<HTMLElement>("[data-property-key='status']");
    const authorRow = container.querySelector<HTMLElement>("[data-property-key='author']");
    expect(document.activeElement).toBe(statusRow);

    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Edit status value" }));
    await user.keyboard("{Escape}{ArrowDown}");
    expect(document.activeElement).toBe(authorRow);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add field" }));
  });

  it("leaves Note Details when Escape follows a dismissed empty add-field menu", async () => {
    const user = userEvent.setup();
    const onReturnToEditor = vi.fn();
    render(<NoteDetailsHarness initialSource={"---\ntags: [one]\n---\nBody"} onReturnToEditor={onReturnToEditor} />);

    await openDetails(user);
    await user.click(screen.getByRole("button", { name: "Add field" }));
    const input = screen.getByRole("combobox", { name: "New field name" });
    await screen.findByRole("option", { name: "task-project" });

    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(input);
    expect(onReturnToEditor).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onReturnToEditor).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Show note details" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Add note field" })).toBeNull();
  });

  it("collapses cleanly after deleting the final field", async () => {
    const user = userEvent.setup();
    render(<NoteDetailsHarness initialSource={"---\ntags: [one]\n---\nBody"} />);

    await openDetails(user);
    await user.click(screen.getByRole("button", { name: "Open tags field menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete field" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Show note details" })).toBeTruthy());
    expect(screen.getByRole("group", { name: "Note details" }).classList.contains("note-details-expanded")).toBe(false);
  });

  it("keeps an empty add row ephemeral when focus leaves the workflow", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <NoteDetailsHarness initialSource="# Note" />
      </>,
    );

    await openDetails(user);
    expect(screen.getByRole("combobox", { name: "New field name" })).toBeTruthy();
    fireEvent.blur(screen.getByRole("combobox", { name: "New field name" }), {
      relatedTarget: screen.getByRole("button", { name: "Outside" }),
    });

    await waitFor(() => expect(screen.queryByRole("combobox", { name: "New field name" })).toBeNull());
    expect(screen.getByRole("button", { name: "Show note details" })).toBeTruthy();
  });
});
