import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../classNames";

const inputVariants = cva(
  "ui-input flex h-[var(--control-height)] w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-3)] px-2 py-1 text-ui-control text-foreground file:border-0 file:bg-transparent file:text-ui-control file:font-medium file:text-foreground hover:border-[var(--border-strong)] aria-invalid:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:bg-[var(--surface-disabled)] disabled:text-[var(--text-disabled)] disabled:opacity-100",
  {
    variants: {
      fontStyle: {
        default: "",
      },
      inset: {
        default: "",
        leadingIcon: "pl-8",
      },
    },
    defaultVariants: {
      fontStyle: "default",
      inset: "default",
    },
  },
);

export interface InputProps extends React.ComponentProps<"input">, VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, fontStyle, inset, ...props }, ref) => {
  return (
    <input
      type={type}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="none"
      className={cn(inputVariants({ fontStyle, inset }), className)}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input, inputVariants };
