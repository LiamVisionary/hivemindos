import "server-only";

import { randomUUID } from "crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

const SIDECAR_STARTUP_TIMEOUT_MS = 90_000;
const SIDECAR_IDLE_TIMEOUT_MS = 5 * 60_000;
const MAX_PROTOCOL_BUFFER_CHARS = 12 * 1024 * 1024;

export type MarkItDownSidecarResponse = {
  markdown: string;
  converterVersion: string;
  warnings?: string[];
};

type PendingRequest = {
  resolve: (value: MarkItDownSidecarResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type ReadyResponse = {
  type?: unknown;
  ok?: unknown;
  converterVersion?: unknown;
};

type ProtocolResponse = ReadyResponse & {
  id?: unknown;
  markdown?: unknown;
  warnings?: unknown;
  error?: unknown;
};

class MarkItDownSidecarClient {
  private readonly binaries: string[];
  private readonly expectedVersion: string;
  private readonly environment: NodeJS.ProcessEnv;
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private pending = new Map<string, PendingRequest>();
  private idleTimer: NodeJS.Timeout | null = null;
  private stderr = "";

  constructor(
    binaries: string[],
    expectedVersion: string,
    environment: NodeJS.ProcessEnv,
  ) {
    this.binaries = binaries;
    this.expectedVersion = expectedVersion;
    this.environment = environment;
  }

  async warm() {
    await this.ensureStarted();
    this.scheduleIdleShutdown();
  }

  async convert(filePath: string, timeoutMs: number): Promise<MarkItDownSidecarResponse> {
    await this.ensureStarted();
    const child = this.child;
    if (!child?.stdin.writable) throw new Error("Bundled document reader stopped before conversion started.");

    this.clearIdleTimer();
    this.setStreamReferences(child, true);
    const id = randomUUID();
    return new Promise<MarkItDownSidecarResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Bundled document-reader conversion timed out after ${timeoutMs} ms.`);
        reject(error);
        this.shutdown(error);
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, path: filePath })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new Error(`Bundled document-reader request could not be sent: ${error.message}`));
        this.scheduleIdleShutdown();
      });
    });
  }

  shutdown(reason = new Error("Bundled document reader was stopped.")) {
    this.clearIdleTimer();
    const child = this.child;
    this.child = null;
    child?.kill();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }

  private async ensureStarted() {
    if (this.child && !this.child.killed) return;
    if (!this.starting) {
      this.starting = this.startFirstAvailable().finally(() => {
        this.starting = null;
      });
    }
    await this.starting;
  }

  private async startFirstAvailable() {
    let lastError = "bundled converter was not found";
    for (const binary of this.binaries) {
      try {
        await this.startCandidate(binary);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`Bundled document reader is unavailable (${lastError}). Reinstall or repair HivemindOS.`);
  }

  private startCandidate(binary: string) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let stdoutBuffer = "";
      this.stderr = "";
      const child = spawn(binary, ["--stdio"], {
        env: this.environment,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        fail(new Error(`${binary} did not become ready within ${SIDECAR_STARTUP_TIMEOUT_MS} ms.`));
      }, SIDECAR_STARTUP_TIMEOUT_MS);
      timer.unref?.();

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(error);
      };
      const abort = (error: Error) => {
        if (!settled) {
          fail(error);
          return;
        }
        if (this.child === child) this.shutdown(error);
      };

      child.stderr.on("data", (chunk) => {
        this.stderr = `${this.stderr}${String(chunk)}`.slice(-8_000);
      });
      child.on("error", (error) => fail(error));
      child.on("exit", (code, signal) => {
        const detail = this.stderr.trim();
        if (!settled) {
          fail(new Error(`${binary} exited before it was ready (${code ?? signal ?? "unknown"})${detail ? `: ${detail}` : ""}`));
          return;
        }
        if (this.child === child) this.handleExit(code, signal);
      });
      child.stdout.on("data", (chunk) => {
        stdoutBuffer += String(chunk);
        if (stdoutBuffer.length > MAX_PROTOCOL_BUFFER_CHARS) {
          abort(new Error("Bundled document reader exceeded its protocol buffer limit."));
          return;
        }
        let newline = stdoutBuffer.indexOf("\n");
        while (newline >= 0) {
          const line = stdoutBuffer.slice(0, newline);
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          if (line.trim()) {
            let response: ProtocolResponse;
            try {
              response = JSON.parse(line) as ProtocolResponse;
            } catch {
              abort(new Error("Bundled document reader returned invalid protocol JSON."));
              return;
            }
            if (!settled) {
              if (
                response.type !== "ready"
                || response.ok !== true
                || response.converterVersion !== this.expectedVersion
              ) {
                fail(new Error(`Bundled document reader has unexpected version ${String(response.converterVersion ?? "unknown")}.`));
                return;
              }
              settled = true;
              clearTimeout(timer);
              this.child = child;
              child.unref();
              this.setStreamReferences(child, false);
              resolve();
            } else {
              this.handleResponse(response);
            }
          }
          newline = stdoutBuffer.indexOf("\n");
        }
      });
    });
  }

  private handleResponse(response: ProtocolResponse) {
    if (typeof response.id !== "string") return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.ok !== true || typeof response.markdown !== "string") {
      pending.reject(new Error(typeof response.error === "string" ? response.error : "converter returned an invalid response"));
    } else {
      pending.resolve({
        markdown: response.markdown,
        converterVersion: typeof response.converterVersion === "string" ? response.converterVersion : "",
        warnings: Array.isArray(response.warnings)
          ? response.warnings.filter((warning): warning is string => typeof warning === "string")
          : [],
      });
    }
    this.scheduleIdleShutdown();
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null) {
    this.child = null;
    const detail = this.stderr.trim();
    const error = new Error(`Bundled document reader stopped (${code ?? signal ?? "unknown"})${detail ? `: ${detail}` : ""}`);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private scheduleIdleShutdown() {
    if (this.pending.size || !this.child) return;
    this.setStreamReferences(this.child, false);
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.shutdown(), SIDECAR_IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  private setStreamReferences(child: ChildProcessWithoutNullStreams, referenced: boolean) {
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      const controllable = stream as typeof stream & { ref?: () => void; unref?: () => void };
      if (referenced) controllable.ref?.();
      else controllable.unref?.();
    }
  }

  private clearIdleTimer() {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

const clientKey = Symbol.for("hivemindos.markitdown-sidecar-client");
type GlobalWithMarkItDownClient = typeof globalThis & {
  [clientKey]?: { fingerprint: string; client: MarkItDownSidecarClient };
};

function sharedClient(binaries: string[], expectedVersion: string, environment: NodeJS.ProcessEnv) {
  const state = globalThis as GlobalWithMarkItDownClient;
  const fingerprint = `${expectedVersion}\0${binaries.join("\0")}`;
  if (state[clientKey]?.fingerprint !== fingerprint) {
    state[clientKey]?.client.shutdown();
    state[clientKey] = {
      fingerprint,
      client: new MarkItDownSidecarClient(binaries, expectedVersion, environment),
    };
  }
  return state[clientKey].client;
}

export async function warmMarkItDownSidecar(
  binaries: string[],
  expectedVersion: string,
  environment: NodeJS.ProcessEnv,
) {
  await sharedClient(binaries, expectedVersion, environment).warm();
}

export async function convertWithMarkItDownSidecar(input: {
  binaries: string[];
  expectedVersion: string;
  environment: NodeJS.ProcessEnv;
  filePath: string;
  timeoutMs: number;
}) {
  return sharedClient(input.binaries, input.expectedVersion, input.environment)
    .convert(input.filePath, input.timeoutMs);
}

export function shutdownMarkItDownSidecar() {
  const state = globalThis as GlobalWithMarkItDownClient;
  state[clientKey]?.client.shutdown();
  delete state[clientKey];
}
