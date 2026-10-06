import { Switch } from "@renderer/shared/ui/switch";
import { GitSyncOutcomeStatus } from "@renderer/features/git/GitSyncOutcomeStatus";
import { workspaceMutationApi } from "@renderer/features/files/workspaceMutationApi";
import { IconRefresh } from "@pierre/icons";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@renderer/shared/classNames";
import { Button } from "@renderer/shared/ui/button";
import { Input } from "@renderer/shared/ui/input";
import type { GitFileStatusSnapshot, GitReadyRemoteSyncStatus, GitRemoteConfiguration } from "@shared/git";
import type { GitAutoSyncConflictResolution } from "@shared/config";

import "./GitSettings.css";

const statusDescription = (snapshot: GitFileStatusSnapshot | null) => {
  if (!snapshot) return "Checking…";
  if (snapshot.status === "not-repository") return "Off";
  if (snapshot.status === "unavailable") return snapshot.error;
  return snapshot.repositoryScope === "workspace" ? "On for this workspace" : "On in a parent folder";
};

const connectedRemoteMessage = (sync: GitReadyRemoteSyncStatus): { kind: "error" | "success"; text: string } => {
  if (sync.state === "branch-missing") {
    return {
      kind: "error",
      text: `Remote connected, but it has no ${sync.branch} branch. Obim will not choose another branch automatically.`,
    };
  }
  if (sync.state === "diverged") {
    return {
      kind: "error",
      text: "Remote connected. Local and remote history differ; resolve them in Version History.",
    };
  }
  return { kind: "success", text: "Remote connected." };
};

export const GitSettings = () => {
  const [snapshot, setSnapshot] = useState<GitFileStatusSnapshot | null>(null);
  const [remoteConfiguration, setRemoteConfiguration] = useState<GitRemoteConfiguration | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteDirty, setRemoteDirty] = useState(false);
  const [busyAction, setBusyAction] = useState<"auto-sync" | "ignore" | "initialize" | "refresh" | "remote" | null>(
    null,
  );
  const [repositoryMessage, setRepositoryMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [remoteMessage, setRemoteMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [ignorePatterns, setIgnorePatterns] = useState("");
  const [savedIgnorePatterns, setSavedIgnorePatterns] = useState("");
  const [ignoreMessage, setIgnoreMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [autoSyncInterval, setAutoSyncInterval] = useState(15);
  const [autoSyncResolution, setAutoSyncResolution] = useState<GitAutoSyncConflictResolution>("keep-local");
  const [autoSyncMessage, setAutoSyncMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshPendingRef = useRef(false);
  const forceRefreshPendingRef = useRef(false);
  const remoteDirtyRef = useRef(false);

  const applyRemoteConfiguration = useCallback((configuration: GitRemoteConfiguration, resetDraft = false) => {
    setRemoteConfiguration(configuration);
    if (resetDraft || !remoteDirtyRef.current) {
      setRemoteUrl(configuration.status === "ready" ? (configuration.remote?.fetchUrl ?? "") : "");
      remoteDirtyRef.current = false;
      setRemoteDirty(false);
    }
  }, []);

  const refreshRemote = useCallback(
    async (resetDraft = false) => {
      try {
        applyRemoteConfiguration(await window.api.getGitRemoteConfiguration(), resetDraft);
      } catch (error) {
        console.error("Unable to refresh Git remote configuration:", error);
        applyRemoteConfiguration(
          { status: "unavailable", error: "Git remote configuration is unavailable." },
          resetDraft,
        );
      }
    },
    [applyRemoteConfiguration],
  );

  const refresh = useCallback(
    (forceRefresh = false) => {
      if (refreshPromiseRef.current) {
        refreshPendingRef.current = true;
        forceRefreshPendingRef.current ||= forceRefresh;
        return refreshPromiseRef.current;
      }

      const request = (async () => {
        try {
          setSnapshot(await window.api.getGitFileStatus(forceRefresh));
        } catch (error) {
          console.error("Unable to refresh Git status:", error);
          setSnapshot({ status: "unavailable", changes: [], error: "Git status is unavailable." });
        }
        await refreshRemote();
      })();
      refreshPromiseRef.current = request;
      void request.finally(() => {
        if (refreshPromiseRef.current !== request) return;
        refreshPromiseRef.current = null;
        if (refreshPendingRef.current) {
          const forcePending = forceRefreshPendingRef.current;
          refreshPendingRef.current = false;
          forceRefreshPendingRef.current = false;
          void refresh(forcePending);
        }
      });
      return request;
    },
    [refreshRemote],
  );

  useEffect(() => {
    void refresh();
    if (typeof window.api.getGitIgnoreSettings === "function") {
      void window.api.getGitIgnoreSettings().then((result) => {
        if (result.status === "ready") {
          setIgnorePatterns(result.settings.patterns);
          setSavedIgnorePatterns(result.settings.patterns);
        } else setIgnoreMessage({ kind: "error", text: result.error });
      });
    }
    const refreshAutoSync = () => {
      if (typeof window.api.getGitAutoSyncSettings === "function") {
        void window.api.getGitAutoSyncSettings().then((settings) => {
          setAutoSyncEnabled(settings.intervalMinutes > 0);
          if (settings.intervalMinutes > 0) setAutoSyncInterval(settings.intervalMinutes);
          setAutoSyncResolution(settings.conflictResolution);
        });
      }
    };
    refreshAutoSync();
    return window.api.onGitFileStatusChanged((event) => {
      void refresh();
      if (event.autoSyncSettingsChanged) refreshAutoSync();
    });
  }, [refresh]);

  const saveIgnorePatterns = async () => {
    setBusyAction("ignore");
    setIgnoreMessage(null);
    try {
      const result = await workspaceMutationApi.updateGitIgnoreSettings(ignorePatterns);
      if (result.status === "failed") {
        setIgnoreMessage({ kind: "error", text: result.error });
        return;
      }
      setSavedIgnorePatterns(result.settings.patterns);
      setSnapshot(result.snapshot);
      setIgnoreMessage({
        kind: "success",
        text: result.untrackedPaths.length
          ? `Saved. ${result.untrackedPaths.length} previously tracked ${result.untrackedPaths.length === 1 ? "path is" : "paths are"} now excluded.`
          : "Ignore patterns saved.",
      });
    } catch (error) {
      console.error("Unable to update Git ignore patterns:", error);
      setIgnoreMessage({ kind: "error", text: "Git ignore patterns could not be saved." });
    } finally {
      setBusyAction(null);
    }
  };

  const saveAutoSync = async () => {
    setBusyAction("auto-sync");
    setAutoSyncMessage(null);
    try {
      await workspaceMutationApi.setGitAutoSyncSettings({
        conflictResolution: autoSyncResolution,
        intervalMinutes: autoSyncEnabled ? autoSyncInterval : 0,
      });
      setAutoSyncMessage({
        kind: "success",
        text: autoSyncEnabled ? `Auto-sync will run every ${autoSyncInterval} minutes.` : "Auto-sync is off.",
      });
    } catch (error) {
      console.error("Unable to update auto-sync:", error);
      setAutoSyncMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Auto-sync settings could not be saved.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const manuallyRefresh = async () => {
    setBusyAction("refresh");
    setRepositoryMessage(null);
    setRemoteMessage(null);
    try {
      await refresh(true);
    } finally {
      setBusyAction(null);
    }
  };

  const initialize = async () => {
    setRepositoryMessage(null);
    const confirmed = window.confirm(
      "Start local version history for this workspace? This creates a private local Git repository. Files will remain unstaged and nothing is uploaded.",
    );
    if (!confirmed) return;

    setBusyAction("initialize");
    try {
      const result = await workspaceMutationApi.initializeGitRepository();
      if (result.status === "failed") {
        setRepositoryMessage({ kind: "error", text: result.error });
        return;
      }
      setSnapshot(result.snapshot);
      await refreshRemote(true);
      setRepositoryMessage({
        kind: "success",
        text: "Local versions enabled.",
      });
    } catch (error) {
      console.error("Unable to initialize Git:", error);
      setRepositoryMessage({ kind: "error", text: "Git could not initialize this workspace." });
    } finally {
      setBusyAction(null);
    }
  };

  const updateRemoteDraft = (value: string) => {
    setRemoteUrl(value);
    remoteDirtyRef.current = true;
    setRemoteDirty(true);
    setRemoteMessage(null);
  };

  const saveRemote = async () => {
    if (!remoteUrl.trim() || busyAction !== null) return;
    setBusyAction("remote");
    setRemoteMessage(null);
    try {
      const result = await workspaceMutationApi.setGitRemoteUrl(remoteUrl);
      if (result.status === "failed") {
        setRemoteMessage({ kind: "error", text: result.error });
        return;
      }
      applyRemoteConfiguration(result.configuration, true);
      const checked = await workspaceMutationApi.fetchGitRemote();
      if (checked.status === "failed") {
        setRemoteMessage({
          kind: "error",
          text: `Remote URL was saved, but the connection failed: ${checked.error}`,
        });
        return;
      }
      setRemoteMessage(connectedRemoteMessage(checked.sync));
    } catch (error) {
      console.error("Unable to configure Git remote:", error);
      setRemoteMessage({ kind: "error", text: "Git could not configure the remote repository." });
    } finally {
      setBusyAction(null);
    }
  };

  const disconnectRemote = async () => {
    if (busyAction !== null) return;
    if (
      !window.confirm(
        "Disconnect this remote repository? Local versions, files, and the remote repository will not be deleted.",
      )
    )
      return;

    setBusyAction("remote");
    setRemoteMessage(null);
    try {
      const result = await workspaceMutationApi.removeGitRemote();
      if (result.status === "failed") {
        setRemoteMessage({ kind: "error", text: result.error });
        return;
      }
      applyRemoteConfiguration(result.configuration, true);
      setRemoteMessage({ kind: "success", text: "Remote disconnected." });
    } catch (error) {
      console.error("Unable to remove Git remote:", error);
      setRemoteMessage({ kind: "error", text: "Git could not disconnect the remote repository." });
    } finally {
      setBusyAction(null);
    }
  };

  const readyRemote = remoteConfiguration?.status === "ready" ? remoteConfiguration : null;

  return (
    <section className="settings-page" aria-label="Version history">
      <header className="settings-page-heading">
        <h2>Version history</h2>
        <p>Manage local versions and synchronize this workspace with a Git remote.</p>
      </header>
      <div className="settings-groups">
        <section className="settings-group" aria-labelledby="git-local-heading">
          <h3 id="git-local-heading">Local repository</h3>
          <div className="settings-group-card">
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>Local versions</strong>
                <span
                  className={cn(snapshot?.status === "unavailable" && "text-[var(--status-danger)]")}
                  role={snapshot?.status === "unavailable" ? "alert" : "status"}
                >
                  {statusDescription(snapshot)}
                </span>
              </div>
              <div className="settings-row-control">
                {snapshot?.status === "not-repository" ? (
                  <Button type="button" onClick={() => void initialize()} disabled={busyAction !== null}>
                    {busyAction === "initialize" ? "Enabling…" : "Enable"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="git-settings-refresh"
                  aria-busy={busyAction === "refresh"}
                  data-refreshing={busyAction === "refresh" ? "true" : undefined}
                  onClick={() => void manuallyRefresh()}
                  disabled={busyAction !== null}
                >
                  <IconRefresh size={14} />
                  Refresh
                </Button>
              </div>
            </div>
            {repositoryMessage ? (
              <p
                className={cn("settings-message", repositoryMessage.kind === "error" && "settings-message-error")}
                role={repositoryMessage.kind === "error" ? "alert" : "status"}
              >
                {repositoryMessage.text}
              </p>
            ) : null}
          </div>
        </section>

        {snapshot?.status === "ready" ? (
          <section className="settings-group" aria-labelledby="git-ignore-heading">
            <h3 id="git-ignore-heading">Ignored files</h3>
            <div className="settings-group-card git-settings-ignore-card">
              <label className="settings-row-copy" htmlFor="git-ignore-patterns">
                <strong>.gitignore patterns</strong>
                <span>
                  One pattern per line. Existing .gitignore rules outside Obim's managed section are preserved.
                </span>
              </label>
              <textarea
                id="git-ignore-patterns"
                aria-label=".gitignore patterns"
                className="git-settings-ignore-patterns font-mono"
                rows={6}
                value={ignorePatterns}
                placeholder={"Private/\n*.tmp\n.env"}
                disabled={busyAction !== null}
                onChange={(event) => {
                  setIgnorePatterns(event.target.value);
                  setIgnoreMessage(null);
                }}
              />
              <div className="git-settings-card-actions">
                <Button
                  type="button"
                  disabled={busyAction !== null || ignorePatterns === savedIgnorePatterns}
                  onClick={() => void saveIgnorePatterns()}
                >
                  {busyAction === "ignore" ? "Saving…" : "Save patterns"}
                </Button>
              </div>
              {ignoreMessage ? (
                <p
                  className={cn("settings-message", ignoreMessage.kind === "error" && "settings-message-error")}
                  role={ignoreMessage.kind === "error" ? "alert" : "status"}
                >
                  {ignoreMessage.text}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {snapshot?.status === "ready" && readyRemote?.remote ? (
          <section className="settings-group" aria-labelledby="git-auto-sync-heading">
            <h3 id="git-auto-sync-heading">Automatic sync</h3>
            <GitSyncOutcomeStatus />
            <div className="settings-group-card">
              <div className="settings-row">
                <div className="settings-row-copy">
                  <strong>Auto-sync</strong>
                  <span>
                    Create versions and sync only this workspace with its current origin and branch. Changing the
                    destination requires enabling sync again.
                  </span>
                </div>
                <div className="settings-row-control settings-switch-control" data-checked={autoSyncEnabled}>
                  <span className="settings-switch-state">{autoSyncEnabled ? "On" : "Off"}</span>
                  <Switch
                    role="switch"
                    aria-label="Auto-sync"
                    aria-checked={autoSyncEnabled}
                    disabled={busyAction !== null}
                    onClick={() => {
                      setAutoSyncEnabled((enabled) => !enabled);
                      setAutoSyncMessage(null);
                    }}
                  />
                </div>
              </div>
              <div className="settings-row">
                <label className="settings-row-copy" htmlFor="git-auto-sync-interval">
                  <strong>Interval</strong>
                  <span>How often Obim should create a version, then check, pull, and push.</span>
                </label>
                <div className="git-settings-interval-control">
                  <Input
                    id="git-auto-sync-interval"
                    aria-label="Interval"
                    type="number"
                    min={1}
                    max={1440}
                    value={autoSyncInterval}
                    disabled={!autoSyncEnabled || busyAction !== null}
                    onChange={(event) => {
                      setAutoSyncInterval(Math.max(1, Math.min(1440, Number(event.target.value) || 1)));
                      setAutoSyncMessage(null);
                    }}
                  />
                  <span>minutes</span>
                </div>
              </div>
              <fieldset className="git-settings-conflict-choice" disabled={!autoSyncEnabled || busyAction !== null}>
                <legend>When local and remote edits conflict</legend>
                <label>
                  <input
                    type="radio"
                    name="git-auto-sync-conflict"
                    checked={autoSyncResolution === "keep-local"}
                    onChange={() => {
                      setAutoSyncResolution("keep-local");
                      setAutoSyncMessage(null);
                    }}
                  />
                  <span>
                    <strong>Keep Local Changes</strong>
                    <small>Use this device's version for competing edits.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="git-auto-sync-conflict"
                    checked={autoSyncResolution === "use-remote"}
                    onChange={() => {
                      setAutoSyncResolution("use-remote");
                      setAutoSyncMessage(null);
                    }}
                  />
                  <span>
                    <strong>Use Remote Changes</strong>
                    <small>Use origin's version for competing edits.</small>
                  </span>
                </label>
              </fieldset>
              <div className="git-settings-card-actions">
                <Button type="button" disabled={busyAction !== null} onClick={() => void saveAutoSync()}>
                  {busyAction === "auto-sync" ? "Saving…" : "Save auto-sync"}
                </Button>
              </div>
              {autoSyncMessage ? (
                <p
                  className={cn("settings-message", autoSyncMessage.kind === "error" && "settings-message-error")}
                  role={autoSyncMessage.kind === "error" ? "alert" : "status"}
                >
                  {autoSyncMessage.text}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {snapshot?.status === "ready" ? (
          <section className="settings-group" aria-labelledby="git-remote-heading">
            <h3 id="git-remote-heading">Remote repository</h3>
            <div className="settings-group-card">
              {!remoteConfiguration ? <p className="settings-empty">Checking…</p> : null}
              {remoteConfiguration?.status === "unavailable" ? (
                <p className="settings-message settings-message-error" role="alert">
                  {remoteConfiguration.error}
                </p>
              ) : null}
              {readyRemote?.repositoryScope === "ancestor" ? (
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>Managed by a parent repository</strong>
                    <span>Remote settings are inherited from the repository containing this workspace.</span>
                  </div>
                  {readyRemote.remote ? (
                    <code className="git-settings-parent-url">{readyRemote.remote.fetchUrl}</code>
                  ) : null}
                </div>
              ) : null}
              {readyRemote?.repositoryScope === "workspace" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRemote();
                  }}
                >
                  <div className="settings-row git-settings-remote-row">
                    <label className="settings-row-copy" htmlFor="git-origin-url">
                      <strong>Repository URL</strong>
                      <span id="git-origin-help">
                        Use an empty repository for a new connection. Authentication comes from your system Git.
                      </span>
                    </label>
                    <Input
                      id="git-origin-url"
                      className="git-settings-remote-url font-mono"
                      value={remoteUrl}
                      placeholder="https://host/owner/repository.git"
                      aria-label="Repository URL"
                      aria-describedby="git-origin-help"
                      disabled={busyAction !== null}
                      onChange={(event) => updateRemoteDraft(event.target.value)}
                    />
                    <div className="git-settings-remote-actions">
                      <Button type="submit" disabled={busyAction !== null || !remoteDirty || !remoteUrl.trim()}>
                        {busyAction === "remote" ? "Saving…" : readyRemote.remote ? "Update" : "Connect"}
                      </Button>
                      {readyRemote.remote ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busyAction !== null}
                          onClick={() => void disconnectRemote()}
                        >
                          Disconnect
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {readyRemote.remote?.pushUrl ? (
                    <p className="settings-message">
                      Push currently uses <span className="break-all font-mono">{readyRemote.remote.pushUrl}</span>.
                      Updating replaces it.
                    </p>
                  ) : null}
                </form>
              ) : null}

              {remoteMessage ? (
                <p
                  className={cn("settings-message", remoteMessage.kind === "error" && "settings-message-error")}
                  role={remoteMessage.kind === "error" ? "alert" : "status"}
                >
                  {remoteMessage.text}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
};
