import { IconChevron, IconFolder, IconFolderOpen, IconTrash } from "@pierre/icons";
import { useStore } from "jotai";
import { useRef, useState } from "react";

import { switchWorkspaceSafely } from "@renderer/features/files/workspaceTransition";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@renderer/shared/ui/dropdown-menu";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import type { WorkspaceSelectionResult } from "@shared/config";
import { basename } from "@shared/pathUtils";

const normalizedWorkspacePath = (workspacePath: string) => workspacePath.replace(/\\/g, "/").replace(/\/+$/, "");

const getWorkspaceChoices = (
  currentWorkspacePath: string,
  recentWorkspaces = window.config.getRecentWorkspacesSync?.() ?? [],
) => {
  const seen = new Set<string>();
  return [currentWorkspacePath, ...recentWorkspaces].filter((workspacePath) => {
    const normalizedPath = normalizedWorkspacePath(workspacePath);
    if (!workspacePath || seen.has(normalizedPath)) return false;
    seen.add(normalizedPath);
    return true;
  });
};

const reloadWorkspaceWindow = () => window.location.reload();

export const WorkspaceSwitcher = ({
  onWorkspaceSelected = reloadWorkspaceWindow,
  workspaceName,
  workspacePath,
}: {
  onWorkspaceSelected?: () => void;
  workspaceName: string;
  workspacePath: string;
}) => {
  const store = useStore();
  const switchingRef = useRef(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [workspaceChoices, setWorkspaceChoices] = useState(() => getWorkspaceChoices(workspacePath));

  const notify = (level: NotificationLevel, title: string, message: string) => {
    store.set(addNotificationAtom, {
      id: crypto.randomUUID(),
      level,
      title,
      message,
      timestamp: Date.now(),
      timeout: 0,
    });
  };

  const switchWorkspace = async (selectWorkspace: () => Promise<WorkspaceSelectionResult>) => {
    if (switchingRef.current) return;
    switchingRef.current = true;
    setIsSwitching(true);

    try {
      const result = await switchWorkspaceSafely(
        store,
        selectWorkspace,
        onWorkspaceSelected,
        onWorkspaceSelected === reloadWorkspaceWindow,
      );
      if (result.status === "error") {
        notify(NotificationLevel.ERROR, "Couldn't open workspace", result.error);
      }
    } catch (error) {
      notify(
        NotificationLevel.ERROR,
        "Couldn't open workspace",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      switchingRef.current = false;
      setIsSwitching(false);
    }
  };

  const selectRecentWorkspace = (nextWorkspacePath: string) => {
    if (normalizedWorkspacePath(nextWorkspacePath) === normalizedWorkspacePath(workspacePath)) return;
    void switchWorkspace(() => window.config.selectRecentWorkspace(nextWorkspacePath));
  };

  const removeWorkspace = async (choicePath: string) => {
    if (switchingRef.current || normalizedWorkspacePath(choicePath) === normalizedWorkspacePath(workspacePath)) return;
    switchingRef.current = true;
    setIsRemoving(true);
    try {
      const recentWorkspaces = await window.config.removeRecentWorkspace(choicePath);
      setWorkspaceChoices(getWorkspaceChoices(workspacePath, recentWorkspaces));
      setIsOpen(false);
    } catch (error) {
      notify(
        NotificationLevel.ERROR,
        "Couldn't remove workspace from list",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      switchingRef.current = false;
      setIsRemoving(false);
    }
  };

  const isBusy = isSwitching || isRemoving;

  return (
    <DropdownMenu
      modal={false}
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) setWorkspaceChoices(getWorkspaceChoices(workspacePath));
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="file-explorer-workspace"
          aria-label={`Switch workspace. Current workspace: ${workspaceName}`}
          title={workspacePath}
          disabled={isBusy}
        >
          <span className="file-explorer-workspace-name">{isSwitching ? "Switching…" : workspaceName}</span>
          <IconChevron className="file-explorer-workspace-chevron" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="file-explorer-workspace-menu">
        <DropdownMenuLabel className="menu-header">
          <strong>Workspaces</strong>
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          className="menu-list file-explorer-workspace-list"
          value={workspacePath}
          onValueChange={selectRecentWorkspace}
        >
          {workspaceChoices.map((choicePath) => (
            <div key={choicePath} className="flex items-center gap-1">
              <DropdownMenuRadioItem
                value={choicePath}
                disabled={isBusy}
                className="menu-option min-w-0 flex-1 items-start py-1.5"
                title={choicePath}
              >
                <IconFolder className="mt-0.5" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-foreground">{basename(choicePath)}</span>
                  <span className="block truncate text-ui-meta text-muted-foreground">{choicePath}</span>
                </span>
              </DropdownMenuRadioItem>
              {normalizedWorkspacePath(choicePath) !== normalizedWorkspacePath(workspacePath) && (
                <DropdownMenuItem
                  aria-label={`Remove ${basename(choicePath)} from workspace list`}
                  title={`Remove ${choicePath} from the list. Files remain on disk.`}
                  disabled={isBusy}
                  className="shrink-0 px-2 text-muted-foreground"
                  onSelect={(event) => {
                    event.preventDefault();
                    void removeWorkspace(choicePath);
                  }}
                >
                  <IconTrash aria-hidden="true" />
                </DropdownMenuItem>
              )}
            </div>
          ))}
        </DropdownMenuRadioGroup>
        <div className="file-explorer-workspace-footer">
          <DropdownMenuItem
            className="menu-option"
            disabled={isBusy}
            onSelect={() => void switchWorkspace(() => window.config.initializeConfig())}
          >
            <IconFolderOpen aria-hidden="true" />
            Choose another folder…
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
