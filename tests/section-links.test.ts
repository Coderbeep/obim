import { expect, it } from "vitest";
import { canLinkToSections } from "../src/shared/section-links";
it.each(["#", "%", "[", "]", "^", "|", "?", ":"])(
  "disables section targets for filenames containing %s",
  (character) => {
    expect(canLinkToSections(`/notes/Note${character}1.md`)).toBe(false);
  },
);
it("allows ordinary spaces, Unicode, dashes and parentheses", () => {
  expect(canLinkToSections("/notes/Café - draft (1).md")).toBe(true);
});
