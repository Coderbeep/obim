import * as React from "react";

import { cn } from "../classNames";

type SegmentedControlItem<T extends string> = {
  value: T;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  "aria-label"?: string;
  disabled?: boolean;
  onClick?: () => void;
};

type SegmentedControlProps<T extends string> = {
  role?: "tablist" | "radiogroup";
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  value: T;
  items: SegmentedControlItem<T>[];
  onValueChange: (value: T) => void;
  "aria-label"?: string;
  className?: string;
};

export function SegmentedControl<T extends string>({
  role = "tablist",
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  value,
  items,
  onValueChange,
  "aria-label": ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const buttonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );

  return (
    <div
      className={cn("ui-segmented-control relative inline-grid rounded-md bg-[var(--switcher-track)] p-0.5", className)}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      role={role}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--switcher-selected)] transition-transform duration-200 ease-out"
        style={{
          width: `calc((100% - 4px) / ${items.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {items.map((item, index) => {
        const isActive = item.value === value;

        return (
          <button
            key={item.value}
            type="button"
            ref={(element) => {
              buttonRefs.current[index] = element;
            }}
            tabIndex={
              index ===
              (items[activeIndex]?.disabled ? items.findIndex((candidate) => !candidate.disabled) : activeIndex)
                ? 0
                : -1
            }
            onKeyDown={(event) => {
              const enabled = items
                .map((candidate, candidateIndex) => (candidate.disabled ? -1 : candidateIndex))
                .filter((candidateIndex) => candidateIndex !== -1);
              if (!enabled.length) return;
              const current = enabled.indexOf(index);
              let next: number;
              switch (event.key) {
                case "ArrowRight":
                  next = enabled[(current + 1) % enabled.length];
                  break;
                case "ArrowLeft":
                  next = enabled[(current - 1 + enabled.length) % enabled.length];
                  break;
                case "Home":
                  next = enabled[0];
                  break;
                case "End":
                  next = enabled[enabled.length - 1];
                  break;
                default:
                  return;
              }
              event.preventDefault();
              buttonRefs.current[next]?.focus();
              buttonRefs.current[next]?.click();
            }}
            role={role === "radiogroup" ? "radio" : "tab"}
            aria-selected={role === "tablist" ? isActive : undefined}
            aria-checked={role === "radiogroup" ? isActive : undefined}
            aria-label={item["aria-label"]}
            title={item.title}
            disabled={item.disabled}
            onClick={() => {
              item.onClick?.();
              onValueChange(item.value);
            }}
            className={cn(
              "relative z-10 inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-md px-2 text-ui-control font-medium text-muted-foreground transition-colors hover:bg-[var(--surface-hover)] hover:text-foreground disabled:pointer-events-none disabled:text-[var(--text-disabled)]",
              isActive && "text-foreground",
            )}
          >
            <span className="ui-segmented-marker" aria-hidden="true">{isActive ? "✓" : ""}</span>
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
