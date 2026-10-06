// @vitest-environment jsdom

import assert from "node:assert/strict";

import { afterEach, beforeEach, test, vi } from "vitest";

import {
  APP_THEME_STORAGE_KEY,
  applyAppTheme,
  initializeAppTheme,
  readAppTheme,
  type AppTheme,
} from "../src/renderer/src/app/theme";

let configuredTheme: AppTheme | null;
let setTheme: ReturnType<typeof vi.fn>;
let prefersDark = false;
let mediaListeners: Set<() => void>;

beforeEach(() => {
  configuredTheme = null;
  setTheme = vi.fn(async (theme: AppTheme) => {
    configuredTheme = theme;
  });
  mediaListeners = new Set();
  prefersDark = false;
  window.matchMedia = vi.fn(
    () =>
      ({
        get matches() {
          return prefersDark;
        },
        addEventListener: (_event: string, listener: () => void) => mediaListeners.add(listener),
        removeEventListener: (_event: string, listener: () => void) => mediaListeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
  window.config = {
    getThemeSync: () => configuredTheme,
    setTheme,
  } as unknown as Window["config"];
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  applyAppTheme("light");
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

test("app configuration takes precedence over renderer-local legacy storage", () => {
  configuredTheme = "light";
  window.localStorage.setItem(APP_THEME_STORAGE_KEY, "dark");

  assert.equal(readAppTheme(), "light");
  initializeAppTheme();

  assert.equal(document.documentElement.classList.contains("dark"), false);
  assert.equal(setTheme.mock.calls.length, 0);
});

test("a legacy local theme is applied immediately and migrated to app configuration", async () => {
  window.localStorage.setItem(APP_THEME_STORAGE_KEY, "dark");

  assert.equal(initializeAppTheme(), "dark");
  assert.equal(document.documentElement.classList.contains("dark"), true);
  await vi.waitFor(() => assert.deepEqual(setTheme.mock.calls, [["dark"]]));
});

test("the system theme follows operating-system changes while the app is open", () => {
  prefersDark = true;
  applyAppTheme("system");
  assert.equal(document.documentElement.classList.contains("dark"), true);

  prefersDark = false;
  mediaListeners.forEach((listener) => listener());
  assert.equal(document.documentElement.classList.contains("dark"), false);

  applyAppTheme("dark");
  assert.equal(mediaListeners.size, 0);
});
