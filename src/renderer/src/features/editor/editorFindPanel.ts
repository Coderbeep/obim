import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorView, Panel } from "@codemirror/view";

/** A compact find panel using CodeMirror's search state and navigation. */
export const createEditorFindPanel = (view: EditorView): Panel => {
  const dom = document.createElement("div");
  // Avoid CodeMirror’s built-in search panel margins; both viewers share find.css.
  dom.className = "document-find-bar";
  dom.setAttribute("role", "search");
  const row = document.createElement("div");
  row.className = "document-find-input-row";
  const icon = document.createElement("span");
  icon.className = "document-find-icon document-find-icon-search";
  icon.setAttribute("aria-hidden", "true");
  const input = document.createElement("input");
  input.type = "search";
  input.name = "search";
  input.setAttribute("main-field", "true");
  input.setAttribute("aria-label", "Find");
  input.placeholder = "Find in note…";
  const button = (label: string, text: string, action: () => void) => {
    const element = document.createElement("button");
    element.type = "button";
    element.setAttribute("aria-label", label);
    const glyph = document.createElement("span");
    glyph.className = `document-find-icon document-find-icon-${text}`;
    glyph.setAttribute("aria-hidden", "true");
    element.append(glyph);
    element.onclick = action;
    return element;
  };
  row.append(
    icon,
    input,
    button("Close search", "close", () => {
      closeSearchPanel(view);
      view.focus();
    }),
  );
  const results = document.createElement("div");
  results.className = "document-find-results";
  const clip = document.createElement("div");
  clip.className = "document-find-results-clip";
  const resultRow = document.createElement("div");
  resultRow.className = "document-find-results-row";
  const previous = button("Previous search result", "up", () => {
    findPrevious(view);
  });
  const next = button("Next search result", "down", () => {
    findNext(view);
  });
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  status.setAttribute("aria-label", "Search results");
  resultRow.append(previous, next, status);
  clip.append(resultRow);
  results.append(clip);
  dom.append(row, results);
  let lastQuery: SearchQuery | null = null;
  let lastDoc = view.state.doc;
  let matches: { from: number; to: number }[] = [];
  const sync = () => {
    const query = getSearchQuery(view.state);
    input.value = query.search;
    const expanded = query.search.length > 0;
    results.dataset.expanded = String(expanded);
    results.inert = !expanded;
    results.setAttribute("aria-hidden", String(!expanded));
    if (!lastQuery || !query.eq(lastQuery) || lastDoc !== view.state.doc) {
      matches = [];
      if (query.valid) {
        const cursor = query.getCursor(view.state);
        for (let match = cursor.next(); !match.done; match = cursor.next()) matches.push(match.value);
      }
      lastQuery = query;
      lastDoc = view.state.doc;
    }
    previous.disabled = next.disabled = matches.length === 0;
    const selection = view.state.selection.main;
    const index = matches.findIndex(({ from, to }) => from === selection.from && to === selection.to);
    const label = !expanded
      ? ""
      : !matches.length
        ? "No results"
        : index < 0
          ? `${matches.length} results`
          : `${index + 1} / ${matches.length} results`;
    if (status.textContent !== label) status.textContent = label;
  };
  input.oninput = () =>
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: input.value, literal: true })) });
  dom.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearchPanel(view);
      view.focus();
    } else if (event.key === "Enter" && event.target === input) {
      event.preventDefault();
      if (event.shiftKey) findPrevious(view);
      else findNext(view);
    }
  };
  sync();
  return {
    dom,
    top: true,
    mount: () => {
      input.focus();
      input.select();
    },
    update: sync,
  };
};
