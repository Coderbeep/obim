import type { FrontmatterEdit } from "@shared/frontmatter";

/** Applies one property edit and reports whether the source accepted it. */
export type ApplyEdit = (edit: FrontmatterEdit) => boolean;
