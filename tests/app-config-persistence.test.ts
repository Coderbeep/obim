import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/obim-config-persistence-unused" },
  BrowserWindow: {},
  dialog: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
import ConfigManager from "../src/main/app-config";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
const setup = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "obim-config-persistence-"));
  directories.push(directory);
  const configPath = path.join(directory, "config.json");
  (ConfigManager as unknown as { CONFIG_PATH: string }).CONFIG_PATH = configPath;
  await writeFile(configPath, JSON.stringify({ mainDirectory: directory, recentWorkspaces: [directory, "/old"] }));
  return { directory, configPath };
};
test("concurrent configuration mutations preserve every completed setting", async () => {
  const { configPath } = await setup();
  await Promise.all([
    ConfigManager.updateConfig("theme", "dark"),
    ConfigManager.updateConfig("sidebarPlacement", "explorer-right"),
    ConfigManager.updateConfig("zoomFactor", 1.4),
    ConfigManager.removeRecentWorkspace("/old"),
  ]);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.theme, "dark");
  assert.equal(config.sidebarPlacement, "explorer-right");
  assert.equal(config.zoomFactor, 1.4);
  assert.deepEqual(config.recentWorkspaces, [config.mainDirectory]);
  assert.equal(ConfigManager.getThemeSync(), "dark");
});

test("ordered updates publish complete snapshots to synchronous readers", async () => {
  const { configPath } = await setup();
  const observations: unknown[] = [];
  const observer = setInterval(() => {
    observations.push(JSON.parse(readFileSync(configPath, "utf8")));
    ConfigManager.getThemeSync();
  }, 1);
  try {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => ConfigManager.updateConfig("zoomFactor", 1 + index / 100)),
    );
  } finally {
    clearInterval(observer);
  }
  assert.ok(observations.length > 0);
  assert.equal(ConfigManager.getZoomFactorSync(), 1.2);
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).zoomFactor, 1.19);
});

test("corrupt primary and abandoned temporary writes recover the last valid workspace", async () => {
  const { directory, configPath } = await setup();
  await ConfigManager.updateConfig("theme", "dark");
  await ConfigManager.updateConfig("sidebarPlacement", "explorer-right");
  await writeFile(configPath, '{"mainDirectory":');
  await writeFile(`${configPath}.abandoned.tmp`, '{"theme":');
  assert.equal(ConfigManager.getConfigValueSync("mainDirectory"), directory);
  assert.equal(ConfigManager.getThemeSync(), "dark");
  await ConfigManager.updateConfig("zoomFactor", 1.5);
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).mainDirectory, directory);
  assert.equal(ConfigManager.getZoomFactorSync(), 1.5);
});

test("unrecoverable corruption is preserved instead of overwritten with defaults", async () => {
  const { configPath } = await setup();
  await writeFile(configPath, "broken saved configuration");
  await assert.rejects(ConfigManager.updateConfig("theme", "dark"), /preserved for recovery/);
  assert.equal(await readFile(configPath, "utf8"), "broken saved configuration");
});

test("a failed replacement retains the committed settings and does not poison subsequent updates", async () => {
  const { configPath } = await setup();
  await ConfigManager.updateConfig("theme", "dark");
  const persistence = await import("node:fs/promises");
  const originalRename = persistence.rename;
  const renameSpy = vi.spyOn(persistence, "rename").mockImplementation(async (source, destination) => {
    if (destination === configPath) throw new Error("Injected replacement failure");
    return originalRename(source, destination);
  });
  try {
    await assert.rejects(ConfigManager.updateConfig("theme", "light"), /Injected replacement failure/);
    assert.equal(ConfigManager.getThemeSync(), "dark");
  } finally {
    renameSpy.mockRestore();
  }
  await ConfigManager.updateConfig("sidebarPlacement", "explorer-right");
  assert.equal(ConfigManager.getThemeSync(), "dark");
  assert.equal(ConfigManager.getSidebarPlacementSync(), "explorer-right");
});

test("workspace selection and settings migration share the same ordered mutation boundary", async () => {
  const { directory, configPath } = await setup();
  const secondWorkspace = await mkdtemp(path.join(directory, "workspace-"));
  await writeFile(
    configPath,
    JSON.stringify({
      mainDirectory: directory,
      recentWorkspaces: [directory, secondWorkspace],
      sourcesUnpaywallEmail: "legacy@example.invalid",
    }),
  );
  const [selected] = await Promise.all([
    ConfigManager.selectRecentWorkspace(secondWorkspace),
    ConfigManager.updateConfig("theme", "dark"),
    ConfigManager.removeDeprecatedSourcesSettings(),
  ]);
  assert.equal(selected.status, "selected");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.mainDirectory, secondWorkspace);
  assert.equal(config.theme, "dark");
  assert.deepEqual(config.recentWorkspaces, [secondWorkspace, directory]);
  assert.equal("sourcesUnpaywallEmail" in config, false);
  assert.equal(ConfigManager.getConfigValueSync("mainDirectory"), secondWorkspace);
});

test("legacy automatic intervals do not enable any workspace and explicit consent remains workspace-bound", async () => {
  const { directory, configPath } = await setup();
  const secondWorkspace = await mkdtemp(path.join(directory, "workspace-"));
  await writeFile(
    configPath,
    JSON.stringify({
      mainDirectory: directory,
      gitAutoSyncIntervalMinutes: 1,
      gitAutoSyncConflictResolution: "use-remote",
    }),
  );
  assert.equal(ConfigManager.getGitAutoSyncSettingsSync(directory).intervalMinutes, 0);
  assert.equal(ConfigManager.getGitAutoSyncSettingsSync(secondWorkspace).intervalMinutes, 0);
  await Promise.all([
    ConfigManager.setGitAutoSyncSettings(directory, {
      destination: "a".repeat(64),
      intervalMinutes: 2,
      conflictResolution: "keep-local",
    }),
    ConfigManager.updateConfig("theme", "dark"),
  ]);
  assert.equal(ConfigManager.getGitAutoSyncSettingsSync(directory).intervalMinutes, 2);
  assert.equal(ConfigManager.getGitAutoSyncSettingsSync(secondWorkspace).intervalMinutes, 0);
  await ConfigManager.updateConfig("mainDirectory", secondWorkspace);
  assert.equal(ConfigManager.getGitAutoSyncSettingsSync().intervalMinutes, 0);
  await ConfigManager.updateConfig("mainDirectory", directory);
  assert.equal(ConfigManager.getGitAutoSyncSettingsSync().destination, "a".repeat(64));
  const persisted = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(persisted.gitAutoSyncIntervalMinutes, undefined);
  assert.equal(persisted.gitAutoSyncByWorkspace[await realpath(directory)].intervalMinutes, 2);
  assert.equal(persisted.theme, "dark");
});

test("saved synchronization failures survive rereads and remain separate for each workspace", async () => {
  const { directory } = await setup();
  const secondWorkspace = await mkdtemp(path.join(directory, "workspace-"));
  const failed = {
    workspacePath: directory,
    source: "scheduled" as const,
    phase: "failed" as const,
    startedAt: 1,
    finishedAt: 2,
    localRevision: "a".repeat(40),
    localCommitCreated: true,
    uncommittedChanges: false,
    failureCount: 2,
    error: "Authentication failed",
  };
  await ConfigManager.setGitSyncOutcome(directory, failed);
  await ConfigManager.setGitSyncOutcome(secondWorkspace, {
    ...failed,
    workspacePath: secondWorkspace,
    phase: "succeeded",
    error: undefined,
    uploadedRevision: "b".repeat(40),
    failureCount: 0,
  });
  await ConfigManager.updateConfig("theme", "light");
  assert.deepEqual(ConfigManager.getGitSyncOutcomeSync(directory), failed);
  assert.equal(ConfigManager.getGitSyncOutcomeSync(secondWorkspace)?.phase, "succeeded");
  assert.equal(ConfigManager.getGitSyncOutcomeSync(directory)?.uploadedRevision, undefined);
});
