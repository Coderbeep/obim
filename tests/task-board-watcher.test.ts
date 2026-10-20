import { watch } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { classifyWorkspaceIndexWatchEvent, WorkspaceIndexWatcher } from "../src/main/workspace-index-watcher";

vi.mock("node:fs", () => ({ watch: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

test("broadcasts external board configuration changes without indexing hidden metadata", async () => {
  vi.useFakeTimers();
  const nativeWatcher = { on: vi.fn(), close: vi.fn() };
  vi.mocked(watch).mockReturnValue(nativeWatcher as unknown as ReturnType<typeof watch>);
  const refresh = vi.fn(async () => {});
  const reconcile = vi.fn(async () => {});
  const changed = vi.fn();
  const watcher = new WorkspaceIndexWatcher("/notes", refresh, reconcile, changed);
  const onChange = (vi.mocked(watch).mock.calls[0] as unknown[])[2] as unknown as (
    event: string,
    filename: string,
  ) => void;
  onChange("change", ".todo/taskboard.json");
  onChange("rename", ".todo");
  onChange("change", ".git/config");
  onChange("change", ".todo/unrelated.json");
  await vi.advanceTimersByTimeAsync(150);
  expect(changed).toHaveBeenCalledWith([
    { kind: "change", path: "/notes/.todo/taskboard.json" },
    { kind: "rename", path: "/notes/.todo" },
  ]);
  expect(refresh).not.toHaveBeenCalled();
  expect(reconcile).not.toHaveBeenCalled();
  watcher.close();
});

test("reconciles companion directory-only renames and removals while broadcasting actual changed paths", async () => {
  vi.useFakeTimers();
  vi.mocked(watch).mockReturnValue({ on: vi.fn(), close: vi.fn() } as unknown as ReturnType<typeof watch>);
  const refresh = vi.fn(async () => {});
  const reconcile = vi.fn(async () => {});
  const changed = vi.fn();
  const watcher = new WorkspaceIndexWatcher("/notes", refresh, reconcile, changed);
  const callback = (vi.mocked(watch).mock.calls[0] as unknown[])[2] as (event: string, name: string) => void;
  callback("rename", "Paper.PDF.notes");
  callback("rename", "Archive/Paper.PDF.notes");
  await vi.advanceTimersByTimeAsync(150);
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledWith([
    { kind: "rename", path: "/notes/Paper.PDF.notes" },
    { kind: "rename", path: "/notes/Archive/Paper.PDF.notes" },
  ]);
  expect(classifyWorkspaceIndexWatchEvent("/notes", "change", "Paper.pdf")).toBeNull();
  expect(classifyWorkspaceIndexWatchEvent("/notes", "rename", "ordinary.txt")).toBeNull();
  expect(classifyWorkspaceIndexWatchEvent("/notes", "rename", ".hidden/Paper.pdf.notes")).toBeNull();
  expect(classifyWorkspaceIndexWatchEvent("/notes", "change", "Paper.pdf.notes/Summary.md")).toEqual({
    kind: "refresh",
    path: "/notes/Paper.pdf.notes/Summary.md",
  });
  watcher.close();
});
