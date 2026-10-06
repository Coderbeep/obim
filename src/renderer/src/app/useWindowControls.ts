import { useCallback, useEffect, useState } from "react";

const WINDOW_CONTROLS_VISIBILITY_EVENT = "obim:window-controls-visibility";

const canUseMacOSWindowControls = () => window.config?.isMacOS === true;

const readWindowControlsVisibility = () =>
  canUseMacOSWindowControls() ? window.config.getShowWindowControlsSync() : false;

const publishWindowControlsVisibility = (visible: boolean) => {
  window.dispatchEvent(new CustomEvent<boolean>(WINDOW_CONTROLS_VISIBILITY_EVENT, { detail: visible }));
};

export const useWindowControls = () => {
  const [visible, setVisible] = useState(readWindowControlsVisibility);

  useEffect(() => {
    const handleVisibilityChange = (event: Event) => {
      setVisible((event as CustomEvent<boolean>).detail);
    };
    window.addEventListener(WINDOW_CONTROLS_VISIBILITY_EVENT, handleVisibilityChange);
    return () => window.removeEventListener(WINDOW_CONTROLS_VISIBILITY_EVENT, handleVisibilityChange);
  }, []);

  const updateVisibility = useCallback(async (nextVisible: boolean) => {
    const previousVisible = readWindowControlsVisibility();
    setVisible(nextVisible);
    publishWindowControlsVisibility(nextVisible);

    try {
      await window.config.setShowWindowControls(nextVisible);
    } catch (error) {
      setVisible(previousVisible);
      publishWindowControlsVisibility(previousVisible);
      throw error;
    }
  }, []);

  return {
    isMacOS: canUseMacOSWindowControls(),
    updateVisibility,
    visible,
  };
};
