import { isolateHistory } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@renderer/features/editor/codemirror-view";
import { NotificationLevel, type Notification } from "@renderer/features/notifications/notifications";
import {
  hasClipboardImageFiles,
  importClipboardImages,
  saveBinaryFile,
} from "@renderer/features/files/workspaceFileService";
import { FILE_DRAG_DATA_MIME } from "@shared/drag-data";
import { imageExtensionFromMimeType, imageExtensionFromPath } from "@shared/mime-types";
import { appDndBridge } from "@renderer/shared/dnd/bridge";
import {
  getWorkspaceTransitionGeneration,
  isWorkspaceTransitionActive,
  trackWorkspaceActivity,
} from "@renderer/store/workspaceTransitionStore";
import { editableBodyStart } from "./FrontmatterExtension";
import { serializeMarkdownDestination } from "./shared/markdownDestination";

const PastedImageDirectory = "attachments";

function singleWebUrl(text: string) {
  const candidate = text.trim();
  if (!/^https?:\/\//i.test(candidate) || /[\s\p{Cc}\\]/u.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return url.hostname ? candidate : null;
  } catch {
    return null;
  }
}

export function buildPastedImagePath(
  mimeType: string,
  token = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
  filename = "",
) {
  const extension = imageExtensionFromMimeType(mimeType) ?? imageExtensionFromPath(filename);
  return extension ? `${PastedImageDirectory}/pasted-image-${token}.${extension}` : null;
}

export function parseCsvRows(text: string, delimiter = ",") {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      cell += char;
    }
  }

  if (inQuotes) return null;
  if (cell || row.length || text.length) {
    row.push(cell);
    rows.push(row);
  }

  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }

  return rows;
}

const escapeTableCell = (cell: string) =>
  cell
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]|]/g, "\\$&")
    .replace(/\r?\n|\r/g, "<br>");

export function csvTextToMarkdownTable(text: string) {
  if (!text.includes(",")) return null;

  const rows = parseCsvRows(text);
  if (rows?.some((row) => row.length < 2)) return null;
  return rowsToMarkdownTable(rows);
}

function rowsToMarkdownTable(rows: string[][] | null) {
  if (!rows || rows.length < 2) return null;
  if (rows.some((row) => row.length < 1)) return null;

  const columnCount = Math.max(...rows.map((row) => row.length));

  const escapedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => escapeTableCell(row[index] ?? "")),
  );
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(3, ...escapedRows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) => `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;

  return [line(escapedRows[0]), line(widths.map((width) => "-".repeat(width))), ...escapedRows.slice(1).map(line)].join(
    "\n",
  );
}

export function clipboardTableToMarkdown(data: DataTransfer) {
  const types = Array.from(data.types ?? []);
  if (types.includes("text/html")) {
    const template = document.createElement("template");
    template.innerHTML = data.getData("text/html");
    const tables = template.content.querySelectorAll("table");
    if (tables.length !== 1) return null;
    const remainder = template.content.cloneNode(true) as DocumentFragment;
    remainder.querySelector("table")?.remove();
    for (const metadata of remainder.querySelectorAll("head, meta, link, style, title")) metadata.remove();
    if (
      remainder.textContent?.trim() ||
      remainder.querySelector("img, video, audio, iframe, object, embed, svg, canvas, hr, input, button")
    )
      return null;
    const rows = Array.from(tables[0].rows);
    if (rows.some((row) => Array.from(row.cells).some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1))) return null;
    const cellText = (node: Node): string =>
      node.nodeName === "BR"
        ? "\n"
        : node.nodeType === Node.TEXT_NODE
          ? (node.textContent ?? "")
          : Array.from(node.childNodes, cellText).join("");
    return rowsToMarkdownTable(rows.map((row) => Array.from(row.cells, cellText)));
  }
  // Delimiters in text/plain are never evidence of spreadsheet intent.
  if (types.includes("text/tab-separated-values")) {
    return rowsToMarkdownTable(parseCsvRows(data.getData("text/tab-separated-values"), "\t"));
  }
  if (types.includes("text/csv")) return csvTextToMarkdownTable(data.getData("text/csv"));
  return null;
}

function clipboardImageFiles(data: DataTransfer) {
  const itemFiles = Array.from(data.items).reduce<File[]>((files, item) => {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file && (imageExtensionFromMimeType(file.type) || imageExtensionFromPath(file.name))) files.push(file);
    }
    return files;
  }, []);

  if (itemFiles.length) return itemFiles;

  return Array.from(data.files).filter(
    (file) => imageExtensionFromMimeType(file.type) || imageExtensionFromPath(file.name),
  );
}

const isNativeFileTransfer = (data: DataTransfer | null) => {
  const types = Array.from(data?.types ?? []);
  return types.includes("Files") && !types.includes(FILE_DRAG_DATA_MIME);
};

function showPasteImageError(notify: (notification: Notification) => void) {
  notify({
    id: crypto.randomUUID(),
    level: NotificationLevel.ERROR,
    title: "Image paste failed",
    message: "The image could not be saved to the notes folder.",
    timestamp: Date.now(),
  });
}

async function saveImageLinks(files: File[]) {
  const savedLinks = await Promise.all(
    files.map(async (file, index) => {
      const relativePath = buildPastedImagePath(
        file.type,
        `${Date.now()}-${index}-${crypto.randomUUID().slice(0, 8)}`,
        file.name,
      );
      if (!relativePath) return null;

      const saved = await saveBinaryFile(relativePath, await file.arrayBuffer());
      return saved.success ? `![](${serializeMarkdownDestination(relativePath)})` : null;
    }),
  );
  return savedLinks.filter((link): link is string => link !== null);
}

interface PendingImageTarget {
  workspaceGeneration: number;
  from: number;
  to: number;
  valid: boolean;
  result?: string[];
  userEvent: "input.paste" | "input.drop";
}

class PendingImageImports {
  pasteAsPlainText = false;
  private alive = true;
  private pending: PendingImageTarget[] = [];

  constructor(
    private readonly view: EditorView,
    private readonly notify: (notification: Notification) => void,
    private readonly onFilesCreated: () => void,
  ) {}

  update(update: ViewUpdate) {
    for (const transaction of update.transactions) {
      for (const target of this.pending) {
        if (!target.valid) continue;
        transaction.changes.iterChangedRanges((from, to) => {
          const overlaps =
            target.from === target.to
              ? from < to && from <= target.from && to >= target.to
              : (from < target.to && to > target.from) || (from === to && from > target.from && from < target.to);
          if (overlaps) target.valid = false;
        });
        if (!target.valid) continue;
        const empty = target.from === target.to;
        target.from = transaction.changes.mapPos(target.from, 1);
        target.to = empty ? target.from : transaction.changes.mapPos(target.to, -1);
      }
    }
  }

  destroy() {
    this.alive = false;
    this.pending = [];
  }

  enqueue(importLinks: () => Promise<string[]>, position?: number) {
    if (isWorkspaceTransitionActive()) return;
    const range = this.view.state.selection.main;
    const target: PendingImageTarget = {
      workspaceGeneration: getWorkspaceTransitionGeneration(),
      from: Math.max(editableBodyStart(this.view.state), position ?? range.from),
      to: Math.max(editableBodyStart(this.view.state), position ?? range.to),
      valid: true,
      userEvent: position === undefined ? "input.paste" : "input.drop",
    };
    this.pending.push(target);
    void trackWorkspaceActivity(async () => {
      let links: string[];
      try {
        links = await importLinks();
      } catch {
        links = [];
      }
      this.finish(target, links);
    });
  }

  private finish(target: PendingImageTarget, links: string[]) {
    if (!this.alive) return;
    if (!isWorkspaceTransitionActive() && target.workspaceGeneration === getWorkspaceTransitionGeneration()) {
      if (links.length) this.onFilesCreated();
      else showPasteImageError(this.notify);
    }
    target.result = links;
    // Imports run concurrently, but completion publishes in invocation order.
    // This also makes two insertions at the same mapped cursor deterministic.
    while (this.pending[0]?.result !== undefined) {
      const ready = this.pending.shift()!;
      if (
        !ready.valid ||
        !ready.result!.length ||
        this.view.state.readOnly ||
        isWorkspaceTransitionActive() ||
        ready.workspaceGeneration !== getWorkspaceTransitionGeneration()
      )
        continue;
      this.view.dispatch({
        changes: { from: ready.from, to: ready.to, insert: ready.result!.join("\n") },
        userEvent: ready.userEvent,
        annotations: isolateHistory.of("full"),
      });
    }
  }
}

export function createPasteExtension(
  notify: (notification: Notification) => void,
  onFilesCreated: () => void = () => {},
) {
  // A new extension instance belongs to the current note. Reconfiguration or
  // setState destroys its tracker, so stale promises cannot edit another note.
  const pendingImports = ViewPlugin.define((view) => new PendingImageImports(view, notify, onFilesCreated));
  return [
    pendingImports,
    EditorView.domEventHandlers({
      keydown(event, view) {
        const tracker = view.plugin(pendingImports);
        if (tracker)
          tracker.pasteAsPlainText =
            event.key.toLowerCase() === "v" && event.shiftKey && (event.metaKey || event.ctrlKey);
        return false;
      },
      keyup(_event, view) {
        const tracker = view.plugin(pendingImports);
        if (tracker) tracker.pasteAsPlainText = false;
        return false;
      },
      paste(event, view) {
        const data = event.clipboardData;
        if (!data || view.state.readOnly) return false;
        const tracker = view.plugin(pendingImports);
        const plainText = tracker?.pasteAsPlainText;
        if (tracker) tracker.pasteAsPlainText = false;
        if (plainText) {
          if (data.getData("text/plain") || data.getData("text/uri-list")) return false;
          event.preventDefault();
          return true;
        }

        const images = clipboardImageFiles(data);
        if (images.length) {
          event.preventDefault();
          event.stopPropagation();
          view.plugin(pendingImports)?.enqueue(() => saveImageLinks(images));
          return true;
        }

        const table = clipboardTableToMarkdown(data);
        if (table) {
          event.preventDefault();
          view.dispatch(view.state.replaceSelection(table), { userEvent: "input.paste" });
          return true;
        }

        const text = data.getData("text/plain");
        const url = singleWebUrl(text);
        if (url && view.state.selection.ranges.some((range) => !range.empty)) {
          event.preventDefault();
          const destination = serializeMarkdownDestination(url);
          view.dispatch(
            view.state.changeByRange((range) => {
              const label = view.state.sliceDoc(range.from, range.to).replace(/([\\[\]])/g, "\\$1");
              const insert = range.empty ? text : `[${label}](${destination})`;
              return {
                changes: { from: range.from, to: range.to, insert },
                range: EditorSelection.cursor(range.from + insert.length),
              };
            }),
            { userEvent: "input.paste" },
          );
          return true;
        }

        // Consume explicit browser payloads before consulting native-only image
        // formats. Ordinary text does not need a synchronous clipboard IPC call.
        const hasTextPayload = Boolean(data.getData("text/plain") || data.getData("text/uri-list"));
        if (!hasTextPayload && hasClipboardImageFiles()) {
          event.preventDefault();
          event.stopPropagation();
          view.plugin(pendingImports)?.enqueue(async () => {
            const result = await importClipboardImages();
            return result.relativePaths.map((path) => `![](${serializeMarkdownDestination(path)})`);
          });
          return true;
        }

        if (!hasTextPayload) {
          // An unavailable or unsupported clipboard payload is not a deletion.
          event.preventDefault();
          return true;
        }
        return false;
      },
      dragover(event, view) {
        if (!isNativeFileTransfer(event.dataTransfer)) return false;
        event.preventDefault();
        event.stopPropagation();
        if (view.state.readOnly) return true;
        event.dataTransfer!.dropEffect = "copy";
        appDndBridge.updateTarget({
          valid: clipboardImageFiles(event.dataTransfer!).length > 0,
          key: "editor:image",
          label: "editor image insertion point",
        });
        return true;
      },
      drop(event, view) {
        const data = event.dataTransfer;
        if (!isNativeFileTransfer(data)) return false;

        event.preventDefault();
        event.stopPropagation();
        if (view.state.readOnly) return true;
        const images = clipboardImageFiles(data!);
        if (!images.length) return true;
        if (!appDndBridge.canCommit("external-files")) return true;

        const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
        appDndBridge.complete();
        view.plugin(pendingImports)?.enqueue(() => saveImageLinks(images), position);
        return true;
      },
    }),
  ];
}
