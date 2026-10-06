import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import { useSearchTaskStatuses } from "../src/renderer/src/features/search/useSearchTaskStatuses";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { createBufferedWorkspaceIndexFile } from "../src/shared/workspace-index";
afterEach(cleanup);
it("reads paginated metadata and lets unsaved notes override saved completion", async () => {
  const path = "/notes/Task.md";
  const file = createBufferedWorkspaceIndexFile(path, "/notes");
  window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
  const query = vi.fn(async ({ key }: { key: string }) => [
    { file, values: [{ type: "string", value: key === "type" ? "task" : "done" }] },
  ]);
  window.api = { queryWorkspaceProperty: query } as unknown as Window["api"];
  const store = createStore();
  const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
  const { result } = renderHook(() => useSearchTaskStatuses(true), { wrapper });
  await waitFor(() => expect(result.current.statuses.get(path)).toBe("done"));
  act(() =>
    store.set(fileBuffersByPathAtom, {
      [path]: { editorText: "---\ntype: task\ntask-status: open\n---\n", savedText: "" },
    }),
  );
  expect(result.current.statuses.get(path)).toBe("open");
  act(() => store.set(fileBuffersByPathAtom, { [path]: { editorText: "An ordinary note", savedText: "" } }));
  expect(result.current.statuses.has(path)).toBe(false);
  expect(query).toHaveBeenCalledTimes(2);
});
