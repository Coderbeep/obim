import { useMemo, useSyncExternalStore } from "react";

export const nextLocalMidnight = (now: Date) => {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next;
};
const localDayTimestamp = () => {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};
let currentDay = localDayTimestamp();
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const refresh = () => {
  const next = localDayTimestamp();
  if (next !== currentDay) {
    currentDay = next;
    listeners.forEach((listener) => listener());
  }
  if (timer !== undefined) clearTimeout(timer);
  if (listeners.size) {
    const now = new Date();
    timer = setTimeout(refresh, Math.max(1, nextLocalMidnight(now).getTime() - now.getTime()));
  }
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    window.removeEventListener("focus", refresh);
    window.removeEventListener("pageshow", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
};

const getSnapshot = () => {
  if (!listeners.size) currentDay = localDayTimestamp();
  return currentDay;
};

/** One calendar-boundary timer for all mounted date-dependent views. */
export const useLocalDay = () => {
  const timestamp = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(() => new Date(timestamp), [timestamp]);
};
