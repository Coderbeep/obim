const MARKDOWN_MIME_TYPE = "text/markdown";
const MARKDOWN_FILE_EXTENSIONS = new Set(["md", "markdown"]);
const fileExtension = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();

const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/vnd.microsoft.icon": "ico",
  "image/webp": "webp",
  "image/x-icon": "ico",
};

export const SUPPORTED_IMAGE_MIME_TYPES = Object.keys(IMAGE_EXTENSION_BY_MIME_TYPE);
export const imageExtensionFromMimeType = (mimeType: string) => IMAGE_EXTENSION_BY_MIME_TYPE[mimeType] ?? null;
const IMAGE_FILE_EXTENSIONS = new Set([...Object.values(IMAGE_EXTENSION_BY_MIME_TYPE), "jpeg"]);
export const imageExtensionFromPath = (path: string) => {
  const extension = fileExtension(path);
  return IMAGE_FILE_EXTENSIONS.has(extension) ? extension : null;
};
export const isSupportedImagePath = (path: string) => imageExtensionFromPath(path) !== null;

export type FileHandlingMode = "markdown" | "text" | "image" | "pdf" | "external";

export const isPdfFile = (mimeType: string | null | undefined, path: string) =>
  mimeType === "application/pdf" || fileExtension(path) === "pdf";

const EXPLICIT_TEXT_FILE_EXTENSIONS = new Set([
  "json",
  "jsonc",
  "json5",
  "xml",
  "xsd",
  "xsl",
  "xslt",
  "toml",
  "ts",
  "tsx",
  "cts",
  "mts",
  "py",
  "pyw",
  "go",
  "rs",
  "sh",
  "bash",
  "zsh",
  "fish",
  "sql",
  "graphql",
  "gql",
]);
const EXPLICIT_TEXT_MIME_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/sql",
  "application/toml",
  "application/x-sh",
  "application/xml",
]);

export const isMarkdownFile = (mimeType: string | null | undefined, path: string) =>
  mimeType === MARKDOWN_MIME_TYPE ||
  mimeType === "text/x-markdown" ||
  MARKDOWN_FILE_EXTENSIONS.has(fileExtension(path));

export const getFileHandlingMode = (mimeType: string | null | undefined, path: string): FileHandlingMode => {
  if (isMarkdownFile(mimeType, path)) return "markdown";
  if (SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType ?? "")) return "image";
  if (isPdfFile(mimeType, path)) return "pdf";

  if (
    mimeType?.startsWith("text/") ||
    EXPLICIT_TEXT_MIME_TYPES.has(mimeType ?? "") ||
    mimeType?.endsWith("+json") ||
    mimeType?.endsWith("+xml") ||
    EXPLICIT_TEXT_FILE_EXTENSIONS.has(fileExtension(path))
  ) {
    return "text";
  }

  return "external";
};

export const isEditableFile = (mimeType: string | null | undefined, path: string) => {
  const handlingMode = getFileHandlingMode(mimeType, path);
  return handlingMode === "markdown" || handlingMode === "text";
};
