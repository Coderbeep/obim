import { test } from "vitest";

import assert from "node:assert/strict";

import { basename, isValidFilename, toMediaUrl } from "../../src/shared/pathUtils";

test("media URLs encode reserved filename characters without changing directories", () => {
  assert.equal(toMediaUrl("attachments/report ?#.png"), "media:///attachments/report%20%3F%23.png");
  assert.equal(toMediaUrl("Zażółć/🚀.png"), `media:///${encodeURIComponent("Zażółć")}/${encodeURIComponent("🚀.png")}`);
});

test("portable filenames preserve Unicode and reject control characters", () => {
  assert.equal(isValidFilename("Résumé 🚀.md"), true);
  assert.equal(isValidFilename("line\nbreak.md"), false);
  assert.equal(basename("C:\\notes\\Résumé 🚀.md"), "Résumé 🚀.md");
});
