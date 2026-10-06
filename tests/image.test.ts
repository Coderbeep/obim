import { test } from "vitest";

import assert from "node:assert/strict";

import type { EditorView } from "@codemirror/view";

import {
  buildImageDecorations,
  computeImageOverlayFromSelection,
  imageWidgetPrefixColumns,
  selectImageSyntax,
} from "../src/renderer/src/features/editor/extensions/ImageExtension";
import { markdownImagesInText } from "../src/renderer/src/features/editor/extensions/shared/OverlayMarkdown";
import {
  fakeView,
  markdownState,
  markdownStateFromText,
  mutableFakeView,
  rangesFor,
  replacedTexts,
  textsWithClass,
} from "./cm-extension-test-utils";

function imageRanges(input: string) {
  return rangesFor((view) => buildImageDecorations(view.state), input);
}

function imageOverlayState(input: string) {
  return computeImageOverlayFromSelection(fakeView(markdownState(input)));
}

function imagesFromDoc(doc: string) {
  return markdownImagesInText(doc, 0, null);
}

function firstImageWidget(doc: string) {
  const state = markdownState(`|\n${doc}`);
  const result: { widget?: { toDOM: (view: EditorView) => unknown } } = {};

  buildImageDecorations(state).between(0, state.doc.length, (_from, _to, value) => {
    result.widget ??= value.spec.widget;
  });

  const { widget } = result;
  assert.ok(widget);
  return {
    widget,
    view: {
      state,
      dom: { isConnected: true },
      dispatch() {},
    } as unknown as EditorView,
  };
}

test("inactive image hides markdown source and adds image widget", () => {
  const ranges = imageRanges("|\n![Alt](image.png)");

  assert.deepEqual(textsWithClass(ranges, "cm-mark-hidden"), []);
  assert.deepEqual(replacedTexts(ranges), ["![Alt](image.png)"]);
  assert.deepEqual(ranges.map((range) => range.widgetName).filter(Boolean), ["ImageWidget"]);
});

test("inactive Obsidian image embed replaces its exact source with an image widget", () => {
  const ranges = imageRanges("|\n![[Pasted image 20251213114150.png]]");

  assert.deepEqual(replacedTexts(ranges), ["![[Pasted image 20251213114150.png]]"]);
  assert.deepEqual(ranges.map((range) => range.widgetName).filter(Boolean), ["ImageWidget"]);
});

test("active Obsidian image embed reveals its syntax and editable target", () => {
  const ranges = imageRanges("![[Pasted image 20251213|114150.png]]");

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-mark"), ["![[", "]]"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-target"), ["Pasted image 20251213114150.png"]);
  assert.deepEqual(ranges.map((range) => range.widgetName).filter(Boolean), []);
});

test("active Obsidian image embed styles its delimiter, target, and modifier separately", () => {
  const ranges = imageRanges("![[|image.png|420]]");

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-mark"), ["![[", "|", "]]"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-target"), ["image.png"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-alt"), ["420"]);
});

test("an incomplete Obsidian image target is styled while it is being typed", () => {
  const ranges = imageRanges("![[ima|");

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-mark"), ["![["]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-target"), ["ima"]);
  assert.deepEqual(ranges.map((range) => range.widgetName).filter(Boolean), []);
});

test("active image shows syntax, alt text, and target", () => {
  const ranges = imageRanges("![Al|t](image.png)");

  assert.deepEqual(textsWithClass(ranges, "cm-mark-hidden"), []);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-mark"), ["![", "](", ")"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-alt"), ["Alt"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-target"), ["image.png"]);
  assert.deepEqual(ranges.map((range) => range.widgetName).filter(Boolean), []);
});

test("an empty viewport produces no image decorations", () => {
  const state = markdownState("|\n![Alt](image.png)");

  assert.equal(buildImageDecorations(state, { from: 0, to: 0 }).size, 0);
});

test("image boundary carets keep image markdown visible", () => {
  for (const input of ["|![Alt](image.png)", "![Alt](image.png)|"]) {
    const ranges = imageRanges(input);

    assert.deepEqual(textsWithClass(ranges, "cm-mark-hidden"), []);
    assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-mark"), ["![", "](", ")"]);
  }
});

test("caret in one image keeps sibling image source hidden", () => {
  const ranges = imageRanges("![One](one.png) and ![Tw|o](two.png)");

  assert.deepEqual(textsWithClass(ranges, "cm-mark-hidden"), []);
  assert.deepEqual(replacedTexts(ranges), ["![One](one.png)"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-alt"), ["Two"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-target"), ["two.png"]);
});

test("inline image preview widgets replace each image without swallowing surrounding text", () => {
  const doc = "Two images on one line: ![One](obim-1.png) and ![Two](obim-2.png)";
  const ranges = imageRanges(`|\n${doc}`);
  const widgets = ranges.filter((range) => range.widgetName === "ImageWidget");

  assert.deepEqual(replacedTexts(ranges), ["![One](obim-1.png)", "![Two](obim-2.png)"]);
  assert.deepEqual(
    widgets.map((range) => range.text),
    ["![One](obim-1.png)", "![Two](obim-2.png)"],
  );
});

test("adjacent inline images produce sorted replacements and widgets", () => {
  const doc = "![One](one.png)![Two](two.png)";
  const ranges = imageRanges(`|\n${doc}`);
  const widgets = ranges.filter((range) => range.widgetName === "ImageWidget");

  assert.deepEqual(replacedTexts(ranges), ["![One](one.png)", "![Two](two.png)"]);
  assert.deepEqual(
    widgets.map((range) => range.text),
    ["![One](one.png)", "![Two](two.png)"],
  );
});

test("multiline image targets stop at their closing parenthesis", () => {
  const ranges = imageRanges("|\n![Alt](folder/\nimage.png)\nafter");

  assert.deepEqual(replacedTexts(ranges), ["![Alt](folder/\nimage.png)"]);
});

test("image-only lines use inline replacement so following text stays clickable", () => {
  const ranges = imageRanges("|\nNot existing image:\n![Obim two](obim-2.png)\nSome text:");
  const imageReplacement = ranges.find((range) => range.widgetName === "ImageWidget");

  assert.equal(imageReplacement?.text, "![Obim two](obim-2.png)");
  assert.equal(imageReplacement?.block, false);
});

test("inline image widgets ignore plain text before the image when computing padding", () => {
  const doc = "Two images on one line: ![One](obim-1.png) and ![Two](obim-2.png)";
  const state = markdownStateFromText(doc, { from: 0, to: 0 });

  assert.deepEqual(
    imagesFromDoc(doc).map((image) => imageWidgetPrefixColumns(state, { ...image, syntax: "markdown" })),
    [0, 0],
  );
});

test("image widgets keep structural blockquote and list indentation", () => {
  const doc = "> ![Quote](obim-1.png)\n- ![List](obim-2.png)";
  const state = markdownStateFromText(doc, { from: 0, to: 0 });

  assert.deepEqual(
    imagesFromDoc(doc).map((image) => imageWidgetPrefixColumns(state, { ...image, syntax: "markdown" })),
    [2, 2],
  );
});

test("image markdown inside fenced code is ignored", () => {
  const ranges = imageRanges("|\n```md\n![Alt](image.png)\n```");

  assert.deepEqual(textsWithClass(ranges, "cm-mark-hidden"), []);
  assert.deepEqual(ranges.map((range) => range.widgetName).filter(Boolean), []);
});

test("image markdown inside inline code is ignored", () => {
  const ranges = imageRanges("|`![Alt](image.png)`");

  assert.deepEqual(replacedTexts(ranges), []);
  assert.deepEqual(ranges.map((range) => range.widgetName).filter(Boolean), []);
});

test("Obsidian image embeds inside code are ignored", () => {
  for (const input of ["|`![[image.png]]`", "|\n```md\n![[image.png]]\n```"]) {
    const ranges = imageRanges(input);

    assert.deepEqual(replacedTexts(ranges), []);
    assert.deepEqual(ranges.map((range) => range.widgetName).filter(Boolean), []);
  }
});

test("escaped and unclosed image syntax is ignored", () => {
  for (const input of ["|\\![Alt](image.png)", "|![Alt](image.png", "|![Alt]image.png)"]) {
    const ranges = imageRanges(input);

    assert.deepEqual(replacedTexts(ranges), []);
    assert.deepEqual(ranges.map((range) => range.widgetName).filter(Boolean), []);
  }
});

test("active image destinations preserve nested and escaped parentheses", () => {
  const ranges = imageRanges("![Alt](folder/a\\(b|\\).png)");

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-target"), ["folder/a\\(b\\).png"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-image-mark"), ["![", "](", ")"]);
});

test("image source button action selects the whole image syntax", () => {
  const doc = "Before\n![Obim two](obim-2.png)\nAfter";
  const image = imagesFromDoc(doc)[0];
  const { view } = mutableFakeView(markdownStateFromText(doc, { from: 0, to: 0 }));

  selectImageSyntax(view, image.from, image.to);

  assert.equal(view.state.selection.main.from, image.from);
  assert.equal(view.state.selection.main.to, image.to);
});

test("missing image widget does not retry on rebuild", () => {
  const globals = globalThis as unknown as {
    document?: Document;
    Image?: typeof Image;
    requestIdleCallback?: typeof requestIdleCallback;
    requestAnimationFrame?: typeof requestAnimationFrame;
  };
  const previousDocument = globals.document;
  const previousImage = globals.Image;
  const previousRequestIdleCallback = globals.requestIdleCallback;
  const previousRequestAnimationFrame = globals.requestAnimationFrame;
  const createdImages: Array<{ onerror: (() => void) | null }> = [];
  const idleCallbacks: IdleRequestCallback[] = [];

  globals.document = {
    createElement: () => ({
      className: "",
      style: {},
      classList: { add() {} },
      appendChild() {},
      setAttribute() {},
      addEventListener() {},
    }),
  } as unknown as Document;
  globals.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof requestAnimationFrame;
  globals.requestIdleCallback = ((callback: IdleRequestCallback) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  }) as typeof requestIdleCallback;
  globals.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    width = 0;
    height = 0;
    set src(_value: string) {
      createdImages.push(this);
    }
  } as unknown as typeof Image;

  try {
    const doc = "![Missing](missing-cache-test.png)";
    const first = firstImageWidget(doc);
    first.widget.toDOM(first.view);
    assert.equal(createdImages.length, 0);
    assert.equal(idleCallbacks.length, 1);

    idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 50 });
    assert.equal(createdImages.length, 1);

    createdImages[0].onerror?.();
    const second = firstImageWidget(doc);
    second.widget.toDOM(second.view);

    assert.equal(createdImages.length, 1);
    assert.equal(idleCallbacks.length, 0);
  } finally {
    if (previousDocument) globals.document = previousDocument;
    else delete globals.document;
    if (previousImage) globals.Image = previousImage;
    else delete globals.Image;
    if (previousRequestIdleCallback) globals.requestIdleCallback = previousRequestIdleCallback;
    else delete globals.requestIdleCallback;
    if (previousRequestAnimationFrame) globals.requestAnimationFrame = previousRequestAnimationFrame;
    else delete globals.requestAnimationFrame;
  }
});

test("image overlay context is active only when caret is inside image target", () => {
  assert.deepEqual(imageOverlayState("![Alt](ima|ge.png)"), {
    caretInside: true,
    activePos: [7, 16],
    anchorPos: 7,
    src: "image.png",
  });

  assert.deepEqual(imageOverlayState("![Al|t](image.png)"), {
    caretInside: false,
    activePos: [7, 16],
    anchorPos: 7,
    src: "image.png",
  });

  assert.deepEqual(imageOverlayState("text|"), {
    caretInside: false,
    activePos: null,
    anchorPos: null,
    src: "",
  });

  assert.deepEqual(imageOverlayState("![[ima|"), {
    caretInside: true,
    activePos: [3, 6],
    anchorPos: 3,
    src: "ima",
    insertion: "wiki-image",
    completionSuffix: "]]",
    allowEmptySource: true,
  });
});

test("image overlay lookup stops at code blocks and blank lines", () => {
  const empty = { caretInside: false, activePos: null, anchorPos: null, src: "" };

  assert.deepEqual(imageOverlayState("```md\n![Alt](ima|ge.png)\n```"), empty);
  assert.deepEqual(imageOverlayState("![Alt](image.png)\n\n|after"), empty);
});
