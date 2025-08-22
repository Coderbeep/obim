export const SUPPORTED_MARKDOWN_MIME_TYPE = "text/markdown";

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

export const SUPPORTED_FILE_MIME_TYPES = [
  SUPPORTED_MARKDOWN_MIME_TYPE,
  ...SUPPORTED_IMAGE_MIME_TYPES,
];
