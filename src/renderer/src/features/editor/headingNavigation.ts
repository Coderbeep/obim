import type { EditorView } from "./codemirror-view";
import { focusEditorLine } from "./editorNavigation";
import { getHeadingTargets, headingSlug } from "@renderer/shared/markdownHeadingTargets";
export function headingLineForFragment(source: string, fragment: string): number | null {
  if (!fragment.startsWith("#")) return null;
  let target: string;
  try {
    target = decodeURIComponent(fragment.slice(1)).toLowerCase();
  } catch {
    return null;
  }
  if (!target) return 1;
  const headings = getHeadingTargets(source);
  // Canonical slugs take precedence so duplicate headings remain addressable.
  const canonical = headings.find((heading) => decodeURIComponent(heading.fragment.slice(1)) === target);
  if (canonical) return canonical.line;
  const readable = headings.find(
    (heading) => heading.text.toLowerCase() === target || headingSlug(heading.text) === headingSlug(target),
  );
  if (readable) return readable.line;
  return null;
}

export function navigateToHeading(view: EditorView, fragment: string): boolean {
  const line = headingLineForFragment(view.state.doc.toString(), fragment);
  if (line === null) return false;
  focusEditorLine(view, line);
  return true;
}
