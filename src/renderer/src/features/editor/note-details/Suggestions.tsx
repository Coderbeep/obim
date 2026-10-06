/**
 * Feature-local async combobox controller and popup.
 *
 * Focus remains in the input; keyboard navigation uses
 * `aria-activedescendant`. Field-specific filtering stays with each caller.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type { IconComponent } from "@renderer/shared/icons/types";
import { PopoverContent } from "@renderer/shared/ui/popover";

export type SuggestionOption<Value = string> = {
  id: string;
  icon?: IconComponent;
  label: string;
  value: Value;
};

type SuggestionRow<Value> = { domId: string; option: SuggestionOption<Value> };

type SuggestionInputProps = {
  role: "combobox";
  "aria-autocomplete": "list";
  "aria-controls": string;
  "aria-expanded": boolean;
  "aria-activedescendant": string | undefined;
};

type UseSuggestionsOptions<Value> = {
  query: string;
  loadOptions: () => Promise<readonly SuggestionOption<Value>[]>;
  filterOptions?: (options: readonly SuggestionOption<Value>[], query: string) => readonly SuggestionOption<Value>[];
  onSelect: (option: SuggestionOption<Value>) => void;
  onCommitQuery: (query: string) => void;
};

type RequestState<Value> = {
  status: "idle" | "loading" | "loaded";
  options: readonly SuggestionOption<Value>[];
};

const defaultFilter = <Value,>(options: readonly SuggestionOption<Value>[], query: string) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return normalizedQuery ? options.filter(({ label }) => label.toLocaleLowerCase().includes(normalizedQuery)) : options;
};

export const useSuggestions = <Value,>({
  query,
  loadOptions,
  filterOptions = defaultFilter,
  onSelect,
  onCommitQuery,
}: UseSuggestionsOptions<Value>) => {
  const listboxId = `${useId()}-note-details-suggestions`;
  const requestSequence = useRef(0);
  const openRef = useRef(false);
  const dismissedRef = useRef(false);
  const loadOptionsRef = useRef(loadOptions);
  const requestRef = useRef<RequestState<Value>>({ status: "idle", options: [] });

  useEffect(() => {
    loadOptionsRef.current = loadOptions;
  }, [loadOptions]);

  const [open, setOpen] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const [request, setRequest] = useState<RequestState<Value>>({ status: "idle", options: [] });
  const [activeId, setActiveId] = useState<string | null>(null);

  const openSuggestions = () => {
    dismissedRef.current = false;
    if (openRef.current) return;
    openRef.current = true;
    setOpen(true);
    requestRef.current = { status: "idle", options: [] };
    setRequest(requestRef.current);
    setRequestVersion((version) => version + 1);
  };

  const refreshSuggestions = (nextQuery: string) => {
    if (dismissedRef.current || openRef.current) return;
    const currentRequest = requestRef.current;
    if (currentRequest.status === "loaded" && filterOptions(currentRequest.options, nextQuery).length === 0) return;
    openRef.current = true;
    setOpen(true);
    if (currentRequest.status === "loaded") return;
    requestRef.current = { status: "idle", options: [] };
    setRequest(requestRef.current);
    setRequestVersion((version) => version + 1);
  };

  const closeSuggestions = () => {
    openRef.current = false;
    setOpen(false);
    setActiveId(null);
  };

  const dismissSuggestions = () => {
    dismissedRef.current = true;
    closeSuggestions();
  };

  const loadedOptions = request.status === "loaded" ? request.options : null;
  const options = loadedOptions ? filterOptions(loadedOptions, query) : [];
  const rows: readonly SuggestionRow<Value>[] = options.map((option) => ({
    domId: `${listboxId}-option-${encodeURIComponent(option.id)}`,
    option,
  }));
  const activeRow = rows.find((row) => row.domId === activeId) ?? rows[0] ?? null;
  const loading = open && request.status !== "loaded";
  const expanded = open && (loading || rows.length > 0);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    if (!open) return;
    requestRef.current = { status: "loading", options: [] };
    setRequest(requestRef.current);
    void loadOptionsRef.current().then(
      (nextOptions) => {
        if (sequence === requestSequence.current) {
          requestRef.current = { status: "loaded", options: nextOptions };
          setRequest(requestRef.current);
        }
      },
      () => {
        if (sequence === requestSequence.current) {
          requestRef.current = { status: "loaded", options: [] };
          setRequest(requestRef.current);
        }
      },
    );
  }, [open, requestVersion]);

  const chooseRow = (row: SuggestionRow<Value>) => {
    closeSuggestions();
    onSelect(row.option);
  };

  const moveActive = (key: "ArrowDown" | "ArrowUp" | "Home" | "End") => {
    if (!rows.length) return;
    if (key === "Home" || key === "End") {
      setActiveId(rows[key === "Home" ? 0 : rows.length - 1]!.domId);
      return;
    }
    const currentIndex = activeRow ? rows.indexOf(activeRow) : -1;
    const direction = key === "ArrowDown" ? 1 : -1;
    setActiveId(rows[(currentIndex + direction + rows.length) % rows.length]!.domId);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      ((event.key === "Home" || event.key === "End") && expanded)
    ) {
      event.preventDefault();
      if (expanded) moveActive(event.key);
      else openSuggestions();
      return true;
    }

    if (event.key === "Enter") {
      if (event.nativeEvent.isComposing) return false;
      if (loading) {
        event.preventDefault();
        return true;
      }
      if (activeRow && expanded) {
        event.preventDefault();
        chooseRow(activeRow);
        return true;
      }
      event.preventDefault();
      closeSuggestions();
      onCommitQuery(query);
      return true;
    }

    if (event.key !== "Escape") return false;
    event.preventDefault();
    event.stopPropagation();
    dismissSuggestions();
    return true;
  };

  const inputProps: SuggestionInputProps = {
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-controls": listboxId,
    "aria-expanded": expanded,
    "aria-activedescendant": expanded ? activeRow?.domId : undefined,
  };

  return {
    closeSuggestions,
    expanded,
    inputProps,
    listProps: {
      activeId: activeRow?.domId ?? null,
      id: listboxId,
      loading,
      onActiveChange: setActiveId,
      onChoose: chooseRow,
      rows,
    },
    onInputKeyDown,
    onOpenChange: (nextOpen: boolean) => (nextOpen ? refreshSuggestions(query) : closeSuggestions()),
    openSuggestions,
    refreshSuggestions,
  };
};

type SuggestionListProps<Value> = {
  activeId: string | null;
  id: string;
  loading: boolean;
  onActiveChange: (id: string) => void;
  onChoose: (row: SuggestionRow<Value>) => void;
  rows: readonly SuggestionRow<Value>[];
};

export const SuggestionList = <Value,>({
  activeId,
  id,
  loading,
  onActiveChange,
  onChoose,
  rows,
}: SuggestionListProps<Value>) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeOption = activeId ? document.getElementById(activeId) : null;
    if (activeOption && listRef.current?.contains(activeOption)) {
      activeOption.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeId]);

  if (!loading && !rows.length) return null;

  return (
    <PopoverContent
      ref={listRef}
      id={id}
      role="listbox"
      align="start"
      size="auto"
      padding="none"
      className="max-h-[min(15rem,var(--radix-popover-content-available-height))] w-max min-w-[8rem] max-w-[min(20rem,calc(100vw-1rem))] overflow-x-hidden overflow-y-auto rounded-md p-1"
      onOpenAutoFocus={(event) => event.preventDefault()}
    >
      {loading ? (
        <div role="option" aria-disabled="true" className="px-2 py-1.5 text-ui-meta text-muted-foreground">
          Loading suggestions…
        </div>
      ) : (
        rows.map((row) => {
          const active = activeId === row.domId;
          const Icon = row.option.icon;
          return (
            <button
              key={row.option.id}
              id={row.domId}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={active}
              data-active={active || undefined}
              className="flex w-full min-w-0 items-center rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-popover-foreground hover:bg-[var(--surface-hover)] data-[active=true]:bg-[var(--surface-pressed)] data-[active=true]:text-[var(--text-primary)]"
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => onActiveChange(row.domId)}
              onClick={() => onChoose(row)}
            >
              {Icon ? <Icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
              <span className="min-w-0 flex-1 truncate text-ui-item" title={row.option.label}>
                {row.option.label}
              </span>
            </button>
          );
        })
      )}
    </PopoverContent>
  );
};
