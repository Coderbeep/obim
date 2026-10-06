import { StrictMode } from "react";
import { Provider, createStore } from "jotai";
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdfMocks = vi.hoisted(() => ({
  drawLayerConstructor: vi.fn(),
  drawLayerDestroy: vi.fn(),
  drawLayerSetParent: vi.fn(),
  getDocument: vi.fn(),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  destroy: vi.fn(() => Promise.resolve()),
}));

const fileCommands = vi.hoisted(() => ({
  openInDefaultApp: vi.fn(),
  readBinaryFile: vi.fn(),
  readTextFile: vi.fn(),
  revealInSystemFileManager: vi.fn(),
  saveFile: vi.fn(),
}));
const openNote = vi.hoisted(() => vi.fn());

const nativeShortcutMocks = vi.hoisted(() => ({
  callback: null as ((shortcut: "in" | "out" | "reset") => void) | null,
  openExternalLink: vi.fn(),
  setPdfViewerShortcutFocus: vi.fn(),
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf.worker.js" }));
vi.mock("pdfjs-dist", () => {
  class MockDrawLayer {
    private selection: HTMLDivElement | null = null;

    constructor(options: { pageIndex: number; textLayer?: Element | null }) {
      pdfMocks.drawLayerConstructor(options);
    }

    setParent(parent: HTMLElement) {
      this.selection = document.createElement("div");
      this.selection.className = "selection";
      parent.append(this.selection);
      pdfMocks.drawLayerSetParent(parent);
    }

    destroy() {
      this.selection?.remove();
      this.selection = null;
      pdfMocks.drawLayerDestroy();
    }
  }

  class MockTextLayer {
    textContentItemsStr: string[] = [];
    textDivs: HTMLElement[] = [];
    private content: { items: Array<{ str?: string }> };
    private container: HTMLElement;

    constructor({
      textContentSource,
      container,
    }: {
      textContentSource: { items: Array<{ str?: string }> };
      container: HTMLElement;
    }) {
      this.content = textContentSource;
      this.container = container;
    }

    render() {
      for (const item of this.content.items) {
        if (item.str === undefined) continue;
        const span = document.createElement("span");
        span.textContent = item.str;
        if ((item as { mockBounds?: boolean }).mockBounds) {
          span.getBoundingClientRect = () => {
            const pageElement = span.closest<HTMLElement>(".pdf-page");
            const scale = pageElement ? Number.parseFloat(pageElement.style.width) / 600 : 1;
            const left = ((item as { transform?: number[] }).transform?.[4] ?? 10) * scale;
            const top = 10 * scale;
            const width = ((item as { width?: number }).width ?? 0) * scale;
            const height = ((item as { height?: number }).height ?? 10) * scale;
            return {
              left,
              top,
              right: left + width,
              bottom: top + height,
              width,
              height,
              x: left,
              y: top,
              toJSON: () => ({}),
            };
          };
        }
        this.textContentItemsStr.push(item.str);
        this.textDivs.push(span);
        if (item.str) this.container.append(span);
      }
      return Promise.resolve();
    }

    update() {}
    cancel() {}
  }

  return {
    getDocument: pdfMocks.getDocument,
    GlobalWorkerOptions: { workerSrc: "" },
    PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
    OPS: { setFont: 37, showText: 44, showSpacedText: 45 },
    DrawLayer: MockDrawLayer,
    TextLayer: MockTextLayer,
  };
});
vi.mock("../src/renderer/src/features/files/workspaceFileService", () => fileCommands);
vi.mock("../src/renderer/src/features/files/fileActions", () => ({
  useFileOpen: () => ({ open: openNote }),
}));

import { PDFViewer } from "../src/renderer/src/features/files/PDFViewer";
import { dispatchPdfDeepLink, parsePdfDeepLink } from "../src/renderer/src/shared/pdfDeepLink";
import { dispatchPdfReferenceHover } from "../src/renderer/src/shared/pdfReferenceHover";
import type { FileItem } from "../src/shared/file-item";
import { fileTreeAtom } from "../src/renderer/src/store/fileExplorerStore";
import { fileBuffersByPathAtom } from "../src/renderer/src/store/fileBufferStore";
import { NotificationLevel, notificationsAtom } from "../src/renderer/src/store/NotificationsStore";

const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
let resizeObserverCallback: ResizeObserverCallback | null = null;
let mockClientWidth = 900;

const file: Extract<FileItem, { isDirectory: false }> = {
  id: "/notes/documents/report.pdf",
  filename: "report.pdf",
  relativePath: "documents/report.pdf",
  path: "/notes/documents/report.pdf",
  isDirectory: false,
  mimeType: "application/pdf",
};

type MockTextContent = {
  items: Array<{
    str: string;
    width: number;
    height: number;
    transform: number[];
    fontName?: string;
    dir?: string;
    hasEOL?: boolean;
    mockBounds?: boolean;
  }>;
  styles: Record<string, unknown>;
};
type MockAnnotation = {
  id: string;
  subtype: string;
  rect: number[];
  url?: string;
  dest?: string;
  titleObj?: { str: string };
};
type MockOperatorList = { fnArray: number[]; argsArray: unknown[][] };
const page = (pageNumber: number, width = 600, height = 800) => ({
  userUnit: 1,
  getViewport: ({ scale }: { scale: number }) => ({
    width: width * scale,
    height: height * scale,
    scale,
    rotation: 0,
    rawDims: { pageWidth: width, pageHeight: height, pageX: 0, pageY: 0 },
    convertToViewportPoint: (x: number, y: number) => [x * scale, (height - y) * scale],
  }),
  cleanup: vi.fn(),
  getAnnotations: vi.fn<() => Promise<MockAnnotation[]>>(() => Promise.resolve([])),
  getOperatorList: vi.fn<() => Promise<MockOperatorList>>(() => Promise.resolve({ fnArray: [], argsArray: [] })),
  getTextContent: vi.fn<() => Promise<MockTextContent>>(() =>
    Promise.resolve({
      items:
        pageNumber === 1
          ? [{ str: "Quarterly revenue report", width: 120, height: 10, transform: [10, 0, 0, 10, 10, 100] }]
          : [{ str: "Appendix", width: 42, height: 10, transform: [10, 0, 0, 10, 10, 100] }],
      styles: {},
    }),
  ),
  render: pdfMocks.render,
});

const loadingTaskFor = (document: object) => ({
  promise: Promise.resolve(document),
  destroy: pdfMocks.destroy,
  onProgress: null,
  onPassword: null,
});

const openPdfSearch = async () => {
  const viewport = screen.getByLabelText(/PDF pages/);
  fireEvent.keyDown(viewport, { key: "f", ctrlKey: true });
  const searchInput = await screen.findByRole<HTMLInputElement>("searchbox", { name: "Search PDF" });
  await waitFor(() => expect(searchInput.disabled).toBe(false));
  return searchInput;
};

beforeEach(() => {
  mockClientWidth = 900;
  resizeObserverCallback = null;
  window.api = {
    openExternalLink: nativeShortcutMocks.openExternalLink,
    setPdfViewerShortcutFocus: nativeShortcutMocks.setPdfViewerShortcutFocus,
    onPdfZoomShortcut: vi.fn((callback: (shortcut: "in" | "out" | "reset") => void) => {
      nativeShortcutMocks.callback = callback;
      return () => {
        if (nativeShortcutMocks.callback === callback) nativeShortcutMocks.callback = null;
      };
    }),
  } as unknown as Window["api"];
  nativeShortcutMocks.openExternalLink.mockResolvedValue({ success: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => mockClientWidth },
    clientHeight: { configurable: true, get: () => 700 },
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value(this: Range) {
      const textDiv = this.startContainer.parentElement;
      const textLayer = textDiv?.closest(".pdf-page-text");
      const pageElement = textDiv?.closest<HTMLElement>(".pdf-page");
      const itemIndex = textLayer && textDiv ? Array.from(textLayer.children).indexOf(textDiv) : 0;
      const scale = pageElement ? Number.parseFloat(pageElement.style.width) / 600 : 1;
      const left = (10 + this.startOffset * 8) * scale;
      const top = (10 + Math.max(0, itemIndex) * 20) * scale;
      const width = Math.max(0, (this.endOffset - this.startOffset) * 8 * scale);
      const height = 16 * scale;
      return [{ left, top, right: left + width, bottom: top + height, width, height }] as unknown as DOMRectList;
    },
  });

  const document = {
    isPureXfa: false,
    numPages: 2,
    getPage: vi.fn((pageNumber: number) => Promise.resolve(page(pageNumber))),
    getDestination: vi.fn(),
    getPageIndex: vi.fn(),
  };
  const task = {
    promise: Promise.resolve(document),
    destroy: pdfMocks.destroy,
    onProgress: null,
    onPassword: null,
  };
  pdfMocks.getDocument.mockReturnValue(task);
  fileCommands.openInDefaultApp.mockResolvedValue({ success: true });
  fileCommands.readBinaryFile.mockResolvedValue({ success: true, content: new Uint8Array([37, 80, 68, 70]) });
  fileCommands.revealInSystemFileManager.mockResolvedValue({ success: true });
  fileCommands.readTextFile.mockResolvedValue({ success: false, error: "No source note" });
  fileCommands.saveFile.mockResolvedValue({ success: true, version: { mtimeMs: 2, sizeBytes: 80 } });
  openNote.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  document.body.classList.remove("pane-resizing");
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  if (originalRangeClientRects) {
    Object.defineProperty(Range.prototype, "getClientRects", originalRangeClientRects);
  } else {
    Reflect.deleteProperty(Range.prototype, "getClientRects");
  }
  Reflect.deleteProperty(window, "api");
});

const mockPdfPageLayout = () => {
  const top = vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
    if (!this.matches(".pdf-page")) return 0;
    const previous = Array.from(this.parentElement?.children ?? []).slice(0, Number(this.dataset.pageNumber) - 1);
    return (
      16 + previous.reduce((sum, element) => sum + Number.parseFloat((element as HTMLElement).style.height) + 18, 0)
    );
  });
  const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return Number.parseFloat(this.style.height) || 700;
  });
  const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return Number.parseFloat(this.style.width) || 900;
  });
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const viewport = this.closest<HTMLElement>(".pdf-viewer-viewport");
    const top = this.matches(".pdf-page") ? this.offsetTop - (viewport?.scrollTop ?? 0) : 0;
    return {
      top,
      left: 0,
      right: this.offsetWidth,
      bottom: top + this.offsetHeight,
      width: this.offsetWidth,
      height: this.offsetHeight,
    } as DOMRect;
  });
  return () => {
    top.mockRestore();
    height.mockRestore();
    width.mockRestore();
    bounds.mockRestore();
  };
};

describe("PDFViewer", () => {
  it("preserves the viewport anchor when changed PDF bytes reload the same file", async () => {
    const resetLayout = mockPdfPageLayout();
    pdfMocks.getDocument.mockImplementation(() =>
      loadingTaskFor({ numPages: 30, getPage: (number: number) => Promise.resolve(page(number)) }),
    );
    const view = { scale: 0.25, zoomMode: "custom" as const, spreadMode: "none" as const };
    try {
      const { rerender } = render(<PDFViewer file={file} initialViewState={view} />);
      await waitFor(() => expect(document.querySelector<HTMLElement>(".pdf-page")?.style.height).toBe("200px"));
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      });
      const viewport = screen.getByLabelText(/PDF pages/) as HTMLElement;
      const targetScroll = 16 + 12 * 218 + 30;
      viewport.scrollTop = targetScroll;
      fireEvent.scroll(viewport);
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      });
      rerender(<PDFViewer file={{ ...file, version: { mtimeMs: 2, sizeBytes: 200 } }} initialViewState={view} />);
      await waitFor(() => expect(pdfMocks.getDocument).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect((screen.getByLabelText(/PDF pages/) as HTMLElement).scrollTop).toBeCloseTo(targetScroll, 4),
      );
    } finally {
      resetLayout();
    }
  });
  it("keeps the same page canvas and search visible until a refreshed page finishes painting", async () => {
    const resetLayout = mockPdfPageLayout();
    try {
      const view = { scale: 1, zoomMode: "custom" as const };
      const { rerender } = render(<PDFViewer file={file} initialViewState={view} />);
      await waitFor(() => expect(document.querySelector(".pdf-page-canvas canvas")).toBeTruthy());
      const originalPage = document.querySelector(".pdf-page")!;
      const originalCanvas = originalPage.querySelector("canvas")!;
      const search = await openPdfSearch();
      fireEvent.change(search, { target: { value: "revenue" } });
      await screen.findByText("1 / 1");
      await waitFor(() => expect(document.querySelector(".pdf-search-highlight-active")).toBeTruthy());
      const viewport = screen.getByLabelText(/PDF pages/);
      viewport.scrollTop = 123;

      let finishRead!: (value: { success: true; content: Uint8Array }) => void;
      fileCommands.readBinaryFile.mockReturnValueOnce(
        new Promise((resolve) => {
          finishRead = resolve;
        }),
      );
      let finishPaint!: () => void;
      const paint = new Promise<void>((resolve) => {
        finishPaint = resolve;
      });
      const nextPage = { ...page(1), render: vi.fn(() => ({ promise: paint, cancel: vi.fn() })) };
      pdfMocks.getDocument.mockReturnValue(
        loadingTaskFor({ numPages: 2, getPage: (n: number) => Promise.resolve(n === 1 ? nextPage : page(n)) }),
      );
      rerender(<PDFViewer file={{ ...file, version: { mtimeMs: 2, sizeBytes: 200 } }} initialViewState={view} />);

      expect(document.querySelector(".pdf-page")).toBe(originalPage);
      expect(originalCanvas.isConnected).toBe(true);
      expect(screen.queryByText("Opening PDF…")).toBeNull();
      expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search PDF" }).value).toBe("revenue");
      expect(pdfMocks.destroy).not.toHaveBeenCalled();
      await act(async () => finishRead({ success: true, content: new Uint8Array([37, 80, 68, 70, 2]) }));
      await waitFor(() => expect(nextPage.render).toHaveBeenCalled());
      expect(originalCanvas.isConnected).toBe(true);
      expect(screen.queryByText("Rendering page 1…")).toBeNull();
      await act(async () => finishPaint());
      await waitFor(() => expect(originalCanvas.isConnected).toBe(false));
      expect(document.querySelector(".pdf-page")).toBe(originalPage);
      expect(originalPage.querySelector("canvas")).toBeTruthy();
      expect(viewport.scrollTop).toBe(123);
      expect((originalPage as HTMLElement).style.width).toBe("600px");
      expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search PDF" }).value).toBe("revenue");
    } finally {
      resetLayout();
    }
  });

  it("retains readable pages after refresh failure and retries without blanking them", async () => {
    const { rerender } = render(<PDFViewer file={file} />);
    await waitFor(() => expect(document.querySelector(".pdf-page-canvas canvas")).toBeTruthy());
    const canvas = document.querySelector(".pdf-page-canvas canvas")!;
    fileCommands.readBinaryFile.mockResolvedValueOnce({ success: false, error: "Read failed" });
    rerender(<PDFViewer file={{ ...file, version: { mtimeMs: 2, sizeBytes: 200 } }} />);
    await screen.findByText("Read failed");
    expect(canvas.isConnected).toBe(true);
    expect(screen.queryByText("Opening PDF…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(fileCommands.readBinaryFile).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText("Read failed")).toBeNull());
    expect(document.querySelector(".pdf-page-canvas canvas")).toBeTruthy();
  });

  it("does not retain a previous file's page while a different file loads", async () => {
    const { rerender } = render(<PDFViewer file={file} />);
    await waitFor(() => expect(document.querySelector(".pdf-page-canvas canvas")).toBeTruthy());
    const canvas = document.querySelector(".pdf-page-canvas canvas")!;
    fileCommands.readBinaryFile.mockReturnValueOnce(new Promise(() => undefined));
    rerender(<PDFViewer file={{ ...file, path: "/notes/other.pdf", filename: "other.pdf" }} />);
    await screen.findByText("Opening PDF…");
    expect(canvas.isConnected).toBe(false);
    expect(pdfMocks.destroy).toHaveBeenCalled();
  });

  it("cancels superseded refreshes and releases each document task exactly once", async () => {
    const firstDestroy = vi.fn(),
      pendingDestroy = vi.fn(),
      lastDestroy = vi.fn();
    const doc = { numPages: 1, getPage: (n: number) => Promise.resolve(page(n)) };
    pdfMocks.getDocument.mockReturnValueOnce({ ...loadingTaskFor(doc), destroy: firstDestroy });
    const { rerender, unmount } = render(<PDFViewer file={file} />);
    await waitFor(() => expect(document.querySelector("canvas")).toBeTruthy());
    let finishOld!: (value: typeof doc) => void;
    pdfMocks.getDocument.mockReturnValueOnce({
      ...loadingTaskFor(doc),
      promise: new Promise((resolve) => {
        finishOld = resolve;
      }),
      destroy: pendingDestroy,
    });
    rerender(<PDFViewer file={{ ...file, version: { mtimeMs: 2, sizeBytes: 200 } }} />);
    await waitFor(() => expect(pdfMocks.getDocument).toHaveBeenCalledTimes(2));
    expect(firstDestroy).not.toHaveBeenCalled();
    const latestPage = { ...page(1), render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })) };
    pdfMocks.getDocument.mockReturnValueOnce({
      ...loadingTaskFor({ ...doc, getPage: () => Promise.resolve(latestPage) }),
      destroy: lastDestroy,
    });
    rerender(<PDFViewer file={{ ...file, version: { mtimeMs: 3, sizeBytes: 201 } }} />);
    await waitFor(() => expect(latestPage.render).toHaveBeenCalled());
    const canvas = document.querySelector("canvas");
    await act(async () => finishOld(doc));
    expect(document.querySelector("canvas")).toBe(canvas);
    expect(pendingDestroy).toHaveBeenCalledTimes(1);
    expect(firstDestroy).toHaveBeenCalledTimes(1);
    expect(lastDestroy).not.toHaveBeenCalled();
    unmount();
    expect(lastDestroy).toHaveBeenCalledTimes(1);
  });

  it("preserves the selected search occurrence while the refreshed document is reindexed", async () => {
    const doc = { numPages: 3, getPage: (n: number) => Promise.resolve(page(n)) };
    pdfMocks.getDocument.mockReturnValue(loadingTaskFor(doc));
    const { rerender } = render(<PDFViewer file={file} />);
    const search = await openPdfSearch();
    fireEvent.change(search, { target: { value: "Appendix" } });
    await screen.findByText("1 / 2");
    fireEvent.keyDown(search, { key: "Enter" });
    await screen.findByText("2 / 2");
    let finishText!: (value: Awaited<ReturnType<ReturnType<typeof page>["getTextContent"]>>) => void;
    const text = new Promise<Awaited<ReturnType<ReturnType<typeof page>["getTextContent"]>>>((resolve) => {
      finishText = resolve;
    });
    pdfMocks.getDocument.mockReturnValueOnce(
      loadingTaskFor({
        ...doc,
        getPage: (n: number) => Promise.resolve(n === 3 ? { ...page(n), getTextContent: () => text } : page(n)),
      }),
    );
    rerender(<PDFViewer file={{ ...file, version: { mtimeMs: 2, sizeBytes: 200 } }} />);
    await waitFor(() => expect(pdfMocks.getDocument).toHaveBeenCalledTimes(2));
    expect(screen.getByText("2 / 2")).toBeTruthy();
    await act(async () => finishText(await page(3).getTextContent()));
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });

  it("keeps the previous page visible while a background refresh requests a password", async () => {
    const { rerender } = render(<PDFViewer file={file} />);
    await waitFor(() => expect(document.querySelector("canvas")).toBeTruthy());
    const canvas = document.querySelector("canvas")!;
    const doc = { numPages: 1, getPage: (n: number) => Promise.resolve(page(n)) };
    let finish!: (document: typeof doc) => void;
    const task = {
      ...loadingTaskFor(doc),
      promise: new Promise((resolve) => {
        finish = resolve;
      }),
      onPassword: null as null | ((callback: (password: string | Error) => void, reason: number) => void),
    };
    pdfMocks.getDocument.mockReturnValueOnce(task);
    rerender(<PDFViewer file={{ ...file, version: { mtimeMs: 2, sizeBytes: 200 } }} />);
    await waitFor(() => expect(task.onPassword).toBeTypeOf("function"));
    const unlock = vi.fn((password: string | Error) => {
      if (password === "test password") finish(doc);
    });
    await act(async () => task.onPassword!(unlock, 1));
    expect(canvas.isConnected).toBe(true);
    fireEvent.change(screen.getByLabelText("PDF password"), { target: { value: "test password" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock PDF" }));
    await waitFor(() => expect(screen.queryByLabelText("PDF password")).toBeNull());
    expect(unlock).toHaveBeenCalledWith("test password");
    expect(document.querySelector("canvas")).toBeTruthy();
  });
  it("lets a new page destination override a page whose geometry is still loading", async () => {
    const resetLayout = mockPdfPageLayout();
    let finishPage!: (value: ReturnType<typeof page>) => void;
    const delayed = new Promise<ReturnType<typeof page>>((resolve) => {
      finishPage = resolve;
    });
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({
        numPages: 20,
        getPage: (number: number) => (number === 13 ? delayed : Promise.resolve(page(number))),
      }),
    );
    try {
      render(<PDFViewer file={file} initialPage={13} initialViewState={{ scale: 1, zoomMode: "custom" }} />);
      await waitFor(() => expect(document.querySelector('[data-page-number="14"]')).not.toBeNull());
      act(() => dispatchPdfDeepLink({ path: file.path, page: 14 }));
      await waitFor(() => expect(screen.queryByText("Opening the linked page…")).toBeNull());
      await act(async () => finishPage(page(13)));
      const viewport = screen.getByLabelText(/PDF pages/) as HTMLElement;
      await waitFor(() => expect(viewport.scrollTop).toBeCloseTo(13 * 818));
      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("14");
    } finally {
      cleanup();
      resetLayout();
    }
  });

  it("delivers a queued destination to only the chosen reader after mounting and consumes it once", async () => {
    dispatchPdfDeepLink({ path: file.path, page: 2, readerId: "embedded-reader" });
    const { rerender } = render(
      <>
        <PDFViewer file={file} readerId="other-reader" />
        <PDFViewer file={file} readerId="embedded-reader" />
      </>,
    );
    const inputs = await screen.findAllByRole<HTMLInputElement>("textbox", { name: "Page number" });
    await waitFor(() => expect(inputs.map((input) => input.value)).toEqual(["1", "2"]));
    fireEvent.change(inputs[1], { target: { value: "1" } });
    fireEvent.keyDown(inputs[1], { key: "Enter" });
    rerender(
      <>
        <PDFViewer file={{ ...file }} readerId="other-reader" />
        <PDFViewer file={{ ...file }} readerId="embedded-reader" />
      </>,
    );
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 20)));
    expect(inputs.map((input) => input.value)).toEqual(["1", "1"]);
  });

  it("keeps a pre-mount request through a replayed effect setup", async () => {
    dispatchPdfDeepLink({ path: file.path, page: 2 });
    render(
      <StrictMode>
        <PDFViewer file={file} />
      </StrictMode>,
    );
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("2"),
    );
  });

  it("waits for the PDF document promise before applying a queued destination", async () => {
    let finishDocument!: (value: object) => void;
    pdfMocks.getDocument.mockReturnValue({
      ...loadingTaskFor({}),
      promise: new Promise((resolve) => {
        finishDocument = resolve;
      }),
    });
    render(<PDFViewer file={file} initialPage={1} />);
    await waitFor(() => expect(pdfMocks.getDocument).toHaveBeenCalledOnce());
    act(() => dispatchPdfDeepLink({ path: file.path, page: 2 }));
    await act(async () => finishDocument({ numPages: 2, getPage: (number: number) => Promise.resolve(page(number)) }));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("2"),
    );
  });

  it("waits for a requested page and lets a newer destination supersede the delayed result", async () => {
    let finishPage!: (value: ReturnType<typeof page>) => void;
    const pendingPage = new Promise<ReturnType<typeof page>>((resolve) => {
      finishPage = resolve;
    });
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({
        numPages: 2,
        getPage: (number: number) => (number === 2 ? pendingPage : Promise.resolve(page(number))),
      }),
    );
    render(<PDFViewer file={file} />);
    act(() => dispatchPdfDeepLink({ path: file.path, page: 2 }));
    await screen.findByLabelText("Page 1");
    expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("1");
    act(() => dispatchPdfDeepLink({ path: file.path, page: 1 }));
    await waitFor(() => expect(screen.queryByText("Opening the linked page…")).toBeNull());
    await act(async () => finishPage(page(2)));
    expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("1");
  });

  it("retains a destination through failed document loading and retry, then clamps to known bounds", async () => {
    fileCommands.readBinaryFile.mockResolvedValueOnce({ success: false, error: "Read failed" });
    dispatchPdfDeepLink({ path: file.path, page: 99 });
    render(<PDFViewer file={file} />);
    await screen.findByText("Read failed");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("2"),
    );
  });

  it("offers a retry when the destination page fails and finishes after its page becomes available", async () => {
    let readable = false;
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({
        numPages: 2,
        getPage: (number: number) =>
          number === 2 && !readable ? Promise.reject(new Error("Page unavailable")) : Promise.resolve(page(number)),
      }),
    );
    render(<PDFViewer file={file} />);
    act(() => dispatchPdfDeepLink({ path: file.path, page: 2 }));
    await screen.findByText(/The linked page could not be opened/);
    readable = true;
    fireEvent.click(screen.getByRole("button", { name: "Retry link" }));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("2"),
    );
    await waitFor(() => expect(screen.queryByText(/The linked page could not be opened/)).toBeNull());
  });

  it("does not deliver an old document's pending link after switching PDFs", async () => {
    let finish!: (value: unknown) => void;
    fileCommands.readBinaryFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = render(<PDFViewer file={file} />);
    act(() => dispatchPdfDeepLink({ path: file.path, page: 2 }));
    const other = { ...file, path: "/notes/other.pdf", filename: "other.pdf", id: "other" };
    rerender(<PDFViewer file={other} />);
    await screen.findByLabelText("Page 1");
    await act(async () => finish({ success: true, content: new Uint8Array([37, 80, 68, 70]) }));
    expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("1");
    expect(pdfMocks.getDocument).toHaveBeenCalledOnce();
  });

  it("opens legacy annotation links at their page without waiting for highlights", async () => {
    render(<PDFViewer file={file} />);
    act(() => dispatchPdfDeepLink(parsePdfDeepLink(`${file.path}#page=2&annotation=old-clip`)!));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("2"),
    );
    await waitFor(() => expect(screen.queryByText("Opening the linked page…")).toBeNull());
  });

  it("copies a colored reference from selected PDF text and explains when its highlight appears", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const store = createStore();
    render(
      <Provider store={store}>
        <PDFViewer file={file} />
      </Provider>,
    );
    await waitFor(() =>
      expect(document.querySelector(".pdf-page-text span")?.textContent).toBe("Quarterly revenue report"),
    );
    const textNode = document.querySelector(".pdf-page-text span")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 9);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.pointerUp(textNode.parentElement!);
    expect(screen.queryByText(/Referenced in \d+ notes?/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy PDF selection reference" })).toBeNull();
    const blue = await screen.findByRole("button", { name: "Copy blue reference" });
    expect(blue.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(blue);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "[report, p. 1](documents/report.pdf#page=1&selection=0,0,0,9&color=blue)",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Copy blue reference" })).toBeNull());
    expect(store.get(notificationsAtom).at(-1)).toMatchObject({
      level: NotificationLevel.INFO,
      title: "Reference copied",
      message: "Paste into a note to show the blue highlight.",
    });
    expect(document.querySelectorAll(".pdf-reference-highlight")).toHaveLength(0);
    selection.removeAllRanges();
  });

  it("keeps selection color actions open when clipboard copying fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const store = createStore();
    render(
      <Provider store={store}>
        <PDFViewer file={file} />
      </Provider>,
    );
    await waitFor(() => expect(document.querySelector(".pdf-page-text span")?.firstChild).toBeTruthy());
    const textNode = document.querySelector(".pdf-page-text span")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 9);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.pointerUp(textNode.parentElement!);
    fireEvent.click(await screen.findByRole("button", { name: "Copy yellow reference" }));
    await waitFor(() => expect(store.get(notificationsAtom).at(-1)?.title).toBe("Could not copy PDF reference"));
    expect(screen.getByRole("button", { name: "Copy yellow reference" })).toBeTruthy();
    expect(store.get(notificationsAtom).at(-1)?.level).toBe(NotificationLevel.ERROR);
    selection.removeAllRanges();
  });

  it("finds saved note links and colors their PDF highlights", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const note = {
      ...file,
      id: "/notes/notes/idea.md",
      path: "/notes/notes/idea.md",
      filename: "idea",
      relativePath: "notes/idea.md",
      mimeType: "text/markdown",
    };
    const store = createStore();
    store.set(fileTreeAtom, [file, note]);
    window.api.queryPdfReferences = vi.fn().mockResolvedValue([
      {
        notePath: note.path,
        noteRelativePath: note.relativePath,
        destination: "../documents/report.pdf#page=1&selection=0,0,0,9&color=blue",
        label: "Key finding",
        line: 3,
      },
    ]);
    fileCommands.readTextFile.mockResolvedValue({
      success: true,
      content: "\n\n[Key finding](../documents/report.pdf#page=1&selection=0,0,0,9&color=blue)",
      version: { mtimeMs: 1, sizeBytes: 78 },
    });
    render(
      <Provider store={store}>
        <PDFViewer file={file} />
      </Provider>,
    );
    await waitFor(() =>
      expect(document.querySelector('.pdf-reference-highlight[data-reference-color="blue"]')).not.toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Show PDF references" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open PDF highlight actions, annotation 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy PDF selection reference" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open PDF highlight actions, annotation 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Referenced in 1" }));
    expect(screen.getByRole("button", { name: "Open note notes/idea.md" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy PDF selection reference" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "[report, p. 1](documents/report.pdf#page=1&selection=0,0,0,9&color=blue)",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "purple" }));
    await waitFor(() =>
      expect(fileCommands.saveFile).toHaveBeenCalledWith(
        note.path,
        "\n\n[Key finding](../documents/report.pdf#page=1&selection=0,0,0,9&color=purple)",
        { mtimeMs: 1, sizeBytes: 78 },
      ),
    );
    expect(store.get(notificationsAtom).at(-1)).toMatchObject({
      level: NotificationLevel.INFO,
      title: "References updated in 1 note",
    });
  });

  it("recolors every matching link in each note and reports the number of changed notes", async () => {
    const firstNote = {
      ...file,
      id: "/notes/notes/idea.md",
      path: "/notes/notes/idea.md",
      filename: "idea",
      relativePath: "notes/idea.md",
      mimeType: "text/markdown",
    };
    const secondNote = {
      ...firstNote,
      id: "/notes/notes/review.md",
      path: "/notes/notes/review.md",
      filename: "review",
      relativePath: "notes/review.md",
    };
    const firstDestination = "../documents/report.pdf#page=1&selection=0,0,0,9";
    const secondDestination = `${firstDestination}&color=blue`;
    const store = createStore();
    store.set(fileTreeAtom, [file, firstNote, secondNote]);
    window.api.queryPdfReferences = vi.fn().mockResolvedValue([
      {
        notePath: firstNote.path,
        noteRelativePath: firstNote.relativePath,
        destination: firstDestination,
        label: "A",
        line: 1,
      },
      {
        notePath: firstNote.path,
        noteRelativePath: firstNote.relativePath,
        destination: secondDestination,
        label: "B",
        line: 2,
      },
      {
        notePath: secondNote.path,
        noteRelativePath: secondNote.relativePath,
        destination: firstDestination,
        label: "C",
        line: 1,
      },
    ]);
    fileCommands.readTextFile.mockImplementation(async (path: string) => ({
      success: true,
      content:
        path === firstNote.path ? `[A](${firstDestination})\n[B](${secondDestination})` : `[C](${firstDestination})`,
      version: { mtimeMs: 1, sizeBytes: 80 },
    }));
    render(
      <Provider store={store}>
        <PDFViewer file={file} />
      </Provider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open PDF highlight actions, annotation 1" }));
    fireEvent.click(screen.getByRole("button", { name: "green" }));
    await waitFor(() => expect(fileCommands.saveFile).toHaveBeenCalledTimes(2));
    expect(fileCommands.saveFile).toHaveBeenCalledWith(
      firstNote.path,
      `[A](${firstDestination}&color=green)\n[B](${firstDestination}&color=green)`,
      { mtimeMs: 1, sizeBytes: 80 },
    );
    expect(fileCommands.saveFile).toHaveBeenCalledWith(secondNote.path, `[C](${firstDestination}&color=green)`, {
      mtimeMs: 1,
      sizeBytes: 80,
    });
    expect(store.get(notificationsAtom).at(-1)).toMatchObject({
      level: NotificationLevel.INFO,
      title: "References updated in 2 notes",
    });
  });

  it("reports partial recolor failures without counting failed notes as updated", async () => {
    const firstNote = {
      ...file,
      id: "/notes/notes/idea.md",
      path: "/notes/notes/idea.md",
      filename: "idea",
      relativePath: "notes/idea.md",
      mimeType: "text/markdown",
    };
    const secondNote = {
      ...firstNote,
      id: "/notes/notes/review.md",
      path: "/notes/notes/review.md",
      filename: "review",
      relativePath: "notes/review.md",
    };
    const destination = "../documents/report.pdf#page=1&selection=0,0,0,9";
    const store = createStore();
    store.set(fileTreeAtom, [file, firstNote, secondNote]);
    window.api.queryPdfReferences = vi.fn().mockResolvedValue(
      [firstNote, secondNote].map((note) => ({
        notePath: note.path,
        noteRelativePath: note.relativePath,
        destination,
        label: "Passage",
        line: 1,
      })),
    );
    fileCommands.readTextFile.mockResolvedValue({
      success: true,
      content: `[Passage](${destination})`,
      version: { mtimeMs: 1, sizeBytes: 50 },
    });
    fileCommands.saveFile.mockImplementation(async (path: string) =>
      path === secondNote.path
        ? { success: false, error: "Version conflict" }
        : { success: true, version: { mtimeMs: 2, sizeBytes: 60 } },
    );
    render(
      <Provider store={store}>
        <PDFViewer file={file} />
      </Provider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open PDF highlight actions, annotation 1" }));
    fireEvent.click(screen.getByRole("button", { name: "purple" }));
    await waitFor(() => expect(fileCommands.saveFile).toHaveBeenCalledTimes(2));
    expect(store.get(notificationsAtom).at(-1)).toMatchObject({
      level: NotificationLevel.WARNING,
      title: "References updated in 1 note",
    });
    expect(store.get(notificationsAtom).at(-1)?.message).toContain("Version conflict");
  });

  it("lists each note for the selected fragment once and opens the chosen note", async () => {
    const firstNote = {
      ...file,
      id: "/notes/notes/idea.md",
      path: "/notes/notes/idea.md",
      filename: "idea",
      relativePath: "notes/idea.md",
      mimeType: "text/markdown",
    };
    const secondNote = {
      ...firstNote,
      id: "/notes/notes/review.md",
      path: "/notes/notes/review.md",
      filename: "review",
      relativePath: "notes/review.md",
    };
    const otherNote = {
      ...firstNote,
      id: "/notes/notes/other.md",
      path: "/notes/notes/other.md",
      filename: "other",
      relativePath: "notes/other.md",
    };
    const store = createStore();
    store.set(fileTreeAtom, [file, firstNote, secondNote, otherNote]);
    window.api.queryPdfReferences = vi.fn().mockResolvedValue([
      {
        notePath: firstNote.path,
        noteRelativePath: firstNote.relativePath,
        destination: "../documents/report.pdf#page=1&selection=0,0,0,9",
        label: "A",
        line: 1,
      },
      {
        notePath: firstNote.path,
        noteRelativePath: firstNote.relativePath,
        destination: "../documents/report.pdf#page=1&selection=0,0,0,9&color=blue",
        label: "B",
        line: 2,
      },
      {
        notePath: secondNote.path,
        noteRelativePath: secondNote.relativePath,
        destination: "../documents/report.pdf#page=1&selection=0,0,0,9&color=green",
        label: "C",
        line: 3,
      },
      {
        notePath: otherNote.path,
        noteRelativePath: otherNote.relativePath,
        destination: "../documents/report.pdf#page=1&selection=0,10,0,17",
        label: "Other range",
        line: 4,
      },
    ]);
    render(
      <Provider store={store}>
        <PDFViewer file={file} />
      </Provider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open PDF highlight actions, annotation 1" }));
    const toggle = screen.getByRole("button", { name: "Referenced in 2" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("button", { name: "Open note notes/idea.md" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Open note notes/review.md" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Open note notes/other.md" })).toBeNull();
    expect(document.querySelectorAll(".pdf-viewer-reference-note-icon svg")).toHaveLength(2);
    expect(screen.getAllByText("notes")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Open note notes/review.md" }));
    await waitFor(() => expect(openNote).toHaveBeenCalledWith(secondNote, { openInNewTab: true, focusEditor: true }));
  });

  it("emphasizes only the hovered note link's saved range without navigating", async () => {
    const note = {
      ...file,
      id: "/notes/idea.md",
      path: "/notes/idea.md",
      filename: "idea",
      relativePath: "idea.md",
      mimeType: "text/markdown",
    };
    const first = "documents/report.pdf#page=1&selection=0,0,0,9";
    const second = "documents/report.pdf#page=1&selection=0,10,0,17";
    const otherPage = "documents/report.pdf#page=2&selection=0,0,0,4";
    const store = createStore();
    store.set(fileTreeAtom, [file, note]);
    window.api.queryPdfReferences = vi.fn().mockResolvedValue(
      [first, second, otherPage].map((destination, index) => ({
        notePath: note.path,
        noteRelativePath: note.relativePath,
        destination,
        label: `Range ${index + 1}`,
        line: index + 1,
      })),
    );
    render(
      <Provider store={store}>
        <PDFViewer file={file} />
      </Provider>,
    );
    await waitFor(() =>
      expect(
        document.querySelectorAll('.pdf-page[data-page-number="1"] .pdf-reference-highlight[data-reference-index]'),
      ).toHaveLength(2),
    );
    const viewport = screen.getByLabelText(/PDF pages/) as HTMLElement;
    const scrollTop = viewport.scrollTop;
    act(() => dispatchPdfReferenceHover({ owner: "note-1", notePath: note.path, destination: first }));
    await waitFor(() =>
      expect(
        document.querySelector(".pdf-reference-highlight-linked-hover")?.getAttribute("data-reference-index"),
      ).toBe("0"),
    );
    act(() => dispatchPdfReferenceHover({ owner: "note-1", notePath: note.path, destination: second }));
    await waitFor(() =>
      expect(
        document.querySelector(".pdf-reference-highlight-linked-hover")?.getAttribute("data-reference-index"),
      ).toBe("1"),
    );
    expect(document.querySelectorAll(".pdf-reference-highlight-linked-hover")).toHaveLength(1);
    act(() => dispatchPdfReferenceHover({ owner: "note-1", notePath: note.path, destination: otherPage }));
    expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("1");
    expect(viewport.scrollTop).toBe(scrollTop);
    act(() => dispatchPdfReferenceHover({ owner: "note-2", notePath: note.path, destination: first }));
    act(() => dispatchPdfReferenceHover({ owner: "note-1", notePath: note.path, destination: null }));
    expect(document.querySelector(".pdf-reference-highlight-linked-hover")?.getAttribute("data-reference-index")).toBe(
      "0",
    );
    expect(viewport.scrollTop).toBe(scrollTop);
    expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("1");
    act(() => dispatchPdfReferenceHover({ owner: "note-2", notePath: note.path, destination: null }));
    await waitFor(() => expect(document.querySelectorAll(".pdf-reference-highlight-linked-hover")).toHaveLength(0));
  });

  it.each([false, true])(
    "recovers root-level note references through indexed document reads with an older main (handler present: %s)",
    async (handlerPresent) => {
      const rootPdf = {
        ...file,
        id: "/notes/Principles.pdf",
        path: "/notes/Principles.pdf",
        filename: "Principles",
        relativePath: "Principles.pdf",
      };
      const note = {
        ...file,
        id: "/notes/Untitled 1.md",
        path: "/notes/Untitled 1.md",
        filename: "Untitled 1",
        relativePath: "Untitled 1.md",
        mimeType: "text/markdown",
      };
      const source = [
        "[Principles, p. 1](Principles.pdf#page=1&selection=0,4,0,21)",
        "[Principles, p. 1](Principles.pdf#page=1&selection=5,0,6,19)",
        "[Principles, p. 1](Principles.pdf#page=1&selection=0,4,0,19&color=green)",
        "[Principles, p. 1](Principles.pdf#page=1&selection=0,4,0,14&color=purple)",
      ].join("\n");
      const firstPage = page(1);
      firstPage.getTextContent.mockResolvedValue({
        items: [
          "The Principles of Diffusion Models",
          "",
          "Chieh-Hsin Lai",
          "",
          "Sony AI",
          "",
          "Yang Song",
          "",
          "OpenAI",
          "",
          "Dongjun Kim",
          "",
          "Stanford University",
        ].map((str) => ({
          str,
          width: str.length * 6,
          height: 10,
          transform: [10, 0, 0, 10, 10, 100],
          mockBounds: true,
        })),
        styles: {},
      });
      pdfMocks.getDocument.mockReturnValue(
        loadingTaskFor({ isPureXfa: false, numPages: 1, getPage: () => Promise.resolve(firstPage) }),
      );
      const store = createStore();
      store.set(fileTreeAtom, [rootPdf, note]);
      window.api.readIndexedDocuments = vi.fn().mockResolvedValue([{ file: note, source, modifiedAtMs: 1 }]);
      if (handlerPresent) window.api.queryPdfReferences = vi.fn().mockRejectedValue(new Error("No handler registered"));
      render(
        <Provider store={store}>
          <PDFViewer file={rootPdf} />
        </Provider>,
      );
      await waitFor(() =>
        expect(
          document.querySelectorAll(".pdf-reference-highlight[data-reference-index]").length,
        ).toBeGreaterThanOrEqual(4),
      );
      expect(screen.queryByRole("button", { name: "Show PDF references" })).toBeNull();
    },
  );

  it("recolors a link in an open note buffer without losing its editor text", async () => {
    const note = {
      ...file,
      id: "/notes/notes/draft.md",
      path: "/notes/notes/draft.md",
      filename: "draft",
      relativePath: "notes/draft.md",
      mimeType: "text/markdown",
    };
    const source = "A draft\n[Passage](../documents/report.pdf#page=1&selection=0,0,0,9)";
    const store = createStore();
    store.set(fileTreeAtom, [file, note]);
    store.set(fileBuffersByPathAtom, {
      [note.path]: { savedText: "A draft", editorText: source, version: { mtimeMs: 1, sizeBytes: 7 } },
    });
    window.api.queryPdfReferences = vi.fn().mockResolvedValue([]);
    render(
      <Provider store={store}>
        <PDFViewer file={file} />
      </Provider>,
    );
    await waitFor(() =>
      expect(document.querySelector(".pdf-reference-highlight[data-reference-index]")).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open PDF highlight actions, annotation 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Referenced in 1" }));
    expect(screen.getByRole("button", { name: "Open note notes/draft.md" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "red" }));
    await waitFor(() => expect(store.get(fileBuffersByPathAtom)[note.path].editorText).toContain("&color=red"));
    expect(fileCommands.readTextFile).not.toHaveBeenCalled();
    expect(fileCommands.saveFile).toHaveBeenCalled();
  });

  it("copies and reopens ranges after empty PDF text items", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const firstPage = page(1);
    firstPage.getTextContent.mockResolvedValue({
      items: [
        ...[
          "The Principles of Diffusion Models",
          "",
          "Chieh-Hsin Lai",
          "",
          "Sony AI",
          "",
          "Yang Song",
          "",
          "OpenAI",
          "",
        ].map((str) => ({ str, width: str.length * 6, height: 10, transform: [10, 0, 0, 10, 10, 100] })),
        { str: "Dongjun Kim", width: 64, height: 10, transform: [10, 0, 0, 10, 10, 100] },
        { str: "", width: 0, height: 10, transform: [10, 0, 0, 10, 10, 100] },
        { str: "Stanford University", width: 110, height: 10, transform: [10, 0, 0, 10, 10, 120] },
      ],
      styles: {},
    });
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({
        isPureXfa: false,
        numPages: 2,
        getPage: (number: number) => Promise.resolve(number === 1 ? firstPage : page(number)),
      }),
    );
    render(<PDFViewer file={file} />);
    await waitFor(() => expect(document.querySelector('[data-pdf-text-item-index="10"]')).not.toBeNull());
    const author = document.querySelector<HTMLElement>('[data-pdf-text-item-index="10"]')!;
    const institution = document.querySelector<HTMLElement>('[data-pdf-text-item-index="12"]')!;
    const range = document.createRange();
    range.setStart(author.firstChild!, 0);
    range.setEnd(institution.firstChild!, 19);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.pointerUp(institution);
    fireEvent.click(await screen.findByRole("button", { name: "Copy yellow reference" }));
    const markdown = "[report, p. 1](documents/report.pdf#page=1&selection=10,0,12,19)";
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(markdown));
    selection.removeAllRanges();
    act(() => dispatchPdfDeepLink(parsePdfDeepLink(`${file.path}#page=1&selection=10,0,12,19`)!));
    await waitFor(() => expect(document.querySelectorAll(".pdf-reference-highlight")).toHaveLength(2));
    act(() => dispatchPdfDeepLink(parsePdfDeepLink(`${file.path}#page=1&selection=5,0,6,19`)!));
    await waitFor(() => expect(document.querySelectorAll(".pdf-reference-highlight")).toHaveLength(2));
  });

  it("emphasizes the text range reached through a Markdown PDF link", async () => {
    render(<PDFViewer file={file} />);
    act(() => dispatchPdfDeepLink(parsePdfDeepLink(`${file.path}#page=2&selection=0,0,0,4`)!));
    await waitFor(() => expect(document.querySelectorAll(".pdf-reference-highlight").length).toBeGreaterThan(0));
    expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("2");
    act(() => dispatchPdfDeepLink(parsePdfDeepLink(`${file.path}#page=2&selection=0,0,0,200`)!));
    await waitFor(() => expect(document.querySelectorAll(".pdf-reference-highlight").length).toBe(0));
  });

  it.each([false, true])(
    "retains a linked page while binary loading is delayed (annotation: %s)",
    async (annotation) => {
      let finish!: (value: unknown) => void;
      fileCommands.readBinaryFile.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      render(<PDFViewer file={file} />);
      act(() => dispatchPdfDeepLink(parsePdfDeepLink(`${file.path}#page=2${annotation ? "&annotation=clip-2" : ""}`)!));
      await act(async () => finish({ success: true, content: new Uint8Array([37, 80, 68, 70]) }));
      await waitFor(() =>
        expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("2"),
      );
    },
  );

  it("preserves custom zoom on resize outside a reading session", async () => {
    const onViewStateChange = vi.fn();
    render(
      <PDFViewer
        file={file}
        initialViewState={{ scale: 2.23, zoomMode: "custom" }}
        onViewStateChange={onViewStateChange}
      />,
    );
    await waitFor(() => expect(document.querySelector(".pdf-page")).not.toBeNull());
    mockClientWidth = 500;
    act(() => resizeObserverCallback?.([], {} as ResizeObserver));
    expect(onViewStateChange.mock.calls.at(-1)?.[0]).toMatchObject({ scale: 2.23, zoomMode: "custom" });
  });

  it("defers expensive fit-zoom recalculation until a horizontal resize finishes", async () => {
    const onViewStateChange = vi.fn();
    render(<PDFViewer file={file} onViewStateChange={onViewStateChange} />);

    await waitFor(() =>
      expect(onViewStateChange.mock.calls.at(-1)?.[0]).toMatchObject({ scale: expect.any(Number), zoomMode: "width" }),
    );
    await waitFor(() => expect(onViewStateChange.mock.calls.at(-1)?.[0].scale).toBeGreaterThan(1.3));

    mockClientWidth = 500;
    act(() => resizeObserverCallback?.([], {} as ResizeObserver));
    expect(onViewStateChange.mock.calls.at(-1)?.[0].scale).toBeGreaterThan(1.3);

    act(() => window.dispatchEvent(new Event("resize")));
    await waitFor(() => expect(onViewStateChange.mock.calls.at(-1)?.[0].scale).toBeLessThan(1));
  });

  it("keeps the PDF render stable throughout animated sidebar resize notifications", async () => {
    const onViewStateChange = vi.fn();
    render(<PDFViewer file={file} onViewStateChange={onViewStateChange} />);
    await waitFor(() => expect(onViewStateChange.mock.calls.at(-1)?.[0].scale).toBeGreaterThan(1.3));
    await waitFor(() => expect(pdfMocks.render).toHaveBeenCalled());
    const originalScale = onViewStateChange.mock.calls.at(-1)?.[0].scale;
    const renderCount = pdfMocks.render.mock.calls.length;

    vi.useFakeTimers();
    try {
      for (const width of [850, 800, 750, 700, 650, 600, 550, 500]) {
        mockClientWidth = width;
        act(() => {
          resizeObserverCallback?.([], {} as ResizeObserver);
          vi.advanceTimersByTime(40);
        });
        expect(onViewStateChange.mock.calls.at(-1)?.[0].scale).toBe(originalScale);
        expect(pdfMocks.render).toHaveBeenCalledTimes(renderCount);
      }
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(onViewStateChange.mock.calls.at(-1)?.[0].scale).toBeLessThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the embedded document outline as a collapsible left sidebar", async () => {
    const getDestination = vi.fn(async (destination: string) => (destination === "methods" ? [1] : [0]));
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({
        isPureXfa: false,
        numPages: 2,
        getPage: vi.fn((pageNumber: number) => Promise.resolve(page(pageNumber))),
        getOutline: vi.fn(async () => [
          { title: "Introduction", dest: "intro", items: [] },
          { title: "Methods", dest: "methods", items: [{ title: "Evaluation", dest: "methods", items: [] }] },
        ]),
        getDestination,
        getPageIndex: vi.fn(),
      }),
    );
    const user = userEvent.setup();

    render(<PDFViewer file={file} />);

    const showOutline = await screen.findByRole("button", { name: "Show document outline" });
    expect(screen.queryByRole("complementary", { name: "Document outline" })).toBeNull();
    await user.click(showOutline);
    const outline = screen.getByRole("complementary", { name: "Document outline" });
    expect(
      outline.compareDocumentPosition(screen.getByLabelText(/PDF pages/)) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Methods" }));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("2"),
    );

    await user.click(screen.getByRole("button", { name: "Close document outline" }));
    expect(screen.queryByRole("complementary", { name: "Document outline" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show document outline" }));
    expect(screen.getByRole("complementary", { name: "Document outline" })).toBeTruthy();
  });

  it("restores a last-viewed page and reports subsequent page changes", async () => {
    const onPageChange = vi.fn();
    render(<PDFViewer file={file} initialPage={2} onPageChange={onPageChange} />);

    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("2"),
    );
    expect(onPageChange).toHaveBeenLastCalledWith(2);

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() => expect(onPageChange).toHaveBeenLastCalledWith(1));
  });

  it("leaves file actions to the pane header", async () => {
    render(<PDFViewer file={file} />);

    await waitFor(() => expect(screen.getByText("/ 2")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "PDF options" })).toBeNull();
  });

  it("keeps reading actions visible and groups zoom and layout in View settings", async () => {
    const user = userEvent.setup();
    render(<PDFViewer file={file} />);

    const searchButton = await screen.findByRole("button", { name: "Search document" });
    await waitFor(() => expect((searchButton as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole("button", { name: "No document contents" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "No document contents" }).parentElement?.title).toBe(
      "No contents in this PDF",
    );

    await user.click(screen.getByRole("button", { name: /^View settings,/ }));
    expect(screen.getByRole("menuitemradio", { name: "Fit width" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Fit page" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Actual size" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "No spreads" }).getAttribute("data-state")).toBe("checked");
    expect(screen.getByRole("menuitemradio", { name: "Odd spreads" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Even spreads" })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "Zoom in" }));
    expect(screen.getByRole("menuitem", { name: "Zoom in" })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "Zoom in" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: "PDF options" })).toBeNull();

    await user.click(searchButton);
    const searchInput = screen.getByRole("searchbox", { name: "Search PDF" });
    expect(document.activeElement).toBe(searchInput);
    searchInput.blur();
    await user.click(screen.getByRole("button", { name: "Focus document search" }));
    expect(document.activeElement).toBe(searchInput);
  });

  it("paints native text selection through a persistent PDF.js draw layer", async () => {
    const user = userEvent.setup();
    const result = render(<PDFViewer file={file} />);

    await waitFor(() => expect(document.querySelector(".pdf-page-text.selectionRendering")).toBeTruthy());
    const firstTextLayer = document.querySelector<HTMLElement>('[data-page-number="1"] .pdf-page-text');
    const firstSelectionHost = document.querySelector<HTMLElement>('[data-page-number="1"] .pdf-page-selection');
    const selectionOverlay = firstSelectionHost?.querySelector(".selection");
    expect(firstTextLayer).toBeTruthy();
    expect(selectionOverlay).toBeTruthy();
    expect(pdfMocks.drawLayerConstructor).toHaveBeenCalledWith({ pageIndex: 0, textLayer: firstTextLayer });
    expect(pdfMocks.drawLayerSetParent).toHaveBeenCalledWith(firstSelectionHost);

    await user.click(screen.getByRole("button", { name: /^View settings,/ }));
    await user.click(screen.getByRole("menuitem", { name: "Zoom in" }));
    await waitFor(() => expect(firstSelectionHost?.querySelector(".selection")).toBe(selectionOverlay));

    result.unmount();
    expect(pdfMocks.drawLayerDestroy).toHaveBeenCalled();
    expect(selectionOverlay?.isConnected).toBe(false);
  });

  it("loads pages, zooms with controls and Ctrl+wheel, and searches indexed text", async () => {
    const user = userEvent.setup();
    render(<PDFViewer file={file} />);

    expect(screen.getByRole("status").textContent).toContain("Opening PDF");
    await waitFor(() => expect(screen.getByText("/ 2")).toBeTruthy());
    expect(fileCommands.readBinaryFile).toHaveBeenCalledWith(file.path);
    expect(pdfMocks.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: new Uint8Array([37, 80, 68, 70]),
        cMapPacked: true,
        enableXfa: true,
      }),
    );
    expect(screen.queryByRole("searchbox", { name: "Search PDF" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^View settings,/ }));
    expect(screen.getByRole("menuitemradio", { name: "Fit width" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Fit page" })).toBeTruthy();
    await user.keyboard("{Escape}");

    const pages = document.querySelector<HTMLElement>(".pdf-viewer-pages");
    const singlePageScale = Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10);
    expect(pages?.dataset.spreadMode).toBe("none");
    await user.click(screen.getByRole("button", { name: /^View settings,/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Odd spreads" }));
    await waitFor(() => expect(pages?.dataset.spreadMode).toBe("odd"));
    expect(Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10)).toBeLessThan(singlePageScale);
    await user.click(screen.getByRole("button", { name: /^View settings,/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Even spreads" }));
    await waitFor(() => expect(pages?.dataset.spreadMode).toBe("even"));
    await user.click(screen.getByRole("button", { name: /^View settings,/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "No spreads" }));
    await waitFor(() => expect(pages?.dataset.spreadMode).toBe("none"));

    const zoomBefore = Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10);
    await user.click(screen.getByRole("button", { name: /^View settings,/ }));
    await user.click(screen.getByRole("menuitem", { name: "Zoom in" }));
    const zoomAfterButton = Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10);
    expect(zoomAfterButton).toBeGreaterThan(zoomBefore);

    const viewport = screen.getByLabelText(/PDF pages/);
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100, clientX: 200, clientY: 200 });
    await waitFor(() => {
      expect(Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10)).toBeGreaterThan(zoomAfterButton);
    });

    await user.type(await openPdfSearch(), "revenue");
    await waitFor(() => expect(screen.getByText("1 / 1")).toBeTruthy());
    expect(document.querySelector(".pdf-search-highlight-active")).toBeTruthy();
    expect(document.querySelector(".pdf-page-text")?.textContent).toContain("revenue");
    expect(document.querySelector(".pdf-page-text mark")).toBeNull();
  });

  it("removes prefix highlights that no longer match as a search query is refined", async () => {
    const firstPage = page(1);
    const secondPage = page(2);
    firstPage.getTextContent.mockResolvedValue({
      items: [{ str: "A useful model", width: 72, height: 10, transform: [10, 0, 0, 10, 10, 100] }],
      styles: {},
    });
    secondPage.getTextContent.mockResolvedValue({
      items: [{ str: "Modern architecture", width: 96, height: 10, transform: [10, 0, 0, 10, 10, 100] }],
      styles: {},
    });
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({
        isPureXfa: false,
        numPages: 2,
        getPage: vi.fn((pageNumber: number) => Promise.resolve(pageNumber === 1 ? firstPage : secondPage)),
        getDestination: vi.fn(),
        getPageIndex: vi.fn(),
      }),
    );

    const user = userEvent.setup();
    render(<PDFViewer file={file} />);
    await waitFor(() => expect(screen.getByText("/ 2")).toBeTruthy());
    await user.type(await openPdfSearch(), "model");

    await waitFor(() => expect(screen.getByText("1 / 1")).toBeTruthy());
    const highlights = Array.from(document.querySelectorAll<HTMLElement>(".pdf-search-highlight"));
    expect(highlights).toHaveLength(1);
    const widthBeforeZoom = Number.parseFloat(highlights[0].style.width);
    const firstPageElement = document.querySelector<HTMLElement>('[data-page-number="1"]');
    expect(widthBeforeZoom).toBeCloseTo(40 * (Number.parseFloat(firstPageElement?.style.width ?? "600") / 600), 5);
    expect(document.querySelector('[data-page-number="1"] .pdf-page-text')?.textContent).toBe("A useful model");
    expect(document.querySelector(".pdf-page-text mark")).toBeNull();
    expect(document.querySelector('[data-page-number="2"] .pdf-search-highlight')).toBeNull();

    fireEvent.wheel(screen.getByLabelText(/PDF pages/), {
      ctrlKey: true,
      deltaY: -100,
      clientX: 200,
      clientY: 200,
    });
    await waitFor(() =>
      expect(
        Number.parseFloat(document.querySelector<HTMLElement>(".pdf-search-highlight")?.style.width ?? "0"),
      ).toBeGreaterThan(widthBeforeZoom),
    );
  });

  it("uses PDF glyph advances for a match inside a combined dotted-leader item", async () => {
    const firstPage = page(1);
    const text = "The Logistic Model . . .";
    firstPage.getTextContent.mockResolvedValue({
      items: [
        {
          str: text,
          fontName: "regular",
          width: 103.72,
          height: 10,
          transform: [10, 0, 0, 10, 10, 100],
          mockBounds: true,
        },
      ],
      styles: {},
    });
    const glyph = (unicode: string, width: number) => ({ unicode, width });
    firstPage.getOperatorList.mockResolvedValue({
      fnArray: [37, 44, 44],
      argsArray: [
        ["regular", 10],
        [
          [
            glyph("T", 722),
            glyph("h", 556),
            glyph("e", 444),
            -333,
            glyph("L", 625),
            glyph("o", 500),
            glyph("g", 500),
            glyph("i", 278),
            glyph("s", 394),
            glyph("t", 389),
            glyph("i", 278),
            glyph("c", 444),
            -333,
            glyph("M", 917),
            glyph("o", 500),
            -28,
            glyph("d", 556),
            glyph("e", 444),
            glyph("l", 278),
          ],
        ],
        [[-468.8, glyph(".", 278), -499, glyph(".", 278), -500, glyph(".", 278)]],
      ],
    });
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({
        isPureXfa: false,
        numPages: 1,
        getPage: vi.fn(() => Promise.resolve(firstPage)),
        getDestination: vi.fn(),
        getPageIndex: vi.fn(),
      }),
    );

    const user = userEvent.setup();
    render(<PDFViewer file={file} />);
    await user.type(await openPdfSearch(), "Model");

    await waitFor(() => {
      const highlight = document.querySelector<HTMLElement>(".pdf-search-highlight");
      const pageElement = document.querySelector<HTMLElement>('[data-page-number="1"]');
      const scale = Number.parseFloat(pageElement?.style.width ?? "600") / 600;
      expect(Number.parseFloat(highlight?.style.width ?? "0")).toBeCloseTo(27.23 * scale, 1);
    });
  });

  it("falls back to DOM range geometry for non-monotonic table text", async () => {
    const firstPage = page(1);
    const text = "-0.536953";
    firstPage.getTextContent.mockResolvedValue({
      items: [
        {
          str: text,
          dir: "ltr",
          fontName: "table",
          width: 42,
          height: 8,
          transform: [8, 0, 0, 8, 10, 100],
          mockBounds: true,
        },
      ],
      styles: {},
    });
    const glyph = (unicode: string) => ({ unicode, width: 500 });
    const entries: Array<ReturnType<typeof glyph> | number> = [];
    for (const character of text) {
      if (entries.length) entries.push(1_000);
      entries.push(glyph(character));
    }
    firstPage.getOperatorList.mockResolvedValue({
      fnArray: [37, 44],
      argsArray: [["table", 8], [entries]],
    });
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({
        isPureXfa: false,
        numPages: 1,
        getPage: vi.fn(() => Promise.resolve(firstPage)),
        getDestination: vi.fn(),
        getPageIndex: vi.fn(),
      }),
    );

    const user = userEvent.setup();
    render(<PDFViewer file={file} />);
    await user.type(await openPdfSearch(), text);

    await waitFor(() => {
      const highlight = document.querySelector<HTMLElement>(".pdf-search-highlight");
      const pageElement = document.querySelector<HTMLElement>('[data-page-number="1"]');
      const scale = Number.parseFloat(pageElement?.style.width ?? "600") / 600;
      expect(Number.parseFloat(highlight?.style.width ?? "0")).toBeCloseTo(text.length * 8 * scale, 5);
    });
  });

  it("exposes keyboard-first page, search, and zoom navigation", async () => {
    render(<PDFViewer file={file} />);
    await waitFor(() => expect(screen.getByText("/ 2")).toBeTruthy());
    expect(screen.queryByRole("searchbox", { name: "Search PDF" })).toBeNull();

    const viewport = screen.getByLabelText(/PDF pages/);
    expect(screen.getByRole("button", { name: "Previous page" }).querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next page" }).querySelector("svg")).toBeTruthy();
    viewport.focus();
    fireEvent.keyDown(viewport, { key: "f", ctrlKey: true });
    const searchInput = await screen.findByRole("searchbox", { name: "Search PDF" });
    await waitFor(() => expect(document.activeElement).toBe(searchInput));
    fireEvent.keyDown(searchInput, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("searchbox", { name: "Search PDF" })).toBeNull());

    fireEvent.keyDown(viewport, { key: "+" });
    expect(Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10)).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("2");

    fireEvent.keyDown(viewport, { key: "ArrowLeft" });
    expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("1");
  });

  it("routes native primary-modifier zoom shortcuts to the focused PDF viewer", async () => {
    render(<PDFViewer file={file} />);
    await waitFor(() => expect(screen.getByText("/ 2")).toBeTruthy());

    const viewport = screen.getByLabelText(/PDF pages/);
    const pages = document.querySelector<HTMLElement>(".pdf-viewer-pages");
    expect(pages).toBeTruthy();
    if (!pages) return;

    const fitWidthScale = Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10);
    fireEvent.pointerDown(pages);
    expect(nativeShortcutMocks.setPdfViewerShortcutFocus).toHaveBeenLastCalledWith(true);
    expect(document.activeElement).toBe(viewport);

    act(() => nativeShortcutMocks.callback?.("in"));
    expect(Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10)).toBeGreaterThan(fitWidthScale);

    act(() => nativeShortcutMocks.callback?.("reset"));
    expect(Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10)).toBe(fitWidthScale);

    act(() => nativeShortcutMocks.callback?.("out"));
    expect(Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10)).toBeLessThan(fitWidthScale);

    fireEvent.pointerDown(document.body);
    expect(nativeShortcutMocks.setPdfViewerShortcutFocus).toHaveBeenLastCalledWith(false);
  });

  it("keeps the point under the cursor anchored when zooming deep into a document", async () => {
    render(<PDFViewer file={file} />);
    await waitFor(() => expect(screen.getByText("/ 2")).toBeTruthy());

    const viewport = screen.getByLabelText(/PDF pages/) as HTMLElement;
    const secondPage = document.querySelector<HTMLElement>('[data-page-number="2"]');
    expect(secondPage).toBeTruthy();
    if (!secondPage) return;

    Object.defineProperties(secondPage, {
      offsetLeft: { configurable: true, get: () => 24 },
      offsetTop: {
        configurable: true,
        get: () => 16 + 80 * (Number.parseFloat(secondPage.style.height) + 18),
      },
      offsetWidth: { configurable: true, get: () => Number.parseFloat(secondPage.style.width) },
      offsetHeight: { configurable: true, get: () => Number.parseFloat(secondPage.style.height) },
    });

    const previousElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => secondPage,
    });

    try {
      const localY = 260;
      const pointWithinPage = 420;
      viewport.scrollTop = secondPage.offsetTop + pointWithinPage - localY;
      const relativePoint = pointWithinPage / secondPage.offsetHeight;
      const zoomBefore = Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10);

      const zoomEvent = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -100,
        clientX: 300,
        clientY: localY,
      });
      expect(viewport.dispatchEvent(zoomEvent)).toBe(false);
      expect(zoomEvent.defaultPrevented).toBe(true);
      await waitFor(() =>
        expect(Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10)).toBeGreaterThan(zoomBefore),
      );

      const anchoredPoint = viewport.scrollTop + localY - secondPage.offsetTop;
      expect(anchoredPoint).toBeCloseTo(secondPage.offsetHeight * relativePoint, 5);
    } finally {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: previousElementFromPoint,
      });
    }
  });

  it("uses the nearest page as a bounded zoom anchor when the pointer is between pages", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const pageCount = 80;
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({
        isPureXfa: false,
        numPages: pageCount,
        getPage: vi.fn((pageNumber: number) => Promise.resolve(page(pageNumber))),
        getDestination: vi.fn(),
        getPageIndex: vi.fn(),
      }),
    );
    render(<PDFViewer file={file} />);
    await waitFor(() => expect(screen.getByText(`/ ${pageCount}`)).toBeTruthy());

    const viewport = screen.getByLabelText(/PDF pages/) as HTMLElement;
    const pages = document.querySelector<HTMLElement>(".pdf-viewer-pages");
    const pageElements = Array.from(document.querySelectorAll<HTMLElement>("[data-page-number]"));
    expect(pages).toBeTruthy();
    expect(pageElements).toHaveLength(pageCount);
    if (!pages) return;

    Object.defineProperty(viewport, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700 }) as DOMRect,
    });
    pageElements.forEach((element, index) => {
      Object.defineProperties(element, {
        offsetLeft: { configurable: true, get: () => 24 },
        offsetTop: {
          configurable: true,
          get: () => 16 + index * (Number.parseFloat(element.style.height) + 18),
        },
        offsetWidth: { configurable: true, get: () => Number.parseFloat(element.style.width) },
        offsetHeight: { configurable: true, get: () => Number.parseFloat(element.style.height) },
        getBoundingClientRect: {
          configurable: true,
          value: () => {
            const top = element.offsetTop - viewport.scrollTop;
            const left = element.offsetLeft - viewport.scrollLeft;
            return {
              left,
              top,
              right: left + element.offsetWidth,
              bottom: top + element.offsetHeight,
              width: element.offsetWidth,
              height: element.offsetHeight,
            } as DOMRect;
          },
        },
      });
    });

    const anchorPage = pageElements[59];
    const localY = 300;
    viewport.scrollTop = anchorPage.offsetTop + anchorPage.offsetHeight + 9 - localY;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => pages });

    try {
      fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100, clientX: 300, clientY: localY });
      await waitFor(() =>
        expect(viewport.scrollTop).toBeCloseTo(anchorPage.offsetTop + anchorPage.offsetHeight - localY, 4),
      );
    } finally {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: originalElementFromPoint,
      });
    }
  });

  it("does not turn passive page tracking into an automatic scroll loop at minimum zoom", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const pageCount = 30;
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({
        isPureXfa: false,
        numPages: pageCount,
        getPage: vi.fn((pageNumber: number) => Promise.resolve(page(pageNumber))),
        getDestination: vi.fn(),
        getPageIndex: vi.fn(),
      }),
    );
    render(<PDFViewer file={file} />);
    await waitFor(() => expect(screen.getByText(`/ ${pageCount}`)).toBeTruthy());

    const viewport = screen.getByLabelText(/PDF pages/) as HTMLElement;
    const pages = document.querySelector<HTMLElement>(".pdf-viewer-pages");
    const pageElements = Array.from(document.querySelectorAll<HTMLElement>("[data-page-number]"));
    expect(pages).toBeTruthy();
    if (!pages) return;

    fireEvent.pointerDown(pages);
    act(() => {
      for (let index = 0; index < 20; index += 1) nativeShortcutMocks.callback?.("out");
    });
    await waitFor(() => expect(screen.getByText("25%")).toBeTruthy());

    pageElements.forEach((element, index) => {
      Object.defineProperties(element, {
        offsetTop: {
          configurable: true,
          get: () => 16 + index * (Number.parseFloat(element.style.height) + 18),
        },
        offsetHeight: { configurable: true, get: () => Number.parseFloat(element.style.height) },
      });
    });

    const requestedScrollTop = pageElements[12].offsetTop + 30;
    viewport.scrollTop = requestedScrollTop;
    fireEvent.scroll(viewport);

    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).not.toBe("1"),
    );
    expect(viewport.scrollTop).toBe(requestedScrollTop);
  });

  it("coalesces passive page tracking while the viewport keeps scrolling", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const pageCount = 40;
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({
        isPureXfa: false,
        numPages: pageCount,
        getPage: vi.fn((pageNumber: number) => Promise.resolve(page(pageNumber))),
        getDestination: vi.fn(),
        getPageIndex: vi.fn(),
      }),
    );
    render(<PDFViewer file={file} />);
    await waitFor(() => expect(screen.getByText(`/ ${pageCount}`)).toBeTruthy());

    // Establish navigation before measuring scroll tracking, independently of async restoration.
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Page number" })).toHaveProperty("value", "2"));

    const viewport = screen.getByLabelText(/PDF pages/) as HTMLElement;
    const pageElements = Array.from(document.querySelectorAll<HTMLElement>("[data-page-number]"));
    let offsetTopReads = 0;
    pageElements.forEach((element, index) => {
      Object.defineProperties(element, {
        offsetTop: {
          configurable: true,
          get: () => {
            offsetTopReads += 1;
            return 16 + index * 818;
          },
        },
        offsetHeight: { configurable: true, get: () => 800 },
      });
    });

    offsetTopReads = 0;
    viewport.scrollTop = 16 + 20 * 818;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      for (let index = 0; index < 6; index += 1) {
        fireEvent.scroll(viewport);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5);
        });
      }
      expect(offsetTopReads).toBe(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveProperty("value", "21");
      expect(offsetTopReads).toBeLessThan(35);
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrolls the active search highlight itself into the center of the viewport", async () => {
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: HTMLElement) {
        if (this.classList.contains("pdf-viewer-viewport")) {
          return { left: 0, top: 100, right: 900, bottom: 800, width: 900, height: 700 } as DOMRect;
        }
        if (this.classList.contains("pdf-search-highlight-active")) {
          return { left: 40, top: 620, right: 100, bottom: 640, width: 60, height: 20 } as DOMRect;
        }
        return originalBounds.call(this);
      },
    });

    try {
      const user = userEvent.setup();
      render(<PDFViewer file={file} />);
      await waitFor(() => expect(screen.getByText("/ 2")).toBeTruthy());
      const viewport = screen.getByLabelText(/PDF pages/) as HTMLElement;

      await user.type(await openPdfSearch(), "revenue");
      await waitFor(() => expect(viewport.scrollTop).toBe(180));
    } finally {
      Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
        configurable: true,
        value: originalBounds,
      });
    }
  });

  it("does not index document text until search is used, then indexes pages sequentially", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const firstPage = page(1);
    const secondPage = page(2);
    const document = {
      isPureXfa: false,
      numPages: 2,
      getPage: vi.fn((pageNumber: number) => Promise.resolve(pageNumber === 1 ? firstPage : secondPage)),
      getDestination: vi.fn(),
      getPageIndex: vi.fn(),
    };
    pdfMocks.getDocument.mockReturnValue(loadingTaskFor(document));
    const user = userEvent.setup();
    render(<PDFViewer file={file} />);
    await waitFor(() => expect(screen.getByText("/ 2")).toBeTruthy());

    expect(firstPage.getTextContent).not.toHaveBeenCalled();
    expect(secondPage.getTextContent).not.toHaveBeenCalled();
    expect(screen.queryByText(/Indexing text/)).toBeNull();

    await user.type(await openPdfSearch(), "missing");
    await waitFor(() => expect(secondPage.getTextContent).toHaveBeenCalledTimes(1));
    expect(firstPage.getTextContent).toHaveBeenCalledTimes(1);
    expect(firstPage.getTextContent.mock.invocationCallOrder[0]).toBeLessThan(
      secondPage.getTextContent.mock.invocationCallOrder[0],
    );
  });

  it("fits the current page dimensions when a document mixes portrait and landscape pages", async () => {
    const document = {
      isPureXfa: false,
      numPages: 2,
      getPage: vi.fn((pageNumber: number) =>
        Promise.resolve(pageNumber === 1 ? page(1, 600, 800) : page(2, 1_200, 600)),
      ),
      getDestination: vi.fn(),
      getPageIndex: vi.fn(),
    };
    pdfMocks.getDocument.mockReturnValue(loadingTaskFor(document));
    render(<PDFViewer file={file} />);
    await waitFor(() => expect(screen.getByText("/ 2")).toBeTruthy());
    const portraitScale = Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10);

    fireEvent.keyDown(screen.getByLabelText(/PDF pages/), { key: "ArrowRight" });
    await waitFor(() =>
      expect(Number.parseInt(screen.getByText(/%$/u).textContent ?? "0", 10)).toBeLessThan(portraitScale),
    );
  });

  it("uses the nested PDF viewport as the page visibility root", async () => {
    let observedRoot: Element | Document | null | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        private callback: IntersectionObserverCallback;
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          this.callback = callback;
          observedRoot = options?.root;
        }
        observe(element: Element) {
          window.setTimeout(
            () =>
              this.callback([{ isIntersecting: true, target: element } as IntersectionObserverEntry], this as never),
            0,
          );
        }
        disconnect() {}
        unobserve() {}
      },
    );

    render(<PDFViewer file={file} />);
    const viewport = screen.getByLabelText(/PDF pages/);
    await waitFor(() => expect(observedRoot).toBe(viewport));
  });

  it("renders PDF hyperlinks and routes external URLs through the safe application handler", async () => {
    const firstPage = page(1);
    firstPage.getAnnotations.mockResolvedValue([
      { id: "link-1", subtype: "Link", rect: [10, 700, 150, 730], url: "https://example.com/preface" },
      { id: "link-2", subtype: "Link", rect: [10, 650, 150, 680], dest: "appendix", titleObj: { str: "Appendix" } },
    ]);
    const document = {
      isPureXfa: false,
      numPages: 2,
      getPage: vi.fn((pageNumber: number) => Promise.resolve(pageNumber === 1 ? firstPage : page(2))),
      getDestination: vi.fn(() => Promise.resolve([1])),
      getPageIndex: vi.fn(),
    };
    pdfMocks.getDocument.mockReturnValue(loadingTaskFor(document));
    render(<PDFViewer file={file} />);

    const link = await screen.findByRole("link", { name: "Open https://example.com/preface" });
    fireEvent.click(link);
    expect(nativeShortcutMocks.openExternalLink).toHaveBeenCalledWith("https://example.com/preface");

    fireEvent.click(screen.getByRole("link", { name: "Appendix" }));
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("2"),
    );
  });

  it("shows a recoverable document-level fallback for pure XFA PDFs", async () => {
    pdfMocks.getDocument.mockReturnValue(
      loadingTaskFor({ isPureXfa: true, numPages: 1, getPage: vi.fn(() => Promise.resolve(page(1))) }),
    );
    render(<PDFViewer file={file} />);

    expect((await screen.findByRole("alert")).textContent).toContain("pure XFA form");
    expect(screen.getByRole("button", { name: "Open externally" })).toBeTruthy();
  });

  it("shows a page-level retry when rendering fails", async () => {
    pdfMocks.render.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error("Canvas failed")),
      cancel: vi.fn(),
    }));
    render(<PDFViewer file={file} />);

    const retry = await screen.findByRole("button", { name: "Retry page" });
    const renderCount = pdfMocks.render.mock.calls.length;
    fireEvent.click(retry);
    await waitFor(() => expect(pdfMocks.render.mock.calls.length).toBeGreaterThan(renderCount));
  });
});
