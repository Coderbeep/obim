type Direction = "first" | "last" | "next" | "previous";

export const focusListboxOption = (list: HTMLElement | null, direction: Direction, current?: HTMLElement) => {
  const items = Array.from(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
  if (!items.length) return;
  if (direction === "first") items[0]?.focus();
  else if (direction === "last") items.at(-1)?.focus();
  else {
    const index = current ? items.indexOf(current) : -1;
    items[(index + (direction === "next" ? 1 : -1) + items.length) % items.length]?.focus();
  }
};
