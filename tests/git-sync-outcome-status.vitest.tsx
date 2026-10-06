import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { GitSyncOutcome } from "../src/shared/git";
import { GitSyncOutcomeStatus } from "../src/renderer/src/features/git/GitSyncOutcomeStatus";
vi.mock("../src/renderer/src/features/files/workspaceMutationApi", () => ({
  workspaceMutationApi: { runGitAutoSync: vi.fn() },
}));
afterEach(cleanup);
it("shows a failed upload for a clean workspace and fetches the active workspace after notifications", async () => {
  let current: GitSyncOutcome | null = {
    workspacePath: "/A",
    phase: "failed",
    source: "scheduled",
    startedAt: 1,
    finishedAt: 2,
    localRevision: "b".repeat(40),
    localCommitCreated: true,
    uncommittedChanges: false,
    failureCount: 1,
    error: "Authentication failed",
  };
  let notify: (() => void) | undefined;
  window.api = {
    getGitSyncOutcome: vi.fn(async () => current),
    onGitSyncOutcomeChanged: vi.fn((callback) => {
      notify = callback;
      return vi.fn();
    }),
    onGitFileStatusChanged: vi.fn(() => vi.fn()),
  } as unknown as Window["api"];
  render(<GitSyncOutcomeStatus />);
  expect(await screen.findByText("This workspace did not finish syncing.")).toBeTruthy();
  expect(screen.getByText("A local version was created before the failure.")).toBeTruthy();
  expect(screen.getByText("Local versions still need a confirmed upload.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry sync" })).toBeTruthy();
  current = null;
  await act(async () => {
    notify?.();
  });
  expect(screen.queryByText("Authentication failed")).toBeNull();
});

it("requests cancellation directly and keeps cancellation errors visible", async () => {
  window.api = {
    getGitSyncOutcome: vi.fn(async () => ({ workspacePath: "/A", phase: "running" })),
    onGitSyncOutcomeChanged: vi.fn(() => vi.fn()),
    onGitFileStatusChanged: vi.fn(() => vi.fn()),
    cancelGitSync: vi.fn(async () => {
      throw new Error("IPC unavailable");
    }),
  } as unknown as Window["api"];
  render(<GitSyncOutcomeStatus />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel sync" }));
  expect(await screen.findByText("Synchronization could not be cancelled. Try again.")).toBeTruthy();
  expect(window.api.cancelGitSync).toHaveBeenCalledTimes(1);
});
