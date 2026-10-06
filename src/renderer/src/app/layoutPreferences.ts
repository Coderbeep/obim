export const EXPLORER_LAYOUT_STORAGE_KEY = "obim.layout.explorer";
export const INSPECTOR_LAYOUT_STORAGE_KEY = "obim.layout.inspector";
export const RESET_LAYOUT_EVENT = "obim:reset-layout";

export interface SidebarLayoutPreference {
  collapsed: boolean;
  lastExpandedWidth: number;
  width: number;
}

export const readSidebarLayoutPreference = (
  storageKey: string,
  defaultWidth: number,
  maxWidth: number,
): SidebarLayoutPreference => {
  const fallback = { collapsed: false, lastExpandedWidth: defaultWidth, width: defaultWidth };
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "null",
    ) as Partial<SidebarLayoutPreference> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    const width = typeof parsed.width === "number" && Number.isFinite(parsed.width) ? parsed.width : defaultWidth;
    const lastExpandedWidth =
      typeof parsed.lastExpandedWidth === "number" && Number.isFinite(parsed.lastExpandedWidth)
        ? parsed.lastExpandedWidth
        : defaultWidth;
    return {
      collapsed: parsed.collapsed === true,
      lastExpandedWidth: Math.min(maxWidth, Math.max(defaultWidth, lastExpandedWidth)),
      width: Math.min(maxWidth, Math.max(0, width)),
    };
  } catch {
    return fallback;
  }
};

export const writeSidebarLayoutPreference = (storageKey: string, preference: SidebarLayoutPreference) => {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preference));
  } catch {
    // Layout persistence is a convenience; resizing should still work if storage is unavailable.
  }
};

export const resetAppLayout = () => window.dispatchEvent(new CustomEvent(RESET_LAYOUT_EVENT));
