import { IconDiffSplit } from "@pierre/icons";
import { LazyObimEditor as ObimEditor } from "@renderer/features/editor/editorLoader";
import { FileBufferBoundary } from "@renderer/features/files/FileBufferBoundary";
import { IconGitBranch } from "@renderer/shared/icons/IconGitBranch";
import { IconTaskBoard } from "@renderer/shared/icons/IconTaskBoard";
import { useSetAtom } from "jotai";
import { lazy, Suspense, useCallback } from "react";

import { LargeFilePreview } from "@renderer/features/editor/LargeFilePreview";
import { ImageViewer } from "@renderer/features/files/ImageViewer";
import { openInDefaultApp, revealInSystemFileManager } from "@renderer/features/files/workspaceFileService";
import { FileHistoryView } from "@renderer/features/git/FileHistoryView";
import { GitConflictResolutionView } from "@renderer/features/git/GitConflictResolutionView";
import { TaskBoard } from "@renderer/features/task-board/TaskBoard";
import { WorkspacePaneHeader } from "@renderer/features/workspace/WorkspacePaneHeader";
import type { OpenWorkspaceItem, WorkspaceItemResolver } from "@renderer/features/workspace/workspaceItemOperations";
import type { WorkspaceItemViewMap } from "@renderer/features/workspace/workspaceItemView";
import { getFileGlyph } from "@renderer/shared/icons/FileGlyphs";
import { IconFileQuestion } from "@renderer/shared/icons/IconFileQuestion";
import { Button } from "@renderer/shared/ui/button";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import { isLargeTextFile } from "@shared/large-files";
import { getFileHandlingMode } from "@shared/mime-types";
import { basename, stripLastExt } from "@shared/pathUtils";
import {
  isFileHistoryWorkspaceItem,
  isFileWorkspaceItem,
  isGitConflictWorkspaceItem,
  WORKSPACE_ITEM_KINDS,
  type FileWorkspaceItem,
  type WorkspaceItem,
} from "@shared/workspace";
import { pdfReaderId } from "@renderer/shared/pdfDeepLink";

const PdfFileViewer = lazy(() =>
  import("@renderer/features/files/PDFViewer").then((module) => ({ default: module.PDFViewer })),
);

type OpenLinkedFile = (path: string, sourceFilePath?: string) => void | Promise<void>;

const MarkdownFilePane = ({
  file,
  isMarkdown,
  openLinkedFile,
  paneId,
}: {
  file: FileWorkspaceItem["file"];
  isMarkdown: boolean;
  openLinkedFile: OpenLinkedFile;
  paneId: string;
}) => {
  const openResource = useCallback((path: string) => openLinkedFile(path, file.path), [file.path, openLinkedFile]);

  return (
    <FileBufferBoundary filePath={file.path}>
      <ObimEditor
        paneId={paneId}
        fileId={file.id}
        filePath={file.path}
        isMarkdown={isMarkdown}
        openResource={openResource}
      />
    </FileBufferBoundary>
  );
};

const UnsupportedFilePane = ({ file }: { file: FileWorkspaceItem["file"] }) => {
  const addNotification = useSetAtom(addNotificationAtom);
  const run = async (title: string, action: () => Promise<{ success: true } | { success: false; error: string }>) => {
    const result = await action();
    if (result.success) return;
    addNotification({
      id: crypto.randomUUID(),
      level: NotificationLevel.ERROR,
      title,
      message: result.error,
      path: file.path,
      timestamp: Date.now(),
    });
  };
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
      <IconFileQuestion size={28} />
      <div>
        <div className="text-ui-body font-bold text-foreground">Preview unavailable</div>
        <div className="mt-1 text-ui-meta">Obim cannot display {file.relativePath || file.filename}.</div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void run("Could not show file", () => revealInSystemFileManager(file.path))}
        >
          Show in file manager
        </Button>
        <Button type="button" onClick={() => void run("Could not open file", () => openInDefaultApp(file.path))}>
          Open in default app
        </Button>
      </div>
    </div>
  );
};

export const createWorkspaceItemViews = ({
  openWorkspaceItem,
  openLinkedFile,
  resolveWorkspaceItem,
}: {
  openWorkspaceItem: OpenWorkspaceItem;
  openLinkedFile: OpenLinkedFile;
  resolveWorkspaceItem: WorkspaceItemResolver;
}): WorkspaceItemViewMap => {
  const renderHeader = (item: WorkspaceItem, paneId: string) => (
    <WorkspacePaneHeader
      item={item}
      paneId={paneId}
      openWorkspaceItem={openWorkspaceItem}
      resolveWorkspaceItem={resolveWorkspaceItem}
      views={views}
    />
  );

  const views: WorkspaceItemViewMap = {
    [WORKSPACE_ITEM_KINDS.file]: {
      getTitle: (item) => (isFileWorkspaceItem(item) ? item.file.filename : stripLastExt(basename(item.key))),
      getDragIcon: (item) => (isFileWorkspaceItem(item) ? getFileGlyph(item.file.relativePath) : null),
      isEditorContent: (item) => {
        if (!isFileWorkspaceItem(item)) return false;
        if (isLargeTextFile(item.file)) return false;
        const handlingMode = getFileHandlingMode(item.file.mimeType, item.file.path);
        return handlingMode === "markdown" || handlingMode === "text";
      },
      managesOwnOverflow: (item) =>
        isFileWorkspaceItem(item) &&
        !item.file.isDirectory &&
        !isLargeTextFile(item.file) &&
        ["image", "pdf"].includes(getFileHandlingMode(item.file.mimeType, item.file.path)),
      renderHeader,
      render: (item, paneId) => {
        if (!isFileWorkspaceItem(item)) return null;
        const handlingMode = getFileHandlingMode(item.file.mimeType, item.file.path);
        if (isLargeTextFile(item.file)) return <LargeFilePreview key={item.file.path} file={item.file} />;
        if (handlingMode === "markdown" || handlingMode === "text") {
          return (
            <Suspense
              fallback={
                <div
                  className="flex h-full items-center justify-center text-ui-control text-muted-foreground"
                  role="status"
                >
                  Opening note…
                </div>
              }
            >
              <MarkdownFilePane
                file={item.file}
                paneId={paneId}
                isMarkdown={handlingMode === "markdown"}
                openLinkedFile={openLinkedFile}
              />
            </Suspense>
          );
        }
        if (handlingMode === "image" && !item.file.isDirectory) {
          return <ImageViewer file={item.file} />;
        }
        if (handlingMode === "pdf" && !item.file.isDirectory) {
          return (
            <Suspense
              fallback={
                <div
                  className="flex h-full items-center justify-center text-ui-control text-muted-foreground"
                  role="status"
                >
                  Opening PDF…
                </div>
              }
            >
              <PdfFileViewer
                key={item.file.id}
                file={item.file}
                readerId={pdfReaderId(paneId, item.key)}
              />
            </Suspense>
          );
        }
        return <UnsupportedFilePane file={item.file} />;
      },
    },
    [WORKSPACE_ITEM_KINDS.taskboard]: {
      getTitle: (item) => ("title" in item && typeof item.title === "string" ? item.title : "Task Board"),
      getTabIcon: () => IconTaskBoard,
      isEditorContent: () => true,
      render: () => <TaskBoard />,
    },
    [WORKSPACE_ITEM_KINDS.fileHistory]: {
      getTitle: (item) =>
        isFileHistoryWorkspaceItem(item)
          ? `Versions · ${item.file.filename}`
          : `Versions · ${stripLastExt(basename(item.key))}`,
      getTabIcon: () => IconGitBranch,
      managesOwnOverflow: () => true,
      render: (item) => (isFileHistoryWorkspaceItem(item) ? <FileHistoryView item={item} /> : null),
    },
    [WORKSPACE_ITEM_KINDS.gitConflict]: {
      getTitle: (item) =>
        isGitConflictWorkspaceItem(item)
          ? `Resolve · ${basename(item.relativePath)}`
          : `Resolve · ${basename(item.key)}`,
      getTabIcon: () => IconDiffSplit,
      managesOwnOverflow: () => true,
      render: (item) => (isGitConflictWorkspaceItem(item) ? <GitConflictResolutionView item={item} /> : null),
    },
  };
  return views;
};
