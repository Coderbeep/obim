import { getFrontmatterProperty, parseFrontmatter } from "@shared/frontmatter";
import { isMarkdownFile } from "@shared/mime-types";
import { atom } from "jotai";
import { selectAtom } from "jotai/utils";
import { fileBuffersByPathAtom } from "./fileBufferStore";

export type NoteFileType = "task";
export const indexedNoteFileTypesAtom = atom<Record<string, NoteFileType>>({});

/** Open buffers take precedence, including removing a previously indexed type. */
const currentNoteFileTypesAtom = atom((get) => {
  const types = { ...get(indexedNoteFileTypesAtom) };
  for (const [path, buffer] of Object.entries(get(fileBuffersByPathAtom))) {
    if (!buffer || !isMarkdownFile(undefined, path)) continue;
    const property = getFrontmatterProperty(parseFrontmatter(buffer.editorText), "type");
    const type = property?.value.kind === "string" ? property.value.value : undefined;
    if (type === "task") types[path] = type;
    else delete types[path];
  }
  return types;
});

// Ordinary typing must not repaint every file row when its type is unchanged.
export const noteFileTypesAtom = selectAtom(
  currentNoteFileTypesAtom,
  (types) => types,
  (left, right) =>
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(([path, type]) => right[path] === type),
);
