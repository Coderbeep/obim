import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { SettingsSpecimens } from "@renderer/design-graph/SettingsSpecimens";

afterEach(cleanup);

it("shows appearance and fields together on the board", () => {
  render(<SettingsSpecimens />);
  expect(screen.getByRole("textbox", { name: "Repository URL" })).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Window controls" })).toBeTruthy();
  expect(screen.queryByRole("tab", { name: "Appearance" })).toBeNull();
});

it("keeps preference choices mutually exclusive", async () => {
  const user = userEvent.setup();
  render(<SettingsSpecimens />);
  const system = screen.getByRole("radio", { name: "System" });
  await user.click(system);
  await user.click(screen.getByRole("radio", { name: "Dark" }));
  expect((screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked).toBe(true);
  expect((system as HTMLInputElement).checked).toBe(false);
});
