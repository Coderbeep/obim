import { readTaskNoteSubtasks, type TaskNoteSubtask } from "@renderer/shared/taskNoteSubtasks";
import { isValidFilename } from "@shared/pathUtils";
import { parseDueDate, toDateInputValue } from "@renderer/shared/date";
import {
  normalizeTaskBoardProjectName,
  parseTaskBoardStage,
  parseTaskPriority,
  taskBoardProjectNameKey,
  type TaskBoardStage,
  type TaskPriority,
  type TaskMetadataSnapshot,
  type TaskBoardWorkflowColumn,
} from "@renderer/shared/taskBoard";
import {
  editFrontmatterSource,
  getFrontmatterProperty,
  locateFrontmatter,
  parseFrontmatter,
  type FrontmatterEdit,
  type FrontmatterInput,
  type FrontmatterProperty,
  type FrontmatterValue,
} from "@shared/frontmatter";
import type { FileItem } from "@shared/file-item";
import {
  TASK_NOTE_FIELD_KEYS,
  TASK_NOTE_STATUSES,
  TASK_NOTE_TYPE,
  instantiateTaskNoteFrontmatter,
} from "@shared/note-type-templates";
import {
  normalizeTaskTags,
  getTaskNameValidationMessage,
  type CreateTaskInput,
  type TaskLifecycleStatus,
  type TaskBoardTask,
  type UpdateTaskMetadataInput,
  type TaskNoteSubtaskChange,
} from "./taskBoardModel";
import { isMarkdownFile } from "@shared/mime-types";
import { createBufferedWorkspaceIndexFile, type IndexedDocument } from "@shared/workspace-index";

type TaskFile = Extract<
  FileItem,
  {
    isDirectory: false;
  }
> & {
  modifiedAtMs?: number;
};

const taskFileMetadata = (file: TaskFile): TaskFile => ({
  id: file.id,
  filename: file.filename,
  relativePath: file.relativePath,
  path: file.path,
  isDirectory: false,
  mimeType: file.mimeType,
  ...(file.sizeBytes === undefined ? {} : { sizeBytes: file.sizeBytes }),
  ...(file.isOpen === undefined ? {} : { isOpen: file.isOpen }),
  ...(file.level === undefined ? {} : { level: file.level }),
  ...(file.modifiedAtMs === undefined ? {} : { modifiedAtMs: file.modifiedAtMs }),
});

export type CreateTaskMarkdownInput = Omit<CreateTaskInput, "taskName"> & { taskName?: string };

const truncateCharacters = (value: string, limit: number) => Array.from(value).slice(0, limit).join("");

const truncateUtf8Bytes = (value: string, limit: number) => {
  const characters = Array.from(value);
  const encoder = new TextEncoder();
  while (encoder.encode(characters.join("")).length > limit) characters.pop();
  return characters.join("");
};

/** Keep paths stable after creation; the authored title belongs to Markdown. */
export const taskFilenameForTitle = (title: string) => {
  const sanitized = Array.from(title.trim())
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ");
  let stem = truncateCharacters(sanitized, 80).replace(/^[. ]+|[. ]+$/g, "");
  if (stem.toLocaleLowerCase().endsWith(".md")) stem = stem.slice(0, -3);
  stem = truncateUtf8Bytes(stem, 180);
  if (!stem || !isValidFilename(stem) || !isValidFilename(`${stem}.md`)) stem = "Task";
  return `${stem}.md`;
};

export const setTaskTitle = (source: string, title: string) => {
  const value = title.trim();
  const error = getTaskNameValidationMessage(value);
  if (error) throw new Error(error);
  return applyEdit(source, { type: "upsert", key: TASK_NOTE_FIELD_KEYS.title, value });
};

const TASK_STATUS_VALUES = new Set<TaskLifecycleStatus>(TASK_NOTE_STATUSES);

const RAW_INVALID_TASK_PATTERN = new RegExp(
  `^${TASK_NOTE_FIELD_KEYS.type}:[ \\t]+(?:${TASK_NOTE_TYPE}|"${TASK_NOTE_TYPE}"|'${TASK_NOTE_TYPE}')[ \\t]*(?:#.*)?$`,
  "m",
);

const TASK_DATE_FIELD_KEYS = new Set<string>([
  TASK_NOTE_FIELD_KEYS.created,
  TASK_NOTE_FIELD_KEYS.closed,
  TASK_NOTE_FIELD_KEYS.due,
]);

const TASK_REPAIRABLE_FIELD_KEYS = [
  TASK_NOTE_FIELD_KEYS.status,
  TASK_NOTE_FIELD_KEYS.created,
  TASK_NOTE_FIELD_KEYS.closed,
  TASK_NOTE_FIELD_KEYS.project,
  TASK_NOTE_FIELD_KEYS.stage,
  TASK_NOTE_FIELD_KEYS.due,
  TASK_NOTE_FIELD_KEYS.priority,
] as const;

const applyEdit = (source: string, edit: FrontmatterEdit) => {
  const result = editFrontmatterSource(source, edit);
  if (!result.success) throw new Error(result.error);
  return result.source;
};

const optionalProject = (project?: string) => {
  const normalized = normalizeTaskBoardProjectName(project ?? "");
  return normalized || undefined;
};

const readTaskFrontmatter = (source: string) => {
  const frontmatter = parseFrontmatter(source);
  if (frontmatter.kind === "invalid") {
    throw new Error(frontmatter.diagnostics[0]?.message ?? "Invalid frontmatter.");
  }
  return frontmatter;
};

const readManagedProperty = (source: string, key: string) => getFrontmatterProperty(readTaskFrontmatter(source), key);

const unsafeManagedProperty = (key: string) => new Error(`Cannot safely update “${key}” through task fields.`);

const singleLineString = (value: FrontmatterValue): value is Extract<FrontmatterValue, { kind: "string" }> =>
  value.kind === "string" && !value.multiline;

const assertWritableProperty = (
  key: string,
  property: FrontmatterProperty | undefined,
  safeValue: (value: FrontmatterValue) => boolean,
) => {
  if (property && (!safeValue(property.value) || property.valueHasComments)) throw unsafeManagedProperty(key);
};

const setOptionalProperty = (
  source: string,
  key: string,
  property: FrontmatterProperty | undefined,
  value: FrontmatterInput | undefined,
) => {
  if (value === undefined) {
    if (!property) return source;
    return applyEdit(source, { type: "remove", key });
  }
  return applyEdit(source, { type: "upsert", key, value });
};

const rawInvalidTask = (source: string) => {
  const envelope = locateFrontmatter(source);
  if (!envelope) return false;
  return RAW_INVALID_TASK_PATTERN.test(source.slice(envelope.bodyRange.from, envelope.bodyRange.to));
};

const dateOnlyProperty = (frontmatter: ReturnType<typeof parseFrontmatter>, key: string, metadataIssues: string[]) => {
  const property = getFrontmatterProperty(frontmatter, key);
  if (!property) return undefined;
  const date = dateOnlyValue(property.value);
  if (date) return date;
  metadataIssues.push(`“${key}” must be a YYYY-MM-DD date.`);
  return undefined;
};

const dateOnlyValue = (value: FrontmatterValue) => {
  const source =
    value.kind === "date" && value.dateOnly ? value.source : value.kind === "string" ? value.value : undefined;
  return source && parseDueDate(source) ? source : undefined;
};

const safeDateValue = (value: FrontmatterValue) =>
  Boolean(dateOnlyValue(value)) && !(value.kind === "string" && value.multiline);

const taskTags = (value: FrontmatterValue | undefined) => {
  if (value?.kind === "string") return normalizeTaskTags([value.value]);
  if (value?.kind === "list" && value.value.every((item) => item.kind === "string"))
    return normalizeTaskTags(value.value.map((item) => item.value));
  return [];
};

const bodyPreview = (source: string, bodyFrom: number, title: string, subtasks: readonly TaskNoteSubtask[]) => {
  const visible: string[] = [];
  let subtaskIndex = 0;
  let leading = true;
  // Keep each authored line ending and use the marker positions already parsed from Markdown.
  for (const line of source.slice(bodyFrom).matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    const from = bodyFrom + line.index;
    const subtask = subtasks[subtaskIndex];
    const checkboxLine = subtask && subtask.from >= from && subtask.from < from + line[0].length;
    const heading = leading ? line[1].match(/^ {0,3}#\s+(.+)$/) : null;
    if (!checkboxLine && heading?.[1]?.trim() !== title) visible.push(line[0]);
    if (checkboxLine) subtaskIndex++;
    if (line[1].trim()) leading = false;
  }
  // Trim outer blank lines without unindenting a leading code example.
  return (
    visible
      .join("")
      .replace(/^(?:[ \t]*(?:\r\n|\r|\n))+/, "")
      .trimEnd() || undefined
  );
};

export const parseTaskMarkdown = (source: string, file: TaskFile): TaskBoardTask | null => {
  const frontmatter = parseFrontmatter(source);
  const type = getFrontmatterProperty(frontmatter, TASK_NOTE_FIELD_KEYS.type)?.value;
  if (
    (type?.kind !== "string" || type.value !== TASK_NOTE_TYPE) &&
    !(frontmatter.kind === "invalid" && rawInvalidTask(source))
  )
    return null;
  const metadataIssues: string[] = [];
  if (frontmatter.kind === "invalid")
    metadataIssues.push(frontmatter.diagnostics[0]?.message ?? "Task frontmatter is invalid.");
  const statusValue = getFrontmatterProperty(frontmatter, TASK_NOTE_FIELD_KEYS.status)?.value;
  let status: TaskLifecycleStatus = "open";
  if (statusValue) {
    if (statusValue.kind === "string" && TASK_STATUS_VALUES.has(statusValue.value as TaskLifecycleStatus)) {
      status = statusValue.value as TaskLifecycleStatus;
    } else {
      metadataIssues.push(`“${TASK_NOTE_FIELD_KEYS.status}” must be open, done, or cancelled.`);
    }
  }
  const createdDate = dateOnlyProperty(frontmatter, TASK_NOTE_FIELD_KEYS.created, metadataIssues);
  const closedDate = dateOnlyProperty(frontmatter, TASK_NOTE_FIELD_KEYS.closed, metadataIssues);
  if (status === "open" && closedDate) metadataIssues.push(`Open tasks cannot have “${TASK_NOTE_FIELD_KEYS.closed}”.`);
  const projectValue = getFrontmatterProperty(frontmatter, TASK_NOTE_FIELD_KEYS.project)?.value;
  const project = projectValue?.kind === "string" ? optionalProject(projectValue.value) : undefined;
  if (projectValue && projectValue.kind !== "string")
    metadataIssues.push(`“${TASK_NOTE_FIELD_KEYS.project}” must be a project name.`);
  const stageValue = getFrontmatterProperty(frontmatter, TASK_NOTE_FIELD_KEYS.stage)?.value;
  const stage = stageValue?.kind === "string" ? parseTaskBoardStage(stageValue.value) : undefined;
  if (stageValue && !stage) metadataIssues.push(`“${TASK_NOTE_FIELD_KEYS.stage}” must be backlog, doing, or review.`);
  const dueDate = dateOnlyProperty(frontmatter, TASK_NOTE_FIELD_KEYS.due, metadataIssues);
  const priorityValue = getFrontmatterProperty(frontmatter, TASK_NOTE_FIELD_KEYS.priority)?.value;
  const priority = priorityValue?.kind === "string" ? parseTaskPriority(priorityValue.value) : undefined;
  if (priorityValue && !priority)
    metadataIssues.push(`“${TASK_NOTE_FIELD_KEYS.priority}” must be high, medium, or low.`);
  const tags = taskTags(getFrontmatterProperty(frontmatter, TASK_NOTE_FIELD_KEYS.tags)?.value);
  const bodyFrom =
    frontmatter.kind === "valid"
      ? frontmatter.envelope.range.to
      : frontmatter.kind === "invalid"
        ? (frontmatter.envelope?.range.to ?? 0)
        : 0;
  const titleValue = getFrontmatterProperty(frontmatter, TASK_NOTE_FIELD_KEYS.title)?.value;
  const title = titleValue?.kind === "string" && titleValue.value.trim() ? titleValue.value.trim() : file.filename;
  const subtasks = readTaskNoteSubtasks(source);
  const preview = bodyPreview(source, bodyFrom, title, subtasks);
  return {
    ...taskFileMetadata(file),
    title,
    ...(subtasks.length ? { subtasks } : {}),
    status,
    metadataIssues,
    frontmatterKeys: frontmatter.kind === "valid" ? frontmatter.properties.map(({ key }) => key) : [],
    ...(createdDate ? { createdDate } : {}),
    ...(closedDate ? { closedDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(priority ? { priority } : {}),
    ...(preview ? { preview } : {}),
    ...(project ? { project } : {}),
    ...(stage ? { stage } : {}),
    ...(tags.length ? { tags } : {}),
  };
};

export const createTaskMarkdown = (
  { taskName, dueDate, initialBody = "", priority, project, stage = "backlog", tags }: CreateTaskMarkdownInput,
  today = toDateInputValue(new Date()),
) => {
  let task = initialBody;
  for (const { key, value } of instantiateTaskNoteFrontmatter({ today })) {
    task = applyEdit(task, { type: "upsert", key, value });
  }
  if (stage === "done") task = setTaskLifecycle(task, "done", today);
  if (taskName) task = setTaskTitle(task, taskName);
  task = setTaskBoardProject(task, project);
  task = setTaskBoardStage(task, stage === "done" ? "backlog" : stage);
  task = setTaskDueDate(task, dueDate);
  task = setTaskPriority(task, priority);
  return setTaskTags(task, tags);
};

const setScalarProperty = (
  source: string,
  key: string,
  next: string | undefined,
  normalize: (value: string) => string | undefined,
  omittedDefault?: string,
) => {
  const property = readManagedProperty(source, key);
  const current = property?.value.kind === "string" ? normalize(property.value.value) : undefined;
  if (current === next) return source;
  assertWritableProperty(key, property, singleLineString);
  return setOptionalProperty(source, key, property, next === omittedDefault ? undefined : next);
};

export const setTaskBoardProject = (source: string, project?: string) =>
  setScalarProperty(source, TASK_NOTE_FIELD_KEYS.project, optionalProject(project), optionalProject);

export const setTaskBoardStage = (source: string, stage: TaskBoardStage) =>
  setScalarProperty(source, TASK_NOTE_FIELD_KEYS.stage, stage, parseTaskBoardStage, "backlog");

export const setTaskDueDate = (source: string, dueDate?: string) => {
  const key = TASK_NOTE_FIELD_KEYS.due;
  const property = readManagedProperty(source, key);
  const current = property ? dateOnlyValue(property.value) : undefined;
  const parsed = dueDate ? parseDueDate(dueDate) : undefined;
  if (dueDate && !parsed) throw new Error("Task dates must use YYYY-MM-DD.");
  const next = parsed ? toDateInputValue(parsed) : undefined;
  if (current === next) return source;
  assertWritableProperty(key, property, safeDateValue);
  return setOptionalProperty(source, key, property, next ? new Date(`${next}T00:00:00.000Z`) : undefined);
};

export const setTaskPriority = (source: string, priority?: TaskPriority) =>
  setScalarProperty(source, TASK_NOTE_FIELD_KEYS.priority, priority, parseTaskPriority);

const sameStrings = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const setTaskTags = (source: string, tags: readonly string[] = []) => {
  const key = TASK_NOTE_FIELD_KEYS.tags;
  const property = readManagedProperty(source, key);
  const current = taskTags(property?.value);
  const next = normalizeTaskTags(tags);
  if (sameStrings(current, next)) return source;
  assertWritableProperty(
    key,
    property,
    (value) => singleLineString(value) || (value.kind === "list" && value.value.every(singleLineString)),
  );
  return setOptionalProperty(source, key, property, next.length ? next : undefined);
};

const metadataValue = (
  input: UpdateTaskMetadataInput | TaskMetadataSnapshot,
  key: "project" | "stage" | "dueDate" | "priority" | "tags",
) =>
  key === "tags"
    ? normalizeTaskTags(input.tags ?? [])
    : key === "project"
      ? optionalProject(input.project)
      : input[key] || undefined;

const sameMetadataValue = (left: string | string[] | undefined, right: string | string[] | undefined) =>
  Array.isArray(left) && Array.isArray(right) ? sameStrings(left, right) : left === right;

/** Compare against the form's original snapshot; save-time version checks only protect the later read/write interval. */
export const updateTaskMetadata = (source: string, input: UpdateTaskMetadataInput, fallbackTitle = "") => {
  const original = input.original;
  // Only the metadata is used here; a filename is deliberately not synthesized from Markdown.
  const current = original
    ? parseTaskMarkdown(source, {
        id: "",
        filename: fallbackTitle,
        relativePath: "",
        path: "",
        isDirectory: false,
        mimeType: "text/markdown",
      })
    : null;
  if (original && !current) throw new Error("This file is no longer a task. Reopen it before editing task fields.");
  let next = source;
  if (input.taskName !== undefined && input.taskName.trim() !== original?.taskName) {
    if (original && current?.title !== original.taskName && current?.title !== input.taskName.trim())
      throw new Error("Task title changed since editing began. Reopen the editor to review it.");
    next = setTaskTitle(next, input.taskName);
  }
  for (const key of ["project", "stage", "dueDate", "priority", "tags"] as const) {
    if (!Object.hasOwn(input, key)) continue;
    const desired = metadataValue(input, key);
    if (original) {
      const before = metadataValue(original, key);
      if (sameMetadataValue(desired, before)) continue;
      const latest = metadataValue(current!, key);
      if (!sameMetadataValue(latest, before) && !sameMetadataValue(latest, desired)) {
        throw new Error(`Task ${key} changed since editing began. Reopen the task editor to review the latest value.`);
      }
    }
    if (key === "project") next = setTaskBoardProject(next, input.project);
    else if (key === "stage") next = setTaskBoardStage(next, input.stage ?? "backlog");
    else if (key === "dueDate") next = setTaskDueDate(next, input.dueDate);
    else if (key === "priority") next = setTaskPriority(next, input.priority);
    else next = setTaskTags(next, input.tags);
  }
  return next;
};

/** Normalize unambiguous invalid shapes; never rebuild authored metadata from a lossy board model. */
export const repairTaskMetadata = (source: string, task: TaskBoardTask) => {
  const frontmatter = parseFrontmatter(source);
  if (frontmatter.kind !== "valid") {
    throw new Error("The YAML syntax must be fixed in the task file before metadata can be repaired automatically.");
  }
  let next = source;
  for (const key of TASK_REPAIRABLE_FIELD_KEYS) {
    const property = getFrontmatterProperty(frontmatter, key);
    if (!property) continue;
    const interpreted = (value: FrontmatterValue): FrontmatterInput | undefined => {
      if (TASK_DATE_FIELD_KEYS.has(key)) {
        const date = dateOnlyValue(value);
        return date ? new Date(`${date}T00:00:00.000Z`) : undefined;
      }
      if (value.kind !== "string" || value.multiline) return undefined;
      if (key === TASK_NOTE_FIELD_KEYS.status)
        return TASK_STATUS_VALUES.has(value.value as TaskLifecycleStatus) ? value.value : undefined;
      if (key === TASK_NOTE_FIELD_KEYS.stage) return parseTaskBoardStage(value.value);
      if (key === TASK_NOTE_FIELD_KEYS.priority) return parseTaskPriority(value.value);
      return value.value;
    };
    if (interpreted(property.value) !== undefined) continue;
    const candidate =
      property.value.kind === "list" && property.value.value.length === 1
        ? interpreted(property.value.value[0])
        : undefined;
    if (candidate === undefined || property.valueHasComments) {
      throw new Error(
        `“${key}” cannot be repaired automatically without replacing authored data. Edit its value manually in the note details.`,
      );
    }
    next = applyEdit(next, { type: "upsert", key, value: candidate });
  }
  if (parseTaskMarkdown(next, task)?.metadataIssues.length) {
    throw new Error(
      "These task values conflict and cannot be repaired automatically. Review them manually in the note details.",
    );
  }
  return next;
};

export const setTaskLifecycle = (source: string, status: TaskLifecycleStatus, today = toDateInputValue(new Date())) => {
  const frontmatter = readTaskFrontmatter(source);
  const statusProperty = getFrontmatterProperty(frontmatter, TASK_NOTE_FIELD_KEYS.status);
  const closedProperty = getFrontmatterProperty(frontmatter, TASK_NOTE_FIELD_KEYS.closed);
  assertWritableProperty(
    TASK_NOTE_FIELD_KEYS.status,
    statusProperty,
    (value) => singleLineString(value) && TASK_STATUS_VALUES.has(value.value as TaskLifecycleStatus),
  );
  assertWritableProperty(TASK_NOTE_FIELD_KEYS.closed, closedProperty, safeDateValue);
  const next = applyEdit(source, { type: "upsert", key: TASK_NOTE_FIELD_KEYS.status, value: status });
  return setOptionalProperty(
    next,
    TASK_NOTE_FIELD_KEYS.closed,
    closedProperty,
    status === "open" ? undefined : new Date(`${today}T00:00:00.000Z`),
  );
};

export function changeTaskNoteSubtasks(source: string, change: TaskNoteSubtaskChange): string {
  if (parseFrontmatter(source).kind === "invalid")
    throw new Error("Repair the note’s frontmatter before editing subtasks.");
  if (change.kind === "append") {
    const text = change.text.trim();
    if (!text || /[\r\n]/.test(text)) throw new Error("Enter a subtask on one line.");
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const lastTask = readTaskNoteSubtasks(source).at(-1);
    const endsWithTask = lastTask && source.slice(lastTask.to).trim() === lastTask.text;
    const endsWithNewline = /\r?\n$/.test(source);
    let separator = "";
    if (endsWithTask) {
      if (!endsWithNewline) separator = newline;
    } else if (source && !/(?:\r?\n){2}$/.test(source)) {
      separator = endsWithNewline ? newline : newline + newline;
    }
    const result = source + separator + `- [ ] ${text}` + newline;
    const last = readTaskNoteSubtasks(result).at(-1);
    if (!last || last.from < source.length)
      throw new Error("Close the unfinished code block or frontmatter in the note before adding a subtask.");
    return result;
  }
  const current = readTaskNoteSubtasks(source);
  if (
    current.length !== change.expected.length ||
    current.some((task, index) => {
      const expected = change.expected[index];
      return task.text !== expected.text || task.checked !== expected.checked || task.depth !== expected.depth;
    })
  )
    throw new Error("The checkboxes changed in the note. Try again using the updated list.");
  const item = current[change.index];
  if (!item) throw new Error("This subtask is no longer in the note.");
  return source.slice(0, item.from) + (change.checked ? "[x]" : "[ ]") + source.slice(item.to);
}

export type TaskWorkflowChange =
  | { kind: "lifecycle"; status: TaskLifecycleStatus }
  | { kind: "move"; project: string; stage?: TaskBoardWorkflowColumn };

/** Decide lifecycle from the latest note and retain the field-specific authored YAML guards. */
export const changeTaskWorkflow = (source: string, task: TaskBoardTask, change: TaskWorkflowChange) => {
  const current = parseTaskMarkdown(source, task);
  if (!current) throw new Error("This file is no longer a task.");
  if (change.kind === "lifecycle") {
    if (current.metadataIssues.length)
      throw new Error(`Correct the task metadata first: ${current.metadataIssues.join(" ")}`);
    if (change.status === "open" ? current.status === "open" : current.status !== "open")
      return { source, task: current, changed: false, removePin: false };
    const next = setTaskLifecycle(source, change.status);
    return { source: next, task: parseTaskMarkdown(next, task)!, changed: next !== source, removePin: true };
  }
  if (current.status === "cancelled") throw new Error("Reopen the cancelled task before moving it.");
  const stage = change.stage ?? (current.status === "done" ? "done" : (current.stage ?? "backlog"));
  let next =
    taskBoardProjectNameKey(current.project ?? "") === taskBoardProjectNameKey(change.project)
      ? source
      : setTaskBoardProject(source, change.project);
  if (stage === "done") {
    if (current.status !== "done") next = setTaskLifecycle(next, "done");
  } else {
    if ((current.stage ?? "backlog") !== stage) next = setTaskBoardStage(next, stage);
    if (current.status !== "open") next = setTaskLifecycle(next, "open");
  }
  return {
    source: next,
    task: parseTaskMarkdown(next, task)!,
    changed: next !== source,
    removePin: stage === "done" || current.status !== "open",
  };
};

export type WorkspaceTaskDiscoveryInput = {
  documents: readonly IndexedDocument[];
  fileBuffersByPath: Readonly<
    Record<
      string,
      | {
          readonly editorText: string;
        }
      | undefined
    >
  >;
  workspacePath: string;
};

export const discoverWorkspaceTaskFiles = ({
  documents,
  fileBuffersByPath,
  workspacePath,
}: WorkspaceTaskDiscoveryInput): TaskBoardTask[] => {
  const byPath = new Map(documents.map((document) => [document.file.path, document]));
  for (const path of Object.keys(fileBuffersByPath).filter((path) => isMarkdownFile(null, path)))
    if (!byPath.has(path))
      byPath.set(path, {
        file: createBufferedWorkspaceIndexFile(path, workspacePath),
        source: "",
      });
  return [...byPath.values()].flatMap(({ file, modifiedAtMs, source }) => {
    try {
      const current = fileBuffersByPath[file.path]?.editorText ?? source;
      const task = parseTaskMarkdown(current, { ...file, ...(modifiedAtMs === undefined ? {} : { modifiedAtMs }) });
      return task ? [task] : [];
    } catch {
      return [];
    }
  });
};

export const getEditorBufferSnapshot = (
  buffers: Record<
    string,
    {
      editorText: string;
    }
  >,
) => new Map(Object.entries(buffers).map(([path, buffer]) => [path, buffer.editorText]));

export const changedBufferPaths = (previous: Map<string, string>, next: Map<string, string>) =>
  [...new Set([...previous.keys(), ...next.keys()])].filter((path) => previous.get(path) !== next.get(path));

export const reconcileChangedTasks = (
  current: TaskBoardTask[],
  changedPaths: readonly string[],
  discovered: readonly TaskBoardTask[],
) => {
  const changed = new Set(changedPaths);
  const replacements = new Map(discovered.map((task) => [task.path, task]));
  const next = current.flatMap((task) => {
    if (!changed.has(task.path)) return [task];
    const replacement = replacements.get(task.path);
    replacements.delete(task.path);
    return replacement ? [replacement] : [];
  });
  return [...next, ...replacements.values()];
};
