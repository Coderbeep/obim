import {
  frontmatterValueToText,
  type FrontmatterDatetimeInput,
  type FrontmatterInput,
  type FrontmatterValue,
} from "@shared/frontmatter";
import { frontmatterFieldType, type SupportedFrontmatterFieldType } from "@shared/frontmatter-fields";

import { initialFieldValue } from "./fieldTypes";

const datetimeInput = (value: FrontmatterValue & { kind: "date" }): FrontmatterDatetimeInput => ({
  kind: "datetime-input",
  value: new Date(`${value.value.slice(0, 10)}T00:00:00.000Z`),
});

/** Converts one local value only when the conversion preserves its information. */
export const convertFieldValue = (
  value: FrontmatterValue,
  target: SupportedFrontmatterFieldType,
  today = new Date(),
): FrontmatterInput | undefined => {
  const source = frontmatterFieldType(value);
  if (source === "unsupported" || source === target) return undefined;
  if ((value.kind === "string" && value.value === "") || (value.kind === "list" && value.value.length === 0)) {
    return initialFieldValue(target, today);
  }

  if (value.kind === "list") {
    const [item] = value.value;
    return target === "text" && value.value.length === 1 && item?.kind === "string" ? item.value : undefined;
  }
  if (target === "text") return frontmatterValueToText(value);
  if (target === "list") return [frontmatterValueToText(value)];
  if (target === "datetime" && value.kind === "date" && value.dateOnly) return datetimeInput(value);
  return undefined;
};
