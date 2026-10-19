import { createFileTreeIconResolver, getBuiltInSpriteSheet, type FileTreeIconConfig } from "@pierre/trees";
import { noteFileTypesAtom } from "@renderer/store/noteFileTypeStore";
import { useAtomValue } from "jotai";
import { IconTask } from "./IconTask";

export const FILE_GLYPH_SIZE = 16;

const PDF_FILE_GLYPH_ID = "obim-file-pdf";
// This sprite also carries the colors into the explorer's shadow root.
const FILE_GLYPH_SPRITE_SHEET = `<svg data-icon-sprite aria-hidden="true" width="0" height="0">
  <style>
    use[href="#file-tree-builtin-zip"] { color: var(--file-icon-archive); }
    use[href="#file-tree-builtin-image"] { color: var(--file-icon-image); }
  </style>
  <symbol id="${PDF_FILE_GLYPH_ID}" viewBox="0 0 16 16">
    <path fill="var(--file-icon-pdf)" d="M8 4a3 3 0 0 0 3 3h3v5.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 12.5v-9A2.5 2.5 0 0 1 4.5 1H8z" opacity=".12"/>
    <path fill="var(--file-icon-pdf)" d="M9.5 1a.5.5 0 0 1 .354.146l4 4A.5.5 0 0 1 14 5.5V6h-3a2 2 0 0 1-2-2V1z" opacity=".65"/>
    <path fill="none" stroke="var(--file-icon-pdf)" stroke-linecap="round" stroke-linejoin="round" stroke-width=".9" d="M7.9 1.6H4.5a1.9 1.9 0 0 0-1.9 1.9v9a1.9 1.9 0 0 0 1.9 1.9H12"/>
    <rect x=".8" y="8.1" width="14.4" height="6.1" rx="1.25" fill="var(--file-icon-pdf)"/>
    <g fill="var(--file-icon-pdf-label)">
      <path transform="translate(3.82 12.65)" d="M1.356 -1.546Q1.516 -1.546 1.633 -1.585Q1.752 -1.625 1.831 -1.7Q1.91 -1.774 1.947 -1.88Q1.986 -1.986 1.986 -2.117Q1.986 -2.242 1.947 -2.343Q1.91 -2.445 1.832 -2.515Q1.754 -2.587 1.636 -2.623Q1.518 -2.661 1.356 -2.661L0.925 -2.661L0.925 -1.546L1.356 -1.546ZM1.356 -3.108Q1.668 -3.108 1.896 -3.035Q2.124 -2.963 2.272 -2.831Q2.421 -2.7 2.492 -2.517Q2.565 -2.335 2.565 -2.117Q2.565 -1.892 2.489 -1.704Q2.415 -1.516 2.263 -1.38Q2.113 -1.245 1.886 -1.169Q1.66 -1.094 1.356 -1.094L0.925 -1.094L0.925 0L0.346 0L0.346 -3.108L1.356 -3.108Z"/>
      <path transform="translate(6.48 12.65)" d="M3.106 -1.555Q3.106 -1.213 2.992 -0.926Q2.879 -0.64 2.672 -0.434Q2.466 -0.228 2.175 -0.113Q1.885 0 1.531 0L0.346 0L0.346 -3.108L1.531 -3.108Q1.885 -3.108 2.175 -2.993Q2.466 -2.879 2.672 -2.673Q2.879 -2.468 2.992 -2.181Q3.106 -1.896 3.106 -1.555ZM2.513 -1.555Q2.513 -1.81 2.445 -2.012Q2.378 -2.216 2.25 -2.357Q2.122 -2.499 1.94 -2.573Q1.758 -2.649 1.531 -2.649L0.927 -2.649L0.927 -0.46L1.531 -0.46Q1.758 -0.46 1.94 -0.535Q2.122 -0.611 2.25 -0.752Q2.378 -0.892 2.445 -1.095Q2.513 -1.299 2.513 -1.555Z"/>
      <path transform="translate(9.748 12.65)" d="M0.927 -2.649L0.927 -1.729L2.092 -1.729L2.092 -1.266L0.927 -1.266L0.927 0L0.346 0L0.346 -3.108L2.307 -3.108L2.307 -2.649L0.927 -2.649Z"/>
    </g>
  </symbol>
</svg>`;

export const FILE_GLYPH_ICONS = {
  set: "standard",
  colored: false,
  spriteSheet: FILE_GLYPH_SPRITE_SHEET,
  byFileExtension: {
    md: "file-tree-builtin-text",
    markdown: "file-tree-builtin-text",
    mdown: "file-tree-builtin-text",
    mdx: "file-tree-builtin-text",
    mkdn: "file-tree-builtin-text",
    pdf: PDF_FILE_GLYPH_ID,
    txt: "file-tree-builtin-default",
  },
} satisfies FileTreeIconConfig;

const fileGlyphResolver = createFileTreeIconResolver(FILE_GLYPH_ICONS);
const fileGlyphSpriteSheet = `${getBuiltInSpriteSheet(FILE_GLYPH_ICONS.set)}${FILE_GLYPH_ICONS.spriteSheet}`;

export const FileGlyphSprite = () => (
  <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: fileGlyphSpriteSheet }} />
);

export function getFileGlyph(filePath: string) {
  return <FileGlyph filePath={filePath} />;
}

function FileGlyph({ filePath }: { filePath: string }) {
  const types = useAtomValue(noteFileTypesAtom);
  const normalizedPath = filePath.replaceAll("\\", "/");
  const root = window.config?.getMainDirectoryPathSync?.()?.replaceAll("\\", "/").replace(/\/$/, "");
  const type = types[normalizedPath] ?? (root ? types[`${root}/${normalizedPath}`] : undefined);
  if (type === "task") return <IconTask className="shrink-0" />;
  const icon = fileGlyphResolver.resolveIcon("file-tree-icon-file", filePath);
  const width = icon.width ?? 16;
  const height = icon.height ?? 16;

  return (
    <svg
      aria-hidden="true"
      className="shrink-0 text-muted-foreground"
      fill="none"
      focusable="false"
      height={FILE_GLYPH_SIZE}
      viewBox={icon.viewBox ?? `0 0 ${width} ${height}`}
      width={FILE_GLYPH_SIZE}
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
}
