import type { Range } from "@renderer/features/editor/codemirror-state";
import { Decoration, type DecorationSet, type EditorView } from "@renderer/features/editor/codemirror-view";

import {
  createSyntaxDecorationPlugin,
  decorationSet,
  directChildren,
  isSyntaxRangeActive,
  iterateVisibleSyntaxTree,
  pushDecorationRange,
} from "./syntaxDecorationPlugin";

export interface HideRevealRule {
  node: string;
  markers: string | readonly string[];
  content: Decoration;
  revealedMarker: Decoration;
  hiddenMarker: Decoration;
}

type CompiledHideRevealRule = Omit<HideRevealRule, "markers"> & { markers: readonly string[] };

function compileHideRevealRules(rules: readonly HideRevealRule[]) {
  const rulesByNode = new Map<string, CompiledHideRevealRule[]>();
  for (const rule of rules) {
    const compiled = {
      ...rule,
      markers: typeof rule.markers === "string" ? [rule.markers] : rule.markers,
    };
    const registered = rulesByNode.get(rule.node);
    if (registered) registered.push(compiled);
    else rulesByNode.set(rule.node, [compiled]);
  }
  return rulesByNode;
}

/**
 * Describes syntax-node marker rendering without giving each extension its own
 * viewport traversal and reveal bookkeeping. Rules are indexed by node name,
 * and every registered rule is evaluated in one visible-tree pass.
 */
export function buildHideRevealDecorations(view: EditorView, rules: readonly HideRevealRule[]): DecorationSet {
  return buildFromRegistry(view, compileHideRevealRules(rules));
}

function buildFromRegistry(view: EditorView, rulesByNode: ReadonlyMap<string, readonly CompiledHideRevealRule[]>) {
  const decorations: Range<Decoration>[] = [];
  iterateVisibleSyntaxTree(view, (node) => {
    const registered = rulesByNode.get(node.name);
    if (!registered) return;

    for (const rule of registered) {
      const marks = rule.markers.flatMap((name) => directChildren(node, name));
      marks.sort((left, right) => left.from - right.from || left.to - right.to);

      const nodeActive = isSyntaxRangeActive(view.state, node.from, node.to);
      let from = node.from;
      for (const mark of marks) {
        pushDecorationRange(decorations, rule.content, from, mark.from);
        pushDecorationRange(
          decorations,
          nodeActive || isSyntaxRangeActive(view.state, mark.from, mark.to) ? rule.revealedMarker : rule.hiddenMarker,
          mark.from,
          mark.to,
        );
        from = mark.to;
      }
      pushDecorationRange(decorations, rule.content, from, node.to);
    }
  });

  return decorationSet(decorations);
}

export function createHideRevealRegistry(rules: readonly HideRevealRule[]) {
  const registry = compileHideRevealRules(rules);
  return createSyntaxDecorationPlugin((view) => buildFromRegistry(view, registry));
}
