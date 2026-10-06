import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { IconComponent } from "@renderer/shared/icons/types";
import { cn } from "../classNames";
import { Button } from "./button";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconComponent;
  iconClassName?: string;
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, iconClassName, label, disabled, className, title, ...buttonProps }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={title ?? label}
      className={cn("ui-icon-button", className)}
      disabled={disabled}
      {...buttonProps}
    >
      <Icon aria-hidden="true" size={16} className={iconClassName} />
    </Button>
  ),
);
IconButton.displayName = "IconButton";
