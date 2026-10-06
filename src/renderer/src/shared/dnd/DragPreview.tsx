import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@renderer/shared/classNames";

type DragPreviewContentProps = {
  icon?: ReactNode;
  subtext?: ReactNode;
  text: ReactNode;
};

/** Canonical visual surface used by the provider and design graph. */
export const DragPreviewSurface = forwardRef<
  HTMLDivElement,
  Omit<HTMLAttributes<HTMLDivElement>, "children"> & DragPreviewContentProps
>(({ className, icon, subtext, text, ...props }, ref) => (
  <div ref={ref} aria-hidden="true" className={cn("app-dnd-overlay pointer-events-none", className)} {...props}>
    {icon ? <span className="app-dnd-overlay-icon">{icon}</span> : null}
    <span className="app-dnd-overlay-copy">
      <span className="app-dnd-overlay-title">{text}</span>
      {subtext ? <span className="app-dnd-overlay-subtext">{subtext}</span> : null}
    </span>
  </div>
));
DragPreviewSurface.displayName = "DragPreviewSurface";
