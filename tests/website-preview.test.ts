import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../src/main/public-resource", () => ({ readPublicResource: mocks.read }));
import { cancelWebsitePreview, getWebsitePreview, requestWebsitePreview } from "../src/main/website-preview";
const intent = { userInitiated: true as const, requestId: "test-preview" };
beforeEach(() => vi.resetAllMocks());
it("requires explicit per-link intent before reading any resource", async () => {
  expect(await getWebsitePreview("https://example.com")).toBeNull();
  expect(await getWebsitePreview("https://example.com", { requestId: "a", userInitiated: false })).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("fetches HTML and thumbnail through the same bounded public-resource reader", async () => {
  mocks.read.mockResolvedValueOnce({
    bytes: Buffer.from('<meta property="og:image" content="/a.png?x=1&amp;y=2">'),
    contentType: "text/html",
    url: "https://example.com/page",
  });
  mocks.read.mockResolvedValueOnce({
    bytes: Buffer.from("image"),
    contentType: "image/png",
    url: "https://example.com/a.png",
  });
  expect(await getWebsitePreview("https://example.com/page", intent)).toEqual({
    imageDataUrl: "data:image/png;base64,aW1hZ2U=",
    url: "https://example.com/page",
  });
  expect(mocks.read.mock.calls[0][1].maxBytes).toBe(256 * 1024);
  expect(mocks.read.mock.calls[1][0]).toBe("https://example.com/a.png?x=1&y=2");
  expect(mocks.read.mock.calls[1][1].maxBytes).toBe(2 * 1024 * 1024);
});
it("never returns a remote URL or active SVG to render on failure", async () => {
  mocks.read.mockResolvedValueOnce({
    bytes: Buffer.from('<meta property="og:image" content="http://127.0.0.1/private">'),
    contentType: "text/html",
    url: "https://example.com",
  });
  mocks.read.mockRejectedValueOnce(new Error("private destination"));
  mocks.read.mockResolvedValueOnce({
    bytes: Buffer.from("<svg/>"),
    contentType: "image/svg+xml",
    url: "https://example.com/favicon.ico",
  });
  expect(await getWebsitePreview("https://example.com", intent)).toBeNull();
});
it("cancels only the owning sender request and clears it after failure", async () => {
  let signal!: AbortSignal;
  mocks.read.mockImplementation((_url, opts) => {
    signal = opts.signal;
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
    );
  });
  const pending = requestWebsitePreview(7, "https://example.com?private=token", intent);
  expect(await requestWebsitePreview(7, "https://example.com", intent)).toBeNull();
  cancelWebsitePreview(8, intent.requestId);
  expect(signal.aborted).toBe(false);
  cancelWebsitePreview(7, intent.requestId);
  expect(signal.aborted).toBe(true);
  expect(await pending).toBeNull();
  mocks.read.mockRejectedValueOnce(new Error("offline"));
  expect(await requestWebsitePreview(7, "https://example.com", intent)).toBeNull();
});
