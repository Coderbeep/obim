import { IconFullscreen, IconX } from "@pierre/icons";
import { useAtomValue, useSetAtom } from "jotai";

import { FileSaveStatus, useFileSavePresentation } from "@renderer/features/files/FileSaveStatus";
import { useKeyboardShortcuts } from "@renderer/shared/keyboardShortcuts";
import { Button } from "@renderer/shared/ui/button";
import { exitFocusModeAtom, focusModePaneIdAtom, toggleFocusModeAtom } from "@renderer/store/focusModeStore";
import { currentFileAtom } from "@renderer/store/workspaceResourceStore";
import { shortcutBindings, shortcutLabel } from "@shared/keyboard-shortcuts";

const useFocusShortcutLabel = () => {
  const overrides = useKeyboardShortcuts();
  return shortcutBindings("focus-mode", overrides)
    .map((binding) => shortcutLabel(binding, Boolean(window.config?.isMacOS)))
    .join(" · ");
};

export const FocusModeToggle = ({ paneId, disabled }: { paneId: string; disabled: boolean }) => {
  const toggle = useSetAtom(toggleFocusModeAtom);
  const shortcut = useFocusShortcutLabel();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      aria-label="Enter focus mode"
      title={`Enter focus mode${shortcut ? ` (${shortcut})` : ""}`}
      onClick={() => toggle(paneId)}
    >
      <IconFullscreen size={16} aria-hidden="true" />
    </Button>
  );
};

export const FocusModeControls = () => {
  const paneId = useAtomValue(focusModePaneIdAtom);
  const file = useAtomValue(currentFileAtom);
  const presentation = useFileSavePresentation(file?.path);
  const exit = useSetAtom(exitFocusModeAtom);
  const shortcut = useFocusShortcutLabel();
  if (!paneId) return null;
  return (
    <div className="focus-mode-controls" role="group" aria-label="Focus mode controls">
      {file && presentation && presentation.phase !== "saved" ? <FileSaveStatus path={file.path} /> : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="focus-mode-exit"
        aria-label="Exit focus mode"
        title={`Exit focus mode${shortcut ? ` (${shortcut})` : ""}, or press Escape twice`}
        onClick={() => exit()}
      >
        <IconX size={14} aria-hidden="true" />
        <span>Exit focus</span>
        <kbd aria-hidden="true">Esc ×2</kbd>
      </Button>
    </div>
  );
};
