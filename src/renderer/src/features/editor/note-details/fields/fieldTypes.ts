import { IconCalendar, IconCheckbox, IconHash, IconListUnordered, IconParagraph } from "@pierre/icons";

import type { IconComponent } from "@renderer/shared/icons/types";
import { toDateInputValue } from "@renderer/shared/date";
import type { FrontmatterInput } from "@shared/frontmatter";
import type { SupportedFrontmatterFieldType } from "@shared/frontmatter-fields";

type FieldTypeDefinition = {
  createInitialValue: (today: Date) => FrontmatterInput;
  icon: IconComponent;
  label: string;
};

export const fieldTypes: Record<SupportedFrontmatterFieldType, FieldTypeDefinition> = {
  list: { label: "List", icon: IconListUnordered, createInitialValue: () => [] },
  date: {
    label: "Date",
    icon: IconCalendar,
    createInitialValue: (today) => new Date(`${toDateInputValue(today)}T00:00:00.000Z`),
  },
  datetime: { label: "Date & time", icon: IconCalendar, createInitialValue: (today) => today },
  number: { label: "Number", icon: IconHash, createInitialValue: () => 0 },
  boolean: { label: "Checkbox", icon: IconCheckbox, createInitialValue: () => false },
  text: { label: "Text", icon: IconParagraph, createInitialValue: () => "" },
};

export const fieldTypeOrder = Object.keys(fieldTypes) as SupportedFrontmatterFieldType[];

export const fieldTypeLabel = (type: SupportedFrontmatterFieldType) => fieldTypes[type].label;

export const initialFieldValue = (type: SupportedFrontmatterFieldType, today = new Date()) =>
  fieldTypes[type].createInitialValue(today);
