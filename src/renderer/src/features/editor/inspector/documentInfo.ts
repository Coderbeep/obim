import { obimMarkdownParser } from "../language";
import { locateFrontmatter } from "@shared/frontmatter";

export interface MarkdownHeading {
  level: number;
  text: string;
  line: number;
}

export interface MarkdownTask {
  checked: boolean;
  depth: number;
  parentLine?: number;
  marker?: { from: number; to: number };
  text: string;
  line: number;
}

export interface MarkdownLink {
  kind: "image" | "note" | "external" | "internal";
  destination: string;
  text: string;
  line: number;
}

export interface MarkdownStats {
  words: number;
  characters: number;
  lines: number;
  readingMinutes: number;
  links: number;
  images: number;
  tasks: number;
  completedTasks: number;
  codeBlocks: number;
}

export interface MarkdownSidebarInfo {
  headings: MarkdownHeading[];
  links: MarkdownLink[];
  stats: MarkdownStats;
  tasks: MarkdownTask[];
}

const splitLines = (text: string) => (text.length ? text.split(/\r\n|\r|\n/) : []);

const cleanHeadingText = (text: string) =>
  text
    .trim()
    .replace(/[ \t]+#+[ \t]*$/, "")
    .trim();

const headingText = (source: string, setext: boolean) => {
  const content = setext
    ? source.replace(/(?:\r\n|\r|\n)\s{0,3}(?:=+|-+)\s*$/, "")
    : source.replace(/^\s{0,3}#{1,6}[ \t]+/, "");

  return cleanHeadingText(content.replace(/\r\n|\r|\n/g, " "));
};

const getMarkdownStructure = (text: string) => {
  const headings: MarkdownHeading[] = [];
  const links: MarkdownLink[] = [];
  const tasks: MarkdownTask[] = [];
  const tasksByListItem = new Map<number, MarkdownTask>();
  const lines = splitLines(text);
  const lineStarts = [0];

  for (const newline of text.matchAll(/\r\n|\r|\n/g)) {
    lineStarts.push((newline.index ?? 0) + newline[0].length);
  }

  let lineIndex = 0;
  obimMarkdownParser.parse(text).iterate({
    enter(node) {
      while (lineStarts[lineIndex + 1] <= node.from) lineIndex += 1;
      const heading = /^(ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading) {
        headings.push({
          level: Number(heading[2]),
          text: headingText(text.slice(node.from, node.to), heading[1] === "Setext"),
          line: lineIndex + 1,
        });
        return;
      }

      if (node.name === "TaskMarker") {
        let depth = -1;
        let ownListItemFrom: number | undefined;
        let parentTask: MarkdownTask | undefined;
        for (let parent = node.node.parent; parent; parent = parent.parent) {
          if (parent.name !== "ListItem") continue;
          depth += 1;
          if (ownListItemFrom === undefined) ownListItemFrom = parent.from;
          else parentTask ??= tasksByListItem.get(parent.from);
        }
        const task: MarkdownTask = {
          depth: Math.max(0, depth),
          checked: /[xX]/.test(text.slice(node.from, node.to)),
          text: text.slice(node.to, lineStarts[lineIndex] + (lines[lineIndex]?.length ?? 0)).trim(),
          line: lineIndex + 1,
          marker: { from: node.from, to: node.to },
          ...(parentTask ? { parentLine: parentTask.line } : {}),
        };
        tasks.push(task);
        if (ownListItemFrom !== undefined) tasksByListItem.set(ownListItemFrom, task);
        return;
      }

      if (node.name === "Link" || node.name === "Image" || node.name === "Autolink") {
        const source = text.slice(node.from, node.to);
        const url = node.node.getChild("URL");
        const destination = url ? text.slice(url.from, url.to).replace(/^<|>$/g, "") : null;
        if (!destination) return;
        const external = /^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith("//");
        const kind =
          node.name === "Image"
            ? "image"
            : external
              ? "external"
              : /\.(?:md|markdown)(?:[#?]|$)/i.test(destination)
                ? "note"
                : "internal";
        links.push({
          text: /^!?\[([^\]]*)\]/.exec(source)?.[1] ?? destination,
          destination,
          line: lineIndex + 1,
          kind,
        });
      }
    },
  });

  return { headings, links, tasks };
};

const readableMarkdown = (text: string) => {
  const readableLines: string[] = [];
  const lines = splitLines(text);
  const envelope = locateFrontmatter(text);
  const readableSource = envelope ? text.slice(envelope.range.to) : text;
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let codeBlocks = 0;

  splitLines(readableSource).forEach((line) => {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      const markerChar = marker[0];
      const closesFence = inFence && markerChar === fenceChar && marker.length >= fenceLength;

      if (!inFence || closesFence) {
        inFence = !inFence;
        fenceChar = inFence ? markerChar : "";
        fenceLength = inFence ? marker.length : 0;
        if (inFence) codeBlocks += 1;
        return;
      }
    }

    if (inFence) return;

    readableLines.push(line);
  });

  return { ...getMarkdownStructure(text), readableText: readableLines.join("\n"), lines, codeBlocks };
};

const countWords = (text: string) => {
  const plainText = text
    .replace(/!?\[([^\]\n]*)\]\([^)]+\)/g, " $1 ")
    .replace(/`([^`]+)`/g, " $1 ")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/[*_~>#|[\]()-]/g, " ");

  return plainText.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu)?.length ?? 0;
};

export const getMarkdownSidebarInfo = (text: string): MarkdownSidebarInfo => {
  const { headings, links, tasks, readableText, lines, codeBlocks } = readableMarkdown(text);
  const markdownLinks = Array.from(readableText.matchAll(/!?\[[^\]\n]*\]\([^)]+\)/g));
  const images = markdownLinks.filter((match) => match[0].startsWith("!")).length;
  const taskMatches = Array.from(readableText.matchAll(/^\s*[-*+]\s+\[([ xX])\]\s+/gm));
  const completedTasks = taskMatches.filter((match) => match[1].toLowerCase() === "x").length;
  const words = countWords(readableText);

  return {
    headings,
    links,
    tasks,
    stats: {
      words,
      characters: text.length,
      lines: lines.length,
      readingMinutes: words ? Math.max(1, Math.ceil(words / 200)) : 0,
      links: markdownLinks.length - images,
      images,
      tasks: taskMatches.length,
      completedTasks,
      codeBlocks,
    },
  };
};
