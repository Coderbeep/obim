import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  packaged: false,
  paths: {} as Record<string, string>,
  setPath: vi.fn<(name: string, value: string) => void>(),
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return state.packaged;
    },
    getPath: (name: string) => state.paths[name],
    setPath: state.setPath,
  },
  BrowserWindow: {},
  dialog: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

let directory: string;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), "obim-app-profile-"));
  state.packaged = false;
  state.paths = {
    appData: directory,
    userData: path.join(directory, "obim"),
    sessionData: path.join(directory, "obim"),
  };
  state.setPath.mockImplementation((name, value) => {
    state.paths[name] = value;
  });
  await mkdir(state.paths.userData);
  await writeFile(
    path.join(state.paths.userData, "config.json"),
    JSON.stringify({ theme: "dark", recentWorkspaces: ["/existing"] }),
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("development starts with separate settings and Chromium storage without modifying the installed profile", async () => {
  await import("../src/main/app-profile");
  const { default: config } = await import("../src/main/app-config");
  const developmentProfile = path.join(directory, "obim-dev");
  expect(state.paths.userData).toBe(developmentProfile);
  expect(state.paths.sessionData).toBe(developmentProfile);
  expect(config.getRecentWorkspacesSync()).toEqual([]);
  await config.updateConfig("theme", "light");
  expect(JSON.parse(await readFile(path.join(developmentProfile, "config.json"), "utf8")).theme).toBe("light");
  expect(JSON.parse(await readFile(path.join(directory, "obim/config.json"), "utf8"))).toEqual({
    theme: "dark",
    recentWorkspaces: ["/existing"],
  });
});

test("development reuses its own profile on subsequent launches", async () => {
  await mkdir(path.join(directory, "obim-dev"));
  await writeFile(path.join(directory, "obim-dev/config.json"), JSON.stringify({ recentWorkspaces: ["/development"] }));
  await import("../src/main/app-profile");
  const { default: config } = await import("../src/main/app-config");
  expect(config.getRecentWorkspacesSync()).toEqual(["/development"]);
});

test("packaged builds retain their existing settings and storage paths", async () => {
  state.packaged = true;
  await import("../src/main/app-profile");
  const { default: config } = await import("../src/main/app-config");
  expect(state.setPath).not.toHaveBeenCalled();
  expect(state.paths.userData).toBe(path.join(directory, "obim"));
  expect(state.paths.sessionData).toBe(path.join(directory, "obim"));
  expect(config.getRecentWorkspacesSync()).toEqual(["/existing"]);
  expect(config.getThemeSync()).toBe("dark");
});
