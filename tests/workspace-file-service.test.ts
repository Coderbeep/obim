import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createDirectory,
  createFile,
  fingerprintWorkspaceFile,
  trashFile,
  moveFile,
  openInDefaultApp,
  readBinaryFile,
  readLargeTextPreview,
  readFile,
  readTextFile,
  renameFile,
  saveBinaryFile,
  saveFile,
} from "../src/renderer/src/features/files/workspaceFileService";
import type { FileItem } from "../src/shared/file-item";

function installWindow(api: Record<string, unknown>) {
  const globals = globalThis as unknown as { window?: unknown };
  const hadWindow = "window" in globals;
  const previousWindow = globals.window;

  globals.window = {
    api,
    config: {
      getMainDirectoryPathSync: () => "/notes-root",
    },
  };

  return () => {
    if (hadWindow) globals.window = previousWindow;
    else delete globals.window;
  };
}

test("createFile refuses to overwrite an existing path", async () => {
  let created = false;
  const restoreWindow = installWindow({
    createFile: async () => {
      created = true;
      return { success: false, error: "Destination file already exists" };
    },
  });

  try {
    const result = await createFile("/notes-root/notes", "Existing.md", "content");

    assert.equal(result.success, false);
    assert.equal(created, true);
  } finally {
    restoreWindow();
  }
});

test("creation rejects invalid names and directories outside the notes root", async () => {
  let calls = 0;
  const restoreWindow = installWindow({
    createFile: async () => {
      calls += 1;
      return { success: true };
    },
    createDirectory: async () => {
      calls += 1;
      return true;
    },
  });

  try {
    assert.deepEqual(await createFile("/notes-root/notes", "../other.md"), {
      success: false,
      error: "Invalid filename",
    });
    assert.deepEqual(await createFile("notes", "Valid.md"), {
      success: false,
      error: "Directory is outside the notes directory",
    });
    assert.deepEqual(await createDirectory("/outside", "Valid directory"), {
      success: false,
      error: "Directory is outside the notes directory",
    });
    assert.equal(calls, 0);
  } finally {
    restoreWindow();
  }
});

test("renameFile rejects invalid names before calling the filesystem", async () => {
  let renamed = false;
  const restoreWindow = installWindow({
    renameFile: async () => {
      renamed = true;
      return { success: true, output: "/notes-root/notes/renamed.md" };
    },
  });

  try {
    const result = await renameFile("/notes-root/notes/original.md", "invalid:name.md");

    assert.deepEqual(result, { success: false, error: "Invalid filename" });
    assert.equal(renamed, false);
  } finally {
    restoreWindow();
  }
});

test("renameFile returns the filesystem destination", async () => {
  const restoreWindow = installWindow({
    renameFile: async () => ({ success: true, output: "/notes-root/notes/renamed.md" }),
  });

  try {
    const result = await renameFile("/notes-root/notes/original.md", "renamed.md");
    assert.deepEqual(result, { success: true, output: "/notes-root/notes/renamed.md" });
  } finally {
    restoreWindow();
  }
});

test("moveFile returns the filesystem destination", async () => {
  const restoreWindow = installWindow({
    moveFile: async () => ({ success: true, output: "/notes-root/archive/original.md" }),
  });

  try {
    const result = await moveFile("/notes-root/notes/original.md", "/notes-root/archive");
    assert.deepEqual(result, { success: true, output: "/notes-root/archive/original.md" });
  } finally {
    restoreWindow();
  }
});

test("readFile preserves an IPC read failure instead of treating it as empty content", async () => {
  const restoreWindow = installWindow({
    openFile: async () => {
      throw new Error("Permission denied");
    },
  });
  const originalError = console.error;
  console.error = () => {};

  try {
    const result = await readFile("/notes-root/private.md");

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /Permission denied/);
  } finally {
    console.error = originalError;
    restoreWindow();
  }
});

test("readBinaryFile preserves workspace file bytes", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const restoreWindow = installWindow({
    readBinaryFile: async () => bytes,
  });

  try {
    assert.deepEqual(await readBinaryFile("/notes-root/report.pdf"), { success: true, content: bytes });
  } finally {
    restoreWindow();
  }
});

test("fingerprintWorkspaceFile maps the main-process content identity", async () => {
  const restoreWindow = installWindow({
    fingerprintWorkspaceFile: async () => "sha256:report",
  });

  try {
    assert.deepEqual(await fingerprintWorkspaceFile("/notes-root/report.pdf"), {
      success: true,
      fingerprint: "sha256:report",
    });
  } finally {
    restoreWindow();
  }
});

test("fingerprintWorkspaceFile falls back when a hot-reloaded renderer has an older preload", async () => {
  const restoreWindow = installWindow({
    readBinaryFile: async () => new TextEncoder().encode("research-pdf"),
  });

  try {
    assert.deepEqual(await fingerprintWorkspaceFile("/notes-root/report.pdf"), {
      success: true,
      fingerprint: "sha256:177761a43c1f61ef2a0651df6c0597985ca198d3cf5597d1d6981744e03bb589",
    });
  } finally {
    restoreWindow();
  }
});

test("editor text reads and saves carry the disk version through preload", async () => {
  const openedVersion = { id: "opened", mtimeMs: 100, sizeBytes: 8 };
  const savedVersion = { id: "saved", mtimeMs: 200, sizeBytes: 7 };
  const saveCalls: unknown[][] = [];
  const restoreWindow = installWindow({
    openTextFile: async () => ({ content: "original", version: openedVersion }),
    saveFile: async (...args: unknown[]) => {
      saveCalls.push(args);
      return { success: true, version: savedVersion };
    },
  });

  try {
    assert.deepEqual(await readTextFile("/notes-root/note.md"), {
      success: true,
      content: "original",
      version: openedVersion,
    });
    assert.deepEqual(await saveFile("/notes-root/note.md", "updated", openedVersion), {
      success: true,
      version: savedVersion,
    });
    assert.deepEqual(saveCalls, [["/notes-root/note.md", "updated", openedVersion]]);
  } finally {
    restoreWindow();
  }
});

test("editor saves fail closed when no disk version is available", async () => {
  let saves = 0;
  const restoreWindow = installWindow({
    saveFile: async () => {
      saves += 1;
      return { success: true };
    },
  });

  try {
    assert.deepEqual(await saveFile("/notes-root/note.md", "updated"), {
      success: false,
      error: "Missing file version",
    });
    assert.equal(saves, 0);
  } finally {
    restoreWindow();
  }
});

test("readLargeTextPreview maps preload results and failures", async () => {
  const preview = { content: "bounded", previewBytes: 7, sizeBytes: 20, truncated: true };
  let shouldFail = false;
  const restoreWindow = installWindow({
    readLargeTextPreview: async () => {
      if (shouldFail) throw new Error("Preview failed");
      return preview;
    },
  });

  try {
    assert.deepEqual(await readLargeTextPreview("/notes-root/large.md"), {
      success: true,
      preview,
    });
    shouldFail = true;
    assert.deepEqual(await readLargeTextPreview("/notes-root/large.md"), {
      success: false,
      error: "Error: Preview failed",
    });
  } finally {
    restoreWindow();
  }
});

test("openInDefaultApp delegates to the preload API", async () => {
  let openedPath = "";
  const restoreWindow = installWindow({
    openInDefaultApp: async (path: string) => {
      openedPath = path;
      return { success: true };
    },
  });

  try {
    assert.deepEqual(await openInDefaultApp("/notes-root/documents/report.pdf"), { success: true });
    assert.equal(openedPath, "/notes-root/documents/report.pdf");
  } finally {
    restoreWindow();
  }
});

test("createFile returns resolved file metadata", async () => {
  const createdFile: FileItem = {
    id: "resolved-id",
    filename: "Created",
    relativePath: "notes/Created.md",
    path: "/notes-root/notes/Created.md",
    isDirectory: false,
    mimeType: "text/markdown",
  };
  let savedPath = "";
  const restoreWindow = installWindow({
    createFile: async (path: string) => {
      savedPath = path;
      return { success: true, file: createdFile };
    },
  });

  try {
    const result = await createFile("/notes-root/notes", "Created.md", "content");
    assert.equal(result.success, true);
    assert.equal(result.file, createdFile);
    assert.equal(savedPath, "/notes-root/notes/Created.md");
  } finally {
    restoreWindow();
  }
});

test("createFile uses authoritative metadata returned by the main process", async () => {
  const createdFile: FileItem = {
    id: "filesystem-id",
    filename: "Saved",
    relativePath: "notes/Saved.md",
    path: "/notes-root/notes/Saved.md",
    sizeBytes: 7,
    isDirectory: false,
    mimeType: "text/markdown",
  };
  const restoreWindow = installWindow({
    createFile: async () => ({ success: true, file: createdFile }),
  });

  try {
    const result = await createFile("/notes-root/notes", "Saved.md", "content");
    assert.deepEqual(result, { success: true, file: createdFile });
  } finally {
    restoreWindow();
  }
});

test("trashFile returns the filesystem result", async () => {
  const restoreWindow = installWindow({
    trashFile: async () => ({ success: true }),
  });

  try {
    assert.deepEqual(await trashFile("/notes-root/notes/remove.md"), { success: true });
  } finally {
    restoreWindow();
  }
});

test("saveBinaryFile saves without owning UI state", async () => {
  let savedPath = "";
  const restoreWindow = installWindow({
    saveBinaryFile: async (path: string) => {
      savedPath = path;
      return true;
    },
  });

  try {
    const result = await saveBinaryFile("attachments/pasted-image.png", new Uint8Array([1]).buffer);
    assert.deepEqual(result, { success: true });
    assert.equal(savedPath, "attachments/pasted-image.png");
  } finally {
    restoreWindow();
  }
});

test("saveBinaryFile rejects absolute paths and traversal before calling the filesystem", async () => {
  let saves = 0;
  const restoreWindow = installWindow({
    saveBinaryFile: async () => {
      saves += 1;
      return true;
    },
  });

  try {
    assert.deepEqual(await saveBinaryFile("/notes-root/image.png", new ArrayBuffer(0)), {
      success: false,
      error: "Invalid relative path",
    });
    assert.deepEqual(await saveBinaryFile("../image.png", new ArrayBuffer(0)), {
      success: false,
      error: "Invalid relative path",
    });
    assert.equal(saves, 0);
  } finally {
    restoreWindow();
  }
});
