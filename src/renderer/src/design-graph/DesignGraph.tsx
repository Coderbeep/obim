import { createTaskSpecimenActions } from "./taskSpecimenActions";
import {
  IconBan,
  IconBoard,
  IconBookmark,
  IconCheck,
  IconCheckbox,
  IconChevron,
  IconCopy,
  IconFileText,
  IconFilePlus,
  IconFiles,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconInbox,
  IconListCheck,
  IconListUnordered,
  IconMoon,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSun,
  IconTag,
  IconTrash,
  IconX,
} from "@pierre/icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ContextMenuHost } from "@renderer/features/context-menu/ContextMenuHost";
import { ContextMenuItems } from "@renderer/features/context-menu/ContextMenuItems";
import { NotificationCard } from "@renderer/features/notifications/NotificationHost";
import { NotificationLevel } from "@renderer/features/notifications/notifications";

import { TaskBoardTask } from "@renderer/features/task-board/TaskBoardTask";
import { type TaskBoardTask as TaskBoardTaskModel } from "@renderer/features/task-board/taskBoardModel";
import type { ContextMenuEntry } from "@renderer/shared/contextMenu";
import { DragPreviewSurface } from "@renderer/shared/dnd/DragPreview";
import { VerticalInsertionLine, SplitDropIndicator } from "@renderer/shared/dnd/DropIndicator";
import { getFileGlyph } from "@renderer/shared/icons/FileGlyphs";
import { Badge } from "@renderer/shared/ui/badge";
import { Button } from "@renderer/shared/ui/button";
import { IconButton } from "@renderer/shared/ui/IconButton";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@renderer/shared/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@renderer/shared/ui/popover";
import { RecoveryState } from "@renderer/shared/ui/RecoveryState";
import { Input } from "@renderer/shared/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@renderer/shared/ui/tabs";

import { DESIGN_GRAPH_INDEX, matchesDesignGraphEntry, type DesignGraphEntry } from "./designGraphIndex";
import "./DesignGraph.css";
import { SettingsSpecimens } from "./SettingsSpecimens";

type Theme = "light" | "dark";

const noop = () => undefined;
const resolveTrue = async () => true;
const graphStateCount = DESIGN_GRAPH_INDEX.reduce((total, entry) => total + entry.states.length, 0);

const fileMenuEntries: ContextMenuEntry[] = [
  { kind: "action", id: "open", label: "Open", icon: IconFileText, onSelect: noop },
  { kind: "action", id: "open-new-pane", label: "Open in new pane", icon: IconFileText, onSelect: noop },
  { kind: "separator" },
  {
    kind: "action",
    id: "copy",
    label: "Copy",
    icon: IconCopy,
    onSelect: noop,
    children: [
      { kind: "action", id: "copy-item", label: "Item", icon: IconCopy, onSelect: noop },
      { kind: "action", id: "copy-path", label: "Absolute path", onSelect: noop },
      { kind: "action", id: "copy-relative-path", label: "Relative path", onSelect: noop },
    ],
  },
  { kind: "action", id: "add-bookmark", label: "Add bookmark", icon: IconBookmark, onSelect: noop },
  { kind: "separator" },
  { kind: "action", id: "reveal", label: "Show in file manager", icon: IconFolderOpen, onSelect: noop },
  { kind: "action", id: "rename", label: "Rename", icon: IconPencil, onSelect: noop },
  {
    kind: "action",
    id: "trash",
    label: "Move to Trash",
    icon: IconTrash,
    danger: true,
    onSelect: noop,
  },
];

const directoryMenuEntries: ContextMenuEntry[] = [
  { kind: "action", id: "new-note", label: "New note", icon: IconFilePlus, onSelect: noop },
  { kind: "action", id: "new-directory", label: "New folder", icon: IconFolderPlus, onSelect: noop },
  { kind: "separator" },
  { kind: "action", id: "paste", label: "Paste", icon: IconFiles, onSelect: noop },
  { kind: "separator" },
  { kind: "action", id: "copy", label: "Copy", icon: IconCopy, onSelect: noop },
  { kind: "action", id: "reveal", label: "Show in file manager", icon: IconFolderOpen, onSelect: noop },
  { kind: "action", id: "rename", label: "Rename", icon: IconPencil, onSelect: noop },
  { kind: "action", id: "trash", label: "Move to Trash", icon: IconTrash, danger: true, onSelect: noop },
];

const rootMenuEntries: ContextMenuEntry[] = [
  { kind: "action", id: "new-note", label: "New note", icon: IconFilePlus, onSelect: noop },
  { kind: "action", id: "new-directory", label: "New folder", icon: IconFolderPlus, onSelect: noop },
  { kind: "separator" },
  { kind: "action", id: "paste", label: "Paste", icon: IconFiles, onSelect: noop },
];

const noteTabMenuEntries: ContextMenuEntry[] = [
  { kind: "action", id: "close", label: "Close note", icon: IconX, onSelect: noop },
  { kind: "action", id: "add-bookmark", label: "Add bookmark", icon: IconBookmark, onSelect: noop },
  { kind: "separator" },
  { kind: "action", id: "reveal", label: "Show in file manager", icon: IconFolderOpen, onSelect: noop },
  { kind: "separator" },
  { kind: "action", id: "trash", label: "Move to Trash", icon: IconTrash, danger: true, onSelect: noop },
];

const taskMenuEntries: ContextMenuEntry[] = [
  { kind: "action", id: "open", label: "Open task", icon: IconFileText, onSelect: noop },
  { kind: "action", id: "complete", label: "Complete task", icon: IconCheckbox, onSelect: noop },
  { kind: "action", id: "cancel", label: "Cancel task", icon: IconBan, onSelect: noop },
  { kind: "separator" },
  { kind: "action", id: "edit", label: "Edit task", icon: IconPencil, onSelect: noop },
  { kind: "separator" },
  { kind: "action", id: "move-inbox", label: "Move to Inbox", icon: IconInbox, onSelect: noop },
  {
    kind: "action",
    id: "move",
    label: "Move to",
    icon: IconListUnordered,
    onSelect: noop,
    children: [
      { kind: "action", id: "move-research", label: "Research", checked: true, onSelect: noop },
      { kind: "action", id: "move-writing", label: "Writing", checked: false, onSelect: noop },
    ],
  },
  { kind: "separator" },
  { kind: "action", id: "trash", label: "Move to Trash", icon: IconTrash, danger: true, onSelect: noop },
];

const unavailableMenuEntries: ContextMenuEntry[] = [
  { kind: "action", id: "paste", label: "Paste", icon: IconFiles, disabled: true, onSelect: noop },
  { kind: "action", id: "complete", label: "Complete task", icon: IconCheckbox, disabled: true, onSelect: noop },
  {
    kind: "action",
    id: "trash",
    label: "Move to Trash",
    icon: IconTrash,
    danger: true,
    disabled: true,
    onSelect: noop,
  },
];

const taskProjects = [{ name: "Research", colorId: "blue" }];
const baseTask: TaskBoardTaskModel = {
  id: "design-graph-task",
  filename: "review-interface.md",
  relativePath: "Tasks/review-interface.md",
  path: "/design-graph/Tasks/review-interface.md",
  isDirectory: false,
  mimeType: "text/markdown",
  title: "Review the editor interaction states",
  preview: "Check keyboard focus, empty states, and long labels before release.",
  status: "open",
  metadataIssues: [],
  priority: "high",
  project: "Research",
  tags: ["design", "editor", "quality"],
};

const taskSpecimenProps = {
  taskActions: createTaskSpecimenActions({
    loadTags: async () => ["design", "editor", "quality"],
    cancelTask: resolveTrue,
    completeTask: resolveTrue,
    deleteTask: resolveTrue,
    moveTask: resolveTrue,
    openTask: noop,
    reopenTask: resolveTrue,
    repairMetadata: resolveTrue,
    updateTask: resolveTrue,
  }),
  projects: taskProjects,
};

const SpecimenSection = ({
  children,
  description,
  entry,
}: {
  children: ReactNode;
  description: string;
  entry: DesignGraphEntry;
}) => (
  <section
    id={entry.id}
    className="design-graph-section"
    data-design-component={entry.id}
    data-design-group={entry.group}
  >
    <div className="design-graph-section-heading">
      <div>
        <p className="design-graph-eyebrow">{entry.group}</p>
        <h2>{entry.label}</h2>
        <p>{description}</p>
      </div>
      <Badge variant="outline">{entry.states.length} states</Badge>
    </div>
    {children}
  </section>
);

const StateNode = ({
  children,
  className = "",
  component,
  label,
  state,
}: {
  children: ReactNode;
  className?: string;
  component: string;
  label?: string;
  state: string;
}) => (
  <div className={`design-graph-state ${className}`} data-design-component={component} data-design-state={state}>
    <div className="design-graph-state-label">{label ?? state.replaceAll("-", " ")}</div>
    <div className="design-graph-state-content">{children}</div>
  </div>
);

const SurfaceSpecimens = () => {
  const surfaces = [
    ["canvas", "Canvas", "App ground"],
    ["surface-1", "Surface 1", "Persistent structure"],
    ["surface-2", "Surface 2", "Inset region"],
    ["surface-3", "Surface 3", "Interactive content"],
    ["raised", "Raised", "Temporary layer"],
    ["selected", "Selected", "Persistent choice"],
  ] as const;

  return (
    <div className="design-graph-surface-grid">
      {surfaces.map(([state, label, detail]) => (
        <StateNode key={state} component="surfaces" state={state} label={label}>
          <div className={`design-graph-surface design-graph-surface-${state}`}>
            <strong>{label}</strong>
            <span>{detail}</span>
          </div>
        </StateNode>
      ))}
    </div>
  );
};

const ButtonSpecimens = () => {
  return (
    <div className="design-graph-state-grid design-graph-state-grid-compact">
      <StateNode component="button" state="default-xs" label="Default · xs">
        <Button>Open in default app</Button>
      </StateNode>
      <StateNode component="button" state="outline-xs" label="Outline · xs">
        <Button variant="outline">Show in file manager</Button>
      </StateNode>
      <StateNode component="button" state="destructive-xs" label="Destructive · xs">
        <Button variant="destructive">Change type</Button>
      </StateNode>
      <StateNode component="button" state="ghost-xs" label="Ghost · xs">
        <Button variant="ghost" size="xs" className="gap-1.5 transition-none">
          <IconListUnordered />
          Manage projects
        </Button>
      </StateNode>
      <StateNode component="button" state="ghost-xsm" label="Ghost · xsm">
        <Button
          size="xsm"
          variant="ghost"
          className="text-ui-meta h-6 cursor-pointer gap-0 overflow-hidden rounded-[var(--radius-control)] border border-transparent bg-[var(--selection-track)] p-0 font-medium text-secondary-foreground tabular-nums hover:bg-[var(--selection-selected)] hover:text-secondary-foreground"
        >
          <span className="inline-flex h-full items-center gap-1 px-2">
            <IconTag className="size-3!" />
            Tags
          </span>
          <span aria-hidden="true" className="h-3.5 w-px bg-secondary-foreground/20" />
          <span aria-hidden="true" className="grid h-full w-6 place-items-center">
            <IconChevron className="size-3!" />
          </span>
        </Button>
      </StateNode>
      <StateNode component="button" state="ghost-destructive-xs" label="Ghost destructive · xs">
        <Button
          variant="ghost-destructive"
          size="xs"
          className="w-7 justify-start gap-0 overflow-hidden px-0"
          aria-label="Delete project"
        >
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center">
            <IconTrash />
          </span>
        </Button>
      </StateNode>
      <StateNode component="button" state="default-icon-sm" label="Default · icon-sm">
        <Button size="icon-sm" aria-label="Save task">
          <IconCheck />
        </Button>
      </StateNode>
      <StateNode component="button" state="outline-icon-sm" label="Outline · icon-sm">
        <Button size="icon-sm" variant="outline" aria-label="Cancel">
          <IconX />
        </Button>
      </StateNode>
      <StateNode component="button" state="ghost-icon-sm" label="Ghost · icon-sm">
        <IconButton icon={IconPlus} label="Add task" />
      </StateNode>
      <StateNode component="button" state="default-xs-disabled" label="Default · xs · disabled">
        <Button size="xs" disabled>
          <IconPlus />
          Add
        </Button>
      </StateNode>
      <StateNode component="button" state="ghost-xs-disabled" label="Ghost · xs · disabled">
        <Button variant="ghost" size="xs" disabled className="gap-1.5 transition-none">
          <IconListUnordered />
          Manage projects
        </Button>
      </StateNode>
      <StateNode component="button" state="ghost-destructive-xs-disabled" label="Ghost destructive · xs · disabled">
        <Button
          variant="ghost-destructive"
          size="xs"
          disabled
          className="w-7 justify-start gap-0 overflow-hidden px-0"
          aria-label="Delete project unavailable"
        >
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center">
            <IconTrash />
          </span>
        </Button>
      </StateNode>
      <StateNode component="button" state="default-icon-sm-disabled" label="Default · icon-sm · disabled">
        <Button size="icon-sm" disabled aria-label="Save task unavailable">
          <IconCheck />
        </Button>
      </StateNode>
      <StateNode component="button" state="ghost-icon-sm-disabled" label="Ghost · icon-sm · disabled">
        <IconButton icon={IconChevron} label="Go forward unavailable" disabled />
      </StateNode>
    </div>
  );
};

const InputSpecimens = () => (
  <div className="design-graph-state-grid">
    <StateNode component="input" state="empty">
      <Input aria-label="Empty input specimen" placeholder="Untitled note" />
    </StateNode>
    <StateNode component="input" state="populated">
      <Input aria-label="Populated input specimen" defaultValue="Design graph" />
    </StateNode>
    <StateNode component="input" state="search">
      <div className="design-graph-search-input">
        <IconSearch aria-hidden="true" />
        <Input aria-label="Search input specimen" placeholder="Search components…" inset="leadingIcon" />
      </div>
    </StateNode>
    <StateNode component="input" state="invalid">
      <Input aria-label="Invalid input specimen" defaultValue="Duplicate name" aria-invalid="true" />
    </StateNode>
    <StateNode component="input" state="disabled">
      <Input aria-label="Disabled input specimen" defaultValue="Read only" disabled />
    </StateNode>
  </div>
);

const BadgeSpecimens = () => {
  const variants = ["default", "secondary", "category", "selected", "status", "warning", "destructive"] as const;
  return (
    <div className="design-graph-state-grid design-graph-state-grid-compact">
      {variants.map((variant) => (
        <StateNode key={variant} component="badge" state={variant}>
          <Badge variant={variant}>{variant}</Badge>
        </StateNode>
      ))}
      <StateNode component="badge" state="interactive-off">
        <Badge asChild variant="interactive">
          <button type="button">Filter</button>
        </Badge>
      </StateNode>
      <StateNode component="badge" state="interactive-on">
        <Badge asChild variant="interactive">
          <button type="button" data-state="on">
            Selected
          </button>
        </Badge>
      </StateNode>
      {(["disabled", "outline", "compact"] as const).map((variant) => (
        <StateNode key={variant} component="badge" state={variant}>
          <Badge variant={variant}>{variant}</Badge>
        </StateNode>
      ))}
    </div>
  );
};

const fileExplorerSections = [
  ["files", "Files", 12],
  ["bookmarks", "Bookmarks", 3],
  ["recent", "Recent", 8],
] as const;

type FileExplorerSection = (typeof fileExplorerSections)[number][0];

const FileExplorerSections = ({ initialExpanded }: { initialExpanded: FileExplorerSection }) => {
  const [expanded, setExpanded] = useState<FileExplorerSection>(initialExpanded);

  return (
    <div className="file-explorer-sections h-36 w-60 border border-[var(--border-default)]">
      {fileExplorerSections.map(([section, label, count]) => {
        const open = section === expanded;
        return (
          <section
            key={section}
            className={`file-explorer-section ${
              section === "files" ? "file-explorer-section-files" : "file-explorer-section-shortcuts"
            }`}
            data-expanded={open}
          >
            <button
              type="button"
              className="file-explorer-section-heading"
              aria-expanded={open}
              onClick={() => setExpanded(section)}
            >
              <IconChevron className="file-explorer-section-chevron" size={12} aria-hidden="true" />
              <span>{label}</span>
              <span className="file-explorer-section-count">{count.toString().padStart(2, "0")}</span>
            </button>
            <div className="file-explorer-section-content p-2 text-ui-meta" hidden={!open}>
              {label} content
            </div>
          </section>
        );
      })}
    </div>
  );
};

const TaskLifecycleTabs = ({ initialValue }: { initialValue: "active" | "closed" }) => {
  const [value, setValue] = useState(initialValue);

  return (
    <Tabs value={value} onValueChange={(nextValue) => setValue(nextValue as typeof value)}>
      <TabsList className="task-board-view-tabs task-board-lifecycle-tabs" aria-label="Task lifecycle view">
        <span
          aria-hidden="true"
          className="task-board-view-tab-indicator"
          style={{ transform: `translateX(${value === "active" ? 0 : 100}%)` }}
        />
        <TabsTrigger value="active" className="task-board-view-tab-trigger">
          Active
        </TabsTrigger>
        <TabsTrigger value="closed" className="task-board-view-tab-trigger">
          Closed
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

const TaskLayoutTabs = ({
  disabled,
  initialValue,
}: {
  disabled?: "board" | "list";
  initialValue: "board" | "list";
}) => {
  const [value, setValue] = useState(initialValue);

  return (
    <Tabs value={value} onValueChange={(nextValue) => setValue(nextValue as typeof value)}>
      <TabsList className="task-board-view-tabs task-board-layout-tabs" aria-label="Task board view mode">
        <span
          aria-hidden="true"
          className="task-board-view-tab-indicator"
          style={{ transform: `translateX(${value === "board" ? 0 : 100}%)` }}
        />
        <TabsTrigger value="board" className="task-board-view-tab-trigger" disabled={disabled === "board"}>
          <IconBoard size={16} aria-hidden="true" />
          Board
        </TabsTrigger>
        <TabsTrigger value="list" className="task-board-view-tab-trigger" disabled={disabled === "list"}>
          <IconListCheck size={16} aria-hidden="true" />
          List
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

const NavigationSpecimens = () => (
  <div className="design-graph-state-grid design-graph-state-grid-wide">
    <StateNode component="navigation" state="file-explorer-explorer" label="File sidebar · Files expanded">
      <FileExplorerSections initialExpanded="files" />
    </StateNode>
    <StateNode component="navigation" state="file-explorer-bookmarks" label="File sidebar · Bookmarks expanded">
      <FileExplorerSections initialExpanded="bookmarks" />
    </StateNode>
    <StateNode component="navigation" state="file-explorer-recent" label="File sidebar · Recent expanded">
      <FileExplorerSections initialExpanded="recent" />
    </StateNode>
    <StateNode component="navigation" state="task-lifecycle-active" label="Task lifecycle · Active">
      <TaskLifecycleTabs initialValue="active" />
    </StateNode>
    <StateNode component="navigation" state="task-lifecycle-closed" label="Task lifecycle · Closed">
      <TaskLifecycleTabs initialValue="closed" />
    </StateNode>
    <StateNode component="navigation" state="task-layout-board" label="Task layout · Board">
      <TaskLayoutTabs initialValue="board" />
    </StateNode>
    <StateNode component="navigation" state="task-layout-list" label="Task layout · List">
      <TaskLayoutTabs initialValue="list" />
    </StateNode>
    <StateNode component="navigation" state="task-layout-board-disabled" label="Task layout · Board unavailable">
      <TaskLayoutTabs initialValue="list" disabled="board" />
    </StateNode>
    <StateNode component="navigation" state="task-layout-list-disabled" label="Task layout · List unavailable">
      <TaskLayoutTabs initialValue="board" disabled="list" />
    </StateNode>
  </div>
);

const MenuSpecimens = () => (
  <div className="design-graph-state-grid design-graph-state-grid-wide">
    <StateNode component="context-menu" state="file-actions">
      <div className="design-graph-menu" role="menu">
        <ContextMenuItems entries={fileMenuEntries} run={noop} />
      </div>
    </StateNode>
    <StateNode component="context-menu" state="directory-actions">
      <div className="design-graph-menu" role="menu">
        <ContextMenuItems entries={directoryMenuEntries} run={noop} />
      </div>
    </StateNode>
    <StateNode component="context-menu" state="workspace-root-actions">
      <div className="design-graph-menu" role="menu">
        <ContextMenuItems entries={rootMenuEntries} run={noop} />
      </div>
    </StateNode>
    <StateNode component="context-menu" state="note-tab-actions">
      <div className="design-graph-menu" role="menu">
        <ContextMenuItems entries={noteTabMenuEntries} run={noop} />
      </div>
    </StateNode>
    <StateNode component="context-menu" state="task-actions">
      <div className="design-graph-menu" role="menu">
        <ContextMenuItems entries={taskMenuEntries} run={noop} />
      </div>
    </StateNode>
    <StateNode component="context-menu" state="unavailable-actions">
      <div className="design-graph-menu" role="menu">
        <ContextMenuItems entries={unavailableMenuEntries} run={noop} />
      </div>
    </StateNode>
  </div>
);

const DragDropSpecimens = () => (
  <div className="design-graph-state-grid design-graph-state-grid-wide">
    <StateNode component="drag-drop" state="file-preview-move">
      <DragPreviewSurface
        icon={getFileGlyph("review-interface.md")}
        text="review-interface.md"
        subtext="Move to Research"
      />
    </StateNode>
    <StateNode component="drag-drop" state="file-preview-link">
      <DragPreviewSurface
        icon={getFileGlyph("review-interface.md")}
        text="review-interface.md"
        subtext="Insert link here"
      />
    </StateNode>
    <StateNode component="drag-drop" state="folder-preview">
      <DragPreviewSurface icon={<IconFolder className="h-3.5 w-3.5" />} text="Assets" subtext="Move to Notes" />
    </StateNode>
    <StateNode component="drag-drop" state="note-tab-preview">
      <DragPreviewSurface icon={getFileGlyph("review-interface.md")} text="review-interface.md" />
    </StateNode>
    <StateNode component="drag-drop" state="task-preview-awaiting">
      <DragPreviewSurface text={baseTask.title} subtext="Choose a position" />
    </StateNode>
    <StateNode component="drag-drop" state="task-preview-target">
      <DragPreviewSurface text={baseTask.title} subtext="Research, position 2" />
    </StateNode>
    <StateNode component="drag-drop" state="task-source">
      <div className="design-graph-task-drag-source">
        <TaskBoardTask
          dnd={{ clear: noop, draggedPath: baseTask.path, startDrag: noop }}
          item={baseTask}
          {...taskSpecimenProps}
        />
      </div>
    </StateNode>
    <StateNode component="drag-drop" state="task-board-slot">
      <div className="design-graph-task-drop-zone">
        <div className="task-board-drop-placeholder task-board-drop-placeholder-board" />
      </div>
    </StateNode>
    <StateNode component="drag-drop" state="task-list-slot">
      <div className="design-graph-task-drop-zone">
        <div className="task-board-drop-placeholder task-board-drop-placeholder-list" />
      </div>
    </StateNode>
    <StateNode component="drag-drop" state="note-tab-slot">
      <div className="design-graph-tab-strip">
        <div className="pane-tab pane-tab-active">
          <span className="pane-tab-separator pane-tab-separator-before pane-tab-separator-hidden" aria-hidden="true" />
          <button type="button" className="pane-tab-label">
            <span className="pane-tab-title">notes.md</span>
          </button>
          <button type="button" className="pane-tab-close" aria-label="Close notes.md" onClick={noop}>
            <IconX size={14} />
          </button>
        </div>
        <div className="pane-tab">
          <VerticalInsertionLine side="before" active />
          <button type="button" className="pane-tab-label">
            <span className="pane-tab-title">research.md</span>
          </button>
          <button type="button" className="pane-tab-close" aria-label="Close research.md" onClick={noop}>
            <IconX size={14} />
          </button>
        </div>
      </div>
    </StateNode>
    <StateNode component="drag-drop" state="pane-split-slot">
      <div className="design-graph-pane-split">
        <div className="design-graph-current-pane">Current pane</div>
        <SplitDropIndicator orientation="vertical" />
      </div>
    </StateNode>
  </div>
);

const TaskSpecimens = () => {
  return (
    <div className="design-graph-state-grid design-graph-state-grid-wide">
      <StateNode component="task-card" state="default">
        <TaskBoardTask item={baseTask} {...taskSpecimenProps} />
      </StateNode>
      <StateNode component="task-card" state="warning">
        <TaskBoardTask
          item={{ ...baseTask, id: "warning-task", path: "/warning", metadataIssues: ["Invalid date"] }}
          {...taskSpecimenProps}
        />
      </StateNode>
      <StateNode component="task-card" state="closed">
        <TaskBoardTask
          item={{ ...baseTask, id: "closed-task", path: "/closed", status: "done" }}
          {...taskSpecimenProps}
        />
      </StateNode>
    </div>
  );
};

const NotificationSpecimens = () => {
  const states = [
    ["info", NotificationLevel.INFO, "Copied 1 item", undefined],
    ["busy", NotificationLevel.INFO, "Importing 12 items…", "Destination: Research"],
    ["warning", NotificationLevel.WARNING, "File already exists", 'A note already exists at "research.md"'],
    ["error", NotificationLevel.ERROR, "File import failed", "The selected file could not be read."],
  ] as const;

  return (
    <div className="design-graph-state-grid design-graph-state-grid-wide">
      {states.map(([state, level, title, message]) => (
        <StateNode key={state} component="notification" state={state}>
          <NotificationCard
            busy={state === "busy"}
            className="design-graph-notification"
            level={level}
            message={message}
            onDismiss={noop}
            title={title}
          />
        </StateNode>
      ))}
    </div>
  );
};

const OverlaySpecimens = () => (
  <div className="design-graph-grid">
    <StateNode component="overlays" state="dialog">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">Inspect dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog inspection</DialogTitle>
            <DialogDescription>
              Check focus, scrolling, and Escape at the smallest supported window size.
            </DialogDescription>
          </DialogHeader>
          <Input aria-label="Dialog input" placeholder="Untitled note" />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button>Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StateNode>
    <StateNode component="overlays" state="popover">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">Inspect popover</Button>
        </PopoverTrigger>
        <PopoverContent>
          <Input aria-label="Popover input" placeholder="Filter entries…" />
        </PopoverContent>
      </Popover>
    </StateNode>
    <StateNode component="overlays" state="recovery">
      <RecoveryState
        compact
        title="Preview unavailable"
        description="The file could not be read. Your content is unchanged."
        onAction={noop}
      />
    </StateNode>
  </div>
);

const sectionRenderers: Record<string, { description: string; render: () => ReactNode }> = {
  settings: {
    description:
      "Proposed Settings system: consistent rows, input types, and live interactions. Preview values are not persisted.",
    render: SettingsSpecimens,
  },
  overlays: {
    description: "Live shared overlays and recovery feedback; no workspace files are changed.",
    render: OverlaySpecimens,
  },
  surfaces: {
    description: "Semantic layers rendered side by side in the active theme.",
    render: SurfaceSpecimens,
  },
  button: {
    description: "Only variant, size, and disabled combinations instantiated by production application code.",
    render: ButtonSpecimens,
  },
  input: {
    description: "Content, validation, leading-icon, and availability permutations.",
    render: InputSpecimens,
  },
  badge: {
    description: "Metadata, category, semantic, selected, and interactive roles.",
    render: BadgeSpecimens,
  },
  navigation: {
    description: "Production File Explorer, task lifecycle, and task layout tabs with live sliding indicators.",
    render: NavigationSpecimens,
  },
  "context-menu": {
    description: "Production file, directory, workspace, note-tab, and task menus plus unavailable actions.",
    render: MenuSpecimens,
  },
  "drag-drop": {
    description: "Production pointer previews, dragged sources, insertion slots, and pane split targets.",
    render: DragDropSpecimens,
  },
  "task-card": {
    description: "The production task card rendered with ordinary, invalid, and closed data.",
    render: TaskSpecimens,
  },
  notification: {
    description: "Raised transient feedback across information, progress, warning, and error states.",
    render: NotificationSpecimens,
  },
};

export default function DesignGraph() {
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const visibleEntries = useMemo(
    () => DESIGN_GRAPH_INDEX.filter((entry) => matchesDesignGraphEntry(entry, query)),
    [query],
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    return () => document.documentElement.classList.remove("dark");
  }, [theme]);

  return (
    <div className="design-graph" data-design-graph="obim" data-design-theme={theme}>
      <header className="design-graph-header">
        <div>
          <p className="design-graph-eyebrow">Obim local development</p>
          <h1>Design graph</h1>
          <p>
            {DESIGN_GRAPH_INDEX.length} component families · {graphStateCount} deterministic state nodes
          </p>
        </div>
        <div className="design-graph-header-actions">
          <div className="design-graph-theme-switch" aria-label="Preview theme" role="group">
            <IconButton
              icon={IconSun}
              label="Light theme"
              aria-pressed={theme === "light"}
              className={theme === "light" ? "design-graph-theme-active" : undefined}
              onClick={() => setTheme("light")}
            />
            <IconButton
              icon={IconMoon}
              label="Dark theme"
              aria-pressed={theme === "dark"}
              className={theme === "dark" ? "design-graph-theme-active" : undefined}
              onClick={() => setTheme("dark")}
            />
          </div>
          <div className="design-graph-filter">
            <IconSearch aria-hidden="true" />
            <Input
              type="search"
              aria-label="Filter design graph"
              placeholder="Filter components or states…"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              inset="leadingIcon"
            />
          </div>
        </div>
      </header>

      <div className="design-graph-layout">
        <aside className="design-graph-index" aria-label="Design graph index">
          {(["Foundations", "Primitives", "Compositions"] as const).map((group) => {
            const groupEntries = visibleEntries.filter((entry) => entry.group === group);
            if (!groupEntries.length) return null;
            return (
              <div key={group}>
                <h2>{group}</h2>
                {groupEntries.map((entry) => (
                  <a key={entry.id} href={`#${entry.id}`}>
                    <span>{entry.label}</span>
                    <span>{entry.states.length}</span>
                  </a>
                ))}
              </div>
            );
          })}
        </aside>

        <main className="design-graph-content">
          <div className="design-graph-intro">
            <div>
              <h2>Production states & design proposals</h2>
              <p>
                Props and data states are fixed; hover, pressed, focus-visible, menus, and controls remain live for
                interaction inspection.
              </p>
            </div>
            <code>data-design-component · data-design-state</code>
          </div>

          {visibleEntries.map((entry) => {
            const section = sectionRenderers[entry.id];
            return (
              <SpecimenSection key={entry.id} entry={entry} description={section.description}>
                {section.render()}
              </SpecimenSection>
            );
          })}

          {!visibleEntries.length ? (
            <div className="design-graph-empty">
              <IconFileText aria-hidden="true" />
              <h2>No matching specimens</h2>
              <p>Try a component, group, or state name.</p>
            </div>
          ) : null}
        </main>
      </div>
      <ContextMenuHost id="design-graph-context-menu" />
    </div>
  );
}
