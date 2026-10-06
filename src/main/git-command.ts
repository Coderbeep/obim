import { spawn } from "node:child_process";
import { devNull } from "node:os";
const GIT_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const GIT_TIMEOUT_MS = 10_000;

export class GitProcessError extends Error {
  constructor(
    message: string,
    readonly exitCode?: number | null,
    readonly processCode?: string,
    readonly reason: "exit" | "output-limit" | "spawn" | "timeout" = "exit",
  ) {
    super(message);
  }
}

export class GitExecutionPolicyError extends GitProcessError {}

export interface RunGitOptions {
  signal?: AbortSignal;
  input?: Buffer;
  isolateUserConfig?: boolean;
  outputLimitBytes?: number;
  timeoutMs?: number;
}

const spawnGit = (cwd: string, args: string[], options: RunGitOptions = {}): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new GitProcessError("Git synchronization was cancelled."));
      return;
    }
    const environment = { ...process.env };
    for (const variable of [
      "GIT_CONFIG",
      "GIT_CONFIG_PARAMETERS",
      "GIT_EXTERNAL_DIFF",
      "GIT_DIFF_OPTS",
      "GIT_SSH",
      "GIT_SSH_COMMAND",
      "GIT_SSH_VARIANT",
      "GIT_PROXY_COMMAND",
      "GIT_EXEC_PATH",
      "GIT_TEMPLATE_DIR",
      "GIT_GLOB_PATHSPECS",
      "GIT_NOGLOB_PATHSPECS",
      "GIT_LITERAL_PATHSPECS",
      "GIT_ICASE_PATHSPECS",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_COMMON_DIR",
      "GIT_DIR",
      "GIT_GRAFT_FILE",
      "GIT_INDEX_FILE",
      "GIT_NAMESPACE",
      "GIT_OBJECT_DIRECTORY",
      "GIT_REPLACE_REF_BASE",
      "GIT_WORK_TREE",
    ]) {
      delete environment[variable];
    }
    for (const variable of Object.keys(environment)) {
      if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(variable)) delete environment[variable];
    }
    environment.GIT_CONFIG_COUNT = "0";
    if (options.isolateUserConfig) {
      environment.GIT_CONFIG_GLOBAL = devNull;
      environment.GIT_CONFIG_NOSYSTEM = "1";
    }
    const child = spawn(
      "git",
      [
        "--literal-pathspecs",
        "-c",
        "color.ui=false",
        "-c",
        "core.fsmonitor=false",
        "-c",
        `core.hooksPath=${devNull}`,
        "-c",
        "maintenance.auto=false",
        ...args,
      ],
      {
        cwd,
        detached: process.platform !== "win32",
        env: {
          ...environment,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_PAGER: "cat",
          GIT_EDITOR: "false",
          GIT_SEQUENCE_EDITOR: "false",
          GIT_ATTR_NOSYSTEM: "1",
          GIT_NO_LAZY_FETCH: "1",
          GIT_TERMINAL_PROMPT: "0",
          LANG: "C",
          LC_ALL: "C",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let forceStopTimer: NodeJS.Timeout | undefined;
    let stoppedError: GitProcessError | undefined;
    const stopProcess = (error: GitProcessError) => {
      if (stoppedError) return;
      stoppedError = error;
      clearTimeout(timer);
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
        forceStopTimer = setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }, 250);
        forceStopTimer.unref();
      }
    };
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const outputLimitBytes = options.outputLimitBytes ?? GIT_OUTPUT_LIMIT_BYTES;
    const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceStopTimer);
      options.signal?.removeEventListener("abort", abort);
      callback();
    };
    const append = (chunks: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > outputLimitBytes) {
        stopProcess(
          new GitProcessError(
            "Git command output exceeded the application limit.",
            undefined,
            undefined,
            "output-limit",
          ),
        );
        return;
      }
      chunks.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
    child.on("error", (error: NodeJS.ErrnoException) =>
      finish(() => reject(new GitProcessError(error.message, undefined, error.code, "spawn"))),
    );
    child.on("close", (exitCode) => {
      finish(() => {
        if (stoppedError) {
          reject(stoppedError);
          return;
        }
        if (exitCode === 0) {
          resolve(Buffer.concat(stdout));
          return;
        }
        reject(new GitProcessError(Buffer.concat(stderr).toString("utf8").trim(), exitCode));
      });
    });
    child.stdin.end(options.input);

    const timer = setTimeout(() => {
      stopProcess(new GitProcessError("Git command timed out.", undefined, undefined, "timeout"));
    }, timeoutMs);
    const abort = () => {
      stopProcess(new GitProcessError("Git synchronization was cancelled."));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdin.on("error", (error: Error) => {
      if (!stoppedError) finish(() => reject(new GitProcessError(error.message)));
    });
  });

// These plumbing commands do not process file contents or execute repository helpers.
const SAFE_CONFIG_READ_COMMANDS = new Set([
  "config",
  "rev-parse",
  "symbolic-ref",
  "show-ref",
  "for-each-ref",
  "rev-list",
  "ls-tree",
]);
const EXECUTABLE_CONFIG_PATTERN =
  "^(merge\\..*\\.driver|filter\\..*\\.(clean|smudge|process)|diff\\.(external|.*\\.(command|textconv))|core\\.(sshcommand|gitproxy)|remote\\..*\\.(vcs|uploadpack|receivepack)|submodule\\..*\\.update)$";

export const runGit = async (cwd: string, args: string[], options: RunGitOptions = {}): Promise<Buffer> => {
  let commandIndex = 0;
  while (args[commandIndex] === "-c") commandIndex += 2;
  const rawBlobRead =
    args[commandIndex] === "cat-file" &&
    ["blob", "-s"].includes(args[commandIndex + 1]) &&
    /^[0-9a-f]{40,64}$/u.test(args[commandIndex + 2] ?? "");
  if (!SAFE_CONFIG_READ_COMMANDS.has(args[commandIndex]) && !rawBlobRead) {
    try {
      const configured = await spawnGit(
        cwd,
        ["config", "--includes", "--null", "--show-scope", "--get-regexp", EXECUTABLE_CONFIG_PATTERN],
        { ...options, input: undefined, timeoutMs: GIT_TIMEOUT_MS, outputLimitBytes: GIT_OUTPUT_LIMIT_BYTES },
      );
      const records = configured.toString("utf8").split("\0");
      const hasExecutableConfig = records.some((_scope, index) => {
        if (index % 2 !== 0 || !records[index + 1]) return false;
        const record = records[index + 1];
        const separator = record.indexOf("\n");
        const key = record.slice(0, separator);
        const value = record.slice(separator + 1).trim();
        if (!value) return false;

        if (/^submodule\..*\.update$/u.test(key)) return value.startsWith("!");
        return true;
      });
      if (hasExecutableConfig) {
        throw new GitExecutionPolicyError(
          "This repository configures executable Git merge or file-conversion commands. Obim will not run them; remove that local Git configuration or complete this operation outside Obim.",
        );
      }
    } catch (error) {
      if (!(error instanceof GitProcessError) || error.exitCode !== 1) throw error;
    }
  }
  // Explicit network actions may use system/user credentials, never a helper supplied by this repository.
  if (["fetch", "push"].includes(args[commandIndex])) {
    try {
      const configured = await spawnGit(
        cwd,
        ["config", "--local", "--includes", "--get-regexp", "^credential(\\..*)?\\.helper$"],
        options,
      );
      if (configured.length)
        throw new GitExecutionPolicyError(
          "This repository configures an executable Git credential helper. Remove that repository configuration before connecting from Obim.",
        );
    } catch (error) {
      if (!(error instanceof GitProcessError) || error.exitCode !== 1) throw error;
    }
  }
  return spawnGit(cwd, args, options);
};
