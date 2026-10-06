import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "@renderer/shared/ui/segmented-control";

afterEach(cleanup);

describe("segmented selector keyboard navigation", () => {
  it("uses one tab stop, skips disabled items, wraps, and supports Home and End", async () => {
    const change = vi.fn();
    const unavailable = vi.fn();
    function Example() {
      const [value, setValue] = useState("board");
      return (
        <>
          <SegmentedControl
            value={value}
            aria-label="Layout"
            items={[
              { value: "board", label: "Board" },
              { value: "calendar", label: "Calendar", disabled: true, onClick: unavailable },
              { value: "list", label: "List" },
            ]}
            onValueChange={(next) => {
              change(next);
              setValue(next);
            }}
          />
          <button>Next control</button>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Example />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Board" }));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "List" }));
    expect(screen.getByRole("tab", { name: "List" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowRight}{ArrowLeft}{Home}{End}");
    expect(change.mock.calls.map(([value]) => value)).toEqual(["list", "board", "list", "board", "list"]);
    expect(unavailable).not.toHaveBeenCalled();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next control" }));
  });

  it("keeps an enabled tab reachable when the selected option becomes unavailable", async () => {
    const user = userEvent.setup();
    render(
      <SegmentedControl
        value="board"
        items={[
          { value: "board", label: "Board", disabled: true },
          { value: "list", label: "List" },
        ]}
        onValueChange={vi.fn()}
      />,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "List" }));
  });
});
