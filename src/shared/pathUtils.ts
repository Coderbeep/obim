import type { FileItem } from "./file-item";

const normalizeSeparators = (path: string) => path.replace(/\\/g, "/");
const trimTrailingSlashes = (path: string) => normalizeSeparators(path).replace(/\/+$/, "");
const trimLeadingSlashes = (path: string) => path.replace(/^\/+/, "");
const normalizeJoinBase = (path: string) => {
  const normalized = normalizeSeparators(path);
  return /^(?:[A-Za-z]:)?\/+$/u.test(normalized) ? normalized.replace(/\/+$/, "/") : normalized.replace(/\/+$/, "");
};
const invalidFilenameCharacters = /[<>:"/\\|?*]/;
const reservedWindowsFilename = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;
const hasControlCharacter = (value: string) => Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f);

/**
 * Keeps names usable on both Linux and Windows while preserving spaces and Unicode.
 */
export const isValidFilename = (filename: string) => {
  const trimmed = filename.trim();
  return (
    trimmed === filename &&
    Boolean(trimmed) &&
    trimmed !== "." &&
    trimmed !== ".." &&
    !trimmed.endsWith(".") &&
    !invalidFilenameCharacters.test(trimmed) &&
    !hasControlCharacter(trimmed) &&
    !reservedWindowsFilename.test(trimmed)
  );
};

/**
 * Returns the final segment of a filesystem path (filename with extension).
 * Handles both Unix and Windows separators.
 */
export const basename = (path: string) => {
  const normalized = trimTrailingSlashes(path);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
};

/**
 * Removes only the final extension from a filename.
 * Example: "note.backup.md" -> "note.backup".
 */
export const stripLastExt = (name: string) => {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
};

/**
 * Returns a path's extension including the dot, or an empty string if missing.
 */
export const getExt = (path: string) => {
  const normalized = normalizeSeparators(path);
  const slashIndex = normalized.lastIndexOf("/");
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex > slashIndex ? path.slice(dotIndex) : "";
};

/**
 * Appends `ext` to `base` unless `base` already ends with it (case-insensitive).
 */
export const withExt = (base: string, ext: string) => {
  const trimmed = base.trim();
  if (!ext) return trimmed;
  return trimmed.toLowerCase().endsWith(ext.toLowerCase()) ? trimmed : trimmed + ext;
};

/**
 * Extracts filename without extension from a full path.
 */
export const getFilenameNoExtFromPath = (path: string) => stripLastExt(basename(path));

/**
 * Extracts filename with extension from a full path.
 */
export const getFilenameWithExtFromPath = (path: string) => basename(path);

/** Returns whether `path` is absolute on Unix or Windows. */
export const isAbsoluteFsPath = (path: string) => {
  const normalized = normalizeSeparators(path);
  return normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized);
};

/** Keeps every segment of a relative path portable and prevents traversal. */
export const isValidRelativePath = (path: string) =>
  Boolean(path) && !isAbsoluteFsPath(path) && normalizeSeparators(path).split("/").every(isValidFilename);

/** Returns whether `path` is equal to or lexically inside `base`. */
export const isPathWithinBase = (path: string, base: string) => {
  const normalizedPath = trimTrailingSlashes(path);
  const normalizedBaseWithRoot = normalizeSeparators(base);
  const normalizedBase = trimTrailingSlashes(base);

  if (normalizedPath === normalizedBase) return true;
  if (!normalizedBaseWithRoot) return false;
  return normalizedPath.startsWith(normalizedBase ? `${normalizedBase}/` : "/");
};

/**
 * Returns a path relative to `base`.
 * Throws when `path` is outside `base`.
 */
export const getRelativePathFromPath = (path: string, base: string) => {
  const normalizedPath = normalizeSeparators(path);
  const normalizedBase = trimTrailingSlashes(base);

  if (!isPathWithinBase(normalizedPath, base)) {
    throw new Error(`Path is outside base directory: ${path}`);
  }

  if (trimTrailingSlashes(normalizedPath) === normalizedBase) return "";
  return trimLeadingSlashes(normalizedPath.slice(normalizedBase.length));
};

/**
 * Returns directory portion of a path without trailing slash.
 */
export const getPathWithoutFilename = (path: string) => {
  const normalized = normalizeSeparators(path);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : "";
};

/**
 * Normalizes a FileItem after path changes so path-derived fields stay in sync.
 */
export const normalizeFileItemPath = (file: FileItem, path: string, notesDirectoryPath: string): FileItem => {
  const isVirtualPath = path.includes("://");
  if (isVirtualPath) {
    return {
      ...file,
      path,
      relativePath: file.relativePath ?? "",
      filename: file.filename,
    };
  }

  return {
    ...file,
    path,
    relativePath: path.replace(`${notesDirectoryPath}/`, ""),
    filename: file.isDirectory ? basename(path) : stripLastExt(basename(path)),
  };
};

/** Creates a predicate matching removed files and descendants of removed directories. */
export const createRemovedPathMatcher = (removedItems: readonly FileItem[]) => (path: string) =>
  removedItems.some((item) => path === item.path || (item.isDirectory && path.startsWith(`${item.path}/`)));

/** Maps a path through a completed file or directory move. */
export const remapPathAfterMove = (
  path: string,
  sourcePath: string,
  destinationPath: string,
  movedIsDirectory: boolean,
) => {
  if (path === sourcePath) return destinationPath;
  if (movedIsDirectory && path.startsWith(`${sourcePath}/`)) {
    return destinationPath + path.slice(sourcePath.length);
  }
  return path;
};

/**
 * Normalizes a note-relative path for media URLs.
 * media:// is a custom scheme we use to load images from the notes directory.
 */
export const normalizeNotePath = (src: string) => {
  const normalized = normalizeSeparators(src).trim();
  return normalized.startsWith("/") ? normalized.slice(1) : normalized;
};

/**
 * Joins two filesystem path parts using a single "/" separator.
 */
export const joinFsPath = (base: string, rel: string) => {
  const normalizedBase = normalizeJoinBase(base);
  const normalizedRel = trimLeadingSlashes(trimTrailingSlashes(rel));

  if (!normalizedBase) return normalizedRel;
  if (!normalizedRel) return normalizedBase;
  return `${normalizedBase}${normalizedBase.endsWith("/") ? "" : "/"}${normalizedRel}`;
};

/**
 * Converts a note-relative path into a `media:///` URL.
 */
export const toMediaUrl = (src: string) => {
  const rel = normalizeNotePath(src);
  return `media:///${rel.split("/").map(encodeURIComponent).join("/")}`;
};
