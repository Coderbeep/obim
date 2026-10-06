import katex from "katex";
import MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

import { ViewPlugin, type EditorView } from "@renderer/features/editor/codemirror-view";
import { linkStatusPresentation, type LinkStatusPort } from "./shared/linkStatus";
import { toMediaUrl } from "@shared/pathUtils";
import { dispatchLinkDestination, isExternalLink, type LinkActions } from "./shared/linkActions";

const inertLinkActions: LinkActions = {
  openResource() {},
  openExternal() {},
};
const RemoteImageSource = /^(?:[a-z][a-z\d+.-]*:|\/\/|www\.)/i;

function markerAt(source: string, position: number) {
  return source.startsWith("$$", position) ? "$$" : "$";
}

function escapedAt(source: string, position: number) {
  let slashes = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function findMathEnd(source: string, from: number, marker: string) {
  for (let index = from; index <= source.length - marker.length; index += 1) {
    if (source.startsWith(marker, index) && !escapedAt(source, index)) return index;
  }
  return -1;
}

function mathInline(state: StateInline, silent: boolean) {
  if (state.src[state.pos] !== "$" || escapedAt(state.src, state.pos)) return false;

  const marker = markerAt(state.src, state.pos);
  const contentFrom = state.pos + marker.length;
  const contentTo = findMathEnd(state.src, contentFrom, marker);
  if (contentTo <= contentFrom) return false;

  if (!silent) {
    const token = state.push("table_math_inline", "math", 0);
    token.content = state.src.slice(contentFrom, contentTo);
    token.meta = { displayMode: marker.length === 2 };
  }
  state.pos = contentTo + marker.length;
  return true;
}

function renderMath(tokens: Parameters<NonNullable<MarkdownIt["renderer"]["rules"][string]>>[0], index: number) {
  const token = tokens[index];
  const displayMode = token.meta?.displayMode === true;
  return `<span class="cm-math-widget cm-math-widget-inline${
    displayMode ? " cm-math-widget-display-inline" : ""
  }">${katex.renderToString(token.content, {
    displayMode,
    throwOnError: false,
  })}</span>`;
}

function createTableCellMarkdown() {
  const md = new MarkdownIt({ breaks: true, html: false, linkify: false });
  md.normalizeLink = (destination) => destination;
  md.normalizeLinkText = (destination) => destination;
  md.inline.ruler.after("escape", "table_math_inline", mathInline);
  md.renderer.rules.table_math_inline = renderMath;

  const defaultLinkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const destination = tokens[index].attrGet("href") ?? "";
    tokens[index].attrJoin(
      "class",
      `cm-link-placeholder cm-link-placeholder-${isExternalLink(destination) ? "external" : "internal"}`,
    );
    tokens[index].attrSet("draggable", "false");
    return defaultLinkOpen
      ? defaultLinkOpen(tokens, index, options, env, renderer)
      : renderer.renderToken(tokens, index, options);
  };

  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const src = tokens[index].attrGet("src");
    if (!src || RemoteImageSource.test(src)) {
      const alt = md.utils.escapeHtml(tokens[index].content || "image");
      return `<span class="tbl-cell-image-placeholder" role="img" aria-label="${alt}">[${alt}]</span>`;
    }
    tokens[index].attrSet("src", toMediaUrl(src));
    tokens[index].attrJoin("class", "tbl-cell-image");
    return defaultImage
      ? defaultImage(tokens, index, options, env, renderer)
      : renderer.renderToken(tokens, index, options);
  };

  return md;
}

const tableCellMarkdown = createTableCellMarkdown();

export function renderTableCellMarkdown(source: string) {
  // Match the table package's cell editor decoding before parsing inline Markdown.
  // These are table-level escapes, including inside code spans and math.
  const cellSource = source.replaceAll("<br>", "\n").replaceAll("\\|", "|");
  return tableCellMarkdown.renderInline(cellSource).trim();
}

function tableCellLink(event: Event) {
  const target = event.target;
  return target instanceof Element ? target.closest<HTMLAnchorElement>(".tbl-cell-view a[href]") : null;
}

export function createTableCellLinkExtension(actions: LinkActions = inertLinkActions, linkStatus?: LinkStatusPort) {
  return ViewPlugin.fromClass(
    class {
      private readonly observer?: MutationObserver;
      private readonly unsubscribe?: () => void;
      private disposed = false;
      private queued = false;
      private readonly originalTitles = new WeakMap<HTMLAnchorElement, string | null>();

      constructor(private readonly view: EditorView) {
        if (linkStatus) {
          this.observer = new MutationObserver(this.queueRefresh);
          this.observer.observe(view.dom, { childList: true, subtree: true });
          this.unsubscribe = linkStatus.subscribe(this.queueRefresh);
          this.queueRefresh();
          view.scrollDOM.addEventListener("scroll", this.queueRefresh, { passive: true });
        }
        view.dom.addEventListener("pointerdown", this.handleLinkPointerDown, true);
        view.dom.addEventListener("click", this.handleLinkClick, true);
      }

      update() {
        this.queueRefresh();
      }

      private readonly queueRefresh = () => {
        if (!linkStatus || this.queued || this.disposed) return;
        this.queued = true;
        queueMicrotask(() => {
          this.queued = false;
          if (this.disposed) return;
          const viewport = this.view.scrollDOM.getBoundingClientRect();
          for (const anchor of this.view.dom.querySelectorAll<HTMLAnchorElement>(".tbl-cell-view a[href]")) {
            const bounds = anchor.getBoundingClientRect();
            if (bounds.bottom < viewport.top || bounds.top > viewport.bottom) continue;
            const destination = anchor.getAttribute("href") ?? "";
            const presentation = linkStatusPresentation(
              isExternalLink(destination) ? undefined : linkStatus.resolve(destination, "markdown"),
            );
            if (!this.originalTitles.has(anchor)) this.originalTitles.set(anchor, anchor.getAttribute("title"));
            anchor.classList.toggle("cm-link-missing", presentation.className === "cm-link-missing");
            anchor.classList.toggle("cm-link-ambiguous", presentation.className === "cm-link-ambiguous");
            const title = presentation.title || this.originalTitles.get(anchor);
            if (title) anchor.title = title;
            else anchor.removeAttribute("title");
          }
        });
      };

      destroy() {
        this.disposed = true;
        this.unsubscribe?.();
        this.observer?.disconnect();
        this.view.scrollDOM.removeEventListener("scroll", this.queueRefresh);
        this.view.dom.removeEventListener("pointerdown", this.handleLinkPointerDown, true);
        this.view.dom.removeEventListener("click", this.handleLinkClick, true);
      }

      private readonly handleLinkPointerDown = (event: Event) => {
        if (!tableCellLink(event)) return;
        event.preventDefault();
        event.stopPropagation();
      };

      private readonly handleLinkClick = (event: Event) => {
        const link = tableCellLink(event);
        if (!link) return;

        event.preventDefault();
        event.stopPropagation();
        const destination = link.getAttribute("href");
        if (!destination) return;
        dispatchLinkDestination(destination, actions);
      };
    },
  );
}
