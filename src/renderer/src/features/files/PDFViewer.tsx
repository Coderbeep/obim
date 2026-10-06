import {
  IconArrowUpRight,
  IconChevron,
  IconCopy,
  IconFileText,
  IconListUnordered,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconX,
} from "@pierre/icons";
import { DocumentFindBar } from "@renderer/features/search/DocumentFindBar";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  DrawLayer,
  GlobalWorkerOptions,
  OPS,
  PasswordResponses,
  TextLayer,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

import {
  PDF_DEEP_LINK_EVENT,
  claimPdfDeepLink,
  finishPdfDeepLink,
  type PdfNavigationRequest,
} from "@renderer/shared/pdfDeepLink";
import { PDF_REFERENCE_HOVER_EVENT, type PdfReferenceHover } from "@renderer/shared/pdfReferenceHover";
import {
  pdfReferenceMarkdown,
  pdfSelectionFromDom,
  resolvePdfTextSelectionRanges,
  serializePdfTextSelection,
  type PdfTextSelection,
  type PdfReferenceColor,
} from "@renderer/shared/pdfReference";
import { ColorSwatches } from "@renderer/shared/ui/color-swatches";
import { Popover, PopoverAnchor, PopoverContent } from "@renderer/shared/ui/popover";
import { Button } from "@renderer/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@renderer/shared/ui/dropdown-menu";
import { NotificationLevel, addNotificationAtom } from "@renderer/store/NotificationsStore";
import { fileTreeAtom } from "@renderer/store/fileExplorerStore";
import type { FileItem } from "@shared/file-item";
import type { ZoomShortcut } from "@shared/zoom-shortcuts";

import {
  createPdfPageTextIndex,
  createPdfTextItemAdvanceMaps,
  findPdfPageTextMatches,
  normalizePdfSearchQuery,
  pdfTextItemMatchGeometry,
  type PdfItemMatchRange,
  type PdfPageTextIndex,
  type PdfTextItem,
  type PdfTextItemAdvanceMap,
} from "./pdfSearch";
import "./PDFViewer.css";
import { openInDefaultApp, readBinaryFile } from "./workspaceFileService";
import { usePdfReferences, type PdfNoteReference } from "./usePdfReferences";
import { recolorPdfReferences } from "./pdfReferenceActions";
import { useFileOpen } from "./fileActions";
import { findItemNode } from "./fileTreeUtils";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfFile = Extract<FileItem, { isDirectory: false }>;
type PdfTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;
export type PdfViewerZoomMode = "width" | "page" | "custom";
export type PdfViewerSpreadMode = "none" | "odd" | "even";
export interface PdfViewerViewState {
  scale: number;
  spreadMode: PdfViewerSpreadMode;
  zoomMode: PdfViewerZoomMode;
}
type PageSize = { width: number; height: number };

interface SearchResult {
  key: string;
  pageNumber: number;
  start: number;
  end: number;
  itemRanges: PdfItemMatchRange[];
}

interface PageHighlight extends PdfItemMatchRange {
  active: boolean;
  resultKey: string;
  reference?: boolean;
  color?: PdfReferenceColor;
  referenceIndex?: number;
}

export interface PdfViewerProps {
  readerId?: string;
  file: PdfFile;
  initialPage?: number;
  initialViewState?: Partial<PdfViewerViewState>;
  onPageChange?: (page: number) => void;
  onViewStateChange?: (viewState: PdfViewerViewState) => void;
}

interface PdfLinkAnnotation {
  action?: string;
  contentsObj?: { str?: string };
  dest?: string | unknown[];
  id?: string;
  rect?: number[];
  subtype?: string;
  titleObj?: { str?: string };
  unsafeUrl?: string;
  url?: string;
}

interface PdfOutlineEntry {
  depth: number;
  dest?: string | unknown[];
  title: string;
}

interface PdfOutlineNode {
  dest?: string | unknown[];
  items?: PdfOutlineNode[];
  title?: string;
}

const flattenPdfOutline = (items: readonly PdfOutlineNode[], depth = 0): PdfOutlineEntry[] =>
  items.flatMap((item) => [
    ...(item.title?.trim() ? [{ depth, dest: item.dest, title: item.title.trim() }] : []),
    ...flattenPdfOutline(item.items ?? [], depth + 1),
  ]);

const NO_HIGHLIGHTS: readonly PageHighlight[] = [];
const NO_REFERENCES: readonly PdfNoteReference[] = [];
const NO_HOVERED_REFERENCES: readonly number[] = [];

const applyLinkedHover = (host: HTMLElement | null, indexes: readonly number[]) => {
  if (!host) return;
  const active = new Set(indexes);
  for (const box of host.querySelectorAll<HTMLElement>(".pdf-reference-highlight[data-reference-index]"))
    box.classList.toggle("pdf-reference-highlight-linked-hover", active.has(Number(box.dataset.referenceIndex)));
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_STEP = 1.15;
const PAGE_HORIZONTAL_PADDING = 48;
const PAGE_VERTICAL_PADDING = 48;
const PAGE_GAP = 18;
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_DIMENSION = 8192;
const MAX_CACHED_PAGES = 32;
const MAX_CONCURRENT_PAGE_RENDERS = 2;
const PAGE_TRACK_INTERVAL_MS = 80;
const PDF_ASSET_BASE_URL = new URL("pdfjs-assets/", document.baseURI).toString();

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
const normalizePageNumber = (page: number | undefined) =>
  typeof page === "number" && Number.isInteger(page) && page > 0 ? page : 1;
const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
const almostEqual = (left: number, right: number) => Math.abs(left - right) < 0.001;
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
};

const spreadPageNumbers = (pageNumber: number, pageCount: number, spreadMode: PdfViewerSpreadMode) => {
  if (spreadMode === "none" || pageCount <= 1) return [pageNumber];
  if (spreadMode === "even" && pageNumber === 1) return [1];
  const firstPage =
    spreadMode === "odd"
      ? pageNumber % 2 === 1
        ? pageNumber
        : pageNumber - 1
      : pageNumber % 2 === 0
        ? pageNumber
        : pageNumber - 1;
  return [firstPage, firstPage + 1].filter((candidate) => candidate >= 1 && candidate <= pageCount);
};

const textItemsFromContent = (content: PdfTextContent): PdfTextItem[] =>
  content.items.filter((item): item is PdfTextItem & (typeof content.items)[number] => "str" in item);

const rangeBoundary = (textNodes: readonly Text[], requestedOffset: number) => {
  let offset = Math.max(0, requestedOffset);
  for (const node of textNodes) {
    const length = node.data.length;
    if (offset <= length) return { node, offset };
    offset -= length;
  }
  const node = textNodes.at(-1);
  return node ? { node, offset: node.data.length } : null;
};

const renderSearchHighlightRects = (
  textDivs: readonly HTMLElement[],
  textItems: readonly PdfTextItem[],
  advanceMaps: readonly (PdfTextItemAdvanceMap | null)[],
  highlights: readonly PageHighlight[],
  host: HTMLElement,
) => {
  const hostBounds = host.getBoundingClientRect();
  const fragment = document.createDocumentFragment();
  const textNodeCache = new Map<number, Text[]>();

  const appendHighlightRect = (
    highlight: PageHighlight,
    bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  ) => {
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const rect = document.createElement(highlight.referenceIndex === undefined ? "div" : "button");
    rect.className = highlight.reference
      ? "pdf-search-highlight pdf-reference-highlight"
      : highlight.active
        ? "pdf-search-highlight pdf-search-highlight-active"
        : "pdf-search-highlight";
    rect.dataset.searchResultKey = highlight.resultKey;
    if (highlight.color) rect.dataset.referenceColor = highlight.color;
    if (highlight.referenceIndex === undefined) rect.setAttribute("aria-hidden", "true");
    else {
      rect.dataset.referenceIndex = String(highlight.referenceIndex);
      rect.setAttribute("type", "button");
      rect.setAttribute("aria-label", `Open PDF highlight actions, annotation ${highlight.referenceIndex + 1}`);
      rect.setAttribute("title", "PDF highlight actions");
    }
    rect.style.left = `${bounds.left - hostBounds.left}px`;
    rect.style.top = `${bounds.top - hostBounds.top}px`;
    rect.style.width = `${bounds.width}px`;
    rect.style.height = `${bounds.height}px`;
    fragment.append(rect);
  };

  for (const highlight of highlights) {
    const textDiv = textDivs[highlight.itemIndex];
    if (!textDiv) continue;
    const textItem = textItems[highlight.itemIndex];
    const advanceMap = advanceMaps[highlight.itemIndex];
    const transform = textItem?.transform;
    const isHorizontal =
      textItem?.dir !== "rtl" &&
      (!transform || (Math.abs(transform[1] ?? 0) < 0.001 && Math.abs(transform[2] ?? 0) < 0.001));
    if (advanceMap && isHorizontal && highlight.start < highlight.end) {
      const geometry = pdfTextItemMatchGeometry(advanceMap, highlight.start, highlight.end);
      const bounds = textDiv.getBoundingClientRect();
      if (geometry && bounds.width > 0) {
        appendHighlightRect(highlight, {
          left: bounds.left + bounds.width * geometry.startFraction,
          top: bounds.top,
          width: bounds.width * (geometry.endFraction - geometry.startFraction),
          height: bounds.height,
        });
        continue;
      }
    }

    let textNodes = textNodeCache.get(highlight.itemIndex);
    if (!textNodes) {
      const walker = document.createTreeWalker(textDiv, NodeFilter.SHOW_TEXT);
      textNodes = [];
      let node: Node | null;
      while ((node = walker.nextNode())) textNodes.push(node as Text);
      textNodeCache.set(highlight.itemIndex, textNodes);
    }
    const start = rangeBoundary(textNodes, highlight.start);
    const end = rangeBoundary(textNodes, highlight.end);
    if (!start || !end) continue;

    const range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      if (typeof range.getClientRects !== "function") continue;
      for (const bounds of Array.from(range.getClientRects())) {
        appendHighlightRect(highlight, bounds);
      }
    } finally {
      range.detach();
    }
  }

  host.replaceChildren(fragment);
};

const outputPixelRatio = (width: number, height: number) => {
  const deviceScale = Math.max(1, window.devicePixelRatio || 1);
  const areaScale = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height));
  const dimensionScale = Math.min(
    MAX_CANVAS_DIMENSION / Math.max(1, width),
    MAX_CANVAS_DIMENSION / Math.max(1, height),
  );
  return Math.max(0.1, Math.min(deviceScale, areaScale, dimensionScale));
};

const clearCanvasHost = (host: HTMLElement | null) => {
  if (!host) return;
  host.querySelectorAll("canvas").forEach((canvas) => {
    canvas.width = 0;
    canvas.height = 0;
  });
  host.replaceChildren();
};

interface PageRenderJob {
  cancelled: boolean;
  priority: number;
  run: () => Promise<void>;
}

class PageRenderQueue {
  private active = 0;
  private jobs: PageRenderJob[] = [];

  schedule(priority: number, run: () => Promise<void>) {
    const job: PageRenderJob = { cancelled: false, priority, run };
    this.jobs.push(job);
    this.pump();
    return () => {
      job.cancelled = true;
      const index = this.jobs.indexOf(job);
      if (index >= 0) this.jobs.splice(index, 1);
    };
  }

  clear() {
    this.jobs.forEach((job) => {
      job.cancelled = true;
    });
    this.jobs = [];
  }

  private pump() {
    this.jobs.sort((left, right) => left.priority - right.priority);
    while (this.active < MAX_CONCURRENT_PAGE_RENDERS && this.jobs.length) {
      const job = this.jobs.shift();
      if (!job || job.cancelled) continue;
      this.active += 1;
      void Promise.resolve()
        .then(() => (job.cancelled ? undefined : job.run()))
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}

const PDFPage = memo(function PDFPage({
  pageNumber,
  externalRetryRevision,
  scale,
  fallbackSize,
  getPage,
  getTextContent,
  highlights,
  references,
  hoveredReferenceIndexes,
  onActivateReference,
  onPageSize,
  evictPage,
  renderQueue,
  scrollRootRef,
  activateLink,
  isNearViewport,
  registerPageElement,
}: {
  pageNumber: number;
  externalRetryRevision: number;
  scale: number;
  fallbackSize: PageSize;
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
  getTextContent: (pageNumber: number) => Promise<PdfTextContent>;
  highlights: readonly PageHighlight[];
  references: readonly PdfNoteReference[];
  hoveredReferenceIndexes: readonly number[];
  onActivateReference: (reference: PdfNoteReference, anchor: HTMLElement) => void;
  onPageSize: (pageNumber: number, size: PageSize) => void;
  evictPage: (pageNumber: number) => void;
  renderQueue: PageRenderQueue;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  activateLink: (annotation: PdfLinkAnnotation) => void;
  isNearViewport: boolean;
  registerPageElement: (pageNumber: number, element: HTMLElement | null) => void;
}) {
  const pageElementRef = useRef<HTMLElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const selectionHostRef = useRef<HTMLDivElement>(null);
  const textHostRef = useRef<HTMLDivElement>(null);
  const searchHighlightHostRef = useRef<HTMLDivElement>(null);
  const hoveredReferenceIndexesRef = useRef(hoveredReferenceIndexes);
  hoveredReferenceIndexesRef.current = hoveredReferenceIndexes;
  const annotationHostRef = useRef<HTMLDivElement>(null);
  const drawLayerRef = useRef<DrawLayer | null>(null);
  const textLayerRef = useRef<TextLayer | null>(null);
  const searchGeometryRef = useRef<{
    page: PDFPageProxy;
    promise: Promise<{
      items: PdfTextItem[];
      maps: Array<PdfTextItemAdvanceMap | null>;
    }>;
  } | null>(null);
  const annotationsRef = useRef<PdfLinkAnnotation[]>([]);
  const latestScaleRef = useRef(scale);
  const [loadedPage, setLoadedPage] = useState<{ source: typeof getPage; page: PDFPageProxy } | null>(null);
  const page = loadedPage?.page ?? null;
  const pageIsCurrent = loadedPage?.source === getPage;
  const [pageSize, setPageSize] = useState(fallbackSize);
  const [textRevision, setTextRevision] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);

  latestScaleRef.current = scale;

  const setPageElement = useCallback(
    (element: HTMLElement | null) => {
      pageElementRef.current = element;
      registerPageElement(pageNumber, element);
    },
    [pageNumber, registerPageElement],
  );

  useEffect(() => {
    if (!isNearViewport || pageIsCurrent) return;
    let cancelled = false;
    void getPage(pageNumber)
      .then((nextPage) => {
        if (cancelled) return;
        const viewport = nextPage.getViewport({ scale: 1 });
        setLoadedPage({ source: getPage, page: nextPage });
        const nextSize = { width: viewport.width, height: viewport.height };
        setPageSize(nextSize);
        onPageSize(pageNumber, nextSize);
        setPageError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setRendering(false);
        setPageError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [externalRetryRevision, getPage, isNearViewport, onPageSize, pageIsCurrent, pageNumber, retryRevision]);

  useEffect(() => {
    if (!page || !pageIsCurrent || !isNearViewport || !textHostRef.current) {
      if (!isNearViewport) {
        drawLayerRef.current?.destroy();
        drawLayerRef.current = null;
        textHostRef.current?.classList.remove("selectionRendering");
        selectionHostRef.current?.replaceChildren();
        textLayerRef.current?.cancel();
        textLayerRef.current = null;
        textHostRef.current?.replaceChildren();
        searchHighlightHostRef.current?.replaceChildren();
      }
      return;
    }
    let cancelled = false;
    let layer: TextLayer | null = null;
    let drawLayer: DrawLayer | null = null;

    void getTextContent(pageNumber)
      .then(async (content) => {
        const textHost = textHostRef.current;
        if (cancelled || !textHost) return;
        const viewport = page.getViewport({ scale: latestScaleRef.current });
        textHost.classList.remove("selectionRendering");
        textHost.replaceChildren();
        selectionHostRef.current?.replaceChildren();
        layer = new TextLayer({ textContentSource: content, container: textHost, viewport });
        textLayerRef.current = layer;
        await layer.render();
        if (cancelled) return;
        layer.textDivs.forEach((textDiv, itemIndex) => {
          textDiv.dataset.pdfTextItemIndex = String(itemIndex);
        });
        if (!almostEqual(latestScaleRef.current, viewport.scale)) {
          layer.update({ viewport: page.getViewport({ scale: latestScaleRef.current }) });
        }
        const selectionHost = selectionHostRef.current;
        if (selectionHost) {
          try {
            drawLayer = new DrawLayer({ pageIndex: pageNumber - 1, textLayer: textHost });
            drawLayer.setParent(selectionHost);
            drawLayerRef.current = drawLayer;
            textHost.classList.add("selectionRendering");
          } catch (error) {
            drawLayer?.destroy();
            drawLayer = null;
            console.warn(`Could not create selection layer for PDF page ${pageNumber}:`, error);
          }
        }
        setTextRevision((revision) => revision + 1);
      })
      .catch((error) => {
        if (!cancelled && error instanceof Error && error.name !== "AbortException") {
          console.warn(`Could not create text layer for PDF page ${pageNumber}:`, error);
        }
      });

    return () => {
      cancelled = true;
      drawLayer?.destroy();
      if (drawLayerRef.current === drawLayer) {
        drawLayerRef.current = null;
        textHostRef.current?.classList.remove("selectionRendering");
        selectionHostRef.current?.replaceChildren();
      }
      layer?.cancel();
      if (textLayerRef.current === layer) textLayerRef.current = null;
    };
  }, [getTextContent, isNearViewport, page, pageIsCurrent, pageNumber]);

  useLayoutEffect(() => {
    if (!page || !isNearViewport || !textLayerRef.current) return;
    textLayerRef.current.update({ viewport: page.getViewport({ scale }) });
  }, [isNearViewport, page, scale]);

  const renderAnnotations = useCallback(
    (annotations: readonly PdfLinkAnnotation[]) => {
      const host = annotationHostRef.current;
      if (!host || !page) return;
      host.replaceChildren();
      const viewport = page.getViewport({ scale: latestScaleRef.current });
      if (typeof viewport.convertToViewportPoint !== "function") return;

      for (const annotation of annotations) {
        if (annotation.subtype !== "Link" || !annotation.rect || annotation.rect.length < 4) continue;
        const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
        const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
        const link = document.createElement("a");
        link.className = "pdf-page-link";
        link.style.left = `${Math.min(x1, x2)}px`;
        link.style.top = `${Math.min(y1, y2)}px`;
        link.style.width = `${Math.abs(x2 - x1)}px`;
        link.style.height = `${Math.abs(y2 - y1)}px`;
        const url = annotation.url ?? annotation.unsafeUrl;
        link.href = "#";
        link.setAttribute(
          "aria-label",
          annotation.titleObj?.str ?? annotation.contentsObj?.str ?? (url ? `Open ${url}` : "Go to PDF destination"),
        );
        link.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          activateLink(annotation);
        });
        host.append(link);
      }
    },
    [activateLink, page],
  );

  useEffect(() => {
    if (
      !page ||
      !pageIsCurrent ||
      !isNearViewport ||
      !annotationHostRef.current ||
      typeof page.getAnnotations !== "function"
    ) {
      if (!isNearViewport) {
        annotationsRef.current = [];
        annotationHostRef.current?.replaceChildren();
      }
      return;
    }
    let cancelled = false;
    void page
      .getAnnotations({ intent: "display" })
      .then((annotations) => {
        if (cancelled) return;
        annotationsRef.current = annotations as PdfLinkAnnotation[];
        renderAnnotations(annotationsRef.current);
      })
      .catch((error) => {
        if (!cancelled) console.warn(`Could not render annotations for PDF page ${pageNumber}:`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [isNearViewport, page, pageIsCurrent, pageNumber, renderAnnotations]);

  useLayoutEffect(() => {
    if (isNearViewport && annotationsRef.current.length) renderAnnotations(annotationsRef.current);
  }, [isNearViewport, renderAnnotations, scale]);

  useEffect(() => {
    if (!page || !pageIsCurrent || !isNearViewport || !canvasHostRef.current) {
      if (!isNearViewport) {
        clearCanvasHost(canvasHostRef.current);
        setRendering(false);
      }
      return;
    }

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let renderTimer = 0;
    const host = canvasHostRef.current;

    const beginRender = async () => {
      const cssViewport = page.getViewport({ scale });
      const pixelRatio = outputPixelRatio(cssViewport.width, cssViewport.height);
      const renderViewport = page.getViewport({ scale: scale * pixelRatio });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      canvas.setAttribute("aria-hidden", "true");
      setRendering(true);

      try {
        renderTask = page.render({ canvas, viewport: renderViewport });
        await renderTask.promise;
        if (!cancelled && canvasHostRef.current === host) {
          clearCanvasHost(host);
          host.append(canvas);
          setPageError(null);
        }
      } catch (error) {
        if (!cancelled && (!(error instanceof Error) || error.name !== "RenderingCancelledException")) {
          console.warn(`Could not render PDF page ${pageNumber}:`, error);
          setPageError(errorMessage(error));
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    };

    let cancelQueuedRender: () => void = () => undefined;
    renderTimer = window.setTimeout(
      () => {
        const root = scrollRootRef.current;
        const pageElement = pageElementRef.current;
        const priority = root && pageElement ? Math.abs(pageElement.offsetTop - root.scrollTop) : pageNumber;
        cancelQueuedRender = renderQueue.schedule(priority, beginRender);
      },
      host.childElementCount ? 80 : 0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(renderTimer);
      cancelQueuedRender();
      renderTask?.cancel();
    };
  }, [isNearViewport, page, pageIsCurrent, pageNumber, renderQueue, retryRevision, scale, scrollRootRef]);

  useEffect(() => {
    if (!page || isNearViewport) return;
    let cleanupTimer = 0;
    let cancelled = false;
    const releasePage = () => {
      if (cancelled) return;
      if (page.cleanup?.() === false) {
        cleanupTimer = window.setTimeout(releasePage, 25);
        return;
      }
      if (pageIsCurrent) evictPage(pageNumber);
      setLoadedPage(null);
    };
    cleanupTimer = window.setTimeout(releasePage, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(cleanupTimer);
    };
  }, [evictPage, isNearViewport, page, pageIsCurrent, pageNumber]);

  useEffect(
    () => () => {
      page?.cleanup?.();
    },
    [page],
  );
  useEffect(() => {
    const host = canvasHostRef.current;
    return () => clearCanvasHost(host);
  }, []);

  useLayoutEffect(() => {
    const layer = textLayerRef.current;
    const host = searchHighlightHostRef.current;
    if (!layer || !host || !page || !isNearViewport || (highlights.length === 0 && references.length === 0)) {
      host?.replaceChildren();
      return;
    }
    host.replaceChildren();
    let cancelled = false;
    let geometry = searchGeometryRef.current;
    if (!geometry || geometry.page !== page) {
      const promise = getTextContent(pageNumber).then(async (content) => {
        const items = textItemsFromContent(content);
        try {
          const operatorList = await page.getOperatorList();
          return {
            items,
            maps: createPdfTextItemAdvanceMaps(
              items,
              operatorList,
              new Set([OPS.showText, OPS.showSpacedText]),
              OPS.setFont,
            ),
          };
        } catch {
          return { items, maps: Array.from({ length: items.length }, () => null) };
        }
      });
      geometry = { page, promise };
      searchGeometryRef.current = geometry;
    }
    void geometry.promise.then(({ items, maps }) => {
      if (cancelled || textLayerRef.current !== layer || searchHighlightHostRef.current !== host) return;
      const saved = references.flatMap((reference, index): PageHighlight[] => {
        if (!reference.selection) return [];
        const ranges = resolvePdfTextSelectionRanges(reference.selection, items)?.ranges ?? [];
        return ranges.map((range) => ({
          ...range,
          active: false,
          reference: true,
          color: reference.color,
          resultKey: `saved-reference-${index}`,
          referenceIndex: index,
        }));
      });
      renderSearchHighlightRects(layer.textDivs, items, maps, [...saved, ...highlights], host);
      applyLinkedHover(host, hoveredReferenceIndexesRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [getTextContent, highlights, references, isNearViewport, page, pageNumber, scale, textRevision]);

  useLayoutEffect(() => {
    applyLinkedHover(searchHighlightHostRef.current, hoveredReferenceIndexes);
  }, [hoveredReferenceIndexes]);

  const effectiveSize = page ? pageSize : fallbackSize;
  const width = effectiveSize.width * scale;
  const height = effectiveSize.height * scale;
  const pageStyle = {
    width,
    height,
    "--scale-factor": String(scale),
    "--user-unit": String(page?.userUnit ?? 1),
  } as CSSProperties;

  return (
    <article
      ref={setPageElement}
      className="pdf-page"
      style={pageStyle}
      data-page-number={pageNumber}
      aria-label={`Page ${pageNumber}`}
    >
      <div ref={canvasHostRef} className="pdf-page-canvas" />
      <div ref={selectionHostRef} className="pdf-page-selection" aria-hidden="true" />
      <div
        ref={searchHighlightHostRef}
        className="pdf-page-search-highlights"
        onClick={(event) => {
          const target =
            event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-reference-index]") : null;
          const index = Number(target?.dataset.referenceIndex);
          if (target && Number.isSafeInteger(index) && references[index])
            onActivateReference(references[index], target);
        }}
      />
      <div ref={textHostRef} className="textLayer pdf-page-text" />
      <div ref={annotationHostRef} className="pdf-page-annotations" />
      {pageError ? (
        <div className="pdf-page-error" role="alert">
          <span>Page {pageNumber} could not be rendered.</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              evictPage(pageNumber);
              setLoadedPage(null);
              setPageError(null);
              setRetryRevision((revision) => revision + 1);
            }}
          >
            Retry page
          </Button>
        </div>
      ) : null}
      {rendering && !canvasHostRef.current?.childElementCount ? (
        <span className="pdf-page-rendering" role="status">
          Rendering page {pageNumber}…
        </span>
      ) : null}
      <span className="pdf-page-number" aria-hidden="true">
        {pageNumber}
      </span>
    </article>
  );
});

export const PDFViewer = ({
  readerId,
  file,
  initialPage,
  initialViewState,
  onPageChange,
  onViewStateChange,
}: PdfViewerProps) => {
  const store = useStore();
  const fileTree = useAtomValue(fileTreeAtom);
  const { open } = useFileOpen();
  const [activeAnnotation, setActiveAnnotation] = useState<{ reference: PdfNoteReference; bounds: DOMRect } | null>(
    null,
  );
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const notesListId = useId();
  const { references } = usePdfReferences(file.path);
  const matchingReferences = useMemo(() => {
    const selected = activeAnnotation?.reference;
    if (!selected?.selection) return [];
    const range = serializePdfTextSelection(selected.selection);
    return references.filter(
      (reference) =>
        reference.page === selected.page &&
        reference.selection &&
        serializePdfTextSelection(reference.selection) === range,
    );
  }, [activeAnnotation, references]);
  const referencingNotes = useMemo(() => {
    const paths = new Set<string>();
    return matchingReferences.flatMap((reference) => {
      if (paths.has(reference.notePath)) return [];
      const note = findItemNode(fileTree, reference.notePath);
      if (!note || note.isDirectory) return [];
      paths.add(reference.notePath);
      return [{ note, path: reference.noteRelativePath }];
    });
  }, [fileTree, matchingReferences]);
  const [hoveredReference, setHoveredReference] = useState<PdfReferenceHover | null>(null);
  const referencesByPage = useMemo(() => {
    const byPage = new Map<number, PdfNoteReference[]>();
    for (const reference of references) byPage.set(reference.page, [...(byPage.get(reference.page) ?? []), reference]);
    return byPage;
  }, [references]);
  useEffect(() => {
    const receiveHover = (event: Event) => {
      const detail = (event as CustomEvent<PdfReferenceHover>).detail;
      if (!detail || typeof detail.owner !== "string" || typeof detail.notePath !== "string") return;
      setHoveredReference((current) =>
        detail.destination ? detail : current?.owner === detail.owner ? null : current,
      );
    };
    window.addEventListener(PDF_REFERENCE_HOVER_EVENT, receiveHover);
    return () => window.removeEventListener(PDF_REFERENCE_HOVER_EVENT, receiveHover);
  }, []);
  const initialPageByFileRef = useRef({
    filePath: file.path,
    page: normalizePageNumber(initialPage),
  });
  if (initialPageByFileRef.current.filePath !== file.path) {
    initialPageByFileRef.current = {
      filePath: file.path,
      page: normalizePageNumber(initialPage),
    };
  }
  const requestedInitialPage = initialPageByFileRef.current.page;
  const addNotification = useSetAtom(addNotificationAtom);
  const viewerRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const textIndexRef = useRef<Array<PdfPageTextIndex | null>>([]);
  const textIndexDocumentRef = useRef<PDFDocumentProxy | null>(null);
  const pageSizesRef = useRef(new Map<number, PageSize>());
  const requestedInitialScale = clampScale(initialViewState?.scale ?? 1);
  const scaleRef = useRef(requestedInitialScale);
  const currentPageRef = useRef(requestedInitialPage);
  const initialPageAppliedRef = useRef(false);
  const hasShortcutFocusRef = useRef(false);
  const pendingZoomAnchorRef = useRef<{
    pageNumber: number;
    pageX: number;
    pageY: number;
    localX: number;
    localY: number;
  } | null>(null);
  const indexingTimerRef = useRef(0);
  const pageTrackingTimerRef = useRef(0);
  const lastScrolledResultRef = useRef("");
  const passwordCallbackRef = useRef<((password: string | Error) => void) | null>(null);
  const renderQueueRef = useRef(new PageRenderQueue());
  const pageElementsRef = useRef(new Map<number, HTMLElement>());
  const pageObserverRef = useRef<IntersectionObserver | null>(null);

  const [reloadRevision, setReloadRevision] = useState(0);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  // Each document owns its caches, including callbacks still finishing during a refresh.
  const pageCache = useMemo(() => new Map<number, Promise<PDFPageProxy>>(), [pdfDocument]);
  const textCache = useMemo(() => new Map<number, Promise<PdfTextContent>>(), [pdfDocument]);
  const displayedTaskRef = useRef<{ path: string; task: PDFDocumentLoadingTask } | null>(null);
  const [restorableDocument, setRestorableDocument] = useState<PDFDocumentProxy | null>(null);
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [loadingTask, setLoadingTask] = useState<PDFDocumentLoadingTask | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [passwordRequest, setPasswordRequest] = useState<"needed" | "incorrect" | null>(null);
  const [password, setPassword] = useState("");
  const [firstPageSize, setFirstPageSize] = useState<PageSize>({ width: 612, height: 792 });
  const [pageSizesRevision, setPageSizesRevision] = useState(0);
  const [zoomMode, setZoomMode] = useState<PdfViewerZoomMode>(initialViewState?.zoomMode ?? "width");
  const [spreadMode, setSpreadMode] = useState<PdfViewerSpreadMode>(initialViewState?.spreadMode ?? "none");
  const [scale, setScale] = useState(requestedInitialScale);
  const [currentPage, setCurrentPage] = useState(requestedInitialPage);
  const [pageField, setPageField] = useState(String(requestedInitialPage));
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [indexRevision, setIndexRevision] = useState(0);
  const [indexedPages, setIndexedPages] = useState(0);
  const [activeResultKey, setActiveResultKey] = useState<string | null>(null);
  const [nearPageNumbers, setNearPageNumbers] = useState<Set<number>>(() => new Set());
  const requestOwnerRef = useRef(crypto.randomUUID());
  const navigationSubscriptionRef = useRef(0);
  const currentReaderIdRef = useRef(readerId);
  currentReaderIdRef.current = readerId;
  const currentFileRef = useRef({ path: file.path, generation: 0 });
  if (currentFileRef.current.path !== file.path)
    currentFileRef.current = { path: file.path, generation: currentFileRef.current.generation + 1 };
  const [navigationRequest, setNavigationRequest] = useState<PdfNavigationRequest | null>(null);
  const latestNavigationRef = useRef<PdfNavigationRequest | null>(null);
  const loadedSourceRevisionRef = useRef<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [navigationAttempt, setNavigationAttempt] = useState(0);
  const [selectedText, setSelectedText] = useState<{ page: number; range: PdfTextSelection; bounds: DOMRect } | null>(
    null,
  );
  const annotationAnchor = useMemo(() => {
    const bounds = activeAnnotation?.bounds ?? selectedText?.bounds;
    return bounds ? { current: { getBoundingClientRect: () => bounds } } : undefined;
  }, [activeAnnotation, selectedText]);
  const [linkedSelection, setLinkedSelection] = useState<{
    page: number;
    ranges: PdfItemMatchRange[];
    color: PdfReferenceColor;
  } | null>(null);
  const [referenceCopied, setReferenceCopied] = useState(false);

  currentPageRef.current = currentPage;

  const captureSelection = useCallback(() => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const page = (
      anchor?.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor?.parentElement
    )?.closest<HTMLElement>(".pdf-page");
    if (!page || !viewerRef.current?.contains(page)) {
      setSelectedText(null);
      return;
    }
    const range = pdfSelectionFromDom(selection, page);
    const pageNumber = Number(page.dataset.pageNumber);
    const domRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const bounds =
      domRange && typeof domRange.getBoundingClientRect === "function"
        ? domRange.getBoundingClientRect()
        : page.getBoundingClientRect();
    setSelectedText(range && bounds && Number.isSafeInteger(pageNumber) ? { page: pageNumber, range, bounds } : null);
    setActiveAnnotation(null);
    setReferenceCopied(false);
  }, []);

  useEffect(() => onPageChange?.(currentPage), [currentPage, onPageChange]);
  useEffect(() => {
    setSelectedText(null);
    setActiveAnnotation(null);
    setLinkedSelection(null);
    setReferenceCopied(false);
  }, [file.path]);
  useEffect(
    () => onViewStateChange?.({ scale, spreadMode, zoomMode }),
    [onViewStateChange, scale, spreadMode, zoomMode],
  );

  useEffect(() => {
    let cancelled = false;
    if (!pdfDocument || typeof pdfDocument.getOutline !== "function") {
      setOutline([]);
      return;
    }
    void pdfDocument
      .getOutline()
      .then((items) => {
        if (!cancelled) setOutline(flattenPdfOutline((items ?? []) as PdfOutlineNode[]).slice(0, 500));
      })
      .catch(() => {
        if (!cancelled) setOutline([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfDocument]);

  const fileRevision = file.version ? `${file.version.mtimeMs}-${file.version.sizeBytes}` : "current";
  const sourceRevision = `${file.path}:${fileRevision}:${reloadRevision}`;
  const normalizedQuery = normalizePdfSearchQuery(query);
  const notifyError = useCallback(
    (title: string, message: string) =>
      addNotification({
        id: crypto.randomUUID(),
        level: NotificationLevel.ERROR,
        title,
        message,
        path: file.path,
        timestamp: Date.now(),
      }),
    [addNotification, file.path],
  );
  const copySavedReference = useCallback(async () => {
    const reference = activeAnnotation?.reference;
    if (!reference?.selection) return;
    try {
      await navigator.clipboard.writeText(
        pdfReferenceMarkdown(file.relativePath, reference.page, reference.selection, reference.color),
      );
      setReferenceCopied(true);
    } catch (error) {
      notifyError("Could not copy PDF reference", errorMessage(error));
    }
  }, [activeAnnotation, file.relativePath, notifyError]);

  const copySelectedReference = useCallback(
    async (color: PdfReferenceColor) => {
      if (!selectedText) return;
      try {
        await navigator.clipboard.writeText(
          pdfReferenceMarkdown(file.relativePath, selectedText.page, selectedText.range, color),
        );
        setSelectedText((current) => (current === selectedText ? null : current));
        addNotification({
          id: crypto.randomUUID(),
          level: NotificationLevel.INFO,
          title: "Reference copied",
          message: `Paste into a note to show the ${color} highlight.`,
          timestamp: Date.now(),
        });
      } catch (error) {
        notifyError("Could not copy PDF reference", errorMessage(error));
      }
    },
    [addNotification, file.relativePath, notifyError, selectedText],
  );

  const changeReferenceColor = useCallback(
    async (color: PdfReferenceColor) => {
      if (!activeAnnotation) return;
      if (matchingReferences.length === 0) {
        notifyError("Could not change PDF reference color", "The source references are no longer available.");
        return;
      }
      setAnnotationBusy(true);
      try {
        const result = await recolorPdfReferences(store, matchingReferences, color);
        const count = result.updatedNotes;
        const failed = result.failures.length;
        if (count > 0) {
          addNotification({
            id: crypto.randomUUID(),
            level: failed ? NotificationLevel.WARNING : NotificationLevel.INFO,
            title: `References updated in ${count} ${count === 1 ? "note" : "notes"}`,
            ...(failed
              ? {
                  message: `${failed} ${failed === 1 ? "note" : "notes"} could not be updated. ${result.failures[0].notePath}: ${result.failures[0].error}`,
                }
              : {}),
            timestamp: Date.now(),
          });
          setActiveAnnotation(null);
        } else if (failed) {
          notifyError(
            "Could not change PDF reference color",
            `${result.failures[0].notePath}: ${result.failures[0].error}`,
          );
        } else {
          addNotification({
            id: crypto.randomUUID(),
            level: NotificationLevel.INFO,
            title: "References already use this color",
            timestamp: Date.now(),
          });
          setActiveAnnotation(null);
        }
      } catch (error) {
        notifyError("Could not change PDF reference color", errorMessage(error));
      } finally {
        setAnnotationBusy(false);
      }
    },
    [activeAnnotation, addNotification, matchingReferences, notifyError, store],
  );

  useEffect(
    () => () => {
      const displayed = displayedTaskRef.current;
      displayedTaskRef.current = null;
      void displayed?.task.destroy();
    },
    [file.path],
  );

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    let taskAdopted = false;
    const isRefresh = displayedTaskRef.current?.path === file.path;
    const restorePage = requestedInitialPage;
    if (!isRefresh) {
      initialPageAppliedRef.current = false;
      pendingZoomAnchorRef.current = null;
      setRestorableDocument(null);
      loadedSourceRevisionRef.current = null;
      setPdfDocument(null);
      renderQueueRef.current.clear();
      textIndexRef.current = [];
      textIndexDocumentRef.current = null;
      pageSizesRef.current.clear();
      setPageSizesRevision((revision) => revision + 1);
      setIsSearchOpen(false);
      setQuery("");
      setActiveResultKey(null);
      setIndexedPages(0);
      setIndexRevision((revision) => revision + 1);
    }
    setLoadingTask(null);
    setLoadError(null);
    setLoadProgress(null);
    setPasswordRequest(null);
    setPassword("");
    passwordCallbackRef.current = null;

    void readBinaryFile(file.path)
      .then(async (result) => {
        if (cancelled) return;
        if (!result.success) {
          setLoadError(result.error);
          return;
        }

        const data = result.content instanceof Uint8Array ? result.content : new Uint8Array(result.content);
        setLoadProgress({ loaded: data.byteLength, total: data.byteLength });
        task = getDocument({
          data,
          cMapUrl: `${PDF_ASSET_BASE_URL}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${PDF_ASSET_BASE_URL}standard_fonts/`,
          iccUrl: `${PDF_ASSET_BASE_URL}iccs/`,
          wasmUrl: `${PDF_ASSET_BASE_URL}wasm/`,
          enableXfa: true,
        });
        setLoadingTask(task);
        task.onProgress = (progress) => {
          if (!cancelled) setLoadProgress(progress);
        };
        task.onPassword = (updatePassword, reason) => {
          if (cancelled) return;
          passwordCallbackRef.current = updatePassword;
          setPasswordRequest(reason === PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "needed");
        };
        void task.promise
          .then((document) => {
            if (cancelled) return;
            if (document.isPureXfa) {
              setLoadError("This PDF uses a pure XFA form that the embedded viewer cannot display safely.");
              setLoadingTask(null);
              return;
            }
            const restoredPage = Math.min(document.numPages, isRefresh ? currentPageRef.current : restorePage);
            currentPageRef.current = restoredPage;
            setCurrentPage(restoredPage);
            setPageField(String(restoredPage));
            loadedSourceRevisionRef.current = sourceRevision;
            const previous = displayedTaskRef.current;
            displayedTaskRef.current = { path: file.path, task: task! };
            taskAdopted = true;
            setPdfDocument(document);
            setPasswordRequest(null);
            setLoadingTask(null);
            if (previous?.task !== task) void previous?.task.destroy();
          })
          .catch((error) => {
            if (cancelled) return;
            setLoadError(errorMessage(error));
            setLoadingTask(null);
          });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error));
      });

    return () => {
      cancelled = true;
      passwordCallbackRef.current?.(new Error("PDF viewer closed"));
      passwordCallbackRef.current = null;
      if (!taskAdopted) void task?.destroy();
    };
  }, [file.path, requestedInitialPage, sourceRevision]);

  const getPage = useCallback(
    (pageNumber: number) => {
      if (!pdfDocument) return Promise.reject(new Error("PDF is not loaded"));
      const cached = pageCache.get(pageNumber);
      if (cached) {
        pageCache.delete(pageNumber);
        pageCache.set(pageNumber, cached);
        return cached;
      }
      const request = pdfDocument.getPage(pageNumber);
      pageCache.set(pageNumber, request);
      while (pageCache.size > MAX_CACHED_PAGES) {
        const oldestPageNumber = pageCache.keys().next().value as number | undefined;
        if (oldestPageNumber === undefined) break;
        pageCache.delete(oldestPageNumber);
      }
      void request.catch(() => {
        if (pageCache.get(pageNumber) === request) pageCache.delete(pageNumber);
      });
      return request;
    },
    [pdfDocument, pageCache],
  );

  const evictPage = useCallback((pageNumber: number) => pageCache.delete(pageNumber), [pageCache]);

  const getTextContent = useCallback(
    (pageNumber: number) => {
      const cached = textCache.get(pageNumber);
      if (cached) return cached;
      const request = getPage(pageNumber).then((page) => page.getTextContent({ includeMarkedContent: true }));
      textCache.set(pageNumber, request);
      void request.then(
        () => {
          if (textCache.get(pageNumber) === request) textCache.delete(pageNumber);
        },
        () => {
          if (textCache.get(pageNumber) === request) textCache.delete(pageNumber);
        },
      );
      return request;
    },
    [getPage, textCache],
  );

  const readViewportAnchor = useCallback((localX?: number, localY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport || !viewport.clientWidth || !viewport.clientHeight) return;
    const anchorX = localX ?? viewport.clientWidth / 2;
    const anchorY = localY ?? viewport.clientHeight / 2;
    const bounds = viewport.getBoundingClientRect();
    const clientX = bounds.left + anchorX;
    const clientY = bounds.top + anchorY;
    const pointedElement =
      typeof document.elementFromPoint === "function" ? document.elementFromPoint(clientX, clientY) : null;
    let anchorPage = pointedElement?.closest<HTMLElement>("[data-page-number]") ?? null;
    if (anchorPage && !pagesRef.current?.contains(anchorPage)) anchorPage = null;

    if (!anchorPage) {
      const pages = pagesRef.current?.children;
      if (pages?.length) {
        const contentY = viewport.scrollTop + anchorY;
        let low = 0;
        let high = pages.length - 1;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          const page = pages.item(middle) as HTMLElement | null;
          if (page && page.offsetTop <= contentY) low = middle + 1;
          else high = middle - 1;
        }

        let nearestDistance = Number.POSITIVE_INFINITY;
        const candidateStart = Math.max(0, high - 3);
        const candidateEnd = Math.min(pages.length - 1, low + 3);
        for (let index = candidateStart; index <= candidateEnd; index += 1) {
          const candidate = pages.item(index) as HTMLElement | null;
          if (!candidate) continue;
          const candidateBounds = candidate.getBoundingClientRect();
          const deltaX = Math.max(candidateBounds.left - clientX, 0, clientX - candidateBounds.right);
          const deltaY = Math.max(candidateBounds.top - clientY, 0, clientY - candidateBounds.bottom);
          const distance = deltaX * deltaX + deltaY * deltaY;
          if (distance < nearestDistance) {
            nearestDistance = distance;
            anchorPage = candidate;
          }
        }
      }
    }

    anchorPage ??=
      pagesRef.current?.querySelector<HTMLElement>(`[data-page-number="${currentPageRef.current}"]`) ?? null;
    if (!anchorPage) return;
    const pageBounds = anchorPage.getBoundingClientRect();
    const pageWidth = Math.max(1, pageBounds.width || anchorPage.offsetWidth);
    const pageHeight = Math.max(1, pageBounds.height || anchorPage.offsetHeight);
    const pageLeft = pageBounds.width ? pageBounds.left : bounds.left + anchorPage.offsetLeft - viewport.scrollLeft;
    const pageTop = pageBounds.height ? pageBounds.top : bounds.top + anchorPage.offsetTop - viewport.scrollTop;
    return {
      pageNumber: Number(anchorPage.dataset.pageNumber),
      pageX: (clientX - pageLeft) / pageWidth,
      pageY: (clientY - pageTop) / pageHeight,
      localX: anchorX,
      localY: anchorY,
    };
  }, []);

  const captureZoomAnchor = useCallback(
    (localX?: number, localY?: number) => {
      if (!initialPageAppliedRef.current) return;
      const anchor = readViewportAnchor(localX, localY);
      pendingZoomAnchorRef.current = anchor
        ? { ...anchor, pageX: clampUnit(anchor.pageX), pageY: clampUnit(anchor.pageY) }
        : null;
    },
    [readViewportAnchor],
  );

  useEffect(() => {
    if (!pdfDocument) return;
    let cancelled = false;
    const target = requestedInitialPage;
    const rememberSize = (number: number, page: PDFPageProxy) => {
      if (cancelled) return;
      if (initialPageAppliedRef.current && !pendingZoomAnchorRef.current)
        pendingZoomAnchorRef.current = readViewportAnchor() ?? null;
      const viewport = page.getViewport({ scale: 1 });
      const size = { width: viewport.width, height: viewport.height };
      pageSizesRef.current.set(number, size);
      if (number === 1) setFirstPageSize(size);
      setPageSizesRevision((revision) => revision + 1);
    };
    void Promise.all([
      getPage(1).then((first) => rememberSize(1, first)),
      getPage(Math.min(target, pdfDocument.numPages)).then((anchor) =>
        rememberSize(Math.min(target, pdfDocument.numPages), anchor),
      ),
    ])
      .then(() => {
        if (cancelled) return;
        setRestorableDocument(pdfDocument);
      })
      .catch(() => {
        if (!cancelled) setRestorableDocument(pdfDocument);
      });
    return () => {
      cancelled = true;
    };
  }, [getPage, pdfDocument, requestedInitialPage, readViewportAnchor]);

  const recordPageSize = useCallback(
    (pageNumber: number, size: PageSize) => {
      const previous = pageSizesRef.current.get(pageNumber);
      if (previous && almostEqual(previous.width, size.width) && almostEqual(previous.height, size.height)) return;
      if (initialPageAppliedRef.current) pendingZoomAnchorRef.current = readViewportAnchor() ?? null;
      pageSizesRef.current.set(pageNumber, size);
      setPageSizesRevision((revision) => revision + 1);
    },
    [readViewportAnchor],
  );

  const registerPageElement = useCallback((pageNumber: number, element: HTMLElement | null) => {
    const previous = pageElementsRef.current.get(pageNumber);
    if (previous && previous !== element) pageObserverRef.current?.unobserve(previous);
    if (!element) {
      pageElementsRef.current.delete(pageNumber);
      return;
    }
    pageElementsRef.current.set(pageNumber, element);
    pageObserverRef.current?.observe(element);
  }, []);

  useEffect(() => {
    if (!pdfDocument) {
      setNearPageNumbers(new Set());
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setNearPageNumbers(new Set(Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1)));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setNearPageNumbers((current) => {
          let next = current;
          for (const entry of entries) {
            const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);
            if (!pageNumber || current.has(pageNumber) === entry.isIntersecting) continue;
            if (next === current) next = new Set(current);
            if (entry.isIntersecting) next.add(pageNumber);
            else next.delete(pageNumber);
          }
          return next;
        });
      },
      { root: viewportRef.current, rootMargin: "900px 0px" },
    );
    pageObserverRef.current = observer;
    pageElementsRef.current.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      if (pageObserverRef.current === observer) pageObserverRef.current = null;
    };
  }, [pdfDocument]);

  useEffect(() => {
    if (!pdfDocument || !normalizedQuery) return;
    let cancelled = false;
    const replacingIndex = !!textIndexDocumentRef.current && textIndexDocumentRef.current !== pdfDocument;
    const index =
      textIndexDocumentRef.current === pdfDocument
        ? textIndexRef.current
        : Array.from<PdfPageTextIndex | null>({ length: pdfDocument.numPages }).fill(null);
    const pagesToIndex = Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
    let nextPageIndex = 0;
    let completedPages = index.filter((entry) => entry !== null).length;
    const publishIndex = () => {
      textIndexRef.current = index;
      textIndexDocumentRef.current = pdfDocument;
      setIndexedPages(completedPages);
      setIndexRevision((revision) => revision + 1);
    };

    const commitProgress = () => {
      // Keep the active occurrence stable while a changed document is reindexed.
      if (cancelled || replacingIndex || indexingTimerRef.current) return;
      indexingTimerRef.current = window.setTimeout(() => {
        indexingTimerRef.current = 0;
        if (cancelled) return;
        publishIndex();
      }, 100);
    };

    const indexPages = async () => {
      while (!cancelled && nextPageIndex < pagesToIndex.length) {
        const pageNumber = pagesToIndex[nextPageIndex++];
        if (index[pageNumber - 1]) continue;
        try {
          const content = await getTextContent(pageNumber);
          if (cancelled) return;
          index[pageNumber - 1] = createPdfPageTextIndex(textItemsFromContent(content));
        } catch (error) {
          if (cancelled) return;
          console.warn(`Could not index text on PDF page ${pageNumber}:`, error);
          index[pageNumber - 1] = createPdfPageTextIndex([]);
        }
        completedPages += 1;
        commitProgress();
      }
    };

    void indexPages().then(() => {
      if (!cancelled) {
        if (indexingTimerRef.current) window.clearTimeout(indexingTimerRef.current);
        indexingTimerRef.current = 0;
        publishIndex();
      }
    });

    return () => {
      cancelled = true;
      if (indexingTimerRef.current) window.clearTimeout(indexingTimerRef.current);
      indexingTimerRef.current = 0;
    };
  }, [getTextContent, normalizedQuery, pdfDocument]);

  const recomputeFitScale = useCallback(
    (mode: Exclude<PdfViewerZoomMode, "custom">) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const pageCount = pdfDocument?.numPages ?? 0;
      const pageNumbers = spreadPageNumbers(currentPage, pageCount, spreadMode);
      const pageSizes = pageNumbers.map((pageNumber) => pageSizesRef.current.get(pageNumber) ?? firstPageSize);
      const spreadWidth = pageSizes.reduce((total, size) => total + size.width, 0);
      const spreadHeight = Math.max(...pageSizes.map((size) => size.height), firstPageSize.height);
      const availableWidth = viewport.clientWidth - PAGE_HORIZONTAL_PADDING - PAGE_GAP * (pageSizes.length - 1);
      const widthScale = availableWidth / spreadWidth;
      const nextScale =
        mode === "width"
          ? widthScale
          : Math.min(widthScale, (viewport.clientHeight - PAGE_VERTICAL_PADDING) / spreadHeight);
      const clamped = clampScale(nextScale);
      if (!almostEqual(scaleRef.current, clamped) && !pendingZoomAnchorRef.current) captureZoomAnchor();
      scaleRef.current = clamped;
      setScale((current) => (almostEqual(current, clamped) ? current : clamped));
    },
    [captureZoomAnchor, currentPage, firstPageSize, pageSizesRevision, pdfDocument?.numPages, spreadMode],
  );

  useLayoutEffect(() => {
    if (!pdfDocument || !viewportRef.current) return;
    const recomputeAfterResize = () => {
      if (document.body.classList.contains("pane-resizing") || zoomMode === "custom") return;
      recomputeFitScale(zoomMode);
    };
    recomputeAfterResize();
    // Sidebar transitions report a new size on every frame. Keep the existing
    // canvas during that motion and rasterize once the viewport has settled.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleFitAfterResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(recomputeAfterResize, 100);
    };
    const observer = new ResizeObserver(scheduleFitAfterResize);
    observer.observe(viewportRef.current);
    window.addEventListener("resize", scheduleFitAfterResize);
    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
      window.removeEventListener("resize", scheduleFitAfterResize);
    };
  }, [pdfDocument, recomputeFitScale, zoomMode]);

  const applyViewportAnchor = useCallback((anchor: NonNullable<typeof pendingZoomAnchorRef.current>) => {
    const viewport = viewportRef.current;
    if (!anchor || !viewport) return;
    const page = pagesRef.current?.querySelector<HTMLElement>(`[data-page-number="${anchor.pageNumber}"]`);
    if (!page) return;
    const viewportBounds = viewport.getBoundingClientRect();
    const pageBounds = page.getBoundingClientRect();
    if (pageBounds.width && pageBounds.height) {
      viewport.scrollLeft += pageBounds.left + pageBounds.width * anchor.pageX - viewportBounds.left - anchor.localX;
      viewport.scrollTop += pageBounds.top + pageBounds.height * anchor.pageY - viewportBounds.top - anchor.localY;
    } else {
      viewport.scrollLeft = page.offsetLeft + page.offsetWidth * anchor.pageX - anchor.localX;
      viewport.scrollTop = page.offsetTop + page.offsetHeight * anchor.pageY - anchor.localY;
    }
  }, []);

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    if (!anchor || !almostEqual(scale, scaleRef.current)) return;
    pendingZoomAnchorRef.current = null;
    applyViewportAnchor(anchor);
  }, [applyViewportAnchor, scale, pageSizesRevision, firstPageSize]);

  const useCustomScale = useCallback(
    (requestedScale: number, localX?: number, localY?: number) => {
      const oldScale = scaleRef.current;
      const nextScale = clampScale(requestedScale);
      if (almostEqual(oldScale, nextScale)) return;
      captureZoomAnchor(localX, localY);
      scaleRef.current = nextScale;
      setZoomMode("custom");
      setScale(nextScale);
    },
    [captureZoomAnchor],
  );

  const selectFitMode = (mode: Exclude<PdfViewerZoomMode, "custom">) => {
    setZoomMode(mode);
    recomputeFitScale(mode);
  };

  const handleNativeZoomShortcut = useCallback(
    (shortcut: ZoomShortcut) => {
      if (!hasShortcutFocusRef.current) return;
      if (shortcut === "in") useCustomScale(scaleRef.current * ZOOM_STEP);
      else if (shortcut === "out") useCustomScale(scaleRef.current / ZOOM_STEP);
      else {
        setZoomMode("width");
        recomputeFitScale("width");
      }
    },
    [recomputeFitScale, useCustomScale],
  );

  useEffect(() => window.api.onPdfZoomShortcut(handleNativeZoomShortcut), [handleNativeZoomShortcut]);

  const setShortcutFocus = useCallback((focused: boolean) => {
    if (hasShortcutFocusRef.current === focused) return;
    hasShortcutFocusRef.current = focused;
    window.api.setPdfViewerShortcutFocus(focused);
  }, []);

  const ownsViewerNode = useCallback(
    (target: EventTarget | null) => target instanceof Node && Boolean(viewerRef.current?.contains(target)),
    [],
  );

  useEffect(() => {
    const releaseShortcutFocus = (event: globalThis.PointerEvent) => {
      if (hasShortcutFocusRef.current && !ownsViewerNode(event.target)) setShortcutFocus(false);
    };
    document.addEventListener("pointerdown", releaseShortcutFocus, true);
    return () => {
      document.removeEventListener("pointerdown", releaseShortcutFocus, true);
      setShortcutFocus(false);
    };
  }, [ownsViewerNode, setShortcutFocus]);

  const claimShortcutFocus = (event: PointerEvent<HTMLElement>) => {
    if (!ownsViewerNode(event.target)) return;
    setShortcutFocus(true);
    if (
      !(event.target instanceof HTMLElement) ||
      event.target.closest("button, input, select, textarea, a[href], [contenteditable=true]") !== null
    )
      return;
    viewportRef.current?.focus({ preventScroll: true });
  };

  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    const results: SearchResult[] = [];
    textIndexRef.current.forEach((index, pageIndex) => {
      if (!index) return;
      for (const match of findPdfPageTextMatches(index, normalizedQuery)) {
        const pageNumber = pageIndex + 1;
        const sourceKey = match.itemRanges.map((range) => `${range.itemIndex}:${range.start}:${range.end}`).join("|");
        results.push({ key: `${pageNumber}:${sourceKey}`, pageNumber, ...match });
      }
    });
    return results;
  }, [indexRevision, normalizedQuery]);

  useEffect(() => setActiveResultKey(null), [normalizedQuery]);
  useEffect(() => {
    setActiveResultKey((current) => {
      if (!searchResults.length) return null;
      return current && searchResults.some((result) => result.key === current) ? current : searchResults[0].key;
    });
  }, [searchResults]);

  const activeResultIndex = Math.max(
    0,
    activeResultKey ? searchResults.findIndex((result) => result.key === activeResultKey) : 0,
  );

  const pageHighlights = useMemo(() => {
    const highlights = new Map<number, PageHighlight[]>();
    searchResults.forEach((result) => {
      const page = highlights.get(result.pageNumber) ?? [];
      page.push(
        ...result.itemRanges.map((range) => ({
          ...range,
          active: result.key === activeResultKey,
          resultKey: result.key,
        })),
      );
      highlights.set(result.pageNumber, page);
    });
    if (linkedSelection) {
      const page = highlights.get(linkedSelection.page) ?? [];
      page.push(
        ...linkedSelection.ranges.map((range) => ({
          ...range,
          active: false,
          reference: true,
          color: linkedSelection.color,
          resultKey: "linked-reference",
        })),
      );
      highlights.set(linkedSelection.page, page);
    }
    return highlights;
  }, [activeResultKey, linkedSelection, searchResults]);

  const scrollToPage = useCallback((pageNumber: number, behavior: ScrollBehavior = "auto") => {
    const viewport = viewportRef.current;
    const page = viewport?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
    if (!viewport || !page) return;
    initialPageAppliedRef.current = true;
    pendingZoomAnchorRef.current = null;
    const top = Math.max(0, page.offsetTop - 16);
    if (typeof viewport.scrollTo === "function") viewport.scrollTo({ top, behavior });
    else viewport.scrollTop = top;
    currentPageRef.current = pageNumber;
    setCurrentPage(pageNumber);
    setPageField(String(pageNumber));
  }, []);

  useLayoutEffect(() => {
    if (
      !pdfDocument ||
      restorableDocument !== pdfDocument ||
      initialPageAppliedRef.current ||
      latestNavigationRef.current ||
      !almostEqual(scale, scaleRef.current)
    )
      return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    initialPageAppliedRef.current = true;
    pendingZoomAnchorRef.current = null;
    scrollToPage(Math.min(pdfDocument.numPages, requestedInitialPage));
  }, [pdfDocument, restorableDocument, requestedInitialPage, scrollToPage, scale]);

  useEffect(() => {
    const subscription = ++navigationSubscriptionRef.current;
    const accept = () => {
      const request = claimPdfDeepLink(file.path, readerId, requestOwnerRef.current);
      if (!request || latestNavigationRef.current?.requestId === request.requestId) return;
      latestNavigationRef.current = request;
      setNavigationRequest(request);
      setNavigationError(null);
    };
    accept();
    window.addEventListener(PDF_DEEP_LINK_EVENT, accept);
    return () => {
      window.removeEventListener(PDF_DEEP_LINK_EVENT, accept);
      const current = latestNavigationRef.current;
      if (current?.path === file.path)
        queueMicrotask(() => {
          // React may replay setup immediately; only a real dismissal abandons its pending destination.
          if (
            navigationSubscriptionRef.current === subscription ||
            currentFileRef.current.path !== file.path ||
            currentReaderIdRef.current !== readerId
          )
            finishPdfDeepLink(current);
        });
      latestNavigationRef.current = null;
      setNavigationRequest(null);
      setNavigationError(null);
    };
  }, [file.path, readerId]);

  const activatePdfLink = useCallback(
    (annotation: PdfLinkAnnotation) => {
      const url = annotation.url ?? annotation.unsafeUrl;
      if (url) {
        void window.api.openExternalLink(url).then((result) => {
          if (!result.success) notifyError("Could not open PDF link", "The link was rejected or could not be opened.");
        });
        return;
      }
      if (!pdfDocument) return;
      if (annotation.action) {
        const actionPage =
          annotation.action === "FirstPage"
            ? 1
            : annotation.action === "LastPage"
              ? pdfDocument.numPages
              : annotation.action === "NextPage"
                ? Math.min(pdfDocument.numPages, currentPageRef.current + 1)
                : annotation.action === "PrevPage"
                  ? Math.max(1, currentPageRef.current - 1)
                  : null;
        if (actionPage) scrollToPage(actionPage);
        return;
      }
      if (!annotation.dest) return;
      void (async () => {
        try {
          const destination =
            typeof annotation.dest === "string" ? await pdfDocument.getDestination(annotation.dest) : annotation.dest;
          if (!Array.isArray(destination) || !destination.length) return;
          const target = destination[0];
          const pageIndex =
            typeof target === "number"
              ? target
              : await pdfDocument.getPageIndex(target as Parameters<typeof pdfDocument.getPageIndex>[0]);
          scrollToPage(pageIndex + 1);
        } catch (error) {
          notifyError("Could not follow PDF link", errorMessage(error));
        }
      })();
    },
    [notifyError, pdfDocument, scrollToPage],
  );

  const activateOutlineEntry = useCallback(
    (entry: PdfOutlineEntry) => {
      if (!pdfDocument || !entry.dest) return;
      void (async () => {
        try {
          const destination =
            typeof entry.dest === "string" ? await pdfDocument.getDestination(entry.dest) : entry.dest;
          if (!Array.isArray(destination) || !destination.length) return;
          const target = destination[0];
          const pageIndex =
            typeof target === "number"
              ? target
              : await pdfDocument.getPageIndex(target as Parameters<typeof pdfDocument.getPageIndex>[0]);
          scrollToPage(pageIndex + 1, "smooth");
        } catch (error) {
          notifyError("Could not open outline item", errorMessage(error));
        }
      })();
    },
    [notifyError, pdfDocument, scrollToPage],
  );

  const previousSpreadModeRef = useRef(spreadMode);
  useLayoutEffect(() => {
    const changed = previousSpreadModeRef.current !== spreadMode;
    previousSpreadModeRef.current = spreadMode;
    if (pdfDocument && changed) scrollToPage(currentPageRef.current, "auto");
  }, [pdfDocument, scrollToPage, spreadMode]);

  useEffect(() => {
    const activeResult = searchResults.find((result) => result.key === activeResultKey);
    if (!activeResult) {
      lastScrolledResultRef.current = "";
      return;
    }
    const resultKey = activeResult.key;
    if (lastScrolledResultRef.current === resultKey) return;
    lastScrolledResultRef.current = resultKey;
    scrollToPage(activeResult.pageNumber);

    const viewport = viewportRef.current;
    const pages = pagesRef.current;
    if (!viewport || !pages) return;

    const scrollToHighlight = () => {
      const mark = Array.from(pages.querySelectorAll<HTMLElement>(".pdf-search-highlight-active")).find(
        (candidate) => candidate.dataset.searchResultKey === resultKey,
      );
      if (!mark) return false;
      const viewportBounds = viewport.getBoundingClientRect();
      const markBounds = mark.getBoundingClientRect();
      viewport.scrollTop = Math.max(
        0,
        viewport.scrollTop + markBounds.top - viewportBounds.top - viewport.clientHeight / 2 + markBounds.height / 2,
      );
      return true;
    };

    if (scrollToHighlight()) return;
    const observer = new MutationObserver(() => {
      if (scrollToHighlight()) observer.disconnect();
    });
    observer.observe(pages, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 2_000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [activeResultKey, scrollToPage, searchResults]);

  useEffect(() => {
    const request = navigationRequest;
    if (!request || request.path !== file.path || !pdfDocument || loadedSourceRevisionRef.current !== sourceRevision)
      return;
    const generation = currentFileRef.current.generation;
    let cancelled = false;
    let frame = 0;
    const current = () =>
      !cancelled &&
      currentFileRef.current.generation === generation &&
      latestNavigationRef.current?.requestId === request.requestId;
    const complete = () => {
      if (!current()) return;
      finishPdfDeepLink(request);
      latestNavigationRef.current = null;
      setNavigationRequest(null);
      setNavigationError(null);
    };
    const targetPage = Math.min(pdfDocument.numPages, Math.max(1, request.page));
    // Explicit destinations supersede restoration, even when loading finishes later.
    initialPageAppliedRef.current = true;
    setLinkedSelection(null);
    void getPage(targetPage)
      .then(async (page) => {
        if (!current()) return;
        const size = page.getViewport({ scale: 1 });
        recordPageSize(targetPage, { width: size.width, height: size.height });
        setNearPageNumbers((pages) => new Set([...pages, targetPage]));
        let selectionRanges: PdfItemMatchRange[] | null = null;
        if (request.invalidSelection)
          notifyError("PDF selection unavailable", "The link contains an invalid text range.");
        if (request.selection) {
          try {
            const content = await getTextContent(targetPage);
            if (!current()) return;
            const resolved = resolvePdfTextSelectionRanges(request.selection, textItemsFromContent(content));
            if (resolved) selectionRanges = resolved.ranges;
            else notifyError("PDF selection unavailable", "The linked text range no longer exists on this page.");
          } catch (error) {
            if (!current()) return;
            notifyError("PDF selection unavailable", errorMessage(error));
          }
        }
        const navigate = () => {
          if (!current()) return;
          const viewport = viewportRef.current;
          const pages = pagesRef.current;
          if (!viewport || !pages || !pages.querySelector(`[data-page-number="${targetPage}"]`)) return;
          scrollToPage(targetPage);
          if (selectionRanges)
            setLinkedSelection({ page: targetPage, ranges: selectionRanges, color: request.color ?? "yellow" });
          complete();
        };
        frame = window.requestAnimationFrame(navigate);
      })
      .catch((error) => {
        if (current()) setNavigationError(`The linked page could not be opened: ${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [
    file.path,
    getPage,
    getTextContent,
    navigationAttempt,
    navigationRequest,
    notifyError,
    pdfDocument,
    recordPageSize,
    scrollToPage,
    sourceRevision,
  ]);

  useEffect(() => {
    if (!linkedSelection) return;
    const viewport = viewportRef.current;
    const page = pageElementsRef.current.get(linkedSelection.page);
    if (!viewport || !page) return;
    const firstItem = linkedSelection.ranges[0]?.itemIndex;
    let positioned = false;
    const position = () => {
      if (positioned || firstItem === undefined) return;
      const target = page.querySelector<HTMLElement>(`.pdf-page-text [data-pdf-text-item-index="${firstItem}"]`);
      if (!target) return;
      positioned = true;
      const top = Math.max(0, page.offsetTop + target.offsetTop - viewport.clientHeight / 3);
      if (typeof viewport.scrollTo === "function") viewport.scrollTo({ top, behavior: "auto" });
      else viewport.scrollTop = top;
    };
    position();
    if (positioned) return;
    const observer = new MutationObserver(position);
    observer.observe(page, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 2_000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [linkedSelection]);

  const moveSearchResult = (direction: 1 | -1) => {
    if (!searchResults.length) return;
    const nextIndex = (activeResultIndex + direction + searchResults.length) % searchResults.length;
    setActiveResultKey(searchResults[nextIndex].key);
  };

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
    searchInputRef.current?.focus();
  }, []);

  const closeSearch = useCallback((restoreViewerFocus = false) => {
    setIsSearchOpen(false);
    setQuery("");
    if (restoreViewerFocus) window.setTimeout(() => viewportRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!isSearchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [isSearchOpen]);

  const updateCurrentPage = useCallback(() => {
    const viewport = viewportRef.current;
    const pages = pagesRef.current?.children;
    if (!viewport || !pages?.length || !initialPageAppliedRef.current) return;
    const viewportCenter = viewport.scrollTop + viewport.clientHeight / 2;
    const trackedPage = currentPageRef.current;
    let nearestPage = trackedPage;
    const currentPageElement = pageElementsRef.current.get(trackedPage);
    let nearestDistance = currentPageElement
      ? Math.abs(currentPageElement.offsetTop + currentPageElement.offsetHeight / 2 - viewportCenter)
      : Number.POSITIVE_INFINITY;

    let low = 0;
    let high = pages.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const page = pages.item(middle) as HTMLElement | null;
      if (page && page.offsetTop <= viewportCenter) low = middle + 1;
      else high = middle - 1;
    }

    const candidateStart = Math.max(0, high - 3);
    const candidateEnd = Math.min(pages.length - 1, low + 3);
    for (let index = candidateStart; index <= candidateEnd; index += 1) {
      const page = pages.item(index) as HTMLElement | null;
      if (!page) continue;
      const pageCenter = page.offsetTop + page.offsetHeight / 2;
      const distance = Math.abs(pageCenter - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = Number(page.dataset.pageNumber);
      }
    }
    if (nearestPage !== trackedPage) {
      currentPageRef.current = nearestPage;
      setCurrentPage(nearestPage);
      setPageField(String(nearestPage));
    }
  }, []);

  const handleViewportScroll = () => {
    if (pageTrackingTimerRef.current) return;
    pageTrackingTimerRef.current = window.setTimeout(() => {
      pageTrackingTimerRef.current = 0;
      updateCurrentPage();
    }, PAGE_TRACK_INTERVAL_MS);
  };

  useEffect(
    () => () => {
      if (pageTrackingTimerRef.current) window.clearTimeout(pageTrackingTimerRef.current);
    },
    [],
  );

  const submitPageField = () => {
    if (!pdfDocument) return;
    const pageNumber = Math.min(pdfDocument.numPages, Math.max(1, Number.parseInt(pageField, 10) || currentPage));
    scrollToPage(pageNumber);
  };

  const handleKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openSearch();
      return;
    }
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")
    )
      return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      useCustomScale(scaleRef.current * ZOOM_STEP);
    } else if (event.key === "-") {
      event.preventDefault();
      useCustomScale(scaleRef.current / ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      selectFitMode("width");
    } else if (event.key === "ArrowLeft" && pdfDocument && currentPage > 1) {
      event.preventDefault();
      scrollToPage(currentPage - 1);
    } else if (event.key === "ArrowRight" && pdfDocument && currentPage < pdfDocument.numPages) {
      event.preventDefault();
      scrollToPage(currentPage + 1);
    }
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = viewport.getBoundingClientRect();
      const multiplier = Math.exp(-event.deltaY * 0.0025);
      useCustomScale(scaleRef.current * multiplier, event.clientX - bounds.left, event.clientY - bounds.top);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [useCustomScale]);

  const openExternal = async () => {
    const result = await openInDefaultApp(file.path);
    if (!result.success) notifyError("Could not open PDF", result.error);
  };
  const retry = () => {
    setLoadError(null);
    setReloadRevision((revision) => revision + 1);
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    if (!password || !passwordCallbackRef.current) return;
    const callback = passwordCallbackRef.current;
    passwordCallbackRef.current = null;
    setPasswordRequest(null);
    callback(password);
    setPassword("");
  };

  const pageCount = pdfDocument?.numPages ?? 0;
  const activeResult = searchResults[activeResultIndex];
  const progressPercent =
    loadProgress?.total && loadProgress.total > 0 ? Math.round((loadProgress.loaded / loadProgress.total) * 100) : null;
  const activateReference = useCallback((reference: PdfNoteReference, anchor: HTMLElement) => {
    setSelectedText(null);
    setReferenceCopied(false);
    setNotesExpanded(false);
    setActiveAnnotation({ reference, bounds: anchor.getBoundingClientRect() });
  }, []);
  const renderedPages = useMemo(() => {
    if (!pdfDocument) return null;
    return Array.from({ length: pdfDocument.numPages }, (_, index) => {
      const pageNumber = index + 1;
      const pageReferences = referencesByPage.get(pageNumber) ?? NO_REFERENCES;
      const matchingIndexes = hoveredReference
        ? pageReferences.flatMap((reference, referenceIndex) =>
            reference.notePath === hoveredReference.notePath && reference.destination === hoveredReference.destination
              ? [referenceIndex]
              : [],
          )
        : NO_HOVERED_REFERENCES;
      return (
        <PDFPage
          key={pageNumber}
          pageNumber={pageNumber}
          externalRetryRevision={navigationAttempt}
          scale={scale}
          fallbackSize={pageSizesRef.current.get(pageNumber) ?? firstPageSize}
          getPage={getPage}
          getTextContent={getTextContent}
          highlights={pageHighlights.get(pageNumber) ?? NO_HIGHLIGHTS}
          references={pageReferences}
          hoveredReferenceIndexes={matchingIndexes.length ? matchingIndexes : NO_HOVERED_REFERENCES}
          onActivateReference={activateReference}
          onPageSize={recordPageSize}
          evictPage={evictPage}
          renderQueue={renderQueueRef.current}
          scrollRootRef={viewportRef}
          activateLink={activatePdfLink}
          isNearViewport={nearPageNumbers.has(pageNumber)}
          registerPageElement={registerPageElement}
        />
      );
    });
  }, [
    activatePdfLink,
    activateReference,
    evictPage,
    firstPageSize,
    getPage,
    getTextContent,
    nearPageNumbers,
    navigationAttempt,
    pageSizesRevision,
    pageHighlights,
    referencesByPage,
    hoveredReference,
    pdfDocument,
    recordPageSize,
    registerPageElement,
    scale,
  ]);

  const toolbar = (
    <header className="pdf-viewer-toolbar">
      <span className="pdf-viewer-outline-trigger" title={outline.length ? undefined : "No contents in this PDF"}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!pdfDocument || !outline.length}
          aria-label={
            outline.length ? (outlineOpen ? "Hide document outline" : "Show document outline") : "No document contents"
          }
          title={outline.length ? (outlineOpen ? "Hide document outline" : "Show document outline") : undefined}
          aria-pressed={outlineOpen}
          onClick={() => setOutlineOpen((open) => !open)}
        >
          <IconListUnordered size={14} aria-hidden="true" />
        </Button>
      </span>
      <div className="pdf-viewer-page-controls" aria-label="Page navigation">
        <Button
          className="pdf-viewer-page-step"
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!pdfDocument || currentPage <= 1}
          onClick={() => scrollToPage(currentPage - 1)}
          aria-label="Previous page"
          title="Previous page"
        >
          <IconChevron size={14} className="rotate-90" aria-hidden="true" />
        </Button>
        <input
          className="pdf-viewer-page-input"
          aria-label="Page number"
          inputMode="numeric"
          value={pageField}
          disabled={!pdfDocument}
          onChange={(event) => setPageField(event.target.value.replace(/\D/gu, ""))}
          onBlur={submitPageField}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitPageField();
              event.currentTarget.blur();
            }
          }}
        />
        <span className="pdf-viewer-page-count">/ {pageCount || "—"}</span>
        <Button
          className="pdf-viewer-page-step"
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!pdfDocument || currentPage >= pageCount}
          onClick={() => scrollToPage(currentPage + 1)}
          aria-label="Next page"
          title="Next page"
        >
          <IconChevron size={14} className="-rotate-90" aria-hidden="true" />
        </Button>
      </div>

      <div className="pdf-viewer-toolbar-spacer" />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!pdfDocument}
        aria-label={isSearchOpen ? "Focus document search" : "Search document"}
        title={isSearchOpen ? "Focus document search" : "Search document"}
        onClick={openSearch}
      >
        <IconSearch size={14} aria-hidden="true" />
      </Button>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={!pdfDocument}
            aria-label={`View settings, zoom ${Math.round(scale * 100)} percent`}
            title={`View settings, zoom ${Math.round(scale * 100)} percent`}
          >
            <>
              <span className="pdf-viewer-zoom-value" aria-live="polite">
                {Math.round(scale * 100)}%
              </span>
              <IconChevron size={12} aria-hidden="true" />
            </>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>Zoom</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={scale >= MAX_SCALE}
            onSelect={(event) => {
              event.preventDefault();
              useCustomScale(scaleRef.current * ZOOM_STEP);
            }}
          >
            <IconPlus aria-hidden="true" />
            Zoom in
            <DropdownMenuShortcut aria-hidden="true">+</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={scale <= MIN_SCALE}
            onSelect={(event) => {
              event.preventDefault();
              useCustomScale(scaleRef.current / ZOOM_STEP);
            }}
          >
            <IconMinus aria-hidden="true" />
            Zoom out
            <DropdownMenuShortcut aria-hidden="true">−</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={zoomMode === "custom" && almostEqual(scale, 1) ? "actual" : zoomMode}
            onValueChange={(value) => {
              if (value === "width" || value === "page") selectFitMode(value);
              else useCustomScale(1);
            }}
          >
            <DropdownMenuRadioItem value="width">Fit width</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="page">Fit page</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="actual">Actual size</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Page layout</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={spreadMode}
            onValueChange={(value) => setSpreadMode(value as PdfViewerSpreadMode)}
          >
            <DropdownMenuRadioItem value="none">No spreads</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="odd">Odd spreads</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="even">Even spreads</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );

  const passwordForm = passwordRequest ? (
    <form className={pdfDocument ? "pdf-viewer-navigation" : "pdf-viewer-message"} onSubmit={submitPassword}>
      <strong>
        {passwordRequest === "incorrect" ? "That password was not accepted" : "This PDF is password protected"}
      </strong>
      <span>Enter the document password to continue.</span>
      <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-label="PDF password"
        autoFocus
      />
      <Button type="submit" disabled={!password}>
        Unlock PDF
      </Button>
    </form>
  ) : null;

  return (
    <section
      ref={viewerRef}
      className="pdf-viewer"
      tabIndex={-1}
      aria-label={`PDF viewer for ${file.filename}`}
      onPointerDownCapture={claimShortcutFocus}
      onPointerUpCapture={(event) => {
        if (event.target instanceof Element && event.target.closest(".pdf-page")) captureSelection();
      }}
      onKeyUpCapture={(event) => {
        if (event.shiftKey && ownsViewerNode(event.target)) captureSelection();
      }}
      onFocusCapture={(event) => {
        if (ownsViewerNode(event.target)) setShortcutFocus(true);
      }}
      onBlurCapture={(event) => {
        if (!ownsViewerNode(event.relatedTarget)) setShortcutFocus(false);
      }}
      onKeyDownCapture={handleKeyboard}
    >
      {toolbar}
      <Popover
        open={Boolean(activeAnnotation || selectedText)}
        onOpenChange={(open) => {
          if (!open) {
            setActiveAnnotation(null);
            setSelectedText(null);
            setNotesExpanded(false);
          }
        }}
      >
        {annotationAnchor ? <PopoverAnchor virtualRef={annotationAnchor} /> : null}
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          size="auto"
          className="pdf-viewer-reference-popover"
          data-selection-only={selectedText && !activeAnnotation ? "" : undefined}
          aria-label={activeAnnotation ? "PDF reference actions" : "Copy PDF reference with color"}
        >
          <div className="pdf-viewer-reference-popover-actions">
            {activeAnnotation ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="pdf-viewer-reference-copy"
                onClick={() => void copySavedReference()}
                aria-label="Copy PDF selection reference"
              >
                <IconCopy size={14} aria-hidden="true" />
                {referenceCopied ? "Copied" : "Copy reference"}
              </Button>
            ) : null}
            <ColorSwatches
              label={activeAnnotation ? "Reference color" : "Copy reference with color"}
              disabled={annotationBusy}
              value={activeAnnotation?.reference.color}
              options={(["yellow", "green", "blue", "purple", "red"] as const).map((color) => ({
                id: color,
                label: activeAnnotation ? color : `Copy ${color} reference`,
                color: `var(--reference-${color})`,
              }))}
              onChange={(color) => void (activeAnnotation ? changeReferenceColor(color) : copySelectedReference(color))}
            />
          </div>
          {activeAnnotation && referencingNotes.length > 0 ? (
            <div className="pdf-viewer-reference-notes">
              <button
                type="button"
                className="pdf-viewer-reference-notes-toggle"
                aria-expanded={notesExpanded}
                aria-controls={notesExpanded ? notesListId : undefined}
                onClick={() => setNotesExpanded((expanded) => !expanded)}
              >
                <IconFileText size={15} aria-hidden="true" />
                <span>Referenced in</span>
                <span className="pdf-viewer-reference-notes-count">{referencingNotes.length}</span>
                <IconChevron size={14} className={notesExpanded ? "" : "-rotate-90"} aria-hidden="true" />
              </button>
              {notesExpanded ? (
                <ul id={notesListId}>
                  {referencingNotes.map(({ note, path }) => (
                    <li key={note.path}>
                      <button
                        type="button"
                        className="pdf-viewer-reference-note"
                        title={path}
                        aria-label={`Open note ${path}`}
                        onClick={() => {
                          void open(note, { openInNewTab: true, focusEditor: true }).then((opened) => {
                            if (opened) setActiveAnnotation(null);
                            else notifyError("Could not open note", path);
                          });
                        }}
                      >
                        <span className="pdf-viewer-reference-note-icon">
                          <IconFileText size={16} aria-hidden="true" />
                        </span>
                        <span className="pdf-viewer-reference-note-text">
                          <span>{note.path.replace(/\\/g, "/").split("/").at(-1)}</span>
                          <small>{path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "Workspace root"}</small>
                        </span>
                        <IconArrowUpRight size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {pdfDocument ? passwordForm : null}
      {pdfDocument && loadError ? (
        <div className="pdf-viewer-navigation" role="alert">
          <span>PDF refresh failed. The previous version is still displayed.</span>
          <span>{loadError}</span>
          <Button type="button" size="xs" variant="outline" onClick={retry}>
            Retry refresh
          </Button>
        </div>
      ) : null}
      {navigationRequest && pdfDocument && !loadError ? (
        <div className="pdf-viewer-navigation" role={navigationError ? "alert" : "status"}>
          <span>{navigationError ?? "Opening the linked page…"}</span>
          {navigationError ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => {
                evictPage(Math.min(pdfDocument.numPages, navigationRequest.page));
                setNavigationError(null);
                setNavigationAttempt((attempt) => attempt + 1);
              }}
            >
              Retry link
            </Button>
          ) : null}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              finishPdfDeepLink(navigationRequest);
              latestNavigationRef.current = null;
              setNavigationRequest(null);
              setNavigationError(null);
            }}
          >
            Stay on this page
          </Button>
        </div>
      ) : null}
      <div className="pdf-viewer-body">
        {isSearchOpen ? (
          <DocumentFindBar
            inputRef={searchInputRef}
            query={query}
            onQueryChange={setQuery}
            disabled={!pdfDocument}
            canNavigate={!!activeResult}
            resultLabel={
              searchResults.length
                ? `${activeResultIndex + 1} / ${searchResults.length}`
                : indexedPages < pageCount
                  ? "Searching…"
                  : "No results"
            }
            onPrevious={() => moveSearchResult(-1)}
            onNext={() => moveSearchResult(1)}
            onClose={() => closeSearch(true)}
          />
        ) : null}
        {outline.length && outlineOpen ? (
          <aside className="pdf-viewer-outline" aria-label="Document outline">
            <header>
              <strong>Contents</strong>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close document outline"
                onClick={() => setOutlineOpen(false)}
              >
                <IconX size={13} aria-hidden="true" />
              </Button>
            </header>
            <nav>
              {outline.map((entry, index) => (
                <button
                  key={`${entry.depth}:${entry.title}:${index}`}
                  type="button"
                  disabled={!entry.dest}
                  style={{ paddingInlineStart: `${10 + Math.min(entry.depth, 5) * 12}px` }}
                  onClick={() => activateOutlineEntry(entry)}
                  title={entry.title}
                >
                  {entry.title}
                </button>
              ))}
            </nav>
          </aside>
        ) : null}
        <div
          ref={viewportRef}
          className="pdf-viewer-viewport"
          tabIndex={0}
          aria-label="PDF pages. Hold Control or Command and scroll to zoom."
          onScroll={handleViewportScroll}
        >
          {passwordRequest && !pdfDocument ? (
            passwordForm
          ) : loadError && !pdfDocument ? (
            <div className="pdf-viewer-message" role="alert">
              <strong>PDF could not be opened</strong>
              <span>{loadError}</span>
              <div className="pdf-viewer-message-actions">
                <Button type="button" variant="outline" onClick={retry}>
                  <IconRefresh size={14} />
                  Retry
                </Button>
                <Button type="button" onClick={() => void openExternal()}>
                  Open externally
                </Button>
              </div>
            </div>
          ) : !pdfDocument ? (
            <div className="pdf-viewer-message" role="status">
              <strong>Opening PDF…</strong>
              <span>
                {progressPercent !== null
                  ? `${progressPercent}% · ${formatBytes(loadProgress?.loaded ?? 0)}`
                  : loadingTask
                    ? "Reading document"
                    : "Preparing viewer"}
              </span>
              {progressPercent !== null ? (
                <progress max={100} value={progressPercent} aria-label="PDF loading progress" />
              ) : null}
            </div>
          ) : (
            <div
              ref={pagesRef}
              className="pdf-viewer-pages"
              data-spread-mode={spreadMode}
              style={{ "--pdf-scale": String(scale) } as CSSProperties}
            >
              {renderedPages}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default PDFViewer;
