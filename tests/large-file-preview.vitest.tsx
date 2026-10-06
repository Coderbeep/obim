import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  openInDefaultApp: vi.fn(),
  readLargeTextPreview: vi.fn(),
  revealInSystemFileManager: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock("../src/renderer/src/features/files/workspaceFileService", () => commandMocks);

import { createWorkspaceItemViews } from "../src/renderer/src/app/workspaceItemViews";
import { LargeFilePreview } from "../src/renderer/src/features/editor/LargeFilePreview";
import { createFileWorkspaceItem } from "../src/shared/workspace";
import { MAX_FULL_TEXT_EDITOR_BYTES } from "../src/shared/large-files";
import type { FileItem } from "../src/shared/file-item";

const file = (path = "/notes/large.md"): Extract<FileItem, { isDirectory: false }> => ({
  id: path,
  filename: path.split("/").at(-1) ?? path,
  relativePath: path.replace("/notes/", ""),
  path,
  sizeBytes: MAX_FULL_TEXT_EDITOR_BYTES + 1,
  isDirectory: false,
  mimeType: "text/markdown",
});

const unsupportedFile = (path = "/notes/archive.bin"): Extract<FileItem, { isDirectory: false }> => ({
  ...file(path),
  sizeBytes: 128,
  mimeType: "application/octet-stream",
});

const preview = {
  content: "# Beginning",
  previewBytes: 2 * 1024 * 1024,
  sizeBytes: 12 * 1024 * 1024,
  truncated: true,
};

beforeEach(() => {
  commandMocks.openInDefaultApp.mockResolvedValue(true);
  commandMocks.readLargeTextPreview.mockResolvedValue({ success: true, preview });
  commandMocks.revealInSystemFileManager.mockResolvedValue(true);
  commandMocks.saveFile.mockResolvedValue({ success: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LargeFilePreview", () => {
  it("shows loading before rendering a bounded, unwrapped, read-only preview", async () => {
    let finish!: (result: { success: true; preview: typeof preview }) => void;
    commandMocks.readLargeTextPreview.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<LargeFilePreview file={file()} />);

    expect(screen.getByRole("status").textContent).toContain("Loading preview");
    await act(() => finish({ success: true, preview }));

    const textarea = await screen.findByRole("textbox", { name: "Read-only preview of large.md" });
    expect(textarea).toHaveProperty("readOnly", true);
    expect(textarea.getAttribute("wrap")).toBe("off");
    expect((textarea as HTMLTextAreaElement).value).toBe("# Beginning");
    expect(screen.getByText(/2 MiB of 12 MiB/).textContent).toContain("Content is truncated and read-only");
  });

  it("opens the file externally and reveals it in the file manager", async () => {
    render(<LargeFilePreview file={file()} />);
    await screen.findByRole("textbox");

    fireEvent.click(screen.getByRole("button", { name: "Open in default app" }));
    fireEvent.click(screen.getByRole("button", { name: "Show in file manager" }));

    expect(commandMocks.openInDefaultApp).toHaveBeenCalledWith("/notes/large.md");
    expect(commandMocks.revealInSystemFileManager).toHaveBeenCalledWith("/notes/large.md");
  });

  it("shows an error, opens externally, and retries", async () => {
    commandMocks.readLargeTextPreview
      .mockResolvedValueOnce({ success: false, error: "Permission denied" })
      .mockResolvedValueOnce({ success: true, preview });
    render(<LargeFilePreview file={file()} />);

    expect(await screen.findByText("Permission denied")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open in default app" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(commandMocks.openInDefaultApp).toHaveBeenCalledWith("/notes/large.md");
    expect(((await screen.findByRole("textbox")) as HTMLTextAreaElement).value).toBe("# Beginning");
    expect(commandMocks.readLargeTextPreview).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale response after the file changes", async () => {
    let finishFirst!: (result: { success: true; preview: typeof preview }) => void;
    commandMocks.readLargeTextPreview
      .mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce({
        success: true,
        preview: { ...preview, content: "second file" },
      });
    const { rerender } = render(<LargeFilePreview file={file("/notes/first.md")} />);

    rerender(<LargeFilePreview file={file("/notes/second.md")} />);
    expect(((await screen.findByRole("textbox")) as HTMLTextAreaElement).value).toBe("second file");
    await act(() => finishFirst({ success: true, preview: { ...preview, content: "stale first file" } }));

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("second file");
  });

  it("routes oversized text outside editor save handling", () => {
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });
    const item = createFileWorkspaceItem(file());

    expect(views.file.isEditorContent?.(item)).toBe(false);
    expect("saveBeforeClose" in views.file).toBe(false);
    expect(commandMocks.saveFile).not.toHaveBeenCalled();
  });

  it("reveals an unsupported file in the native file manager", () => {
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    render(views.file.render(createFileWorkspaceItem(unsupportedFile()), "pane-1"));
    const revealButton = screen.getByRole("button", { name: "Show in file manager" });
    fireEvent.click(revealButton);

    expect(commandMocks.revealInSystemFileManager).toHaveBeenCalledWith("/notes/archive.bin");
  });
});
