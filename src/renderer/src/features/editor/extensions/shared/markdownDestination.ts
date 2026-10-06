/**
 * Serialize a raw filesystem destination (or a selected link with a fragment).
 * Keep percent signs literal: path lookup supports legacy encoded links, while
 * media transport encodes the actual filename once. Replacing a completion
 * always starts from its raw file-tree path, never the previous Markdown text.
 */
export function serializeMarkdownDestination(destination: string, insideAngleBrackets = false) {
  const escaped = destination.replace(/[\\<>[\]&]/g, "\\$&");
  return !insideAngleBrackets && /[\s()<>]/u.test(destination) ? `<${escaped}>` : escaped;
}
