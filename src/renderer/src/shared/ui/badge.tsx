import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../classNames";

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-[var(--radius-control)] border px-2 py-0 text-ui-meta font-medium tabular-nums transition-[background-color,border-color,color,box-shadow] [&>svg]:pointer-events-none [&>svg]:size-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-inset aria-invalid:ring-destructive",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--chip-selected)] text-foreground",
        secondary: "border-transparent bg-[var(--chip-neutral)] text-secondary-foreground",
        category: "border-transparent bg-[var(--chip-category)] text-secondary-foreground",
        selected: "border-[var(--border-selected)] bg-[var(--chip-selected)] text-foreground",
        status: "border-transparent bg-[var(--chip-status)] text-[var(--info)]",
        warning: "border-transparent bg-[var(--chip-warning)] text-[var(--warning)]",
        destructive: "border-transparent bg-[var(--chip-danger)] text-destructive",
        interactive:
          "border-transparent bg-[var(--chip-neutral)] text-secondary-foreground hover:bg-[var(--chip-neutral-hover)] active:bg-[var(--surface-pressed)] data-[state=on]:border-[var(--border-selected)] data-[state=on]:bg-[var(--chip-selected)] data-[state=on]:text-foreground",
        disabled: "border-transparent bg-[var(--chip-disabled)] text-[var(--text-disabled)]",
        outline:
          "border-[var(--border-subtle)] bg-transparent text-secondary-foreground [a&]:hover:border-[var(--border-default)] [a&]:hover:bg-[var(--surface-hover)]",
        compact:
          "border-transparent bg-[var(--chip-neutral)] px-2 py-0 text-secondary-foreground [a&]:hover:bg-[var(--chip-neutral-hover)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentPropsWithoutRef<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
