import { parser } from "@lezer/markdown";

const stem = (value: string) =>
  value
    .split("/")
    .at(-1)!
    .replace(/\.(?:md|markdown)$/i, "");
const normalize = (value: string) => {
  const segments: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!segments.length) return null;
      segments.pop();
    } else segments.push(part);
  }
  return segments.join("/");
};
const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
const directory = (value: string) => value.slice(0, Math.max(0, value.lastIndexOf("/")));
const relative = (source: string, target: string) => {
  const from = directory(source).split("/").filter(Boolean);
  const to = target.split("/");
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].join("/");
};

export interface NoteLinkMove {
  beforePaths: string[];
  afterPaths: string[];
  sourceBefore: string;
  sourceAfter: string;
}

/** Updates only destinations that resolve to a known note; code and ambiguous wiki targets stay literal. */
export const rewriteNoteLinks = (content: string, move: NoteLinkMove): string => {
  const remap = new Map(move.beforePaths.map((value, index) => [value, move.afterPaths[index]]));
  const edits: { from: number; to: number; text: string }[] = [];
  const blocked: { from: number; to: number }[] = [];
  const urls: { from: number; to: number }[] = [];
  parser.parse(content).iterate({
    enter(node) {
      if (
        ["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "HTMLTag", "Comment", "CommentBlock"].includes(node.name)
      ) {
        blocked.push({ from: node.from, to: node.to });
        return false;
      }
      if (node.name === "URL") urls.push({ from: node.from, to: node.to });
      return undefined;
    },
  });
  const frontmatter = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
  if (frontmatter) blocked.push({ from: 0, to: frontmatter[0].length });
  const isBlocked = (from: number, to: number) => blocked.some((range) => from < range.to && to > range.from);
  const splitFragment = (target: string) => {
    const index = target.indexOf("#");
    return index < 0 ? [target, ""] : [target.slice(0, index), target.slice(index)];
  };

  for (const match of content.matchAll(/(?<!!)\[\[([^\]\r\n]+)\]\]/g)) {
    const start = match.index;
    if (isBlocked(start, start + match[0].length) || (start > 0 && content[start - 1] === "\\")) continue;
    const raw = match[1].split("|")[0];
    const [target, fragment] = splitFragment(raw.trim());
    if (!target) continue;
    let resolved: string | undefined;
    for (const value of [target, decode(target)]) {
      const withoutExtension = value.replace(/\.(?:md|markdown)$/i, "");
      const matches = withoutExtension.includes("/")
        ? move.beforePaths.filter((p) => p.replace(/\.(?:md|markdown)$/i, "") === normalize(withoutExtension))
        : move.beforePaths.filter((p) => stem(p).toLowerCase() === withoutExtension.toLowerCase());
      if (matches.length === 1) {
        resolved = matches[0];
        break;
      }
      if (matches.length > 1) break;
    }
    if (!resolved) continue;
    const next = remap.get(resolved)!;
    const unique = move.afterPaths.filter((p) => stem(p).toLowerCase() === stem(next).toLowerCase()).length === 1;
    if (next === resolved && (target.includes("/") || unique)) continue;
    const destination = target.includes("/") || !unique ? next.replace(/\.(?:md|markdown)$/i, "") : stem(next);
    const extension = /\.(md|markdown)$/i.exec(target)?.[0] ?? "";
    const whitespace = raw.match(/^(\s*)[\s\S]*?(\s*)$/)!;
    edits.push({
      from: start + 2,
      to: start + 2 + raw.length,
      text: `${whitespace[1]}${destination}${extension}${fragment}${whitespace[2]}`,
    });
  }

  for (const url of urls) {
    if (isBlocked(url.from, url.to)) continue;
    const raw = content.slice(url.from, url.to);
    const angled = raw.startsWith("<") && raw.endsWith(">");
    const [target, fragment] = splitFragment(angled ? raw.slice(1, -1) : raw);
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) continue;
    const rooted = target.startsWith("/");
    const noteRelative = target.startsWith("./") || target.startsWith("../");
    const candidates = [target, decode(target)].flatMap((value) => {
      const root = normalize(value);
      const local = normalize(`${directory(move.sourceBefore)}/${value}`);
      return rooted ? [root] : noteRelative ? [local] : [root, local];
    });
    const resolved = candidates.find((p): p is string => p !== null && remap.has(p));
    if (!resolved) continue;
    const next = remap.get(resolved)!;
    if (next === resolved && move.sourceBefore === move.sourceAfter) continue;
    let destination = rooted
      ? `/${next}`
      : noteRelative || resolved !== normalize(target)
        ? relative(move.sourceAfter, next)
        : next;
    if (target.startsWith("./") && !destination.startsWith(".")) destination = `./${destination}`;
    if (!angled)
      destination = destination
        .split("/")
        .map((part) =>
          encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`),
        )
        .join("/");
    edits.push({ ...url, text: angled ? `<${destination}${fragment}>` : `${destination}${fragment}` });
  }
  return edits
    .sort((a, b) => b.from - a.from)
    .reduce((text, edit) => text.slice(0, edit.from) + edit.text + text.slice(edit.to), content);
};
