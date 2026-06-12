/**
 * Agent shell tool.
 *
 * Lets an interactive `hivemind-os` (OpenAI-compatible) chat agent actually run
 * a command on this machine and read its output, instead of role-playing the
 * action. Exposed to the model as the `run_command` function tool; the chat
 * runtime's tool loop dispatches calls here.
 *
 * Execution is gated by an executable allowlist — the SAME base set the
 * scheduler skill-action route uses (`/api/scheduler/skill-action`,
 * SAFE_COMMANDS). `osascript`, `open`, `node`, `python`, etc. are intentionally
 * powerful (e.g. `osascript -e …`, `node -e …`), so this is real local
 * execution: only enable it for agents whose profile declares the
 * `skillActions` runtime capability, on machines the user controls.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Allowlisted executables. Kept identical to the scheduler skill-action
 *  route's SAFE_COMMANDS so the two execution surfaces agree on what may run. */
export const AGENT_SHELL_COMMANDS = [
  "git",
  "gh",
  "pnpm",
  "npm",
  "node",
  "python3",
  "python",
  "osascript",
  "open",
  "rg",
  "grep",
  "evo",
  "uv",
] as const;

const ALLOWED = new Set<string>(AGENT_SHELL_COMMANDS);

export function isAllowlistedCommand(command: unknown): command is string {
  return typeof command === "string" && /^[a-zA-Z0-9._-]+$/.test(command) && ALLOWED.has(command);
}

export type CommandToolResult = {
  ok: boolean;
  command: string;
  args: string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  elapsedMs: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 12_000;

function clampOutput(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated]` : value;
}

/** Run an allowlisted command. Never throws — a rejected/failed command is
 *  returned as `{ ok: false }` with stderr/error so the model can adapt. */
export async function runAgentCommand(input: {
  command?: unknown;
  args?: unknown;
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<CommandToolResult> {
  const startedAt = Date.now();
  const command = typeof input.command === "string" ? input.command.trim() : "";
  const args = Array.isArray(input.args)
    ? input.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  if (!isAllowlistedCommand(command)) {
    return {
      ok: false,
      command,
      args,
      error: `Command "${command || "(empty)"}" is not allowlisted. Allowed executables: ${AGENT_SHELL_COMMANDS.join(", ")}.`,
      elapsedMs: Date.now() - startedAt,
    };
  }
  const timeout = Math.max(500, Math.min(MAX_TIMEOUT_MS, Math.round(input.timeoutMs ?? DEFAULT_TIMEOUT_MS)));
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 2_000_000,
      cwd: input.cwd?.trim() || undefined,
      signal: input.signal,
    });
    return {
      ok: true,
      command,
      args,
      exitCode: 0,
      stdout: clampOutput(stdout),
      stderr: clampOutput(stderr),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const err = error as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown };
    return {
      ok: false,
      command,
      args,
      exitCode: typeof err?.code === "number" ? err.code : undefined,
      stdout: clampOutput(err?.stdout),
      stderr: clampOutput(err?.stderr),
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

export const RUN_COMMAND_TOOL_NAME = "run_command";

/** OpenAI function-tool definition advertised to the model. */
export function runCommandToolDefinition() {
  return {
    type: "function",
    function: {
      name: RUN_COMMAND_TOOL_NAME,
      description:
        "Run a real command on this HivemindOS machine and read its output. Use this to ACTUALLY perform a local action instead of describing or claiming it. " +
        'Examples: open an app → command "open", args ["-a", "Notes"]; run AppleScript → command "osascript", args ["-e", "tell application \\"Notes\\" to activate"]; check a repo → command "git", args ["status"]; search files → command "rg", args ["-il", "Bankr", "/path/to/dir"]. ' +
        `Only these executables are allowed: ${AGENT_SHELL_COMMANDS.join(", ")}. Anything else returns an error you must adapt to. ` +
        "There is NO shell: pipes (|), redirection, globs, and quoting are not interpreted, and you cannot smuggle a shell line through python3/node as one argument. Pass the executable plus plain args only; output is truncated automatically, so you never need | head. " +
        "Never tell the user an action succeeded unless this tool returned ok:true.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: `The executable to run. One of: ${AGENT_SHELL_COMMANDS.join(", ")}.`,
          },
          args: {
            type: "array",
            items: { type: "string" },
            description: "Arguments passed to the command, as a list of strings.",
          },
          reason: {
            type: "string",
            description: "A short human-readable label for the user, e.g. 'Open Notes'.",
          },
        },
        required: ["command"],
      },
    },
  };
}
