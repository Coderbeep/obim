type MainProcessConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

type MainProcessConsole = Pick<Console, MainProcessConsoleMethod>;
type MainProcessOutputStream = {
  on(event: "error", listener: (error: Error) => void): unknown;
};

const GUARDED_CONSOLE = Symbol.for("obim.main-process-console-guarded");
const guardedStreams = new WeakSet<object>();
const consoleMethods: readonly MainProcessConsoleMethod[] = ["debug", "error", "info", "log", "warn"];

export const guardMainProcessLogMethod = (method: (...data: unknown[]) => void) =>
  function guardedMainProcessLog(...data: unknown[]) {
    try {
      method(...data);
    } catch {
      // Logging is diagnostic. A detached terminal must never become an application failure.
    }
  };

export const installMainProcessLoggingGuards = ({
  targetConsole = console,
  outputStreams = [process.stdout, process.stderr],
}: {
  targetConsole?: MainProcessConsole;
  outputStreams?: readonly (MainProcessOutputStream | null | undefined)[];
} = {}) => {
  const guardedConsole = targetConsole as MainProcessConsole & { [GUARDED_CONSOLE]?: boolean };
  if (!guardedConsole[GUARDED_CONSOLE]) {
    for (const methodName of consoleMethods) {
      const method = guardedConsole[methodName].bind(guardedConsole) as (...data: unknown[]) => void;
      guardedConsole[methodName] = guardMainProcessLogMethod(method) as MainProcessConsole[typeof methodName];
    }
    Object.defineProperty(guardedConsole, GUARDED_CONSOLE, { value: true });
  }

  for (const stream of outputStreams) {
    if (!stream || guardedStreams.has(stream)) continue;
    guardedStreams.add(stream);
    stream.on("error", () => {
      // Console writes can fail asynchronously as well as throw synchronously.
    });
  }
};
