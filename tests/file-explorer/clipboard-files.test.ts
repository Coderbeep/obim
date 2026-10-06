import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  availableFormats: vi.fn<() => string[]>(() => []),
  read: vi.fn<(format: string) => string>(() => ""),
  readBuffer: vi.fn<(format: string) => Buffer>(() => Buffer.alloc(0)),
  readImage: vi.fn(),
}));

vi.mock("electron", () => ({
  clipboard: {
    availableFormats: state.availableFormats,
    read: state.read,
    readBuffer: state.readBuffer,
    readImage: state.readImage,
  },
}));

import { copyImageAt, getClipboardImageSources, hasClipboardImageContent } from "../../src/main/clipboard-files";

beforeEach(() => {
  state.availableFormats.mockReset().mockReturnValue([]);
  state.read.mockReset().mockReturnValue("");
  state.readBuffer.mockReset().mockReturnValue(Buffer.alloc(0));
  state.readImage.mockReset().mockReturnValue({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) });
});

test("resolves copied image-file URIs and filters unrelated clipboard paths", () => {
  state.availableFormats.mockReturnValue(["text/uri-list", "x-special/gnome-copied-files"]);
  state.read.mockImplementation((format) =>
    format === "text/uri-list"
      ? "# copied files\nfile:///outside/Photo%20One.png\nfile:///outside/readme.txt"
      : "copy\nfile:///outside/Photo%20One.png\nfile:///outside/second.jpeg",
  );

  assert.equal(hasClipboardImageContent(), true);
  assert.deepEqual(getClipboardImageSources(), [
    { kind: "path", path: "/outside/Photo One.png" },
    { kind: "path", path: "/outside/second.jpeg" },
  ]);
  assert.equal(state.readImage.mock.calls.length, 0);
});

test("falls back to native image bytes when a file manager exposes no file URI", () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  state.readImage.mockReturnValue({ isEmpty: () => false, toPNG: () => bytes });

  assert.equal(hasClipboardImageContent(), true);
  assert.deepEqual(getClipboardImageSources(), [{ kind: "buffer", name: "pasted-image.png", content: bytes }]);
});

test("copies the actual rendered image through Chromium rather than a path string", () => {
  const sender = { copyImageAt: vi.fn() };
  assert.deepEqual(copyImageAt(sender, 140.8, 75.2), { success: true });
  assert.deepEqual(sender.copyImageAt.mock.calls, [[140, 75]]);
});

test("rejects invalid image coordinates without changing clipboard contents", () => {
  const sender = { copyImageAt: vi.fn() };
  for (const [x, y] of [
    [NaN, 20],
    [Infinity, 20],
    [-1, 20],
    [20, 100001],
    ["20", 20],
    [20, null],
  ]) {
    assert.equal(copyImageAt(sender, x, y).success, false);
  }
  assert.equal(sender.copyImageAt.mock.calls.length, 0);
});

test("reports native clipboard errors", () => {
  const sender = {
    copyImageAt: vi.fn(() => {
      throw new Error("Clipboard unavailable");
    }),
  };
  assert.deepEqual(copyImageAt(sender, 10, 20), { success: false, error: "Clipboard unavailable" });
});
