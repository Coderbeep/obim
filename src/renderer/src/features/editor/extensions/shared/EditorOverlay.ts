import { Prec, type Extension } from "@renderer/features/editor/codemirror-state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@renderer/features/editor/codemirror-view";

import type { EditorOverlayPort, EditorOverlayScope } from "@renderer/store/editorOverlayStore";
import { serializeMarkdownDestination } from "./markdownDestination";

interface EditorOverlayTarget {
  activePos: [number, number];
  anchorPos: number;
  src: string;
  insertion?: "wiki-image" | "wiki-link";
  completionSuffix?: string;
  allowEmptySource?: boolean;
}

interface EditorOverlayControllerOptions {
  owner: string;
  scope: EditorOverlayScope;
  port: EditorOverlayPort;
  allowEmptySource?: boolean;
  onSelect?(path: string): void;
  transformSelection?(path: string): string;
}

export interface EditorOverlayController {
  extension: Extension;
  close(): void;
  isOpen(view?: EditorView): boolean;
  open(view: EditorView, target: EditorOverlayTarget, verticalPos: number): void;
}

export function editorOverlayAnchor(view: EditorView, horizontalAnchorPos: number, verticalAnchorPos: number) {
  const horizontal = view.coordsAtPos(horizontalAnchorPos, 1);
  const vertical = view.coordsAtPos(verticalAnchorPos) ?? horizontal;
  if (!horizontal || !vertical) {
    const editor = view.dom?.getBoundingClientRect();
    return editor ? { left: editor.left, top: editor.bottom } : null;
  }
  return { left: horizontal.left, top: vertical.bottom };
}

export function createEditorOverlayController({
  owner,
  scope,
  port,
  allowEmptySource = false,
  onSelect,
  transformSelection,
}: EditorOverlayControllerOptions): EditorOverlayController {
  let activeView: EditorView | null = null;
  let activePos: [number, number] | null = null;
  let activeSource = "";
  let activeInsertion: "markdown" | "wiki-image" | "wiki-link" = "markdown";
  let activeCompletionSuffix = "";
  let suppressed: { view: EditorView; from: number; to: number; source: string } | null = null;
  let accepting = false;

  const deactivate = () => {
    activeView = null;
    activePos = null;
    port.close(owner);
  };
  const dismiss = () => {
    if (activeView && activePos) {
      suppressed = { view: activeView, from: activePos[0], to: activePos[1], source: activeSource };
    }
    deactivate();
  };

  const controller: EditorOverlayController = {
    extension: [],
    close() {
      suppressed = null;
      deactivate();
    },
    isOpen(view) {
      return activeView !== null && (!view || activeView === view);
    },
    open(view, target, verticalPos) {
      if (!target.src && !allowEmptySource && !target.allowEmptySource) {
        suppressed = null;
        deactivate();
        return;
      }
      if (suppressed) {
        if (
          suppressed.view === view &&
          suppressed.from === target.activePos[0] &&
          suppressed.to === target.activePos[1] &&
          suppressed.source === target.src
        )
          return;
        suppressed = null;
      }

      const anchor = editorOverlayAnchor(view, target.anchorPos, verticalPos);
      if (!anchor) return;

      activeView = view;
      activePos = target.activePos;
      activeSource = target.src;
      activeInsertion = target.insertion ?? "markdown";
      activeCompletionSuffix = target.completionSuffix ?? "";
      port.open({
        owner,
        scope,
        source: target.src,
        anchor,
        select(path) {
          if (!activeView || !activePos) return;
          const selectedView = activeView;
          const [from, to] = activePos;
          deactivate();
          onSelect?.(path);
          const wiki = activeInsertion !== "markdown";
          const selectedPath = activeInsertion === "wiki-link" ? (transformSelection?.(path) ?? path) : path;
          const alreadyAngled =
            !wiki &&
            selectedView.state.doc.sliceString(from - 1, from) === "<" &&
            selectedView.state.doc.sliceString(to, to + 1) === ">";
          const normalizedWikiPath = selectedPath.replace(/\\/g, "/");
          const hash = normalizedWikiPath.indexOf("#");
          const wikiNotePath = hash === -1 ? normalizedWikiPath : normalizedWikiPath.slice(0, hash);
          const wikiFragment = hash === -1 ? "" : normalizedWikiPath.slice(hash);
          const targetInsert = wiki
            ? `${
                activeInsertion === "wiki-link" ? wikiNotePath.replace(/\.(?:md|markdown)$/i, "") : wikiNotePath
              }${wikiFragment}`.replace(/\|/g, "\\|")
            : serializeMarkdownDestination(selectedPath, alreadyAngled);
          const insert = `${targetInsert}${activeCompletionSuffix}`;
          const wrap = !wiki && !alreadyAngled && targetInsert.startsWith("<");
          suppressed = {
            view: selectedView,
            from: from + (wrap ? 1 : 0),
            to: from + targetInsert.length - (wrap ? 1 : 0),
            source: wiki ? targetInsert.replace(/\\\|/g, "|") : selectedPath,
          };
          accepting = true;
          try {
            selectedView.dispatch({
              changes: { from, to, insert },
              selection: { anchor: from + targetInsert.length - (wrap ? 1 : 0) },
              userEvent: "input.complete",
            });
          } finally {
            accepting = false;
          }
          selectedView.focus();
        },
        close() {
          const closingView = activeView;
          dismiss();
          closingView?.focus();
        },
      });
    },
  };

  controller.extension = [
    Prec.highest(
      keymap.of([
        ...(["ArrowUp", "ArrowDown", "Enter"] as const).map((key) => ({
          key,
          run: () => {
            if (!controller.isOpen()) return false;
            port.hotkey(owner, key);
            return true;
          },
        })),
        {
          key: "Escape",
          run: () => {
            if (!controller.isOpen()) return false;
            dismiss();
            return true;
          },
        },
      ]),
    ),
    ViewPlugin.fromClass(
      class {
        constructor(private readonly view: EditorView) {}

        update(update: ViewUpdate) {
          if (!suppressed || suppressed.view !== this.view || accepting) return;
          let changedTarget = false;
          update.changes.iterChangedRanges((from, to) => {
            if (from <= suppressed!.to && to >= suppressed!.from) changedTarget = true;
          });
          if (changedTarget) {
            suppressed = null;
            return;
          }
          suppressed.from = update.changes.mapPos(suppressed.from, 1);
          suppressed.to = update.changes.mapPos(suppressed.to, -1);
          const selection = update.state.selection.main;
          if (selection.from < suppressed.from || selection.to > suppressed.to) suppressed = null;
        }

        destroy() {
          if (controller.isOpen(this.view)) deactivate();
          if (suppressed?.view === this.view) suppressed = null;
        }
      },
    ),
  ];

  return controller;
}
