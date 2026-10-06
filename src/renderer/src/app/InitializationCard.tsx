import { switchWorkspaceSafely } from "@renderer/features/files/workspaceTransition";
import { IconFolderOpen, IconWarningOctogonFill } from "@pierre/icons";
import { useSetAtom, useStore } from "jotai";
import { useState } from "react";

import { Button } from "@renderer/shared/ui/button";
import { isAppInitializedAtom } from "@renderer/store/appSessionStore";
import type { WorkspaceStatus } from "@shared/config";

export const InitializationCard = () => {
  const store = useStore();
  const setIsInitialized = useSetAtom(isAppInitializedAtom);
  const [workspaceStatus] = useState<WorkspaceStatus>(() => window.config.getWorkspaceStatusSync());
  const [isChoosing, setIsChoosing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleOnClick = async () => {
    setIsChoosing(true);
    setMessage(null);
    try {
      const result = await switchWorkspaceSafely(
        store,
        () => window.config.initializeConfig(),
        () => setIsInitialized(true),
        false,
      );
      if (result.status === "cancelled") {
        setMessage("No folder was selected. You can choose one whenever you're ready.");
      } else if (result.status === "error") {
        setMessage(result.error);
      }
    } finally {
      setIsChoosing(false);
    }
  };

  return (
    <main className="flex h-full select-none items-center justify-center bg-[var(--surface-canvas)] px-6 text-foreground">
      <section className="w-full max-w-[34rem] rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-7 shadow-[var(--shadow-2)]">
        <div className="mb-7 flex size-11 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--chip-selected)] text-[var(--accent)]">
          <IconFolderOpen size={22} aria-hidden="true" />
        </div>
        <h1 className="text-ui-heading font-bold">
          {workspaceStatus.status === "unavailable" ? "Reconnect your workspace" : "Choose your workspace"}
        </h1>
        <p className="mt-2 max-w-[29rem] text-ui-body leading-relaxed text-muted-foreground">
          Obim keeps your notes as regular Markdown files in a folder you control. Choose an existing folder or create a
          new one in the system dialog.
        </p>

        {workspaceStatus.status === "unavailable" ? (
          <div
            className="mt-5 rounded-[var(--radius-control)] border border-[var(--status-warning)] bg-[var(--chip-warning)] p-3 text-ui-control"
            role="alert"
          >
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <IconWarningOctogonFill size={15} aria-hidden="true" />
              Previous folder is unavailable
            </div>
            <p className="mt-1 break-all text-muted-foreground">{workspaceStatus.path}</p>
            <p className="mt-1 text-muted-foreground">
              It may have moved, been renamed, or be on a disconnected drive.
            </p>
          </div>
        ) : null}

        {message ? (
          <p className="mt-4 text-ui-control text-muted-foreground" role="status">
            {message}
          </p>
        ) : null}

        <div className="mt-7 flex items-center justify-between gap-4 border-t border-[var(--border-default)] pt-5">
          <p className="text-ui-meta text-muted-foreground">
            Your files stay local unless you sync the folder yourself.
          </p>
          <Button type="button" size="sm" onClick={() => void handleOnClick()} disabled={isChoosing}>
            {isChoosing ? "Choosing…" : "Choose folder"}
          </Button>
        </div>
      </section>
    </main>
  );
};
