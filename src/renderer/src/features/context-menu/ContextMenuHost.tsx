import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useLayoutEffect, useRef } from "react";

import type { ContextMenuAction } from "@renderer/shared/contextMenu";
import { closeContextMenuAtom, contextMenuRequestAtom } from "@renderer/store/contextMenuStore";

import { ContextMenuItems } from "./ContextMenuItems";

const VIEWPORT_PADDING = 8;

/**
 * Renders the currently requested application context menu.
 *
 * The host keeps the menu within the viewport, closes it when the user clicks
 * outside or presses Escape, and runs the selected entry before closing.
 * Render one instance near the root of the application.
 */
export const ContextMenuHost = ({ id = "context-menu" }: { id?: string }) => {
  const request = useAtomValue(contextMenuRequestAtom);
  const close = useSetAtom(closeContextMenuAtom);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!request) return undefined;
    menuRef.current?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || (request.toggleOnRepeat && request.anchor?.contains(target))) return;
      close();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [close, request]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!request || !menu) return undefined;

    const positionMenu = () => {
      const { height, width } = menu.getBoundingClientRect();
      const requestedLeft = request.position.alignX === "right" ? request.position.x - width : request.position.x;
      const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
      const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);

      menu.style.left = `${Math.min(Math.max(VIEWPORT_PADDING, requestedLeft), maxLeft)}px`;
      menu.style.top = `${Math.min(Math.max(VIEWPORT_PADDING, request.position.y), maxTop)}px`;
      menu.style.visibility = "visible";
    };

    positionMenu();
    window.addEventListener("resize", positionMenu);
    return () => window.removeEventListener("resize", positionMenu);
  }, [request]);

  if (!request) return null;

  const run = (entry: ContextMenuAction) => {
    close();
    void entry.onSelect();
  };

  return (
    <div
      id={id}
      ref={menuRef}
      tabIndex={0}
      role="menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
      className="menu-surface fixed z-[60] w-max max-w-[min(20rem,calc(100vw-1rem))] overflow-x-hidden overflow-y-auto p-1 text-ui-control focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      style={{
        left: request.position.x,
        maxHeight: `calc(100vh - ${VIEWPORT_PADDING * 2}px)`,
        top: request.position.y,
        visibility: "hidden",
      }}
    >
      <ContextMenuItems entries={request.entries} run={run} />
    </div>
  );
};
