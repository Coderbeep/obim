/**
 * Value editing controls for Note Details.
 */
import { IconCalendar } from "@pierre/icons";
import { useEffect, useRef, useState } from "react";

import { parseDueDate, toDateInputValue } from "@renderer/shared/date";
import { Button } from "@renderer/shared/ui/button";
import { Calendar } from "@renderer/shared/ui/calendar";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@renderer/shared/ui/popover";
import { frontmatterValueToText, type FrontmatterProperty } from "@shared/frontmatter";

import { initialFieldValue } from "../fields/fieldTypes";
import { predefinedField } from "../fields/predefinedFields";
import { SuggestionList, useSuggestions, type SuggestionOption } from "../Suggestions";
import { filterValueSuggestions } from "../valueSuggestions";
import { ListValueEditor } from "./ListValueEditor";
import type { ApplyEdit } from "../types";

const suggestionPolicy = (
  options: readonly SuggestionOption<string>[],
  query: string,
  normalize: (value: string) => string,
) => {
  const normalizedSuggestions = options.map(({ value }) => normalize(value));
  const { visibleSuggestions } = filterValueSuggestions({
    suggestions: normalizedSuggestions,
    query: normalize(query),
  });
  const visible = new Set(visibleSuggestions);
  return options.filter(({ value }) => visible.has(normalize(value)));
};

const DATETIME_INPUT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})$/u;
const TIME_INPUT_PATTERN = /^\d{2}:\d{2}:\d{2}$/u;

const parseDatetimeInput = (text: string) => {
  if (!DATETIME_INPUT_PATTERN.test(text)) return null;
  const value = new Date(`${text}Z`);
  return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 19) === text ? value : null;
};

// Value editors ---------------------------------------------------------------

const useValueAcceptance = (commit: (value: string) => boolean, onAccepted: () => void) => {
  const accepting = useRef(false);
  const cancelling = useRef(false);
  const acceptedInput = useRef<HTMLInputElement | null>(null);
  return {
    cancel(input: HTMLInputElement, value: string, restoreDraft: (value: string) => void) {
      cancelling.current = true;
      accepting.current = false;
      input.value = value;
      restoreDraft(value);
      input.closest<HTMLElement>("[data-property-key]")?.focus();
    },
    accept(input: HTMLInputElement, value = input.value) {
      accepting.current = true;
      acceptedInput.current = input;
      input.value = value;
      input.blur();
    },
    commit(value: string) {
      if (cancelling.current) {
        cancelling.current = false;
        return;
      }
      const accepted = accepting.current;
      accepting.current = false;
      const success = commit(value);
      if (accepted && success) onAccepted();
      else if (accepted) {
        const input = acceptedInput.current;
        window.requestAnimationFrame(() => input?.focus());
      }
      acceptedInput.current = null;
    },
  };
};

const DateValueEditor = ({
  onAccepted,
  onEdit,
  property,
}: {
  onAccepted: () => void;
  onEdit: ApplyEdit;
  property: FrontmatterProperty;
}) => {
  const [open, setOpen] = useState(false);
  const initialValue = property.value.kind === "date" ? property.value.source : "";
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const calendarTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setDraft(initialValue), [initialValue]);

  const selected = property.value.kind === "date" ? parseDueDate(property.value.source) : undefined;

  const commit = (value = draft) => {
    if (value === initialValue) return true;
    const date = parseDueDate(value);
    if (!date) {
      setDraft(initialValue);
      return false;
    }
    return onEdit({
      type: "upsert",
      key: property.key,
      value: initialFieldValue("date", date),
    });
  };
  const acceptance = useValueAcceptance(commit, onAccepted);

  return (
    <span className="flex min-w-0 items-center">
      <span className="note-details-date-pill text-ui-meta inline-flex h-6 items-center overflow-hidden rounded-[var(--radius-control)] border border-transparent bg-secondary font-medium text-secondary-foreground">
        <input
          ref={inputRef}
          data-note-details-primary
          type="text"
          inputMode="numeric"
          className="note-details-date-input h-full w-[6.75rem] min-w-0 border-0 bg-transparent px-2 font-medium text-inherit tabular-nums outline-none focus-visible:bg-secondary-foreground/15 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Edit ${property.key} value`}
          autoComplete="off"
          placeholder="YYYY-MM-DD"
          spellCheck={false}
          value={draft}
          onBlur={(event) => acceptance.commit(event.currentTarget.value)}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              acceptance.accept(event.currentTarget);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              acceptance.cancel(event.currentTarget, initialValue, setDraft);
            } else if (
              event.key === "ArrowRight" &&
              event.currentTarget.selectionStart === event.currentTarget.value.length &&
              event.currentTarget.selectionEnd === event.currentTarget.value.length
            ) {
              event.preventDefault();
              calendarTriggerRef.current?.focus();
            }
          }}
        />
        <span aria-hidden="true" className="note-details-date-divider h-3.5 w-px shrink-0 bg-secondary-foreground/20" />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              ref={calendarTriggerRef}
              type="button"
              size="xsm"
              variant="ghost"
              aria-label={`Open ${property.key} calendar`}
              className="note-details-date-trigger h-full w-6 rounded-none px-0 text-inherit hover:bg-[var(--surface-hover)] hover:text-inherit focus-visible:bg-secondary-foreground/15 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0"
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft") return;
                event.preventDefault();
                const input = inputRef.current;
                input?.focus();
                input?.setSelectionRange(input.value.length, input.value.length);
              }}
            >
              <IconCalendar className="size-3!" />
            </Button>
          </PopoverTrigger>
          <PopoverContent size="auto" padding="none" align="start">
            <Calendar
              autoFocus
              required
              mode="single"
              selected={selected}
              defaultMonth={selected}
              onSelect={(date) => {
                const changed = onEdit({
                  type: "upsert",
                  key: property.key,
                  value: initialFieldValue("date", date),
                });
                if (changed) setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </span>
    </span>
  );
};

const NumberValueEditor = ({
  onAccepted,
  onEdit,
  property,
}: {
  onAccepted: () => void;
  onEdit: ApplyEdit;
  property: FrontmatterProperty;
}) => {
  const initialValue = property.value.kind === "number" ? property.value.source : "";
  const [draft, setDraft] = useState(initialValue);

  useEffect(() => setDraft(initialValue), [initialValue]);

  const commit = (text = draft) => {
    if (text === initialValue) return true;
    const value = Number(text);
    if (!text.trim() || !Number.isFinite(value)) {
      setDraft(initialValue);
      return false;
    }
    return onEdit({ type: "upsert", key: property.key, value });
  };
  const acceptance = useValueAcceptance(commit, onAccepted);

  return (
    <input
      data-note-details-primary
      type="number"
      step="any"
      className="note-details-input"
      aria-label={`Edit ${property.key} value`}
      value={draft}
      onBlur={(event) => acceptance.commit(event.currentTarget.value)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          acceptance.accept(event.currentTarget);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          acceptance.cancel(event.currentTarget, initialValue, setDraft);
        }
      }}
    />
  );
};

const BooleanValueEditor = ({
  onAccepted,
  onEdit,
  property,
}: {
  onAccepted: () => void;
  onEdit: ApplyEdit;
  property: FrontmatterProperty;
}) => (
  <input
    data-note-details-primary
    type="checkbox"
    aria-label={`Edit ${property.key} value`}
    checked={property.value.kind === "boolean" && property.value.value}
    onChange={(event) => onEdit({ type: "upsert", key: property.key, value: event.currentTarget.checked })}
    onKeyDown={(event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      onAccepted();
    }}
  />
);

const DatetimeValueEditor = ({
  onAccepted,
  onEdit,
  property,
}: {
  onAccepted: () => void;
  onEdit: ApplyEdit;
  property: FrontmatterProperty;
}) => {
  const [open, setOpen] = useState(false);
  const initialValue =
    property.value.kind === "date" && !property.value.dateOnly ? property.value.value.slice(0, 19) : "";
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const calendarTriggerRef = useRef<HTMLButtonElement>(null);
  const [pickerDate, setPickerDate] = useState<Date | undefined>(() => parseDueDate(initialValue.slice(0, 10)));
  const [pickerTime, setPickerTime] = useState(() => DATETIME_INPUT_PATTERN.exec(initialValue)?.[2] ?? "00:00:00");

  useEffect(() => setDraft(initialValue), [initialValue]);

  const commit = (text = draft) => {
    if (text === initialValue) return true;
    const value = parseDatetimeInput(text);
    if (!value) {
      setDraft(initialValue);
      return false;
    }
    return onEdit({ type: "upsert", key: property.key, value });
  };
  const acceptance = useValueAcceptance(commit, onAccepted);
  const pickerValue = pickerDate ? `${toDateInputValue(pickerDate)}T${pickerTime}` : "";
  const pickerValueIsValid = TIME_INPUT_PATTERN.test(pickerTime) && Boolean(parseDatetimeInput(pickerValue));

  const setPickerOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      const parts = DATETIME_INPUT_PATTERN.exec(draft) ?? DATETIME_INPUT_PATTERN.exec(initialValue);
      setPickerDate(parseDueDate(parts?.[1]));
      setPickerTime(parts?.[2] ?? "00:00:00");
    }
    setOpen(nextOpen);
  };

  return (
    <span className="flex min-w-0 items-center">
      <span className="note-details-date-pill text-ui-meta inline-flex h-6 items-center overflow-hidden rounded-[var(--radius-control)] border border-transparent bg-secondary font-medium text-secondary-foreground">
        <input
          ref={inputRef}
          data-note-details-primary
          type="text"
          inputMode="numeric"
          className="note-details-date-input h-full w-[11.75rem] min-w-0 border-0 bg-transparent px-2 font-medium text-inherit tabular-nums outline-none focus-visible:bg-secondary-foreground/15 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Edit ${property.key} value`}
          autoComplete="off"
          placeholder="YYYY-MM-DDTHH:mm:ss"
          spellCheck={false}
          value={draft}
          onBlur={(event) => acceptance.commit(event.currentTarget.value)}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              acceptance.accept(event.currentTarget);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              acceptance.cancel(event.currentTarget, initialValue, setDraft);
            } else if (
              event.key === "ArrowRight" &&
              event.currentTarget.selectionStart === event.currentTarget.value.length &&
              event.currentTarget.selectionEnd === event.currentTarget.value.length
            ) {
              event.preventDefault();
              calendarTriggerRef.current?.focus();
            }
          }}
        />
        <span aria-hidden="true" className="note-details-date-divider h-3.5 w-px shrink-0 bg-secondary-foreground/20" />
        <Popover open={open} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              ref={calendarTriggerRef}
              type="button"
              size="xsm"
              variant="ghost"
              aria-label={`Open ${property.key} calendar`}
              className="note-details-date-trigger h-full w-6 rounded-none px-0 text-inherit hover:bg-[var(--surface-hover)] hover:text-inherit focus-visible:bg-secondary-foreground/15 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0"
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft") return;
                event.preventDefault();
                const input = inputRef.current;
                input?.focus();
                input?.setSelectionRange(input.value.length, input.value.length);
              }}
            >
              <IconCalendar className="size-3!" />
            </Button>
          </PopoverTrigger>
          <PopoverContent size="auto" padding="none" align="start">
            <Calendar
              autoFocus
              required
              mode="single"
              selected={pickerDate}
              defaultMonth={pickerDate}
              onSelect={setPickerDate}
            />
            <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-2)] p-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-ui-meta font-medium text-muted-foreground">
                <span>Time</span>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`Edit ${property.key} time`}
                  autoComplete="off"
                  maxLength={8}
                  placeholder="HH:mm:ss"
                  spellCheck={false}
                  value={pickerTime}
                  onChange={(event) => setPickerTime(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !pickerValueIsValid) return;
                    event.preventDefault();
                    setDraft(pickerValue);
                    if (commit(pickerValue)) setOpen(false);
                  }}
                  className="h-7 w-[5.75rem] rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-1)] px-2 text-center text-ui-control font-medium text-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              </label>
              <Button
                type="button"
                size="xs"
                disabled={!pickerValueIsValid}
                aria-label="Apply date and time"
                onClick={() => {
                  setDraft(pickerValue);
                  if (commit(pickerValue)) setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </span>
    </span>
  );
};

const TextValueEditor = ({
  loadSuggestions,
  onAccepted,
  onEdit,
  property,
}: {
  loadSuggestions: (key: string) => Promise<string[]>;
  onAccepted: () => void;
  onEdit: ApplyEdit;
  property: FrontmatterProperty;
}) => {
  const initialValue = property.value.kind === "string" ? property.value.value : "";
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const predefined = predefinedField(property.key);
  const allowedValues = predefined?.allowedTextValues;
  const normalizeSuggestion = predefined?.normalizeTextValue ?? ((value: string) => value);

  const commitValue = (value: string) => {
    if (property.value.kind !== "string") return false;
    const normalized = normalizeSuggestion(value);
    if (allowedValues && !allowedValues.includes(normalized)) return false;
    return predefined?.removeWhenTextValue?.(normalized)
      ? onEdit({ type: "remove", key: property.key })
      : onEdit({ type: "upsert", key: property.key, value: normalized });
  };

  const commit = (value = draft) => {
    if (value === initialValue) return true;
    if (property.value.kind === "string") return commitValue(value);
    setDraft(initialValue);
    return false;
  };
  const acceptance = useValueAcceptance(commit, onAccepted);

  const finish = (value: string) => {
    setDraft(value);
    if (inputRef.current) acceptance.accept(inputRef.current, value);
  };

  const suggestions = useSuggestions<string>({
    query: draft,
    loadOptions: async () =>
      (allowedValues ?? (await loadSuggestions(property.key))).map((value) => ({ id: value, label: value, value })),
    filterOptions: allowedValues
      ? (options) => options
      : (options, query) => suggestionPolicy(options, query, normalizeSuggestion),
    onSelect: ({ value }) => finish(value),
    onCommitQuery: finish,
  });

  useEffect(() => setDraft(initialValue), [initialValue]);

  const input = (
    <input
      ref={inputRef}
      {...suggestions.inputProps}
      data-note-details-primary
      type="text"
      className="note-details-input"
      aria-label={`Edit ${property.key} value`}
      readOnly={Boolean(allowedValues)}
      value={draft}
      onBlur={(event) => {
        suggestions.closeSuggestions();
        acceptance.commit(event.currentTarget.value);
      }}
      onChange={(event) => {
        const value = event.currentTarget.value;
        setDraft(value);
        if (value.trim()) suggestions.refreshSuggestions(value);
        else suggestions.closeSuggestions();
      }}
      onFocus={!allowedValues ? suggestions.openSuggestions : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !suggestions.expanded) {
          event.preventDefault();
          event.stopPropagation();
          acceptance.cancel(event.currentTarget, initialValue, setDraft);
          return;
        }
        if (allowedValues && !suggestions.expanded && (event.key === "Enter" || event.key === " ")) return;
        suggestions.onInputKeyDown(event);
      }}
    />
  );

  return (
    <Popover open={suggestions.expanded} onOpenChange={suggestions.onOpenChange}>
      {allowedValues ? (
        <PopoverTrigger asChild>{input}</PopoverTrigger>
      ) : (
        <PopoverAnchor asChild>
          <span className="relative flex min-w-0 items-center">{input}</span>
        </PopoverAnchor>
      )}
      <SuggestionList {...suggestions.listProps} />
    </Popover>
  );
};

// Public editor selection -----------------------------------------------------

/**
 * Selects an editor directly from the property's parsed value type.
 */
export const ValueEditor = ({
  loadSuggestions,
  onAccepted,
  onEdit,
  property,
}: {
  loadSuggestions: (key: string) => Promise<string[]>;
  onAccepted: () => void;
  onEdit: ApplyEdit;
  property: FrontmatterProperty;
}) => {
  if (property.value.kind === "list") {
    const items = property.value.value.map(frontmatterValueToText);
    return <ListValueEditor property={property} items={items} loadSuggestions={loadSuggestions} onEdit={onEdit} />;
  }

  if (property.value.kind === "string") {
    return (
      <TextValueEditor property={property} loadSuggestions={loadSuggestions} onAccepted={onAccepted} onEdit={onEdit} />
    );
  }
  if (property.value.kind === "date") {
    return property.value.dateOnly ? (
      <DateValueEditor property={property} onAccepted={onAccepted} onEdit={onEdit} />
    ) : (
      <DatetimeValueEditor property={property} onAccepted={onAccepted} onEdit={onEdit} />
    );
  }
  if (property.value.kind === "number") {
    return <NumberValueEditor property={property} onAccepted={onAccepted} onEdit={onEdit} />;
  }
  if (property.value.kind === "boolean") {
    return <BooleanValueEditor property={property} onAccepted={onAccepted} onEdit={onEdit} />;
  }
  return null;
};
