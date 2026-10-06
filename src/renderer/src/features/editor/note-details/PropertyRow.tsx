/** One locally typed frontmatter property row. */
import { IconTrash } from "@pierre/icons";
import { useRef, useState } from "react";

import { IconButton } from "@renderer/shared/ui/IconButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@renderer/shared/ui/dropdown-menu";
import { Popover, PopoverAnchor } from "@renderer/shared/ui/popover";
import type { FrontmatterProperty } from "@shared/frontmatter";
import { frontmatterFieldType, type SupportedFrontmatterFieldType } from "@shared/frontmatter-fields";
import { NOTE_TYPE_FIELD_KEY } from "@shared/note-type-templates";

import { ValueEditor } from "./editors/ValueEditor";
import { getFieldOptions, type FieldOption } from "./fields/fieldOptions";
import { fieldTypeLabel, fieldTypeOrder, fieldTypes } from "./fields/fieldTypes";
import { predefinedField } from "./fields/predefinedFields";
import { SuggestionList, useSuggestions, type SuggestionOption } from "./Suggestions";
import type { ApplyEdit } from "./types";
import { useWorkspaceFieldsLoader, useWorkspaceValuesLoader } from "./workspaceSuggestions";

export type PropertyFocusTarget = "type" | "value";

const focusRowPrimaryControl = (row: HTMLElement | null | undefined) =>
  row?.querySelector<HTMLElement>("[data-note-details-primary]")?.focus();

const fieldMenuSuggestion = (field: FieldOption): SuggestionOption<FieldOption> => ({
  id: field.key,
  icon: fieldTypes[field.type].icon,
  label: field.key,
  value: field,
});

const PropertyKey = ({
  fieldType,
  onRename,
  onValidationError,
  properties,
  property,
}: {
  fieldType: SupportedFrontmatterFieldType;
  onRename: (property: FrontmatterProperty, newKey: string, focus: PropertyFocusTarget | null) => boolean;
  onValidationError: (message: string) => void;
  properties: readonly FrontmatterProperty[];
  property: FrontmatterProperty;
}) => {
  const loadWorkspaceFields = useWorkspaceFieldsLoader();
  const [draft, setDraft] = useState(property.key);
  const [query, setQuery] = useState("");
  const [invalid, setInvalid] = useState(false);
  const cancelling = useRef(false);

  const commit = (focus: PropertyFocusTarget | null, candidate = draft.trim()) => {
    const newKey = candidate.trim();
    if (newKey === property.key) {
      setDraft(property.key);
      setQuery("");
      setInvalid(false);
      const row = document.activeElement?.closest<HTMLElement>(".note-details-row");
      if (focus === "value") focusRowPrimaryControl(row);
      else if (focus === "type") row?.querySelector<HTMLElement>("[data-note-details-type]")?.focus();
      return true;
    }
    if (!newKey || newKey === NOTE_TYPE_FIELD_KEY) {
      setInvalid(true);
      onValidationError(newKey ? "Use the note type selector to change the type field." : "Enter a field name.");
      return false;
    }
    const requiredType = predefinedField(newKey)?.requiredType;
    if (requiredType && requiredType !== fieldType) {
      setInvalid(true);
      onValidationError(`Change “${property.key}” to ${fieldTypeLabel(requiredType)} before renaming it.`);
      return false;
    }
    const renamed = onRename(property, newKey, focus);
    setInvalid(!renamed);
    if (renamed) {
      setDraft(newKey);
      setQuery("");
    }
    return renamed;
  };

  const suggestions = useSuggestions<FieldOption>({
    query,
    loadOptions: async () => {
      const workspaceFields = await loadWorkspaceFields().catch(() => []);
      return getFieldOptions({
        currentKey: property.key,
        properties,
        workspaceFields,
      }).map(fieldMenuSuggestion);
    },
    onSelect: ({ value }) => commit("value", value.key),
    onCommitQuery: () => commit("value"),
  });

  return (
    <Popover open={suggestions.expanded} onOpenChange={suggestions.onOpenChange}>
      <PopoverAnchor asChild>
        <input
          {...suggestions.inputProps}
          data-note-details-key
          type="text"
          className="note-details-key-input note-details-property-key-input"
          aria-invalid={invalid || undefined}
          aria-label={`Edit ${property.key} field name`}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={draft}
          onFocus={() => {
            setQuery("");
            suggestions.openSuggestions();
          }}
          onClick={suggestions.openSuggestions}
          onBlur={() => {
            suggestions.closeSuggestions();
            if (cancelling.current) {
              cancelling.current = false;
              return;
            }
            if (!commit(null)) {
              setDraft(property.key);
              setInvalid(false);
            }
          }}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setDraft(value);
            setQuery(value);
            setInvalid(false);
            suggestions.refreshSuggestions(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !suggestions.expanded) {
              event.preventDefault();
              event.stopPropagation();
              cancelling.current = true;
              event.currentTarget.value = property.key;
              setDraft(property.key);
              setQuery("");
              setInvalid(false);
              event.currentTarget.closest<HTMLElement>("[data-property-key]")?.focus();
              return;
            }
            if (suggestions.onInputKeyDown(event)) return;
            if (event.key === "Tab" && draft.trim() !== property.key) {
              event.preventDefault();
              commit(event.shiftKey ? "type" : "value");
            }
          }}
        />
      </PopoverAnchor>
      <SuggestionList {...suggestions.listProps} />
    </Popover>
  );
};

export const PropertyRow = ({
  onEdit,
  onRename,
  onTypeChange,
  onValidationError,
  properties,
  property,
}: {
  onEdit: ApplyEdit;
  onRename: (property: FrontmatterProperty, newKey: string, focus: PropertyFocusTarget | null) => boolean;
  onTypeChange: (property: FrontmatterProperty, type: SupportedFrontmatterFieldType) => boolean;
  onValidationError: (message: string) => void;
  properties: readonly FrontmatterProperty[];
  property: FrontmatterProperty;
}) => {
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const loadWorkspaceValues = useWorkspaceValuesLoader();
  const fieldType = frontmatterFieldType(property.value);
  if (fieldType === "unsupported") return null;

  const predefined = predefinedField(property.key);
  const typeDefinition = fieldTypes[fieldType];
  const TypeIcon = predefined?.icon ?? typeDefinition.icon;
  const requiredType = predefined?.requiredType;

  return (
    <div
      ref={rowRef}
      className="note-details-row"
      data-property-key={property.key}
      tabIndex={-1}
      aria-label={`${property.key} field`}
    >
      <dt className="note-details-key" title={`${property.key} · ${typeDefinition.label}`}>
        <DropdownMenu modal={false} open={typeMenuOpen} onOpenChange={setTypeMenuOpen}>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={TypeIcon}
              label={`Open ${property.key} field menu`}
              title={requiredType ? `${property.key} is a built-in ${fieldTypeLabel(requiredType)} field` : undefined}
              className="note-details-field-icon note-details-type-trigger focus-visible:ring-0 focus-visible:ring-offset-0"
              data-note-details-type
              onContextMenu={(event) => {
                event.preventDefault();
                setTypeMenuOpen(true);
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <TypeIcon />
                Field type
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={fieldType}
                  onValueChange={(value) => {
                    if (onTypeChange(property, value as SupportedFrontmatterFieldType)) setTypeMenuOpen(false);
                  }}
                >
                  {fieldTypeOrder.map((candidate) => {
                    const option = fieldTypes[candidate];
                    const OptionIcon = option.icon;
                    const disabled = candidate === fieldType || (Boolean(requiredType) && requiredType !== candidate);
                    return (
                      <DropdownMenuRadioItem key={candidate} value={candidate} disabled={disabled}>
                        <OptionIcon />
                        {option.label}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={() => onEdit({ type: "remove", key: property.key })}
            >
              <IconTrash />
              Delete field
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PropertyKey
          key={property.key}
          fieldType={fieldType}
          onRename={onRename}
          onValidationError={onValidationError}
          properties={properties}
          property={property}
        />
      </dt>
      <dd className="note-details-value">
        <div className="note-details-value-editor">
          <ValueEditor
            property={property}
            loadSuggestions={loadWorkspaceValues}
            onEdit={onEdit}
            onAccepted={() => rowRef.current?.focus()}
          />
        </div>
      </dd>
    </div>
  );
};
