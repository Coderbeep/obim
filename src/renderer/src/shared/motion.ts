/** Read the CSS token so exit lifetimes follow the theme and reduced-motion preference. */
export const motionDurationMs = (token: "panel" | "fade-out", element: Element = document.documentElement): number => {
  const value = getComputedStyle(element).getPropertyValue(`--motion-${token}-duration`).trim();
  const duration = Number.parseFloat(value);
  if (!Number.isFinite(duration)) return 0;
  return value.endsWith("ms") ? duration : duration * 1000;
};
