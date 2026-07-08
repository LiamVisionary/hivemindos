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
import { chatPermissionModeAllowsUnlistedCommands, normalizeChatPermissionMode } from "@/lib/types/chat-permissions";
import type { ChatPermissionMode } from "@/lib/types/chat-permissions";

const execFileAsync = promisify(execFile);

/** Allowlisted executables. The scheduler skill-action route imports this same
 *  list so the two execution surfaces agree on what may run. */
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
  "find",
  "ls",
  "cat",
  "pwd",
  "head",
  "tail",
  "wc",
  "stat",
  "file",
  "du",
  "df",
  "sort",
  "uniq",
  "cut",
  "jq",
  "date",
  "whoami",
  "uname",
  "hostname",
  "ps",
  "lsof",
  "which",
  "curl",
  "nc",
  "evo",
  "uv",
] as const;

const ALLOWED = new Set<string>(AGENT_SHELL_COMMANDS);

export function isAllowlistedCommand(command: unknown): command is string {
  return typeof command === "string" && /^[a-zA-Z0-9._-]+$/.test(command) && ALLOWED.has(command);
}

export function isExecutableCommandToken(command: unknown): command is string {
  return typeof command === "string"
    && command.trim() === command
    && command.length > 0
    && command.length <= 240
    && !command.startsWith("-")
    && !command.includes("..")
    && /^[a-zA-Z0-9._/-]+$/.test(command);
}

export type CommandToolResult = {
  ok: boolean;
  command: string;
  args: string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  blockedByPolicy?: boolean;
  permissionMode?: ChatPermissionMode;
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
  permissionMode?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<CommandToolResult> {
  const startedAt = Date.now();
  const command = typeof input.command === "string" ? input.command.trim() : "";
  const args = Array.isArray(input.args)
    ? input.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  const permissionMode = normalizeChatPermissionMode(input.permissionMode);
  const allowUnlisted = chatPermissionModeAllowsUnlistedCommands(permissionMode);
  if (!isAllowlistedCommand(command) && (!allowUnlisted || !isExecutableCommandToken(command))) {
    const bypassHint = allowUnlisted
      ? " The command name is not a valid executable token even with Bypass permissions enabled."
      : " Switch the chat composer to Bypass permissions or approve this command to run it once.";
    return {
      ok: false,
      command,
      args,
      error: `Command "${command || "(empty)"}" is not allowlisted. Allowed executables: ${AGENT_SHELL_COMMANDS.join(", ")}.${bypassHint}`,
      blockedByPolicy: true,
      permissionMode,
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
      permissionMode,
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
      permissionMode,
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
        'Examples: open an app → command "open", args ["-a", "Notes"]; run AppleScript → command "osascript", args ["-e", "tell application \\"Notes\\" to activate"]; check a repo → command "git", args ["status"]; search files → command "rg", args ["-il", "Bankr", "/path/to/dir"]; inspect files → command "ls", args ["-la", "/path/to/dir"]; check a TCP port → command "nc", args ["-vz", "127.0.0.1", "11414"]. ' +
        `Only these executables run without extra permission: ${AGENT_SHELL_COMMANDS.join(", ")}. Anything else asks the user for command permission unless the chat is in Bypass permissions mode. ` +
        "There is NO shell: pipes (|), redirection, globs, and quoting are not interpreted; do not pass shell fragments like 2>/dev/null, and do not smuggle a shell line through python3/node as one argument. Pass the executable plus plain args only; output is truncated automatically, so you never need | head. " +
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
