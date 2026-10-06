export const SHORTCUT_COMMANDS = [
  {
    id: "new-note",
    label: "New note",
    description: "Create a new note in your workspace.",
    group: "Application",
    defaults: ["Mod+N"],
  },
  {
    id: "search-files",
    label: "Search files",
    description: "Search file names and note contents.",
    group: "Application",
    defaults: ["Mod+P"],
  },
  {
    id: "action-menu",
    label: "Action menu",
    description: "Find and run an application command.",
    group: "Application",
    defaults: ["Mod+Shift+P"],
  },
  {
    id: "shortcut-help",
    label: "Show shortcut card",
    description: "Toggle the floating keyboard reference.",
    group: "Application",
    defaults: ["Mod+Slash", "Mod+Shift+Slash"],
  },
  {
    id: "close-current-tab",
    label: "Close current tab",
    description: "Close the active tab, preserving unsaved work.",
    group: "Workspace",
    defaults: ["Mod+W"],
  },
  {
    id: "reopen-last-closed-tab",
    label: "Reopen last closed tab",
    description: "Restore the most recently closed tab.",
    group: "Workspace",
    defaults: ["Mod+Shift+T"],
  },
  {
    id: "zoom-in",
    label: "Zoom in",
    description: "Enlarge the interface, or the PDF when focused.",
    group: "Workspace",
    defaults: ["Mod+Equal", "Mod+Shift+Plus", "Mod+Plus"],
  },
  {
    id: "zoom-out",
    label: "Zoom out",
    description: "Reduce the interface, or the PDF when focused.",
    group: "Workspace",
    defaults: ["Mod+Minus"],
  },
  {
    id: "zoom-reset",
    label: "Reset zoom",
    description: "Restore the interface or focused PDF to actual size.",
    group: "Workspace",
    defaults: ["Mod+0"],
  },
  {
    id: "find-note",
    label: "Find in note",
    description: "Search within the current note.",
    group: "Editor",
    defaults: ["Mod+F"],
  },
  {
    id: "bold",
    label: "Bold",
    description: "Toggle bold formatting on the selection.",
    group: "Editor",
    defaults: ["Mod+B"],
  },
  {
    id: "italic",
    label: "Italic",
    description: "Toggle italic formatting on the selection.",
    group: "Editor",
    defaults: ["Mod+I"],
  },
  {
    id: "inline-code",
    label: "Inline code",
    description: "Toggle inline code on the selection.",
    group: "Editor",
    defaults: ["Mod+E"],
  },
  {
    id: "insert-link",
    label: "Insert link",
    description: "Turn the selection into a Markdown link.",
    group: "Editor",
    defaults: ["Mod+K"],
  },
] as const;
export type ShortcutCommandId = (typeof SHORTCUT_COMMANDS)[number]["id"];
export type ShortcutOverrides = Partial<Record<ShortcutCommandId, string[]>>;
export type ShortcutKeyInput = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};
const specialKeys: Record<string, string> = {
  "/": "Slash",
  "?": "Slash",
  "=": "Equal",
  "+": "Plus",
  "-": "Minus",
  ",": "Comma",
  ".": "Period",
  " ": "Space",
  "\\": "Backslash",
  "[": "BracketLeft",
  "]": "BracketRight",
  "`": "Backquote",
  ";": "Semicolon",
  "'": "Quote",
};
export const shortcutFromEvent = (event: ShortcutKeyInput, isMac: boolean): string | null => {
  if (["Control", "Meta", "Alt", "Shift", "Dead", "Unidentified"].includes(event.key)) return null;
  let key = specialKeys[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  // macOS Option often changes the character even though the physical key is unchanged.
  if (event.altKey && /^Key[A-Z]$/.test(event.code ?? "")) key = event.code!.slice(3);
  return [
    (isMac ? event.metaKey : event.ctrlKey) && "Mod",
    isMac && event.ctrlKey && "Ctrl",
    !isMac && event.metaKey && "Meta",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
};
export const shortcutBindings = (id: ShortcutCommandId, overrides: ShortcutOverrides): readonly string[] =>
  overrides[id] ?? SHORTCUT_COMMANDS.find((command) => command.id === id)!.defaults;
export const matchesShortcut = (
  id: ShortcutCommandId,
  event: ShortcutKeyInput,
  overrides: ShortcutOverrides,
  isMac: boolean,
): boolean => shortcutBindings(id, overrides).includes(shortcutFromEvent(event, isMac) ?? "");
export const shortcutLabel = (binding: string, isMac: boolean): string =>
  binding
    .split("+")
    .map(
      (part) =>
        (
          ({
            Mod: isMac ? "⌘" : "Ctrl",
            Ctrl: "Ctrl",
            Meta: "Win",
            Alt: isMac ? "⌥" : "Alt",
            Shift: isMac ? "⇧" : "Shift",
            Slash: "/",
            Equal: "=",
            Plus: "+",
            Minus: "−",
            Comma: ",",
            Period: ".",
            Backslash: "\\",
            BracketLeft: "[",
            BracketRight: "]",
            Backquote: "`",
            Semicolon: ";",
            Quote: "'",
          }) as Record<string, string>
        )[part] ?? part,
    )
    .join(isMac ? "" : " + ");
const validBinding = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?:(?:Mod|Ctrl|Meta|Alt|Shift)\+)*(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Slash|Equal|Plus|Minus|Comma|Period|Space|Backslash|BracketLeft|BracketRight|Backquote|Semicolon|Quote|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/.test(
    value,
  ) &&
  value.length < 80;
export const isShortcutOverrides = (value: unknown): value is ShortcutOverrides => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([id, bindings]) =>
      SHORTCUT_COMMANDS.some((command) => command.id === id) &&
      Array.isArray(bindings) &&
      bindings.length <= 8 &&
      bindings.every(validBinding),
  );
};
export const shortcutBindingError = (binding: string): string | null => {
  if (!validBinding(binding)) return "This key cannot be assigned. Try a letter, number, or function key.";
  if (!/^(Mod|Ctrl|Meta|Alt)\+/.test(binding) && !/^F\d+$/.test(binding))
    return "Include Command, Control, or Alt to keep typing and navigation available.";
  if (
    [
      "Mod+Q",
      "Mod+H",
      "Mod+M",
      "Alt+F4",
      "Ctrl+Alt+Delete",
      "Mod+C",
      "Mod+V",
      "Mod+X",
      "Mod+A",
      "Mod+Z",
      "Mod+Shift+Z",
      "Mod+Y",
      "Mod+S",
      "Mod+Tab",
      "Alt+Tab",
      "Mod+G",
      "Mod+Shift+G",
    ].includes(binding)
  )
    return "This combination is reserved for the system or standard editing.";
  return null;
};
