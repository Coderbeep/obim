import type { WebContents } from "electron";
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { registerTrustedRenderer } from "../src/main/trusted-ipc";

const electronMocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  getAllWindows: vi.fn(() => [] as Array<{ setWindowButtonVisibility: (visible: boolean) => void }>),
  handle: vi.fn(),
  on: vi.fn(),
  quit: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getVersion: () => "1.0.0-test",
    getPath: () => "/tmp/obim-app-config-tests/missing-user-data",
    quit: electronMocks.quit,
  },
  BrowserWindow: {
    fromWebContents: electronMocks.fromWebContents,
    getAllWindows: electronMocks.getAllWindows,
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
  ipcMain: {
    handle: electronMocks.handle,
    on: electronMocks.on,
  },
}));

import ConfigManager from "../src/main/app-config";
import { normalizeCreationDirectory } from "../src/shared/config";

const rendererUrl = "file:///application/renderer/index.html";
const senderFrame = { url: rendererUrl };
const sender = { mainFrame: senderFrame, isDestroyed: () => false, once: vi.fn(), on: vi.fn() };
registerTrustedRenderer(sender as unknown as WebContents, rendererUrl);
const trustedEvent = { sender, senderFrame };

const windowControlsRegistration = electronMocks.handle.mock.calls.find(
  ([channel]) => channel === "set-show-window-controls",
);
assert.ok(windowControlsRegistration);
const setShowWindowControlsHandler = windowControlsRegistration[1] as (
  _event: unknown,
  visible: unknown,
) => Promise<void>;

const themeRegistration = electronMocks.handle.mock.calls.find(([channel]) => channel === "set-theme");
assert.ok(themeRegistration);
const setThemeHandler = themeRegistration[1] as (_event: unknown, theme: unknown) => Promise<void>;

const sidebarPlacementRegistration = electronMocks.handle.mock.calls.find(
  ([channel]) => channel === "set-sidebar-placement",
);
assert.ok(sidebarPlacementRegistration);
const setSidebarPlacementHandler = sidebarPlacementRegistration[1] as (
  _event: unknown,
  placement: unknown,
) => Promise<void>;

const zoomRegistration = electronMocks.handle.mock.calls.find(([channel]) => channel === "set-zoom-factor");
assert.ok(zoomRegistration);
const setZoomFactorHandler = zoomRegistration[1] as (
  event: { sender: unknown },
  zoomFactor: unknown,
) => Promise<number>;

const removeRecentWorkspaceRegistration = electronMocks.handle.mock.calls.find(
  ([channel]) => channel === "remove-recent-workspace",
);
assert.ok(removeRecentWorkspaceRegistration);
const removeRecentWorkspaceHandler = removeRecentWorkspaceRegistration[1] as (
  _event: unknown,
  workspacePath: unknown,
) => Promise<string[]>;

const updateConfigRegistration = electronMocks.handle.mock.calls.find(([channel]) => channel === "update-config");
assert.ok(updateConfigRegistration);
const updateConfigHandler = updateConfigRegistration[1] as (
  _event: unknown,
  key: unknown,
  value: unknown,
) => Promise<void>;

afterEach(() => vi.restoreAllMocks());

test("legacy configuration defaults to showing macOS window controls", () => {
  assert.equal(ConfigManager.getShowWindowControlsSync(), true);
});

test("legacy configuration reports no app-level theme so the renderer can migrate its local preference", () => {
  assert.equal(ConfigManager.getThemeSync(), null);
});

test("legacy configuration keeps the explorer on the left by default", () => {
  assert.equal(ConfigManager.getSidebarPlacementSync(), "explorer-left");
});

test("legacy configuration uses 100% interface zoom", () => {
  assert.equal(ConfigManager.getZoomFactorSync(), 1);
});

test("legacy configuration keeps automatic Git sync off with a local-first conflict policy", () => {
  assert.deepEqual(ConfigManager.getGitAutoSyncSettingsSync(), {
    conflictResolution: "keep-local",
    intervalMinutes: 0,
  });
});

test("missing workspace configuration is reported as unconfigured", () => {
  assert.deepEqual(ConfigManager.getWorkspaceStatusSync(), { status: "unconfigured" });
});

test("legacy configuration supplies defaults for settings added in later versions", async () => {
  assert.equal(await ConfigManager.getConfigValue("taskCreationDirectory"), "Tasks");
  assert.equal(await ConfigManager.getConfigValue("dailyNoteCreationDirectory"), "");
});

test("required workspace configuration still fails when it is missing", async () => {
  await assert.rejects(ConfigManager.getConfigValue("mainDirectory"), /Missing config value: mainDirectory/u);
});

test("creation folders accept user-entered nested workspace paths", () => {
  assert.equal(normalizeCreationDirectory(" Projects\\Client A\\Tasks/ "), "Projects/Client A/Tasks");
  assert.equal(normalizeCreationDirectory(""), "");
});

test("creation folders reject paths outside the workspace", () => {
  assert.equal(normalizeCreationDirectory("/Users/example/Tasks"), null);
  assert.equal(normalizeCreationDirectory("C:\\Users\\example\\Tasks"), null);
  assert.equal(normalizeCreationDirectory("Projects/../Tasks"), null);
});

test("daily note configuration rejects folders outside the workspace", async () => {
  await assert.rejects(
    ConfigManager.updateConfig("dailyNoteCreationDirectory", "../outside"),
    /inside the current workspace/,
  );
});

test("automatic Git sync configuration rejects unsafe intervals and conflict choices", async () => {
  await assert.rejects(ConfigManager.updateConfig("gitAutoSyncIntervalMinutes", -1), /between 1 and 1440/u);
  await assert.rejects(ConfigManager.updateConfig("gitAutoSyncConflictResolution", "save-both" as never), /valid/u);
});

test("cancelling the workspace picker keeps the app open", async () => {
  electronMocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });

  const result = await ConfigManager.initializeConfig();

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(electronMocks.quit.mock.calls.length, 0);
});

test("an arbitrary path cannot be selected through recent workspaces", async () => {
  const result = await ConfigManager.selectRecentWorkspace("/not/a/recent/workspace");

  assert.deepEqual(result, { status: "error", error: "That folder is not in the recent workspace list." });
});

test("recent-workspace removal IPC rejects invalid paths", async () => {
  const removeRecentWorkspace = vi.spyOn(ConfigManager, "removeRecentWorkspace").mockResolvedValue([]);

  await assert.rejects(removeRecentWorkspaceHandler(trustedEvent, null), /Invalid workspace path/);
  assert.equal(removeRecentWorkspace.mock.calls.length, 0);
});

test("recent-workspace removal IPC forgets the requested workspace", async () => {
  const removeRecentWorkspace = vi.spyOn(ConfigManager, "removeRecentWorkspace").mockResolvedValue(["/notes"]);

  assert.deepEqual(await removeRecentWorkspaceHandler(trustedEvent, "/archive"), ["/notes"]);
  assert.deepEqual(removeRecentWorkspace.mock.calls, [["/archive"]]);
});

test("window-controls IPC rejects non-boolean values before persisting", async () => {
  const updateConfig = vi.spyOn(ConfigManager, "updateConfig").mockResolvedValue();

  await assert.rejects(setShowWindowControlsHandler(trustedEvent, "hidden"), /must be a boolean/);
  assert.equal(updateConfig.mock.calls.length, 0);
});

test("window-controls IPC persists valid values", async () => {
  const updateConfig = vi.spyOn(ConfigManager, "updateConfig").mockResolvedValue();

  await setShowWindowControlsHandler(trustedEvent, false);

  assert.deepEqual(updateConfig.mock.calls, [["showWindowControls", false]]);
});

test("theme IPC rejects invalid values before persisting", async () => {
  const updateConfig = vi.spyOn(ConfigManager, "updateConfig").mockResolvedValue();

  await assert.rejects(setThemeHandler(trustedEvent, "sepia"), /must be light, dark, or system/);
  assert.equal(updateConfig.mock.calls.length, 0);
});

test("theme IPC persists valid values in app configuration", async () => {
  const updateConfig = vi.spyOn(ConfigManager, "updateConfig").mockResolvedValue();

  await setThemeHandler(trustedEvent, "dark");

  assert.deepEqual(updateConfig.mock.calls, [["theme", "dark"]]);
});

test("theme IPC persists the system theme preference", async () => {
  const updateConfig = vi.spyOn(ConfigManager, "updateConfig").mockResolvedValue();

  await setThemeHandler(trustedEvent, "system");

  assert.deepEqual(updateConfig.mock.calls, [["theme", "system"]]);
});

test("sidebar-placement IPC rejects invalid values before persisting", async () => {
  const updateConfig = vi.spyOn(ConfigManager, "updateConfig").mockResolvedValue();

  await assert.rejects(setSidebarPlacementHandler(trustedEvent, "both-right"), /explorer on the left or right/);
  assert.equal(updateConfig.mock.calls.length, 0);
});

test("zoom IPC normalizes, persists, and applies the requested scale", async () => {
  const setZoomFactor = vi.fn();
  electronMocks.fromWebContents.mockReturnValue({ webContents: { setZoomFactor } });
  const updateConfig = vi.spyOn(ConfigManager, "updateConfig").mockResolvedValue();

  assert.equal(await setZoomFactorHandler(trustedEvent, 1.26), 1.3);
  assert.deepEqual(updateConfig.mock.calls, [["zoomFactor", 1.3]]);
  assert.deepEqual(setZoomFactor.mock.calls, [[1.3]]);
});

test("sidebar-placement IPC persists a valid mirrored layout", async () => {
  const updateConfig = vi.spyOn(ConfigManager, "updateConfig").mockResolvedValue();

  await setSidebarPlacementHandler(trustedEvent, "explorer-right");

  assert.deepEqual(updateConfig.mock.calls, [["sidebarPlacement", "explorer-right"]]);
});

test("configuration writes reject an unregistered sender before persistence", () => {
  const update = vi.spyOn(ConfigManager, "updateConfig").mockResolvedValue();
  assert.throws(() => setThemeHandler({ sender: {}, senderFrame }, "dark"), /Untrusted renderer/);
  assert.equal(update.mock.calls.length, 0);
});

test("generic configuration IPC cannot change workspace or internal Git consent", async () => {
  const update = vi.spyOn(ConfigManager, "updateConfig").mockResolvedValue();
  for (const key of ["mainDirectory", "recentWorkspaces", "gitAutoSyncByWorkspace", "gitSyncOutcomesByWorkspace"]) {
    await assert.rejects(updateConfigHandler(trustedEvent, key, {}), /dedicated application action/);
  }
  assert.equal(update.mock.calls.length, 0);
});
