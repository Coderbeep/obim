import type { ComponentProps, HTMLAttributes } from "react";
import { Separator } from "react-resizable-panels";

import { cn } from "@renderer/shared/classNames";

/**
 * Horizontal line marking an exact insertion position in a vertical list.
 *
 * @param props Standard div attributes used to position the line.
 * @returns An inert insertion marker hidden from assistive technology.
 */
export const HorizontalInsertionLine = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div aria-hidden="true" className={cn("app-dnd-horizontal-insertion-line", className)} {...props} />
);

/**
 * Vertical line marking a before/after boundary in a horizontal strip.
 * Keep mounted and toggle active to show it without moving neighboring items.
 */
export const VerticalInsertionLine = ({
  active,
  side,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { active: boolean; side: "before" | "after" }) => (
  <span
    aria-hidden="true"
    className={cn("app-dnd-vertical-insertion-line", className)}
    data-active={active || undefined}
    data-side={side}
    {...props}
  />
);

/**
 * Renders the canonical boundary used to preview a new spatial split.
 *
 * @param orientation Direction of the split boundary.
 * @param overlap Adjacent region covered without changing layout size.
 * @param props Standard div attributes used by the owning drop target.
 * @returns A split marker hidden from assistive technology.
 */
export const SplitDropIndicator = ({
  className,
  overlap,
  orientation,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  orientation: "horizontal" | "vertical";
  overlap?: "center" | "next" | "previous";
}) => (
  <div
    aria-hidden="true"
    className={cn("app-dnd-split-indicator", className)}
    data-split-overlap={overlap}
    data-split-orientation={orientation}
    {...props}
  />
);

/**
 * Interactive resize separator whose valid-drop state expands the gap for a widget split.
 * This slot changes layout; the nested SplitDropIndicator supplies decorative paint.
 */
export const WidgetSplitSlot = ({ className, ...props }: ComponentProps<typeof Separator>) => (
  <Separator
    className={cn(
      "app-dnd-widget-split-slot relative flex flex-none cursor-row-resize touch-none items-center outline-none",
      className,
    )}
    {...props}
  />
);
