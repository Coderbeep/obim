export const TREE_ITEM_HEIGHT = 24;
export const TREE_OVERSCAN = 8;

export const ITEM_SELECTED_COLOR = "var(--surface-selected)";
export const ITEM_HOVER_COLOR = "var(--surface-hover)";
export const OPEN_FILE_HIGHLIGHT_COLOR = "var(--surface-selected)";
export const OPEN_FILE_STYLE_ID = "obim-current-open-file-style";

export const TREE_UNSAFE_CSS = `
  :host {
    background: transparent !important;
    background-color: transparent !important;
    font-family: var(--font-sans) !important;
    font-size: var(--text-ui-control) !important;
    --trees-bg: transparent !important;
    --trees-bg-muted: transparent !important;
    --trees-bg-muted-override: transparent !important;
    --trees-accent-override: var(--accent);
    --trees-fg-override: var(--text-primary);
    --trees-fg-muted-override: var(--text-secondary);
    --trees-focus-ring-color-override: var(--border-strong);
    --trees-focus-ring-width-override: 1px;
    --trees-focus-ring-offset-override: 0px;
    --trees-selected-bg-override: var(--surface-selected-subtle);
  }

  [data-file-tree-virtualized-wrapper='true'],
  [data-file-tree-virtualized-root='true'],
  [data-file-tree-virtualized-scroll='true'] {
    background: transparent !important;
    background-color: transparent !important;
    overscroll-behavior: contain;
  }

  [data-file-tree-virtualized-scroll='true']::-webkit-scrollbar {
    width: 12px;
    height: 12px;
  }

  [data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-thumb {
    min-width: 8px;
    min-height: 8px;
    border: 2px solid transparent;
    border-radius: 999px;
    background-color: var(--scrollbar-thumb);
    background-clip: content-box;
  }

  [data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-thumb:hover {
    background-color: var(--scrollbar-thumb-hover);
  }

  [data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-track {
    background: linear-gradient(
      to right,
      transparent calc(50% - 0.5px),
      var(--border-default) calc(50% - 0.5px),
      var(--border-default) calc(50% + 0.5px),
      transparent calc(50% + 0.5px)
    );
  }

  [data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-button:single-button {
    display: block;
    width: 12px;
    height: 12px;
    background-color: var(--scrollbar-thumb);
  }

  [data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-button:single-button:hover {
    background-color: var(--scrollbar-thumb-hover);
  }

  [data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-button:single-button:vertical:decrement {
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M5 2 9 8H1z'/%3E%3C/svg%3E") center / 8px 8px no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M5 2 9 8H1z'/%3E%3C/svg%3E") center / 8px 8px no-repeat;
  }

  [data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-button:single-button:vertical:increment {
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='m5 8 4-6H1z'/%3E%3C/svg%3E") center / 8px 8px no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='m5 8 4-6H1z'/%3E%3C/svg%3E") center / 8px 8px no-repeat;
  }

  [data-type='item'] {
    background: transparent !important;
    background-color: transparent !important;
    border-left: 2px solid transparent !important;
    border-radius: 7px !important;
    color: var(--text-primary) !important;
    box-sizing: border-box !important;
    --truncate-marker-background-color: transparent !important;
    --truncate-marker-background-overlay-color: transparent !important;
  }

  [data-type='item']:hover,
  [data-type='item'][data-item-context-hover='true'] {
    background: ${ITEM_HOVER_COLOR} !important;
    background-color: ${ITEM_HOVER_COLOR} !important;
    --truncate-marker-background-overlay-color: ${ITEM_HOVER_COLOR} !important;
  }

  [data-type='item'][data-item-selected],
  [data-type='item'][data-item-selected='true'] {
    background: ${ITEM_SELECTED_COLOR} !important;
    background-color: ${ITEM_SELECTED_COLOR} !important;
    border-left-color: transparent !important;
    --truncate-marker-background-overlay-color: ${ITEM_SELECTED_COLOR} !important;
  }

  [data-type='item'][data-item-focused='true'] {
    background: ${OPEN_FILE_HIGHLIGHT_COLOR} !important;
    background-color: ${OPEN_FILE_HIGHLIGHT_COLOR} !important;
    border-left-color: transparent !important;
    --truncate-marker-background-overlay-color: ${OPEN_FILE_HIGHLIGHT_COLOR} !important;
    box-shadow: inset 0 0 0 1px var(--focus-ring) !important;
  }

  [data-type='item'][data-item-type='folder'][data-item-focused='true'] {
    box-shadow: none !important;
  }

  [data-type='item'][data-item-focused='true']::before {
    outline: none !important;
  }

  [data-item-section='spacing-item'] {
    border-left: 0 !important;
    opacity: 0 !important;
    transition: none !important;
  }

  [data-truncate-marker-cell],
  [data-truncate-marker],
  [data-truncate-fill],
  [data-truncate-content='overflow'] {
    display: none !important;
  }

  [data-truncate-container],
  [data-truncate-grid] {
    display: block !important;
    min-width: 0 !important;
    overflow: hidden !important;
  }

  [data-truncate-content='visible'] {
    display: block !important;
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    /* Truncation splits names into blocks; preserve spaces at segment boundaries. */
    white-space: pre !important;
  }

  [data-item-dragging='true'] {
    opacity: 0.72 !important;
  }

  [data-item-drag-target='true'] {
    background-color: var(--surface-selected) !important;
    box-shadow: inset 0 0 0 1px var(--border-selected);
    --truncate-marker-background-overlay-color: var(--surface-selected) !important;
  }

`;
