import { IconSearch, IconX } from "@pierre/icons";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "./button";
import { Input } from "./input";

export const CompactToolbarSearch = ({
  clearLabel,
  label,
  onValueChange,
  placeholder,
  value,
}: {
  clearLabel: string;
  label: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  value: string;
}) => {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const isExpanded = expanded || Boolean(value);

  useEffect(() => {
    if (expanded) inputRef.current?.focus({ preventScroll: true });
  }, [expanded]);

  return (
    <div
      className="compact-toolbar-search"
      data-expanded={isExpanded ? "true" : "false"}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node) && !value.trim()) setExpanded(false);
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        className="compact-toolbar-search-trigger"
        aria-label={label}
        aria-controls={inputId}
        aria-expanded={isExpanded}
        title={label}
        onClick={() => {
          if (isExpanded) inputRef.current?.focus();
          else setExpanded(true);
        }}
      >
        <IconSearch size={14} aria-hidden="true" />
      </Button>
      <Input
        ref={inputRef}
        id={inputId}
        className="compact-toolbar-search-input"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onValueChange("");
          setExpanded(false);
          triggerRef.current?.focus();
        }}
        placeholder={placeholder}
        aria-label={label}
        aria-hidden={!isExpanded}
        disabled={!isExpanded}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="compact-toolbar-search-clear"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
          aria-label={clearLabel}
          title="Clear search"
        >
          <IconX size={13} aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
};
