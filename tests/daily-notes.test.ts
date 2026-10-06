import { describe, expect, it } from "vitest";

import {
  dailyNoteDateFromPath,
  dailyNoteFilename,
  dailyNoteInitialContent,
  dailyNoteRelativePath,
} from "../src/renderer/src/features/daily-notes/dailyNotes";

describe("daily notes", () => {
  it("uses stable local calendar dates for filenames and initial headings", () => {
    const date = new Date(2026, 8, 16);

    expect(dailyNoteFilename(date)).toBe("2026-09-16.md");
    expect(dailyNoteRelativePath(date, "Journal/Daily")).toBe("Journal/Daily/2026-09-16.md");
    expect(dailyNoteInitialContent(date)).toBe("# Wednesday, September 16, 2026\n\n");
  });

  it("recognizes only direct, valid date notes in the configured directory", () => {
    expect(dailyNoteDateFromPath("Journal/Daily/2024-02-29.md", "Journal/Daily")).toEqual(new Date(2024, 1, 29));
    expect(dailyNoteDateFromPath("Journal/Daily/archive/2024-02-29.md", "Journal/Daily")).toBeNull();
    expect(dailyNoteDateFromPath("Journal/Daily/2023-02-29.md", "Journal/Daily")).toBeNull();
    expect(dailyNoteDateFromPath("Journal/2024-02-29.md", "Journal/Daily")).toBeNull();
  });
});
