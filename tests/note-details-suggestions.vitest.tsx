import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SuggestionList, useSuggestions } from "../src/renderer/src/features/editor/note-details/Suggestions";
import { Popover, PopoverAnchor } from "../src/renderer/src/shared/ui/popover";

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
};

const deferred = <Value,>(): Deferred<Value> => {
  let resolve!: (value: Value) => void;
  return {
    promise: new Promise((nextResolve) => {
      resolve = nextResolve;
    }),
    resolve,
  };
};

const defaultOptions = ["Alpha", "Beta", "Gamma"];

const SuggestionHarness = ({
  initialQuery = "",
  loadOptions = async () => defaultOptions,
}: {
  initialQuery?: string;
  loadOptions?: () => Promise<readonly string[]>;
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState("");
  const suggestions = useSuggestions({
    query,
    loadOptions: async () => (await loadOptions()).map((value) => ({ id: value, label: value, value })),
    onSelect: (option) => {
      setQuery(option.label);
      setResult(`selected:${option.value}`);
    },
    onCommitQuery: (value) => setResult(`committed:${value}`),
  });

  return (
    <>
      <Popover open={suggestions.expanded} onOpenChange={suggestions.onOpenChange}>
        <PopoverAnchor asChild>
          <input
            {...suggestions.inputProps}
            aria-label="Suggestion input"
            value={query}
            onFocus={suggestions.openSuggestions}
            onClick={suggestions.openSuggestions}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setQuery(value);
              suggestions.refreshSuggestions(value);
            }}
            onKeyDown={suggestions.onInputKeyDown}
          />
        </PopoverAnchor>
        <SuggestionList {...suggestions.listProps} />
      </Popover>
      <output aria-label="Result">{result}</output>
    </>
  );
};

afterEach(cleanup);

describe("Suggestions", () => {
  it("keeps input focus while navigating and choosing with the keyboard", async () => {
    const user = userEvent.setup();
    render(<SuggestionHarness />);
    const input = screen.getByRole("combobox", { name: "Suggestion input" });

    await user.click(input);
    const alpha = await screen.findByRole("option", { name: "Alpha" });
    const listbox = screen.getByRole("listbox");
    expect(listbox.classList.contains("w-max")).toBe(true);
    expect(listbox.classList.contains("max-w-[min(20rem,calc(100vw-1rem))]")).toBe(true);
    expect(listbox.classList.contains("max-h-[min(15rem,var(--radix-popover-content-available-height))]")).toBe(true);
    expect(listbox.classList.contains("overflow-y-auto")).toBe(true);
    expect(listbox.classList.contains("p-1")).toBe(true);
    expect(alpha.classList.contains("w-full")).toBe(true);
    await user.keyboard("{ArrowDown}");

    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Beta" }).id);

    await user.keyboard("{Enter}");
    expect(screen.getByRole("status", { name: "Result" }).textContent).toBe("selected:Beta");
    expect(document.activeElement).toBe(input);
  });

  it("keeps all matches while scrolling after eight visible rows", async () => {
    const user = userEvent.setup();
    const options = Array.from({ length: 10 }, (_, index) => `Option ${index + 1}`);
    render(<SuggestionHarness loadOptions={async () => options} />);
    const input = screen.getByRole("combobox", { name: "Suggestion input" });

    await user.click(input);
    expect(await screen.findAllByRole("option")).toHaveLength(10);
    await user.keyboard("{End}");
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Option 10" }).id);
  });

  it("shows loading and only displays matching suggestions", async () => {
    const user = userEvent.setup();
    const request = deferred<readonly string[]>();
    const loadOptions = vi.fn(() => request.promise);
    render(<SuggestionHarness loadOptions={loadOptions} />);
    const input = screen.getByRole("combobox", { name: "Suggestion input" });

    await user.click(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Loading suggestions…" })).toBeTruthy();

    request.resolve(defaultOptions);
    await screen.findByRole("option", { name: "Alpha" });
    await user.clear(input);
    await user.type(input, "Alpha");
    expect(await screen.findByRole("option", { name: "Alpha" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Create/ })).toBeNull();

    await user.clear(input);
    await user.type(input, "Delta");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    const loadsAfterNoMatch = loadOptions.mock.calls.length;
    await user.keyboard("x");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(loadOptions).toHaveBeenCalledTimes(loadsAfterNoMatch);
  });

  it("keeps suggestions dismissed while typing and commits the literal value", async () => {
    const user = userEvent.setup();
    render(<SuggestionHarness initialQuery="Al" />);
    const input = screen.getByRole("combobox", { name: "Suggestion input" });

    await user.click(input);
    await screen.findByRole("option", { name: "Alpha" });
    await user.keyboard("{Escape}ph");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("status", { name: "Result" }).textContent).toBe("committed:Alph");
  });

  it("closes a quiet empty or failed request without rendering an empty listbox", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SuggestionHarness loadOptions={async () => []} />);
    const input = screen.getByRole("combobox", { name: "Suggestion input" });

    await user.click(input);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    rerender(
      <SuggestionHarness
        loadOptions={async () => {
          throw new Error("offline");
        }}
      />,
    );
    await user.click(input);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("clears accepted options while a reopened refresh fails", async () => {
    const user = userEvent.setup();
    const loadOptions = vi
      .fn<() => Promise<readonly string[]>>()
      .mockResolvedValueOnce(["Alpha"])
      .mockRejectedValueOnce(new Error("offline"));
    render(<SuggestionHarness loadOptions={loadOptions} />);
    const input = screen.getByRole("combobox", { name: "Suggestion input" });

    await user.click(input);
    await screen.findByRole("option", { name: "Alpha" });
    await user.keyboard("{Escape}");
    await user.click(input);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("keeps the draft unchanged when Escape is pressed repeatedly", async () => {
    const user = userEvent.setup();
    render(<SuggestionHarness initialQuery="Al" />);
    const input = screen.getByRole("combobox", { name: "Suggestion input" });

    await user.click(input);
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveProperty("value", "Al");

    await user.keyboard("{Escape}");
    expect(input).toHaveProperty("value", "Al");
  });

  it("does not select or commit on IME-composing Enter", async () => {
    const user = userEvent.setup();
    render(<SuggestionHarness />);
    const input = screen.getByRole("combobox", { name: "Suggestion input" });

    await user.click(input);
    await screen.findByRole("option", { name: "Alpha" });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(screen.getByRole("status", { name: "Result" }).textContent).toBe("");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("ignores Enter while suggestions are loading", async () => {
    const request = deferred<readonly string[]>();
    render(<SuggestionHarness initialQuery="Typed value" loadOptions={() => request.promise} />);
    const input = screen.getByRole("combobox", { name: "Suggestion input" });

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("status", { name: "Result" }).textContent).toBe("");

    request.resolve([]);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(screen.getByRole("status", { name: "Result" }).textContent).toBe("");
  });

  it("supports Home, End, Up, Down, mouse choice, and active-descendant semantics", async () => {
    const user = userEvent.setup();
    render(<SuggestionHarness />);
    const input = screen.getByRole("combobox", { name: "Suggestion input" });

    await user.click(input);
    const alpha = await screen.findByRole("option", { name: "Alpha" });
    const beta = screen.getByRole("option", { name: "Beta" });
    const gamma = screen.getByRole("option", { name: "Gamma" });
    expect(input.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(alpha.id);

    await user.keyboard("{End}");
    expect(input.getAttribute("aria-activedescendant")).toBe(gamma.id);
    await user.keyboard("{Home}");
    expect(input.getAttribute("aria-activedescendant")).toBe(alpha.id);
    await user.keyboard("{ArrowUp}");
    expect(input.getAttribute("aria-activedescendant")).toBe(gamma.id);
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(alpha.id);

    await user.hover(beta);
    expect(input.getAttribute("aria-activedescendant")).toBe(beta.id);
    await user.click(beta);
    expect(screen.getByRole("status", { name: "Result" }).textContent).toBe("selected:Beta");
    expect(document.activeElement).toBe(input);
  });
});
