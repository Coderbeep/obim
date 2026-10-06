import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileBufferBoundary } from "../src/renderer/src/features/files/FileBufferBoundary";
import { fileLoadStatesByPathAtom } from "../src/renderer/src/store/fileLoadStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { createEditorTab, workspaceTabsByIdAtom } from "../src/renderer/src/store/editorTabStore";
import { createFileWorkspaceItemKey } from "../src/shared/workspace";
const service = vi.hoisted(() => ({ readTextFile: vi.fn() }));
vi.mock("@renderer/features/files/workspaceFileService", () => service);
const path = "/notes/failed.md";
const Editor = () => (
  <textarea aria-label="Note editor" defaultValue={useAtomValue(fileBuffersByPathAtom)[path].editorText} />
);
const setup = (empty = false) => {
  const store = createStore();
  store.set(workspaceTabsByIdAtom, { original: createEditorTab("original", createFileWorkspaceItemKey(path)) });
  if (empty) store.set(fileBuffersByPathAtom, { [path]: { savedText: "", editorText: "" } });
  else store.set(fileLoadStatesByPathAtom, { [path]: { phase: "error", message: "ENOENT: missing file" } });
  const mounted = render(
    <Provider store={store}>
      <FileBufferBoundary filePath={path}>
        <Editor />
      </FileBufferBoundary>
    </Provider>,
  );
  return { store, ...mounted };
};
beforeEach(() => {
  service.readTextFile.mockReset();
  window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
});
afterEach(cleanup);

describe("restored note load boundary", () => {
  it("shows an actionable failure, retries without a blank editor, then opens the same tab", async () => {
    const { store } = setup();
    const tabs = store.get(workspaceTabsByIdAtom);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("missing file");
    service.readTextFile
      .mockResolvedValueOnce({ success: false, error: "permission denied" })
      .mockResolvedValueOnce({
        success: true,
        content: "Recovered text",
        version: { id: "new", mtimeMs: 1, sizeBytes: 14 },
      });
    fireEvent.click(screen.getByRole("button", { name: "Retry opening note" }));
    await screen.findByText("permission denied");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry opening note" }));
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Recovered text"));
    expect(store.get(workspaceTabsByIdAtom)).toBe(tabs);
    expect(store.get(fileLoadStatesByPathAtom)[path]).toBeUndefined();
  });

  it("renders a genuinely empty successfully loaded file as an editor", () => {
    setup(true);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not hydrate a file after its retry view has been dismissed", async () => {
    const { store, unmount } = setup();
    let finish!: (value: { success: true; content: string }) => void;
    service.readTextFile.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry opening note" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    unmount();
    await act(async () => finish({ success: true, content: "Too late" }));
    expect(store.get(fileBuffersByPathAtom)[path]).toBeUndefined();
    expect(store.get(fileLoadStatesByPathAtom)[path]?.phase).toBe("error");
  });
});
