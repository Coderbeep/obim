export type TabShortcut = "close-current-tab" | "reopen-last-closed-tab";

export interface TabShortcutInput {
  alt: boolean;
  control: boolean;
  isAutoRepeat: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
}

export const resolveTabShortcut = (input: TabShortcutInput): TabShortcut | null => {
  if (!(input.control || input.meta) || input.isAutoRepeat || input.alt) return null;

  const key = input.key.toLowerCase();
  if (!input.shift && key === "w") return "close-current-tab";
  if (input.shift && key === "t") return "reopen-last-closed-tab";
  return null;
};
