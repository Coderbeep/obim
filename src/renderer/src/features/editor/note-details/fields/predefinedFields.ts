import { IconCalendar, IconFlag, IconTag } from "@pierre/icons";

import type { IconComponent } from "@renderer/shared/icons/types";
import { normalizeTaskBoardProjectName } from "@renderer/shared/taskBoard";
import type { SupportedFrontmatterFieldType } from "@shared/frontmatter-fields";
import {
  TASK_NOTE_FIELD_KEYS,
  TASK_NOTE_PRIORITIES,
  taskNoteFieldTemplate,
} from "@shared/note-type-templates";

/**
 * Static Note Details behavior for an application-defined frontmatter field.
 *
 * A `null` required type means that another control owns the field. For
 * example, `type` is managed by the note-type selector.
 */
type PredefinedFieldDefinition = {
  /** Required value type. Also used when the field is created. */
  requiredType: SupportedFrontmatterFieldType | null;
  /** Whether the field is omitted from ordinary Note Details rows. */
  hiddenFromDetails: boolean;
  /** Icon used when the field is shown. */
  icon?: IconComponent;
  /** Optional normalization applied to text values and suggestions. */
  normalizeTextValue?: (value: string) => string;
  /** Closed set of values accepted by a text field. */
  allowedTextValues?: readonly string[];
  /** Whether a normalized text value removes the field instead of being written. */
  removeWhenTextValue?: (value: string) => boolean;
};

const taskFieldType = (key: string) => {
  const field = taskNoteFieldTemplate(key);
  if (!field) throw new Error(`Missing Task note template field “${key}”.`);
  return field.valueType;
};

export const predefinedFields = {
  [TASK_NOTE_FIELD_KEYS.tags]: {
    requiredType: taskFieldType(TASK_NOTE_FIELD_KEYS.tags),
    hiddenFromDetails: false,
    icon: IconTag,
  },
  [TASK_NOTE_FIELD_KEYS.due]: {
    requiredType: taskFieldType(TASK_NOTE_FIELD_KEYS.due),
    hiddenFromDetails: false,
    icon: IconCalendar,
  },
  [TASK_NOTE_FIELD_KEYS.priority]: {
    requiredType: taskFieldType(TASK_NOTE_FIELD_KEYS.priority),
    hiddenFromDetails: false,
    icon: IconFlag,
    allowedTextValues: TASK_NOTE_PRIORITIES,
    normalizeTextValue: (value: string) => value.trim().toLocaleLowerCase(),
  },
  [TASK_NOTE_FIELD_KEYS.project]: {
    requiredType: taskFieldType(TASK_NOTE_FIELD_KEYS.project),
    hiddenFromDetails: false,
    normalizeTextValue: normalizeTaskBoardProjectName,
    removeWhenTextValue: (value: string) => !value,
  },
  [TASK_NOTE_FIELD_KEYS.type]: {
    requiredType: null,
    hiddenFromDetails: true,
  },
} as const satisfies Record<
  | typeof TASK_NOTE_FIELD_KEYS.tags
  | typeof TASK_NOTE_FIELD_KEYS.due
  | typeof TASK_NOTE_FIELD_KEYS.priority
  | typeof TASK_NOTE_FIELD_KEYS.project
  | typeof TASK_NOTE_FIELD_KEYS.type,
  PredefinedFieldDefinition
>;

export const predefinedField = (key: string): PredefinedFieldDefinition | null =>
  Object.hasOwn(predefinedFields, key) ? predefinedFields[key as keyof typeof predefinedFields] : null;
