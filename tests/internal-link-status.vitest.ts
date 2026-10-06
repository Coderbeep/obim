import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import {
  buildLinkDecorations,
  createLinkExtension,
} from "../src/renderer/src/features/editor/extensions/LinkExtension";
import { createTableCellLinkExtension } from "../src/renderer/src/features/editor/extensions/tableCellMarkdown";
import { resolveWorkspaceLinkStatus } from "../src/renderer/src/features/files/workspaceFileResolver";
import type { LinkStatusPort } from "../src/renderer/src/features/editor/extensions/shared/linkStatus";
import type { FileItem } from "../src/shared/file-item";
import { fakeView, installCodeMirrorDomPolyfills, markdownStateFromText } from "./cm-extension-test-utils";

const file = (relativePath: string): FileItem => ({
  id: relativePath,
  filename: relativePath.split("/").at(-1)!,
  relativePath,
  path: `/notes/${relativePath}`,
  isDirectory: false,
  mimeType: "text/markdown",
});
let tree: FileItem[];
let listeners: Set<() => void>;
let views: EditorView[];
let port: LinkStatusPort;

beforeEach(() => {
  installCodeMirrorDomPolyfills();
  tree = [file("Source.md"), file("Known.md"), file("A/Review.md"), file("B/Review.md")];
  listeners = new Set();
  views = [];
  port = {
    resolve: vi.fn((destination, syntax) => resolveWorkspaceLinkStatus(destination, syntax, tree, "/notes/Source.md")),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});
afterEach(() => {
  for (const view of views) view.destroy();
  document.body.replaceChildren();
});

function editor(doc: string, anchor = 0) {
  const link = createLinkExtension({
    owner: "status-test",
    overlay: { open() {}, close() {}, hotkey() {} },
    openResource: vi.fn(),
    openWikiResource: vi.fn(),
    openExternal: vi.fn(),
    linkStatus: port,
  });
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdown({ base: markdownLanguage }), link.extension],
    }),
  });
  views.push(view);
  return view;
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("inactive Markdown and wiki links show statuses, aliases, counts, and hover text", () => {
  const view = editor("\n[Known](Known.md) [Lost](Lost.md) [[Review|Reviews]] [[A/Review]] [Web](https://example.com)");
  const anchors = Array.from(view.dom.querySelectorAll("a"));
  expect(anchors.map((anchor) => anchor.textContent)).toEqual(["Known", "Lost", "Reviews", "A/Review", "Web"]);
  expect(anchors[0].classList.contains("cm-link-missing")).toBe(false);
  expect(anchors[1].classList.contains("cm-link-missing")).toBe(true);
  expect(anchors[1].title).toBe("Note not found");
  expect(anchors[2].classList.contains("cm-link-ambiguous")).toBe(true);
  expect(anchors[2].title).toBe("2 notes match “Review”");
  expect(anchors[3].title).toBe("");
  expect(anchors[4].classList.contains("cm-link-placeholder-external")).toBe(true);
  expect(port.resolve).not.toHaveBeenCalledWith("https://example.com", "markdown");
});

test("editing a missing link gives the same hover text on label and target", () => {
  const view = editor("[Lost](Lost.md)", 2);
  expect(
    Array.from(view.dom.querySelectorAll(".cm-link-missing")).map((element) => [
      element.textContent,
      element.getAttribute("title"),
    ]),
  ).toEqual([
    ["Lost", "Note not found"],
    ["Lost.md", "Note not found"],
  ]);
  view.dispatch({ changes: { from: 7, to: 14, insert: "Known.md" } });
  expect(view.dom.querySelector(".cm-link-missing")).toBeNull();
});

test("tree changes refresh existing widgets without editing and cleanup cancels pending refresh", async () => {
  const view = editor("\n[[Review]] [Lost](Lost.md)");
  tree = [file("Source.md"), file("A/Review.md"), file("Lost.md")];
  for (const listener of listeners) listener();
  await flush();
  expect(view.dom.querySelector(".cm-link-missing, .cm-link-ambiguous")).toBeNull();
  expect(view.state.doc.toString()).toBe("\n[[Review]] [Lost](Lost.md)");
  for (const listener of listeners) listener();
  view.destroy();
  views = [];
  await flush();
  expect(listeners.size).toBe(0);
});

test("only visible link destinations are resolved, including on partially visible wiki lines", () => {
  const doc = "\n[[Known]] [[Hidden]]\n[Offscreen](Offscreen.md)\n`[[Code]]`";
  const view = fakeView(markdownStateFromText(doc, { from: 0, to: 0 }));
  Object.assign(view, { visibleRanges: [{ from: 1, to: 10 }] });
  buildLinkDecorations(view, { openResource() {}, openExternal() {}, openWikiResource() {}, linkStatus: port });
  expect(port.resolve).toHaveBeenCalledExactlyOnceWith("Known", "wiki");
});

test("code examples never get target validation", () => {
  editor("\n`[[Code]]`\n```md\n[Code](Code.md) [[MoreCode]]\n```");
  expect(port.resolve).not.toHaveBeenCalled();
});

test("inactive table links refresh on DOM and tree changes and preserve author titles", async () => {
  const view = new EditorView({ parent: document.body, extensions: [createTableCellLinkExtension(undefined, port)] });
  views.push(view);
  const cell = document.createElement("div");
  cell.className = "tbl-cell-view";
  cell.innerHTML = '<a href="Lost.md" title="Original">Lost</a><a href="https://example.com">Web</a>';
  view.dom.append(cell);
  await flush();
  const anchor = cell.querySelector("a")!;
  expect(anchor.title).toBe("Note not found");
  expect(anchor.classList.contains("cm-link-missing")).toBe(true);
  tree = [file("Lost.md")];
  for (const listener of listeners) listener();
  await flush();
  expect(anchor.title).toBe("Original");
  expect(anchor.classList.contains("cm-link-missing")).toBe(false);
  expect(port.resolve).not.toHaveBeenCalledWith("https://example.com", "markdown");
});

test("offscreen table destinations wait until scrolling into view", async () => {
  const view = new EditorView({ parent: document.body, extensions: [createTableCellLinkExtension(undefined, port)] });
  views.push(view);
  vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 100 } as DOMRect);
  const cell = document.createElement("div");
  cell.className = "tbl-cell-view";
  cell.innerHTML = '<a href="Lost.md">Lost</a>';
  const anchor = cell.querySelector("a")!;
  const bounds = vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ top: 200, bottom: 220 } as DOMRect);
  view.dom.append(cell);
  await flush();
  expect(port.resolve).not.toHaveBeenCalled();
  bounds.mockReturnValue({ top: 20, bottom: 40 } as DOMRect);
  view.scrollDOM.dispatchEvent(new Event("scroll"));
  await flush();
  expect(anchor.title).toBe("Note not found");
  view.destroy();
  views = [];
  expect(listeners.size).toBe(0);
});
