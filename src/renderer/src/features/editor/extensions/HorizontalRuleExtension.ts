import { Decoration, EditorView, WidgetType } from "@renderer/features/editor/codemirror-view";
import type { Range } from "@renderer/features/editor/codemirror-state";
import {
  createSyntaxDecorationPlugin,
  decorationSet,
  isSyntaxRangeActive,
  iterateVisibleSyntaxTree,
  selectSyntaxRange,
} from "./shared/syntaxDecorationPlugin";

class HorizontalRuleWidget extends WidgetType {
  constructor(private readonly caretTo: number) {
    super();
  }

  toDOM(view: EditorView) {
    const container = document.createElement("span");
    container.className = "cm-horizontal-rule-widget-container";
    container.onclick = (event) => {
      event.preventDefault();
      selectSyntaxRange(view, this.caretTo);
    };

    const hr = document.createElement("hr");
    hr.className = "cm-horizontal-rule-widget";

    container.appendChild(hr);
    if (!view.state.facet(EditorView.editable)) container.classList.add("cm-widget-readonly");

    return container;
  }

  eq(other: HorizontalRuleWidget) {
    return other.caretTo === this.caretTo;
  }
}

function ruleEnd(view: EditorView, from: number, to: number) {
  while (to > from && /\s/.test(view.state.doc.sliceString(to - 1, to))) to--;
  return to;
}

export function buildHorizontalRuleDecorations(view: EditorView) {
  const decorations: Range<Decoration>[] = [];
  const frontmatterMarkStarts = new Set<number>();
  const horizontalRules: Array<{ from: number; to: number }> = [];

  iterateVisibleSyntaxTree(view, (node) => {
    if (node.name === "FrontmatterMark") {
      frontmatterMarkStarts.add(node.from);
    } else if (node.name === "HorizontalRule") {
      horizontalRules.push({ from: node.from, to: node.to });
    }
  });

  for (const rule of horizontalRules) {
    if (frontmatterMarkStarts.has(rule.from)) continue;

    const line = view.state.doc.lineAt(rule.from);
    if (isSyntaxRangeActive(view.state, line.from, line.to)) continue;

    decorations.push(
      Decoration.replace({
        widget: new HorizontalRuleWidget(ruleEnd(view, rule.from, rule.to)),
      }).range(line.from, line.to),
    );
  }

  return decorationSet(decorations);
}

export const HorizontalRuleExtension = createSyntaxDecorationPlugin(buildHorizontalRuleDecorations);
