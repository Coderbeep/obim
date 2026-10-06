import type { FrontmatterProperty } from "@shared/frontmatter";
import { NOTE_TYPE_FIELD_KEY, TASK_NOTE_TYPE } from "@shared/note-type-templates";

export type ExactNoteType = { kind: "note" } | { kind: "task"; property: FrontmatterProperty };

/** Recognizes app-owned note types exactly; every other authored value falls back to Note. */
export const deriveExactNoteType = (properties: readonly FrontmatterProperty[]): ExactNoteType => {
  const property = properties.find(({ key }) => key === NOTE_TYPE_FIELD_KEY);
  if (property?.value.kind !== "string") return { kind: "note" };
  if (property.value.value === TASK_NOTE_TYPE) return { kind: "task", property };
  return { kind: "note" };
};
