import { isShortcut } from "@renderer/shared/keyboardShortcuts";
import { useEffect } from "react";
import { useSetAtom, useStore } from "jotai";
import { isVisibleAtom } from "@renderer/store/SearchWindowStore";
import { useFileCreate } from "@renderer/features/files/fileActions";
import { shortcutHelpOpenAtom } from "@renderer/store/appSessionStore";
import { actionRunnerRequestAtom } from "@renderer/store/actionRunnerStore";
import { contextMenuRequestAtom } from "@renderer/store/contextMenuStore";
import { editorOverlayRequestAtom } from "@renderer/store/editorOverlayStore";
import { exitFocusModeAtom, focusModePaneIdAtom, toggleFocusModeAtom } from "@renderer/store/focusModeStore";

type UseGlobalShortcutsOptions = {
  enabled?: boolean;
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || Boolean(target.closest("input, textarea, select"));
};

export const useGlobalShortcuts = (options?: UseGlobalShortcutsOptions) => {
  const { enabled = true } = options ?? {};
  const store = useStore();
  const setSearchVisible = useSetAtom(isVisibleAtom);
  const setActionRunnerRequest = useSetAtom(actionRunnerRequestAtom);
  const setShortcutHelpOpen = useSetAtom(shortcutHelpOpenAtom);
  const { createNewFile } = useFileCreate();

  useEffect(() => {
    if (!enabled) return;

    let lastEscapeAt: number | null = null;
    const unsubscribeFocus = store.sub(focusModePaneIdAtom, () => {
      lastEscapeAt = null;
    });
    const ownedEscapes = new WeakSet<KeyboardEvent>();
    // Capture ownership before an overlay's handler dismisses it.
    const captureEscapeOwner = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        lastEscapeAt = null;
        return;
      }
      if (
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        store.get(shortcutHelpOpenAtom) ||
        store.get(isVisibleAtom) ||
        store.get(actionRunnerRequestAtom) ||
        store.get(contextMenuRequestAtom) ||
        store.get(editorOverlayRequestAtom) ||
        document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], .cm-search, .cm-tooltip')
      ) {
        ownedEscapes.add(event);
        lastEscapeAt = null;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || e.isComposing) {
        lastEscapeAt = null;
        return;
      }

      if (e.key === "Escape") {
        setShortcutHelpOpen(false);
        if (
          ownedEscapes.has(e) ||
          !store.get(focusModePaneIdAtom) ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey ||
          e.shiftKey
        ) {
          lastEscapeAt = null;
          return;
        }
        const now = Date.now();
        if (lastEscapeAt !== null && now - lastEscapeAt <= 600) {
          e.preventDefault();
          store.set(exitFocusModeAtom);
          lastEscapeAt = null;
        } else {
          lastEscapeAt = now;
        }
        return;
      }

      if (isShortcut("shortcut-help", e)) {
        e.preventDefault();
        setShortcutHelpOpen((open) => !open);
        return;
      }
      const shortcuts = [
        {
          id: "focus-mode" as const,
          allowEditableTarget: true,
          action: () => store.set(toggleFocusModeAtom),
        },
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

    window.addEventListener("keydown", captureEscapeOwner, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      unsubscribeFocus();
      window.removeEventListener("keydown", captureEscapeOwner, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [createNewFile, enabled, setActionRunnerRequest, setSearchVisible, setShortcutHelpOpen, store]);
};
