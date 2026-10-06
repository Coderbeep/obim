import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: false });

export interface MarkdownPdfReferenceLink {
  targetBasename: string;
  destination: string;
  label: string;
  line: number;
}

export const pdfReferenceTargetBasename = (destination: string): string | null => {
  const hash = destination.lastIndexOf("#");
  if (hash < 0 || !/^page=\d+(?:&|$)/.test(destination.slice(hash + 1))) return null;
  let path = destination.slice(0, hash);
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Keep literal percent signs. */
  }
  const basename = path.replace(/\\/g, "/").split("/").at(-1) ?? "";
  return /\.pdf$/i.test(basename) ? basename.toLocaleLowerCase() : null;
};

/** Extracts ordinary Markdown PDF links; fenced code and image syntax are ignored. */
export const markdownPdfReferenceLinks = (source: string): MarkdownPdfReferenceLink[] => {
  const links: MarkdownPdfReferenceLink[] = [];
  for (const token of markdown.parse(source, {})) {
    if (token.type !== "inline" || !token.children) continue;
    const line = (token.map?.[0] ?? 0) + 1;
    for (let index = 0; index < token.children.length; index += 1) {
      const child = token.children[index];
      if (child.type !== "link_open") continue;
      const destination = child.attrGet("href") ?? "";
      const targetBasename = pdfReferenceTargetBasename(destination);
      if (!targetBasename) continue;
      const label: string[] = [];
      for (let next = index + 1; next < token.children.length && token.children[next].type !== "link_close"; next += 1)
        if (token.children[next].type === "text" || token.children[next].type === "code_inline")
          label.push(token.children[next].content);
      links.push({ targetBasename, destination, label: label.join("").trim(), line });
    }
  }
  return links;
};
