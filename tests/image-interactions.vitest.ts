import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import {
  buildImageDecorations,
  createImageExtension,
} from "../src/renderer/src/features/editor/extensions/ImageExtension";
import { obimMarkdown } from "../src/renderer/src/features/editor/language";

describe("image preview interactions", () => {
  function fixture(
    doc = "\n![Map](map.png)",
    resolveSource: (src: string, syntax: "markdown" | "wiki") => string | null = (src) => src,
  ) {
    const open = vi.fn();
    const contextMenu = vi.fn();
    const image = createImageExtension({
      owner: "test",
      overlay: { open() {}, close() {}, hotkey() {} },
      actions: { resolveSource, open, contextMenu },
    });
    let state = EditorState.create({ doc, extensions: [obimMarkdown([]), image.extension] });
    const view = {
      get state() {
        return state;
      },
      dom: { isConnected: false },
      focus() {},
      dispatch(spec) {
        state = state.update(spec).state;
      },
    } as unknown as EditorView;
    let node: HTMLElement | undefined;
    buildImageDecorations(state).between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget) node = decoration.spec.widget.toDOM(view);
    });
    expect(node).toBeDefined();
    return { node: node!, open, contextMenu, view };
  }
  it("opens the viewer without exposing source on primary click", () => {
    const { node, open, view } = fixture();
    node.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }));
    node.click();
    expect(open).toHaveBeenCalledWith("map.png");
    expect(view.state.selection.main.from).toBe(0);
  });
  it("opens the image menu on right click without opening the viewer", () => {
    const { node, open, contextMenu } = fixture();
    node.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true }));
    expect(contextMenu).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      "map.png",
      expect.any(Function),
      expect.any(Function),
    );
    expect(open).not.toHaveBeenCalled();
  });
  it("source button selects image syntax without opening the viewer", () => {
    const { node, open, view } = fixture();
    node.querySelector<HTMLButtonElement>(".cm-image-source")!.click();
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("![Map](map.png)");
    expect(open).not.toHaveBeenCalled();
  });
  it("remove menu action deletes the embed, retaining surrounding note content", () => {
    const { node, contextMenu, view } = fixture();
    node.dispatchEvent(new MouseEvent("contextmenu", { button: 2 }));
    contextMenu.mock.calls[0][3]();
    expect(view.state.doc.toString()).toBe("\n");
  });
  it("routes wiki image interactions through the resolved workspace path", () => {
    const { node, open, view } = fixture("\n![[Pasted image.png]]", (_src, syntax) =>
      syntax === "wiki" ? "Third Semester/Pasted image.png" : null,
    );

    node.click();
    expect(open).toHaveBeenCalledWith("Third Semester/Pasted image.png");
    node.querySelector<HTMLButtonElement>(".cm-image-source")!.click();
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "![[Pasted image.png]]",
    );
  });
});
