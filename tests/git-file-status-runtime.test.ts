import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeState = vi.hoisted(() => ({
  beginGitRemoteReconciliation: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  pullGitRemote: vi.fn(),
  readGitConflictPreview: vi.fn(),
  readGitFileStatus: vi.fn(),
  resolveGitConflict: vi.fn(),
  revertGitPaths: vi.fn(),
  send: vi.fn(),
  watchListener: undefined as ((eventType: string, filename: string | Buffer) => void) | undefined,
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/obim-test-user-data" },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: runtimeState.send },
      },
    ],
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      runtimeState.handlers.set(channel, handler);
    },
  },
}));

// Sender/origin authorization has separate trusted-ipc coverage; this fixture exercises Git scheduling.
vi.mock("../src/main/trusted-ipc", async () => ({ trustedIpcMain: (await import("electron")).ipcMain }));

vi.mock("node:fs", () => ({
  watch: vi.fn((_path, _options, listener: (eventType: string, filename: string | Buffer) => void) => {
    runtimeState.watchListener = listener;
    return { close: vi.fn(), on: vi.fn() };
  }),
}));

vi.mock("../src/main/app-config", () => ({
  default: {
    getConfigValue: vi.fn(async () => "/tmp/obim-test-workspace"),
    getConfigValueSync: vi.fn(() => "/tmp/obim-test-workspace"),
    onConfigChange: vi.fn(() => vi.fn()),
    setGitAutoSyncSettings: vi.fn(),
    getGitSyncOutcomeSync: vi.fn(),
    setGitSyncOutcome: vi.fn(),
    getGitAutoSyncSettingsSync: vi.fn(() => ({ conflictResolution: "keep-local", intervalMinutes: 0 })),
    updateConfig: vi.fn(),
  },
}));

vi.mock("../src/main/git-file-history", () => ({
  readGitFileHistory: vi.fn(),
  readGitFileRevision: vi.fn(),
  restoreGitFileRevision: vi.fn(),
}));

vi.mock("../src/main/git-file-status", () => {
  return {
    abortGitRemoteReconciliation: vi.fn(),
    autoSyncGitRemote: vi.fn(),
    beginGitRemoteReconciliation: runtimeState.beginGitRemoteReconciliation,
    commitGitChanges: vi.fn(),
    fetchGitRemote: vi.fn(),
    initializeGitRepository: vi.fn(),
    pullGitRemote: runtimeState.pullGitRemote,
    pushGitRemote: vi.fn(),
    readGitConflictPreview: runtimeState.readGitConflictPreview,
    readGitAutoSyncDestination: vi.fn(async () => ({ destination: "a".repeat(64) })),
    readGitSyncLocalState: vi.fn(async () => ({ localRevision: "a".repeat(40), uncommittedChanges: false })),
    readGitFileStatus: runtimeState.readGitFileStatus,
    readGitIgnoreSettings: vi.fn(),
    readGitRemoteConfiguration: vi.fn(),
    readGitRemoteSyncStatus: vi.fn(),
    removeGitRemote: vi.fn(),
    resolveGitConflict: runtimeState.resolveGitConflict,
    revertGitPaths: runtimeState.revertGitPaths,
    setGitRemoteUrl: vi.fn(),
    stageGitPaths: vi.fn(),
    unstageGitPaths: vi.fn(),
    updateGitIgnoreSettings: vi.fn(),
  };
});

import { closeGitFileStatusRuntime, registerGitFileStatusIpc } from "../src/main/git-file-status-runtime";
import { queueWorkspaceMutation } from "../src/main/workspace-mutations";

describe("Git file status IPC serialization", () => {
  beforeEach(() => {
    const snapshot = { status: "ready" as const, changes: [], repositoryScope: "workspace" as const };
    runtimeState.handlers.clear();
    runtimeState.beginGitRemoteReconciliation.mockReset();
    runtimeState.pullGitRemote.mockReset();
    runtimeState.readGitConflictPreview.mockReset();
    runtimeState.readGitFileStatus.mockReset();
    runtimeState.resolveGitConflict.mockReset();
    runtimeState.revertGitPaths.mockReset();
    runtimeState.send.mockReset();
    runtimeState.watchListener = undefined;
    runtimeState.readGitFileStatus.mockResolvedValue({
      gitDirectory: "/tmp/obim-test-workspace/.git",
      snapshot,
    });
    runtimeState.beginGitRemoteReconciliation.mockResolvedValue({
      status: "succeeded",
      action: "reconciliation-started",
      changedPaths: [{ kind: "modified", path: "note.md" }],
      snapshot: {
        ...snapshot,
        changes: [
          {
            conflicted: true,
            kind: "conflicted",
            path: "note.md",
            staged: false,
            workingTreeChanged: true,
          },
        ],
        mergeInProgress: true,
        remoteReconciliationInProgress: true,
      },
      sync: {
        status: "ready",
        ahead: 1,
        behind: 1,
        branch: "main",
        remote: { fetchUrl: "https://example.invalid/notes.git", name: "origin" },
        state: "diverged",
      },
    });
    runtimeState.revertGitPaths.mockResolvedValue({
      status: "succeeded",
      snapshot: { status: "ready", changes: [], repositoryScope: "workspace" },
    });
    runtimeState.pullGitRemote.mockResolvedValue({
      status: "succeeded",
      action: "up-to-date",
      snapshot: { status: "ready", changes: [], repositoryScope: "workspace" },
      sync: {
        status: "ready",
        ahead: 0,
        behind: 0,
        branch: "main",
        remote: { fetchUrl: "https://example.invalid/notes.git", name: "origin" },
        state: "up-to-date",
      },
    });
    runtimeState.resolveGitConflict.mockResolvedValue({
      status: "succeeded",
      changedPaths: [{ kind: "modified", path: "note.md" }],
      snapshot: { status: "ready", changes: [], repositoryScope: "workspace" },
    });
    runtimeState.readGitConflictPreview.mockResolvedValue({
      status: "ready",
      base: { status: "ready", content: "base", sizeBytes: 4 },
      local: { status: "ready", content: "local", sizeBytes: 5 },
      remote: { status: "ready", content: "remote", sizeBytes: 6 },
    });
    registerGitFileStatusIpc();
  });

  afterEach(() => closeGitFileStatusRuntime());

  it("waits for an active workspace mutation before reverting files", async () => {
    let releaseWorkspaceMutation!: () => void;
    const activeWorkspaceMutation = queueWorkspaceMutation(
      () =>
        new Promise<void>((resolve) => {
          releaseWorkspaceMutation = resolve;
        }),
    );
    await vi.waitFor(() => expect(releaseWorkspaceMutation).toBeTypeOf("function"));

    const revertHandler = runtimeState.handlers.get("revert-git-paths");
    expect(revertHandler).toBeTypeOf("function");
    const revert = Promise.resolve(revertHandler?.({}, ["note.md"]));
    await Promise.resolve();
    expect(runtimeState.revertGitPaths).not.toHaveBeenCalled();

    releaseWorkspaceMutation();
    await activeWorkspaceMutation;
    await revert;
    expect(runtimeState.revertGitPaths).toHaveBeenCalledWith("/tmp/obim-test-workspace", ["note.md"]);
  });

  it("invalidates Git status after an application-owned note save", async () => {
    vi.useFakeTimers();
    try {
      await queueWorkspaceMutation(async () => undefined);
      expect(runtimeState.send).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(251);
      expect(runtimeState.send).toHaveBeenCalledWith("git-file-status-changed", { treeMayHaveChanged: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes Pull's local apply phase while allowing its network phase to start", async () => {
    let releaseWorkspaceMutation!: () => void;
    const activeWorkspaceMutation = queueWorkspaceMutation(
      () =>
        new Promise<void>((resolve) => {
          releaseWorkspaceMutation = resolve;
        }),
    );
    await vi.waitFor(() => expect(releaseWorkspaceMutation).toBeTypeOf("function"));
    let applied = false;
    runtimeState.pullGitRemote.mockImplementationOnce((_workspace, _hooks, options) =>
      options.runLocal(async () => {
        applied = true;
        return { status: "failed", error: "controlled apply result" };
      }),
    );
    const pull = Promise.resolve(runtimeState.handlers.get("pull-git-remote")?.({}));
    try {
      await vi.waitFor(() => expect(runtimeState.pullGitRemote).toHaveBeenCalled());
      expect(applied).toBe(false);
    } finally {
      releaseWorkspaceMutation();
      await activeWorkspaceMutation;
      await pull;
    }
    expect(applied).toBe(true);
  });

  it("defers watcher notifications until reconciliation finishes", async () => {
    const statusHandler = runtimeState.handlers.get("get-git-file-status");
    expect(statusHandler).toBeTypeOf("function");
    await Promise.resolve(statusHandler?.({}, true));
    expect(runtimeState.watchListener).toBeTypeOf("function");

    let finishReconciliation!: (result: Awaited<ReturnType<typeof runtimeState.beginGitRemoteReconciliation>>) => void;
    runtimeState.beginGitRemoteReconciliation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReconciliation = resolve;
        }),
    );
    const reconciliationHandler = runtimeState.handlers.get("begin-git-remote-reconciliation");
    expect(reconciliationHandler).toBeTypeOf("function");
    const reconciliation = Promise.resolve(reconciliationHandler?.({}));
    await vi.waitFor(() => expect(runtimeState.beginGitRemoteReconciliation).toHaveBeenCalledOnce());

    vi.useFakeTimers();
    try {
      runtimeState.watchListener?.("change", "note.md");
      await vi.advanceTimersByTimeAsync(251);
      expect(runtimeState.send.mock.calls.filter(([channel]) => channel === "git-file-status-changed")).toHaveLength(0);

      const result = {
        status: "succeeded" as const,
        action: "reconciliation-started" as const,
        changedPaths: [{ kind: "modified" as const, path: "note.md" }],
        snapshot: {
          status: "ready" as const,
          changes: [],
          mergeInProgress: true,
          remoteReconciliationInProgress: true,
          repositoryScope: "workspace" as const,
        },
        sync: {
          status: "ready" as const,
          ahead: 1,
          behind: 1,
          branch: "main",
          remote: { fetchUrl: "https://example.invalid/notes.git", name: "origin" as const },
          state: "diverged" as const,
        },
      };
      finishReconciliation(result);
      await reconciliation;
      await vi.advanceTimersByTimeAsync(251);

      expect(runtimeState.send.mock.calls.filter(([channel]) => channel === "git-file-status-changed")).toHaveLength(1);
      expect(runtimeState.send).toHaveBeenCalledWith("git-file-status-changed", {
        paths: ["note.md"],
        treeMayHaveChanged: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates and forwards explicit conflict resolution choices", async () => {
    const handler = runtimeState.handlers.get("resolve-git-conflict");
    expect(handler).toBeTypeOf("function");

    await expect(Promise.resolve(handler?.({}, { path: "note.md", resolution: "overwrite" }))).resolves.toEqual({
      status: "failed",
      error: "Select a valid conflict resolution choice.",
    });
    expect(runtimeState.resolveGitConflict).not.toHaveBeenCalled();

    await Promise.resolve(handler?.({}, { path: "note.md", resolution: "save-both" }));
    expect(runtimeState.resolveGitConflict).toHaveBeenCalledWith("/tmp/obim-test-workspace", "note.md", "save-both");
  });

  it("reads conflict previews through the serialized workspace queue", async () => {
    const handler = runtimeState.handlers.get("get-git-conflict-preview");
    expect(handler).toBeTypeOf("function");

    await Promise.resolve(handler?.({}, { path: "note.md" }));
    expect(runtimeState.readGitConflictPreview).toHaveBeenCalledWith("/tmp/obim-test-workspace", "note.md");
  });
});

it("does not send a schedule enabled in workspace A to workspace B (G03)", async () => {
  const { default: config } = await import("../src/main/app-config");
  const { autoSyncGitRemote } = await import("../src/main/git-file-status");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.mocked(config.getConfigValue).mockResolvedValue("/tmp/workspace-A" as never);
  vi.mocked(config.getConfigValueSync).mockReturnValue("/tmp/workspace-A" as never);
  vi.mocked(config.getGitAutoSyncSettingsSync).mockReturnValue({
    conflictResolution: "keep-local",
    intervalMinutes: 1,
    destination: "a".repeat(64),
  });
  vi.mocked(autoSyncGitRemote).mockResolvedValue({ status: "failed", error: "test outcome" });
  try {
    registerGitFileStatusIpc();
    vi.mocked(config.getConfigValue).mockResolvedValue("/tmp/workspace-B" as never);
    vi.mocked(config.getConfigValueSync).mockReturnValue("/tmp/workspace-B" as never);
    await vi.advanceTimersByTimeAsync(60_000);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(vi.mocked(autoSyncGitRemote).mock.calls.every(([workspace]) => workspace !== "/tmp/workspace-B")).toBe(true);
  } finally {
    closeGitFileStatusRuntime();
    vi.mocked(config.getConfigValue).mockResolvedValue("/tmp/obim-test-workspace" as never);
    vi.mocked(config.getConfigValueSync).mockReturnValue("/tmp/obim-test-workspace" as never);
    vi.mocked(config.getGitAutoSyncSettingsSync).mockReturnValue({
      conflictResolution: "keep-local",
      intervalMinutes: 0,
    });
    vi.useRealTimers();
  }
});

it("reports a changed destination as disabled without carrying its consent to the replacement", async () => {
  const { default: config } = await import("../src/main/app-config");
  const { readGitAutoSyncDestination } = await import("../src/main/git-file-status");
  vi.mocked(config.getGitAutoSyncSettingsSync).mockReturnValue({
    conflictResolution: "keep-local",
    intervalMinutes: 1,
    destination: "a".repeat(64),
  });
  vi.mocked(readGitAutoSyncDestination).mockResolvedValue({ destination: "b".repeat(64) });
  try {
    registerGitFileStatusIpc();
    await expect(runtimeState.handlers.get("get-git-auto-sync-settings")?.()).resolves.toMatchObject({
      intervalMinutes: 0,
    });
  } finally {
    closeGitFileStatusRuntime();
    vi.mocked(config.getGitAutoSyncSettingsSync).mockReturnValue({
      conflictResolution: "keep-local",
      intervalMinutes: 0,
    });
    vi.mocked(readGitAutoSyncDestination).mockResolvedValue({ destination: "a".repeat(64) });
  }
});

it("publishes a scheduled authentication failure instead of silently dropping it (G06)", async () => {
  const { default: config } = await import("../src/main/app-config");
  const { autoSyncGitRemote } = await import("../src/main/git-file-status");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.mocked(config.getGitAutoSyncSettingsSync).mockReturnValue({
    conflictResolution: "keep-local",
    intervalMinutes: 1,
    destination: "a".repeat(64),
  });
  vi.mocked(autoSyncGitRemote).mockResolvedValue({ status: "failed", error: "Authentication failed" });
  try {
    registerGitFileStatusIpc();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(autoSyncGitRemote).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      runtimeState.send.mock.calls.some(
        ([channel, outcome]) => channel === "git-sync-outcome-changed" && outcome.phase === "failed",
      ),
    ).toBe(true);
  } finally {
    closeGitFileStatusRuntime();
    vi.mocked(config.getGitAutoSyncSettingsSync).mockReturnValue({
      conflictResolution: "keep-local",
      intervalMinutes: 0,
    });
    vi.useRealTimers();
  }
});

it("keeps a persisted interrupted attempt visible after runtime restart", async () => {
  const { default: config } = await import("../src/main/app-config");
  vi.mocked(config.getGitSyncOutcomeSync).mockReturnValue({
    workspacePath: "/tmp/obim-test-workspace",
    source: "scheduled",
    phase: "running",
    startedAt: 1,
    localCommitCreated: false,
    uncommittedChanges: false,
    failureCount: 0,
  });
  try {
    registerGitFileStatusIpc();
    const result = await runtimeState.handlers.get("get-git-sync-outcome")?.();
    expect(result).toMatchObject({ phase: "failed", error: expect.stringContaining("interrupted") });
  } finally {
    closeGitFileStatusRuntime();
    vi.mocked(config.getGitSyncOutcomeSync).mockReturnValue(undefined);
  }
});

it("backs off repeated scheduled failures without losing their visible error", async () => {
  const { default: config } = await import("../src/main/app-config");
  const { autoSyncGitRemote } = await import("../src/main/git-file-status");
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.mocked(config.getGitAutoSyncSettingsSync).mockReturnValue({
    conflictResolution: "keep-local",
    intervalMinutes: 1,
    destination: "a".repeat(64),
  });
  vi.mocked(autoSyncGitRemote).mockResolvedValue({
    status: "failed",
    error: "push failed https://user:secret@host.invalid/notes?token=token-secret",
  });
  try {
    registerGitFileStatusIpc();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() =>
      expect(config.setGitSyncOutcome).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ phase: "failed", failureCount: 1 }),
      ),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(autoSyncGitRemote).toHaveBeenCalledTimes(1);
    const outcome = (await runtimeState.handlers.get("get-git-sync-outcome")?.()) as { error: string };
    expect(outcome.error).not.toContain("secret");
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(autoSyncGitRemote).toHaveBeenCalledTimes(2));
  } finally {
    closeGitFileStatusRuntime();
    vi.mocked(config.getGitAutoSyncSettingsSync).mockReturnValue({
      conflictResolution: "keep-local",
      intervalMinutes: 0,
    });
    vi.useRealTimers();
  }
});

it("lets local saves finish while a remote pull is waiting (G07)", async () => {
  let release!: () => void;
  runtimeState.pullGitRemote.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ status: "failed", error: "controlled remote end" });
      }),
  );
  registerGitFileStatusIpc();
  const pulling = Promise.resolve(runtimeState.handlers.get("pull-git-remote")?.({}));
  let saving: Promise<void> | undefined;
  try {
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    let saved = false;
    saving = queueWorkspaceMutation(async () => {
      saved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(saved).toBe(true);
  } finally {
    release?.();
    await pulling;
    await saving;
    closeGitFileStatusRuntime();
  }
});

it("cancels a pending network job and preserves single-flight Git ownership", async () => {
  let signal: AbortSignal | undefined;
  runtimeState.pullGitRemote.mockImplementationOnce(
    (_workspace, _hooks, options) =>
      new Promise((resolve) => {
        signal = options.signal;
        signal!.addEventListener(
          "abort",
          () => resolve({ status: "failed", error: "Git synchronization was cancelled." }),
          { once: true },
        );
      }),
  );
  registerGitFileStatusIpc();
  const pulling = Promise.resolve(runtimeState.handlers.get("pull-git-remote")?.({}));
  try {
    await vi.waitFor(() => expect(signal).toBeDefined());
    await expect(runtimeState.handlers.get("push-git-remote")?.({})).resolves.toMatchObject({
      status: "failed",
      error: expect.stringContaining("still running"),
    });
    await expect(runtimeState.handlers.get("run-git-auto-sync")?.({})).resolves.toMatchObject({
      status: "failed",
      error: expect.stringContaining("still running"),
    });
    expect(runtimeState.handlers.get("cancel-git-sync")?.({})).toBe(true);
    await expect(pulling).resolves.toMatchObject({ status: "failed", error: expect.stringContaining("cancelled") });
    expect(signal?.aborted).toBe(true);
  } finally {
    closeGitFileStatusRuntime();
    await pulling;
  }
});

it("shutdown aborts an owned network job before it can enter another local phase", async () => {
  let signal: AbortSignal | undefined;
  runtimeState.pullGitRemote.mockImplementationOnce(
    (_workspace, _hooks, options) =>
      new Promise((resolve) => {
        signal = options.signal;
        signal!.addEventListener("abort", () => resolve({ status: "failed", error: "cancelled on shutdown" }), {
          once: true,
        });
      }),
  );
  registerGitFileStatusIpc();
  const pulling = Promise.resolve(runtimeState.handlers.get("pull-git-remote")?.({}));
  await vi.waitFor(() => expect(signal).toBeDefined());
  closeGitFileStatusRuntime();
  await expect(pulling).resolves.toMatchObject({ status: "failed" });
  expect(signal?.aborted).toBe(true);
});

it("stops a delayed job on workspace switch and records its outcome against the captured workspace", async () => {
  const { default: config } = await import("../src/main/app-config");
  let release!: () => void;
  let applied = false;
  runtimeState.pullGitRemote.mockImplementationOnce(async (_workspace, _hooks, options) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return options.runLocal(async () => {
      applied = true;
      return { status: "failed", error: "unexpected apply" };
    });
  });
  registerGitFileStatusIpc();
  const pulling = Promise.resolve(runtimeState.handlers.get("pull-git-remote")?.({}));
  try {
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    vi.mocked(config.getConfigValue).mockResolvedValue("/tmp/workspace-B" as never);
    vi.mocked(config.getConfigValueSync).mockReturnValue("/tmp/workspace-B" as never);
    vi.mocked(config.onConfigChange).mock.calls.at(-1)![0](["mainDirectory"]);
    release();
    await expect(pulling).resolves.toMatchObject({ status: "failed", error: expect.stringContaining("cancelled") });
    expect(applied).toBe(false);
    expect(config.setGitSyncOutcome).toHaveBeenLastCalledWith(
      "/tmp/obim-test-workspace",
      expect.objectContaining({
        workspacePath: "/tmp/obim-test-workspace",
        phase: "failed",
      }),
    );
  } finally {
    release?.();
    await pulling;
    closeGitFileStatusRuntime();
    vi.mocked(config.getConfigValue).mockResolvedValue("/tmp/obim-test-workspace" as never);
    vi.mocked(config.getConfigValueSync).mockReturnValue("/tmp/obim-test-workspace" as never);
  }
});
