import { StateEffect, StateField } from "@renderer/features/editor/codemirror-state";
import { ViewPlugin } from "@renderer/features/editor/codemirror-view";
import type { EditorView, ViewUpdate } from "@renderer/features/editor/codemirror-view";
import { rangeContains, type DocumentRange } from "./documentRange";

interface BufferedViewportOptions {
  minBuffer: number;
  maxBuffer: number;
  multiplier: number;
}

export function expandViewport(
  viewport: DocumentRange,
  docLength: number,
  { minBuffer, maxBuffer, multiplier }: BufferedViewportOptions,
): DocumentRange {
  const viewportSize = Math.max(0, viewport.to - viewport.from);
  const buffer = Math.max(minBuffer, Math.min(maxBuffer, Math.floor(viewportSize * multiplier)));

  return {
    from: Math.max(0, viewport.from - buffer),
    to: Math.min(docLength, viewport.to + buffer),
  };
}

export function createBufferedViewport(options: BufferedViewportOptions) {
  const setViewport = StateEffect.define<DocumentRange>();
  const field = StateField.define<DocumentRange>({
    create: () => ({ from: 0, to: 0 }),
    update(value, transaction) {
      if (transaction.docChanged) {
        value = {
          from: transaction.changes.mapPos(value.from, -1),
          to: transaction.changes.mapPos(value.to, 1),
        };
      }

      for (const effect of transaction.effects) {
        if (effect.is(setViewport)) value = effect.value;
      }

      const docLength = transaction.state.doc.length;
      return {
        from: Math.min(value.from, docLength),
        to: Math.min(value.to, docLength),
      };
    },
  });

  const plugin = ViewPlugin.fromClass(
    class {
      private scheduled = false;
      private destroyed = false;
      private pending: DocumentRange | null = null;

      constructor(private readonly view: EditorView) {
        this.queue(view.viewport);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.queue(update.view.viewport);
          return;
        }

        if (update.viewportChanged && !rangeContains(update.state.field(field), update.view.viewport)) {
          this.queue(update.view.viewport);
        }
      }

      destroy() {
        this.destroyed = true;
      }

      private queue(viewport: DocumentRange) {
        this.pending = expandViewport(viewport, this.view.state.doc.length, options);
        if (this.scheduled) return;
        this.scheduled = true;

        requestAnimationFrame(() => {
          this.scheduled = false;
          if (this.destroyed || !this.pending) return;

          const next = this.pending;
          this.pending = null;
          const current = this.view.state.field(field);
          if (current.from === next.from && current.to === next.to) return;
          this.view.dispatch({ effects: setViewport.of(next) });
        });
      }
    },
  );

  return {
    effect: setViewport,
    extension: [field, plugin],
    field,
  };
}
