import type { LinkStatusPort } from "./extensions/shared/linkStatus";
import { defaultKeymap, history, toggleComment } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  type Extension,
} from "@renderer/features/editor/codemirror-state";
import { EditorView, keymap } from "@renderer/features/editor/codemirror-view";
import { isShortcut } from "@renderer/shared/keyboardShortcuts";
import { isWorkspaceTransitionActive } from "@renderer/store/workspaceTransitionStore";
import { createEditorFindPanel } from "./editorFindPanel";

import type { Notification } from "@renderer/features/notifications/notifications";
import type { EditorOverlayPort } from "@renderer/store/editorOverlayStore";
import { fileDropExtension, normalizeTabsOnPaste } from "./editorInput";
import { createEditorSelectionExtensions } from "./editorSelection";
import { BlockQuoteExtension } from "./extensions/BlockQuoteExtension";
import { CodeBlockExtension } from "./extensions/CodeBlockExtension";
import { EmphasisExtension } from "./extensions/EmphasisExtension";
import { FrontmatterExtension } from "./extensions/FrontmatterExtension";
import { HeadingExtension } from "./extensions/HeadingExtension";
import { HorizontalRuleExtension } from "./extensions/HorizontalRuleExtension";
import { createImageExtension, type ImageActions } from "./extensions/ImageExtension";
import FormattingKeymap from "./extensions/InlineFormattingWrap";
import { createLinkExtension } from "./extensions/LinkExtension";
import { createListsExtension } from "./extensions/ListsExtension";
import { MathBlockExtension, MathBlockParser } from "./extensions/MathExpression";
import { OutlineNavigationExtension } from "./extensions/OutlineNavigationExtension";
import { createPasteExtension } from "./extensions/PasteExtension";
import { tableExtensions } from "./extensions/TableExtension";
import { insertNewlineContinueMarkup } from "./extensions/shared/commands";
import { visualLineNavigationKeymap } from "./extensions/shared/lineNavigation";
import { obimMarkdown } from "./language";
import { basicLight } from "./styles/basic-light";

const transitionEditGuard = EditorState.changeFilter.of(() => !isWorkspaceTransitionActive());
const singleSelectionGuard = EditorState.transactionFilter.of((transaction) => {
  if (transaction.newSelection.ranges.length <= 1) return transaction;

  const main = transaction.newSelection.main;
  return [
    transaction,
    {
      selection: EditorSelection.single(main.anchor, main.head),
      sequential: true,
    },
  ];
});

const markdownLanguage = obimMarkdown(languages);
const tabNormalization = normalizeTabsOnPaste(4);
const shiftEnterKeymap = Prec.highest(keymap.of([{ key: "Shift-Enter", run: insertNewlineContinueMarkup }]));
const indentWithSpaces = indentUnit.of("    ");
const editorDefaultKeymap = keymap.of(defaultKeymap.filter((binding) => binding.run !== toggleComment));
const searchAtTop = [
  search({ top: true, createPanel: createEditorFindPanel }),
  Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.defaultPrevented || event.isComposing || !isShortcut("find-note", event)) return false;
        event.preventDefault();
        return openSearchPanel(view);
      },
    }),
  ),
  keymap.of(searchKeymap.filter((binding) => binding.run !== openSearchPanel)),
];
const editorSelection = createEditorSelectionExtensions(() => window.api.focusAppWindow());

const coreEditorExtensions = [
  transitionEditGuard,
  singleSelectionGuard,
  searchAtTop,
  editorDefaultKeymap,
  editorSelection,
];

const plainEditorExtensionOrder = [
  "tabNormalization",
  "theme",
  "lineWrapping",
  "visualLineNavigation",
  "indent",
] as const;

const markdownEditorExtensionOrder = [
  "noteHeader",
  "markdown",
  "table",
  "paste",
  "tabNormalization",
  "fileDrop",
  "theme",
  "lineWrapping",
  "visualLineNavigation",
  "blockQuote",
  "codeBlock",
  "emphasis",
  "frontmatter",
  "heading",
  "image",
  "horizontalRule",
  "lists",
  "math",
  "formatting",
  "link",
  "outline",
  "indent",
  "shiftEnter",
] as const;

type EditorExtensionPart = (typeof markdownEditorExtensionOrder)[number];

export function resetEditorHistory(view: EditorView, compartment: Compartment) {
  view.dispatch({ effects: compartment.reconfigure([]) });
  view.dispatch({ effects: compartment.reconfigure(history()) });
}

export type EditorExtensionParts = Record<EditorExtensionPart, Extension>;

export function composeEditorExtensions({ isMarkdown, parts }: { isMarkdown: boolean; parts: EditorExtensionParts }) {
  const order = isMarkdown ? markdownEditorExtensionOrder : plainEditorExtensionOrder;
  return order.map((name) => parts[name]);
}

export function createEditorExtensions({
  isMarkdown,
  owner,
  overlay,
  notify,
  openResource,
  onHoverPdfReference,
  openWikiResource,
  canonicalizeWikiResource,
  linkStatus,
  openExternal,
  noteHeader,
  onFilesCreated,
  imageActions,
}: {
  isMarkdown: boolean;
  owner: string;
  overlay: EditorOverlayPort;
  notify(notification: Notification): void;
  openResource(path: string): void | Promise<void>;
  onHoverPdfReference?(destination: string | null): void;
  openWikiResource?(path: string): void | Promise<void>;
  canonicalizeWikiResource?(path: string): string;
  linkStatus?: LinkStatusPort;
  openExternal(url: string): void | Promise<void>;
  noteHeader: Extension;
  onFilesCreated?(): void;
  imageActions?: ImageActions;
}) {
  if (!isMarkdown) {
    return [
      ...coreEditorExtensions,
      tabNormalization,
      basicLight,
      EditorView.lineWrapping,
      visualLineNavigationKeymap,
      indentWithSpaces,
    ];
  }

  const image = createImageExtension({ owner, overlay, actions: imageActions });
  const link = createLinkExtension({
    owner,
    overlay,
    openResource,
    onHoverPdfReference,
    openWikiResource,
    canonicalizeWikiResource,
    linkStatus,
    openExternal,
  });
  const lists = createListsExtension(() => image.controller.isOpen() || link.controller.isOpen());

  return [
    ...coreEditorExtensions,
    ...composeEditorExtensions({
      isMarkdown,
      parts: {
        noteHeader,
        markdown: markdownLanguage,
        table: tableExtensions(markdownLanguage, {
          cellExtensions: [
            EmphasisExtension,
            CodeBlockExtension,
            MathBlockExtension,
            image.extension,
            link.extension,
            FormattingKeymap,
            keymap.of(defaultKeymap.filter((binding) => binding.run !== toggleComment)),
          ],
          cellMarkdownExtensions: [MathBlockParser],
          openExternal,
          openResource,
          linkStatus,
        }),
        paste: createPasteExtension(notify, onFilesCreated),
        tabNormalization,
        fileDrop: fileDropExtension,
        theme: basicLight,
        lineWrapping: EditorView.lineWrapping,
        visualLineNavigation: visualLineNavigationKeymap,
        blockQuote: BlockQuoteExtension,
        codeBlock: CodeBlockExtension,
        emphasis: EmphasisExtension,
        frontmatter: FrontmatterExtension,
        heading: HeadingExtension,
        image: image.extension,
        horizontalRule: HorizontalRuleExtension,
        lists,
        math: MathBlockExtension,
        formatting: FormattingKeymap,
        link: link.extension,
        outline: OutlineNavigationExtension,
        indent: indentWithSpaces,
        shiftEnter: shiftEnterKeymap,
      },
    }),
  ];
}
