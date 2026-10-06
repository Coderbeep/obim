import { describe, expect, it } from "vitest";
import { nextLocalMidnight } from "../src/renderer/src/shared/useLocalDay";

describe("local calendar boundaries", () => {
  it.each([
    [2026, 2, 29],
    [2026, 9, 25],
  ])("uses the next calendar day across daylight saving (%s/%s/%s)", (year, month, day) => {
    const start = new Date(year, month, day);
    const next = nextLocalMidnight(start);
    expect(next.getDate()).toBe(day + 1);
    expect(next.getHours()).toBe(0);
    const offsetChange = next.getTimezoneOffset() - start.getTimezoneOffset();
    expect(next.getTime() - start.getTime()).toBe(86_400_000 + offsetChange * 60_000);
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/Warsaw") expect(offsetChange).not.toBe(0);
  });
});
