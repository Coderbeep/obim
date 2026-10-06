import assert from "node:assert/strict";
import { test } from "vitest";

import {
  markdownImagesInText,
  markdownLinksInText,
  wikiImagesInText,
  wikiLinksInText,
} from "../src/renderer/src/features/editor/extensions/shared/OverlayMarkdown";

function marked(input: string) {
  const from = input.indexOf("|");
  assert.notEqual(from, -1, "test input must contain a caret marker");
  return {
    text: input.slice(0, from) + input.slice(from + 1),
    selection: { from, to: from },
  };
}

function only<T>(items: T[]) {
  assert.equal(items.length, 1);
  return items[0];
}

test("image overlay target is active after the first inserted character", () => {
  const { text, selection } = marked("![](a|)");
  const image = only(markdownImagesInText(text, 0, selection));

  assert.equal(image.src, "a");
  assert.equal(image.isCaretInside, true);
  assert.deepEqual([image.altFrom, image.altTo], [2, 2]);
  assert.deepEqual([image.urlFrom, image.urlTo], [4, 5]);
  assert.deepEqual([image.srcFrom, image.srcTo], [4, 5]);
});

test("image overlay target remains active after a trailing space", () => {
  const { text, selection } = marked("![](My |)");
  const image = only(markdownImagesInText(text, 0, selection));

  assert.equal(image.src, "My");
  assert.equal(image.isCaretInside, true);
  assert.equal(image.srcTo, selection.from);
});

test("image overlay target supports spaces and multiline paths", () => {
  const { text, selection } = marked("![Cached](Images/large landscape\n sample |image.png)");
  const image = only(markdownImagesInText(text, 0, selection));

  assert.equal(image.src, "Images/large landscape sample image.png");
  assert.equal(image.isCaretInside, true);
});

test("image overlay target works inside blockquotes and lists", () => {
  const { text, selection } = marked("> - ![Quoted image](Images/My File|.png)");
  const image = only(markdownImagesInText(text, 0, selection));

  assert.equal(image.src, "Images/My File.png");
  assert.equal(image.quoteDepth, 1);
  assert.equal(image.prefixColumns, 4);
  assert.equal(image.isCaretInside, true);
});

test("plain links are not parsed as image overlay targets", () => {
  const { text, selection } = marked("[File](Images/My File|.png)");

  assert.equal(markdownImagesInText(text, 0, selection).length, 0);
});

test("link overlay target supports spaces in URLs", () => {
  const { text, selection } = marked("[README](New directory 2/Heading|Extension.md)");
  const link = only(markdownLinksInText(text, 0, selection));

  assert.equal(link.dest, "New directory 2/HeadingExtension.md");
  assert.equal(link.isCaretInside, true);
  assert.deepEqual([link.textFrom, link.textTo], [1, 7]);
  assert.deepEqual([link.urlFrom, link.urlTo], [9, text.length - 1]);
});

test("link overlay target remains active after a trailing space", () => {
  const { text, selection } = marked("[File](New |)");
  const link = only(markdownLinksInText(text, 0, selection));

  assert.equal(link.dest, "New");
  assert.equal(link.isCaretInside, true);
  assert.equal(link.destTo, selection.from);
});

test("image syntax is not parsed as a link overlay target", () => {
  const { text, selection } = marked("![Alt](image|.png)");

  assert.equal(markdownLinksInText(text, 0, selection).length, 0);
});

test("escaped link and image syntax are ignored", () => {
  const escapedLink = marked("\\[File](target|.md)");
  const escapedImage = marked("\\![Alt](image|.png)");

  assert.equal(markdownLinksInText(escapedLink.text, 0, escapedLink.selection).length, 0);
  assert.equal(markdownImagesInText(escapedImage.text, 0, escapedImage.selection).length, 0);
});

test("an even number of backslashes does not escape link or image syntax", () => {
  const link = only(markdownLinksInText(String.raw`\\[File](target.md)`, 0, null));
  const image = only(markdownImagesInText(String.raw`\\![Alt](image.png)`, 0, null));

  assert.equal(link.dest, "target.md");
  assert.equal(image.src, "image.png");
  assert.equal(markdownLinksInText(String.raw`\\\[File](target.md)`, 0, null).length, 0);
  assert.equal(markdownImagesInText(String.raw`\\\![Alt](image.png)`, 0, null).length, 0);
});

test("an escaped image marker leaves ordinary link syntax", () => {
  const link = only(markdownLinksInText(String.raw`\![Alt](image.png)`, 0, null));

  assert.equal(link.text, "Alt");
  assert.equal(link.dest, "image.png");
});

test("unfinished destinations apply backslash parity to brackets", () => {
  const escapedBracket = marked(String.raw`[File](target\[draft|`);
  const unescapedBracket = marked(String.raw`[File](target\\[draft|`);

  assert.equal(only(markdownLinksInText(escapedBracket.text, 0, escapedBracket.selection)).dest, "target[draft");
  assert.equal(markdownLinksInText(unescapedBracket.text, 0, unescapedBracket.selection).length, 0);
});

test("nested and escaped parentheses stay inside the overlay target", () => {
  const { text, selection } = marked("[File](Draft \\(old\\) (copy)|.md)");
  const link = only(markdownLinksInText(text, 0, selection));

  assert.equal(link.dest, "Draft (old) (copy).md");
  assert.equal(link.isCaretInside, true);
});

test("overlay parser supports nested labels, escaped brackets, and angled targets", () => {
  const image = only(markdownImagesInText("![A [nested] \\] label]( <Images/My File.png> )", 0, null));
  const link = only(markdownLinksInText("[A [nested] \\] label]( <Notes/My File.md> )", 0, null));

  assert.equal(image.alt, "A [nested] \\] label");
  assert.equal(image.src, "Images/My File.png");
  assert.equal(link.text, "A [nested] \\] label");
  assert.equal(link.dest, "Notes/My File.md");
});

test("overlay parser ignores empty and incomplete targets", () => {
  assert.deepEqual(markdownImagesInText("![]() ![Alt]( ) ![Alt] ![Alt](open ![unclosed", 0, null), []);
  assert.deepEqual(markdownLinksInText("[]() [File]( ) [File] [File](open [unclosed", 0, null), []);
});

test("E06 image and link extraction separates optional titles from angled and escaped destinations", () => {
  for (const target of [
    'map.png "Map caption"',
    "map.png 'Map caption'",
    "map.png (Map caption)",
    '<Map file.png> "Map caption )"',
    'Map\\(old\\).png "Map caption"',
  ]) {
    const image = only(markdownImagesInText(`![Map](${target})`, 0, null));
    const link = only(markdownLinksInText(`[Map](${target})`, 0, null));
    assert.equal(
      image.src,
      target.startsWith("<") ? "Map file.png" : target.startsWith("Map") ? "Map(old).png" : "map.png",
    );
    assert.equal(link.dest, image.src);
  }
});

test("Obsidian image embeds expose their target while preserving the full source range", () => {
  const text = "Before ![[ Third Semester/Pasted image 20251213114150.png|420 ]] after";
  const image = only(wikiImagesInText(text, 0, null));

  assert.equal(image.src, "Third Semester/Pasted image 20251213114150.png");
  assert.equal(text.slice(image.from, image.to), "![[ Third Semester/Pasted image 20251213114150.png|420 ]]");
  assert.equal(text.slice(image.srcFrom, image.srcTo), "Third Semester/Pasted image 20251213114150.png");
  assert.equal(image.alt, "Pasted image 20251213114150.png");
  assert.equal(image.isActive, false);
});

test("Obsidian image embeds activate only while editing the target", () => {
  const { text, selection } = marked("![[Pasted image 20251213|114150.png]]");
  const image = only(wikiImagesInText(text, 0, selection));

  assert.equal(image.isActive, true);
  assert.equal(image.isCaretInside, true);
});

test("an incomplete Obsidian image embed remains editable while its target is being typed", () => {
  const text = "![[Project map";
  const image = only(wikiImagesInText(text, 0, { from: text.length, to: text.length }));

  assert.equal(image.src, "Project map");
  assert.equal(image.closed, false);
  assert.equal(image.renderable, false);
  assert.equal(image.isActive, true);
  assert.equal(image.isCaretInside, true);
});

test("Obsidian image embeds expose their pipe modifier separately from the target", () => {
  const text = "![[Project map.png|420]]";
  const image = only(wikiImagesInText(text, 0, { from: 5, to: 5 }));

  assert.equal(text.slice(image.srcFrom, image.srcTo), "Project map.png");
  assert.equal(text.slice(image.modifierFrom!, image.modifierFrom! + 1), "|");
  assert.equal(text.slice(image.modifierFrom! + 1, image.modifierTo!), "420");
  assert.equal(image.closed, true);
  assert.equal(image.renderable, true);
});

test("Obsidian image parser ignores escaped, incomplete, multiline, and non-image embeds", () => {
  const source = "\\![[image.png]] ![[open.png ![[line\nbreak.png]] ![[Note.md]]";

  assert.deepEqual(wikiImagesInText(source, 0, null), []);
});

test("wiki note links expose target, alias, and delimiter ranges", () => {
  const text = "Before [[ Folder/Architectures.md#rcan | Channel attention ]] after";
  const link = only(wikiLinksInText(text, 0, null));

  assert.equal(link.dest, "Folder/Architectures.md#rcan");
  assert.equal(link.alias, "Channel attention");
  assert.equal(text.slice(link.destFrom, link.destTo), "Folder/Architectures.md#rcan");
  assert.equal(text.slice(link.aliasFrom!, link.aliasTo!), "Channel attention");
  assert.equal(text.slice(link.from, link.to), "[[ Folder/Architectures.md#rcan | Channel attention ]]");
  assert.equal(link.closed, true);
});

test("an incomplete wiki note link remains searchable while its target is being typed", () => {
  const text = "[[Arch";
  const link = only(wikiLinksInText(text, 0, { from: text.length, to: text.length }));

  assert.equal(link.dest, "Arch");
  assert.equal(link.closed, false);
  assert.equal(link.isActive, true);
  assert.equal(link.isCaretInside, true);
});

test("wiki targets remain searchable after a typed space", () => {
  const note = marked("[[Project |");
  const image = marked("![[Project |");

  assert.equal(only(wikiLinksInText(note.text, 0, note.selection)).isCaretInside, true);
  assert.equal(only(wikiImagesInText(image.text, 0, image.selection)).isCaretInside, true);
});

test("wiki note parsing excludes image embeds, escaped links, multiline targets, and inactive partial syntax", () => {
  const source = "![[image.png]] \\[[escaped]] [[open [[line\nbreak]]";

  assert.deepEqual(wikiLinksInText(source, 0, null), []);
});
