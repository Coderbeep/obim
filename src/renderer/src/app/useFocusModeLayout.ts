import { useAtomValue, useSetAtom } from "jotai";
import { useLayoutEffect } from "react";
import { DEFAULT_FOCUS_MODE_LAYOUT, isFocusModeLayout } from "@shared/config";
import { focusModeLayoutAtom } from "@renderer/store/focusModeStore";

export const useFocusModeLayout = () => {
  const layout = useAtomValue(focusModeLayoutAtom);
  const setLayout = useSetAtom(focusModeLayoutAtom);
  useLayoutEffect(() => {
    const saved = window.config?.getFocusModeLayoutSync?.();
    setLayout(isFocusModeLayout(saved) ? saved : DEFAULT_FOCUS_MODE_LAYOUT);
  }, [setLayout]);
  return layout;
};
