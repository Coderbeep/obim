import { afterEach, expect, it, vi } from "vitest";
import { copyRenderedImage } from "../src/renderer/src/features/files/imageClipboard";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture() {
  const image = document.createElement("img");
  image.src = "https://example.com/photo.jpg";
  Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1024 } });
  image.getBoundingClientRect = () => ({ left: 40, top: 20, right: 240, bottom: 120 }) as DOMRect;
  document.body.append(image);
  document.elementFromPoint = vi.fn(() => image);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  const copyImageAt = vi.fn().mockResolvedValue({ success: true });
  vi.stubGlobal("api", undefined);
  Object.defineProperty(window, "api", { configurable: true, value: { copyImageAt } });
  return { image, copyImageAt };
}

it("copies loaded remote image pixels with native clipboard support", async () => {
  const { image, copyImageAt } = fixture();
  expect(await copyRenderedImage(image)).toEqual({ success: true });
  expect(copyImageAt).toHaveBeenCalledWith(140, 70);
});

it("does not copy a different image when the original disappears", async () => {
  const { image, copyImageAt } = fixture();
  image.remove();
  expect((await copyRenderedImage(image)).success).toBe(false);
  expect(copyImageAt).not.toHaveBeenCalled();
});

it("does not copy when another surface covers the image", async () => {
  const { image, copyImageAt } = fixture();
  document.elementFromPoint = vi.fn(() => document.body);
  expect((await copyRenderedImage(image)).success).toBe(false);
  expect(copyImageAt).not.toHaveBeenCalled();
});

it("copies PNG pixels with the browser clipboard when an older preload lacks the native API", async () => {
  const { image } = fixture();
  Object.defineProperty(window, "api", { configurable: true, value: {} });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  const png = new Blob(["pixels"], { type: "image/png" });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(png));
  const write = vi.fn(async (items: Array<{ data: Record<string, Promise<Blob>> }>) => {
    expect(await items[0].data["image/png"]).toBe(png);
  });
  vi.stubGlobal("navigator", { clipboard: { write } });
  vi.stubGlobal(
    "ClipboardItem",
    class {
      constructor(public data: Record<string, Promise<Blob>>) {}
    },
  );
  expect(await copyRenderedImage(image)).toEqual({ success: true });
  expect(drawImage).toHaveBeenCalledWith(image, 0, 0);
  expect(write).toHaveBeenCalledOnce();
});

it("explains that a full restart is needed when the old preload and browser clipboard cannot copy", async () => {
  const { image } = fixture();
  Object.defineProperty(window, "api", { configurable: true, value: {} });
  vi.stubGlobal("ClipboardItem", undefined);
  expect(await copyRenderedImage(image)).toEqual({
    success: false,
    error: "Restart Obim to finish enabling Copy image, then try again. Reloading the window alone is not enough.",
  });
});
