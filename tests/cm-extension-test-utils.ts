import assert from "node:assert/strict";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { DecorationSet, EditorView } from "@codemirror/view";

export type DecorationRange = {
  block: boolean;
  className: string;
  from: number;
  isReplace: boolean;
  style: string;
  text: string;
  to: number;
  widgetName: string | null;
};

export function installCodeMirrorDomPolyfills() {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();

  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (media: string) => ({
        matches: false,
        media,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof globalThis.PointerEvent !== "function") {
    Object.defineProperty(globalThis, "PointerEvent", { configurable: true, value: MouseEvent });
  }

  if (typeof window.ResizeObserver !== "function") {
    class TestResizeObserver implements ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    }
    Object.defineProperty(window, "ResizeObserver", { configurable: true, value: TestResizeObserver });
  }

  for (const [name, value] of [
    ["setPointerCapture", () => {}],
    ["releasePointerCapture", () => {}],
    ["hasPointerCapture", () => false],
  ] as const) {
    if (!(name in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value });
    }
  }
}

export function marked(input: string) {
  const from = input.indexOf("|");
  if (from !== -1) {
    return {
      text: input.slice(0, from) + input.slice(from + 1),
      selection: { from, to: from },
    };
  }

  const selectionFrom = input.indexOf("[");
  const selectionTo = input.indexOf("]");
  assert.notEqual(selectionFrom, -1, "test input must contain a caret or selection marker");
  assert.ok(selectionFrom < selectionTo, "selection markers must be ordered");

  return {
    text: input.slice(0, selectionFrom) + input.slice(selectionFrom + 1, selectionTo) + input.slice(selectionTo + 1),
    selection: { from: selectionFrom, to: selectionTo - 1 },
  };
}

export function markdownState(input: string) {
  const { text, selection } = marked(input);

  return markdownStateFromText(text, selection);
}

export function markdownStateFromText(text: string, selection: { from: number; to: number }) {
  const anchor = selection.from;
  const head = selection.to;

  return EditorState.create({
    doc: text,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })],
  });
}

export function fakeView(state: EditorState) {
  return {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
  } as unknown as EditorView;
}

export function mutableFakeView(initialState: EditorState) {
  let state = initialState;
  const dispatches: unknown[] = [];

  const view = {
    get state() {
      return state;
    },
    dispatch(spec) {
      dispatches.push(spec);
      state = state.update(spec).state;
    },
    focus() {},
  } as unknown as EditorView;

  return { dispatches, view };
}

export function rangesFor(buildDecorations: (view: EditorView) => DecorationSet, input: string) {
  const state = markdownState(input);

  return rangesForState(buildDecorations, state);
}

export function rangesForState(buildDecorations: (view: EditorView) => DecorationSet, state: EditorState) {
  const ranges: DecorationRange[] = [];

  buildDecorations(fakeView(state)).between(0, state.doc.length, (from, to, value) => {
    const className = typeof value.spec.class === "string" ? value.spec.class : "";
    const widget = value.spec.widget;
    ranges.push({
      block: value.spec.block === true,
      className,
      from,
      isReplace: (value as { isReplace?: boolean }).isReplace === true,
      style: typeof value.spec.attributes?.style === "string" ? value.spec.attributes.style : "",
      to,
      text: state.doc.sliceString(from, to),
      widgetName: widget ? widget.constructor.name : null,
    });
  });

  return ranges;
}

export function textsWithClass(ranges: DecorationRange[], className: string) {
  return ranges.filter((range) => range.className.split(/\s+/).includes(className)).map((range) => range.text);
}

export function rangesWithClass(ranges: DecorationRange[], className: string) {
  return ranges.filter((range) => range.className.split(/\s+/).includes(className));
}

export function replacedTexts(ranges: DecorationRange[]) {
  return ranges.filter((range) => range.isReplace && range.from < range.to).map((range) => range.text);
}

export function sortedTexts(texts: string[]) {
  return [...texts].sort();
}
