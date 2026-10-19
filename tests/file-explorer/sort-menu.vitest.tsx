import { Provider, createStore } from "jotai";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ExplorerSortMenu } from "../../src/renderer/src/features/files/explorer/ExplorerSortMenu";
import { EXPLORER_SORT_STORAGE_KEY, explorerSortAtom } from "../../src/renderer/src/store/explorerSortStore";

afterEach(() => {
  cleanup();
  localStorage.removeItem(EXPLORER_SORT_STORAGE_KEY);
});

describe("explorer sort toolbar menu", () => {
  it("shows and changes sort mode and direction without a folder-order option", async () => {
    const user = userEvent.setup();
    const store = createStore();
    render(
      <Provider store={store}>
        <ExplorerSortMenu />
      </Provider>,
    );
    const trigger = screen.getByRole("button", { name: "Sort files" });
    await user.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: "Name" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "A to Z" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("menuitemcheckbox", { name: "Folders first" })).toBeNull();
    await user.click(screen.getByRole("menuitemradio", { name: "Type, then name" }));
    expect(store.get(explorerSortAtom).by).toBe("type");
    await user.click(trigger);
    await user.click(screen.getByRole("menuitemradio", { name: "Z to A" }));
    expect(store.get(explorerSortAtom)).toEqual({ by: "type", direction: "descending" });
    expect(trigger.title).toBe("Sort files: Type, then name, Z to A");
    await user.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: "Type, then name" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Z to A" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("menuitemcheckbox", { name: "Folders first" })).toBeNull();
  });

  it("supports keyboard selection and returns focus to its toolbar button", async () => {
    const user = userEvent.setup();
    const store = createStore();
    render(
      <Provider store={store}>
        <ExplorerSortMenu />
      </Provider>,
    );
    const trigger = screen.getByRole("button", { name: "Sort files" });
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{Enter}");
    const name = await screen.findByRole("menuitemradio", { name: "Name" });
    await waitFor(() => expect(document.activeElement).toBe(name));
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(store.get(explorerSortAtom).by).toBe("type");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
