import { focusEditorLine } from "../editorNavigation";
import { EditorView } from "@renderer/features/editor/codemirror-view";
import { IconChevron, IconChevronsClose, IconExpandAll } from "@pierre/icons";
import { memo, useEffect, useMemo, useState } from "react";

import { cn } from "@renderer/shared/classNames";
import { Button } from "@renderer/shared/ui/button";
import { OUTLINE_ACTIVE_LINE_EVENT, type OutlineActiveLineDetail } from "../extensions/OutlineNavigationExtension";
import type { MarkdownHeading } from "./documentInfo";
import "./DocumentOutline.css";

interface OutlineNode {
  heading: MarkdownHeading;
  key: string;
  children: OutlineNode[];
}

const headingKey = (heading: MarkdownHeading) => `${heading.line}:${heading.level}:${heading.text}`;

export function buildDocumentOutline(headings: readonly MarkdownHeading[]) {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  headings.forEach((heading) => {
    const node: OutlineNode = { heading, key: headingKey(heading), children: [] };
    while (stack.length && stack[stack.length - 1].heading.level >= heading.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  });

  return roots;
}

const branchKeys = (nodes: readonly OutlineNode[]): string[] =>
  nodes.flatMap((node) => (node.children.length ? [node.key, ...branchKeys(node.children)] : []));

export function focusActiveEditorLine(lineNumber: number) {
  const editorElement = document.querySelector<HTMLElement>(".pane-card-active .cm-editor");
  const view = editorElement ? EditorView.findFromDOM(editorElement) : null;
  if (view) focusEditorLine(view, lineNumber);
}

const activateOutlineHeading = (heading: MarkdownHeading) => focusActiveEditorLine(heading.line);

const readActiveEditorLine = () => {
  const editorElement = document.querySelector<HTMLElement>(".pane-card-active .cm-editor");
  const view = editorElement ? EditorView.findFromDOM(editorElement) : null;
  return view ? view.state.doc.lineAt(view.state.selection.main.head).number : null;
};

const useActiveEditorLine = () => {
  const [activeLine, setActiveLine] = useState<number | null>(readActiveEditorLine);

  useEffect(() => {
    setActiveLine(readActiveEditorLine());
    const handleActiveLine = (event: Event) => {
      const detail = (event as CustomEvent<OutlineActiveLineDetail>).detail;
      if (!detail?.editor.closest(".pane-card-active")) return;
      setActiveLine(detail.line);
    };
    window.addEventListener(OUTLINE_ACTIVE_LINE_EVENT, handleActiveLine);
    return () => window.removeEventListener(OUTLINE_ACTIVE_LINE_EVENT, handleActiveLine);
  }, []);

  return activeLine;
};

function OutlineList({
  nodes,
  expanded,
  activeKey,
  depth = 0,
  onActivate,
  onToggle,
}: {
  nodes: readonly OutlineNode[];
  expanded: ReadonlySet<string>;
  activeKey?: string;
  depth?: number;
  onActivate(heading: MarkdownHeading): void;
  onToggle(key: string, open: boolean): void;
}) {
  return (
    <ol className={cn("space-y-0", depth > 0 && "outline-tree-children")}>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const open = expanded.has(node.key);
        const active = node.key === activeKey;
        return (
          <li
            key={node.key}
            className={cn(depth > 0 && "outline-tree-node", depth > 0 && hasChildren && "outline-tree-node-branch")}
          >
            <div
              className="outline-row relative flex min-w-0 items-center gap-0.5 py-0.5"
              data-active={active || undefined}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-none text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
                  aria-label={`${open ? "Collapse" : "Expand"} ${node.heading.text}`}
                  aria-expanded={open}
                  onClick={() => onToggle(node.key, !open)}
                >
                  <IconChevron size={12} className={open ? "" : "-rotate-90"} />
                </button>
              ) : (
                <span className="w-6 flex-none" />
              )}
              <button
                type="button"
                aria-current={active ? "location" : undefined}
                aria-label={`${node.heading.text} ${node.heading.line}, heading level ${node.heading.level}`}
                className={cn(
                  "flex min-h-6 min-w-0 flex-1 items-center gap-1.5 rounded-none px-1 py-0.5 text-left text-ui-body focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]",
                  active ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
                title={`${node.heading.text} (line ${node.heading.line})`}
                onClick={() => onActivate(node.heading)}
                onKeyDown={(event) => {
                  if (!hasChildren || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                  event.preventDefault();
                  onToggle(node.key, event.key === "ArrowRight");
                }}
              >
                <span
                  aria-hidden="true"
                  className="outline-heading-level inline-flex h-4 min-w-5 flex-none items-center justify-center border px-0.5 text-[9px] font-bold leading-none tabular-nums"
                  data-active={active || undefined}
                  data-level={node.heading.level}
                >
                  H{node.heading.level}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", !active && "text-foreground")}>{node.heading.text}</span>
                <span
                  aria-hidden="true"
                  className="outline-line-number flex-none text-ui-meta tabular-nums text-muted-foreground"
                >
                  L{node.heading.line}
                </span>
              </button>
            </div>
            {hasChildren && open ? (
              <OutlineList
                nodes={node.children}
                expanded={expanded}
                activeKey={activeKey}
                depth={depth + 1}
                onActivate={onActivate}
                onToggle={onToggle}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

const headingsEqual = (left: readonly MarkdownHeading[], right: readonly MarkdownHeading[]) =>
  left.length === right.length &&
  left.every(
    (heading, index) =>
      heading.level === right[index].level && heading.line === right[index].line && heading.text === right[index].text,
  );

function DocumentOutlineView({ headings }: { headings: MarkdownHeading[] }) {
  const nodes = useMemo(() => buildDocumentOutline(headings), [headings]);
  const branches = useMemo(() => branchKeys(nodes), [nodes]);
  const activeLine = useActiveEditorLine();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(branches));
  const activeHeading = useMemo(() => {
    if (activeLine === null) return undefined;
    return headings.findLast((heading) => heading.line <= activeLine);
  }, [activeLine, headings]);
  const activeKey = activeHeading ? headingKey(activeHeading) : undefined;

  const allExpanded = branches.length > 0 && branches.every((key) => expanded.has(key));
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(branches));
  const toggle = (key: string, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  return (
    <div className="document-outline flex min-h-0 flex-col">
      {headings.length ? (
        <div className="outline-toolbar mb-1 flex h-7 flex-none items-center justify-end px-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            aria-label={allExpanded ? "Collapse outline" : "Expand outline"}
            disabled={!branches.length}
            onClick={toggleAll}
          >
            {allExpanded ? <IconChevronsClose size={14} /> : <IconExpandAll size={14} />}
          </Button>
        </div>
      ) : null}
      {headings.length ? (
        <nav aria-label="Document outline" className="min-w-0 overflow-x-hidden">
          <OutlineList
            nodes={nodes}
            expanded={expanded}
            activeKey={activeKey}
            onActivate={activateOutlineHeading}
            onToggle={toggle}
          />
        </nav>
      ) : (
        <div className="outline-empty px-3 py-4 text-center">
          <div className="text-ui-body font-medium text-foreground">No headings</div>
          <div className="mt-1 text-ui-meta text-muted-foreground">Add a Markdown heading to build an outline.</div>
        </div>
      )}
    </div>
  );
}

export const DocumentOutline = memo(DocumentOutlineView, (previous, next) =>
  headingsEqual(previous.headings, next.headings),
);
