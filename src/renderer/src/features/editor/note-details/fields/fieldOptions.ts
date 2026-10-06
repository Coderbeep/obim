import type { FrontmatterProperty } from "@shared/frontmatter";
import type { SupportedFrontmatterFieldType } from "@shared/frontmatter-fields";

import { predefinedField, predefinedFields } from "./predefinedFields";

export type FieldOption = {
  key: string;
  type: SupportedFrontmatterFieldType;
};

export const normalizeFieldName = (key: string) => key.trim().toLocaleLowerCase();

/** Returns visible, unoccupied workspace and built-in field choices. */
export const getFieldOptions = ({
  currentKey,
  properties,
  workspaceFields,
}: {
  currentKey?: string;
  properties: readonly FrontmatterProperty[];
  workspaceFields: readonly FieldOption[];
}): FieldOption[] => {
  const occupied = properties.reduce((names, { key }) => {
    if (key !== currentKey) names.add(normalizeFieldName(key));
    return names;
  }, new Set<string>());
  const options = workspaceFields.map(({ key, type }) => ({
    key,
    type: predefinedField(key)?.requiredType ?? type,
  }));
  const names = new Set(options.map(({ key }) => key));

  for (const [key, predefined] of Object.entries(predefinedFields)) {
    if (predefined.requiredType !== null && !names.has(key)) {
      options.push({ key, type: predefined.requiredType });
    }
  }

  return options.filter(
    ({ key }) => !predefinedField(key)?.hiddenFromDetails && !occupied.has(normalizeFieldName(key)),
  );
};
