import { clipboard, type WebContents } from "electron";
import type { FileOperationResult } from "@shared/file-operations";

import type { FileImportSource } from "./file-import";
import { isSupportedImagePath } from "@shared/mime-types";

const clipboardFilePaths = () => {
  const paths = clipboard.availableFormats().flatMap((format) => {
    const normalized = format.toLowerCase();
    let values: string[] = [];

    try {
      if (normalized.startsWith("text/uri-list") || normalized === "x-special/gnome-copied-files") {
        values = clipboard.read(format).split(/\r?\n/);
      } else if (normalized === "public.file-url") {
        values = clipboard
          .readBuffer(format)
          .toString("utf8")
          .split(/\0|\r?\n/);
      } else if (normalized === "filenamew") {
        values = clipboard.readBuffer(format).toString("utf16le").split("\0");
      } else if (normalized === "filename") {
        values = clipboard.readBuffer(format).toString("utf8").split("\0");
      }
    } catch {
      return [];
    }

    return values.flatMap((value) => {
      const candidate = value.trim();
      if (!candidate || candidate === "copy" || candidate === "cut" || candidate.startsWith("#")) return [];
      if (!candidate.startsWith("file:")) return [candidate];

      try {
        const url = new URL(candidate);
        if (url.protocol !== "file:") return [];
        const pathname = decodeURIComponent(url.pathname);
        if (url.hostname) return [`//${url.hostname}${pathname}`];
        return [process.platform === "win32" && /^\/[a-z]:\//i.test(pathname) ? pathname.slice(1) : pathname];
      } catch {
        return [];
      }
    });
  });

  return Array.from(new Set(paths.filter(isSupportedImagePath)));
};

export const hasClipboardImageContent = () => {
  try {
    return clipboardFilePaths().length > 0 || !clipboard.readImage().isEmpty();
  } catch {
    return false;
  }
};

export const getClipboardImageSources = (): FileImportSource[] => {
  const paths = clipboardFilePaths();
  if (paths.length) return paths.map((path) => ({ kind: "path", path }));

  try {
    const image = clipboard.readImage();
    return image.isEmpty() ? [] : [{ kind: "buffer", name: "pasted-image.png", content: image.toPNG() }];
  } catch {
    return [];
  }
};

/** Copies the rendered image, including cross-origin images, without granting file or network access. */
export const copyImageAt = (sender: Pick<WebContents, "copyImageAt">, x: unknown, y: unknown): FileOperationResult => {
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > 100000 ||
    y > 100000
  ) {
    return { success: false, error: "Image position is invalid." };
  }
  try {
    sender.copyImageAt(Math.floor(x), Math.floor(y));
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
