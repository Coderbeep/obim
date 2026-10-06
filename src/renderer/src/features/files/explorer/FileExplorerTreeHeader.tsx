import { IconChevronsClose, IconExpandAll, IconFilePlus, IconFolderPlus, IconSearch } from "@pierre/icons";
import { memo, type JSX } from "react";

import { useDirectoryCreate, useFileCreate } from "../fileActions";
import { ACTION_LABELS } from "@renderer/shared/actionLabels";
import { IconButton } from "@renderer/shared/ui/IconButton";

import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export const FileExplorerHeader = memo(function FileExplorerHeader({
  onSearch,
  workspaceName = "Workspace",
  workspacePath,
  onWorkspaceSelected,
}: {
  onSearch: () => void;
  workspaceName?: string;
  workspacePath?: string;
  onWorkspaceSelected?: () => void;
}): JSX.Element {
  return (
    <div className="file-explorer-toolbar">
      {workspacePath ? (
        <WorkspaceSwitcher
          workspaceName={workspaceName}
          workspacePath={workspacePath}
          onWorkspaceSelected={onWorkspaceSelected}
        />
      ) : (
        <div className="file-explorer-workspace">
          <span className="file-explorer-workspace-name">{workspaceName}</span>
        </div>
      )}
      <div className="file-explorer-toolbar-actions">
        <IconButton
          className="file-explorer-toolbar-action"
          icon={IconSearch}
          label="Search files"
          onClick={onSearch}
        />
      </div>
    </div>
  );
});

export const FileExplorerActions = ({
  allDirectoriesExpanded,
  onToggleAllDirectories,
}: {
  allDirectoriesExpanded: boolean;
  onToggleAllDirectories: () => void;
}) => {
  const { createNewFile } = useFileCreate();
  const { createDirectory } = useDirectoryCreate();
  return (
    <div className="file-explorer-section-actions" role="group" aria-label="File actions">
      <IconButton
        className="file-explorer-section-action"
        icon={IconFilePlus}
        label={ACTION_LABELS.newNote}
        onClick={() => void createNewFile()}
      />
      <IconButton
        className="file-explorer-section-action"
        icon={IconFolderPlus}
        label={ACTION_LABELS.newFolder}
        onClick={() => void createDirectory()}
      />
      <IconButton
        className="file-explorer-section-action"
        icon={allDirectoriesExpanded ? IconChevronsClose : IconExpandAll}
        label={allDirectoriesExpanded ? "Collapse all directories" : "Expand all directories"}
        onClick={onToggleAllDirectories}
      />
    </div>
  );
};
