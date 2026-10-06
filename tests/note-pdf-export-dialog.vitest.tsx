import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotePdfExportDialog } from "../src/renderer/src/features/files/NotePdfExportDialog";
import { NotificationHost } from "../src/renderer/src/features/notifications/NotificationHost";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { notePdfExportRequestAtom } from "../src/renderer/src/store/notePdfExportStore";
import type { FileItem } from "../src/shared/file-item";

const note = (path: string): FileItem => ({
  id: path,
  filename: "Example",
  relativePath: "Example.md",
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

const originalApi = window.api;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.api = originalApi;
});

describe("note PDF export notification", () => {
  it("offers to open the generated PDF", async () => {
    const exportNoteToPdf = vi.fn(async () => ({
      status: "exported" as const,
      path: "/tmp/Example.pdf",
      openToken: "open-example",
    }));
    const openExportedNotePdf = vi.fn(async () => ({ success: true as const }));
    window.api = { exportNoteToPdf, openExportedNotePdf } as unknown as Window["api"];

    const store = createStore();
    const file = note("/notes/Example.md");
    store.set(notePdfExportRequestAtom, file);
    store.set(fileBuffersByPathAtom, {
      [file.path]: { savedText: "# Example", editorText: "# Example" },
    });

    render(
      <Provider store={store}>
        <NotePdfExportDialog />
        <NotificationHost />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(await screen.findByText("PDF exported")).toBeTruthy();
    expect(screen.getByText("/tmp/Example.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(openExportedNotePdf).toHaveBeenCalledWith("open-example"));
  });
});
