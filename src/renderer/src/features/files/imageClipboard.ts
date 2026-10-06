import type { FileOperationResult } from "@shared/file-operations";

export async function copyRenderedImage(image: HTMLImageElement): Promise<FileOperationResult> {
  if (typeof window.api?.copyImageAt !== "function") {
    return copyImageWithoutNativeBridge(image);
  }
  // Wait for the application menu to unmount and paint before Chromium hit-tests the image.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (!image.isConnected || !image.complete || !image.naturalWidth) {
    return { success: false, error: "The image is no longer available. Reopen its menu and try again." };
  }
  const bounds = image.getBoundingClientRect();
  const left = Math.max(0, bounds.left);
  const right = Math.min(window.innerWidth, bounds.right);
  const top = Math.max(0, bounds.top);
  const bottom = Math.min(window.innerHeight, bounds.bottom);
  const x = Math.floor((left + right) / 2);
  const y = Math.floor((top + bottom) / 2);
  if (right <= left || bottom <= top || document.elementFromPoint(x, y) !== image) {
    return { success: false, error: "The image must be visible to copy it. Reopen its menu and try again." };
  }
  return window.api.copyImageAt(x, y);
}

async function copyImageWithoutNativeBridge(image: HTMLImageElement): Promise<FileOperationResult> {
  if (!image.isConnected || !image.complete || !image.naturalWidth) {
    return { success: false, error: "The image is no longer available. Reopen its menu and try again." };
  }
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("Clipboard unavailable");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion unavailable");
    context.drawImage(image, 0, 0);
    const png = new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Image conversion failed"))), "image/png");
    });
    // Start the clipboard write within the user's action; encoding can finish asynchronously.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return { success: true };
  } catch {
    // A renderer hot reload cannot update Electron's already-loaded preload bridge.
    // Cross-origin images may also prevent the browser-only fallback from reading pixels.
    return {
      success: false,
      error: "Restart Obim to finish enabling Copy image, then try again. Reloading the window alone is not enough.",
    };
  }
}
