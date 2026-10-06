import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ request: mocks.request }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { isPublicAddress, readPublicResource, resolvePublicDestination } from "../src/main/public-resource";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});
it.each([
  "127.0.0.1",
  "10.1.2.3",
  "172.16.2.1",
  "192.168.1.1",
  "169.254.169.254",
  "100.64.0.1",
  "0.0.0.0",
  "224.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "::ffff:10.1.2.3",
  "fc00::1",
  "fe80::1",
  "2002:7f00:1::",
  "2001:db8::1",
])("rejects non-public address %s", (address) => expect(isPublicAddress(address)).toBe(false));
it.each([
  "https://localhost",
  "http://router",
  "http://2130706433",
  "http://0x7f000001",
  "http://[::ffff:127.0.0.1]",
  "file:///private/a",
  "ftp://example.com/a",
  "https://user:password@example.com",
])("rejects destination %s before connecting", async (url) => {
  await expect(resolvePublicDestination(url)).rejects.toThrow();
  expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects DNS responses containing any private address", async () => {
  mocks.lookup.mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  await expect(resolvePublicDestination("https://example.com")).rejects.toThrow("not public");
});
const options = () => ({ signal: new AbortController().signal, maxBytes: 32, accept: "text/html" });
function respond(statusCode: number, headers: Record<string, string>, body = "ok") {
  mocks.request.mockImplementationOnce((_url, opts, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () =>
      queueMicrotask(() => {
        const response = Object.assign(new PassThrough(), { statusCode, headers });
        callback(response);
        if (!response.destroyed) response.end(body);
      });
    opts.signal.addEventListener("abort", () => request.emit("error", new Error("aborted")), { once: true });
    return request;
  });
}
it("pins the connection to validated DNS while preserving URL/TLS identity and omitting credentials", async () => {
  respond(200, { "content-type": "text/html; charset=utf-8" });
  const result = await readPublicResource("https://example.com/path?token=secret", options());
  expect(result.bytes.toString()).toBe("ok");
  const [url, transport] = mocks.request.mock.calls[0];
  expect(url.hostname).toBe("example.com");
  const cb = vi.fn();
  transport.lookup("example.com", {}, cb);
  expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
  expect(transport.headers).toEqual({ Accept: "text/html", "User-Agent": "Obim/1.0" });
  expect(transport.agent).toBe(false);
});
it("blocks public-to-private redirects before issuing the private request", async () => {
  respond(302, { location: "http://169.254.169.254/latest/meta-data/" });
  await expect(readPublicResource("https://example.com", options())).rejects.toThrow("not public");
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("revalidates DNS after redirects and rejects rebinding", async () => {
  respond(302, { location: "/next" });
  mocks.lookup
    .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
    .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
  await expect(readPublicResource("https://example.com", options())).rejects.toThrow("not public");
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("bounds response bytes", async () => {
  respond(200, { "content-type": "text/html" }, "x".repeat(33));
  await expect(readPublicResource("https://example.com", options())).rejects.toThrow("size limit");
});
it("does not connect an already cancelled request", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    readPublicResource("https://example.com", { ...options(), signal: controller.signal }),
  ).rejects.toThrow();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("cancels promptly while DNS resolution is pending and never connects its late result", async () => {
  let resolve!: (value: { address: string; family: number }[]) => void;
  mocks.lookup.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const controller = new AbortController();
  const pending = readPublicResource("https://example.com", { ...options(), signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  resolve([{ address: "93.184.216.34", family: 4 }]);
  await Promise.resolve();
  expect(mocks.request).not.toHaveBeenCalled();
});
