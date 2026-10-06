import assert from "node:assert/strict";
import { test } from "vitest";

import { getSearchMatchRanges } from "../src/renderer/src/features/search/searchHighlight";

test("search highlighting only keeps complete fuzzy token matches", () => {
  assert.deepEqual(getSearchMatchRanges("Workspace root", "principles"), []);
  assert.deepEqual(getSearchMatchRanges("Principles of Diffusion Models", "pdm"), [
    { from: 0, to: 1 },
    { from: 14, to: 15 },
    { from: 24, to: 25 },
  ]);
});
