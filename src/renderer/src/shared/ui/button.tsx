import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../classNames";

const buttonVariants = cva(
  "ui-button inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-ui-control font-semibold disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-[var(--text-disabled)] disabled:opacity-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "ui-button-filled shadow-[var(--shadow-control)] bg-primary text-primary-foreground hover:bg-[var(--accent-hover)] active:bg-[color-mix(in_oklch,var(--accent-hover)_88%,var(--text-primary))] disabled:bg-[var(--surface-disabled)]",
        destructive:
          "ui-button-filled shadow-[var(--shadow-control)] bg-destructive text-destructive-foreground hover:bg-[color-mix(in_oklch,var(--danger)_88%,var(--text-primary))] active:bg-[color-mix(in_oklch,var(--danger)_80%,var(--text-primary))] disabled:bg-[var(--surface-disabled)]",
        outline:
          "border border-[var(--border-default)] bg-[var(--surface-3)] text-foreground hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-pressed)] disabled:border-[var(--border-subtle)] disabled:bg-[var(--surface-disabled)]",
        secondary:
          "bg-[var(--chip-neutral)] text-secondary-foreground hover:bg-[var(--chip-neutral-hover)] active:bg-[var(--surface-pressed)] disabled:bg-[var(--surface-disabled)]",
        ghost:
          "border-none bg-transparent p-0 text-muted-foreground shadow-none transition-colors hover:bg-[var(--surface-hover)] hover:text-foreground active:bg-[var(--surface-pressed)] active:text-foreground",
        "ghost-destructive":
          "text-destructive hover:bg-[var(--chip-danger)] hover:text-destructive active:bg-[color-mix(in_oklch,var(--danger)_20%,transparent)]",
        link: "text-primary underline-offset-4 hover:underline",
        badgelike:
          "rounded-md border border-transparent bg-[var(--chip-neutral)] px-2 py-0 text-secondary-foreground hover:bg-[var(--chip-neutral-hover)] active:bg-[var(--surface-pressed)] data-[state=open]:border-[var(--border-selected)] data-[state=open]:bg-[var(--chip-selected)]",
      },
      size: {
        default: "h-[var(--control-height)] px-3",
        sm: "h-[var(--control-height)] px-3",
        xs: "h-7 px-2",
        xsm: "h-5 px-2",
        lg: "h-[var(--control-height-large)] px-4",
        icon: "size-[var(--control-height)]",
        "icon-sm": "size-[var(--control-height-compact)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "xs",
    },
    compoundVariants: [
      {
        variant: "ghost",
        size: ["icon", "icon-sm"],
        className: "bg-transparent",
      },
    ],
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
