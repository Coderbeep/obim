import { describe, expect, it } from "vitest";

import { resolveTabShortcut, type TabShortcutInput } from "../src/shared/tab-shortcuts";

const input = (overrides: Partial<TabShortcutInput>): TabShortcutInput => ({
  alt: false,
  control: false,
  isAutoRepeat: false,
  key: "",
  meta: false,
  shift: false,
  ...overrides,
});

describe("tab shortcuts", () => {
  it.each([
    [{ control: true, key: "t", shift: true }, "reopen-last-closed-tab"],
    [{ key: "T", meta: true, shift: true }, "reopen-last-closed-tab"],
    [{ control: true, key: "w" }, "close-current-tab"],
    [{ key: "W", meta: true }, "close-current-tab"],
  ] as const)("resolves %o", (overrides, expected) => {
    expect(resolveTabShortcut(input(overrides))).toBe(expected);
  });

  it.each([
    { control: true, key: "t" },
    { control: true, key: "t", shift: true, alt: true },
    { control: true, key: "t", shift: true, isAutoRepeat: true },
    { key: "t", shift: true },
    { control: true, key: "w", shift: true },
  ])("ignores unsupported input %o", (overrides) => {
    expect(resolveTabShortcut(input(overrides))).toBeNull();
  });
});
