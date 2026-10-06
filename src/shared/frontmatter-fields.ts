import { isManagedFrontmatterValue, type FrontmatterValue } from "./frontmatter";

export type FrontmatterFieldType = "text" | "number" | "boolean" | "list" | "date" | "datetime" | "unsupported";
export type SupportedFrontmatterFieldType = Exclude<FrontmatterFieldType, "unsupported">;

export const frontmatterFieldType = (value: FrontmatterValue): FrontmatterFieldType => {
  if (!isManagedFrontmatterValue(value)) return "unsupported";
  if (value.kind === "string") return "text";
  if (value.kind === "number") return "number";
  if (value.kind === "boolean") return "boolean";
  if (value.kind === "list") return "list";
  if (value.kind === "date") return value.dateOnly ? "date" : "datetime";
  return "unsupported";
};
