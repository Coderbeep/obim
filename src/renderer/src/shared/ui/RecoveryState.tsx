import { IconCiWarning, IconReload } from "@pierre/icons";

import { cn } from "../classNames";
import { Button } from "./button";

interface RecoveryStateProps {
  actionLabel?: string;
  className?: string;
  compact?: boolean;
  description: string;
  onAction?: () => void;
  title: string;
}

export const RecoveryState = ({
  actionLabel = "Try again",
  className,
  compact = false,
  description,
  onAction,
  title,
}: RecoveryStateProps) => (
  <div
    className={cn(
      "flex min-w-0 items-start gap-3 border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-foreground",
      compact ? "m-2 p-3" : "mx-auto w-full max-w-[30rem] rounded-[var(--radius-card)] p-5",
      className,
    )}
    role="alert"
  >
    <IconCiWarning className="mt-0.5 flex-none text-[var(--status-warning)]" size={17} aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <div className="text-ui-body font-semibold">{title}</div>
      <p className="mt-1 break-words text-ui-control leading-relaxed text-muted-foreground">{description}</p>
      {onAction ? (
        <Button type="button" variant="outline" className="mt-3" onClick={onAction}>
          <IconReload size={14} />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  </div>
);
