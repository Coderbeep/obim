import { Facet } from "@codemirror/state";
import { RangeSetBuilder, StateEffect, StateField } from "@renderer/features/editor/codemirror-state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@renderer/features/editor/codemirror-view";
import type { DecorationSet, ViewUpdate } from "@renderer/features/editor/codemirror-view";
import type { EditorOverlayPort } from "@renderer/store/editorOverlayStore";
import { imageSourceUrl, isRemoteImageSource } from "@renderer/features/files/imageSource";
import { createEditorOverlayController } from "./shared/EditorOverlay";
import {
  markdownImagesInText,
  wikiImagesInText,
  type MarkdownImageInfo,
  type WikiImageInfo,
} from "./shared/OverlayMarkdown";
import { createBufferedViewport } from "./shared/bufferedViewport";
import type { DocumentRange } from "./shared/documentRange";
import { ancestorNodeAt, blockquoteDepthClass, selectSyntaxRange } from "./shared/syntaxDecorationPlugin";

export interface ImageActions {
  resolveSource(src: string, syntax: "markdown" | "wiki"): string | null;
  open(src: string): void;
  contextMenu(event: MouseEvent, src: string, edit: () => void, remove: () => void): void;
}
const imageActions = Facet.define<ImageActions, ImageActions | undefined>({ combine: (values) => values[0] });

const ImageViewportMinBuffer = 1200;
const ImageViewportMaxBuffer = 3600;
const ImageViewportBufferMultiplier = 1.5;
const ImageMarkdownMaxLines = 8;
const ImageLoadCacheLimit = 256;

const imageViewport = createBufferedViewport({
  minBuffer: ImageViewportMinBuffer,
  maxBuffer: ImageViewportMaxBuffer,
  multiplier: ImageViewportBufferMultiplier,
});

const refreshImageDecorationsEffect = StateEffect.define<string>();
const ImageSyntaxDecoration = Decoration.mark({ class: "cm-formatting-image-mark" });
const ImageAltDecoration = Decoration.mark({ class: "cm-formatting-image-alt" });
const ImageTargetDecoration = Decoration.mark({ class: "cm-formatting-image-target" });

type ImageLoadState =
  { status: "loading" } | { status: "loaded"; width: number; height: number } | { status: "missing" };

type ImageInfo = (MarkdownImageInfo & { syntax: "markdown" }) | (WikiImageInfo & { syntax: "wiki" });

interface ImageDecorationState {
  decorations: DecorationSet;
  ready: boolean;
}

const imageLoadCache = new Map<string, ImageLoadState>();
const pendingImageViews = new Map<string, Set<EditorView>>();
const scheduledRefreshViews = new Set<EditorView>();
let refreshFrame: number | null = null;

function imageLoadKey(src: string) {
  const config = typeof window === "undefined" ? undefined : window.config;
  const workspace = config?.getMainDirectoryPathSync().replace(/\\/g, "/") ?? "";
  return isRemoteImageSource(src) ? `remote\0${src}` : `workspace\0${workspace}\0${src}`;
}

function setImageLoadState(key: string, state: ImageLoadState) {
  if (imageLoadCache.has(key)) imageLoadCache.delete(key);
  imageLoadCache.set(key, state);

  // ponytail: FIFO cap; replace with real LRU only if image cache churn becomes measurable.
  while (imageLoadCache.size > ImageLoadCacheLimit) {
    const oldest = imageLoadCache.keys().next().value;
    if (oldest === undefined) break;
    imageLoadCache.delete(oldest);
  }
}

function invalidateImageLoad(src: string) {
  imageLoadCache.delete(imageLoadKey(src));
}

function imageStateKey(state: ImageLoadState | null) {
  if (!state) return "new";
  if (state.status !== "loaded") return state.status;
  return `${state.width}x${state.height}`;
}

function refreshImageViews(key: string) {
  const views = pendingImageViews.get(key);
  pendingImageViews.delete(key);
  if (!views) return;

  for (const view of views) {
    if (view.dom.isConnected) scheduleImageRefresh(view);
  }
}

function scheduleImageRefresh(view: EditorView) {
  if (!view.dom.isConnected) return;

  scheduledRefreshViews.add(view);
  if (refreshFrame !== null) return;

  refreshFrame = requestAnimationFrame(() => {
    refreshFrame = null;
    const views = Array.from(scheduledRefreshViews);
    scheduledRefreshViews.clear();

    for (const scheduledView of views) {
      if (!scheduledView.dom.isConnected) continue;
      scheduledView.dispatch({ effects: refreshImageDecorationsEffect.of("image-load") });
    }
  });
}

function cleanupImageView(view: EditorView) {
  scheduledRefreshViews.delete(view);

  for (const [src, views] of pendingImageViews) {
    views.delete(view);
    if (!views.size) pendingImageViews.delete(src);
  }
}

function trackImageView(key: string, view: EditorView) {
  if (!view.dom.isConnected) return;

  let views = pendingImageViews.get(key);
  if (!views) {
    views = new Set();
    pendingImageViews.set(key, views);
  }
  views.add(view);
}

function hasConnectedImageView(key: string) {
  const views = pendingImageViews.get(key);
  if (!views) return false;

  for (const view of views) {
    if (view.dom.isConnected) return true;
  }

  pendingImageViews.delete(key);
  return false;
}

function startImageLoad(src: string, key: string) {
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    setImageLoadState(key, {
      status: "loaded",
      width: Math.max(1, image.naturalWidth || image.width),
      height: Math.max(1, image.naturalHeight || image.height),
    });
    refreshImageViews(key);
  };
  image.onerror = () => {
    setImageLoadState(key, { status: "missing" });
    refreshImageViews(key);
  };
  image.src = imageSourceUrl(src);
}

function scheduleImageLoad(src: string, key: string) {
  const run = () => {
    if (imageLoadCache.get(key)?.status !== "loading") return;
    if (!hasConnectedImageView(key)) {
      imageLoadCache.delete(key);
      return;
    }
    startImageLoad(src, key);
  };

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run);
    return;
  }

  window.setTimeout(run, 16);
}

function ensureImageLoaded(src: string, view: EditorView) {
  const key = imageLoadKey(src);
  const current = imageLoadCache.get(key);
  if (current) {
    if (current.status === "loading") trackImageView(key, view);
    return;
  }

  if (!view.dom.isConnected) {
    return;
  }

  trackImageView(key, view);
  setImageLoadState(key, { status: "loading" });
  scheduleImageLoad(src, key);
}

class ImageWidget extends WidgetType {
  private readonly stateKey: string;

  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly src: string,
    private readonly resolvedSrc: string | null,
    private readonly alt: string,
    private readonly loadState: ImageLoadState | null,
    private readonly prefixColumns: number,
    private readonly quoteDepth: number,
  ) {
    super();
    this.stateKey = imageStateKey(loadState);
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "cm-image-widget";
    container.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
    });
    container.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.state.facet(imageActions)?.open(this.resolvedSrc ?? this.src);
    });
    container.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.state.facet(imageActions)?.contextMenu(
        event,
        this.resolvedSrc ?? this.src,
        () => selectImageSyntax(view, this.from, this.to),
        () => view.dispatch({ changes: { from: this.from, to: this.to }, userEvent: "delete" }),
      );
    });

    if (this.quoteDepth) {
      container.classList.add("cm-blockquote-line", blockquoteDepthClass(this.quoteDepth));
    }
    if (this.prefixColumns) {
      container.style.paddingLeft = this.quoteDepth
        ? `calc(0.9rem + ${this.prefixColumns}ch)`
        : `${this.prefixColumns}ch`;
    }

    if (this.loadState?.status === "loaded") {
      const frame = document.createElement("div");
      frame.className = "cm-image-frame";
      frame.tabIndex = 0;
      frame.setAttribute("role", "button");
      frame.setAttribute("aria-label", `Open image viewer for ${this.alt || this.src}`);
      frame.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        view.state.facet(imageActions)?.open(this.resolvedSrc ?? this.src);
      });
      frame.style.aspectRatio = `${this.loadState.width} / ${this.loadState.height}`;

      const image = document.createElement("img");
      image.src = imageSourceUrl(this.resolvedSrc ?? this.src);
      image.alt = this.alt;
      image.width = this.loadState.width;
      image.height = this.loadState.height;
      image.decoding = "async";
      image.loading = "lazy";

      frame.appendChild(image);
      container.appendChild(frame);
    } else {
      if (this.resolvedSrc) ensureImageLoaded(this.resolvedSrc, view);

      container.classList.add(this.loadState?.status === "missing" ? "cm-image-error" : "cm-image-loading");
      container.textContent =
        this.loadState?.status === "missing" ? `Image '${this.src}' not found` : `Loading image '${this.src}'`;
    }

    const source = document.createElement("button");
    source.type = "button";
    source.className = "cm-image-source";
    source.title = "Edit image source";
    source.setAttribute("aria-label", "Edit image source");
    source.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/></svg>';
    source.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectImageSyntax(view, this.from, this.to);
    });
    container.appendChild(source);
    return container;
  }

  eq(other: ImageWidget) {
    return (
      this.from === other.from &&
      this.to === other.to &&
      this.src === other.src &&
      this.resolvedSrc === other.resolvedSrc &&
      this.alt === other.alt &&
      this.stateKey === other.stateKey &&
      this.prefixColumns === other.prefixColumns &&
      this.quoteDepth === other.quoteDepth
    );
  }
}

export function selectImageSyntax(view: EditorView, from: number, to: number) {
  selectSyntaxRange(view, from, to);
}

function isContainerOnly(text: string) {
  return /^[\s>]*(?:(?:[-+*]|\d+[.)])\s*)?(?:\[[ xX]\]\s*)?$/.test(text);
}

export function imageWidgetPrefixColumns(state: EditorView["state"], image: ImageInfo) {
  const line = state.doc.lineAt(image.from);
  const prefix = state.doc.sliceString(line.from, image.from);
  return isContainerOnly(prefix) ? image.prefixColumns : 0;
}

function imageMarkdownTextFromLine(state: EditorView["state"], lineStart: number) {
  const firstLine = state.doc.lineAt(lineStart);
  let endLine = firstLine;

  const lastLineNumber = Math.min(state.doc.lines, firstLine.number + ImageMarkdownMaxLines - 1);
  for (let lineNumber = firstLine.number + 1; lineNumber <= lastLineNumber; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (!line.text.trim()) break;

    endLine = line;
    if (line.text.includes(")")) break;
  }

  return {
    from: firstLine.from,
    to: endLine.to,
    text: state.doc.sliceString(firstLine.from, endLine.to),
  };
}

function imagesFromLineStart(state: EditorView["state"], lineStart: number, selection: DocumentRange | null) {
  const firstLine = state.doc.lineAt(lineStart);
  const markdown = imageMarkdownTextFromLine(state, lineStart);

  return [
    ...markdownImagesInText(markdown.text, markdown.from, selection, state).map((image): ImageInfo => ({
      ...image,
      syntax: "markdown",
    })),
    ...wikiImagesInText(markdown.text, markdown.from, selection).map((image): ImageInfo => ({
      ...image,
      syntax: "wiki",
    })),
  ]
    .filter(
      (image) => image.from >= firstLine.from && image.from <= firstLine.to && !isInCodeSyntax(state, image.from + 1),
    )
    .sort((left, right) => left.from - right.from);
}

function imageLineStartsInRange(state: EditorView["state"], from: number, to: number) {
  const starts: number[] = [];
  const startLine = state.doc.lineAt(Math.max(0, from));
  const endLine = state.doc.lineAt(Math.min(state.doc.length, to));

  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (!line.text.includes("![")) continue;
    if (isInCodeBlock(state, line.from)) continue;

    starts.push(line.from);
  }

  return starts;
}

function isInCodeBlock(state: EditorView["state"], position: number) {
  return Boolean(ancestorNodeAt(state, position, ["FencedCode", "CodeBlock"], 1));
}

function isInCodeSyntax(state: EditorView["state"], position: number) {
  return Boolean(ancestorNodeAt(state, position, ["InlineCode", "FencedCode", "CodeBlock"], 1));
}

function addImageRange(builder: RangeSetBuilder<Decoration>, from: number, to: number, decoration: Decoration) {
  if (from < to) builder.add(from, to, decoration);
}

function addActiveImageSyntax(builder: RangeSetBuilder<Decoration>, image: ImageInfo) {
  if (image.syntax === "wiki") {
    addImageRange(builder, image.from, image.srcFrom, ImageSyntaxDecoration);
    addImageRange(builder, image.srcFrom, image.srcTo, ImageTargetDecoration);
    if (image.modifierFrom !== null && image.modifierTo !== null) {
      addImageRange(builder, image.srcTo, image.modifierFrom + 1, ImageSyntaxDecoration);
      addImageRange(builder, image.modifierFrom + 1, image.modifierTo, ImageAltDecoration);
      addImageRange(builder, image.modifierTo, image.to, ImageSyntaxDecoration);
    } else {
      addImageRange(builder, image.srcTo, image.to, ImageSyntaxDecoration);
    }
    return;
  }
  addImageRange(builder, image.from, image.altFrom, ImageSyntaxDecoration);
  addImageRange(builder, image.altFrom, image.altTo, ImageAltDecoration);
  addImageRange(builder, image.altTo, image.urlFrom, ImageSyntaxDecoration);
  addImageRange(builder, image.urlFrom, image.srcFrom, ImageSyntaxDecoration);
  addImageRange(builder, image.srcFrom, image.srcTo, ImageTargetDecoration);
  addImageRange(builder, image.srcTo, image.urlTo, ImageSyntaxDecoration);
  addImageRange(builder, image.urlTo, image.to, ImageSyntaxDecoration);
}

function imageAtSelection(state: EditorView["state"], selection: { from: number; to: number }) {
  const line = state.doc.lineAt(selection.from);
  const firstCandidateLine = Math.max(1, line.number - ImageMarkdownMaxLines + 1);

  for (let lineNumber = line.number; lineNumber >= firstCandidateLine; lineNumber -= 1) {
    const candidateLine = state.doc.line(lineNumber);
    if (isInCodeBlock(state, candidateLine.from)) break;
    if (!candidateLine.text.includes("![")) {
      if (!candidateLine.text.trim()) break;
      continue;
    }

    const [lineStart] = imageLineStartsInRange(state, candidateLine.from, candidateLine.to);
    if (lineStart === undefined) continue;

    const image = imagesFromLineStart(state, lineStart, selection).find(
      (candidate) => selection.from >= candidate.from && selection.to <= candidate.to,
    );
    if (image) return image;
  }

  return null;
}

function selectionIntersectsImage(state: EditorView["state"], selection: { from: number; to: number }) {
  const startLine = state.doc.lineAt(selection.from);
  const endLine = state.doc.lineAt(selection.to);
  const firstCandidateLine = Math.max(1, startLine.number - ImageMarkdownMaxLines + 1);

  for (let lineNumber = firstCandidateLine; lineNumber <= endLine.number; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (!line.text.includes("![")) continue;

    for (const image of imagesFromLineStart(state, line.from, selection)) {
      if (image.isActive) return true;
    }
  }

  return false;
}

const viewportField = imageViewport.field;

export function buildImageDecorations(
  state: EditorView["state"],
  viewport: { from: number; to: number } = { from: 0, to: state.doc.length },
) {
  if (viewport.to <= viewport.from) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  const selection = state.selection.main;

  for (const lineStart of imageLineStartsInRange(state, viewport.from, viewport.to)) {
    for (const image of imagesFromLineStart(state, lineStart, selection)) {
      const resolvedSrc =
        state.facet(imageActions)?.resolveSource(image.src, image.syntax) ??
        (image.syntax === "markdown" ? image.src : null);
      const loadState = resolvedSrc
        ? (imageLoadCache.get(imageLoadKey(resolvedSrc)) ?? null)
        : ({ status: "missing" } satisfies ImageLoadState);
      if (!image.isActive) {
        if (image.syntax === "wiki" && !image.renderable) continue;
        const widget = new ImageWidget(
          image.from,
          image.to,
          image.src,
          resolvedSrc,
          image.alt,
          loadState,
          imageWidgetPrefixColumns(state, image),
          image.quoteDepth,
        );
        builder.add(image.from, image.to, Decoration.replace({ widget }));
      } else {
        addActiveImageSyntax(builder, image);
      }
    }
  }

  return builder.finish();
}

const imageField = StateField.define<ImageDecorationState>({
  create() {
    return {
      decorations: Decoration.none,
      ready: false,
    };
  },
  update(value, tr) {
    const viewport = tr.state.field(viewportField);
    const viewportChanged = tr.effects.some((effect) => effect.is(imageViewport.effect));
    const imageStateChanged = tr.effects.some((effect) => effect.is(refreshImageDecorationsEffect));
    const selectionChanged = !tr.startState.selection.eq(tr.state.selection);
    const selectionTouchesImage =
      selectionChanged &&
      (selectionIntersectsImage(tr.startState, tr.startState.selection.main) ||
        selectionIntersectsImage(tr.state, tr.state.selection.main));
    const shouldRebuild =
      tr.docChanged || tr.reconfigured || viewportChanged || imageStateChanged || selectionTouchesImage || !value.ready;

    if (!shouldRebuild) {
      return {
        decorations: value.decorations,
        ready: value.ready,
      };
    }

    if (viewport.to <= viewport.from) {
      return {
        decorations: Decoration.none,
        ready: true,
      };
    }

    return {
      decorations: buildImageDecorations(tr.state, viewport),
      ready: true,
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export function computeImageOverlayFromSelection(view: EditorView) {
  const selection = view.state.selection.main;

  const image = imageAtSelection(view.state, selection);
  if (!image) return { caretInside: false, activePos: null, anchorPos: null, src: "" };

  return {
    caretInside: image.isCaretInside,
    activePos: [image.srcFrom, image.srcTo] as [number, number],
    anchorPos: image.srcFrom,
    src: image.src,
    ...(image.syntax === "wiki"
      ? {
          insertion: "wiki-image" as const,
          completionSuffix: image.closed ? "" : "]]",
          allowEmptySource: true,
        }
      : {}),
  };
}

function editTouchesImageUrl(update: ViewUpdate) {
  const image = imageAtSelection(update.startState, update.startState.selection.main);
  let touches = false;

  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (image) {
      touches ||=
        fromA === toA ? fromA >= image.srcFrom && fromA <= image.srcTo : fromA < image.srcTo && toA > image.srcFrom;
    }

    const changedSelection = { from: fromB, to: toB };
    touches ||= imageAtSelection(update.state, changedSelection)?.isCaretInside ?? false;
  });

  return touches || imageAtSelection(update.state, update.state.selection.main)?.isCaretInside === true;
}

export function createImageExtension({
  owner,
  overlay,
  actions,
}: {
  owner: string;
  overlay: EditorOverlayPort;
  actions?: ImageActions;
}) {
  const imageOverlay = createEditorOverlayController({
    owner,
    scope: "images",
    port: overlay,
    onSelect: invalidateImageLoad,
  });
  const imageOverlayPlugin = EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return;

    if (imageOverlay.isOpen() && !imageOverlay.isOpen(update.view)) imageOverlay.close();
    const context = computeImageOverlayFromSelection(update.view);
    if (!context.caretInside || context.anchorPos === null || !context.activePos) {
      if (imageOverlay.isOpen(update.view)) imageOverlay.close();
      return;
    }

    if (imageOverlay.isOpen(update.view) || (update.docChanged && editTouchesImageUrl(update))) {
      imageOverlay.open(
        update.view,
        {
          activePos: context.activePos,
          anchorPos: context.anchorPos,
          src: context.src,
          ...(context.insertion === "wiki-image"
            ? {
                insertion: context.insertion,
                completionSuffix: context.completionSuffix,
                allowEmptySource: context.allowEmptySource,
              }
            : {}),
        },
        update.view.state.selection.main.head,
      );
    }
  });

  return {
    controller: imageOverlay,
    extension: [
      ...(actions ? [imageActions.of(actions)] : []),
      imageOverlay.extension,
      imageViewport.extension,
      imageField,
      imageOverlayPlugin,
      ViewPlugin.fromClass(
        class {
          constructor(private readonly view: EditorView) {}

          destroy() {
            cleanupImageView(this.view);
          }
        },
      ),
    ],
  };
}
