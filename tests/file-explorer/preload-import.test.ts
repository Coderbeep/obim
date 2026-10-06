import assert from "node:assert/strict";
import { afterAll, beforeAll, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  getPathForFile: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  sendSync: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      state.exposed.set(name, api);
    },
  },
  ipcRenderer: {
    invoke: state.invoke,
    on: state.on,
    removeListener: state.removeListener,
    sendSync: state.sendSync,
  },
  webUtils: {
    getPathForFile: state.getPathForFile,
  },
}));

let previousContextIsolated: PropertyDescriptor | undefined;
type PreloadApi = {
  abortGitRemoteReconciliation: () => Promise<unknown>;
  beginGitRemoteReconciliation: () => Promise<unknown>;
  commitGitChanges: (message: string) => Promise<unknown>;
  fetchGitRemote: () => Promise<unknown>;
  fingerprintWorkspaceFile: (filePath: string) => Promise<unknown>;
  getGitFileHistory: (filePath: string, cursor?: string, limit?: number) => Promise<unknown>;
  getGitConflictPreview: (request: unknown) => Promise<unknown>;
  getGitFileRevision: (request: unknown) => Promise<unknown>;
  getGitFileStatus: (forceRefresh?: boolean) => Promise<unknown>;
  getGitRemoteConfiguration: () => Promise<unknown>;
  getGitRemoteSyncStatus: () => Promise<unknown>;
  initializeGitRepository: () => Promise<unknown>;
  pullGitRemote: () => Promise<unknown>;
  pushGitRemote: () => Promise<unknown>;
  removeGitRemote: () => Promise<unknown>;
  resolveGitConflict: (request: unknown) => Promise<unknown>;
  revertGitPaths: (paths: string[]) => Promise<unknown>;
  restoreGitFileRevision: (request: unknown) => Promise<unknown>;
  setGitRemoteUrl: (url: string) => Promise<unknown>;
  stageGitPaths: (paths: string[]) => Promise<unknown>;
  unstageGitPaths: (paths: string[]) => Promise<unknown>;
  copyImageAt: (x: number, y: number) => Promise<unknown>;
  hasClipboardImageFiles: () => boolean;
  importClipboardImages: (destinationDirectoryPath: string) => Promise<unknown>;
  importExternalFiles: (files: File[], destinationDirectoryPath: string) => Promise<unknown>;
  onGitFileStatusChanged: (callback: (event: { treeMayHaveChanged: boolean }) => void) => () => void;
};

beforeAll(async () => {
  previousContextIsolated = Object.getOwnPropertyDescriptor(process, "contextIsolated");
  Object.defineProperty(process, "contextIsolated", { configurable: true, value: true });
  await import("../../src/preload/index");
});

afterAll(() => {
  if (previousContextIsolated) Object.defineProperty(process, "contextIsolated", previousContextIsolated);
  else Reflect.deleteProperty(process, "contextIsolated");
});

test("preload serializes path-backed files through webUtils paths", async () => {
  state.invoke.mockResolvedValueOnce({ importedPaths: [], errors: [] });
  const arrayBuffer = vi.fn();
  const file = { name: "report.md", arrayBuffer } as unknown as File;
  state.getPathForFile.mockReturnValueOnce("/outside/report.md");
  const api = state.exposed.get("api") as PreloadApi;

  await api.importExternalFiles([file], "/notes-root");

  assert.deepEqual(state.invoke.mock.lastCall, [
    "import-external-files",
    [{ kind: "path", path: "/outside/report.md" }],
    "/notes-root",
  ]);
  assert.equal(arrayBuffer.mock.calls.length, 0);
});

test("preload serializes pathless web files as exact bytes", async () => {
  state.invoke.mockResolvedValueOnce({ importedPaths: [], errors: [] });
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff]);
  const file = {
    name: "clipboard.png",
    arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
  } as unknown as File;
  state.getPathForFile.mockReturnValueOnce("");
  const api = state.exposed.get("api") as PreloadApi;

  await api.importExternalFiles([file], "/notes-root/images");

  const call = state.invoke.mock.lastCall;
  assert.equal(call?.[0], "import-external-files");
  assert.equal(call?.[2], "/notes-root/images");
  assert.deepEqual(call?.[1], [{ kind: "buffer", name: "clipboard.png", content: bytes }]);
});

test("preload routes native clipboard reads through the main process", async () => {
  state.sendSync.mockReturnValueOnce(true);
  state.invoke.mockResolvedValueOnce({ importedPaths: [], errors: [] });
  const api = state.exposed.get("api") as PreloadApi;

  assert.equal(api.hasClipboardImageFiles(), true);
  await api.importClipboardImages("/notes-root/attachments");

  assert.deepEqual(state.sendSync.mock.lastCall, ["has-clipboard-image-files"]);
  assert.deepEqual(state.invoke.mock.lastCall, ["import-clipboard-images", "/notes-root/attachments"]);
});

test("preload routes workspace fingerprints through the main process", async () => {
  state.invoke.mockResolvedValueOnce("sha256:report");
  const api = state.exposed.get("api") as PreloadApi;

  assert.equal(await api.fingerprintWorkspaceFile("/notes-root/report.pdf"), "sha256:report");
  assert.deepEqual(state.invoke.mock.lastCall, ["fingerprint-workspace-file", "/notes-root/report.pdf"]);
});

test("preload exposes Git status reads and a disposable refresh subscription", async () => {
  const snapshot = { status: "ready", changes: [], repositoryScope: "workspace" };
  state.invoke.mockResolvedValueOnce(snapshot);
  const api = state.exposed.get("api") as PreloadApi;
  const callback = vi.fn();

  assert.equal(await api.getGitFileStatus(), snapshot);
  assert.deepEqual(state.invoke.mock.lastCall, ["get-git-file-status", false]);

  state.invoke.mockResolvedValueOnce(snapshot);
  assert.equal(await api.getGitFileStatus(true), snapshot);
  assert.deepEqual(state.invoke.mock.lastCall, ["get-git-file-status", true]);

  const history = { status: "ready", entries: [], repositoryScope: "workspace" };
  state.invoke.mockResolvedValueOnce(history);
  assert.equal(await api.getGitFileHistory("/notes/note.md", "offset:50", 50), history);
  assert.deepEqual(state.invoke.mock.lastCall, ["get-git-file-history", "/notes/note.md", "offset:50", 50]);

  const revisionRequest = {
    filePath: "/notes/note.md",
    pathAtRevision: "note.md",
    revisionId: "a".repeat(40),
    restoreToken: "restore-token",
  };
  const revision = { status: "ready", content: "old note", revisionId: revisionRequest.revisionId, sizeBytes: 8 };
  state.invoke.mockResolvedValueOnce(revision);
  assert.equal(await api.getGitFileRevision(revisionRequest), revision);
  assert.deepEqual(state.invoke.mock.lastCall, ["get-git-file-revision", revisionRequest]);

  const restoreRequest = {
    ...revisionRequest,
    expectedVersion: { id: "note", mtimeMs: 10, sizeBytes: 8 },
  };
  const restoration = { status: "succeeded", created: false, version: restoreRequest.expectedVersion };
  state.invoke.mockResolvedValueOnce(restoration);
  assert.equal(await api.restoreGitFileRevision(restoreRequest), restoration);
  assert.deepEqual(state.invoke.mock.lastCall, ["restore-git-file-revision", restoreRequest]);

  const remote = { status: "ready", repositoryScope: "workspace" };
  state.invoke.mockResolvedValueOnce(remote);
  assert.equal(await api.getGitRemoteConfiguration(), remote);
  assert.deepEqual(state.invoke.mock.lastCall, ["get-git-remote-configuration"]);

  const remoteSync = { status: "not-configured" };
  state.invoke.mockResolvedValueOnce(remoteSync);
  assert.equal(await api.getGitRemoteSyncStatus(), remoteSync);
  assert.deepEqual(state.invoke.mock.lastCall, ["get-git-remote-sync-status"]);

  const initialization = { status: "succeeded", snapshot };
  state.invoke.mockResolvedValueOnce(initialization);
  assert.equal(await api.initializeGitRepository(), initialization);
  assert.deepEqual(state.invoke.mock.lastCall, ["initialize-git-repository"]);

  const operation = { status: "succeeded", snapshot };
  state.invoke.mockResolvedValue(operation);
  assert.equal(await api.stageGitPaths(["note.md"]), operation);
  assert.deepEqual(state.invoke.mock.lastCall, ["stage-git-paths", ["note.md"]]);
  assert.equal(await api.unstageGitPaths(["note.md"]), operation);
  assert.deepEqual(state.invoke.mock.lastCall, ["unstage-git-paths", ["note.md"]]);
  assert.equal(await api.revertGitPaths(["note.md"]), operation);
  assert.deepEqual(state.invoke.mock.lastCall, ["revert-git-paths", ["note.md"]]);
  assert.equal(await api.commitGitChanges("Save note"), operation);
  assert.deepEqual(state.invoke.mock.lastCall, ["commit-git-changes", "Save note"]);

  const remoteOperation = { status: "succeeded", configuration: remote };
  state.invoke.mockResolvedValue(remoteOperation);
  assert.equal(await api.setGitRemoteUrl("git@github.com:example/notes.git"), remoteOperation);
  assert.deepEqual(state.invoke.mock.lastCall, ["set-git-remote-url", "git@github.com:example/notes.git"]);
  assert.equal(await api.removeGitRemote(), remoteOperation);
  assert.deepEqual(state.invoke.mock.lastCall, ["remove-git-remote"]);

  const syncOperation = { status: "failed", error: "Not connected" };
  state.invoke.mockResolvedValue(syncOperation);
  assert.equal(await api.fetchGitRemote(), syncOperation);
  assert.deepEqual(state.invoke.mock.lastCall, ["fetch-git-remote"]);
  assert.equal(await api.pullGitRemote(), syncOperation);
  assert.deepEqual(state.invoke.mock.lastCall, ["pull-git-remote"]);
  assert.equal(await api.pushGitRemote(), syncOperation);
  assert.deepEqual(state.invoke.mock.lastCall, ["push-git-remote"]);
  assert.equal(await api.beginGitRemoteReconciliation(), syncOperation);
  assert.deepEqual(state.invoke.mock.lastCall, ["begin-git-remote-reconciliation"]);
  const conflictRequest = { path: "note.md", resolution: "save-both" };
  const conflictPreviewRequest = { path: "note.md" };
  assert.equal(await api.getGitConflictPreview(conflictPreviewRequest), syncOperation);
  assert.deepEqual(state.invoke.mock.lastCall, ["get-git-conflict-preview", conflictPreviewRequest]);
  assert.equal(await api.resolveGitConflict(conflictRequest), syncOperation);
  assert.deepEqual(state.invoke.mock.lastCall, ["resolve-git-conflict", conflictRequest]);
  assert.equal(await api.abortGitRemoteReconciliation(), syncOperation);
  assert.deepEqual(state.invoke.mock.lastCall, ["abort-git-remote-reconciliation"]);

  const dispose = api.onGitFileStatusChanged(callback);
  const listener = state.on.mock.lastCall?.[1] as (_event: unknown, change: { treeMayHaveChanged: boolean }) => void;
  listener({}, { treeMayHaveChanged: true });
  assert.deepEqual(callback.mock.lastCall, [{ treeMayHaveChanged: true }]);

  dispose();
  assert.deepEqual(state.removeListener.mock.lastCall, ["git-file-status-changed", listener]);
});

test("preload copies image coordinates without exposing the native clipboard", async () => {
  const api = state.exposed.get("api") as PreloadApi;
  await api.copyImageAt(120, 80);
  assert.deepEqual(state.invoke.mock.lastCall, ["copy-image-at", 120, 80]);
});
