import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InitializationCard } from "../src/renderer/src/app/InitializationCard";
import { isAppInitializedAtom } from "../src/renderer/src/store/appSessionStore";

beforeEach(() => {
  window.api = { cancelGitSync: vi.fn(async () => false) } as unknown as Window["api"];
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "api");
});

describe("workspace initialization", () => {
  it("explains an unavailable previous workspace and treats picker cancellation as harmless", async () => {
    const initializeConfig = vi.fn(async () => ({ status: "cancelled" as const }));
    window.config = {
      getWorkspaceStatusSync: () => ({
        status: "unavailable",
        path: "/Volumes/Notes",
        error: "ENOENT",
      }),
      initializeConfig,
    } as unknown as Window["config"];
    const store = createStore();

    render(
      <Provider store={store}>
        <InitializationCard />
      </Provider>,
    );
    expect(screen.getByRole("heading", { name: "Reconnect your workspace" })).toBeTruthy();
    expect(screen.getByText("/Volumes/Notes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(await screen.findByText(/No folder was selected/)).toBeTruthy();
    expect(store.get(isAppInitializedAtom)).toBe(false);
  });

  it("enters the application after a valid folder is selected", async () => {
    window.config = {
      getWorkspaceStatusSync: () => ({ status: "unconfigured" }),
      initializeConfig: vi.fn(async () => ({ status: "selected" as const, path: "/notes" })),
    } as unknown as Window["config"];
    const store = createStore();

    render(
      <Provider store={store}>
        <InitializationCard />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));

    await waitFor(() => expect(store.get(isAppInitializedAtom)).toBe(true));
  });
});
