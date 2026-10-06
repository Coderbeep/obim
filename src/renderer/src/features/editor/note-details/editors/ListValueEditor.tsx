import { IconX } from "@pierre/icons";
import { useRef, useState } from "react";

import { cn } from "@renderer/shared/classNames";
import { Badge, badgeVariants } from "@renderer/shared/ui/badge";
import { Popover, PopoverAnchor } from "@renderer/shared/ui/popover";
import type { FrontmatterProperty } from "@shared/frontmatter";
import { TAGS_FIELD_KEY } from "@shared/note-type-templates";

import { SuggestionList, useSuggestions } from "../Suggestions";
import type { ApplyEdit } from "../types";
import { filterValueSuggestions } from "../valueSuggestions";

const TokenBadge = ({ item, onEdit, onRemove }: { item: string; onEdit: () => void; onRemove: () => void }) => (
  <Badge variant="secondary" className="note-details-token" title={item}>
    <button
      type="button"
      className="note-details-token-label note-details-token-edit"
      aria-label={`Edit ${item}`}
      onClick={onEdit}
    >
      {item}
    </button>
    <button
      type="button"
      className="note-details-token-remove"
      aria-label={`Remove ${item}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRemove}
      onKeyDown={(event) => {
        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          onRemove();
          return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const controls = Array.from(
          event.currentTarget
            .closest(".note-details-token-field")
            ?.querySelectorAll<HTMLElement>(".note-details-token-remove, .note-details-token-input") ?? [],
        );
        const index = controls.indexOf(event.currentTarget);
        const next = controls[index + (event.key === "ArrowLeft" ? -1 : 1)];
        if (next) next.focus();
        else if (event.key === "ArrowLeft") {
          const key = event.currentTarget
            .closest("[data-property-key]")
            ?.querySelector<HTMLInputElement>("[data-note-details-key]");
          key?.focus();
          key?.setSelectionRange(key.value.length, key.value.length);
        }
      }}
    >
      <IconX aria-hidden="true" />
    </button>
  </Badge>
);

export const ListValueEditor = ({
  items,
  loadSuggestions,
  onEdit,
  property,
}: {
  items: readonly string[];
  loadSuggestions: (key: string) => Promise<string[]>;
  onEdit: ApplyEdit;
  property: FrontmatterProperty;
}) => {
  const [draft, setDraft] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelling = useRef(false);
  const excluded = editingIndex === null ? items : items.filter((_, index) => index !== editingIndex);
  const changeItems = (nextItems: readonly string[]) => onEdit({ type: "upsert", key: property.key, value: nextItems });

  const resetDraft = () => {
    setDraft("");
    setEditingIndex(null);
  };

  const commit = (text: string) => {
    const item = text.trim();
    const duplicate = filterValueSuggestions({ suggestions: excluded, query: item }).exactMatch;
    if (!item || duplicate || (editingIndex !== null && item === items[editingIndex])) {
      resetDraft();
      return true;
    }
    const success = changeItems(
      editingIndex === null ? [...items, item] : items.map((value, index) => (index === editingIndex ? item : value)),
    );
    if (success) {
      resetDraft();
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        suggestions.openSuggestions();
      });
    }
    return success;
  };

  const suggestions = useSuggestions<string>({
    query: draft,
    loadOptions: async () => (await loadSuggestions(property.key)).map((value) => ({ id: value, label: value, value })),
    filterOptions: (options, query) => {
      const visible = new Set(
        filterValueSuggestions({ suggestions: options.map(({ value }) => value), query, excluded }).visibleSuggestions,
      );
      return options.filter(({ value }) => visible.has(value));
    },
    onSelect: ({ value }) => commit(value),
    onCommitQuery: commit,
  });

  const edit = (index: number) => {
    setEditingIndex(index);
    setDraft(items[index] ?? "");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const renderInput = (key: string) => {
    const input = (
      <input
        ref={inputRef}
        {...suggestions.inputProps}
        data-note-details-primary
        type="text"
        className={`note-details-token-input${editingIndex === null ? "" : " note-details-token-input-editing"}`}
        aria-label={
          editingIndex === null ? `Add ${property.key} item` : `Edit ${property.key} item ${items[editingIndex] ?? ""}`
        }
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={
          editingIndex === null && items.length === 0
            ? property.key === TAGS_FIELD_KEY
              ? "Add tags"
              : "Add item"
            : ""
        }
        value={draft}
        onFocus={suggestions.openSuggestions}
        onClick={suggestions.openSuggestions}
        onBlur={() => {
          suggestions.closeSuggestions();
          if (cancelling.current) {
            cancelling.current = false;
            return;
          }
          if (editingIndex !== null) commit(draft);
        }}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setDraft(value);
          suggestions.refreshSuggestions(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !suggestions.expanded) {
            event.preventDefault();
            event.stopPropagation();
            const row = event.currentTarget.closest<HTMLElement>("[data-property-key]");
            cancelling.current = true;
            resetDraft();
            row?.focus();
            return;
          }
          if (suggestions.onInputKeyDown(event)) return;
          if (editingIndex === null && event.key === "Backspace" && draft === "" && items.length > 0) {
            event.preventDefault();
            changeItems(items.slice(0, -1));
          } else if (
            editingIndex === null &&
            event.key === "ArrowLeft" &&
            draft === "" &&
            event.currentTarget.selectionStart === 0 &&
            items.length > 0
          ) {
            event.preventDefault();
            event.currentTarget
              .closest(".note-details-token-field")
              ?.querySelectorAll<HTMLElement>(".note-details-token-remove")
              .item(items.length - 1)
              .focus();
          }
        }}
      />
    );

    return (
      <Popover key={key} open={suggestions.expanded} onOpenChange={suggestions.onOpenChange}>
        <PopoverAnchor asChild>
          {editingIndex === null ? (
            input
          ) : (
            <span
              className={cn(badgeVariants({ variant: "secondary" }), "note-details-token note-details-token-editing")}
            >
              <span className="note-details-token-edit-shell">
                <button
                  type="button"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="note-details-token-label note-details-token-edit note-details-token-edit-measure"
                >
                  {draft || "\u00a0"}
                </button>
                {input}
              </span>
              <span aria-hidden="true" className="note-details-token-remove-placeholder" />
            </span>
          )}
        </PopoverAnchor>
        <SuggestionList {...suggestions.listProps} />
      </Popover>
    );
  };

  return (
    <div className="note-details-token-field">
      {items.map((item, index) =>
        editingIndex === index ? (
          renderInput(`edit-${index}`)
        ) : (
          <TokenBadge
            key={`${item}-${index}`}
            item={item}
            onEdit={() => edit(index)}
            onRemove={() => {
              if (!changeItems(items.filter((_, at) => at !== index))) return;
              if (editingIndex !== null && index < editingIndex) setEditingIndex(editingIndex - 1);
              inputRef.current?.focus();
            }}
          />
        ),
      )}
      {editingIndex === null ? renderInput("add") : null}
    </div>
  );
};
