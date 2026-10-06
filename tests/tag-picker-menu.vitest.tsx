import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TaskTagSelector } from "../src/renderer/src/features/task-board/TaskBoardTaskEditor";

const options = ["Research", "Personal", "Reading"];

const PickerHarness = ({
  initialSelected = [],
  onOpenChange,
  pickerOptions = options,
}: {
  initialSelected?: readonly string[];
  onOpenChange?: (open: boolean) => void;
  pickerOptions?: readonly string[];
}) => {
  const [selected, setSelected] = useState([...initialSelected]);

  return (
    <>
      <TaskTagSelector onChange={setSelected} onOpenChange={onOpenChange} options={pickerOptions} selected={selected} />
      <output data-testid="selected">{selected.join("|")}</output>
    </>
  );
};

const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen.getByRole("button", { name: "Choose tags" });
  trigger.focus();
  await user.keyboard("{Enter}");
  const search = await screen.findByRole("textbox", { name: "Search tags" });
  await waitFor(() => expect(document.activeElement).toBe(search));
  return { search, trigger };
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

describe("TaskTagSelector", () => {
  afterEach(cleanup);

  it("searches and toggles tags from the keyboard without closing", async () => {
    const user = userEvent.setup();
    render(<PickerHarness initialSelected={["Research"]} />);

    const { search } = await openPicker(user);
    await user.type(search, "pers");

    expect(screen.queryByRole("option", { name: "Research" })).toBeNull();
    const personal = screen.getByRole("option", { name: "Personal" });
    expect(personal.getAttribute("aria-selected")).toBe("false");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(personal.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("selected").textContent).toBe("Research|Personal");
    expect(screen.getByRole("listbox", { name: "Tags" })).toBeTruthy();

    await user.click(screen.getByRole("option", { name: "Personal" }));
    expect(screen.getByRole("option", { name: "Personal" })).toBeTruthy();
    expect(screen.getByTestId("selected").textContent).toBe("Research");
  });

  it("normalizes and deduplicates options and selected tags case-insensitively", async () => {
    const user = userEvent.setup();
    render(
      <PickerHarness
        initialSelected={[" research ", "RESEARCH"]}
        pickerOptions={["Research", " research ", "RESEARCH", "Personal"]}
      />,
    );

    await openPicker(user);
    expect(screen.getAllByRole("option", { name: "Research" })).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Research" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("option", { name: "Research" }));
    expect(screen.getByTestId("selected").textContent).toBe("");
  });

  it("creates a normalized tag and suppresses creation for an existing tag", async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);

    let { search } = await openPicker(user);
    await user.type(search, "rEsEaRcH");
    expect(screen.getByRole("option", { name: "Research" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Create / })).toBeNull();

    await user.keyboard("{Escape}");
    ({ search } = await openPicker(user));
    await user.type(search, "  Deep   Work  ");
    await user.click(screen.getByRole("option", { name: "Create Deep Work" }));

    expect(screen.getByTestId("selected").textContent).toBe("Deep Work");
    expect(screen.getByRole("listbox", { name: "Tags" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Search tags" }) as HTMLInputElement).value).toBe("");
  });

  it("reports open state, restores trigger focus, and clears search on Escape", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<PickerHarness onOpenChange={onOpenChange} />);

    let { search, trigger } = await openPicker(user);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    await user.type(search, "pers");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Tags" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    ({ search, trigger } = await openPicker(user));
    expect(search.getAttribute("value")).toBe("");
    expect(screen.getByRole("option", { name: "Research" })).toBeTruthy();
    expect(trigger).toBeTruthy();
  });
});
