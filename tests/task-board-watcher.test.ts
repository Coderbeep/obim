import { watch } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { WorkspaceIndexWatcher } from "../src/main/workspace-index-watcher";

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
