import type { FileTreeSortEntry } from "@pierre/trees";
import type { ExplorerSortPreference } from "@renderer/store/explorerSortStore";
import type { FileItem } from "@shared/file-item";
import { basename } from "@shared/pathUtils";
import { getFileHandlingMode } from "@shared/mime-types";

const ARCHIVE_EXTENSIONS = new Set([
  "7z",
  "bz",
  "bz2",
  "gz",
  "gzip",
  "jar",
  "rar",
  "tar",
  "tbz",
  "tbz2",
  "tgz",
  "war",
  "xz",
  "zip",
  "zst",
]);
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "psd",
  "svg",
  "tif",
  "tiff",
  "webp",
]);
const NOTE_EXTENSIONS = new Set(["markdown", "md", "mdown", "mdx", "mkdn"]);
const AUDIO_EXTENSIONS = new Set(["aac", "aiff", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav"]);
const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm"]);
const ARCHIVE_MIME_TYPES = new Set([
  "application/gzip",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/x-bzip",
  "application/x-bzip2",
  "application/x-gzip",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/x-xz",
  "application/x-zip-compressed",
  "application/zip",
  "application/zstd",
]);

const fileKind = (entry: FileTreeSortEntry, files: ReadonlyMap<string, FileItem>): string => {
  if (entry.isDirectory) return "Folders";
  const name = entry.basename;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const mimeType = files.get(entry.path)?.mimeType?.split(";", 1)[0].trim().toLowerCase() ?? "";
  const handlingMode = getFileHandlingMode(mimeType, name);
  if (ARCHIVE_EXTENSIONS.has(extension) || ARCHIVE_MIME_TYPES.has(mimeType)) return "Archives";
  if (handlingMode === "image" || mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "Images";
  if (handlingMode === "markdown" || NOTE_EXTENSIONS.has(extension)) return "Notes";
  if (handlingMode === "pdf") return "PDFs";
  if (mimeType.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) return "Audio";
  if (mimeType.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) return "Videos";
  if (handlingMode === "text") return "Text";
  return "Other";
};

const compareSiblings = (
  left: FileTreeSortEntry,
  right: FileTreeSortEntry,
  preference: ExplorerSortPreference,
  files: ReadonlyMap<string, FileItem>,
): number => {
  // Expandable PDF rows occupy a companion directory slot but keep PDF ordering.
  const physicalLeft = files.get(left.path);
  const physicalRight = files.get(right.path);
  const leftHasNotes = left.isDirectory && physicalLeft?.isDirectory === false;
  const rightHasNotes = right.isDirectory && physicalRight?.isDirectory === false;
  left = physicalLeft
    ? { ...left, basename: basename(physicalLeft.path), isDirectory: physicalLeft.isDirectory }
    : left;
  right = physicalRight
    ? { ...right, basename: basename(physicalRight.path), isDirectory: physicalRight.isDirectory }
    : right;
  if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
  const direction = preference.direction === "ascending" ? 1 : -1;
  if (preference.by === "type") {
    const leftKind = fileKind(left, files);
    const kindOrder = leftKind.localeCompare(fileKind(right, files));
    if (kindOrder) return direction * kindOrder;
    // Notes-bearing PDFs lead their PDF siblings in either name direction.
    if (leftKind === "PDFs" && leftHasNotes !== rightHasNotes) return leftHasNotes ? -1 : 1;
  }
  return direction * compareNames(left.basename, right.basename);
};

const compareValues = (left: string | number, right: string | number) => (left === right ? 0 : left < right ? -1 : 1);

// Match Pierre's natural, case-insensitive ordering, including leading-zero ties.
const compareNames = (left: string, right: string): number => {
  const leftName = left.toLowerCase();
  const rightName = right.toLowerCase();
  const tokens = (name: string) =>
    (name.match(/\d+|\D+/g) ?? [""]).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const leftTokens = tokens(leftName);
  const rightTokens = tokens(rightName);
  for (let index = 0; index < Math.min(leftTokens.length, rightTokens.length); index += 1) {
    const a = leftTokens[index];
    const b = rightTokens[index];
    const compared =
      typeof a === "number" && typeof b === "number" ? compareValues(a, b) : compareValues(String(a), String(b));
    if (compared) return compared;
  }
  return (
    compareValues(leftTokens.length, rightTokens.length) ||
    compareValues(leftName, rightName) ||
    compareValues(left, right)
  );
};

const atDepth = (entry: FileTreeSortEntry, depth: number): FileTreeSortEntry => {
  if (depth === entry.segments.length - 1) return entry;
  const segments = entry.segments.slice(0, depth + 1);
  return { basename: segments[depth], depth: depth + 1, isDirectory: true, path: `${segments.join("/")}/`, segments };
};

export const compareExplorerEntries = (
  left: FileTreeSortEntry,
  right: FileTreeSortEntry,
  preference: ExplorerSortPreference,
  files: ReadonlyMap<string, FileItem>,
): number => {
  // Pierre uses the comparator for both full input paths and live sibling mutations.
  // Compare the first different ancestor so each directory keeps its entire subtree.
  for (let depth = 0; depth < Math.min(left.segments.length, right.segments.length); depth += 1) {
    if (left.segments[depth] !== right.segments[depth]) {
      return compareSiblings(atDepth(left, depth), atDepth(right, depth), preference, files);
    }
  }
  return left.segments.length - right.segments.length || Number(right.isDirectory) - Number(left.isDirectory);
};
