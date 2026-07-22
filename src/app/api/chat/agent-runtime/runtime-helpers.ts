import { execFile } from "child_process";
import { stat } from "fs/promises";
import { resolve } from "path";
import { promisify } from "util";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { agentPaymentProviderFeatures } from "@/lib/config/agent-payments";
import { recordHoneyUsage } from "@/lib/services/wallet/honey-ledger";
import { canonicalLocalCollectorUrl } from "@/lib/services/local-collector-url";
import { RUNTIME_STREAM_EVENT_TYPES } from "@/lib/services/runtime-stream-events";
import { buildVaultContext } from "@/lib/services/chat/shared-vault-context";
import { sanitizeProcessEnv } from "@/lib/utils/safe-process-env";

export type AgentMode = "plan" | "act";

export function commandSuccessText(label: string, commandLine: string) {
  const cleanLabel = label.trim();
  if (/^open\b/i.test(cleanLabel)) {
    const sentence = cleanLabel.replace(/^open\b/i, "Opened");
    return sentence.endsWith(".") ? sentence : `${sentence}.`;
  }
  if (cleanLabel && !/^run\b/i.test(cleanLabel)) {
    return cleanLabel.endsWith(".") ? cleanLabel : `${cleanLabel}.`;
  }
  return `Ran \`${commandLine}\`.`;
}

export function commandApprovalQuestion(commandLine: string) {
  return [
    "Approve this local command?",
    "",
    commandLine ? `\`${commandLine}\`` : "`(empty command)`",
    "",
    "This executable is outside the current chat permission mode's allowlist.",
  ].join("\n");
}

export function commandApprovalEvent(input: {
  command: string;
  args: string[];
  commandLine: string;
  label: string;
  error?: string;
}) {
  return {
    type: RUNTIME_STREAM_EVENT_TYPES.APPROVAL,
    id: `command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    approvalKind: "local_command",
    message: "Command permission required",
    question: commandApprovalQuestion(input.commandLine),
    command: input.command,
    args: input.args,
    commandLine: input.commandLine,
    reason: input.label,
    detail: input.error,
    status: "running",
    allowFreeText: false,
    choices: [
      {
        label: "Approve once",
        value: [
          "Approved: run this pending local command now.",
          `Command: ${input.commandLine || input.command || "(empty command)"}`,
        ].join("\n"),
        permissionMode: "bypass",
        suppressUserMessage: true,
      },
      {
        label: "Reject",
        value: [
          "Rejected: do not run that local command.",
          "Choose another allowlisted approach or ask me for the correct path.",
        ].join("\n"),
        permissionMode: "manual",
      },
    ],
  };
}

export const RUNTIME_FETCH_TIMEOUT_MS = 10 * 60 * 1000;
export const execFileAsync = promisify(execFile);

export type WorkspaceSnapshot = {
  head: string;
  dirty: boolean;
  statusLines: string[];
  signature: string;
};

export function userFacingMachineName(profile: AgentProfile) {
  const name = profile.machineName?.trim();
  if (!name || /^this machine$/i.test(name)) return "This Mac";
  return name;
}

function promptNeedsFullVaultContext(prompt: string) {
  return /\b(?:agent|app|brain|capabilit(?:y|ies)|kanban|memory|note|notes|obsidian|queen bee|recall|remember|skill|task|tool|vault|work board|workflow)\b/i.test(prompt);
}

function buildCompactVaultContext(sharedVault: SharedVaultConfig | null): string {
  if (!sharedVault) return "";
  return [
    "Shared vault context:",
    `- Vault path: ${sharedVault.vaultPath}`,
    "- Use the shared vault, memory, skills, Kanban, and dashboard APIs only when the user asks for durable context, tasks, tools, notes, or hive workflow.",
  ].join("\n");
}

export function buildChatVaultContext(sharedVault: SharedVaultConfig | null, prompt: string): string {
  if (!sharedVault) return "";
  return promptNeedsFullVaultContext(prompt) ? buildVaultContext(sharedVault) : buildCompactVaultContext(sharedVault);
}

export function normalizeAgentMode(value: unknown): AgentMode {
  return value === "plan" ? "plan" : "act";
}

export async function readWorkspaceSnapshot(workingDirectory?: string): Promise<WorkspaceSnapshot | null> {
  const trimmed = workingDirectory?.trim();
  if (!trimmed) return null;
  try {
    const cwd = resolve(trimmed);
    const pathStats = await stat(cwd);
    if (!pathStats.isDirectory()) return null;
    const env = sanitizeProcessEnv();
    const [head, status] = await Promise.all([
      execFileAsync("git", ["-C", cwd, "rev-parse", "HEAD"], { timeout: 5_000, env }).then(({ stdout }) => stdout.trim()),
      execFileAsync("git", ["-C", cwd, "status", "--porcelain"], { timeout: 5_000, maxBuffer: 500_000, env }).then(({ stdout }) => stdout.trim()),
    ]);
    return {
      head,
      dirty: status.length > 0,
      statusLines: status ? status.split("\n").slice(0, 12) : [],
      signature: `${head}:${status}`,
    };
  } catch {
    return null;
  }
}

export function workspaceChangeSummary(before: WorkspaceSnapshot | null, after: WorkspaceSnapshot | null) {
  if (!after || before?.signature === after.signature) return "";
  const changedFiles = after.statusLines.map((line) => line.slice(3).trim()).filter(Boolean);
  const headChanged = before?.head && before.head !== after.head;
  return [
    "Runtime completed with observable workspace changes.",
    headChanged ? `HEAD changed from ${before.head.slice(0, 7)} to ${after.head.slice(0, 7)}.` : "",
    changedFiles.length ? `Changed files: ${changedFiles.slice(0, 8).join(", ")}${changedFiles.length > 8 ? ", ..." : ""}.` : "",
  ].filter(Boolean).join(" ");
}

export function buildWalletTools(wallet?: AgentWalletConfig) {
  if (!wallet) return undefined;
  if (!wallet.enabled) return undefined;
  const walletFeatures = agentPaymentProviderFeatures(wallet.provider);
  const x402Endpoint = wallet.provider === "veil" && wallet.veilAutoPrivateX402 === false
    ? "/api/wallet/x402"
    : walletFeatures.x402Endpoint ?? "/api/wallet/x402";
  return {
    x402Fetch: x402Endpoint,
    ...(walletFeatures.privateTransferEndpoint ? { privateTransfer: walletFeatures.privateTransferEndpoint } : {}),
  };
}

export type BestEffortPreflightResult<T> = {
  value: T;
  timedOut: boolean;
  failed: boolean;
};

export async function bestEffortPreflight<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<BestEffortPreflightResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise
        .then((value) => ({ value, timedOut: false, failed: false }))
        .catch(() => ({ value: fallback, timedOut: false, failed: true })),
      new Promise<BestEffortPreflightResult<T>>((resolve) => {
        timeout = setTimeout(() => resolve({ value: fallback, timedOut: true, failed: false }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function recordChatHoney(profile: AgentProfile, inputText: string, outputText: string, enabled: boolean, source: "chat" | "kanban-chat" = "chat") {
  if (!enabled) return null;
  if (!outputText.trim()) return null;
  const result = await recordHoneyUsage({
    agentId: profile.id,
    agentName: profile.name,
    source,
    model: profile.runtime,
    inputText,
    outputText,
  });
  return result.event;
}

export function validateHttpRuntimeProfile(profile: AgentProfile): string | null {
  const gatewayUrl = profile.gatewayUrl?.trim();
  if (!gatewayUrl) {
    return profile.telemetryUrl
      ? "This discovered agent is connected through a local agent bridge. Add a runtime chat URL before sending messages."
      : "Missing runtime chat URL.";
  }

  try {
    const parsed = new URL(gatewayUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "Runtime chat URL must start with http:// or https://.";
    }
  } catch {
    return "Runtime chat URL is invalid.";
  }

  return null;
}

export function runtimeFetchError(profile: AgentProfile, url: string, error: unknown) {
  const reason = error instanceof Error ? error.message : "Runtime did not respond";
  if (profile.runtime === "hermes" && profile.telemetryUrl?.trim() && /fetch failed/i.test(reason)) {
    return `${profile.name || "This agent"} is connected through ${userFacingMachineName(profile)}, but the local agent bridge did not respond. Try again in a moment.`;
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return `${profile.name || profile.runtime} accepted the chat connection at ${url}, but the delegated work did not produce a response before the dashboard timeout. The runtime may still be working; check the agent activity before retrying. (${reason})`;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return `${profile.name || profile.runtime} chat request was interrupted at ${url}. The runtime may still be working; check the agent activity before retrying. (${reason})`;
  }
  return `${profile.name || profile.runtime} is not reachable at ${url}. Check that the ${profile.runtime} runtime is running and that the chat URL is correct. (${reason})`;
}

export function runtimeStreamErrorMessage(profile: AgentProfile, error: unknown) {
  const reason = error instanceof Error ? error.message : "";
  const aborted = error instanceof Error && error.name === "AbortError";
  if (aborted || /^(terminated|aborted)$/i.test(reason)) {
    return `Connection to ${profile.name || profile.runtime} closed before a final response arrived. The local agent bridge may have restarted or the stream was interrupted; retry the message.`;
  }
  return reason || "Runtime stream failed";
}

export async function collectorChatProfile(profile: AgentProfile): Promise<AgentProfile | null> {
  if (profile.runtime !== "hermes") return null;
  if (!profile.telemetryUrl?.trim()) return null;
  return {
    ...profile,
    gatewayUrl: await canonicalLocalCollectorUrl(profile),
    chatPath: "/chat",
  };
}
