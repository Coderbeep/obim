import { createFileTreeIconResolver, getBuiltInSpriteSheet, type FileTreeIconConfig } from "@pierre/trees";
import { noteFileTypesAtom } from "@renderer/store/noteFileTypeStore";
import { useAtomValue } from "jotai";
import { IconTask } from "./IconTask";

export const FILE_GLYPH_SIZE = 16;

const PDF_FILE_GLYPH_ID = "obim-file-pdf";
const FILE_GLYPH_SPRITE_SHEET = `<svg data-icon-sprite aria-hidden="true" width="0" height="0">
  <symbol id="${PDF_FILE_GLYPH_ID}" viewBox="0 0 16 16">
    <path fill="currentColor" d="M8 4a3 3 0 0 0 3 3h3v5.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 12.5v-9A2.5 2.5 0 0 1 4.5 1H8z" opacity=".4"/>
    <path fill="currentColor" d="M9.5 1a.5.5 0 0 1 .354.146l4 4A.5.5 0 0 1 14 5.5V6h-3a2 2 0 0 1-2-2V1z"/>
    <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width=".75" d="M3.75 12V9h1.1a1 1 0 0 1 0 2h-1.1m3.2-2v3h.7a1.5 1.5 0 0 0 0-3zm3.45 3V9h2m-2 1.45h1.55"/>
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
