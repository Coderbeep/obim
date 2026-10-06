import { useEffect, useState } from "react";

import { DEFAULT_SIDEBAR_PLACEMENT, isSidebarPlacement, type SidebarPlacement } from "@shared/config";

export type { SidebarPlacement } from "@shared/config";

const SIDEBAR_PLACEMENT_CHANGE_EVENT = "obim:sidebar-placement-change";

export const readSidebarPlacement = (): SidebarPlacement => {
  const placement = window.config?.getSidebarPlacementSync?.();
  return isSidebarPlacement(placement) ? placement : DEFAULT_SIDEBAR_PLACEMENT;
};

export const applySidebarPlacement = (placement: SidebarPlacement): void => {
  document.documentElement.dataset.sidebarPlacement = placement;
  window.dispatchEvent(new CustomEvent<SidebarPlacement>(SIDEBAR_PLACEMENT_CHANGE_EVENT, { detail: placement }));
};

let sidebarPlacementSaveQueue = Promise.resolve();

export const persistSidebarPlacement = (placement: SidebarPlacement): Promise<void> => {
  const save = sidebarPlacementSaveQueue.then(() => window.config.setSidebarPlacement(placement));
  sidebarPlacementSaveQueue = save.catch(() => undefined);
  return save;
};

export const initializeSidebarPlacement = (): SidebarPlacement => {
  const placement = readSidebarPlacement();
  applySidebarPlacement(placement);
  return placement;
};

export const useSidebarPlacement = (): SidebarPlacement => {
  const [placement, setPlacement] = useState(readSidebarPlacement);

  useEffect(() => {
    const syncPlacement = (event: Event) => {
      const nextPlacement = (event as CustomEvent<unknown>).detail;
      if (isSidebarPlacement(nextPlacement)) setPlacement(nextPlacement);
    };
    window.addEventListener(SIDEBAR_PLACEMENT_CHANGE_EVENT, syncPlacement);
    return () => window.removeEventListener(SIDEBAR_PLACEMENT_CHANGE_EVENT, syncPlacement);
  }, []);

  return placement;
};
