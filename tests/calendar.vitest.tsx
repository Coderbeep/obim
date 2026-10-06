// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Calendar } from "../src/renderer/src/shared/ui/calendar";

afterEach(cleanup);

test("shared calendars start the week on Monday", () => {
  render(<Calendar defaultMonth={new Date(2026, 7, 1)} />);

  expect([...document.querySelectorAll(".rdp-weekday")].map((header) => header.getAttribute("aria-label"))).toEqual([
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]);
});
