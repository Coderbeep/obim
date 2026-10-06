import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin } from "@renderer/features/editor/codemirror-view";
import type { EditorState, Range } from "@renderer/features/editor/codemirror-state";
import type { EditorView, ViewUpdate, DecorationSet } from "@renderer/features/editor/codemirror-view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { rangesIntersect } from "./documentRange";

type SyntaxNodeLike = SyntaxNode | SyntaxNodeRef;

type SyntaxDecorationPluginOptions = {
  shouldRebuild?: (update: ViewUpdate) => boolean;
};

function cursorFor(node: SyntaxNodeLike) {
  return "cursor" in node ? node.cursor() : node.node.cursor();
}

export function createSyntaxDecorationPlugin(
  buildDecorations: (view: EditorView) => DecorationSet,
  options: SyntaxDecorationPluginOptions = {},
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (shouldRebuildSyntaxDecorations(update, options.shouldRebuild)) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

export function shouldRebuildSyntaxDecorations(update: ViewUpdate, shouldRebuild?: (update: ViewUpdate) => boolean) {
  return (
    update.docChanged ||
    update.selectionSet ||
    update.viewportChanged ||
    syntaxTree(update.startState) !== syntaxTree(update.state) ||
    Boolean(shouldRebuild?.(update))
  );
}

export function iterateVisibleSyntaxTree(view: EditorView, enter: (node: SyntaxNodeRef) => boolean | void) {
  const tree = syntaxTree(view.state);
  const visibleRanges = visibleDocumentRanges(view);
  const visited = new Map<string, boolean>();

  for (const range of visibleRanges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        const key = `${node.type.id}:${node.from}:${node.to}`;
        const previous = visited.get(key);
        if (previous !== undefined) return previous ? undefined : false;

        const result = enter(node);
        visited.set(key, result !== false);
        return result;
      },
    });
  }
}

export function visibleDocumentRanges(view: EditorView): readonly { from: number; to: number }[] {
  const visibleRanges = (view as EditorView & { visibleRanges?: readonly { from: number; to: number }[] })
    .visibleRanges;
  if (visibleRanges) return visibleRanges;

  const viewport = (view as EditorView & { viewport?: { from: number; to: number } }).viewport;
  if (viewport) return [viewport];

  return [{ from: 0, to: view.state.doc.length }];
}

export function childNode(node: SyntaxNodeLike, name: string) {
  const cursor = cursorFor(node);
  if (!cursor.firstChild()) return null;

  do {
    if (cursor.name === name) return { from: cursor.from, to: cursor.to };
  } while (cursor.nextSibling());

  return null;
}

export function directChildren(node: SyntaxNodeLike, name: string) {
  const children: SyntaxNode[] = [];
  const cursor = cursorFor(node);
  if (!cursor.firstChild()) return children;

  do {
    if (cursor.name === name) children.push(cursor.node);
  } while (cursor.nextSibling());

  return children;
}

export function isSyntaxRangeActive(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((range) => rangesIntersect(range, { from, to }));
}

export function decorationSet(decorations: Range<Decoration>[]) {
  return decorations.length ? Decoration.set(decorations, true) : Decoration.none;
}

export function pushDecorationRange(
  decorations: Range<Decoration>[],
  decoration: Decoration,
  from: number,
  to: number,
) {
  if (from < to) decorations.push(decoration.range(from, to));
}

export function lastLineInNode(view: EditorView, node: SyntaxNodeLike) {
  const pos =
    node.to > node.from && view.state.doc.sliceString(node.to - 1, node.to) === "\n"
      ? node.to
      : Math.max(node.from, node.to - 1);

  return view.state.doc.lineAt(pos);
}

export function ancestorNodeAt(
  state: EditorState,
  position: number,
  names: string | readonly string[],
  bias: -1 | 0 | 1 = -1,
) {
  const matches = typeof names === "string" ? (name: string) => name === names : (name: string) => names.includes(name);
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, bias);

  while (node && !matches(node.name)) node = node.parent;
  return node;
}

export function visibleLineSpans(view: EditorView, node: SyntaxNodeLike) {
  const spans = visibleDocumentRanges(view)
    .map((visibleRange) => {
      const from = Math.max(node.from, visibleRange.from);
      const to = Math.min(node.to, visibleRange.to);
      if (to <= from) return null;

      return {
        first: view.state.doc.lineAt(from),
        last: view.state.doc.lineAt(Math.max(from, to - 1)),
      };
    })
    .filter((span): span is NonNullable<typeof span> => span !== null)
    .sort((left, right) => left.first.number - right.first.number);

  return spans.reduce<typeof spans>((merged, span) => {
    const previous = merged.at(-1);
    if (!previous || span.first.number > previous.last.number) {
      merged.push(span);
    } else if (span.last.number > previous.last.number) {
      previous.last = span.last;
    }
    return merged;
  }, []);
}

export function selectSyntaxRange(view: EditorView, anchor: number, head = anchor) {
  view.dispatch({
    selection: { anchor, head },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function blockquoteMarkerColumns(lineText: string) {
  return /^(\s*(?:>\s*)+)/.exec(lineText)?.[1].length ?? 0;
}

export function blockquoteDepthClass(depth: number) {
  return `cm-blockquote-depth-${Math.min(depth, 4)}`;
}
