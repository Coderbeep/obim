import type { FrontmatterInput } from "./frontmatter";
import type { SupportedFrontmatterFieldType } from "./frontmatter-fields";

export type NoteTypeFieldCreation =
  | { kind: "value"; value: FrontmatterInput }
  | { kind: "today" };

export interface NoteTypeFieldTemplate {
  key: string;
  valueType: SupportedFrontmatterFieldType;
  creation?: NoteTypeFieldCreation;
  allowedValues?: readonly string[];
}

export interface NoteTypeTemplate {
  type: string;
  fields: readonly NoteTypeFieldTemplate[];
}

export const NOTE_TYPE_FIELD_KEY = "type";
export const TAGS_FIELD_KEY = "tags";
export const TASK_NOTE_TYPE = "task";

export const TASK_NOTE_FIELD_KEYS = {
  type: NOTE_TYPE_FIELD_KEY,
  title: "task-title",
  project: "task-project",
  stage: "task-stage",
  status: "task-status",
  created: "task-created",
  closed: "task-closed",
  due: "task-due",
  priority: "task-priority",
  tags: TAGS_FIELD_KEY,
} as const;

export const TASK_NOTE_STATUSES = ["open", "done", "cancelled"] as const;
export type TaskNoteStatus = (typeof TASK_NOTE_STATUSES)[number];

/** Done is represented by task-status, so only active workflow stages are stored here. */
export const TASK_NOTE_STAGES = ["backlog", "doing", "review"] as const;
export type TaskNoteStage = (typeof TASK_NOTE_STAGES)[number];

export const TASK_NOTE_PRIORITIES = ["high", "medium", "low"] as const;
export type TaskNotePriority = (typeof TASK_NOTE_PRIORITIES)[number];

export const TASK_NOTE_TEMPLATE = {
  type: TASK_NOTE_TYPE,
  fields: [
    {
      key: TASK_NOTE_FIELD_KEYS.type,
      valueType: "text",
      creation: { kind: "value", value: TASK_NOTE_TYPE },
      allowedValues: [TASK_NOTE_TYPE],
    },
    {
      key: TASK_NOTE_FIELD_KEYS.title,
      valueType: "text",
    },
    {
      key: TASK_NOTE_FIELD_KEYS.project,
      valueType: "text",
    },
    {
      key: TASK_NOTE_FIELD_KEYS.stage,
      valueType: "text",
      allowedValues: TASK_NOTE_STAGES,
    },
    {
      key: TASK_NOTE_FIELD_KEYS.status,
      valueType: "text",
      creation: { kind: "value", value: "open" },
      allowedValues: TASK_NOTE_STATUSES,
    },
    {
      key: TASK_NOTE_FIELD_KEYS.created,
      valueType: "date",
      creation: { kind: "today" },
    },
    {
      key: TASK_NOTE_FIELD_KEYS.closed,
      valueType: "date",
    },
    {
      key: TASK_NOTE_FIELD_KEYS.due,
      valueType: "date",
    },
    {
      key: TASK_NOTE_FIELD_KEYS.priority,
      valueType: "text",
      allowedValues: TASK_NOTE_PRIORITIES,
    },
    {
      key: TASK_NOTE_FIELD_KEYS.tags,
      valueType: "list",
    },
  ],
} as const satisfies NoteTypeTemplate;

const taskNoteFieldsByKey = new Map<string, NoteTypeFieldTemplate>(
  TASK_NOTE_TEMPLATE.fields.map((field) => [field.key, field]),
);

export const taskNoteFieldTemplate = (key: string): NoteTypeFieldTemplate | undefined => taskNoteFieldsByKey.get(key);

export interface NoteTypeTemplateContext {
  /** Local calendar date in the portable YYYY-MM-DD representation. */
  today: string;
}

export const instantiateNoteTypeFrontmatter = (
  template: NoteTypeTemplate,
  { today }: NoteTypeTemplateContext,
): ReadonlyArray<{ key: string; value: FrontmatterInput }> => {
  return template.fields.flatMap(({ key, creation }) => {
    if (!creation) return [];
    if (creation.kind === "today") {
      const date = new Date(`${today}T00:00:00.000Z`);
      const validToday = Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === today;
      if (!validToday) throw new Error("A note-type template date must use YYYY-MM-DD.");
      return [{ key, value: date }];
    }
    return [{ key, value: creation.value }];
  });
};

export const instantiateTaskNoteFrontmatter = (context: NoteTypeTemplateContext) =>
  instantiateNoteTypeFrontmatter(TASK_NOTE_TEMPLATE, context);
