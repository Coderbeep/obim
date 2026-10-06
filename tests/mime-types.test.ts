import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getFileHandlingMode,
  imageExtensionFromPath,
  imageExtensionFromMimeType,
  isEditableFile,
  isMarkdownFile,
  isPdfFile,
  isSupportedImagePath,
} from "../src/shared/mime-types";

test("markdown files use the markdown handling mode", () => {
  assert.equal(getFileHandlingMode("text/markdown", "notes/plan.md"), "markdown");
  assert.equal(getFileHandlingMode("application/octet-stream", "notes/plan.markdown"), "markdown");
  assert.equal(isMarkdownFile("text/x-markdown", "notes/plan.txt"), true);
});

test("known text and source files use the plain-text handling mode", () => {
  for (const [mimeType, path] of [
    ["application/json", "data/settings.json"],
    ["application/xml", "data/feed.xml"],
    ["application/toml", "data/config.toml"],
    ["application/octet-stream", "src/main.py"],
    ["video/mp2t", "src/app.ts"],
    ["application/x-sh", "scripts/build.sh"],
    ["application/sql", "db/schema.sql"],
  ]) {
    assert.equal(getFileHandlingMode(mimeType, path), "text", path);
    assert.equal(isEditableFile(mimeType, path), true, path);
    assert.equal(isMarkdownFile(mimeType, path), false, path);
  }
});

test("viewable images use the image handling mode", () => {
  for (const [mimeType, path] of [
    ["image/png", "images/logo.png"],
    ["image/avif", "images/photo.avif"],
    ["image/bmp", "images/diagram.bmp"],
    ["image/svg+xml", "images/diagram.svg"],
    ["image/vnd.microsoft.icon", "images/favicon.ico"],
  ]) {
    assert.equal(getFileHandlingMode(mimeType, path), "image", path);
  }
});

test("image MIME types share their canonical file extensions", () => {
  assert.equal(imageExtensionFromMimeType("image/jpeg"), "jpg");
  assert.equal(imageExtensionFromMimeType("image/x-icon"), "ico");
  assert.equal(imageExtensionFromMimeType("image/tiff"), null);
});

test("copied filesystem images are recognized by their file extension", () => {
  assert.equal(imageExtensionFromPath("/tmp/Photo.PNG"), "png");
  assert.equal(isSupportedImagePath("/tmp/Photo.PNG"), true);
  assert.equal(isSupportedImagePath("/tmp/photo.jpeg"), true);
  assert.equal(isSupportedImagePath("/tmp/readme.txt"), false);
});

test("PDF files use the built-in PDF viewer by MIME type or extension", () => {
  assert.equal(getFileHandlingMode("application/pdf", "documents/report.bin"), "pdf");
  assert.equal(getFileHandlingMode("application/octet-stream", "documents/REPORT.PDF"), "pdf");
  assert.equal(isPdfFile("application/pdf", "documents/report.bin"), true);
  assert.equal(isPdfFile("application/octet-stream", "documents/report.pdf"), true);
  assert.equal(isEditableFile("application/pdf", "documents/report.pdf"), false);
});

test("binary and document files remain external", () => {
  for (const [mimeType, path] of [
    ["application/zip", "archives/notes.zip"],
    ["audio/mpeg", "recordings/meeting.mp3"],
    ["image/tiff", "images/scan.tiff"],
  ]) {
    assert.equal(getFileHandlingMode(mimeType, path), "external", path);
    assert.equal(isEditableFile(mimeType, path), false, path);
  }
});
