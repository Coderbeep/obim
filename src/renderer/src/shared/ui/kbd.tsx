import { cn } from "../classNames";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-[var(--border-default)] bg-[var(--surface-2)] shadow-[var(--shadow-control)] px-1 font-sans text-ui-meta font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
