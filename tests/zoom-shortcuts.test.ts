import { describe, expect, it } from "vitest";

import { resolveZoomShortcut } from "../src/shared/zoom-shortcuts";

describe("zoom shortcuts", () => {
  it.each([
    ["+", "in"],
    ["=", "in"],
    ["-", "out"],
    ["0", "reset"],
  ] as const)("maps Ctrl+%s to %s", (key, expected) => {
    expect(resolveZoomShortcut({ control: true, meta: false, key })).toBe(expected);
    expect(resolveZoomShortcut({ control: false, meta: true, key })).toBe(expected);
  });

  it("ignores zoom keys without the primary modifier", () => {
    expect(resolveZoomShortcut({ control: false, meta: false, key: "+" })).toBeNull();
  });
});
