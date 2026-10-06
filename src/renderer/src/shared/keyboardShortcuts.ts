import { useSyncExternalStore } from "react";
import {
  isShortcutOverrides,
  matchesShortcut,
  type ShortcutCommandId,
  type ShortcutKeyInput,
  type ShortcutOverrides,
} from "@shared/keyboard-shortcuts";
let snapshot: ShortcutOverrides | undefined;
const listeners = new Set<() => void>();
const publish = (next: unknown) => {
  snapshot = isShortcutOverrides(next) ? next : {};
  listeners.forEach((listener) => listener());
};
export const readKeyboardShortcuts = (): ShortcutOverrides => {
  if (!snapshot) {
    const saved = window.config?.getKeyboardShortcutsSync?.();
    snapshot = isShortcutOverrides(saved) ? saved : {};
    window.config?.onKeyboardShortcutsChange?.(publish);
  }
  return snapshot;
};
export const useKeyboardShortcuts = () =>
  useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, readKeyboardShortcuts);
export const saveKeyboardShortcuts = async (next: ShortcutOverrides) => {
  await window.config.updateConfig("keyboardShortcuts", next);
  publish(next);
};
export const isShortcut = (id: ShortcutCommandId, event: ShortcutKeyInput) =>
  matchesShortcut(id, event, readKeyboardShortcuts(), Boolean(window.config?.isMacOS));
