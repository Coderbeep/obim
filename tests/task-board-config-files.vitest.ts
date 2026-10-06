import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  readTaskBoardConfig,
  pruneTaskBoardOrderAfterTrashes,
  remapTaskBoardOrderAfterFileMove,
  updateTaskBoardConfig,
} from "../src/renderer/src/features/workspace/taskBoardConfig";

let exists: boolean;
let source: string;

beforeEach(() => {
  exists = true;
  source = JSON.stringify({ projects: [], taskOrder: [] });
  window.config = { getMainDirectoryPathSync: () => "/notes" } as Window["config"];
  window.api = {
    doesFileExist: vi.fn(async () => exists),
    openFile: vi.fn(async () => source),
    upsertFile: vi.fn(async (_path: string, content: string) => {
      exists = true;
      source = content;
      return true;
    }),
  } as unknown as Window["api"];
});

describe("Task Board config file access", () => {
  it.each(["{not json", '{"projects":[],"taskOrder":{}}'])(
    "distinguishes missing and malformed config without overwriting either: %s",
    async (malformed) => {
      exists = false;
      await expect(readTaskBoardConfig()).resolves.toEqual({ status: "missing" });

      exists = true;
      source = malformed;
      await expect(readTaskBoardConfig()).resolves.toEqual({ status: "invalid" });
      await expect(remapTaskBoardOrderAfterFileMove("/notes/Old.md", "/notes/New.md", false)).resolves.toBe(false);
      expect(window.api.upsertFile).not.toHaveBeenCalled();
      expect(source).toBe(malformed);
    },
  );

  it("serializes hook and file-action writes against the latest config", async () => {
    source = JSON.stringify({
      projects: [{ name: "Research", colorId: "blue" }],
      taskOrder: ["Old.md"],
    });
    let releaseFirst!: () => void;
    vi.mocked(window.api.upsertFile)
      .mockImplementationOnce(
        async (_path, content) =>
          new Promise<boolean>((resolve) => {
            releaseFirst = () => {
              source = content;
              resolve(true);
            };
          }),
      )
      .mockImplementation(async (_path, content) => {
        source = content;
        return true;
      });

    const recolor = updateTaskBoardConfig(
      (config) => ({ ...config, projects: [{ name: "Research", colorId: "rose" }] }),
      true,
    );
    const rename = remapTaskBoardOrderAfterFileMove("/notes/Old.md", "/notes/New.md", false);

    await vi.waitFor(() => expect(window.api.upsertFile).toHaveBeenCalledTimes(1));
    releaseFirst();
    await expect(Promise.all([recolor, rename])).resolves.toEqual([
      {
        success: true,
        config: { projects: [{ name: "Research", colorId: "rose" }], taskOrder: ["Old.md"] },
      },
      true,
    ]);
    expect(JSON.parse(source)).toEqual({
      projects: [{ name: "Research", colorId: "rose" }],
      taskOrder: ["New.md"],
    });
  });
});

it("follows pinned paths on folder moves and removes trashed pins", async () => {
  source = JSON.stringify({ projects: [], taskOrder: [], pinnedTasks: ["Old/A.md", "Other.md"] });
  await remapTaskBoardOrderAfterFileMove("/notes/Old", "/notes/New", true);
  expect(JSON.parse(source).pinnedTasks).toEqual(["New/A.md", "Other.md"]);
  await pruneTaskBoardOrderAfterTrashes([{ path: "/notes/New", directory: true }]);
  expect(JSON.parse(source).pinnedTasks).toEqual(["Other.md"]);
});
