import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationHost } from "../src/renderer/src/features/notifications/NotificationHost";
import { NotificationLevel, notificationsAtom } from "../src/renderer/src/store/NotificationsStore";

const notification = (id: string, level: NotificationLevel) => ({
  id,
  level,
  title: `${level} notice`,
  message: "Details",
  timestamp: Date.now(),
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("notification lifetime", () => {
  it("keeps error details visible until the user dismisses them", async () => {
    const store = createStore();
    store.set(notificationsAtom, [
      notification("info", NotificationLevel.INFO),
      notification("error", NotificationLevel.ERROR),
    ]);
    render(
      <Provider store={store}>
        <NotificationHost />
      </Provider>,
    );

    await act(async () => vi.advanceTimersByTimeAsync(3_201));

    expect(screen.queryByText("info notice")).toBeNull();
    expect(screen.getByText("error notice")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error notice" }));
    expect(screen.queryByText("error notice")).toBeNull();
  });

  it("pauses a temporary notice while the user is interacting with it", async () => {
    const store = createStore();
    store.set(notificationsAtom, [notification("warning", NotificationLevel.WARNING)]);
    render(
      <Provider store={store}>
        <NotificationHost />
      </Provider>,
    );
    const card = screen.getByText("warning notice").closest(".notification")!;

    fireEvent.mouseEnter(card);
    await act(async () => vi.advanceTimersByTimeAsync(7_000));
    expect(screen.getByText("warning notice")).toBeTruthy();

    fireEvent.mouseLeave(card);
    await act(async () => vi.advanceTimersByTimeAsync(6_201));
    expect(screen.queryByText("warning notice")).toBeNull();
  });
});
