import type { KeyboardEvent } from "react";

const propertyRows = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>("[data-property-key]"));

const caretAt = (element: HTMLElement, edge: "start" | "end") => {
  if (!(element instanceof HTMLInputElement) || element.selectionStart === null || element.selectionEnd === null) {
    return true;
  }
  const position = edge === "start" ? 0 : element.value.length;
  return element.selectionStart === position && element.selectionEnd === position;
};

const focusKey = (row: HTMLElement) => {
  const input = row.querySelector<HTMLInputElement>("[data-note-details-key]");
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
};

export const focusPropertyRow = (root: HTMLElement, edge: "first" | "last") => {
  const rows = propertyRows(root);
  rows[edge === "first" ? 0 : rows.length - 1]?.focus();
};

/** Handles the row-level keys shared by every Note Details field type. */
export const handlePropertyRowKeyDown = ({
  addButton,
  disclosure,
  event,
  onReturnToEditor,
  root,
}: {
  addButton: HTMLElement | null;
  disclosure: HTMLElement | null;
  event: KeyboardEvent<HTMLElement>;
  onReturnToEditor?: () => void;
  root: HTMLElement;
}) => {
  const target = event.target as HTMLElement;
  const row = target.closest<HTMLElement>("[data-property-key]");
  if (!row) return false;

  if (event.key === "Escape") {
    // Text editors must restore/cancel their draft before moving focus (and firing blur).
    if (target.matches("input:not([type='checkbox']):not([type='radio']), textarea")) return false;
    if (target !== row && target.getAttribute("aria-expanded") === "true") return false;
    event.preventDefault();
    event.stopPropagation();
    if (target !== row) row.focus();
    else if (onReturnToEditor) onReturnToEditor();
    else disclosure?.focus();
    return true;
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const key = row.querySelector<HTMLElement>("[data-note-details-key]");
    const value = row.querySelector<HTMLElement>("[data-note-details-primary]");
    const firstValue = row.querySelector<HTMLElement>(".note-details-token-remove, [data-note-details-primary]");
    const fromKey = target === key && event.key === "ArrowRight" && (event.altKey || caretAt(target, "end"));
    const fromValue = target === value && event.key === "ArrowLeft" && (event.altKey || caretAt(target, "start"));
    const listHasTokens =
      target.matches(".note-details-token-input:not(.note-details-token-input-editing)") &&
      row.querySelector(".note-details-token-remove");
    if (target === row || fromKey || (fromValue && !listHasTokens)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowLeft") focusKey(row);
      else firstValue?.focus();
      return true;
    }
  }

  if (target === row && event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    row.querySelector<HTMLElement>("[data-note-details-primary]")?.focus();
    return true;
  }
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
  if (!event.altKey && target !== row && target.getAttribute("aria-expanded") === "true") return false;

  event.preventDefault();
  event.stopPropagation();
  const rows = propertyRows(root);
  const index = rows.indexOf(row);
  const next = rows[index + (event.key === "ArrowUp" ? -1 : 1)];
  if (next) next.focus();
  else if (event.key === "ArrowUp") disclosure?.focus();
  else addButton?.focus();
  return true;
};
