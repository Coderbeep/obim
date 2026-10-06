import { EventEmitter } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ handlers: new Map(), listeners: new Map(), removeListener: vi.fn() }));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: unknown) => mocks.handlers.set(name, handler),
    on: (name: string, handler: unknown) => mocks.listeners.set(name, handler),
    removeListener: mocks.removeListener,
  },
}));
import { matchesRendererDocument, registerTrustedRenderer, trustedIpcMain } from "../src/main/trusted-ipc";
const documentUrl = "file:///Applications/obim.app/Contents/Resources/app.asar/out/renderer/index.html";
function sender(url = documentUrl) {
  return Object.assign(new EventEmitter(), { mainFrame: { url }, isDestroyed: () => false }) as unknown as WebContents;
}
function event(contents: WebContents, frame = contents.mainFrame) {
  return { sender: contents, senderFrame: frame } as IpcMainInvokeEvent;
}
beforeEach(() => {
  mocks.handlers.clear();
  mocks.listeners.clear();
  vi.clearAllMocks();
});
it("allows only the registered main frame to invoke privileged actions", () => {
  const trusted = sender();
  registerTrustedRenderer(trusted, documentUrl);
  const action = vi.fn(() => "saved");
  trustedIpcMain.handle("save", action);
  const invoke = mocks.handlers.get("save");
  expect(invoke(event(trusted), "note.md")).toBe("saved");
  expect(action).toHaveBeenCalledTimes(1);
  expect(() => invoke(event(sender()))).toThrow("Untrusted");
  expect(() => invoke(event(trusted, { url: documentUrl } as typeof trusted.mainFrame))).toThrow("Untrusted");
  Object.assign(trusted.mainFrame, { url: "https://example.com/" });
  expect(() => invoke(event(trusted))).toThrow("Untrusted");
  Object.assign(trusted.mainFrame, { url: "media://workspace/hostile.html" });
  expect(() => invoke(event(trusted))).toThrow("Untrusted");
  expect(action).toHaveBeenCalledTimes(1);
});
it("rejects destroyed windows and cleans synchronous listeners by original callback", () => {
  const trusted = sender();
  registerTrustedRenderer(trusted, documentUrl);
  const listener = vi.fn();
  trustedIpcMain.on("settings-sync", listener);
  const blocked = { ...event(sender()), returnValue: undefined };
  mocks.listeners.get("settings-sync")(blocked);
  expect(blocked.returnValue).toBeNull();
  expect(listener).not.toHaveBeenCalled();
  mocks.listeners.get("settings-sync")(event(trusted));
  expect(listener).toHaveBeenCalledTimes(1);
  trusted.emit("destroyed");
  mocks.listeners.get("settings-sync")(event(trusted));
  expect(listener).toHaveBeenCalledTimes(1);
  trustedIpcMain.removeListener("settings-sync", listener);
  expect(mocks.removeListener).toHaveBeenCalledWith("settings-sync", mocks.listeners.get("settings-sync"));
});
it.each([
  "https://example.com",
  "file:///tmp/hostile.html",
  "media://workspace/hostile.svg",
  "data:text/html,x",
  documentUrl + "?other=1",
])("blocks navigation and redirects to %s", (url) => {
  const trusted = sender();
  registerTrustedRenderer(trusted, documentUrl);
  for (const name of ["will-navigate", "will-redirect", "will-frame-navigate"]) {
    const navigation = { url, isMainFrame: true, preventDefault: vi.fn() };
    trusted.emit(name, navigation);
    expect(navigation.preventDefault).toHaveBeenCalled();
  }
});
it("permits document fragments but rejects child frames and webviews", () => {
  const trusted = sender();
  registerTrustedRenderer(trusted, documentUrl);
  const navigation = { url: documentUrl + "#section", isMainFrame: true, preventDefault: vi.fn() };
  trusted.emit("will-frame-navigate", navigation);
  expect(navigation.preventDefault).not.toHaveBeenCalled();
  trusted.emit("will-frame-navigate", { ...navigation, isMainFrame: false });
  expect(navigation.preventDefault).toHaveBeenCalledTimes(1);
  trusted.emit("will-attach-webview", navigation);
  expect(navigation.preventDefault).toHaveBeenCalledTimes(2);
  expect(matchesRendererDocument("http://localhost:5173/", "http://localhost:5173/")).toBe(true);
  expect(matchesRendererDocument("http://localhost:5173/hostile.html", "http://localhost:5173/")).toBe(false);
});
it("routes every IPC module through the central sender boundary", () => {
  for (const file of readdirSync("src/main").filter((name) => name.endsWith(".ts") && name !== "trusted-ipc.ts")) {
    const source = readFileSync(`src/main/${file}`, "utf8");
    expect(source, file).not.toMatch(/import\s*\{[^}]*\bipcMain\b[^}]*\}\s*from\s*["']electron["']/s);
  }
});
it("ships a restrictive production CSP with no remote images or broad script execution", () => {
  const html = readFileSync("src/renderer/index.html", "utf8");
  const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)![1];
  const directives = Object.fromEntries(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
  expect(directives["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  expect(directives["img-src"]).toEqual(["'self'", "media:", "data:", "blob:"]);
  expect(directives["object-src"]).toEqual(["'none'"]);
  expect(directives["frame-src"]).toEqual(["'none'"]);
});
