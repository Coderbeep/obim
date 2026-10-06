import type { FileTree as FileTreeModel } from "@pierre/trees";

export type ExplorerTreeEventTarget = {
  clickedIcon: boolean;
  rowPath: string;
};

const escapeCssString = (value: string) =>
  Array.from(value)
    .map((character) => {
      const code = character.codePointAt(0)!;
      if (code === 0) return "\uFFFD";
      if (code < 0x20 || code === 0x7f) return `\\${code.toString(16)} `;
      return character === "\\" || character === '"' ? `\\${character}` : character;
    })
    .join("");

/** Reads @pierre/trees' shadow-DOM row identity from a composed event. */
export const getExplorerTreeEventTarget = (event: Event): ExplorerTreeEventTarget | null => {
  let clickedIcon = false;
  let rowPath: string | null = null;

  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    if (target.dataset.type === "context-menu-trigger") return null;
    if (target.dataset.itemSection === "icon") clickedIcon = true;
    if (!rowPath && target.dataset.type === "item" && target.dataset.itemPath) rowPath = target.dataset.itemPath;
  }

  return rowPath ? { clickedIcon, rowPath } : null;
};

export const getExplorerTreeRowSelector = (rowPath: string) =>
  `[data-type='item'][data-item-path="${escapeCssString(rowPath)}"]`;

export const getExplorerTreeRowElement = (model: FileTreeModel, rowPath: string) => {
  const shadowRoot = model.getFileTreeContainer()?.shadowRoot;
  if (!shadowRoot) return null;

  return shadowRoot.querySelector<HTMLElement>(getExplorerTreeRowSelector(rowPath));
};

export const getExplorerTreeScrollElement = (model: FileTreeModel) =>
  model.getFileTreeContainer()?.shadowRoot?.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll='true']") ??
  null;

/** Identifies Pierre's blank scroll area without treating item rows or menu triggers as root clicks. */
export const isExplorerTreeBackgroundEvent = (event: Event, model: FileTreeModel) => {
  const scrollElement = getExplorerTreeScrollElement(model);
  if (!scrollElement) return false;

  const path = event.composedPath();
  if (!path.includes(scrollElement)) return false;

  return !path.some(
    (target) =>
      target instanceof HTMLElement &&
      (target.dataset.type === "item" || target.dataset.type === "context-menu-trigger"),
  );
};
