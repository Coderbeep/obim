import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import MarkdownIt from "markdown-it";
import { afterAll, test } from "vitest";
import { serializeMarkdownDestination } from "../src/renderer/src/features/editor/extensions/shared/markdownDestination";
import {
  markdownImagesInText,
  markdownLinksInText,
} from "../src/renderer/src/features/editor/extensions/shared/OverlayMarkdown";
import { resolveLinkedWorkspaceItem } from "../src/renderer/src/features/files/workspaceFileResolver";
import { imageSourceUrl } from "../src/renderer/src/features/files/imageSource";
import type { FileItem } from "../src/shared/file-item";

const root = mkdtempSync(join(tmpdir(), "obim-markdown-destinations-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const destinations = [
  "nested/Project Map.png",
  "nested/diagram (draft).png",
  "nested/[map].png",
  "nested/100%.png",
  "nested/encoded%20literal.png",
  "nested/encoded literal.png",
  "nested/Zażółć 🧭.png",
  "nested/amp&copy;.png",
];
const files: FileItem[] = destinations.map((relativePath) => {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, relativePath);
  return {
    id: path,
    filename: relativePath.split("/").at(-1)!,
    path,
    relativePath,
    isDirectory: false,
    mimeType: "image/png",
  };
});

test.each(destinations)(
  "E07 serialized destination reopens and resolves the exact filesystem name: %s",
  (destination) => {
    const serialized = serializeMarkdownDestination(destination);
    const markdown = `![Map](${serialized} "Keep title")\n[Map](${serialized} 'Keep title')`;
    const note = join(root, "note.md");
    writeFileSync(note, markdown);
    const reopened = readFileSync(note, "utf8");
    const image = markdownImagesInText(reopened, 0, null)[0];
    const link = markdownLinksInText(reopened, 0, null)[0];
    assert.equal(image.src, destination);
    assert.equal(link.dest, destination);
    assert.equal(
      new MarkdownIt().parseInline(reopened.split("\n")[0], {})[0].children?.filter((token) => token.type === "image")
        .length,
      1,
    );
    const resolved = resolveLinkedWorkspaceItem(link.dest, files);
    assert.equal(resolved?.kind, "file");
    if (resolved?.kind !== "file") assert.fail("expected a file item");
    assert.equal(readFileSync(resolved.file.path, "utf8"), destination);
    const decodedMediaPath = decodeURIComponent(new URL(imageSourceUrl(image.src)).pathname).slice(1);
    assert.equal(readFileSync(join(root, decodedMediaPath), "utf8"), destination);
    assert.equal(
      serializeMarkdownDestination(image.src),
      serialized,
      "repeated serialization of a resolved raw name is stable",
    );
  },
);
