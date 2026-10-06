import { IconCalendar, IconCheckbox, IconLink, IconListCheck, IconTag } from "@pierre/icons";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";

import { DailyNotesCalendar } from "@renderer/features/daily-notes/DailyNotesCalendar";
import { TaskBoardInspector } from "@renderer/features/task-board/TaskBoardInspector";
import { IconFileQuestion } from "@renderer/shared/icons/IconFileQuestion";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { currentWorkspaceItemAtom } from "@renderer/store/workspaceResourceStore";
import { isLargeTextFile } from "@shared/large-files";
import { isMarkdownFile } from "@shared/mime-types";
import {
  isFileHistoryWorkspaceItem,
  isFileWorkspaceItem,
  isGitConflictWorkspaceItem,
  WORKSPACE_ITEM_KINDS,
} from "@shared/workspace";
import { getMarkdownSidebarInfo } from "./documentInfo";
import { DocumentOutline } from "./DocumentOutline";
import { RightSidebarWidget, RightSidebarWidgetStack } from "./WidgetStack";

import { DocumentProperties } from "./DocumentProperties";
import { NoteLinks } from "./NoteLinks";
import { NoteTasks } from "./NoteTasks";

const INSPECTOR_UPDATE_DELAY_MS = 120;

const EmptyInspector = ({ title, detail }: { title: string; detail?: string }) => (
  <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-none border border-dashed border-border p-4 text-center text-muted-foreground">
    <IconFileQuestion size={20} />
    <div className="text-ui-body font-bold text-foreground">{title}</div>
    {detail ? <div className="max-w-full break-words text-ui-meta">{detail}</div> : null}
  </div>
);

const calendarWidget = (
  <RightSidebarWidget
    id="daily-notes"
    title="Calendar"
    icon={IconCalendar}
    contentClassName="px-1 pb-2 pt-0 [scrollbar-gutter:stable]"
  >
    <DailyNotesCalendar />
  </RightSidebarWidget>
);

const MarkdownInspector = ({ text, sourcePath }: { text: string; sourcePath: string }) => {
  const [settled, setSettled] = useState({ sourcePath, text });
  // A new note updates immediately; typing within that note remains debounced.
  // Keep the widget stack mounted so the calendar and pane sizes stay stable.
  if (settled.sourcePath !== sourcePath) setSettled({ sourcePath, text });
  const settledText = settled.sourcePath === sourcePath ? settled.text : text;
  useEffect(() => {
    if (text === settledText) return;
    const timeout = window.setTimeout(() => setSettled({ sourcePath, text }), INSPECTOR_UPDATE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [settledText, sourcePath, text]);

  const info = useMemo(() => getMarkdownSidebarInfo(settledText), [settledText]);
  const outlineKey = info.headings.map((heading) => `${heading.line}:${heading.level}:${heading.text}`).join("\n");
  const tasks = info.tasks ?? [];
  const links = info.links ?? [];

  return (
    <RightSidebarWidgetStack autoSaveId="note-right-sidebar-widget-stack">
      <RightSidebarWidget
        id="outline"
        title="Table of contents"
        tabTitle="Outline"
        icon={IconListCheck}
        contentClassName="px-1.5 pb-2 [scrollbar-gutter:stable]"
      >
        <DocumentOutline key={`${sourcePath}:${outlineKey}`} headings={info.headings} />
      </RightSidebarWidget>
      <RightSidebarWidget id="note-tasks" title="Checklist" icon={IconCheckbox} contentClassName="px-1.5 pb-2">
        <NoteTasks key={sourcePath} tasks={tasks} />
      </RightSidebarWidget>
      <RightSidebarWidget id="note-links" title="Links" icon={IconLink} contentClassName="px-1.5 pb-2">
        <NoteLinks key={sourcePath} links={links} sourcePath={sourcePath} />
      </RightSidebarWidget>
      <RightSidebarWidget id="properties" title="Properties" icon={IconTag}>
        <DocumentProperties key={sourcePath} text={text} />
      </RightSidebarWidget>
      {calendarWidget}
    </RightSidebarWidgetStack>
  );
};

export function DocumentInspector() {
  const currentItem = useAtomValue(currentWorkspaceItemAtom);
  const buffers = useAtomValue(fileBuffersByPathAtom);
  const file = currentItem ? (isFileWorkspaceItem(currentItem) ? currentItem.file : null) : null;
  const text = file ? (buffers[file.path]?.editorText ?? "") : "";
  const markdown = Boolean(file && isMarkdownFile(file.mimeType, file.path));
  const title = currentItem
    ? isFileWorkspaceItem(currentItem)
      ? currentItem.file.filename
      : isFileHistoryWorkspaceItem(currentItem)
        ? `Git · ${currentItem.file.filename}`
        : isGitConflictWorkspaceItem(currentItem)
          ? `Resolve · ${currentItem.relativePath}`
          : currentItem.title
    : "No file selected";

  const empty = !currentItem ? (
    <EmptyInspector title="No file selected" />
  ) : !file ? (
    <EmptyInspector title={title} detail="No file metadata" />
  ) : isLargeTextFile(file) ? (
    <EmptyInspector title="Large-file preview" detail="Outline and statistics are unavailable." />
  ) : (
    <EmptyInspector title="No markdown outline" detail={file.mimeType || "Unsupported file type"} />
  );
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col text-sidebar-foreground">
      {currentItem?.kind === WORKSPACE_ITEM_KINDS.taskboard ? (
        <TaskBoardInspector>{calendarWidget}</TaskBoardInspector>
      ) : markdown && file && !isLargeTextFile(file) ? (
        <MarkdownInspector text={text} sourcePath={file.path} />
      ) : (
        <RightSidebarWidgetStack autoSaveId="default-right-sidebar-widget-stack">
          <RightSidebarWidget id="info" title="File information" icon={IconFileQuestion}>
            {empty}
          </RightSidebarWidget>
          {calendarWidget}
        </RightSidebarWidgetStack>
      )}
    </div>
  );
}
