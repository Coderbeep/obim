import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { installMainProcessLoggingGuards } from "../src/main/main-process-logging";

const consoleStub = (warn: (...data: unknown[]) => void) =>
  ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn,
  }) as Pick<Console, "debug" | "error" | "info" | "log" | "warn">;

describe("main-process logging guards", () => {
  it("does not let a synchronous EIO console write crash the application", () => {
    const writeError = Object.assign(new Error("write EIO"), { code: "EIO" });
    const unsafeWarn = vi.fn(() => {
      throw writeError;
    });
    const targetConsole = consoleStub(unsafeWarn);

    installMainProcessLoggingGuards({ targetConsole, outputStreams: [] });

    expect(() => targetConsole.warn("Could not index file", writeError)).not.toThrow();
    expect(unsafeWarn).toHaveBeenCalledWith("Could not index file", writeError);
  });

  it("handles asynchronous output-stream errors and installs each guard once", () => {
    const stream = new EventEmitter();
    const targetConsole = consoleStub(vi.fn());

    installMainProcessLoggingGuards({ targetConsole, outputStreams: [stream] });
    const guardedWarn = targetConsole.warn;
    installMainProcessLoggingGuards({ targetConsole, outputStreams: [stream] });

    expect(targetConsole.warn).toBe(guardedWarn);
    expect(stream.listenerCount("error")).toBe(1);
    expect(() => stream.emit("error", Object.assign(new Error("write EIO"), { code: "EIO" }))).not.toThrow();
  });
});
