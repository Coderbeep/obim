/**
 * Top-level Note Details editor.
 *
 * This component coordinates child controls, source-edit errors, and focus.
 * Parsing and source mutation stay at the NoteHeaderExtension boundary.
 */
import { IconChevron, IconCode, IconPlus } from "@pierre/icons";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@renderer/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/shared/ui/dialog";
import { type FrontmatterEdit, type FrontmatterProperty } from "@shared/frontmatter";
import { frontmatterFieldType, type SupportedFrontmatterFieldType } from "@shared/frontmatter-fields";

import { NewPropertyForm } from "./NewPropertyForm";
import { NoteDetailsSummary } from "./NoteDetailsSummary";
import { PropertyRow } from "./PropertyRow";
import type { PropertyFocusTarget } from "./PropertyRow";
import { focusPropertyRow, handlePropertyRowKeyDown } from "./keyboardNavigation";
import type { ApplyEdit } from "./types";
import { predefinedField } from "./fields/predefinedFields";
import { convertFieldValue } from "./fields/fieldTypeConversions";
import { fieldTypeLabel, initialFieldValue } from "./fields/fieldTypes";
import { normalizeFieldName } from "./fields/fieldOptions";

type NoteDetailsEditorProps = {
  editingYaml?: boolean;
  hasFrontmatter?: boolean;
  onEdit: (edit: FrontmatterEdit) => string | null;
  onEditYaml?: () => void;
  onReturnToEditor?: () => void;
  onUndo?: () => void;
  properties: readonly FrontmatterProperty[];
};

const primaryControl = (row: Element | null | undefined) =>
  row?.querySelector<HTMLElement>("[data-note-details-primary]") ?? null;

type PendingTypeChange = {
  from: SupportedFrontmatterFieldType;
  key: string;
  to: SupportedFrontmatterFieldType;
};

const ConfirmTypeChangeDialog = ({
  applyEdit,
  onClose,
  pendingTypeChange,
}: {
  applyEdit: ApplyEdit;
  onClose: () => void;
  pendingTypeChange: PendingTypeChange | null;
}) =>
  pendingTypeChange ? (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <DialogTitle>
            Change {pendingTypeChange.key} to {fieldTypeLabel(pendingTypeChange.to)}?
          </DialogTitle>
          <DialogDescription>
            Changing “{pendingTypeChange.key}” from {fieldTypeLabel(pendingTypeChange.from)} to{" "}
            {fieldTypeLabel(pendingTypeChange.to)} will discard its current value in this note. The field will be reset
            to the default {fieldTypeLabel(pendingTypeChange.to)} value.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (
                applyEdit({
                  type: "upsert",
                  key: pendingTypeChange.key,
                  value: initialFieldValue(pendingTypeChange.to),
                })
              ) {
                onClose();
              }
            }}
          >
            Change type
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

/**
 * Renders the collapsed summary and expanded frontmatter editor.
 *
 * Child controls emit one `FrontmatterEdit`; `onEdit` returns an error message
 * or `null`, and updated parsed properties arrive through the next render.
 */
export const NoteDetailsEditor = ({
  editingYaml = false,
  hasFrontmatter = false,
  properties,
  onEdit,
  onEditYaml,
  onReturnToEditor,
  onUndo,
}: NoteDetailsEditorProps) => {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTypeChange, setPendingTypeChange] = useState<PendingTypeChange | null>(null);
  const detailsId = useId();
  const summaryId = useId();
  const errorId = useId();
  const detailsRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const visibleProperties = properties.filter((property) => !predefinedField(property.key)?.hiddenFromDetails);
  const pendingFocus = useRef<{ focus?: PropertyFocusTarget; key: string; type: "property" } | { type: "add" } | null>(
    null,
  );
  const empty = visibleProperties.length === 0;
  const detailsExpanded = expanded && !editingYaml;
  const wasEmpty = useRef(empty);

  const applyEdit: ApplyEdit = (edit) => {
    const nextError = onEdit(edit);
    setError(nextError);
    return nextError === null;
  };

  const fieldWarnings = visibleProperties.flatMap((property) => {
    const observedType = frontmatterFieldType(property.value);
    if (observedType === "unsupported") return [`${property.key}: unsupported value`];
    const requiredType = predefinedField(property.key)?.requiredType;
    if (requiredType && observedType !== requiredType) {
      return [`${property.key}: ${fieldTypeLabel(observedType)} does not match ${fieldTypeLabel(requiredType)}`];
    }
    return [];
  });

  useEffect(() => {
    if (detailsRef.current) detailsRef.current.inert = !detailsExpanded;
  }, [detailsExpanded]);

  useLayoutEffect(() => {
    if (!editingYaml) return;
    setAdding(false);
  }, [editingYaml]);

  useLayoutEffect(() => {
    const becameEmpty = !wasEmpty.current && empty;
    wasEmpty.current = empty;
    if (!becameEmpty) return;
    pendingFocus.current = null;
    setAdding(false);
    setError(null);
    setExpanded(false);
  }, [empty]);

  useEffect(() => {
    const destination = pendingFocus.current;
    if (!destination || adding) return;
    let focusTarget: HTMLElement | null = null;
    if (destination.type === "add") {
      focusTarget = addButtonRef.current;
    } else {
      const row = Array.from(detailsRef.current?.querySelectorAll<HTMLElement>("[data-property-key]") ?? []).find(
        (candidate) => candidate.dataset.propertyKey === destination.key,
      );
      if (!row) return;
      focusTarget =
        destination.focus === "type" ? row.querySelector<HTMLElement>("[data-note-details-type]") : primaryControl(row);
    }
    focusTarget?.focus();
    const frame = window.requestAnimationFrame(() => focusTarget?.focus());
    pendingFocus.current = null;
    return () => window.cancelAnimationFrame(frame);
  }, [adding, properties]);

  const cancelAdding = () => {
    pendingFocus.current = empty ? null : { type: "add" };
    setError(null);
    setAdding(false);
    if (empty) setExpanded(false);
  };

  const abandonEmptyField = (nextTarget: EventTarget | null) => {
    pendingFocus.current = null;
    setError(null);
    setAdding(false);
    const movingToDisclosure =
      nextTarget instanceof HTMLElement && nextTarget.classList.contains("note-details-disclosure");
    if (empty && !movingToDisclosure) setExpanded(false);
  };

  const finishAdding = (key: string) => {
    pendingFocus.current = { type: "property", key };
    setAdding(false);
  };

  const startAdding = () => {
    setError(null);
    setAdding(true);
  };

  const returnToEditor = () => {
    setAdding(false);
    setExpanded(false);
    onReturnToEditor?.();
  };

  const changePropertyType = (property: FrontmatterProperty, type: SupportedFrontmatterFieldType) => {
    const observedType = frontmatterFieldType(property.value);
    if (observedType === "unsupported") return false;
    if (observedType === type) return true;
    const convertedCurrentValue = convertFieldValue(property.value, type);
    if (convertedCurrentValue !== undefined) {
      return applyEdit({ type: "upsert", key: property.key, value: convertedCurrentValue });
    }
    setError(null);
    setPendingTypeChange({ from: observedType, key: property.key, to: type });
    return true;
  };

  const renameProperty = (property: FrontmatterProperty, newKey: string, focus: PropertyFocusTarget | null) => {
    const normalizedKey = newKey.trim();
    if (normalizedKey === property.key) {
      setError(null);
      return true;
    }
    if (
      properties.some(
        (candidate) =>
          candidate.key !== property.key && normalizeFieldName(candidate.key) === normalizeFieldName(normalizedKey),
      )
    ) {
      setError(`Field “${normalizedKey}” already exists.`);
      return false;
    }
    if (focus) pendingFocus.current = { type: "property", key: normalizedKey, focus };
    if (applyEdit({ type: "rename", key: property.key, newKey: normalizedKey })) {
      return true;
    }
    if (focus) pendingFocus.current = null;
    return false;
  };

  return (
    <div
      role="group"
      aria-label="Note details"
      aria-describedby={error ? errorId : undefined}
      className={`note-details${detailsExpanded ? " note-details-expanded" : ""}${empty ? " note-details-empty" : ""}`}
      onKeyDownCapture={(event) => {
        const target = event.target;
        const editableTarget = target instanceof HTMLElement ? target.closest("[contenteditable]") : null;
        const textInputOwnsHistory =
          target instanceof HTMLElement &&
          (target.matches("input:not([type='checkbox']):not([type='radio']):not([type='button']), textarea") ||
            (editableTarget?.getAttribute("contenteditable") === "true" &&
              event.currentTarget.contains(editableTarget)));
        if (textInputOwnsHistory && (event.metaKey || event.ctrlKey) && ["z", "y"].includes(event.key.toLowerCase())) {
          // Keep native field history even when there is no field-local undo entry.
          // Stop ancestor editor shortcuts without preventing the input's default action.
          event.stopPropagation();
          return;
        }
        if (
          adding &&
          event.key === "Escape" &&
          target instanceof HTMLInputElement &&
          target.closest(".note-details-add-row") &&
          !target.value &&
          target.getAttribute("aria-expanded") !== "true"
        ) {
          event.preventDefault();
          event.stopPropagation();
          returnToEditor();
          return;
        }
        if (event.key.toLowerCase() === "z" && !event.shiftKey && (event.ctrlKey || event.metaKey) && onUndo) {
          event.preventDefault();
          onUndo();
          return;
        }
        if (expanded && !adding && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          startAdding();
          return;
        }
        if (!detailsRef.current) return;
        handlePropertyRowKeyDown({
          addButton: addButtonRef.current,
          disclosure: event.currentTarget.querySelector<HTMLElement>(".note-details-disclosure"),
          event,
          onReturnToEditor: returnToEditor,
          root: detailsRef.current,
        });
      }}
    >
      <div className="note-details-toolbar">
        {!editingYaml ? (
          <button
            type="button"
            className="note-details-disclosure"
            aria-controls={detailsId}
            aria-describedby={expanded ? undefined : summaryId}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide note details" : "Show note details"}
            onClick={() => {
              if (expanded) {
                pendingFocus.current = null;
                setAdding(false);
                setError(null);
                setExpanded(false);
              } else if (empty) {
                setExpanded(true);
                startAdding();
              } else {
                setExpanded(true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                returnToEditor();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                if (expanded) {
                  if (detailsRef.current?.querySelector("[data-property-key]"))
                    focusPropertyRow(detailsRef.current, "first");
                  else addButtonRef.current?.focus();
                } else {
                  returnToEditor();
                }
              }
            }}
          >
            {!empty ? <IconChevron className="note-details-chevron" aria-hidden="true" /> : null}
            <NoteDetailsSummary
              expanded={expanded}
              id={summaryId}
              properties={visibleProperties}
              warnings={fieldWarnings}
            />
          </button>
        ) : null}
        {(expanded || editingYaml) && hasFrontmatter && onEditYaml ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="note-details-yaml-trigger h-7 gap-1.5 px-2 text-muted-foreground"
            onClick={onEditYaml}
          >
            <IconCode aria-hidden="true" className="size-3.5!" />
            {editingYaml ? "Done" : "Edit YAML"}
          </Button>
        ) : null}
      </div>

      <div ref={detailsRef} id={detailsId} className="note-details-table-shell" aria-hidden={!detailsExpanded}>
        <div className="note-details-table-clip">
          <dl className="note-details-table">
            {visibleProperties.map((property) => (
              <PropertyRow
                key={property.key}
                property={property}
                onEdit={applyEdit}
                onRename={renameProperty}
                onTypeChange={changePropertyType}
                onValidationError={setError}
                properties={properties}
              />
            ))}
          </dl>

          {adding ? (
            <NewPropertyForm
              onAbandonEmpty={abandonEmptyField}
              onCancel={cancelAdding}
              onEdit={applyEdit}
              onAdded={finishAdding}
              onValidationError={setError}
              properties={properties}
            />
          ) : null}

          {!adding ? (
            <div className="note-details-actions">
              <Button
                ref={addButtonRef}
                type="button"
                variant="ghost"
                size="xs"
                className="note-details-add-trigger"
                aria-label="Add field"
                title="Add field (Ctrl/⌘ Enter)"
                onClick={startAdding}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    returnToEditor();
                    return;
                  }
                  if (event.key !== "ArrowUp") return;
                  event.preventDefault();
                  if (detailsRef.current) focusPropertyRow(detailsRef.current, "last");
                }}
              >
                <span className="note-details-add-cell" aria-hidden="true">
                  <IconPlus />
                </span>
              </Button>
            </div>
          ) : null}

          {error ? (
            <p id={errorId} role="alert" className="note-details-error">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <ConfirmTypeChangeDialog
        applyEdit={applyEdit}
        onClose={() => setPendingTypeChange(null)}
        pendingTypeChange={pendingTypeChange}
      />
    </div>
  );
};
