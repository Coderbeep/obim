import { APP_DND_CONFIG } from "./config";

const scrollDelta = (point: number, start: number, end: number) => {
  const { autoscrollMaxSpeed: max, autoscrollThreshold: edge } = APP_DND_CONFIG;
  if (point < start + edge) return -Math.ceil(((edge - Math.max(0, point - start)) / edge) * max);
  if (point > end - edge) return Math.ceil(((edge - Math.max(0, end - point)) / edge) * max);
  return 0;
};

/**
 * Scrolls eligible nested containers and the window near pointer edges.
 *
 * @param x Pointer position relative to the viewport.
 * @param y Pointer position relative to the viewport.
 */
export const autoScrollAtPoint = (x: number, y: number) => {
  if (!x && !y) return;
  const hit = document.elementFromPoint?.(x, y);
  let element = hit instanceof HTMLElement ? hit : null;
  while (element) {
    const style = getComputedStyle(element);
    const scrollX = /(auto|scroll)/.test(style.overflowX);
    const scrollY = /(auto|scroll)/.test(style.overflowY);
    if (scrollX || scrollY) {
      const rect = element.getBoundingClientRect();
      element.scrollBy({
        left: scrollX ? scrollDelta(x, rect.left, rect.right) : 0,
        top: scrollY ? scrollDelta(y, rect.top, rect.bottom) : 0,
      });
    }
    element = element.parentElement;
  }

  const root = document.scrollingElement ?? document.documentElement;
  const viewportX = root.scrollWidth > window.innerWidth ? scrollDelta(x, 0, window.innerWidth) : 0;
  const viewportY = root.scrollHeight > window.innerHeight ? scrollDelta(y, 0, window.innerHeight) : 0;
  if (viewportX || viewportY) window.scrollBy({ left: viewportX, top: viewportY });
};
