import "./TaskBoard.css";
import {
  IconBraces,
  IconCalendar,
  IconCheck,
  IconCheckCircle,
  IconChevron,
  IconClockArrow,
  IconFlag,
  IconParagraph,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSortDown,
  IconSortUp,
  IconTag,
  IconTrash,
  IconX,
} from "@pierre/icons";
import { useEffect, useRef, useState } from "react";
import { Button } from "@renderer/shared/ui/button";
import { Input } from "@renderer/shared/ui/input";
import { focusListboxOption } from "@renderer/shared/ui/menu-navigation";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/shared/ui/popover";
import type { TaskBoardSort, TaskBoardSortDirection, TaskBoardSortRule } from "./taskBoardModel";

export type TaskProperty = Exclude<TaskBoardSort, "custom"> | "status" | "yaml";

export const TASK_PROPERTY_OPTIONS: ReadonlyArray<{ key: TaskProperty; label: string }> = [
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "due", label: "Due date" },
  { key: "created", label: "Created" },
  { key: "modified", label: "Modified" },
  { key: "tag", label: "First Tag" },
];

export const taskPropertyIcon = (property: TaskProperty) => {
  const Icon = {
    title: IconParagraph,
    status: IconCheckCircle,
    priority: IconFlag,
    due: IconCalendar,
    created: IconClockArrow,
    modified: IconPencil,
    tag: IconTag,
    yaml: IconBraces,
  }[property];
  return <Icon size={14} aria-hidden="true" />;
};

export const TaskPropertyPicker = ({
  ariaLabel,
  onSelect,
  options,
  optionsLabel,
  placeholder,
  selected,
  showSearchIcon = false,
  emptyLabel = "No matching properties",
}: {
  ariaLabel: string;
  emptyLabel?: string;
  onSelect: (property: TaskProperty) => void;
  options: ReadonlyArray<{ key: TaskProperty; label: string }>;
  optionsLabel?: string;
  placeholder: string;
  selected?: TaskProperty;
  showSearchIcon?: boolean;
}) => {
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const visibleOptions = options.filter(({ label }) =>
    label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <div className="menu-search">
        {showSearchIcon ? <IconSearch size={14} aria-hidden="true" className="task-property-search-icon" /> : null}
        <Input
          autoFocus
          className={showSearchIcon ? "task-property-search-input" : undefined}
          value={search}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            focusListboxOption(listRef.current, event.key === "ArrowDown" ? "first" : "last");
          }}
        />
      </div>
      <div
        ref={listRef}
        className="menu-list task-tag-selector-list"
        role="listbox"
        aria-label={optionsLabel ?? `${ariaLabel} options`}
      >
        {visibleOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            role="option"
            aria-selected={option.key === selected}
            className="menu-option task-tag-selector-option"
            data-selected={option.key === selected ? "true" : "false"}
            onClick={() => onSelect(option.key)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              focusListboxOption(listRef.current, event.key === "ArrowDown" ? "next" : "previous", event.currentTarget);
            }}
          >
            {taskPropertyIcon(option.key)}
            <span>{option.label}</span>
            {option.key === selected ? (
              <IconCheck size={14} aria-hidden="true" className="task-tag-selector-check" />
            ) : null}
          </button>
        ))}
        {!visibleOptions.length ? <div className="menu-empty">{emptyLabel}</div> : null}
      </div>
    </>
  );
};

const SORT_FIELDS = TASK_PROPERTY_OPTIONS.filter(({ key }) => key !== "status");
const DEFAULT_DIRECTION: Record<TaskBoardSortRule["field"], TaskBoardSortDirection> = {
  due: "ascending",
  created: "descending",
  modified: "descending",
  title: "ascending",
  tag: "ascending",
  priority: "ascending",
};
const labelFor = (field: TaskBoardSortRule["field"]) => SORT_FIELDS.find(({ key }) => key === field)?.label ?? field;
const directionLabel = (field: TaskBoardSortRule["field"], direction: TaskBoardSortDirection) => {
  if (field === "title" || field === "tag") return direction === "ascending" ? "A to Z" : "Z to A";
  if (field === "priority") return direction === "ascending" ? "High first" : "Low first";
  if (field === "due") return direction === "ascending" ? "Earliest first" : "Latest first";
  return direction === "ascending" ? "Oldest first" : "Newest first";
};

export const TaskBoardSortSelector = ({
  rules,
  onChange,
}: {
  rules: readonly TaskBoardSortRule[];
  onChange: (rules: TaskBoardSortRule[]) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [fieldIndex, setFieldIndex] = useState<number | "add" | null>(null);
  const [directionIndex, setDirectionIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const fieldRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const summary = rules.map(({ field }) => labelFor(field)).join(", ");
  useEffect(() => {
    if (open && rules.length) fieldRefs.current[Math.min(focusIndex, rules.length - 1)]?.focus();
  }, [open, rules.length, focusIndex]);
  const updateRule = (index: number, rule: TaskBoardSortRule) =>
    onChange(rules.map((current, at) => (at === index ? rule : current)));
  const optionsFor = (index: number | "add") =>
    SORT_FIELDS.filter(({ key }) => !rules.some((rule, at) => rule.field === key && at !== index));
  const propertyPicker = (index: number | "add") => (
    <TaskPropertyPicker
      ariaLabel="Search sort options"
      optionsLabel="Sort options"
      emptyLabel="No matching sort options"
      placeholder="Sort by..."
      selected={index === "add" ? undefined : rules[index]?.field}
      options={optionsFor(index)}
      onSelect={(field) => {
        const next = {
          field: field as TaskBoardSortRule["field"],
          direction: DEFAULT_DIRECTION[field as TaskBoardSortRule["field"]],
        };
        const targetIndex = index === "add" ? rules.length : index;
        if (index === "add") onChange([...rules, next]);
        else updateRule(index, next);
        setFocusIndex(targetIndex);
        setFieldIndex(null);
      }}
    />
  );
  const moveRule = (index: number, offset: number) => {
    const next = [...rules];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setFieldIndex(null);
        setDirectionIndex(null);
        if (nextOpen) setFocusIndex(0);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="task-board-sort-trigger"
          data-sorted={rules.length ? "true" : "false"}
          aria-label={summary ? `Sort by: ${summary}` : "Sort by"}
          title={summary ? `Sort by: ${summary}` : "Sort by"}
        >
          <IconSortDown size={14} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        size="auto"
        padding="none"
        className="task-board-sort-popover"
        aria-label="Sort selector"
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {!rules.length ? (
          propertyPicker("add")
        ) : (
          <>
            <div className="task-board-sort-rules" role="group" aria-label="Sort rules">
              {rules.map((rule, index) => (
                <div key={rule.field} className="task-board-sort-rule-wrap">
                  <div className="task-board-sort-rule" role="group" aria-label={`Sort rule ${index + 1}`}>
                    <Popover
                      open={fieldIndex === index}
                      onOpenChange={(nextOpen) => {
                        setFieldIndex(nextOpen ? index : null);
                        if (nextOpen) setDirectionIndex(null);
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          ref={(node) => {
                            fieldRefs.current[index] = node;
                          }}
                          type="button"
                          variant="outline"
                          size="xs"
                          className="task-board-sort-rule-field"
                          aria-label={`Sort field ${index + 1}: ${labelFor(rule.field)}`}
                        >
                          {taskPropertyIcon(rule.field)} <span>{labelFor(rule.field)}</span>
                          <IconChevron size={12} aria-hidden="true" className="task-board-sort-rule-chevron" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="bottom"
                        align="start"
                        sideOffset={6}
                        size="auto"
                        padding="none"
                        className="task-board-sort-submenu"
                        aria-label={`Choose sort field ${index + 1}`}
                        onEscapeKeyDown={(event) => event.stopPropagation()}
                      >
                        {propertyPicker(index)}
                      </PopoverContent>
                    </Popover>
                    <Popover
                      open={directionIndex === index}
                      onOpenChange={(nextOpen) => {
                        setDirectionIndex(nextOpen ? index : null);
                        if (nextOpen) setFieldIndex(null);
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          className="task-board-sort-rule-order"
                          aria-label={`Sort order ${index + 1}: ${directionLabel(rule.field, rule.direction)}`}
                        >
                          {rule.direction === "ascending" ? (
                            <IconSortUp size={14} aria-hidden="true" />
                          ) : (
                            <IconSortDown size={14} aria-hidden="true" />
                          )}
                          <span>{directionLabel(rule.field, rule.direction)}</span>
                          <IconChevron size={12} aria-hidden="true" className="task-board-sort-rule-chevron" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="bottom"
                        align="start"
                        sideOffset={6}
                        size="auto"
                        padding="none"
                        className="task-board-sort-submenu task-board-sort-direction"
                        aria-label={`Sort direction ${index + 1}`}
                        onEscapeKeyDown={(event) => event.stopPropagation()}
                      >
                        <div role="group" aria-label={`Sort direction ${index + 1}`}>
                          {(["ascending", "descending"] as const).map((direction) => (
                            <Button
                              key={direction}
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="menu-option task-board-sort-direction-option"
                              aria-pressed={rule.direction === direction}
                              autoFocus={rule.direction === direction}
                              onClick={() => {
                                updateRule(index, { ...rule, direction });
                                setDirectionIndex(null);
                              }}
                            >
                              {direction === "ascending" ? (
                                <IconSortUp size={14} aria-hidden="true" />
                              ) : (
                                <IconSortDown size={14} aria-hidden="true" />
                              )}
                              {directionLabel(rule.field, direction)}
                              {rule.direction === direction ? (
                                <IconCheck size={14} aria-hidden="true" className="task-board-sort-direction-check" />
                              ) : null}
                            </Button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="task-board-sort-rule-remove"
                      aria-label={`Remove sort rule ${index + 1}`}
                      onClick={() => {
                        onChange(rules.filter((_, at) => at !== index));
                        setFieldIndex(null);
                        setDirectionIndex(null);
                      }}
                    >
                      <IconX size={14} aria-hidden="true" />
                    </Button>
                  </div>
                  {rules.length > 1 ? (
                    <div className="task-board-sort-move">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={index === 0}
                        onClick={() => moveRule(index, -1)}
                        aria-label={`Move sort rule ${index + 1} up`}
                      >
                        Move up
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={index === rules.length - 1}
                        onClick={() => moveRule(index, 1)}
                        aria-label={`Move sort rule ${index + 1} down`}
                      >
                        Move down
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {rules.length < SORT_FIELDS.length ? (
              <Popover
                open={fieldIndex === "add"}
                onOpenChange={(nextOpen) => {
                  setFieldIndex(nextOpen ? "add" : null);
                  if (nextOpen) setDirectionIndex(null);
                }}
              >
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="xs" className="task-board-sort-back">
                    <IconPlus size={14} aria-hidden="true" /> Add sort
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  align="start"
                  sideOffset={6}
                  size="auto"
                  padding="none"
                  className="task-board-sort-submenu"
                  aria-label="Add sort property"
                  onEscapeKeyDown={(event) => event.stopPropagation()}
                >
                  {propertyPicker("add")}
                </PopoverContent>
              </Popover>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="task-board-sort-clear"
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
            >
              <IconTrash size={14} aria-hidden="true" /> Clear sorts
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
