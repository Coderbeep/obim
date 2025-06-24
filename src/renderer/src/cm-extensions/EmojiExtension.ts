import { EditorView, WidgetType } from "@codemirror/view";
import * as emojiToolkit from "emoji-toolkit";

class EmojiWidget extends WidgetType {
  emoji: string;

  constructor(emoji: string) {
    super();
    this.emoji = emojiToolkit.shortnameToUnicode(emoji);
  }

  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.textContent = this.emoji;
    span.classList.add("cm-formatting-emoji");
    return span;
  }
}
