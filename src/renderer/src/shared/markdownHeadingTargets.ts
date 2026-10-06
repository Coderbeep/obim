import { parser } from "@lezer/markdown";
import { locateFrontmatter } from "@shared/frontmatter";

export interface MarkdownHeadingTarget {
  text: string;
  level: number;
  line: number;
  fragment: string;
}

export const headingSlug = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
    .replace(/\s/g, "-");

/** Canonical Markdown anchors, shared by link suggestions and navigation. */
export function getHeadingTargets(source: string): MarkdownHeadingTarget[] {
  const frontmatterEnd = locateFrontmatter(source)?.range.to ?? 0;
  const headings: MarkdownHeadingTarget[] = [];
  const used = new Set<string>();
  const starts = [0];
  for (const match of source.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);
  let line = 0;
  parser.parse(source).iterate({
    enter(node) {
      if (node.from < frontmatterEnd) return;
      const match = /^(ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (!match) return;
      while (starts[line + 1] <= node.from) line += 1;
      const raw = source.slice(node.from, node.to);
      const text = (
        match[1] === "Setext"
          ? raw.replace(/(?:\r\n|\r|\n)\s{0,3}(?:=+|-+)\s*$/, "")
          : raw.replace(/^\s{0,3}#{1,6}[ \t]+/, "")
      )
        .replace(/\r\n|\r|\n/g, " ")
        .trim()
        .replace(/[ \t]+#+[ \t]*$/, "")
        .trim();
      const base = headingSlug(text) || "section";
      let slug = base;
      let suffix = 0;
      while (used.has(slug)) slug = `${base}-${++suffix}`;
      used.add(slug);
      headings.push({ text, level: Number(match[2]), line: line + 1, fragment: `#${encodeURIComponent(slug)}` });
    },
  });
  return headings;
}
