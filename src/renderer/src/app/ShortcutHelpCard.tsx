import { useKeyboardShortcuts } from "@renderer/shared/keyboardShortcuts";
import { SHORTCUT_COMMANDS, shortcutBindings, shortcutLabel } from "@shared/keyboard-shortcuts";
import { IconX } from "@pierre/icons";
import { useAtom } from "jotai";

import { Button } from "@renderer/shared/ui/button";
import { shortcutHelpOpenAtom } from "@renderer/store/appSessionStore";

import "./ShortcutHelpCard.css";

export const primaryShortcutLabel = () => (window.config.isMacOS ? "⌘" : "Ctrl");

export const ShortcutHelpCard = () => {
  const [open, setOpen] = useAtom(shortcutHelpOpenAtom);
  const overrides = useKeyboardShortcuts();
  if (!open) return null;

  return (
    <aside className="shortcut-help-card" aria-label="Keyboard shortcuts">
      <div className="shortcut-help-header">
        <div>
          <strong>Keyboard shortcuts</strong>
          <span>Keep working while this reference is open.</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close keyboard shortcuts"
          title="Close"
          onClick={() => setOpen(false)}
        >
          <IconX size={14} aria-hidden="true" />
        </Button>
      </div>
      <div className="shortcut-help-grid">
        {SHORTCUT_COMMANDS.map((command) => (
          <div className="shortcut-help-row" key={command.id}>
            <span>{command.label}</span>
            <kbd>
              {shortcutBindings(command.id, overrides)
                .map((binding) => shortcutLabel(binding, Boolean(window.config?.isMacOS)))
                .join(" · ") || "Unassigned"}
            </kbd>
          </div>
        ))}
      </div>
      <div className="shortcut-help-footer">
        <span>Toggle this card</span>
        <kbd>
          {shortcutBindings("shortcut-help", overrides)
            .map((binding) => shortcutLabel(binding, Boolean(window.config?.isMacOS)))
            .join(" · ") || "Unassigned"}
        </kbd>
        <span aria-hidden="true">·</span>
        <span>Close</span>
        <kbd>Esc</kbd>
      </div>
    </aside>
  );
};
