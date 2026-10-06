import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { jump, openFile } = vi.hoisted(() => ({ jump: vi.fn(), openFile: vi.fn() }));
vi.mock("../src/renderer/src/features/editor/inspector/DocumentOutline", () => ({ focusActiveEditorLine: jump }));
vi.mock("../src/renderer/src/features/files/fileActions", () => ({
  useFileOpen: () => ({ openLinkedFile: openFile }),
}));
import { NoteLinks } from "../src/renderer/src/features/editor/inspector/NoteLinks";
const originalApi = window.api;
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.api = originalApi;
});
const links = [
  { kind: "external" as const, text: "Example", destination: "https://example.com/page?private=token", line: 8 },
];
it("makes no preview request on mount, note rerender, or document jump", async () => {
  const getWebsitePreview = vi.fn().mockResolvedValue(null);
  window.api = { ...originalApi, getWebsitePreview };
  const { rerender, container } = render(<NoteLinks sourcePath="/notes/a.md" links={links} />);
  rerender(<NoteLinks sourcePath="/notes/a.md" links={[...links]} />);
  fireEvent.click(screen.getByText("Example"));
  await Promise.resolve();
  expect(getWebsitePreview).not.toHaveBeenCalled();
  expect(container.querySelector("img")).toBeNull();
  expect(jump).toHaveBeenCalledWith(8);
});
it("loads a preview only on its own button and never puts remote image URLs in the renderer", async () => {
  const openExternalLink = vi.fn().mockResolvedValue({ success: true });
  const getWebsitePreview = vi
    .fn()
    .mockResolvedValue({ imageDataUrl: "data:image/png;base64,aGVsbG8=", url: links[0].destination });
  window.api = {
    ...originalApi,
    openExternalLink,
    getWebsitePreview,
    cancelWebsitePreview: vi.fn().mockResolvedValue(undefined),
  };
  const { container } = render(<NoteLinks sourcePath="/notes/a.md" links={links} />);
  fireEvent.click(screen.getByRole("button", { name: "Load preview for Example" }));
  expect(getWebsitePreview).toHaveBeenCalledWith(links[0].destination, {
    userInitiated: true,
    requestId: expect.any(String),
  });
  await waitFor(() =>
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8="),
  );
  expect(openExternalLink).not.toHaveBeenCalled();
  expect(jump).not.toHaveBeenCalled();
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("img")).toBeNull();
  expect(getWebsitePreview).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Open Example" }));
  expect(openExternalLink).toHaveBeenCalledWith(links[0].destination);
});
it("cancels pending requests when the note leaves and ignores their late result", async () => {
  let resolve!: (value: { imageDataUrl: string; url: string }) => void;
  const getWebsitePreview = vi.fn().mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const cancelWebsitePreview = vi.fn().mockResolvedValue(undefined);
  window.api = { ...originalApi, getWebsitePreview, cancelWebsitePreview };
  const { unmount } = render(<NoteLinks sourcePath="/notes/a.md" links={links} />);
  fireEvent.click(screen.getByRole("button", { name: "Load preview for Example" }));
  unmount();
  expect(cancelWebsitePreview).toHaveBeenCalledWith(getWebsitePreview.mock.calls[0][1].requestId);
  resolve({ imageDataUrl: "data:image/png;base64,aGVsbG8=", url: links[0].destination });
  await Promise.resolve();
});
it("opens relative note links using the source note path", () => {
  render(
    <NoteLinks
      sourcePath="/notes/folder/a.md"
      links={[{ kind: "note", text: "Other", destination: "./b.md", line: 3 }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open Other" }));
  expect(openFile).toHaveBeenCalledWith("./b.md", "/notes/folder/a.md");
  expect(jump).not.toHaveBeenCalled();
});
