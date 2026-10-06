import { NOTE_ICON_MARKUP } from "./noteIconMarkup";
import { cn } from "@renderer/shared/classNames";
import type { CustomIconProps } from "./types";

export const IconTask = ({ size = 16, className, ...props }: CustomIconProps) => (
  <svg
    data-icon="task"
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    className={cn("text-muted-foreground", className)}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.25}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
    dangerouslySetInnerHTML={{ __html: NOTE_ICON_MARKUP["task"] }}
  />
);
