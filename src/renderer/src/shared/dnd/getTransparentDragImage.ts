/**
 * Returns the shared transparent image used to suppress native drag previews.
 *
 * @returns A reusable one-pixel canvas attached outside the viewport.
 */
export const getTransparentDragImage = () => {
  const existing = document.getElementById("obim-transparent-drag-image");
  if (existing instanceof HTMLElement) return existing;

  const element = document.createElement("canvas");
  element.id = "obim-transparent-drag-image";
  element.width = 1;
  element.height = 1;
  element.style.cssText = "position:fixed;left:-100px;top:-100px;width:1px;height:1px;pointer-events:none";
  document.body.append(element);
  return element;
};
