export type ZoomShortcut = "in" | "out" | "reset";

export interface ZoomShortcutInput {
  control: boolean;
  meta: boolean;
  key: string;
}

export const resolveZoomShortcut = (input: ZoomShortcutInput): ZoomShortcut | null => {
  if (!input.control && !input.meta) return null;
  if (input.key === "+" || input.key === "=") return "in";
  if (input.key === "-") return "out";
  if (input.key === "0") return "reset";
  return null;
};
