/**
 * Resolves an insertion index in a vertical sequence.
 *
 * @param items Ordered item elements.
 * @param pointerY Pointer position relative to the viewport.
 * @returns The first index whose midpoint is after the pointer, or the sequence length.
 */
export const getVerticalInsertIndex = (items: readonly HTMLElement[], pointerY: number) => {
  const index = items.findIndex((item) => {
    const bounds = item.getBoundingClientRect();
    return pointerY < bounds.top + bounds.height / 2;
  });
  return index < 0 ? items.length : index;
};

/**
 * Resolves an insertion index in a horizontal sequence.
 *
 * @param items Ordered item elements.
 * @param pointerX Pointer position relative to the viewport.
 * @returns The first index whose midpoint is after the pointer, or the sequence length.
 */
export const getHorizontalInsertIndex = (items: readonly HTMLElement[], pointerX: number) => {
  const index = items.findIndex((item) => {
    const bounds = item.getBoundingClientRect();
    return pointerX < bounds.left + bounds.width / 2;
  });
  return index < 0 ? items.length : index;
};
