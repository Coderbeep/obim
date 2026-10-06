import { describe, expect, it } from "vitest";
import { rewriteNoteLinks, type NoteLinkMove } from "../src/shared/note-link-updates";

const move: NoteLinkMove = {
  beforePaths: ["Old/Principles of Diffusion Models.md", "Notes/source.md", "Other.md"],
  afterPaths: ["New/Diffusion.md", "Notes/source.md", "Other.md"],
  sourceBefore: "Notes/source.md",
  sourceAfter: "Notes/source.md",
};
describe("automatic note link updates", () => {
  it("renames short and qualified wiki destinations while retaining aliases, headings, and extensions", () => {
    expect(
      rewriteNoteLinks(
        "[[Principles of Diffusion Models]] [[Old/Principles of Diffusion Models#Training|My label]] [[Principles of Diffusion Models.md]]",
        move,
      ),
    ).toBe("[[Diffusion]] [[New/Diffusion#Training|My label]] [[Diffusion.md]]");
  });
  it("keeps unique short links unchanged after a folder move", () => {
    expect(
      rewriteNoteLinks("[[Principles of Diffusion Models]]", {
        ...move,
        afterPaths: ["New/Principles of Diffusion Models.md", "Notes/source.md", "Other.md"],
      }),
    ).toBe("[[Principles of Diffusion Models]]");
  });
  it("qualifies short links when a rename introduces a duplicate name", () => {
    const duplicated = { ...move, afterPaths: ["New/Other.md", "Notes/source.md", "Other.md"] };
    expect(rewriteNoteLinks("[[Principles of Diffusion Models]] [[Other]]", duplicated)).toBe(
      "[[New/Other]] [[Other]]",
    );
  });
  it("does not guess the target of already ambiguous short links", () => {
    expect(
      rewriteNoteLinks("[[Same]] [[A/Same]]", {
        beforePaths: ["A/Same.md", "B/Same.md"],
        afterPaths: ["A/New.md", "B/Same.md"],
        sourceBefore: "source.md",
        sourceAfter: "source.md",
      }),
    ).toBe("[[Same]] [[A/New]]");
  });
  it("preserves code, frontmatter, comments, escaped links, and unresolved links", () => {
    const text =
      "---\nexample: '[[Principles of Diffusion Models]]'\n---\n`[[Principles of Diffusion Models]]`\n\n```md\n[[Principles of Diffusion Models]]\n```\n\n    [[Principles of Diffusion Models]]\n\n<!-- [[Principles of Diffusion Models]] -->\n\\[[Principles of Diffusion Models]] [[Missing]]";
    expect(rewriteNoteLinks(text, move)).toBe(text);
  });
  it("rewrites Markdown destinations and reference definitions without changing labels or titles", () => {
    const text =
      '[Read](../Old/Principles%20of%20Diffusion%20Models.md#Training "Title")\n[Root](/Old/Principles%20of%20Diffusion%20Models.md)\n[Angle](<../Old/Principles of Diffusion Models.md>)\n\n[ref]: ../Old/Principles%20of%20Diffusion%20Models.md\n[Web](https://example.com/Other.md)';
    expect(rewriteNoteLinks(text, move)).toBe(
      '[Read](../New/Diffusion.md#Training "Title")\n[Root](/New/Diffusion.md)\n[Angle](<../New/Diffusion.md>)\n\n[ref]: ../New/Diffusion.md\n[Web](https://example.com/Other.md)',
    );
  });
  it("repairs outgoing relative note links when the source note moves", () => {
    expect(
      rewriteNoteLinks("[Other](../Other.md) [[Other]]", {
        ...move,
        sourceBefore: "Notes/source.md",
        sourceAfter: "Archive/Deep/source.md",
      }),
    ).toBe("[Other](../../Other.md) [[Other]]");
  });
});
