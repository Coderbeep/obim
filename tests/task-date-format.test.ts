import { expect, it } from "vitest";
import {
  assistDateInput,
  dateInputToStorage,
  formatDueDate,
  formatDueDateRange,
  parseDueDate,
} from "../src/renderer/src/shared/date";

it("formats stored dates and ranges day first", () => {
  expect(formatDueDate("2026-09-07")).toBe("07-09-2026");
  expect(formatDueDateRange("2026-09-07", "2026-10-14")).toBe("07-09-2026 – 14-10-2026");
  expect(formatDueDate()).toBe("");
});
it("converts valid input without silently correcting impossible dates", () => {
  expect(dateInputToStorage("29-02-2024")).toBe("2024-02-29");
  expect(dateInputToStorage("29-02-2026")).toBe("29-02-2026");
  expect(parseDueDate(dateInputToStorage("29-02-2026"))).toBeUndefined();
  expect(dateInputToStorage("14-10-")).toBe("14-10-");
  expect(dateInputToStorage("")).toBe("");
});

it("inserts separators for digit-only typing and preserves deletion", () => {
  expect(assistDateInput("14")).toEqual({ value: "14-", caret: 3 });
  expect(assistDateInput("1409")).toEqual({ value: "14-09-", caret: 6 });
  expect(assistDateInput("14092026")).toEqual({ value: "14-09-2026", caret: 10 });
  expect(assistDateInput("14--09-2026", 4)).toEqual({ value: "14-09-2026", caret: 3 });
  expect(assistDateInput("14-09", 5, true)).toEqual({ value: "14-09", caret: 5 });
  expect(assistDateInput("14-10-2026", 5)).toEqual({ value: "14-10-2026", caret: 6 });
});
