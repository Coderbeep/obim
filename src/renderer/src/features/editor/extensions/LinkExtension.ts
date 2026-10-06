import { Decoration, EditorView, ViewPlugin, WidgetType } from "@renderer/features/editor/codemirror-view";
import { StateEffect } from "@renderer/features/editor/codemirror-state";
import { linkStatusPresentation, type LinkStatusPort } from "./shared/linkStatus";
import { syntaxTree } from "@codemirror/language";
import type { Range } from "@renderer/features/editor/codemirror-state";
import type { EditorState } from "@renderer/features/editor/codemirror-state";
import type { ViewUpdate } from "@renderer/features/editor/codemirror-view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import type { EditorOverlayPort } from "@renderer/store/editorOverlayStore";
import {
  createSyntaxDecorationPlugin,
  ancestorNodeAt,
  decorationSet,
  directChildren,
  iterateVisibleSyntaxTree,
  pushDecorationRange,
  visibleDocumentRanges,
} from "./shared/syntaxDecorationPlugin";
import {
  markdownLinksInText,
  normalizeMarkdownTarget,
  wikiLinksInText,
  type MarkdownLinkInfo,
  type WikiLinkInfo,
} from "./shared/OverlayMarkdown";
import { createEditorOverlayController } from "./shared/EditorOverlay";
import { rangeContains, rangesIntersect, type DocumentRange } from "./shared/documentRange";
import { dispatchLinkDestination, externalLinkUrl, isExternalLink, type LinkActions } from "./shared/linkActions";
import { parsePdfDeepLink } from "@renderer/shared/pdfDeepLink";
import { pdfReferenceTargetBasename } from "@shared/pdf-reference-links";

const LinkSyntaxDecoration = Decoration.mark({ class: "cm-formatting-link-mark" });
const LinkTextDecoration = Decoration.mark({ class: "cm-formatting-link-text" });
const LinkTargetDecoration = Decoration.mark({ class: "cm-formatting-link-target" });

type LinkInfo = (MarkdownLinkInfo & { syntax: "markdown" }) | (WikiLinkInfo & { syntax: "wiki" });

const refreshLinkStatus = StateEffect.define<null>();

type WikiLinkActions = LinkActions & {
  linkStatus?: LinkStatusPort;
  openWikiResource(path: string): void | Promise<void>;
};

const inertLinkActions: LinkActions = {
  openResource() {},
  openExternal() {},
};

class LinkPlaceholderWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly dest: string,
    private readonly external: boolean,
    private readonly actions: WikiLinkActions,
    private readonly wiki: boolean,
    private readonly presentation: ReturnType<typeof linkStatusPresentation>,
  ) {
    super();
  }

  toDOM() {
    const link = document.createElement("a");
    link.textContent = this.text || this.dest.split("/").pop() || this.dest;
    link.className = this.external
      ? "cm-link-placeholder cm-link-placeholder-external"
      : "cm-link-placeholder cm-link-placeholder-internal";
    if (this.presentation.className) link.classList.add(this.presentation.className);
    if (this.presentation.title) link.title = this.presentation.title;
    link.setAttribute("href", this.external ? externalLinkUrl(this.dest) : this.dest);
    link.draggable = false;
    link.onmousedown = (event) => event.preventDefault();
    link.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.wiki) void this.actions.openWikiResource(this.dest);
      else dispatchLinkDestination(this.dest, this.actions);
    };

    return link;
  }

  eq(other: LinkPlaceholderWidget) {
    return (
      this.text === other.text &&
      this.dest === other.dest &&
      this.external === other.external &&
      this.wiki === other.wiki &&
      this.presentation.className === other.presentation.className &&
      this.presentation.title === other.presentation.title &&
      this.actions.openResource === other.actions.openResource &&
      this.actions.openWikiResource === other.actions.openWikiResource &&
      this.actions.openExternal === other.actions.openExternal
    );
  }
}

function overlapsHandledLink(handledLinks: Array<{ from: number; to: number }>, from: number, to: number) {
  return handledLinks.some((link) => from < link.to && to > link.from);
}

function linkInfoFromNode(
  state: EditorState,
  node: SyntaxNode | SyntaxNodeRef,
  selection: DocumentRange | null,
): LinkInfo | null {
  const marks = directChildren(node, "LinkMark");
  const url = directChildren(node, "URL")[0];
  if (marks.length < 2 || !url) return null;

  const rawDest = state.doc.sliceString(url.from, url.to);
  const angled = rawDest.startsWith("<") && rawDest.endsWith(">");
  const destFrom = url.from + (angled ? 1 : 0);
  const destTo = url.to - (angled ? 1 : 0);

  return {
    from: node.from,
    to: node.to,
    textFrom: marks[0].to,
    textTo: marks[1].from,
    text: state.doc.sliceString(marks[0].to, marks[1].from),
    dest: normalizeMarkdownTarget(state.doc.sliceString(destFrom, destTo)),
    urlFrom: url.from,
    urlTo: url.to,
    destFrom,
    destTo,
    isActive: selection ? rangesIntersect(selection, node) : false,
    isCaretInside: selection ? rangeContains({ from: destFrom, to: destTo }, selection) : false,
    syntax: "markdown",
  };
}

function linkAtSelection(state: EditorState, selection: { from: number; to: number }) {
  const node = ancestorNodeAt(state, selection.from, "Link");
  if (!node || selection.to > node.to) return null;

  return linkInfoFromNode(state, node, selection);
}

function fallbackLinkAtSelection(state: EditorState, selection: { from: number; to: number }) {
  const line = state.doc.lineAt(selection.from);
  let hasLink = false;

  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name === "Link") {
        hasLink = true;
        return false;
      }

      return undefined;
    },
  });

  if (!hasLink) return null;

  const link = markdownLinksInText(line.text, line.from, selection, state).find(
    (candidate) => selection.from >= candidate.from && selection.to <= candidate.to,
  );
  return link ? { ...link, syntax: "markdown" as const } : null;
}

function isInCodeSyntax(state: EditorState, position: number) {
  return Boolean(ancestorNodeAt(state, position, ["InlineCode", "FencedCode", "CodeBlock"], 1));
}

function wikiLinkAtSelection(state: EditorState, selection: { from: number; to: number }) {
  const line = state.doc.lineAt(selection.from);
  return (
    wikiLinksInText(line.text, line.from, selection)
      .filter((link) => selection.from >= link.from && selection.to <= link.to)
      .filter((link) => !isInCodeSyntax(state, link.from + 1))
      .map((link) => ({ ...link, syntax: "wiki" as const }))[0] ?? null
  );
}

function addLinkDecoration(decorations: Range<Decoration>[], link: LinkInfo, actions: WikiLinkActions) {
  const presentation = linkStatusPresentation(
    link.syntax === "markdown" && isExternalLink(link.dest)
      ? undefined
      : actions.linkStatus?.resolve(link.dest, link.syntax),
  );
  const statusDecoration = (base: Decoration) =>
    presentation.className
      ? Decoration.mark({
          class: `${base.spec.class} ${presentation.className}`,
          attributes: { title: presentation.title },
        })
      : base;
  const textDecoration = statusDecoration(LinkTextDecoration);
  const targetDecoration = statusDecoration(LinkTargetDecoration);
  if (link.isActive) {
    if (link.syntax === "wiki") {
      pushDecorationRange(decorations, LinkSyntaxDecoration, link.from, link.destFrom);
      pushDecorationRange(decorations, targetDecoration, link.destFrom, link.destTo);
      if (link.aliasFrom !== null && link.aliasTo !== null) {
        pushDecorationRange(decorations, LinkSyntaxDecoration, link.destTo, link.aliasFrom);
        pushDecorationRange(decorations, textDecoration, link.aliasFrom, link.aliasTo);
        pushDecorationRange(decorations, LinkSyntaxDecoration, link.aliasTo, link.to);
      } else {
        pushDecorationRange(decorations, LinkSyntaxDecoration, link.destTo, link.to);
      }
      return;
    }
    pushDecorationRange(decorations, LinkSyntaxDecoration, link.from, link.textFrom);
    pushDecorationRange(decorations, textDecoration, link.textFrom, link.textTo);
    pushDecorationRange(decorations, LinkSyntaxDecoration, link.textTo, link.urlFrom);
    pushDecorationRange(decorations, LinkSyntaxDecoration, link.urlFrom, link.destFrom);
    pushDecorationRange(decorations, targetDecoration, link.destFrom, link.destTo);
    pushDecorationRange(decorations, LinkSyntaxDecoration, link.destTo, link.urlTo);
    pushDecorationRange(decorations, LinkSyntaxDecoration, link.urlTo, link.to);
    return;
  }

  decorations.push(
    Decoration.replace({
      widget: new LinkPlaceholderWidget(
        link.syntax === "wiki" ? link.alias || link.dest : link.text,
        link.dest,
        link.syntax === "markdown" && isExternalLink(link.dest),
        actions,
        link.syntax === "wiki",
        presentation,
      ),
    }).range(link.from, link.to),
  );
}

export function buildLinkDecorations(
  view: EditorView,
  actions: WikiLinkActions = { ...inertLinkActions, openWikiResource() {} },
) {
  const decorations: Range<Decoration>[] = [];
  const handledLinks: Array<{ from: number; to: number }> = [];
  const fallbackLineStarts = new Set<number>();
  const selection = view.state.selection.main;
  const visibleRanges = visibleDocumentRanges(view);
  const addVisibleLink = (link: LinkInfo) => {
    if (visibleRanges.some((range) => link.from < range.to && link.to > range.from))
      addLinkDecoration(decorations, link, actions);
  };

  iterateVisibleSyntaxTree(view, (node) => {
    if (node.name !== "Link") return;

    const link = linkInfoFromNode(view.state, node, selection);
    if (!link) {
      fallbackLineStarts.add(view.state.doc.lineAt(node.from).from);
      return false;
    }

    handledLinks.push({ from: link.from, to: link.to });
    addVisibleLink(link);
    return false;
  });

  for (const lineStart of fallbackLineStarts) {
    const line = view.state.doc.lineAt(lineStart);

    for (const link of markdownLinksInText(line.text, line.from, selection, view.state)) {
      if (overlapsHandledLink(handledLinks, link.from, link.to)) continue;
      addVisibleLink({ ...link, syntax: "markdown" });
    }
  }

  const wikiLineStarts = new Set<number>();
  for (const range of visibleDocumentRanges(view)) {
    const first = view.state.doc.lineAt(range.from);
    const last = view.state.doc.lineAt(Math.max(range.from, range.to - 1));
    for (let lineNumber = first.number; lineNumber <= last.number; lineNumber += 1) {
      const line = view.state.doc.line(lineNumber);
      if (line.text.includes("[[")) wikiLineStarts.add(line.from);
    }
  }
  for (const lineStart of wikiLineStarts) {
    const line = view.state.doc.lineAt(lineStart);
    for (const link of wikiLinksInText(line.text, line.from, selection)) {
      if (isInCodeSyntax(view.state, link.from + 1)) continue;
      addVisibleLink({ ...link, syntax: "wiki" });
    }
  }

  return decorationSet(decorations);
}

interface OverlayState {
  caretInside: boolean;
  activePos: [number, number] | null;
  anchorPos: number | null;
  currentSrc: string;
  insertion?: "wiki-link";
  completionSuffix?: string;
}

export function getLinkOverlayState(state: EditorState, selection: { from: number; to: number }): OverlayState {
  const link =
    wikiLinkAtSelection(state, selection) ??
    fallbackLinkAtSelection(state, selection) ??
    linkAtSelection(state, selection);

  if (!link) {
    return { caretInside: false, activePos: null, anchorPos: null, currentSrc: "" };
  }

  return {
    caretInside: link.isCaretInside,
    activePos: [link.destFrom, link.destTo],
    anchorPos: link.destFrom,
    currentSrc: link.dest,
    ...(link.syntax === "wiki" ? { insertion: "wiki-link" as const, completionSuffix: link.closed ? "" : "]]" } : {}),
  };
}

function handleOverlayLogic(
  update: ViewUpdate,
  overlayState: OverlayState,
  linkOverlay: ReturnType<typeof createEditorOverlayController>,
) {
  const { caretInside, currentSrc, anchorPos } = overlayState;
  if (linkOverlay.isOpen() && !linkOverlay.isOpen(update.view)) linkOverlay.close();

  if (!caretInside || anchorPos === null || !overlayState.activePos) {
    if (linkOverlay.isOpen(update.view)) linkOverlay.close();
    return;
  }

  if (update.docChanged || linkOverlay.isOpen(update.view)) {
    linkOverlay.open(
      update.view,
      {
        activePos: overlayState.activePos,
        anchorPos,
        src: currentSrc,
        insertion: overlayState.insertion,
        completionSuffix: overlayState.completionSuffix,
      },
      update.view.state.selection.main.head,
    );
  }
}

export function createLinkExtension({
  owner,
  overlay,
  openResource,
  openExternal,
  openWikiResource = openResource,
  canonicalizeWikiResource,
  onHoverPdfReference,
  linkStatus,
}: LinkActions & {
  linkStatus?: LinkStatusPort;
  owner: string;
  overlay: EditorOverlayPort;
  openWikiResource?(path: string): void | Promise<void>;
  canonicalizeWikiResource?(path: string): string;
  onHoverPdfReference?(destination: string | null): void;
}) {
  const actions = { openResource, openExternal, openWikiResource, linkStatus };
  const linkOverlay = createEditorOverlayController({
    owner,
    scope: "links",
    port: overlay,
    allowEmptySource: true,
    transformSelection: canonicalizeWikiResource,
  });
  const linkOverlayStatePlugin = EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return;

    const overlayState = getLinkOverlayState(update.view.state, update.view.state.selection.main);
    handleOverlayLogic(update, overlayState, linkOverlay);
  });
  const linkViewPlugin = createSyntaxDecorationPlugin((view) => buildLinkDecorations(view, actions), {
    shouldRebuild: (update) =>
      update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshLinkStatus))),
  });
  const statusSubscription = ViewPlugin.fromClass(
    class {
      private disposed = false;
      private queued = false;
      private readonly unsubscribe?: () => void;

      constructor(view: EditorView) {
        this.unsubscribe = linkStatus?.subscribe(() => {
          if (this.queued || this.disposed) return;
          this.queued = true;
          queueMicrotask(() => {
            this.queued = false;
            if (!this.disposed) view.dispatch({ effects: refreshLinkStatus.of(null) });
          });
        });
      }

      destroy() {
        this.disposed = true;
        this.unsubscribe?.();
      }
    },
  );

  const hoverPlugin = onHoverPdfReference
    ? ViewPlugin.fromClass(
        class {
          private destination: string | null = null;

          constructor(private readonly view: EditorView) {
            view.dom.addEventListener("mousemove", this.handleMouseMove);
            view.dom.addEventListener("mouseleave", this.clear);
          }

          update(update: ViewUpdate) {
            if (update.docChanged) this.clear();
          }

          destroy() {
            this.view.dom.removeEventListener("mousemove", this.handleMouseMove);
            this.view.dom.removeEventListener("mouseleave", this.clear);
            this.clear();
          }

          private readonly clear = () => this.setDestination(null);

          private setDestination(destination: string | null) {
            if (destination === this.destination) return;
            this.destination = destination;
            onHoverPdfReference(destination);
          }

          private readonly handleMouseMove = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return this.clear();
            const anchor = target.closest<HTMLAnchorElement>("a.cm-link-placeholder, .tbl-cell-view a[href]");
            let destination = anchor?.getAttribute("href") ?? null;
            if (!destination && target.closest(".cm-formatting-link-text, .cm-formatting-link-target")) {
              const position = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (position !== null) {
                const link =
                  linkAtSelection(this.view.state, { from: position, to: position }) ??
                  fallbackLinkAtSelection(this.view.state, { from: position, to: position });
                destination = link?.dest ?? null;
              }
            }
            this.setDestination(
              destination && pdfReferenceTargetBasename(destination) && parsePdfDeepLink(destination)?.selection
                ? destination
                : null,
            );
          };
        },
      )
    : [];

  return {
    controller: linkOverlay,
    extension: [linkViewPlugin, statusSubscription, linkOverlay.extension, linkOverlayStatePlugin, hoverPlugin],
  };
}
