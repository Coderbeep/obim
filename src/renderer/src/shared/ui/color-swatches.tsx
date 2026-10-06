import "./color-swatches.css";

export const ColorSwatches = <T extends string>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string; color: string; title?: string; empty?: boolean }[];
  value?: T;
  disabled?: boolean;
  onChange(value: T): void;
}) => (
  <div className="color-swatches" role="group" aria-label={label}>
    {options.map((option) => (
      <button
        key={option.id}
        type="button"
        className="color-swatch-option"
        disabled={disabled}
        aria-label={option.label}
        aria-pressed={value === option.id}
        title={option.title ?? option.label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onChange(option.id)}
      >
        <span
          className="color-swatch"
          data-empty={option.empty || undefined}
          aria-hidden="true"
          style={{ backgroundColor: option.color }}
        />
      </button>
    ))}
  </div>
);
