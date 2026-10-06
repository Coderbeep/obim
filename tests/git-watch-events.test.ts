import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { classifyGitWatchEvent } from "../src/main/git-watch-events";
import { classifyWorkspaceIndexWatchEvent } from "../src/main/workspace-index-watcher";

describe("filesystem watcher classification", () => {
  it("completely ignores application-owned metadata and atomic temporary writes", () => {
    assert.equal(classifyGitWatchEvent("rename", ".obim/bookmarks.json", true), null);
    assert.equal(classifyGitWatchEvent("rename", ".obim/.obim-write-123", true), null);
    assert.equal(classifyWorkspaceIndexWatchEvent("/notes", "rename", ".obim/bookmarks.json"), null);
    assert.equal(classifyWorkspaceIndexWatchEvent("/notes", "rename", ".DS_Store"), null);
  });

  it("reports an atomic note replacement by path without asserting that the tree changed", () => {
    assert.deepEqual(classifyGitWatchEvent("change", "Folder/note.md", true), {
      path: "Folder/note.md",
      treeMayHaveChanged: false,
    });
    assert.deepEqual(classifyWorkspaceIndexWatchEvent("/notes", "rename", "Folder/note.md"), {
      kind: "refresh",
      path: "/notes/Folder/note.md",
    });
  });

  it("marks worktree renames for renderer-side existence classification", () => {
    assert.deepEqual(classifyGitWatchEvent("rename", "Folder/new.md", true), {
      path: "Folder/new.md",
      treeMayHaveChanged: true,
    });
  });

  it("distinguishes Git index activity from history changes", () => {
    assert.deepEqual(classifyGitWatchEvent("change", ".git/index", true), { treeMayHaveChanged: false });
    assert.deepEqual(classifyGitWatchEvent("change", ".git/refs/heads/main", true), {
      historyMayHaveChanged: true,
      treeMayHaveChanged: false,
    });
  });
});
