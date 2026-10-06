import { APP_THEMES, isAppTheme, type AppTheme } from "@shared/config";

export type { AppTheme } from "@shared/config";

export const APP_THEME_STORAGE_KEY = "obim:theme";

let stopFollowingSystemTheme: (() => void) | null = null;

const systemPrefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

const readLegacyAppTheme = (): AppTheme =>
  window.localStorage.getItem(APP_THEME_STORAGE_KEY) === APP_THEMES.DARK ? APP_THEMES.DARK : APP_THEMES.LIGHT;

export const readAppTheme = (): AppTheme => {
  const configuredTheme = window.config?.getThemeSync?.();
  return isAppTheme(configuredTheme) ? configuredTheme : readLegacyAppTheme();
};

export const applyAppTheme = (theme: AppTheme) => {
  stopFollowingSystemTheme?.();
  stopFollowingSystemTheme = null;
  const applyResolvedTheme = () =>
    document.documentElement.classList.toggle(
      "dark",
      theme === APP_THEMES.DARK || (theme === APP_THEMES.SYSTEM && systemPrefersDark()),
    );
  applyResolvedTheme();
  if (theme === APP_THEMES.SYSTEM && window.matchMedia) {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyResolvedTheme);
    stopFollowingSystemTheme = () => media.removeEventListener("change", applyResolvedTheme);
  }
};

let themeSaveQueue = Promise.resolve();

export const persistAppTheme = (theme: AppTheme): Promise<void> => {
  window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
  const save = themeSaveQueue.then(() => window.config.setTheme(theme));
  themeSaveQueue = save.catch(() => undefined);
  return save;
};

export const initializeAppTheme = () => {
  const configuredTheme = window.config?.getThemeSync?.();
  const theme = isAppTheme(configuredTheme) ? configuredTheme : readLegacyAppTheme();
  applyAppTheme(theme);

  if (!isAppTheme(configuredTheme)) {
    void persistAppTheme(theme).catch((error) => {
      console.error("Unable to migrate the saved color theme:", error);
    });
  }

  return theme;
};
