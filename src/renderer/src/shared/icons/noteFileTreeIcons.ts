import type { NoteFileType } from "@renderer/store/noteFileTypeStore";
import { NOTE_ICON_MARKUP } from "./noteIconMarkup";

const masks = Object.fromEntries(
  Object.entries(NOTE_ICON_MARKUP).map(([type, body]) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="black" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${body.replaceAll("currentColor", "black")}</svg>`;
    return [type, `url("data:image/svg+xml,${encodeURIComponent(svg)}")`];
  }),
);

/** Exact tree paths prevent same-named notes in different folders sharing an icon. */
export const noteFileTreeIconCss = (entries: readonly [string, NoteFileType][]) => {
  return (["task"] as const)
    .map((type) => {
      const rows = entries
        .filter(([, value]) => value === type)
        .map(
          ([path]) =>
            `[data-item-path=${JSON.stringify(path)}] > [data-item-section='icon'] [data-icon-name='file-tree-icon-file']`,
        );
      if (!rows.length) return "";
      return `${rows.join(",")} { background: currentColor; mask-image: ${masks[type]}; mask-size: contain; mask-repeat: no-repeat; }
      ${rows.map((row) => `${row} > use`).join(",")} { visibility: hidden; }`;
    })
    .join("\n")
    .trim();
};
