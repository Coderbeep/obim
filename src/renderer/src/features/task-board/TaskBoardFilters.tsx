import "./TaskBoard.css";
import {
  IconBookmark,
  IconCalendar,
  IconCheck,
  IconChevron,
  IconFilter,
  IconFlagFill,
  IconPlus,
  IconTrash,
  IconX,
} from "@pierre/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DateRange } from "react-day-picker";
import { parseDueDate, toDateInputValue } from "@renderer/shared/date";
import { Button } from "@renderer/shared/ui/button";
import { Calendar } from "@renderer/shared/ui/calendar";
import { Input } from "@renderer/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/shared/ui/popover";
import type { WorkspaceSessionTaskSavedFilter } from "@shared/workspace-session";
import {
  DUE_OPTIONS,
  FILTER_PROPERTIES,
  PRIORITY_OPTIONS,
  activeTaskFilterRows,
  clearFilterProperty,
  filterPropertyLabel,
  savedFilterSummary,
  type FilterProperty,
  type FilterOperator,
  type FilterRow,
  type FilterPatch,
  type TaskFilters,
} from "./taskBoardModel";
import { TaskPropertyPicker, taskPropertyIcon } from "./TaskBoardSortSelector";

type Picker = { id: FilterRow["id"] | "add"; part: "property" | "operator" | "value" } | null;
const toggleChoice = <T,>(values: readonly T[], value: T): T[] =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
const FilterOption = ({
  children,
  selected,
  onSelect,
  className = "menu-option",
  showCheck = true,
}: {
  children: ReactNode;
  selected?: boolean;
  onSelect: () => void;
  className?: string;
  showCheck?: boolean;
}) => (
  <button type="button" className={className} aria-pressed={selected} onClick={onSelect}>
    {children}
    {showCheck && selected ? <IconCheck size={14} aria-hidden="true" /> : null}
  </button>
);
type TaskBoardFiltersProps = {
  availableTags: readonly string[];
  availableYamlKeys: readonly string[];
  loadTags: (currentTags?: readonly string[]) => Promise<string[]>;
  onApplySavedFilter: (filter: WorkspaceSessionTaskSavedFilter) => void;
  onChange: (patch: FilterPatch) => void;
  onClear: () => void;
  onDeleteSavedFilter: (id: string) => void;
  onSaveCurrentFilter: (name: string) => void;
  filters: TaskFilters;
  savedFilters: readonly WorkspaceSessionTaskSavedFilter[];
  activeSavedFilterId: string | null;
};
export const TaskBoardFilters = ({
  availableTags,
  availableYamlKeys,
  loadTags,
  onApplySavedFilter,
  onChange,
  onClear,
  onDeleteSavedFilter,
  onSaveCurrentFilter,
  filters,
  savedFilters,
  activeSavedFilterId,
}: TaskBoardFiltersProps) => {
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [draft, setDraft] = useState<{
    origin?: FilterProperty;
    property: FilterProperty;
    operator: FilterOperator;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [yamlSearch, setYamlSearch] = useState("");
  const [tags, setTags] = useState<readonly string[]>(availableTags);
  const [rangeMode, setRangeMode] = useState(false);
  const [draftDateRange, setDraftDateRange] = useState<DateRange>();
  const [focusAfterApply, setFocusAfterApply] = useState<FilterProperty | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const selectedDueDateStart = parseDueDate(filters.dueDateFilter);
  const selectedDueDateEnd = parseDueDate(filters.dueDateEndFilter);
  const activeRows = activeTaskFilterRows(filters);
  const metadataFilterCount = activeRows.length;
  const pendingRow: FilterRow | null = draft
    ? {
        id: draft.origin ?? "draft",
        property: draft.property,
        operator: draft.operator,
        value: "Choose value",
        pending: true,
      }
    : null;
  const rows = draft?.origin
    ? activeRows.map((row) => (row.property === draft.origin ? pendingRow! : row))
    : pendingRow
      ? [...activeRows, pendingRow]
      : activeRows;
  useEffect(() => {
    if (!open || !draft || picker) return;
    contentRef.current
      ?.querySelector<HTMLElement>(`[data-filter-row-id="${draft.origin ?? "draft"}"] .task-board-filter-rule-value`)
      ?.focus();
  }, [open, draft, picker]);
  useEffect(() => {
    if (!open || !focusAfterApply) return;
    const target =
      contentRef.current?.querySelector<HTMLElement>(
        `[data-filter-row-property="${focusAfterApply}"] .task-board-filter-rule-value`,
      ) ?? contentRef.current?.querySelector<HTMLElement>(".menu-filter-action");
    target?.focus();
    setFocusAfterApply(null);
  }, [open, focusAfterApply, filters]);
  useEffect(() => {
    if (!open || picker?.part !== "value") return;
    const row = rows.find(({ id }) => id === picker.id);
    if (row?.property !== "tag") return;
    let cancelled = false;
    void loadTags(filters.tagFilters.filter((tag) => tag !== "__untagged__")).then(
      (loaded) => {
        if (!cancelled) setTags([...new Set([...availableTags, ...loaded, ...filters.tagFilters])]);
      },
      () => {
        if (!cancelled) setTags([...new Set([...availableTags, ...filters.tagFilters])]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, picker, loadTags, availableTags, filters.tagFilters]);
  const applyValue = (row: FilterRow, patch: FilterPatch) => {
    const origin = draft && row.id === (draft.origin ?? "draft") ? draft.origin : undefined;
    onChange({ ...(origin && origin !== row.property ? clearFilterProperty(origin) : {}), ...patch });
    setDraft(null);
    setPicker(null);
    setRangeMode(false);
    setFocusAfterApply(row.property);
  };
  const selectYamlKey = (row: FilterRow, key: string) =>
    applyValue(row, { yamlPropertyFilter: { key, operator: row.operator as "has" | "does not have" } });
  const pickProperty = (row: FilterRow | null, property: FilterProperty) => {
    if (row && property === row.property) {
      setPicker(null);
      return;
    }
    setDraft({
      origin: row?.id === "draft" ? undefined : row?.id,
      property,
      operator: property === "yaml" || property === "tag" ? "has" : "is",
    });
    setTagSearch("");
    setYamlSearch("");
    setPicker(null);
  };
  const pickOperator = (row: FilterRow, operator: FilterOperator) => {
    if (row.property === "yaml") {
      if (row.pending) setDraft({ origin: draft?.origin, property: "yaml", operator });
      else applyValue(row, { yamlPropertyFilter: { key: row.value, operator: operator as "has" | "does not have" } });
      setPicker(null);
      return;
    }
    if (operator === "is empty") {
      applyValue(row, row.property === "due" ? { dueFilter: "no-date" } : { tagFilters: ["__untagged__"] });
      return;
    }
    if (row.operator !== operator)
      setDraft({ origin: row.id === "draft" ? undefined : row.id, property: row.property, operator });
    setPicker(null);
  };
  const availableProperties = (current?: FilterRow) =>
    FILTER_PROPERTIES.filter(({ key }) => !activeRows.some((row) => row.property === key && row.id !== current?.id));
  const pickerOpen = (id: FilterRow["id"] | "add", part: "property" | "operator" | "value") =>
    picker?.id === id && picker.part === part;
  const setPickerOpen = (id: FilterRow["id"] | "add", part: "property" | "operator" | "value", nextOpen: boolean) => {
    setPicker(nextOpen ? { id, part } : null);
    if (nextOpen && part === "value" && rows.find((row) => row.id === id)?.property === "tag") setTagSearch("");
    if (nextOpen && part === "value" && rows.find((row) => row.id === id)?.property === "yaml") setYamlSearch("");
    if (!nextOpen) setRangeMode(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setPicker(null);
          setDraft(null);
          setSaving(false);
          setRangeMode(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="task-board-filter-trigger"
          data-filtered={activeRows.length ? "true" : "false"}
          aria-label={`Filter tasks${metadataFilterCount ? ` with ${metadataFilterCount} active filters` : ""}`}
          title="Filter tasks"
        >
          <IconFilter size={14} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        size="auto"
        padding="none"
        className="task-board-filter-popover"
        aria-label="Task filters"
        ref={contentRef}
      >
        {saving ? (
          <>
            <div className="menu-header task-board-filter-step-header">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setSaving(false)}
                aria-label="Back to filters"
              >
                <IconChevron size={15} aria-hidden="true" />
              </Button>
              <strong>Save filter</strong>
            </div>
            <form
              className="task-board-save-filter"
              onSubmit={(event) => {
                event.preventDefault();
                const name = saveName.trim();
                if (!name) return;
                onSaveCurrentFilter(name);
                setSaveName("");
                setSaving(false);
              }}
            >
              <label htmlFor="task-board-save-filter-name">Save this filter</label>
              <Input
                id="task-board-save-filter-name"
                autoFocus
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                placeholder="e.g. Weekly review"
                maxLength={60}
              />
              <Button type="submit" variant="default" size="xs" disabled={!saveName.trim()}>
                Save
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="menu-header">
              <strong>Filter tasks</strong>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={!activeRows.length && !filters.searchQuery.trim() && !draft}
                onClick={() => {
                  setDraft(null);
                  setPicker(null);
                  onClear();
                }}
              >
                Clear all
              </Button>
            </div>
            {rows.length ? (
              <div className="menu-filter-rule-list">
                {rows.map((row, index) => (
                  <div
                    key={row.id}
                    className="menu-filter-rule"
                    role="group"
                    aria-label={`Filter rule ${index + 1}`}
                    data-filter-row-id={row.id}
                    data-filter-row-property={row.property}
                  >
                    <Popover
                      open={pickerOpen(row.id, "property")}
                      onOpenChange={(next) => setPickerOpen(row.id, "property", next)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="menu-filter-rule-part task-board-filter-rule-property"
                          aria-label={`Filter property ${index + 1}: ${filterPropertyLabel(row.property)}`}
                        >
                          {taskPropertyIcon(row.property)}
                          <span>{filterPropertyLabel(row.property)}</span>
                          <IconChevron size={12} aria-hidden="true" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="bottom"
                        align="start"
                        sideOffset={4}
                        size="auto"
                        padding="none"
                        className="menu-filter-submenu task-board-filter-submenu"
                        aria-label={`Choose filter property ${index + 1}`}
                        onEscapeKeyDown={(event) => event.stopPropagation()}
                      >
                        <TaskPropertyPicker
                          ariaLabel="Search filter properties"
                          optionsLabel="Filter properties"
                          placeholder="Search properties..."
                          showSearchIcon
                          selected={row.property}
                          options={availableProperties(row)}
                          onSelect={(next) => pickProperty(row, next as FilterProperty)}
                        />
                      </PopoverContent>
                    </Popover>
                    {row.property === "due" || row.property === "tag" || row.property === "yaml" ? (
                      <Popover
                        open={pickerOpen(row.id, "operator")}
                        onOpenChange={(next) => setPickerOpen(row.id, "operator", next)}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="menu-filter-rule-part task-board-filter-rule-operator"
                            aria-label={`Filter operator ${index + 1}: ${row.operator}`}
                          >
                            <span>{row.operator}</span>
                            <IconChevron size={12} aria-hidden="true" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          side="bottom"
                          align="start"
                          sideOffset={4}
                          size="auto"
                          padding="none"
                          className="menu-filter-submenu task-board-filter-submenu task-board-filter-operator-menu"
                          aria-label={`Choose filter operator ${index + 1}`}
                          onEscapeKeyDown={(event) => event.stopPropagation()}
                        >
                          <div
                            className="menu-list menu-filter-options"
                            role="group"
                            aria-label={`${filterPropertyLabel(row.property)} operators`}
                          >
                            {(row.property === "yaml"
                              ? ["has", "does not have"]
                              : row.property === "tag"
                                ? ["has", "is empty"]
                                : ["is", "is empty"]
                            ).map((operator) => (
                              <FilterOption
                                key={operator}
                                selected={row.operator === operator}
                                onSelect={() => pickOperator(row, operator as FilterOperator)}
                              >
                                {operator[0].toUpperCase() + operator.slice(1)}
                              </FilterOption>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <span
                        className="menu-filter-rule-part task-board-filter-rule-operator menu-filter-rule-static"
                        aria-label={`Filter operator ${index + 1}: is`}
                      >
                        is
                      </span>
                    )}
                    <Popover
                      open={pickerOpen(row.id, "value")}
                      onOpenChange={(next) => setPickerOpen(row.id, "value", next)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="menu-filter-rule-part menu-filter-rule-value task-board-filter-rule-value"
                          data-pending={row.pending ? "true" : "false"}
                          aria-label={`Filter value ${index + 1}: ${row.value}`}
                        >
                          <span>{row.value}</span>
                          <IconChevron size={12} aria-hidden="true" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="bottom"
                        align="start"
                        sideOffset={4}
                        size="auto"
                        padding="none"
                        className="menu-filter-submenu task-board-filter-submenu task-board-filter-value-menu"
                        aria-label={`Choose filter value ${index + 1}`}
                        onEscapeKeyDown={(event) => event.stopPropagation()}
                      >
                        {rangeMode && row.property === "due" ? (
                          <>
                            <Calendar
                              mode="range"
                              min={0}
                              resetOnSelect
                              selected={draftDateRange}
                              defaultMonth={draftDateRange?.from ?? selectedDueDateStart}
                              onSelect={setDraftDateRange}
                            />
                            <div className="task-board-date-range-actions">
                              <Button type="button" variant="ghost" size="xs" onClick={() => setRangeMode(false)}>
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                variant="default"
                                size="xs"
                                disabled={!draftDateRange?.from || !draftDateRange.to}
                                onClick={() => {
                                  if (!draftDateRange?.from || !draftDateRange.to) return;
                                  applyValue(row, {
                                    dueDateFilter: toDateInputValue(draftDateRange.from),
                                    dueDateEndFilter: toDateInputValue(draftDateRange.to),
                                    dueFilter: "range",
                                  });
                                }}
                              >
                                Apply range
                              </Button>
                            </div>
                          </>
                        ) : row.property === "yaml" ? (
                          <div className="task-board-filter-tag-page">
                            <Input
                              autoFocus
                              value={yamlSearch}
                              aria-label="Search YAML properties"
                              placeholder="Search or enter a YAML key..."
                              maxLength={256}
                              onChange={(event) => setYamlSearch(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" || !yamlSearch.trim()) return;
                                event.preventDefault();
                                selectYamlKey(row, yamlSearch.trim());
                              }}
                            />
                            <div className="menu-list menu-filter-options" role="group" aria-label="YAML property keys">
                              {availableYamlKeys
                                .filter((key) =>
                                  key.toLocaleLowerCase().includes(yamlSearch.trim().toLocaleLowerCase()),
                                )
                                .map((key) => (
                                  <FilterOption
                                    key={key}
                                    selected={filters.yamlPropertyFilter?.key === key}
                                    onSelect={() => selectYamlKey(row, key)}
                                  >
                                    {key}
                                  </FilterOption>
                                ))}
                              {yamlSearch.trim() && !availableYamlKeys.includes(yamlSearch.trim()) ? (
                                <FilterOption onSelect={() => selectYamlKey(row, yamlSearch.trim())}>
                                  Use “{yamlSearch.trim()}”
                                </FilterOption>
                              ) : null}
                            </div>
                          </div>
                        ) : row.property === "tag" ? (
                          <div className="task-board-filter-tag-page">
                            <Input
                              autoFocus
                              value={tagSearch}
                              aria-label="Search tags"
                              placeholder="Search tags..."
                              onChange={(event) => setTagSearch(event.target.value)}
                            />
                            <div className="menu-list menu-filter-options" role="group" aria-label="Tag values">
                              {tags
                                .filter(
                                  (tag) =>
                                    tag !== "__untagged__" &&
                                    tag.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase()),
                                )
                                .map((tag) => (
                                  <FilterOption
                                    key={tag}
                                    selected={filters.tagFilters.includes(tag)}
                                    onSelect={() =>
                                      applyValue(row, {
                                        tagFilters: toggleChoice(filters.tagFilters, tag),
                                      })
                                    }
                                  >
                                    {tag}
                                  </FilterOption>
                                ))}
                              <FilterOption
                                selected={filters.tagFilters.includes("__untagged__")}
                                showCheck={false}
                                onSelect={() =>
                                  applyValue(row, {
                                    tagFilters: toggleChoice(filters.tagFilters, "__untagged__"),
                                  })
                                }
                              >
                                No tags
                              </FilterOption>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="menu-list menu-filter-options"
                            role="group"
                            aria-label={`${filterPropertyLabel(row.property)} values`}
                          >
                            {row.property === "priority"
                              ? PRIORITY_OPTIONS.map((option) => (
                                  <FilterOption
                                    key={option.value}
                                    selected={filters.priorityFilters.includes(option.value)}
                                    onSelect={() =>
                                      applyValue(row, {
                                        priorityFilters: toggleChoice(filters.priorityFilters, option.value),
                                      })
                                    }
                                  >
                                    <IconFlagFill
                                      className={`task-board-filter-priority-flag ${option.flagClassName ?? ""}`}
                                      aria-hidden="true"
                                    />
                                    {option.label}
                                  </FilterOption>
                                ))
                              : null}
                            {row.property === "due" ? (
                              <>
                                {DUE_OPTIONS.filter(({ value }) => value !== "no-date").map((option) => (
                                  <FilterOption
                                    key={option.value}
                                    selected={filters.dueFilter === option.value}
                                    onSelect={() => applyValue(row, { dueFilter: option.value })}
                                  >
                                    <IconCalendar size={14} aria-hidden="true" />
                                    {option.label}
                                  </FilterOption>
                                ))}
                                <FilterOption
                                  onSelect={() => {
                                    setDraftDateRange(
                                      selectedDueDateStart
                                        ? { from: selectedDueDateStart, to: selectedDueDateEnd }
                                        : undefined,
                                    );
                                    setRangeMode(true);
                                  }}
                                >
                                  <IconCalendar size={14} aria-hidden="true" />
                                  Custom date range...
                                </FilterOption>
                                <FilterOption
                                  className="menu-option task-board-filter-menu-divider"
                                  selected={filters.dueFilter === "no-date"}
                                  showCheck={false}
                                  onSelect={() => applyValue(row, { dueFilter: "no-date" })}
                                >
                                  <IconCalendar size={14} aria-hidden="true" />
                                  No date
                                </FilterOption>
                              </>
                            ) : null}
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="menu-filter-rule-remove"
                      onClick={() => {
                        if (row.pending) setDraft(null);
                        else onChange(clearFilterProperty(row.property));
                        setPicker(null);
                      }}
                      aria-label={`Remove ${filterPropertyLabel(row.property)} filter`}
                    >
                      <IconX size={14} aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            {activeRows.length < FILTER_PROPERTIES.length && !draft ? (
              <Popover
                open={pickerOpen("add", "property")}
                onOpenChange={(next) => setPickerOpen("add", "property", next)}
              >
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="xs" className="menu-filter-action">
                    <IconPlus size={15} aria-hidden="true" /> Add filter
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  size="auto"
                  padding="none"
                  className="menu-filter-submenu task-board-filter-submenu"
                  aria-label="Add filter property"
                  onEscapeKeyDown={(event) => event.stopPropagation()}
                >
                  <TaskPropertyPicker
                    ariaLabel="Search filter properties"
                    optionsLabel="Filter properties"
                    placeholder="Search properties..."
                    showSearchIcon
                    options={availableProperties()}
                    onSelect={(next) => pickProperty(null, next as FilterProperty)}
                  />
                </PopoverContent>
              </Popover>
            ) : null}
            {savedFilters.length ? (
              <section className="task-board-saved-filters" aria-label="Saved filters">
                {savedFilters.map((filter) => {
                  const active = filter.id === activeSavedFilterId;
                  return (
                    <div
                      key={filter.id}
                      className="task-board-saved-filter-row"
                      data-active={active ? "true" : "false"}
                    >
                      <button
                        type="button"
                        className="task-board-saved-filter-apply"
                        onClick={() => {
                          if (active) onClear();
                          else onApplySavedFilter(filter);
                          setDraft(null);
                          setPicker(null);
                          setOpen(false);
                        }}
                        aria-label={`${active ? "Clear" : "Apply"} saved filter ${filter.name}`}
                        aria-pressed={active}
                        title={`${filter.name} — ${savedFilterSummary(filter)}`}
                      >
                        <span className="task-board-saved-filter-name">
                          {active ? <IconCheck size={12} aria-hidden="true" /> : null}
                          {filter.name}
                        </span>
                        <span className="task-board-saved-filter-summary">{savedFilterSummary(filter)}</span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost-destructive"
                        size="icon-sm"
                        className="task-board-saved-filter-delete"
                        onClick={() => onDeleteSavedFilter(filter.id)}
                        aria-label={`Delete saved filter ${filter.name}`}
                      >
                        <IconTrash size={14} aria-hidden="true" />
                      </Button>
                    </div>
                  );
                })}
              </section>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="menu-filter-action task-board-filter-menu-footer"
              onClick={() => setSaving(true)}
            >
              <IconBookmark size={15} aria-hidden="true" /> Save filter...
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
