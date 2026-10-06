// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileCommands = vi.hoisted(() => ({
  exportWorkspaceFileCopy: vi.fn(),
  openInDefaultApp: vi.fn(),
  revealInSystemFileManager: vi.fn(),
}));

vi.mock("../src/renderer/src/features/files/workspaceFileService", () => fileCommands);

import { ImageViewer } from "../src/renderer/src/features/files/ImageViewer";
import { createWorkspaceItemViews } from "../src/renderer/src/app/workspaceItemViews";
import { notificationsAtom } from "../src/renderer/src/store/NotificationsStore";
import type { FileItem } from "../src/shared/file-item";
import { createFileWorkspaceItem, WORKSPACE_ITEM_KINDS } from "../src/shared/workspace";

const file: Extract<FileItem, { isDirectory: false }> = {
  id: "/notes/assets/map.png",
  filename: "map.png",
  relativePath: "assets/map.png",
  path: "/notes/assets/map.png",
  isDirectory: false,
  mimeType: "image/png",
};

beforeEach(() => {
  fileCommands.exportWorkspaceFileCopy.mockResolvedValue({ status: "cancelled" });
  fileCommands.openInDefaultApp.mockResolvedValue({ success: true });
  fileCommands.revealInSystemFileManager.mockResolvedValue({ success: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ImageViewer", () => {
  it("opens a remote image directly in the full viewer and disables local file actions", () => {
    const remote = { ...file, path: "https://example.com/map.png", relativePath: "https://example.com/map.png" };
    render(<ImageViewer file={remote} modalOnly />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("src")).toBe(remote.relativePath);
    expect((screen.getByRole("button", { name: "Save a copy" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reveal" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeTruthy();
  });
  it("uses a keyboard-discoverable preview and exposes fit, actual-size, and zoom controls", async () => {
    const user = userEvent.setup();
    render(<ImageViewer file={file} />);

    const preview = screen.getByRole("button", { name: "Open full image viewer for map.png" });
    expect(screen.getByRole("status").textContent).toContain("Loading image");
    const previewImage = screen.getByRole("img", { name: "map.png" });
    Object.defineProperties(previewImage, {
      naturalWidth: { configurable: true, value: 1600 },
      naturalHeight: { configurable: true, value: 900 },
    });
    fireEvent.load(previewImage);
    expect(screen.getByText("1600 × 900")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open full image viewer" })).toBeNull();

    await user.click(preview);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Actual size" })).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText(/Image canvas/), { key: "-" });
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("owns pane overflow so the preview reaches the full pane width", () => {
    const views = createWorkspaceItemViews({
      openWorkspaceItem: vi.fn(),
      openLinkedFile: vi.fn(),
      resolveWorkspaceItem: vi.fn(),
    });

    expect(views[WORKSPACE_ITEM_KINDS.file].managesOwnOverflow?.(createFileWorkspaceItem(file))).toBe(true);
    const pdfFile = {
      ...file,
      id: "/notes/documents/report.pdf",
      filename: "report.pdf",
      relativePath: "documents/report.pdf",
      path: "/notes/documents/report.pdf",
      mimeType: "application/pdf",
    };
    const pdfItem = createFileWorkspaceItem(pdfFile);
    expect(views[WORKSPACE_ITEM_KINDS.file].managesOwnOverflow?.(pdfItem)).toBe(true);

    const suspense = views[WORKSPACE_ITEM_KINDS.file].render(pdfItem, "pane-1") as ReactElement<{
      children: ReactElement;
    }>;
    expect(suspense.props.children.key).toBe(pdfFile.id);
  });

  it("shows load failures with a retry action", () => {
    render(<ImageViewer file={file} />);
    fireEvent.error(screen.getByRole("img", { name: "map.png" }));

    expect(screen.getByRole("alert").textContent).toContain("Image could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("status").textContent).toContain("Loading image");
  });

  it("reports failed native actions and confirms successful exports", async () => {
    const store = createStore();
    fileCommands.revealInSystemFileManager.mockResolvedValue({ success: false, error: "Permission denied" });
    fileCommands.exportWorkspaceFileCopy.mockResolvedValue({ status: "exported", path: "/tmp/map.png" });
    render(
      <Provider store={store}>
        <ImageViewer file={file} />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show image in file manager" }));
    await waitFor(() => expect(store.get(notificationsAtom).at(-1)?.title).toBe("Could not show image"));
    expect(store.get(notificationsAtom).at(-1)?.message).toBe("Permission denied");

    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    await waitFor(() => expect(store.get(notificationsAtom).at(-1)?.title).toBe("Image copy saved"));
    expect(store.get(notificationsAtom).at(-1)?.message).toBe("/tmp/map.png");
  });
});
