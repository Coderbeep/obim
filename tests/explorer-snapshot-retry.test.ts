import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ readTree: vi.fn() }));
vi.mock("../src/main/workspace-files", async (original) => ({
  ...(await original<typeof import("../src/main/workspace-files")>()),
  getWorkspaceFileTree: state.readTree,
}));
import { getExplorerSnapshot } from "../src/main/explorer-pdf-notes";
afterEach(() => state.readTree.mockReset());

it("retries a disappearing entry without returning an incomplete snapshot", async () => {
  state.readTree
    .mockRejectedValueOnce(Object.assign(new Error("disappeared"), { code: "ENOENT" }))
    .mockResolvedValueOnce([]);
  expect(await getExplorerSnapshot("/workspace")).toMatchObject({ items: [], pdfNotesGroups: [] });
  expect(state.readTree).toHaveBeenCalledTimes(2);
});
it("bounds unstable-tree retries and propagates permission failures immediately", async () => {
  state.readTree.mockRejectedValue(Object.assign(new Error("unstable"), { code: "ENOTDIR" }));
  await expect(getExplorerSnapshot("/workspace")).rejects.toThrow("unstable");
  expect(state.readTree).toHaveBeenCalledTimes(3);
  state.readTree.mockReset().mockRejectedValue(Object.assign(new Error("unreadable"), { code: "EACCES" }));
  await expect(getExplorerSnapshot("/workspace")).rejects.toThrow("unreadable");
  expect(state.readTree).toHaveBeenCalledTimes(1);
});
