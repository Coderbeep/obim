import { IconParagraph, IconX } from "@pierre/icons";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@renderer/shared/ui/IconButton";
import { Popover, PopoverAnchor } from "@renderer/shared/ui/popover";
import type { FrontmatterProperty } from "@shared/frontmatter";
import { NOTE_TYPE_FIELD_KEY } from "@shared/note-type-templates";

import { fieldTypes, initialFieldValue } from "./fields/fieldTypes";
import { getFieldOptions, normalizeFieldName, type FieldOption } from "./fields/fieldOptions";
import { predefinedField } from "./fields/predefinedFields";
import { SuggestionList, useSuggestions, type SuggestionOption } from "./Suggestions";
import { useWorkspaceFieldsLoader } from "./workspaceSuggestions";
import type { ApplyEdit } from "./types";

const fieldSuggestion = (field: FieldOption): SuggestionOption<FieldOption> => ({
  id: field.key,
  icon: fieldTypes[field.type].icon,
  label: field.key,
  value: field,
});

export const NewPropertyForm = ({
  onAbandonEmpty,
  onCancel,
  onEdit,
  onAdded,
  onValidationError,
  properties,
}: {
  onAbandonEmpty: (nextTarget: EventTarget | null) => void;
  onCancel: () => void;
  onEdit: ApplyEdit;
  onAdded: (key: string) => void;
  onValidationError: (message: string) => void;
  properties: readonly FrontmatterProperty[];
}) => {
  const loadWorkspaceFields = useWorkspaceFieldsLoader();
  const keyRef = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState("");

  useEffect(() => {
    keyRef.current?.focus();
    const frame = window.requestAnimationFrame(() => keyRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const addField = (field: FieldOption | string) => {
    const fieldKey = typeof field === "string" ? field : field.key;
    const fieldType = typeof field === "string" ? null : field.type;
    const type = predefinedField(fieldKey)?.requiredType ?? fieldType ?? "text";
    if (onEdit({ type: "insert", key: fieldKey, value: initialFieldValue(type) })) {
      onAdded(fieldKey);
    }
  };

  const submitCandidate = () => {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      onValidationError("Enter a field name.");
      keyRef.current?.focus();
      return;
    }
    if (
      properties.some(({ key: currentKey }) => normalizeFieldName(currentKey) === normalizeFieldName(normalizedKey))
    ) {
      onValidationError(`Field “${normalizedKey}” already exists.`);
      keyRef.current?.focus();
      return;
    }
    if (normalizedKey === NOTE_TYPE_FIELD_KEY) {
      onValidationError("Use the note type selector to change the type field.");
      keyRef.current?.focus();
      return;
    }
    addField(normalizedKey);
  };

  const suggestions = useSuggestions<FieldOption>({
    query: key,
    loadOptions: async () => {
      const workspaceFields = await loadWorkspaceFields().catch(() => []);
      return getFieldOptions({ properties, workspaceFields }).map(fieldSuggestion);
    },
    onSelect: ({ value }) => addField(value),
    onCommitQuery: submitCandidate,
  });

  return (
    <form
      className="note-details-row note-details-add-row"
      aria-label="Add note field"
      onBlur={(event) => {
        if (!key.trim() && !event.currentTarget.contains(event.relatedTarget)) onAbandonEmpty(event.relatedTarget);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        submitCandidate();
      }}
    >
      <div className="note-details-key">
        <IconButton
          icon={IconParagraph}
          label="New fields use an observed workspace type or Text"
          disabled
          className="note-details-field-icon"
        />
        <Popover open={suggestions.expanded} onOpenChange={suggestions.onOpenChange}>
          <PopoverAnchor asChild>
            <input
              {...suggestions.inputProps}
              ref={keyRef}
              type="text"
              className="note-details-key-input note-details-property-key-input"
              aria-label="New field name"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Field name"
              value={key}
              onFocus={suggestions.openSuggestions}
              onClick={suggestions.openSuggestions}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setKey(value);
                suggestions.refreshSuggestions(value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.nativeEvent.isComposing) {
                  event.preventDefault();
                  return;
                }
                suggestions.onInputKeyDown(event);
              }}
            />
          </PopoverAnchor>
          <SuggestionList {...suggestions.listProps} />
        </Popover>
      </div>
      <div className="note-details-new-value">
        <span className="note-details-empty-value">Press Enter to add</span>
        <IconButton icon={IconX} label="Cancel adding field" onClick={onCancel} />
      </div>
    </form>
  );
};
