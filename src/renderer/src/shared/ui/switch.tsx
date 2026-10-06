import type { ComponentProps } from "react";
import { cn } from "../classNames";
import "./switch.css";

/** The application switch, shared by production Settings and the design board. */
export function Switch({ className, ...props }: Omit<ComponentProps<"button">, "children">) {
  return (
    <button {...props} type="button" role="switch" className={cn("ui-switch", className)}>
      <span aria-hidden="true" />
    </button>
  );
}
