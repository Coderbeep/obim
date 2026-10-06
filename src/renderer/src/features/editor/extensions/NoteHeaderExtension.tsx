import { undo } from "@codemirror/commands";
import {
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
} from "@renderer/features/editor/codemirror-state";
import {
  Decoration,
  EditorView,
  keymap,
  WidgetType,
  type DecorationSet,
} from "@renderer/features/editor/codemirror-view";
import { IconTask } from "@renderer/shared/icons/IconTask";
import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { shakeElement } from "@renderer/features/files/shake";
import { toDateInputValue } from "@renderer/shared/date";
import { getFileGlyph } from "@renderer/shared/icons/FileGlyphs";
import { Button } from "@renderer/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@renderer/shared/ui/dropdown-menu";
import {
  editFrontmatterSource,
  parseFrontmatter,
  planFrontmatterEdit,
  type FrontmatterEdit,
  type FrontmatterProperty,
} from "@shared/frontmatter";
import { instantiateTaskNoteFrontmatter, NOTE_TYPE_FIELD_KEY } from "@shared/note-type-templates";
import { NoteDetailsEditor } from "../note-details";
import {
  frontmatterSourceEditingState,
  frontmatterState,
  setFrontmatterSourceEditingEffect,
} from "./FrontmatterExtension";
import { deriveExactNoteType } from "./noteType";

interface NoteHeaderState {
  editingYaml: boolean;
  hasFrontmatter: boolean;
  properties: readonly FrontmatterProperty[];
  showDetails: boolean;
  title: string;
  titleEditRequest: number;
}

type RenameNoteTitle = (title: string) => Promise<boolean>;

const roots = new WeakMap<HTMLElement, Root>();
const resizeObservers = new WeakMap<HTMLElement, ResizeObserver>();

export const requestNoteTitleEditEffect = StateEffect.define<number>();
const consumeNoteTitleEditEffect = StateEffect.define<number>();

const noteTitleEditRequestState = StateField.define<{ consumed: number; requested: number }>({
  create: () => ({ consumed: 0, requested: 0 }),
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(requestNoteTitleEditEffect)) next = { ...next, requested: effect.value };
      if (effect.is(consumeNoteTitleEditEffect) && effect.value === next.requested) {
        next = { ...next, consumed: effect.value };
      }
    }
    return next;
  },
});

const getNoteHeaderState = (state: EditorState, title: string): NoteHeaderState => {
  const frontmatter = state.field(frontmatterState);
  const editingYaml = state.field(frontmatterSourceEditingState);
  const titleEdit = state.field(noteTitleEditRequestState);

  return {
    editingYaml,
    hasFrontmatter: frontmatter.kind !== "none" && Boolean(frontmatter.envelope),
    properties: frontmatter.kind === "valid" && frontmatter.managed ? frontmatter.properties : [],
    showDetails: editingYaml || frontmatter.kind === "none" || (frontmatter.kind === "valid" && frontmatter.managed),
    title,
    titleEditRequest: titleEdit.requested !== titleEdit.consumed ? titleEdit.requested : 0,
  };
};

const noteHeaderRenderKey = (state: NoteHeaderState) => JSON.stringify(state);

const noteHeaderStateChanged = (transaction: Transaction, title: string) => {
  const previousFrontmatter = transaction.startState.field(frontmatterState, false);
  const nextFrontmatter = transaction.state.field(frontmatterState, false);
  const previousEditing = transaction.startState.field(frontmatterSourceEditingState, false);
  const nextEditing = transaction.state.field(frontmatterSourceEditingState, false);
  const previousTitleEdit = transaction.startState.field(noteTitleEditRequestState, false);
  const nextTitleEdit = transaction.state.field(noteTitleEditRequestState, false);

  // Reconfiguration transactions may add or remove one of the fields. The
  // header must be rebuilt in that case, and the missing state must not be read.
  if (
    previousFrontmatter === undefined ||
    nextFrontmatter === undefined ||
    previousEditing === undefined ||
    nextEditing === undefined ||
    previousTitleEdit === undefined ||
    nextTitleEdit === undefined
  ) {
    return true;
  }

  const frontmatterChanged = previousFrontmatter !== nextFrontmatter;
  const editingChanged = previousEditing !== nextEditing;
  const titleEditChanged = previousTitleEdit !== nextTitleEdit;

  if (!frontmatterChanged && !editingChanged && !titleEditChanged) return false;

  return (
    noteHeaderRenderKey(getNoteHeaderState(transaction.startState, title)) !==
    noteHeaderRenderKey(getNoteHeaderState(transaction.state, title))
  );
};

const createFrontmatterFromOpeningFence = EditorState.transactionFilter.of((transaction) => {
  if (
    !transaction.docChanged ||
    !transaction.isUserEvent("input") ||
    transaction.startState.field(frontmatterState).kind !== "none"
  ) {
    return transaction;
  }

  const firstLine = transaction.newDoc.line(1);
  if (transaction.newDoc.sliceString(firstLine.from, firstLine.to) !== "---") return transaction;
  const parsed = parseFrontmatter(transaction.newDoc.toString());
  if (parsed.kind !== "invalid" || parsed.envelope) return transaction;

  const lineBreak = transaction.startState.lineBreak;
  const atDocumentEnd = firstLine.to === transaction.newDoc.length;
  const from = atDocumentEnd ? firstLine.to : transaction.newDoc.line(2).from;
  const insert = atDocumentEnd ? `${lineBreak}---${lineBreak}` : `---${lineBreak}`;
  return [
    transaction,
    {
      changes: { from, insert },
      selection: { anchor: from + insert.length },
      sequential: true,
    },
  ];
});

const openCreatedFrontmatterEditor = EditorView.updateListener.of((update) => {
  const before = update.startState.field(frontmatterState);
  const after = update.state.field(frontmatterState);
  if (
    before.kind !== "none" ||
    after.kind !== "valid" ||
    !after.managed ||
    after.properties.length > 0 ||
    !update.transactions.some((transaction) => transaction.isUserEvent("input"))
  ) {
    return;
  }
  window.requestAnimationFrame(() => {
    update.view.dom.querySelector<HTMLButtonElement>(".note-details-disclosure[aria-expanded='false']")?.click();
  });
});

const editFrontmatter = (view: EditorView, edit: FrontmatterEdit) => {
  const result = planFrontmatterEdit(view.state.doc.toString(), edit);
  if (!result.success) return result.error;
  view.dispatch({ changes: result.change });
  return null;
};

const convertNoteToTask = (view: EditorView) => {
  let source = view.state.doc.toString();
  const today = toDateInputValue(new Date());
  for (const { key, value } of instantiateTaskNoteFrontmatter({ today })) {
    const edit = { type: "upsert", key, value } satisfies FrontmatterEdit;
    const result = editFrontmatterSource(source, edit);
    if (!result.success) return result.error;
    source = result.source;
  }
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
  return null;
};

const noteBodyStart = (view: EditorView) => {
  const frontmatter = view.state.field(frontmatterState);
  if (frontmatter.kind !== "valid") return 0;
  const line = view.state.doc.lineAt(frontmatter.envelope.range.to);
  return line.length === 0 && line.number < view.state.doc.lines
    ? view.state.doc.line(line.number + 1).from
    : line.from;
};

const focusEditorBody = (view: EditorView) => view.focus();

const focusEditorBodyStart = (view: EditorView) => {
  if (!view.dom.isConnected) return;
  view.dispatch({ selection: { anchor: noteBodyStart(view) }, scrollIntoView: true });
  view.focus();
};

const setYamlEditing = (view: EditorView, editing: boolean) => {
  const frontmatter = view.state.field(frontmatterState);
  if (frontmatter.kind === "none" || !frontmatter.envelope) return;

  if (editing) {
    view.dispatch({ effects: setFrontmatterSourceEditingEffect.of(true) });
    window.requestAnimationFrame(() => {
      if (!view.dom.isConnected || !view.state.field(frontmatterSourceEditingState)) return;
      const current = view.state.field(frontmatterState);
      if (current.kind === "none" || !current.envelope) return;
      const openingLine = view.state.doc.lineAt(current.envelope.range.from);
      const selection = view.state.doc.line(Math.min(view.state.doc.lines, openingLine.number + 1)).from;
      view.focus();
      view.dispatch({ selection: { anchor: selection }, scrollIntoView: true });
    });
    return;
  }

  view.dispatch({
    effects: setFrontmatterSourceEditingEffect.of(false),
    selection: { anchor: noteBodyStart(view) },
    scrollIntoView: true,
  });
  view.focus();
};

const focusNoteDetails = (view: EditorView) => {
  const selection = view.state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) return false;

  const frontmatter = view.state.field(frontmatterState);
  if (frontmatter.kind === "invalid" || (frontmatter.kind === "valid" && !frontmatter.managed)) return false;
  const bodyFrom = noteBodyStart(view);
  const bodyLine = view.state.doc.lineAt(bodyFrom);
  if (view.state.doc.lineAt(selection.main.head).from !== bodyLine.from) return false;

  const visualLineStart = view.moveToLineBoundary(selection.main, false, true);
  if (visualLineStart.head > bodyLine.from) return false;

  const disclosure = view.dom.querySelector<HTMLButtonElement>(".note-details-disclosure");
  if (!disclosure) return false;
  const focusBottom = () => {
    const rows = view.dom.querySelectorAll<HTMLElement>("[data-property-key]");
    const target =
      view.dom.querySelector<HTMLElement>(".note-details-add-row .note-details-key-input") ??
      view.dom.querySelector<HTMLElement>(".note-details-actions button") ??
      rows.item(rows.length - 1) ??
      disclosure;
    target.focus();
  };
  if (disclosure.getAttribute("aria-expanded") === "false") {
    disclosure.click();
    window.requestAnimationFrame(focusBottom);
  } else {
    focusBottom();
  }
  return true;
};

const NoteTypeSelector = ({ properties, view }: Pick<NoteHeaderState, "properties"> & { view: EditorView }) => {
  const noteType = deriveExactNoteType(properties);
  const label = noteType.kind === "task" ? "Task" : "Note";
  const replace = (target: "note" | "task") => {
    if (target === "note") {
      if (noteType.kind !== "note") editFrontmatter(view, { type: "remove", key: NOTE_TYPE_FIELD_KEY });
    } else if (noteType.kind !== "task") {
      convertNoteToTask(view);
    }
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          aria-label={`Note type: ${label}`}
          className="cm-note-header-type h-7 gap-1.5 overflow-hidden px-2 data-[state=open]:border-[var(--border-strong)] data-[state=open]:text-primary"
        >
          <span className="cm-note-header-type-main flex h-full items-center gap-1.5">
            {noteType.kind === "task" ? <IconTask aria-hidden="true" /> : getFileGlyph("note.md")}
            {label}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={noteType.kind}
          onValueChange={(value) => {
            if (value === "note" || value === "task") replace(value);
          }}
        >
          <DropdownMenuRadioItem value="note">
            {getFileGlyph("note.md")}
            Note
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="task">
            <IconTask />
            Task
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const NoteTitle = ({
  editRequest,
  onEditRequestStarted,
  onRename,
  onReturnToEditor,
  title,
}: {
  editRequest: number;
  onEditRequestStarted: (request: number) => void;
  onRename: RenameNoteTitle;
  onReturnToEditor: () => void;
  title: string;
}) => {
  const [draftTitle, setDraftTitle] = useState(title);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);
  const caretOffsetRef = useRef(title.length);
  const handledEditRequestRef = useRef(0);
  const requestedEditRef = useRef(false);

  useEffect(() => {
    if (!editRequest || editRequest === handledEditRequestRef.current) return;
    handledEditRequestRef.current = editRequest;
    requestedEditRef.current = true;
    setDraftTitle(title);
    setEditing(true);
    onEditRequestStarted(editRequest);
  }, [editRequest, onEditRequestStarted, title]);

  const cancel = () => {
    setDraftTitle(title);
    setEditing(false);
  };
  const submit = async (focusEditorAfterSubmit = false) => {
    const nextTitle = draftTitle.trim();
    if (submittingRef.current) return;
    if (nextTitle === title) {
      submittingRef.current = focusEditorAfterSubmit;
      cancel();
      if (focusEditorAfterSubmit) onReturnToEditor();
      submittingRef.current = false;
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (await onRename(nextTitle)) {
        setEditing(false);
        if (focusEditorAfterSubmit) onReturnToEditor();
        return;
      }
      shakeElement(inputRef.current);
    } catch {
      shakeElement(inputRef.current);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <h1 className="cm-note-header-title">
      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          className="cm-note-header-title-input"
          value={draftTitle}
          readOnly={submitting}
          aria-label={`Rename ${title}`}
          onFocus={(event) => {
            if (requestedEditRef.current) {
              requestedEditRef.current = false;
              event.currentTarget.select();
              return;
            }
            const offset = Math.min(caretOffsetRef.current, event.currentTarget.value.length);
            event.currentTarget.setSelectionRange(offset, offset);
          }}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={() => {
            if (!submittingRef.current) void submit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="cm-note-header-title-button"
          aria-label={`Rename ${title}`}
          onClick={(event) => {
            const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
            caretOffsetRef.current =
              range?.startContainer.nodeType === Node.TEXT_NODE && event.currentTarget.contains(range.startContainer)
                ? range.startOffset
                : title.length;
            setDraftTitle(title);
            setEditing(true);
          }}
        >
          {title}
        </button>
      )}
    </h1>
  );
};

const NoteHeader = ({
  editingYaml,
  hasFrontmatter,
  onRenameTitle,
  onTitleEditRequestStarted,
  properties,
  showDetails,
  title,
  titleEditRequest,
  view,
}: NoteHeaderState & {
  onRenameTitle?: RenameNoteTitle;
  onTitleEditRequestStarted?: () => void;
  view: EditorView;
}) =>
  title || showDetails ? (
    <section className="cm-note-header" aria-label="Note header">
      {title ? (
        onRenameTitle ? (
          <NoteTitle
            editRequest={titleEditRequest}
            title={title}
            onRename={onRenameTitle}
            onReturnToEditor={() => focusEditorBodyStart(view)}
            onEditRequestStarted={(request) => {
              view.dispatch({ effects: consumeNoteTitleEditEffect.of(request) });
              onTitleEditRequestStarted?.();
            }}
          />
        ) : (
          <h1 className="cm-note-header-title">{title}</h1>
        )
      ) : null}
      {showDetails ? (
        <div className="cm-note-header-bar">
          <NoteTypeSelector properties={properties} view={view} />
          <div className="cm-note-header-details">
            <NoteDetailsEditor
              editingYaml={editingYaml}
              hasFrontmatter={hasFrontmatter}
              properties={properties}
              onEdit={(edit) => editFrontmatter(view, edit)}
              onEditYaml={() => setYamlEditing(view, !editingYaml)}
              onReturnToEditor={() => focusEditorBody(view)}
              onUndo={() => undo(view)}
            />
          </div>
        </div>
      ) : null}
    </section>
  ) : null;

const requestHeaderMeasure = (view: EditorView, dom: HTMLElement) => {
  window.requestAnimationFrame(() => {
    if (dom.isConnected && view.dom.isConnected) view.requestMeasure();
  });
};

class NoteHeaderWidget extends WidgetType {
  private readonly renderKey: string;

  constructor(
    private readonly headerState: NoteHeaderState,
    private readonly onRenameTitle?: RenameNoteTitle,
    private readonly onTitleEditRequestStarted?: () => void,
  ) {
    super();
    this.renderKey = noteHeaderRenderKey(headerState);
  }

  private render(root: Root, view: EditorView) {
    root.render(
      <NoteHeader
        {...this.headerState}
        onRenameTitle={this.onRenameTitle}
        onTitleEditRequestStarted={this.onTitleEditRequestStarted}
        view={view}
      />,
    );
  }

  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    const root = createRoot(dom);
    roots.set(dom, root);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        if (dom.isConnected && view.dom.isConnected) view.requestMeasure();
      });
      observer.observe(dom);
      resizeObservers.set(dom, observer);
    }
    this.render(root, view);
    requestHeaderMeasure(view, dom);
    return dom;
  }

  eq(other: NoteHeaderWidget) {
    return (
      this.renderKey === other.renderKey &&
      this.onRenameTitle === other.onRenameTitle &&
      this.onTitleEditRequestStarted === other.onTitleEditRequestStarted
    );
  }

  updateDOM(dom: HTMLElement, view: EditorView) {
    const root = roots.get(dom);
    if (!root) return false;

    this.render(root, view);
    requestHeaderMeasure(view, dom);
    return true;
  }

  destroy(dom: HTMLElement) {
    const root = roots.get(dom);
    resizeObservers.get(dom)?.disconnect();
    roots.delete(dom);
    resizeObservers.delete(dom);
    if (root) window.queueMicrotask(() => root.unmount());
  }
}

const createNoteHeaderDecorations = (
  state: EditorState,
  title: string,
  onRenameTitle?: RenameNoteTitle,
  onTitleEditRequestStarted?: () => void,
) =>
  Decoration.set([
    Decoration.widget({
      block: true,
      side: -2,
      widget: new NoteHeaderWidget(getNoteHeaderState(state, title), onRenameTitle, onTitleEditRequestStarted),
    }).range(0),
  ]);

export const createNoteHeaderExtension = (
  title = "",
  onRenameTitle?: RenameNoteTitle,
  onTitleEditRequestStarted?: () => void,
): Extension => {
  const noteHeaderField = StateField.define<DecorationSet>({
    create: (state) => createNoteHeaderDecorations(state, title, onRenameTitle, onTitleEditRequestStarted),
    update(decorations, transaction) {
      if (noteHeaderStateChanged(transaction, title)) {
        return createNoteHeaderDecorations(transaction.state, title, onRenameTitle, onTitleEditRequestStarted);
      }
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  return [
    frontmatterState,
    frontmatterSourceEditingState,
    noteTitleEditRequestState,
    createFrontmatterFromOpeningFence,
    openCreatedFrontmatterEditor,
    noteHeaderField,
    Prec.highest(
      keymap.of([
        {
          key: "ArrowUp",
          run: focusNoteDetails,
        },
      ]),
    ),
  ];
};
