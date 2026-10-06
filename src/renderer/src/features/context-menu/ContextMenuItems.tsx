import { IconChevron } from "@pierre/icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ContextMenuAction, ContextMenuEntry } from "@renderer/shared/contextMenu";
import { Kbd } from "@renderer/shared/ui/kbd";

const VIEWPORT_PADDING = 8;
const SUBMENU_OVERLAP = 2;
const SUBMENU_CLOSE_DELAY = 100;

const ContextMenuActionItem = ({
  entry,
  run,
}: {
  entry: ContextMenuAction;
  run: (entry: ContextMenuAction) => void;
}) => {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const Icon = entry.icon;
  const hasChildren = Boolean(entry.children?.length);

  const cancelScheduledClose = (): void => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openSubmenu = (): void => {
    cancelScheduledClose();
    setSubmenuOpen(true);
  };

  const scheduleSubmenuClose = (): void => {
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setSubmenuOpen(false);
    }, SUBMENU_CLOSE_DELAY);
  };

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const button = buttonRef.current;
    const submenu = submenuRef.current;
    if (!submenuOpen || !button || !submenu) return undefined;

    const positionSubmenu = () => {
      const buttonRect = button.getBoundingClientRect();
      const { height, width } = submenu.getBoundingClientRect();
      const opensRight = buttonRect.right + width <= window.innerWidth - VIEWPORT_PADDING;
      const left = opensRight ? buttonRect.right - SUBMENU_OVERLAP : buttonRect.left - width + SUBMENU_OVERLAP;
      const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);

      submenu.style.left = `${Math.min(Math.max(VIEWPORT_PADDING, left), window.innerWidth - VIEWPORT_PADDING)}px`;
      submenu.style.top = `${Math.min(Math.max(VIEWPORT_PADDING, buttonRect.top), maxTop)}px`;
      submenu.style.visibility = "visible";
    };

    positionSubmenu();
    window.addEventListener("resize", positionSubmenu);
    return () => window.removeEventListener("resize", positionSubmenu);
  }, [submenuOpen]);

  return (
    <div
      className="relative"
      onMouseEnter={hasChildren && !entry.disabled ? openSubmenu : undefined}
      onMouseLeave={hasChildren ? scheduleSubmenuClose : undefined}
    >
      <button
        ref={buttonRef}
        type="button"
        role={entry.checked === undefined ? "menuitem" : "menuitemradio"}
        aria-checked={entry.checked}
        aria-disabled={entry.disabled || undefined}
        aria-expanded={hasChildren ? submenuOpen : undefined}
        aria-haspopup={hasChildren ? "menu" : undefined}
        className="menu-option min-w-0"
        data-density="compact"
        data-danger={entry.danger ? "true" : undefined}
        onClick={
          entry.disabled
            ? undefined
            : hasChildren
              ? () => {
                  cancelScheduledClose();
                  setSubmenuOpen((open) => !open);
                }
              : () => run(entry)
        }
      >
        {Icon ? (
          <Icon className={`h-4 w-4 ${entry.danger ? "" : "text-muted-foreground"}`} />
        ) : (
          <span aria-hidden="true" className="h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-ui-control" title={entry.label}>
          {entry.label}
        </span>
        {entry.indicatorColor ? (
          <span
            aria-hidden="true"
            className="h-3 w-3 rounded-full border border-border/60"
            style={{ backgroundColor: entry.indicatorColor }}
          />
        ) : null}
        {entry.shortcut ? (
          <Kbd
            aria-hidden="true"
            className="ml-3 h-auto min-w-0 shrink-0 rounded-none border-0 bg-transparent px-0 font-mono text-[10px] font-normal leading-none text-muted-foreground shadow-none"
          >
            {entry.shortcut}
          </Kbd>
        ) : null}
        {hasChildren ? <IconChevron className="h-3.5 w-3.5 -rotate-90 text-muted-foreground" /> : null}
      </button>

      {hasChildren && submenuOpen ? (
        <div
          ref={submenuRef}
          role="menu"
          className="menu-surface fixed z-50 w-max max-w-[min(20rem,calc(100vw-1rem))] overflow-x-hidden overflow-y-auto p-1 text-ui-control"
          style={{
            maxHeight: `calc(100vh - ${VIEWPORT_PADDING * 2}px)`,
            visibility: "hidden",
          }}
          onMouseEnter={openSubmenu}
          onMouseLeave={scheduleSubmenuClose}
        >
          <ContextMenuItems entries={entry.children ?? []} run={run} />
        </div>
      ) : null}
    </div>
  );
};

/**
 * Renders a list of context-menu actions, separators, and informational messages.
 *
 * Actions with children open recursively rendered submenus. Selecting a leaf
 * action delegates execution to the parent menu through `run`.
 */
export const ContextMenuItems = ({
  entries,
  run,
}: {
  entries: ContextMenuEntry[];
  run: (entry: ContextMenuAction) => void;
}) => (
  <>
    {entries.map((entry, index) => {
      if (entry.kind === "separator") {
        return (
          <div
            key={`separator-${index}`}
            className="-mx-1 my-1 border-t border-[var(--border-subtle)]"
            role="separator"
          />
        );
      }
      if (entry.kind === "message") {
        return (
          <div key={entry.id} className="truncate px-2 py-1.5 text-ui-control text-muted-foreground" title={entry.text}>
            {entry.text}
          </div>
        );
      }
      return <ContextMenuActionItem key={entry.id} entry={entry} run={run} />;
    })}
  </>
);
