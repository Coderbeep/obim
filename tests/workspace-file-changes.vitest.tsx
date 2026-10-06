import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readTextFile: vi.fn() }));

vi.mock("@renderer/features/files/workspaceFileService", () => ({
  readTextFile: mocks.readTextFile,
}));

import { useWorkspaceFileChanges } from "../src/renderer/src/app/useWorkspaceFileChanges";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { fileSaveStatesByPathAtom } from "../src/renderer/src/store/fileSaveStore";
import { reloadRevisionAtom } from "../src/renderer/src/store/fileExplorerStore";
import { notificationsAtom } from "../src/renderer/src/store/NotificationsStore";
import type { WorkspaceFileChange } from "../src/shared/workspace-change";

const path = "/notes/Note.md";
const openedVersion = { id: "note", mtimeMs: 1, sizeBytes: 3 };
const changedVersion = { id: "note", mtimeMs: 2, sizeBytes: 7 };

describe("external workspace changes", () => {
  let listener: ((changes: WorkspaceFileChange[]) => void) | undefined;

  beforeEach(() => {
    listener = undefined;
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        onWorkspaceFilesChanged: vi.fn((callback: (changes: WorkspaceFileChange[]) => void) => {
          listener = callback;
          return () => {
            listener = undefined;
          };
        }),
      },
    });
  });

  afterEach(() => {
    cleanup();
    mocks.readTextFile.mockReset();
  });

  const setup = () => {
    const store = createStore();
    store.set(fileBuffersByPathAtom, {
      [path]: { editorText: "Old", savedText: "Old", version: openedVersion },
    });
    const wrapper = ({ children }: PropsWithChildren) => <Provider store={store}>{children}</Provider>;
    renderHook(() => useWorkspaceFileChanges(true), { wrapper });
    return store;
  };

  it("refreshes the tree and warns before an open note is edited", async () => {
    mocks.readTextFile.mockResolvedValue({ success: true, content: "Changed", version: changedVersion });
    const store = setup();

    act(() => listener?.([{ kind: "change", path }]));

    await waitFor(() => expect(store.get(fileSaveStatesByPathAtom)[path]?.phase).toBe("conflict"));
    expect(store.get(reloadRevisionAtom)).toBe(1);
    expect(store.get(notificationsAtom).at(-1)?.title).toBe("Note changed on disk");
    expect(store.get(fileBuffersByPathAtom)[path].editorText).toBe("Old");
  });

  it("silently accepts a metadata-only version change", async () => {
    mocks.readTextFile.mockResolvedValue({ success: true, content: "Old", version: changedVersion });
    const store = setup();

    act(() => listener?.([{ kind: "change", path }]));

    await waitFor(() => expect(store.get(fileBuffersByPathAtom)[path].version).toEqual(changedVersion));
    expect(store.get(fileSaveStatesByPathAtom)[path]).toBeUndefined();
    expect(store.get(notificationsAtom)).toHaveLength(0);
  });
});
