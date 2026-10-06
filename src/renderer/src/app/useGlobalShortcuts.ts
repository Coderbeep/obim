import { isShortcut } from "@renderer/shared/keyboardShortcuts";
import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { isVisibleAtom } from "@renderer/store/SearchWindowStore";
import { useFileCreate } from "@renderer/features/files/fileActions";
import { shortcutHelpOpenAtom } from "@renderer/store/appSessionStore";
import { actionRunnerRequestAtom } from "@renderer/store/actionRunnerStore";

type UseGlobalShortcutsOptions = {
  enabled?: boolean;
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || Boolean(target.closest("input, textarea, select"));
};

export const useGlobalShortcuts = (options?: UseGlobalShortcutsOptions) => {
  const { enabled = true } = options ?? {};
  const setSearchVisible = useSetAtom(isVisibleAtom);
  const setActionRunnerRequest = useSetAtom(actionRunnerRequestAtom);
  const setShortcutHelpOpen = useSetAtom(shortcutHelpOpenAtom);
  const { createNewFile } = useFileCreate();

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || e.isComposing) return;

      if (e.key === "Escape") {
        setShortcutHelpOpen(false);
        return;
      }

      if (isShortcut("shortcut-help", e)) {
        e.preventDefault();
        setShortcutHelpOpen((open) => !open);
        return;
      }
      const shortcuts = [
        {
          id: "search-files" as const,
          allowEditableTarget: true,
          action: () => {
            setActionRunnerRequest(null);
            setSearchVisible(true);
          },
        },
        {
          id: "action-menu" as const,
          allowEditableTarget: true,
          action: () => {
            setSearchVisible(false);
            setActionRunnerRequest({ view: "commands" });
          },
        },
        {
          id: "new-note" as const,
          allowEditableTarget: true,
          action: () => void createNewFile(),
        },
      ];

      const shortcut = shortcuts.find((entry) => isShortcut(entry.id, e));

      if (!shortcut || (isEditableTarget(e.target) && !shortcut.allowEditableTarget)) return;

      e.preventDefault();
      shortcut.action();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [createNewFile, enabled, setActionRunnerRequest, setSearchVisible, setShortcutHelpOpen]);
};
