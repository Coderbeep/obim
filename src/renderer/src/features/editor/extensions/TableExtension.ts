import { historyKeymap } from "@codemirror/commands";
import { syntaxTree, type LanguageSupport } from "@codemirror/language";
import { getSearchQuery, searchKeymap, searchPanelOpen, setSearchQuery, type SearchQuery } from "@codemirror/search";
import { Compartment, type EditorState, type Extension, type Range, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@renderer/features/editor/codemirror-view";
import { Table, type MarkdownExtension } from "@lezer/markdown";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrow,
  IconArrowRight,
  IconCopy,
  IconSortDown,
  IconSortUp,
  IconTableColumnAdd,
  IconTableColumnDelete,
  IconTableRowAdd,
  IconTableRowDelete,
  IconTrash,
  IconX,
} from "@pierre/icons";
import { markdownTableAutocompleter, markdownTables, TableStyle, TableTheme } from "codemirror-markdown-tables";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createTableCellLinkExtension, renderTableCellMarkdown } from "./tableCellMarkdown";
import type { LinkActions } from "./shared/linkActions";

export const TableParser = Table;

type TableMenuIcon = { icon: typeof IconCopy; transform?: string };

function tableMenuIcon(label: string): TableMenuIcon {
  const normalized = label.toLowerCase();
  if (normalized.includes("(a-z)")) return { icon: IconSortUp };
  if (normalized.includes("(z-a)")) return { icon: IconSortDown };
  if (normalized === "align left") return { icon: IconAlignLeft };
  if (normalized === "align center") return { icon: IconAlignCenter };
  if (normalized === "align right") return { icon: IconAlignRight };
  if (normalized === "add column before") return { icon: IconTableColumnAdd, transform: "scaleX(-1)" };
  if (normalized === "add column after") return { icon: IconTableColumnAdd };
  if (normalized === "add row above") return { icon: IconTableRowAdd, transform: "scaleY(-1)" };
  if (normalized === "add row below") return { icon: IconTableRowAdd };
  if (normalized === "move column left") return { icon: IconArrow };
  if (normalized === "move column right") return { icon: IconArrowRight };
  if (normalized === "move row up") return { icon: IconArrow, transform: "rotate(90deg)" };
  if (normalized === "move row down") return { icon: IconArrow, transform: "rotate(-90deg)" };
  if (normalized.startsWith("duplicate")) return { icon: IconCopy };
  if (normalized.startsWith("clear")) return { icon: IconX };
  if (normalized === "delete column") return { icon: IconTableColumnDelete };
  if (normalized === "delete row") return { icon: IconTableRowDelete };
  return { icon: IconTrash };
}

const tableMenuIcons = ViewPlugin.fromClass(
  class {
    private readonly roots = new Map<HTMLElement, Root>();
    private readonly observer: MutationObserver;
    private readonly renderBatch: ReturnType<typeof createTableMenuRenderBatch>;
    private menu: HTMLElement | null = null;
    private menuTrigger: HTMLElement | null = null;
    private menuTable: HTMLElement | null = null;

    constructor(private readonly view: EditorView) {
      view.dom.addEventListener("keydown", this.handleMenuKeyDown, true);
      this.renderBatch = createTableMenuRenderBatch(() => this.render());
      this.observer = new MutationObserver(() => this.renderBatch.schedule());
      this.observer.observe(view.dom, { childList: true, subtree: true });
      this.render();
    }

    destroy() {
      this.renderBatch.destroy();
      this.view.dom.removeEventListener("keydown", this.handleMenuKeyDown, true);
      this.observer.disconnect();
      for (const root of this.roots.values()) root.unmount();
      this.roots.clear();
    }

    private readonly handleMenuKeyDown = (event: KeyboardEvent) => {
      const items = [...(this.menu?.querySelectorAll<HTMLElement>(".tbl-menu-item") ?? [])];
      if (!items.length || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape" || event.key === "Tab") {
        const trigger = this.menuTrigger;
        queueMicrotask(() => trigger?.isConnected && trigger.focus({ preventScroll: true }));
        return; // The package closes its menu and clears the row/column highlight.
      }
      const index = items.indexOf(this.view.dom.ownerDocument.activeElement as HTMLElement);
      let next: number;
      switch (event.key) {
        case "ArrowDown":
          next = (index + 1) % items.length;
          break;
        case "ArrowUp":
          next = (index <= 0 ? items.length : index) - 1;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = items.length - 1;
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          event.stopPropagation();
          items[index]?.click();
          return;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      items[next].focus({ preventScroll: true });
    };

    private render() {
      for (const handle of this.view.dom.querySelectorAll<HTMLElement>('.tbl-handle[data-type="header"]')) {
        const cell = handle.closest<HTMLElement>(".tbl-cell");
        const isRow = handle.dataset.location === "row";
        const label = `${isRow ? "Row" : "Column"} ${Number(isRow ? cell?.dataset.row : cell?.dataset.col) + 1} options`;
        handle.removeAttribute("aria-hidden");
        handle.tabIndex = 0;
        handle.setAttribute("aria-label", label);
        handle.setAttribute("aria-haspopup", "menu");
        handle.title = label;
      }
      for (const [element, root] of this.roots) {
        if (element.isConnected) continue;
        root.unmount();
        this.roots.delete(element);
      }

      for (const item of this.view.dom.querySelectorAll<HTMLElement>(".tbl-menu-item")) {
        const label = item.querySelector<HTMLElement>(".tbl-menu-item-text")?.textContent?.trim();
        if (label?.toLowerCase() === "align none") {
          item.remove();
          continue;
        }

        const container = item.querySelector<HTMLElement>(".tbl-menu-item-icon");
        if (!label || !container || this.roots.has(container)) continue;

        const descriptor = tableMenuIcon(label);
        container.replaceChildren();
        container.setAttribute("aria-hidden", "true");
        const root = createRoot(container);
        root.render(
          createElement(descriptor.icon, {
            size: 16,
            style: descriptor.transform ? { transform: descriptor.transform } : undefined,
          }),
        );
        this.roots.set(container, root);
        if (label.toLowerCase().startsWith("delete")) item.dataset.danger = "true";
      }

      const menu = this.view.dom.querySelector<HTMLElement>(".tbl-menu");
      if (menu && menu !== this.menu) {
        this.menuTrigger = this.view.dom.querySelector<HTMLElement>('.tbl-handle[data-type="header"][data-active]');
        this.menuTable = this.menuTrigger?.closest<HTMLElement>(".tbl-table") ?? null;
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", this.menuTrigger?.getAttribute("aria-label") ?? "Table options");
        // The package positions and reveals its menu asynchronously.
        requestAnimationFrame(() => {
          if (menu.isConnected && this.menu === menu)
            menu.querySelector<HTMLElement>(".tbl-menu-item")?.focus({ preventScroll: true });
        });
      }
      if (!menu && this.menu && this.view.dom.ownerDocument.activeElement === this.view.dom.ownerDocument.body) {
        if (this.menuTable?.isConnected) this.menuTable.focus({ preventScroll: true });
        else this.view.focus();
      }
      this.menu = menu;
      for (const handle of this.view.dom.querySelectorAll<HTMLElement>('.tbl-handle[data-type="header"]')) {
        handle.setAttribute("aria-expanded", String(!!menu && handle === this.menuTrigger));
      }
    }
  },
);

export function createTableMenuRenderBatch(render: () => void) {
  let scheduled = false;
  let destroyed = false;

  return {
    schedule() {
      if (scheduled || destroyed) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!destroyed) render();
      });
    },
    destroy() {
      destroyed = true;
    },
  };
}

type TableRange = { from: number; to: number };

type TableSearchAnalysis = {
  matches: boolean;
  tables: readonly TableRange[];
};

const tableRangesByDocument = new WeakMap<
  Text,
  { tree: ReturnType<typeof syntaxTree>; tables: readonly TableRange[] }
>();
const tableSearchByDocument = new WeakMap<
  Text,
  { tree: ReturnType<typeof syntaxTree>; query: SearchQuery; analysis: TableSearchAnalysis }
>();

function tableRanges(state: EditorState) {
  const tree = syntaxTree(state);
  const cached = tableRangesByDocument.get(state.doc);
  if (cached?.tree === tree) return cached.tables;

  const tables: TableRange[] = [];
  const cursor = tree.cursor();
  do {
    if (cursor.name === "Table") tables.push({ from: cursor.from, to: cursor.to });
  } while (cursor.next());
  tableRangesByDocument.set(state.doc, { tree, tables });
  return tables;
}

function analyzeTableSearch(state: EditorState, query: SearchQuery): TableSearchAnalysis {
  if (!query.valid) return { matches: false, tables: [] };

  const tree = syntaxTree(state);
  const cached = tableSearchByDocument.get(state.doc);
  if (cached?.tree === tree && cached.query.eq(query)) return cached.analysis;

  const tables = tableRanges(state);
  const analysis = {
    matches: tables.some(({ from, to }) => !query.getCursor(state, from, to).next().done),
    tables,
  } satisfies TableSearchAnalysis;
  tableSearchByDocument.set(state.doc, { tree, query, analysis });
  return analysis;
}

export function queryMatchesTable(state: EditorState, query: SearchQuery) {
  return analyzeTableSearch(state, query).matches;
}

function tableSearchSyntaxToggle(compartment: Compartment, renderedTables: Extension) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private rendered = true;
      private scheduled = false;
      private destroyed = false;

      constructor(private readonly view: EditorView) {
        this.decorations = this.lineDecorations(view.state);
        this.schedule();
      }

      update(update: ViewUpdate) {
        const queryChanged = !getSearchQuery(update.startState).eq(getSearchQuery(update.state));
        const panelChanged = searchPanelOpen(update.startState) !== searchPanelOpen(update.state);
        const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state);
        if (queryChanged || panelChanged || update.docChanged || treeChanged) {
          this.decorations = this.lineDecorations(update.state);
          this.schedule();
        }
      }

      destroy() {
        this.destroyed = true;
      }

      private schedule() {
        if (this.scheduled) return;
        this.scheduled = true;
        queueMicrotask(() => {
          this.scheduled = false;
          if (this.destroyed) return;

          const state = this.view.state;
          const showSyntax = searchPanelOpen(state) && analyzeTableSearch(state, getSearchQuery(state)).matches;
          if (this.rendered === !showSyntax) return;

          this.rendered = !showSyntax;
          this.view.dispatch({
            effects: [
              compartment.reconfigure(this.rendered ? renderedTables : []),
              setSearchQuery.of(getSearchQuery(state)),
            ],
          });
        });
      }

      private lineDecorations(state: EditorState) {
        if (!searchPanelOpen(state)) return Decoration.none;
        const analysis = analyzeTableSearch(state, getSearchQuery(state));
        if (!analysis.matches) return Decoration.none;

        const lines: Range<Decoration>[] = [];
        for (const table of analysis.tables) {
          const firstLine = state.doc.lineAt(table.from).number;
          const lastLine = state.doc.lineAt(table.to).number;
          for (let number = firstLine; number <= lastLine; number++) {
            lines.push(Decoration.line({ class: "cm-table-search-syntax-line" }).range(state.doc.line(number).from));
          }
        }
        return Decoration.set(lines, true);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

const tableHandleTheme = EditorView.theme({
  // Structural changes belong in the row and column menus, not drag handles.
  '.tbl-handle[data-type="table"], .tbl-handle[data-type="border"]': {
    display: "none",
  },
  '&[data-tbl-handle-position="outside"] .tbl-handle[data-type="header"]': {
    "--tbl-handle-opacity": "0",
    color: "var(--editor-accent)",
    "border-color": "transparent",
    "background-color": "transparent",
    "box-shadow": "none",
    "border-radius": "var(--radius-md) var(--radius-md) 0 0",
  },
  '&[data-tbl-handle-position="outside"] .tbl-handle[data-type="header"][data-location="row"]': {
    "border-radius": "var(--radius-md) 0 0 var(--radius-md)",
  },
  '&[data-tbl-handle-position="outside"] .tbl-handle[data-type="header"]:focus-visible': {
    "--tbl-handle-opacity": "1",
  },
  '.tbl-handle[data-type="header"]:focus-visible, .tbl-menu-item:focus-visible': {
    outline: "2px solid var(--editor-accent)",
    "outline-offset": "-2px",
  },
  '&[data-tbl-handle-position="outside"] .tbl-handle[data-type="header"]:hover, &[data-tbl-handle-position="outside"] .tbl-handle[data-type="header"][data-hover]':
    {
      "--tbl-handle-opacity": "1",
      color: "var(--editor-accent)",
      "border-color": "var(--border-default)",
      "background-color": "var(--selection-track)",
    },
  '&[data-tbl-handle-position="outside"] .tbl-handle[data-type="header"][data-active]': {
    "--tbl-handle-opacity": "1",
    color: "var(--editor-accent)",
    "border-color": "var(--border-strong)",
    "background-color": "var(--selection-selected)",
  },
});

export function tableExtensions(
  markdownSetup: LanguageSupport,
  {
    cellExtensions = [],
    cellMarkdownExtensions,
    openExternal = () => {},
    openResource = () => {},
    renderCell = renderTableCellMarkdown,
  }: Partial<LinkActions> & {
    cellExtensions?: readonly Extension[];
    cellMarkdownExtensions?: MarkdownExtension;
    renderCell?: ((source: string) => string) | null;
  } = {},
) {
  const renderedTables = markdownTables({
    theme: TableTheme.light.with({
      "--tbl-theme-header-row-background": "var(--editor-table-header)",
      "--tbl-theme-even-row-background": "var(--card)",
      "--tbl-theme-odd-row-background": "var(--card)",
      "--tbl-theme-border-color": "var(--editor-table-border)",
      "--tbl-theme-border-hover-color": "var(--editor-table-border-hover)",
      "--tbl-theme-border-active-color": "var(--border-strong)",
      "--tbl-theme-outline-color": "var(--editor-table-outline)",
      "--tbl-theme-menu-border-color": "var(--editor-table-menu-border)",
      "--tbl-theme-menu-background": "var(--editor-table-menu-background)",
      "--tbl-theme-menu-hover-background": "var(--editor-table-menu-hover-background)",
      "--tbl-theme-menu-text-color": "var(--editor-table-menu-text)",
      "--tbl-theme-menu-hover-text-color": "var(--editor-table-menu-hover-text)",
    }),
    style: TableStyle.default.with({
      "--tbl-style-font-family": "inherit",
      "--tbl-style-font-size": "inherit",
      "--tbl-style-menu-font-family": "inherit",
      "--tbl-style-menu-font-size": "var(--text-ui-control)",
      "--tbl-style-default-header-alignment": "left",
    }),
    handlePosition: "outside",
    lineWrapping: "wrap",
    markdownConfig: {
      extensions: cellMarkdownExtensions,
    },
    extensions: cellExtensions,
    renderCell: renderCell ?? undefined,
    globalKeyBindings: [...historyKeymap, ...searchKeymap],
  });
  const renderedTablesCompartment = new Compartment();

  return [
    markdownSetup.language.data.of({
      autocomplete: markdownTableAutocompleter(),
    }),
    renderedTablesCompartment.of(renderedTables),
    tableHandleTheme,
    tableMenuIcons,
    createTableCellLinkExtension({ openExternal, openResource }),
    tableSearchSyntaxToggle(renderedTablesCompartment, renderedTables),
  ];
}
