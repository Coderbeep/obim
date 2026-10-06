import { test } from "vitest";

import assert from "node:assert/strict";

import {
  copyWorkspaceItems,
  hasClipboardImageFiles,
  importClipboardImages,
  importExternalFiles,
} from "../../src/renderer/src/features/files/workspaceFileService";

const importedPath = "/notes-root/inbox/report.md";

const installWindow = (api: Record<string, unknown>) => {
  const globals = globalThis as unknown as { window?: unknown };
  const hadWindow = "window" in globals;
  const previousWindow = globals.window;
  globals.window = { api, config: { getMainDirectoryPathSync: () => "/notes-root" } };

  return () => {
    if (hadWindow) globals.window = previousWindow;
    else delete globals.window;
  };
};

test("renderer imports File objects through preload without a metadata cache", async () => {
  const dropped = [{ name: "report.md" }] as unknown as File[];
  let receivedFiles: readonly File[] = [];
  let receivedDestination = "";
  const restoreWindow = installWindow({
    importExternalFiles: async (files: readonly File[], destination: string) => {
      receivedFiles = files;
      receivedDestination = destination;
      return { importedPaths: [importedPath], errors: [] };
    },
  });
  try {
    const result = await importExternalFiles(dropped, "/notes-root/inbox");
    assert.deepEqual(result, { importedPaths: [importedPath], errors: [] });
    assert.equal(receivedFiles, dropped);
    assert.equal(receivedDestination, "/notes-root/inbox");
  } finally {
    restoreWindow();
  }
});

test("renderer rejects an empty external drop before invoking preload", async () => {
  let invoked = false;
  const restoreWindow = installWindow({
    importExternalFiles: async () => {
      invoked = true;
      return { importedPaths: [], errors: [] };
    },
  });

  try {
    assert.deepEqual(await importExternalFiles([], "/notes-root"), {
      importedPaths: [],
      errors: ["No filesystem files were dropped."],
    });
    assert.equal(invoked, false);
  } finally {
    restoreWindow();
  }
});

test("renderer preserves a preload import failure", async () => {
  const restoreWindow = installWindow({
    importExternalFiles: async () => {
      throw new Error("Permission denied");
    },
  });

  try {
    const result = await importExternalFiles([{ name: "report.md" }] as unknown as File[], "/notes-root");
    assert.deepEqual(result.importedPaths, []);
    assert.match(result.errors[0], /Permission denied/);
  } finally {
    restoreWindow();
  }
});

test("renderer imports copied image files into attachments and returns workspace-relative links", async () => {
  let createdDirectory = "";
  let importDestination = "";
  const restoreWindow = installWindow({
    createDirectory: async (path: string) => {
      createdDirectory = path;
      return { success: false, error: "Destination directory already exists" };
    },
    hasClipboardImageFiles: () => true,
    importClipboardImages: async (destination: string) => {
      importDestination = destination;
      return { importedPaths: ["/notes-root/attachments/Photo.png"], errors: [] };
    },
  });

  try {
    assert.equal(hasClipboardImageFiles(), true);
    assert.deepEqual(await importClipboardImages(), {
      errors: [],
      relativePaths: ["attachments/Photo.png"],
    });
    assert.equal(createdDirectory, "/notes-root/attachments");
    assert.equal(importDestination, "/notes-root/attachments");
  } finally {
    restoreWindow();
  }
});

test("renderer copies a complete workspace selection through one bridge request", async () => {
  const sourcePaths = ["/notes-root/one.md", "/notes-root/Folder"];
  const destination = "/notes-root/Target";
  const expected = {
    copiedPaths: ["/notes-root/Target/one.md"],
    errors: ["Folder: a folder cannot be imported into itself."],
  };
  let receivedSources: string[] = [];
  let receivedDestination = "";
  const restoreWindow = installWindow({
    copyWorkspaceItems: async (sources: string[], target: string) => {
      receivedSources = sources;
      receivedDestination = target;
      return expected;
    },
  });

  try {
    assert.deepEqual(await copyWorkspaceItems(sourcePaths, destination), expected);
    assert.equal(receivedSources, sourcePaths);
    assert.equal(receivedDestination, destination);
  } finally {
    restoreWindow();
  }
});

test("renderer ignores an empty workspace copy and preserves bridge failures", async () => {
  let invoked = false;
  const restoreWindow = installWindow({
    copyWorkspaceItems: async () => {
      invoked = true;
      throw new Error("outside workspace");
    },
  });

  try {
    assert.deepEqual(await copyWorkspaceItems([], "/notes-root"), { copiedPaths: [], errors: [] });
    assert.equal(invoked, false);
    assert.deepEqual(await copyWorkspaceItems(["/outside/note.md"], "/notes-root"), {
      copiedPaths: [],
      errors: ["Error: outside workspace"],
    });
  } finally {
    restoreWindow();
  }
});
