import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { access, readFile, stat } from "fs/promises";
import { homedir } from "os";
import { delimiter, join, resolve } from "path";
import { promisify } from "util";
import { HIVEMIND_OS_RUNTIME, getRuntimeUrl, normalizeAgentRuntime, type AgentProfile, type SharedVaultConfig } from "@/lib/types/agent-runtime";
import { sendMessageViaGateway } from "@/lib/services/openclaw/gateway-client";
import { getGatewayAuthToken } from "@/lib/services/openclaw/gateway-health";
import { proxyInput, proxyOutput } from "@/lib/services/agent-security-proxy";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { agentPaymentProviderFeatures } from "@/lib/config/agent-payments";
import {
  VEIL_CASH_NETWORK,
  VEIL_CASH_X402_CONFIRMATION,
  VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM,
} from "@/lib/config/veil-cash";
import { veilEnvValue } from "@/lib/services/wallet/veil-cli";
import { callVeilMcpTool } from "@/lib/services/wallet/veil-mcp";
import { executeVeilPrivateTransfer, veilPrivateTransferErrorMessage } from "@/lib/services/wallet/veil-private-transfer";
import { getWalletBalance } from "@/lib/services/wallet/chain-wallet";
import { executeX402Fetch, type X402FetchPolicy, type X402FetchResult } from "@/lib/services/wallet/x402-agent-fetch";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { getRuntimeAdapter } from "@/lib/services/runtime-adapters/registry";
import { recordHoneyUsage } from "@/lib/services/wallet/honey-ledger";
import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";
import { chatTelemetrySession, chatTelemetryValue } from "@/lib/services/telemetry/chat-dev-telemetry";
import { normalizeRuntimeStreamEvent, RUNTIME_STREAM_EVENT_TYPES, type RuntimeStreamEvent } from "@/lib/services/runtime-stream-events";
import { isUsePodProfile, resolveUsePodRuntimeConfig, summarizeUsePodResponseHeaders } from "@/lib/services/usepod";
import {
  bankrLlmModel,
  isBankrAdaptiveModel,
  isBankrLlmProfile,
  resolveBankrLlmRuntimeProfile,
  resolveAdaptiveBankrLlmModels,
} from "@/lib/services/bankr-llm";
import {
  buildMiroSharkChatCard,
  executeMiroSharkChatRun,
  extractMiroSharkRunId,
  findMiroSharkChatRunRequest,
  validateMiroSharkChatRun,
  waitForMiroSharkCompletion,
  type MiroSharkChatRunDraft,
} from "@/lib/services/miroshark/x402-chat-run";
import { DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS } from "@/lib/utils/agent-wallet";
import { activeSharedVault, buildVaultContext } from "@/lib/services/chat/shared-vault-context";
import { buildSharedBrainMemoryContext } from "@/lib/services/chat/shared-brain-memory-context";
import {
  buildTaskRetrievalContextResult,
  buildTaskRetrievalFallbackContext,
  formatTaskRetrievalFallbackProcessDetail,
  formatTaskRetrievalProcessDetail,
  imageGenerationRequest,
  type TaskRetrievalTelemetry,
} from "@/lib/services/chat/task-retrieval-context";
import { runtimeImageGenerationCapabilityContext } from "@/lib/services/chat/runtime-image-generation-capability";
import {
  buildHivemindPromptEnvelope,
  buildHivemindUserContextText,
  prependHivemindSystemMessage,
} from "@/lib/services/chat/hivemind-system-prompt";
import { resolveAdaptiveOpenRouterModel, resolveAdaptiveOpenRouterModels } from "@/lib/services/chat/adaptive-openrouter-models";
import { isAdaptiveProviderProfile, resolveAdaptiveRoutePlan, type AdaptiveRoutePlan } from "@/lib/services/chat/adaptive-model-router";
import {
  appendRuntimeChatSessionEvent,
  appendRuntimeChatSessionText,
  createRuntimeChatSessionId,
  finishRuntimeChatSession,
  startRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";
import { canonicalLocalCollectorUrl, isLocalCollectorUrl, remoteCollectorLocalServiceUrl } from "@/lib/services/local-collector-url";
import { RUN_COMMAND_TOOL_NAME, runAgentCommand, runCommandToolDefinition } from "@/lib/services/agent-shell/command-tool";

export const runtime = "nodejs";
export const maxDuration = 600;

type IncomingMessage = {
  role: string;
  content: string | Array<{
    type: string;
    text?: string;
    image_url?: { url?: string };
    file?: { filename?: string; file_data?: string };
  }>;
};

type RuntimeRouteTelemetry = {
  request: NextRequest;
  routeStartedAt: number;
  runtimeSessionId?: string;
  chatStorageKey?: string;
};

type AgentMode = "plan" | "act";

const INTERACTIVE_RUNTIME_LOCK_MS = 130_000;
const RUNTIME_FETCH_TIMEOUT_MS = 10 * 60 * 1000;
const CHAT_PREFLIGHT_RUNTIME_CAPABILITY_TIMEOUT_MS = 150;
const CHAT_PREFLIGHT_CAPABILITY_SEARCH_TIMEOUT_MS = 900;
const CHAT_PREFLIGHT_MEMORY_TIMEOUT_MS = 650;
const ADAPTIVE_HERMES_OPENROUTER_FREE_ATTEMPTS = 5;
const ADAPTIVE_HERMES_OPENROUTER_ATTEMPT_TIMEOUT_MS = 45_000;
const DEFAULT_ADAPTIVE_HERMES_OPENROUTER_FALLBACK_MODEL = "openai/gpt-4.1-mini";
const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const HERMES_ENV_FILE = join(homedir(), ".hermes", ".env");
const interactiveRuntimeLocks = new Map<string, number>();
const privateTransferExecutions = new Map<string, { status: "running" | "completed"; startedAt: number; message?: string }>();
const privateX402Executions = new Map<string, { status: "running" | "completed"; startedAt: number; message?: string }>();
const MIROSHARK_TERMINAL_STATUS_PATTERN = /\b(?:complete|completed|success|succeeded|ready|failed|failure|error|cancelled|canceled|stopped)\b/i;
const execFileAsync = promisify(execFile);

type PrivateTransferDraft = { asset: "USDC"; amount: string; recipient: string };
type PrivateX402Draft = { url: string; method: "GET" | "POST"; maxPayment: string };
type PublicX402Draft = { url: string; method: "GET" | "POST"; maxPayment: string };
type VeilMcpX402Quote = {
  requiresPayment?: boolean;
  supported?: boolean;
  amount?: string;
  network?: string;
  asset?: string;
  message?: string;
};
type VeilMcpX402Result = {
  action?: string;
  success?: boolean;
  settled?: boolean;
  reused?: boolean;
  status?: number;
  url?: string;
  maxPayment?: string;
  requiredAmount?: string;
  requiredAmountAtomic?: string;
  candidates?: Array<{
    payerIndex?: string;
    payerAddress?: string;
    usdc?: string;
    usdcAtomic?: string;
    fundedFor?: string | null;
  }>;
  message?: string;
  receipt?: {
    payerAddress?: string;
    payerIndex?: string;
    amount?: string;
    relayTransactionHash?: string;
    paymentTransactionHash?: string;
  };
  payerAddress?: string;
  payerIndex?: string;
  amount?: string;
  relayTransactionHash?: string;
  relayBlockNumber?: string;
  paymentTransactionHash?: string;
  body?: unknown;
};

type WorkspaceSnapshot = {
  head: string;
  dirty: boolean;
  statusLines: string[];
  signature: string;
};

function telemetryPayloadForProfile(profile?: AgentProfile) {
  if (!profile) return {};
  return {
    agentId: profile.id,
    agentName: profile.name,
    runtime: profile.runtime,
    runtimeKind: profile.runtimeKind ?? null,
    hasGatewayUrl: Boolean(profile.gatewayUrl?.trim()),
    hasTelemetryUrl: Boolean(profile.telemetryUrl?.trim()),
    hasToken: Boolean(profile.token?.trim()),
    machineName: profile.machineName ?? null,
  };
}

async function recordRouteTelemetry(request: NextRequest, type: string, payload: Record<string, unknown> = {}) {
  const runId = typeof payload.runtimeSessionId === "string" && payload.runtimeSessionId
    ? payload.runtimeSessionId
    : request.headers.get("x-hivemind-run-id");
  const threadId = typeof payload.chatStorageKey === "string" && payload.chatStorageKey
    ? payload.chatStorageKey
    : request.headers.get("x-hivemind-chat-storage-key");
  await recordTelemetryBatch([{
    source: "route",
    type,
    threadId,
    runId,
    payload,
  }]).catch(() => undefined);
}

function recordRuntimeTelemetry(telemetry: RuntimeRouteTelemetry | undefined, type: string, payload: Record<string, unknown> = {}) {
  if (!telemetry) return;
  void recordRouteTelemetry(telemetry.request, type, {
    runtimeSessionId: telemetry.runtimeSessionId ?? null,
    chatStorageKey: telemetry.chatStorageKey ?? null,
    ...payload,
    elapsedMs: Date.now() - telemetry.routeStartedAt,
  });
}

function userFacingMachineName(profile: AgentProfile) {
  const name = profile.machineName?.trim();
  if (!name || /^this machine$/i.test(name)) return "This Mac";
  return name;
}

function interactiveRuntimeLockKey(profile: AgentProfile, url: string) {
  if (profile.runtime !== "hermes" && profile.runtime !== HIVEMIND_OS_RUNTIME) return "";
  if ((profile.runtimeKind ?? "interactive") !== "interactive") return "";
  return url;
}

function reserveInteractiveRuntime(key: string) {
  if (!key) return true;
  const now = Date.now();
  const lockedAt = interactiveRuntimeLocks.get(key) ?? 0;
  if (lockedAt && now - lockedAt < INTERACTIVE_RUNTIME_LOCK_MS) return false;
  interactiveRuntimeLocks.set(key, now);
  return true;
}

function releaseInteractiveRuntime(key: string) {
  if (!key) return;
  interactiveRuntimeLocks.delete(key);
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

function buildChatVaultContext(sharedVault: SharedVaultConfig | null, prompt: string): string {
  if (!sharedVault) return "";
  return promptNeedsFullVaultContext(prompt) ? buildVaultContext(sharedVault) : buildCompactVaultContext(sharedVault);
}

function normalizeAgentMode(value: unknown): AgentMode {
  return value === "plan" ? "plan" : "act";
}

async function readWorkspaceSnapshot(workingDirectory?: string): Promise<WorkspaceSnapshot | null> {
  const trimmed = workingDirectory?.trim();
  if (!trimmed) return null;
  try {
    const cwd = resolve(trimmed);
    const pathStats = await stat(cwd);
    if (!pathStats.isDirectory()) return null;
    const [head, status] = await Promise.all([
      execFileAsync("git", ["-C", cwd, "rev-parse", "HEAD"], { timeout: 5_000 }).then(({ stdout }) => stdout.trim()),
      execFileAsync("git", ["-C", cwd, "status", "--porcelain"], { timeout: 5_000, maxBuffer: 500_000 }).then(({ stdout }) => stdout.trim()),
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

function workspaceChangeSummary(before: WorkspaceSnapshot | null, after: WorkspaceSnapshot | null) {
  if (!after || before?.signature === after.signature) return "";
  const changedFiles = after.statusLines.map((line) => line.slice(3).trim()).filter(Boolean);
  const headChanged = before?.head && before.head !== after.head;
  return [
    "Runtime completed with observable workspace changes.",
    headChanged ? `HEAD changed from ${before.head.slice(0, 7)} to ${after.head.slice(0, 7)}.` : "",
    changedFiles.length ? `Changed files: ${changedFiles.slice(0, 8).join(", ")}${changedFiles.length > 8 ? ", ..." : ""}.` : "",
  ].filter(Boolean).join(" ");
}

function buildWalletTools(wallet?: AgentWalletConfig) {
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

async function maybeExecuteConfirmedPrivateTransfer(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latest = latestUserMessage(input.messages);
  const latestText = messageText(latest).trim().toLowerCase();
  if (!/^(confirm|confirmed|yes|yes,? confirm|go ahead|send it)$/i.test(latestText)) return null;

  const draft = findPrivateTransferDraft(input.messages);
  if (!draft) return null;

  const validation = await validateConfirmedPrivateTransfer(input.wallet, draft);
  if (validation) {
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", validation).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(validation);
  }
  const executionKey = privateTransferExecutionKey(input.profile, draft);
  prunePrivateTransferExecutions();
  const existing = privateTransferExecutions.get(executionKey);
  if (existing?.status === "running") {
    return privateTransferSse("That private send confirmation is already running. I will not submit a duplicate transfer.");
  }
  if (existing?.status === "completed" && existing.message) {
    if (isPendingShieldMessage(existing.message) || isIncompletePrivateTransferMessage(existing.message)) {
      privateTransferExecutions.delete(executionKey);
    } else if (duplicatePaymentGuardEnabled(input.wallet)) {
      return privateTransferSse(`That private send was already submitted.\n${existing.message}`);
    } else {
      privateTransferExecutions.delete(executionKey);
    }
  }
  privateTransferExecutions.set(executionKey, { status: "running", startedAt: Date.now() });

  await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_transfer.confirmed", {
    ...telemetryPayloadForProfile(input.profile),
    asset: draft.asset,
    amount: draft.amount,
    recipient: draft.recipient,
    elapsedMs: Date.now() - input.routeStartedAt,
  });

  try {
    return privateTransferExecutionSse({ ...input, draft, executionKey, telemetryType: "agent_runtime.wallet.private_transfer.confirmed" });
  } catch (error) {
    privateTransferExecutions.delete(executionKey);
    const message = `Private send failed: ${veilPrivateTransferErrorMessage(error)}`;
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(message);
  }
}

async function maybeExecuteNaturalPrivateTransfer(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const draft = findLatestPrivateTransferRequest(input.messages);
  if (!draft) return null;

  const validation = await validateNaturalPrivateTransfer(input.wallet, draft);
  if (validation) {
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", validation).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(validation);
  }

  const executionKey = privateTransferExecutionKey(input.profile, draft);
  prunePrivateTransferExecutions();
  const existing = privateTransferExecutions.get(executionKey);
  if (existing?.status === "running") {
    return privateTransferSse("That private send is already running. I will not submit a duplicate transfer.");
  }
  if (existing?.status === "completed" && existing.message) {
    if (isPendingShieldMessage(existing.message) || isIncompletePrivateTransferMessage(existing.message)) {
      privateTransferExecutions.delete(executionKey);
    } else if (duplicatePaymentGuardEnabled(input.wallet)) {
      return privateTransferSse(`That private send was already submitted.\n${existing.message}`);
    } else {
      privateTransferExecutions.delete(executionKey);
    }
  }
  privateTransferExecutions.set(executionKey, { status: "running", startedAt: Date.now() });

  await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_transfer.requested", {
    ...telemetryPayloadForProfile(input.profile),
    asset: draft.asset,
    amount: draft.amount,
    recipient: draft.recipient,
    elapsedMs: Date.now() - input.routeStartedAt,
  });

  try {
    return privateTransferExecutionSse({ ...input, draft, executionKey, telemetryType: "agent_runtime.wallet.private_transfer.requested" });
  } catch (error) {
    privateTransferExecutions.delete(executionKey);
    const message = `Private send failed: ${veilPrivateTransferErrorMessage(error)}`;
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(message);
  }
}

async function maybePrepareNaturalPrivateX402(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const draft = findLatestPrivateX402Request(input.messages, input.wallet);
  if (!draft) return null;

  const validation = await validatePrivateX402(input.wallet, draft, false);
  const quote = validation ? null : await readPrivateX402Quote(draft);
  const message = privateX402DraftMessage(draft, input.wallet, quote, validation);
  await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, quote ?? undefined).catch(() => undefined);
  await finishRuntimeChatSession(input.runtimeSessionId, validation ? "failed" : "completed").catch(() => undefined);
  await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_x402.draft", {
    ...telemetryPayloadForProfile(input.profile),
    url: draft.url,
    method: draft.method,
    maxPayment: draft.maxPayment,
    hasValidationError: Boolean(validation),
    quoteAmount: quote?.amount ?? null,
    elapsedMs: Date.now() - input.routeStartedAt,
  });
  return privateTransferSse(message);
}

async function maybeExecuteConfirmedPrivateX402(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latest = latestUserMessage(input.messages);
  const latestText = messageText(latest).trim().toLowerCase();
  if (!/^(confirm|confirmed|yes|yes,? confirm|go ahead|pay it|run it|execute)$/i.test(latestText)) return null;

  const draft = findPrivateX402Draft(input.messages, input.wallet);
  if (!draft) return null;

  const validation = await validatePrivateX402(input.wallet, draft, true);
  if (validation) {
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", validation).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(validation);
  }

  const executionKey = privateX402ExecutionKey(input.profile, draft);
  prunePrivateX402Executions();
  const existing = privateX402Executions.get(executionKey);
  if (existing?.status === "running") {
    return privateTransferSse("That private x402 payment is already running. I will not submit a duplicate payment.");
  }
  if (existing?.status === "completed" && existing.message) {
    return privateTransferSse(`That private x402 payment was already submitted.\n${existing.message}`);
  }
  privateX402Executions.set(executionKey, { status: "running", startedAt: Date.now() });

  await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_x402.confirmed", {
    ...telemetryPayloadForProfile(input.profile),
    url: draft.url,
    method: draft.method,
    maxPayment: draft.maxPayment,
    confirmation: VEIL_CASH_X402_CONFIRMATION,
    elapsedMs: Date.now() - input.routeStartedAt,
  });

  return privateX402ExecutionSse({ ...input, draft, executionKey });
}

async function maybeExecuteConfirmedPublicX402(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latest = latestUserMessage(input.messages);
  const latestText = messageText(latest).trim().toLowerCase();
  if (!/^(confirm|confirmed|yes|yes,? confirm|go ahead|pay it|run it|execute)$/i.test(latestText)) return null;

  const draft = findPublicX402Draft(input.messages);
  if (!draft) return null;
  return publicX402ExecutionSse({ ...input, draft });
}

async function maybePrepareNaturalPublicX402(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const draft = findLatestPublicX402Request(input.messages, input.wallet);
  if (!draft) return null;

  const validation = validatePublicX402Draft(input.wallet, draft);
  const message = publicX402DraftMessage(draft, input.wallet, validation);
  await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
  await finishRuntimeChatSession(input.runtimeSessionId, validation ? "failed" : "completed").catch(() => undefined);
  await recordRouteTelemetry(input.request, "agent_runtime.wallet.public_x402.draft", {
    ...telemetryPayloadForProfile(input.profile),
    url: draft.url,
    method: draft.method,
    maxPayment: draft.maxPayment,
    hasValidationError: Boolean(validation),
    elapsedMs: Date.now() - input.routeStartedAt,
  });
  return privateTransferSse(message);
}

async function maybeExecuteNaturalMiroSharkX402(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}) {
  const draft = findMiroSharkChatRunRequest(input.messages, input.wallet);
  if (!draft) return null;

  const validation = validateMiroSharkChatRun(input.wallet, draft);
  if (validation) {
    const message = [
      "**MiroShark x402 unavailable**",
      "",
      validation,
      "",
      "Fix this blocker, then send the simulation request again.",
    ].join("\n");
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    await recordRouteTelemetry(input.request, "agent_runtime.miroshark_x402.validation_failed", {
      ...telemetryPayloadForProfile(input.profile),
      seedKind: draft.seedKind,
      hasMarketUrl: Boolean(draft.marketUrl),
      maxPaymentUsd: draft.maxPaymentUsd,
      validation,
      elapsedMs: Date.now() - input.routeStartedAt,
    });
    return privateTransferSse(message);
  }

  return miroSharkX402ExecutionSse({
    request: input.request,
    routeStartedAt: input.routeStartedAt,
    profile: input.profile,
    draft,
    wallet: input.wallet!,
    runtimeSessionId: input.runtimeSessionId,
  });
}

function findLatestPrivateX402Request(messages: IncomingMessage[], wallet?: AgentWalletConfig): PrivateX402Draft | null {
  const latest = latestUserMessage(messages);
  return parsePrivateX402Request(messageText(latest), wallet);
}

function findLatestPublicX402Request(messages: IncomingMessage[], wallet?: AgentWalletConfig): PublicX402Draft | null {
  const latest = latestUserMessage(messages);
  return parsePublicX402Request(messageText(latest), wallet);
}

function findPrivateX402Draft(messages: IncomingMessage[], wallet?: AgentWalletConfig): PrivateX402Draft | null {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = messageText(message);
    if (isPublicX402DraftText(text)) return null;
    if (!isPrivateX402DraftText(text)) continue;
    return parsePrivateX402Request(text, wallet);
  }
  return null;
}

function findPublicX402Draft(messages: IncomingMessage[]): PublicX402Draft | null {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = messageText(message);
    if (isPrivateX402DraftText(text)) return null;
    if (!isPublicX402DraftText(text)) continue;
    return parsePublicX402Draft(text);
  }
  return null;
}

function isPrivateX402DraftText(text: string) {
  return /\*{0,2}Private x402 ready\*{0,2}/i.test(text) || /Reply\s+`?confirm`?\s+to\s+pay\s+privately/i.test(text);
}

function isPublicX402DraftText(text: string) {
  if (!/(x402|paid endpoint|paywall|paid-content)/i.test(text)) return false;
  if (/\*{0,2}Private x402 ready\*{0,2}|Reply\s+`?confirm`?\s+to\s+pay\s+privately|private x402/i.test(text)) return false;
  return /\*{0,2}Public x402 ready\*{0,2}/i.test(text)
    || /Draft:\s*x402 payment to\s+https?:\/\//i.test(text)
    || /Reply\s*:?\s*`?confirm`?(?:\s|$)/i.test(text)
    || /Reply\s+`?confirm`?\s+to\s+pay\.(?:\s|$)/i.test(text);
}

function parsePublicX402Draft(text: string): PublicX402Draft | null {
  const url = sanitizePrivateX402Url(text.match(/https?:\/\/[^\s<>"'`)\]]+/i)?.[0]);
  if (!url) return null;
  const maxMatch = text.match(/\bmax(?:imum)?(?:\s+(?:cap|spend|payment|of))?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USD)?/i)
    ?? text.match(/\bcap(?:ped)?(?:\s+at)?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USD)?/i);
  return {
    url,
    method: /\bPOST\b/i.test(text) ? "POST" : "GET",
    maxPayment: maxMatch?.[1] ?? "0.5",
  };
}

function parsePublicX402Request(text: string, wallet?: AgentWalletConfig): PublicX402Draft | null {
  if (!/(x402|paid endpoint|paywall|paid-content)/i.test(text)) return null;
  if (/(private|privately|veil)/i.test(text)) return null;
  if (wallet?.provider === "veil" && wallet.veilAutoPrivateX402 !== false) return null;
  const url = sanitizePrivateX402Url(text.match(/https?:\/\/[^\s<>"'`)\]]+/i)?.[0]);
  if (!url) return null;
  const maxMatch = text.match(/\bmax(?:imum)?(?:\s+(?:cap|spend|payment|of))?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USD)?/i)
    ?? text.match(/\bcap(?:ped)?(?:\s+at)?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USD)?/i);
  const maxPayment = maxMatch?.[1] ?? formatMoney(Math.max(0, Number(wallet?.maxPaymentUsd) || 0.5));
  return {
    url,
    method: /\bPOST\b/i.test(text) ? "POST" : "GET",
    maxPayment,
  };
}

function parsePrivateX402Request(text: string, wallet?: AgentWalletConfig): PrivateX402Draft | null {
  if (isPublicX402DraftText(text)) return null;
  if (!/(x402|paid endpoint|paywall|paid-content)/i.test(text)) return null;
  if (!/(private|privately|veil)/i.test(text) && !(wallet?.provider === "veil" && wallet.veilAutoPrivateX402 !== false)) return null;
  const url = sanitizePrivateX402Url(text.match(/https?:\/\/[^\s<>"'`)\]]+/i)?.[0]);
  if (!url) return null;
  const maxMatch = text.match(/\bmax(?:imum)?(?:\s+(?:spend|payment|of|cap))?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USD)?/i)
    ?? text.match(/\bcap(?:ped)?(?:\s+at)?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USD)?/i);
  const maxPayment = maxMatch?.[1] ?? formatMoney(Math.max(0, Number(wallet?.maxPaymentUsd) || 0.5));
  return {
    url,
    method: /\bPOST\b/i.test(text) ? "POST" : "GET",
    maxPayment,
  };
}

function sanitizePrivateX402Url(value: string | undefined) {
  return value?.trim().replace(/[`\]).,;:]+$/, "") ?? "";
}

async function validatePrivateX402(wallet: AgentWalletConfig | undefined, draft: PrivateX402Draft, executing: boolean) {
  if (!wallet) return "No wallet is configured for this agent.";
  if (wallet.provider !== "veil") return "This agent is not configured for Veil private x402 payments.";
  if (wallet.network !== VEIL_CASH_NETWORK) return "Veil private x402 payments are only supported on Base mainnet.";
  if (executing && !wallet.enabled) return "Wallet spending is off for this agent. Enable Spend on before executing private x402 payments.";
  if (!/^https?:\/\//i.test(draft.url)) return "Private x402 requires a valid HTTP(S) endpoint URL.";
  const maxPayment = Number(draft.maxPayment);
  if (!Number.isFinite(maxPayment) || maxPayment <= 0) return "Max payment must be a positive USDC value.";
  if (maxPayment > wallet.maxPaymentUsd) return `Max payment exceeds this agent's USDC spend cap ($${wallet.maxPaymentUsd.toFixed(2)}).`;
  if (!await veilEnvValue("VEIL_KEY")) return "VEIL_KEY is not configured. Run Veil setup before private x402 payments.";
  return "";
}

function validatePublicX402Draft(wallet: AgentWalletConfig | undefined, draft: PublicX402Draft) {
  if (!wallet) return "No wallet is configured for this agent.";
  if (!wallet.enabled) return "";
  if (!/^https?:\/\//i.test(draft.url)) return "x402 requires a valid HTTP(S) endpoint URL.";
  const maxPayment = Number(draft.maxPayment);
  if (!Number.isFinite(maxPayment) || maxPayment <= 0) return "Max payment must be a positive USDC value.";
  if (maxPayment > wallet.maxPaymentUsd) return `Max payment exceeds this agent's USDC spend cap ($${wallet.maxPaymentUsd.toFixed(2)}).`;
  return "";
}

function publicX402DraftMessage(draft: PublicX402Draft, wallet: AgentWalletConfig | undefined, validation?: string) {
  if (validation) {
    return [
      "**Public x402 unavailable**",
      "",
      validation,
      "",
      "Fix this blocker, then send the payment request again.",
    ].join("\n");
  }
  return [
    "**Public x402 ready**",
    "",
    `Endpoint \`${draft.url}\``,
    `Max cap **${draft.maxPayment} USDC**`,
    "Network `base`",
    "",
    wallet?.enabled
      ? "Reply `confirm` to pay."
      : "Wallet spending is off for this agent, so I prepared the draft only. Turn Spend on before execution.",
  ].filter(Boolean).join("\n");
}

async function readPrivateX402Quote(draft: PrivateX402Draft) {
  try {
    return await callVeilMcpTool<VeilMcpX402Quote>("veil_x402_quote", {
      url: draft.url,
      method: draft.method,
      maxPayment: draft.maxPayment,
    }, 4_000);
  } catch {
    return null;
  }
}

function privateX402ExecutionKey(profile: AgentProfile, draft: PrivateX402Draft) {
  return [
    profile.id,
    draft.method,
    draft.url.toLowerCase(),
    Number(draft.maxPayment).toFixed(6),
  ].join(":");
}

function prunePrivateX402Executions() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, value] of privateX402Executions.entries()) {
    if (value.startedAt < cutoff) privateX402Executions.delete(key);
  }
}

function privateX402DraftMessage(
  draft: PrivateX402Draft,
  wallet: AgentWalletConfig | undefined,
  quote: VeilMcpX402Quote | null,
  validation?: string,
) {
  if (validation) {
    return [
      "**Private x402 unavailable**",
      "",
      validation,
      "",
      "Fix this blocker, then send the payment request again.",
    ].join("\n");
  }
  const price = quote?.amount
    ? `Price **${quote.amount} USDC**`
    : "Price will be checked before payment";
  return [
    "**Private x402 ready**",
    "",
    `Endpoint \`${draft.url}\``,
    `${price} · max **${draft.maxPayment} USDC**`,
    "",
    wallet?.enabled
      ? "Reply `confirm` to pay privately."
      : "Wallet spending is off for this agent, so I prepared the draft only. Turn Spend on before execution.",
  ].filter(Boolean).join("\n");
}

function privateX402ExecutionSse(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  draft: PrivateX402Draft;
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
  executionKey: string;
}) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(ssePayload(payload)));
      const sendTool = async (type: string, label: string, detail?: string, status: "running" | "completed" | "failed" = "running") => {
        const event = { type, toolName: "privateX402", name: "privateX402", message: label, detail, status };
        send(event);
        await appendRuntimeChatSessionEvent(input.runtimeSessionId, label, detail, event).catch(() => undefined);
      };
      try {
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_START, "Preparing private x402 payment", input.draft.url);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Validate spend policy",
          input.wallet ? `Spend on; cap ${formatMoney(input.wallet.maxPaymentUsd)} USDC; max ${input.draft.maxPayment} USDC.` : "Spend policy already validated.",
          "completed",
        );
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Execute Veil x402 payment",
          "Selecting a private payer EOA, then settling x402.",
          "running",
        );
        const startedAt = Date.now();
        let result = await callVeilMcpTool<VeilMcpX402Result>("veil_pay_x402", {
          url: input.draft.url,
          method: input.draft.method,
          maxPayment: input.draft.maxPayment,
          confirm: true,
        });
        if (result.action === "reuse_available") {
          const payerIndex = reusableX402PayerIndex(result);
          if (!payerIndex) throw new Error(result.message ?? "A funded x402 payer is available but no reusable payer index was returned.");
          await sendTool(
            RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
            "Reuse funded x402 payer",
            `Using payer index ${payerIndex}; no new private withdrawal needed.`,
            "running",
          );
          result = await callVeilMcpTool<VeilMcpX402Result>("veil_pay_x402", {
            url: input.draft.url,
            method: input.draft.method,
            maxPayment: input.draft.maxPayment,
            payerIndex,
            confirm: true,
          });
        }
        if (result.success === false) throw new Error(result.message ?? "Veil private x402 payment was not submitted.");
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Execute Veil x402 payment",
          `Settled in ${formatDuration(Date.now() - startedAt)}.`,
          "completed",
        );
        const message = privateX402ResultMessage(result, input.draft, Date.now() - startedAt);
        privateX402Executions.set(input.executionKey, { status: "completed", startedAt: Date.now(), message });
        await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_x402.completed", {
          ...telemetryPayloadForProfile(input.profile),
          url: input.draft.url,
          method: input.draft.method,
          maxPayment: input.draft.maxPayment,
          amount: result.amount ?? result.receipt?.amount ?? null,
          relayTransactionHash: result.relayTransactionHash ?? result.receipt?.relayTransactionHash ?? null,
          paymentTransactionHash: result.paymentTransactionHash ?? result.receipt?.paymentTransactionHash ?? null,
          elapsedMs: Date.now() - input.routeStartedAt,
        });
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "Private x402 finished", `Total ${formatDuration(Date.now() - input.routeStartedAt)}.`, "completed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, result).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        privateX402Executions.delete(input.executionKey);
        const errorMessage = privateX402ErrorMessage(error);
        const noPaymentRequested = /Endpoint did not return HTTP 402/i.test(errorMessage);
        const message = noPaymentRequested
          ? `No x402 payment was requested by that endpoint, so no funds were withdrawn.\n\nEndpoint \`${input.draft.url}\``
          : `Private x402 failed: ${errorMessage}`;
        await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_x402.failed", {
          ...telemetryPayloadForProfile(input.profile),
          url: input.draft.url,
          method: input.draft.method,
          maxPayment: input.draft.maxPayment,
          error: errorMessage,
          noPaymentRequested,
          elapsedMs: Date.now() - input.routeStartedAt,
        }).catch(() => undefined);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
          noPaymentRequested ? "No x402 payment requested" : "Private x402 failed",
          errorMessage,
          noPaymentRequested ? "completed" : "failed",
        );
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, noPaymentRequested ? "completed" : "failed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function miroSharkX402ExecutionSse(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  draft: MiroSharkChatRunDraft;
  wallet: AgentWalletConfig;
  runtimeSessionId: string;
}) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(ssePayload(payload)));
      const sendTool = async (type: string, label: string, detail?: string, status: "running" | "completed" | "failed" = "running") => {
        const event = { type, toolName: "MiroShark x402", name: "MiroShark x402", message: label, detail, status };
        send(event);
        await appendRuntimeChatSessionEvent(input.runtimeSessionId, label, detail, event).catch(() => undefined);
      };
      try {
        send({ session: { id: input.runtimeSessionId, runtime: input.profile.runtime, source: "hivemindos-miroshark-x402", startedAt: input.routeStartedAt } });
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_START, "Preparing MiroShark simulation", `question: ${input.draft.title}`);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Paying MiroShark x402 endpoint",
          `Cap ${formatMoney(Math.min(input.wallet.maxPaymentUsd, Math.max(1, input.draft.maxPaymentUsd)))} USDC · ${input.draft.seedKind}`,
        );
        const paidStartedAt = Date.now();
        const paidRun = await executeMiroSharkChatRun(input.profile.id, input.wallet, input.draft);
        const runId = extractMiroSharkRunId(paidRun.miroshark, paidRun.result.bodyJson);
        await recordRouteTelemetry(input.request, "agent_runtime.miroshark_x402.started", {
          ...telemetryPayloadForProfile(input.profile),
          seedKind: input.draft.seedKind,
          hasMarketUrl: Boolean(input.draft.marketUrl),
          maxPaymentUsd: input.draft.maxPaymentUsd,
          amountUsd: paidRun.result.amountUsd,
          paid: paidRun.result.paid,
          runId: runId || null,
          elapsedMs: Date.now() - input.routeStartedAt,
        });
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "MiroShark simulation started",
          runId ? `Run ${runId} · paid in ${formatDuration(Date.now() - paidStartedAt)}` : "Paid run accepted; waiting for run id.",
          "running",
        );

        const snapshot = runId
          ? await waitForMiroSharkCompletion(runId, async (_status, statusLabel) => {
            await sendTool(
              RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
              "MiroShark status",
              statusLabel || `Polling ${runId}`,
              MIROSHARK_TERMINAL_STATUS_PATTERN.test(statusLabel) ? "completed" : "running",
            );
          })
          : { status: paidRun.miroshark, timedOut: true };
        const card = buildMiroSharkChatCard({
          draft: input.draft,
          elapsedMs: Date.now() - input.routeStartedAt,
          paidRun,
          runId,
          snapshot,
        });
        const completed = /\b(?:complete|completed|success|succeeded|ready)\b/i.test(card.miroshark.status);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
          completed ? "MiroShark report ready" : snapshot.timedOut ? "MiroShark still running" : "MiroShark run finished",
          `Total ${formatDuration(Date.now() - input.routeStartedAt)}${runId ? ` · ${runId}` : ""}`,
          completed ? "completed" : "running",
        );
        const message = JSON.stringify(card);
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, card).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        const detail = error instanceof Error ? error.message : "MiroShark x402 run failed.";
        const message = `MiroShark x402 failed: ${detail}`;
        await recordRouteTelemetry(input.request, "agent_runtime.miroshark_x402.failed", {
          ...telemetryPayloadForProfile(input.profile),
          seedKind: input.draft.seedKind,
          hasMarketUrl: Boolean(input.draft.marketUrl),
          error: detail,
          elapsedMs: Date.now() - input.routeStartedAt,
        }).catch(() => undefined);
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "MiroShark x402 failed", detail, "failed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function publicX402ExecutionSse(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  draft: PublicX402Draft;
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(ssePayload(payload)));
      const sendTool = async (type: string, label: string, detail?: string, status: "running" | "completed" | "failed" = "running") => {
        const event = { type, toolName: "x402Fetch", name: "x402Fetch", message: label, detail, status };
        send(event);
        await appendRuntimeChatSessionEvent(input.runtimeSessionId, label, detail, event).catch(() => undefined);
      };
      try {
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_START, "Preparing public x402 payment", input.draft.url);
        const wallet = input.wallet;
        if (!wallet) throw new Error("No wallet is configured for this agent.");
        const approvedMax = Number(input.draft.maxPayment);
        if (!Number.isFinite(approvedMax) || approvedMax <= 0) throw new Error("Confirmed x402 draft has no valid max payment.");
        const stored = await getWalletSecret(input.profile.id);
        if (!stored) throw new Error("No local wallet exists for this agent.");
        const policy = publicX402Policy(wallet, stored.info.network, approvedMax);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Validate spend policy",
          `Spend ${policy.enabled ? "on" : "off"}; cap ${formatMoney(policy.maxPaymentUsd)} USDC; public x402.`,
          "completed",
        );
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS, "Execute public x402 payment", "Signing from the local wallet vault.", "running");
        const startedAt = Date.now();
        const result = await executeX402Fetch({
          agentId: input.profile.id,
          network: stored.info.network,
          secret: stored.secret,
          url: input.draft.url,
          method: input.draft.method,
          policy,
          confirmation: "PAY_X402",
        });
        const message = publicX402ResultMessage(result, Date.now() - startedAt);
        await recordRouteTelemetry(input.request, "agent_runtime.wallet.public_x402.completed", {
          ...telemetryPayloadForProfile(input.profile),
          url: input.draft.url,
          method: input.draft.method,
          maxPayment: input.draft.maxPayment,
          amountUsd: result.amountUsd,
          status: result.status,
          paid: result.paid,
          elapsedMs: Date.now() - input.routeStartedAt,
        });
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "Public x402 finished", `Total ${formatDuration(Date.now() - input.routeStartedAt)}.`, "completed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, result).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        const message = `Public x402 failed: ${publicX402ErrorMessage(error)}`;
        await recordRouteTelemetry(input.request, "agent_runtime.wallet.public_x402.failed", {
          ...telemetryPayloadForProfile(input.profile),
          url: input.draft.url,
          method: input.draft.method,
          maxPayment: input.draft.maxPayment,
          error: publicX402ErrorMessage(error),
          elapsedMs: Date.now() - input.routeStartedAt,
        }).catch(() => undefined);
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "Public x402 failed", publicX402ErrorMessage(error), "failed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function publicX402Policy(wallet: AgentWalletConfig, storedNetwork: string, approvedMax: number): X402FetchPolicy {
  const provider = wallet.provider === "veil" && wallet.veilAutoPrivateX402 === false ? "x402" : wallet.provider;
  return {
    enabled: wallet.enabled,
    provider,
    network: wallet.network || storedNetwork,
    maxPaymentUsd: Math.max(0, Math.min(wallet.maxPaymentUsd, approvedMax)),
    approvalRequiredOverUsd: wallet.approvalRequiredOverUsd,
    autoPayEnabled: false,
    x402BaseUrl: wallet.x402BaseUrl,
  };
}

function publicX402ResultMessage(result: X402FetchResult, executionMs: number) {
  const body = summarizePaidContent(result.bodyJson ?? result.bodyPreview);
  return [
    `**Public x402 complete** · **${formatMoney(result.amountUsd)} USDC**`,
    "",
    `Endpoint \`${result.url}\``,
    result.paid ? "Payment settled from the local wallet." : "No payment was required.",
    `HTTP status \`${result.status}\``,
    "",
    body ? `Content received:\n${body}` : "Content received.",
    "",
    `Timing **${formatDuration(executionMs)}**`,
  ].filter(Boolean).join("\n");
}

function publicX402ErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function privateX402ResultMessage(result: VeilMcpX402Result, draft: PrivateX402Draft, executionMs: number) {
  const amount = result.amount ?? result.receipt?.amount ?? result.requiredAmount ?? "";
  const relayTx = result.relayTransactionHash ?? result.receipt?.relayTransactionHash ?? "";
  const paymentTx = result.paymentTransactionHash ?? result.receipt?.paymentTransactionHash ?? "";
  const payerAddress = result.payerAddress ?? result.receipt?.payerAddress ?? "";
  const payerIndex = result.payerIndex ?? result.receipt?.payerIndex ?? "";
  const body = summarizePaidContent(result.body);
  const payerLabel = result.reused === true ? "Reused payer" : "Fresh payer";
  return [
    `**Private x402 complete** · **${amount || "paid"} USDC**`,
    "",
    `Endpoint \`${result.url ?? draft.url}\``,
    payerAddress ? `${payerLabel} \`${payerAddress}\`${payerIndex ? ` · index \`${payerIndex}\`` : ""}` : "",
    relayTx ? `Private withdraw ${baseScanTxUrl(relayTx)}` : "",
    paymentTx ? `x402 payment ${baseScanTxUrl(paymentTx)}` : "",
    result.status ? `HTTP status \`${result.status}\`` : "",
    "",
    body ? `Content received:\n${body}` : "Content received.",
    "",
    `Timing **${formatDuration(executionMs)}**`,
  ].filter(Boolean).join("\n");
}

function reusableX402PayerIndex(result: VeilMcpX402Result) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const candidate = candidates.find((item) => typeof item?.payerIndex === "string" && /^\d+$/.test(item.payerIndex));
  return candidate?.payerIndex ?? "";
}

function summarizePaidContent(value: unknown) {
  if (value == null) return "";
  const rawText = typeof value === "string" ? value.trim() : JSON.stringify(value, null, 2);
  if (!rawText.trim()) return "";
  const jsonText = typeof value === "string"
    ? prettyJsonText(rawText)
    : rawText;
  const text = jsonText || rawText;
  const clipped = text.length > 1_200 ? `${text.slice(0, 1_200).trimEnd()}\n...` : text;
  return jsonText
    ? `\`\`\`json\n${clipped}\n\`\`\``
    : clipped;
}

function prettyJsonText(value: string) {
  const trimmed = value.trim();
  const candidates = [
    trimmed,
    extractBalancedJsonText(trimmed),
    /^"[^"]+"\s*:/.test(trimmed) ? `{${trimmed}}` : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.stringify(JSON.parse(candidate), null, 2);
    } catch {
      // Try the next candidate.
    }
  }
  return "";
}

function extractBalancedJsonText(value: string) {
  const start = value.search(/[{\[]/);
  if (start < 0) return "";
  const open = value[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth === 0) return value.slice(start, index + 1);
  }
  return "";
}

function privateX402ErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Veil private x402 payment failed.";
  if (message === "VEIL_MCP_MISSING") return "Veil MCP is not installed. Run Setup Veil to install @veil-cash/mcp before private x402 payments.";
  if (message === "VEIL_CLI_MISSING" || /ENOENT/.test(message)) return "Veil CLI is not installed. Run Setup Veil before private x402 payments.";
  if (/^fetch failed$/i.test(message)) return "Veil MCP fetch failed while reaching the x402 endpoint or payment service.";
  return message.replace(/0x[a-fA-F0-9]{64,}/g, "[redacted]");
}

function privateTransferExecutionKey(profile: AgentProfile, draft: PrivateTransferDraft) {
  return [
    profile.id,
    draft.asset,
    Number(draft.amount).toFixed(6),
    draft.recipient.toLowerCase(),
  ].join(":");
}

function prunePrivateTransferExecutions() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, value] of privateTransferExecutions.entries()) {
    if (value.startedAt < cutoff) privateTransferExecutions.delete(key);
  }
}

function duplicatePaymentGuardEnabled(wallet: AgentWalletConfig | undefined) {
  return wallet?.duplicatePaymentGuardEnabled !== false && duplicatePaymentGuardSeconds(wallet) > 0;
}

function duplicatePaymentGuardSeconds(wallet: AgentWalletConfig | undefined) {
  const seconds = Number(wallet?.duplicatePaymentGuardSeconds);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS;
}

function isPendingShieldMessage(message: string) {
  return /shielding (started|is already queued)|will complete the private send after veil accepts/i.test(message);
}

function isIncompletePrivateTransferMessage(message: string) {
  return /private send submitted/i.test(message) && (!/\bproof:\s*https:\/\/basescan\.org\/tx\//i.test(message) || !/remaining spend balance:/i.test(message));
}

function findLatestPrivateTransferRequest(messages: IncomingMessage[]): PrivateTransferDraft | null {
  const latest = latestUserMessage(messages);
  return parsePrivateTransferRequest(messageText(latest));
}

function findPrivateTransferDraft(messages: IncomingMessage[]): PrivateTransferDraft | null {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const draft = parsePrivateTransferRequest(messageText(messages[index]));
    if (draft) return draft;
  }
  return null;
}

function parsePrivateTransferRequest(text: string): PrivateTransferDraft | null {
  if (!/private|privately/i.test(text)) return null;
  const recipient = text.match(/0x[a-fA-F0-9]{40}/)?.[0];
  const amountMatch = text.match(/(?:send(?:ing)?|private send:?)?\s*\$?(\d+(?:\.\d{1,6})?)\s*USDC/i)
    ?? text.match(/\bUSDC\s+(\d+(?:\.\d{1,6})?)/i);
  if (!recipient || !amountMatch) return null;
  return { asset: "USDC", amount: amountMatch[1], recipient };
}

async function validateNaturalPrivateTransfer(wallet: AgentWalletConfig | undefined, draft: PrivateTransferDraft) {
  if (!wallet) return "No wallet is configured for this agent.";
  if (!wallet.enabled) {
    return [
      `Private send draft: ${draft.amount} ${draft.asset} to ${draft.recipient} on Base.`,
      "Wallet spending is off for this agent, so I did not submit a transaction.",
      "Turn Spend on for this agent to let HivemindOS execute the private send automatically.",
    ].join("\n");
  }
  return validateConfirmedPrivateTransfer(wallet, draft);
}

async function validateConfirmedPrivateTransfer(wallet: AgentWalletConfig | undefined, draft: PrivateTransferDraft) {
  if (!wallet) return "No wallet is configured for this agent.";
  if (!wallet.enabled) return "Wallet spending is off for this agent. Enable Spend on before executing private transfers.";
  if (wallet.provider !== "veil") return "This agent is not configured for the Veil private-transfer rail.";
  if (wallet.network !== VEIL_CASH_NETWORK) return "Veil private transfers are only supported on Base mainnet.";
  if (!/^0x[a-fA-F0-9]{40}$/.test(draft.recipient)) return "Recipient must be a valid 0x Ethereum address.";
  const amount = Number(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "Amount must be a positive USDC value.";
  if (amount < VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM) return `Veil public-recipient USDC withdrawals currently require at least ${VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM} USDC.`;
  if (amount > wallet.maxPaymentUsd) return `Amount exceeds this agent's USDC spend cap ($${wallet.maxPaymentUsd.toFixed(2)}).`;
  if (!await veilEnvValue("VEIL_KEY")) return "VEIL_KEY is not configured. Run Veil setup before private transfers.";
  return "";
}

function privateTransferSse(message: string) {
  return new Response(
    ssePayload({ choices: [{ delta: { content: message } }] }) + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
  );
}

function privateTransferExecutionSse(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  draft: PrivateTransferDraft;
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
  executionKey: string;
  telemetryType: string;
}) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(ssePayload(payload)));
      const sendTool = async (type: string, label: string, detail?: string, status: "running" | "completed" | "failed" = "running") => {
        const event = { type, toolName: "privateTransfer", name: "privateTransfer", message: label, detail, status };
        send(event);
        await appendRuntimeChatSessionEvent(input.runtimeSessionId, label, detail, event).catch(() => undefined);
      };
      try {
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_START, "Preparing private transfer", `${input.draft.amount} ${input.draft.asset} to ${input.draft.recipient}`);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Validate spend policy",
          input.wallet ? `Spend on; cap ${formatMoney(input.wallet.maxPaymentUsd)} USDC; duplicate guard ${duplicatePaymentGuardEnabled(input.wallet) ? "on" : "off"}.` : "Spend policy already validated.",
          "completed",
        );
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Prepare private withdraw",
          `Using the configured Veil rail on Base for ${input.draft.amount} ${input.draft.asset}.`,
          "completed",
        );
        const result = await executeVeilPrivateTransfer({
          agentId: input.profile.id,
          asset: input.draft.asset,
          amount: input.draft.amount,
          recipient: input.draft.recipient,
          autoShield: true,
          waitForShieldCompletion: true,
          duplicateGuardEnabled: duplicatePaymentGuardEnabled(input.wallet),
          duplicateGuardSeconds: duplicatePaymentGuardSeconds(input.wallet),
          onProgress: (event) => {
            const eventType = event.status === "started"
              ? RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS
              : event.status === "failed"
                ? RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE
                : RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS;
            const detail = event.detail ? `${event.detail} · total ${formatDuration(event.elapsedMs)}` : `total ${formatDuration(event.elapsedMs)}`;
            const status = event.status === "started" ? "running" : event.status === "failed" ? "failed" : "completed";
            send({ type: eventType, toolName: "privateTransfer", name: "privateTransfer", message: event.label, detail, status });
            void appendRuntimeChatSessionEvent(input.runtimeSessionId, event.label, detail, { ...event, status }).catch(() => undefined);
          },
        });
        await recordRouteTelemetry(input.request, input.telemetryType, {
          ...telemetryPayloadForProfile(input.profile),
          asset: input.draft.asset,
          amount: input.draft.amount,
          recipient: input.draft.recipient,
          resultStatus: result.status,
          transferHash: result.status === "submitted" ? result.transfer.transactionHash : null,
          timingTotalMs: result.timings.totalMs ?? null,
          timings: result.timings.events.map((event) => ({
            label: event.label,
            elapsedMs: event.elapsedMs,
            status: event.status,
          })),
          elapsedMs: Date.now() - input.routeStartedAt,
        });
        if (result.status === "submitted") {
          await sendTool(
            RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
            "Confirm on Base",
            [result.transfer.transactionHash, result.transfer.blockNumber ? `block ${result.transfer.blockNumber}` : ""].filter(Boolean).join(" · "),
            "completed",
          );
        }
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS, "Read remaining spend balance", "Checking live agent spend balance.", "running");
        const remainingBalance = await readRemainingSpendBalance(input.wallet);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Read remaining spend balance",
          remainingBalance ? `Remaining ${remainingBalance}.` : "Remaining balance unavailable.",
          "completed",
        );
        const message = privateTransferResultMessage(result, input.draft, remainingBalance);
        privateTransferExecutions.set(input.executionKey, { status: "completed", startedAt: Date.now(), message });
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "Private transfer finished", privateTransferTimingSummary(result.timings), "completed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, result).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        privateTransferExecutions.delete(input.executionKey);
        const message = `Private send failed: ${veilPrivateTransferErrorMessage(error)}`;
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "Private transfer failed", veilPrivateTransferErrorMessage(error), "failed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function privateTransferResultMessage(
  result: Awaited<ReturnType<typeof executeVeilPrivateTransfer>>,
  draft: PrivateTransferDraft,
  remainingBalance?: string,
) {
  if (result.status === "shielding") {
    return [
      `**Private send shielding** · **${draft.amount} ${draft.asset}**`,
      "",
      `Recipient \`${draft.recipient}\``,
      result.shield.transactionHash ? `Shield proof ${baseScanTxUrl(result.shield.transactionHash)}` : "",
      result.shield.transactionHash ? `Shield tx \`${result.shield.transactionHash}\`` : "",
      result.shield.blockNumber ? `Shield block \`${result.shield.blockNumber}\`` : "",
      "",
      "HivemindOS will complete the private send after Veil accepts the deposit into the private pool.",
      [remainingBalance ? `Remaining **${remainingBalance}**` : "", `Timing **${privateTransferTimingCompact(result.timings)}**`].filter(Boolean).join(" · "),
    ].filter(Boolean).join("\n");
  }
  return [
    `**Private send complete** · **${draft.amount} ${draft.asset}**`,
    "",
    `Recipient \`${draft.recipient}\``,
    result.transfer.transactionHash ? `Proof ${baseScanTxUrl(result.transfer.transactionHash)}` : "",
    result.transfer.transactionHash ? `Tx \`${result.transfer.transactionHash}\`` : "",
    result.transfer.blockNumber ? `Block \`${result.transfer.blockNumber}\`` : "",
    "",
    [remainingBalance ? `Remaining **${remainingBalance}**` : "", `Timing **${privateTransferTimingCompact(result.timings)}**`].filter(Boolean).join(" · "),
  ].filter(Boolean).join("\n");
}

async function readRemainingSpendBalance(wallet: AgentWalletConfig | undefined) {
  const address = wallet?.walletAddress?.trim() || wallet?.vaultAddress?.trim();
  if (!address || !wallet?.network) return "";
  try {
    const balance = await getWalletBalance(address, wallet.network);
    return `${formatMoney(balance.tokenBalance)} ${balance.tokenSymbol}`;
  } catch {
    const fallback = Number(wallet.currentBalanceUsd);
    return Number.isFinite(fallback) ? `${formatMoney(fallback)} ${wallet.tokenSymbol || "USDC"}` : "";
  }
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function baseScanTxUrl(hash: string) {
  return `https://basescan.org/tx/${hash}`;
}

function privateTransferTimingSummary(timings: Awaited<ReturnType<typeof executeVeilPrivateTransfer>>["timings"]) {
  const parts = timings.events
    .filter((event) => event.status === "completed")
    .map((event) => `${event.label}: ${formatDuration(event.elapsedMs)}`);
  return [`Timing: total ${formatDuration(timings.totalMs ?? 0)}`, parts.length ? parts.join("; ") : ""].filter(Boolean).join(" · ");
}

function privateTransferTimingCompact(timings: Awaited<ReturnType<typeof executeVeilPrivateTransfer>>["timings"]) {
  const parts = timings.events
    .filter((event) => event.status === "completed")
    .map((event) => `${event.label}: ${formatDuration(event.elapsedMs)}`);
  return [`total ${formatDuration(timings.totalMs ?? 0)}`, ...parts].join(" · ");
}

function formatDuration(ms: number) {
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function messageText(message?: IncomingMessage) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => part.text ?? "").join("\n");
}

function safeAgentEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof entry === "string") env[key] = entry;
  }
  return Object.keys(env).length ? env : undefined;
}

function extractUserText(messages: IncomingMessage[]): string {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUserMessage) return "";
  if (typeof lastUserMessage.content === "string") return lastUserMessage.content;
  return lastUserMessage.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ");
}

function messageHasContent(message: IncomingMessage) {
  if (typeof message.content === "string") return Boolean(message.content.trim());
  return message.content.some((part) => {
    if (part.type === "text") return Boolean(part.text?.trim());
    if (part.type === "image_url") return Boolean(part.image_url?.url);
    if (part.type === "file") return Boolean(part.file?.file_data);
    return false;
  });
}

function latestUserMessage(messages: IncomingMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user" && messageHasContent(message));
}

function attachmentPromptSummary(message?: IncomingMessage) {
  if (!message || typeof message.content === "string") return "";
  const images = message.content.filter((part) => part.type === "image_url" && part.image_url?.url).length;
  const files = message.content.filter((part) => part.type === "file" && part.file?.file_data).length;
  const pieces = [
    images ? `${images} image${images === 1 ? "" : "s"}` : "",
    files ? `${files} file${files === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return pieces.length ? `Please respond to the attached ${pieces.join(" and ")}.` : "";
}

function streamEventForPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string") {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.ERROR, error: record.error });
  }
  if (typeof record.type === "string" && record.type !== RUNTIME_STREAM_EVENT_TYPES.TEXT_DELTA) {
    return normalizeRuntimeStreamEvent(record as RuntimeStreamEvent);
  }
  const chunk = extractChunk(payload);
  if (chunk) {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.TEXT_DELTA, delta: chunk });
  }
  if (record.tool_call && typeof record.tool_call === "object") {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, ...(record.tool_call as Record<string, unknown>) });
  }
  if (record.status && typeof record.status === "object") {
    return normalizeRuntimeStreamEvent({ type: "chat.status", ...(record.status as Record<string, unknown>) });
  }
  if (record.clarify && typeof record.clarify === "object") {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.CLARIFY, ...(record.clarify as Record<string, unknown>) });
  }
  if (record.prompt && typeof record.prompt === "object") {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.CLARIFY, ...(record.prompt as Record<string, unknown>) });
  }
  if (record.session && typeof record.session === "object") {
    return normalizeRuntimeStreamEvent({ type: RUNTIME_STREAM_EVENT_TYPES.SESSION, ...(record.session as Record<string, unknown>) });
  }
  return undefined;
}

function ssePayload(payload: unknown): string {
  const event = streamEventForPayload(payload);
  const enriched = event && payload && typeof payload === "object" && !("event" in payload)
    ? { ...(payload as Record<string, unknown>), event }
    : payload;
  return `data: ${JSON.stringify(enriched)}\n\n`;
}

function extractChunk(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = payload as {
    reasoning?: string;
    delta?: string;
    text?: string;
    content?: string;
    message?: { content?: string; reasoning?: string };
    choices?: Array<{ delta?: { content?: string; reasoning?: string }; text?: string; message?: { content?: string; reasoning?: string } }>;
  };
  return (
    value.choices?.[0]?.delta?.content ??
    value.choices?.[0]?.text ??
    value.choices?.[0]?.message?.content ??
    value.delta ??
    value.text ??
    value.content ??
    value.message?.content ??
    ""
  );
}

function extractReasoningChunk(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const value = payload as {
    reasoning?: string;
    message?: { reasoning?: string };
    choices?: Array<{ delta?: { reasoning?: string }; message?: { reasoning?: string } }>;
  };
  return (
    value.choices?.[0]?.delta?.reasoning ??
    value.choices?.[0]?.message?.reasoning ??
    value.reasoning ??
    value.message?.reasoning ??
    ""
  );
}

function isTerminalOpenAiStreamMetadata(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return false;
  return choices.every((choice) => {
    if (!choice || typeof choice !== "object") return false;
    const entry = choice as {
      delta?: { content?: unknown; reasoning?: unknown; tool_calls?: unknown; function_call?: unknown };
      finish_reason?: unknown;
      message?: { content?: unknown; reasoning?: unknown; tool_calls?: unknown };
      text?: unknown;
    };
    if (typeof entry.finish_reason !== "string" || !entry.finish_reason.trim()) return false;
    const text = [
      entry.delta?.content,
      entry.delta?.reasoning,
      entry.message?.content,
      entry.message?.reasoning,
      entry.text,
    ].map((value) => String(value ?? "")).join("").trim();
    return (
      !text
      && !entry.delta?.tool_calls
      && !entry.delta?.function_call
      && !entry.message?.tool_calls
    );
  });
}

type ChannelMarkupState = {
  channel: "content" | "thinking";
  pending: string;
};

const channelControlPattern = /<channel>\s*(thought|thinking|analysis|reasoning|final|message|content|assistant|response)\s*<\/channel>|<\|?channel\|?>\s*(thought|thinking|analysis|reasoning|final|message|content|assistant|response)\s*|<\|?message\|?>|<\/channel>/gi;

function createChannelMarkupState(): ChannelMarkupState {
  return { channel: "content", pending: "" };
}

function routeChannelMarkupDelta(
  value: string,
  state: ChannelMarkupState,
): { content: string; thinking: string } {
  let input = `${state.pending}${value}`;
  state.pending = "";

  const pendingStart = input.lastIndexOf("<");
  if (pendingStart >= 0 && !input.slice(pendingStart).includes(">")) {
    state.pending = input.slice(pendingStart);
    input = input.slice(0, pendingStart);
  }

  let cursor = 0;
  let content = "";
  let thinking = "";
  const append = (text: string) => {
    if (!text) return;
    if (state.channel === "thinking") thinking += text;
    else content += text;
  };

  for (const match of input.matchAll(channelControlPattern)) {
    const index = match.index ?? 0;
    append(input.slice(cursor, index));
    const channel = String(match[1] ?? match[2] ?? "").trim().toLowerCase();
    if (/^(thought|thinking|analysis|reasoning)$/.test(channel)) {
      state.channel = "thinking";
    } else if (/^(final|message|content|assistant|response)$/.test(channel)) {
      state.channel = "content";
    }
    cursor = index + match[0].length;
  }
  append(input.slice(cursor));

  return { content, thinking };
}

function isOpenAICompatibleRuntime(profile: AgentProfile) {
  return profile.runtime === HIVEMIND_OS_RUNTIME;
}

function buildOpenAICompatibleUrl(profile: AgentProfile) {
  const base = profile.gatewayUrl.trim().replace(/\/+$/, "");
  const suffix = profile.chatPath?.trim() || "/v1/chat/completions";
  return remoteCollectorLocalServiceUrl(profile, `${base}${suffix.startsWith("/") ? suffix : `/${suffix}`}`);
}

function openAICompatibleModel(profile: AgentProfile) {
  if (isBankrLlmProfile(profile)) return bankrLlmModel(profile);
  return profile.model?.trim() || process.env.LOCAL_OPENAI_MODEL?.trim() || process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL?.trim() || "local-model";
}

function isLocalLmStudioProfile(profile: AgentProfile) {
  return profile.runtime === HIVEMIND_OS_RUNTIME
    && profile.provider === "lm-studio"
    && isLocalCollectorUrl(profile.telemetryUrl);
}

function lmStudioCliEnv() {
  return {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    TERM: "dumb",
    PATH: [join(homedir(), ".lmstudio", "bin"), process.env.PATH].filter(Boolean).join(delimiter),
  };
}

async function resolveLmStudioCliBin() {
  const candidates = [
    join(homedir(), ".lmstudio", "bin", "lms"),
    "/opt/homebrew/bin/lms",
    "/usr/local/bin/lms",
    "lms",
  ];
  for (const candidate of candidates) {
    if (candidate === "lms") return candidate;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next common LM Studio CLI location.
    }
  }
  return "lms";
}

function stripTerminalControls(value: string) {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r[^\n]*/g, "")
    .trim();
}

type BestEffortPreflightResult<T> = {
  value: T;
  timedOut: boolean;
  failed: boolean;
};

async function bestEffortPreflight<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<BestEffortPreflightResult<T>> {
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

function isAdaptiveOpenRouterProfile(profile: AgentProfile) {
  return profile.provider?.trim().toLowerCase() === "openrouter" && profile.model?.trim().toLowerCase() === "adaptive";
}

function profileWithResolvedModel(profile: AgentProfile, model: string): AgentProfile {
  return model && model !== profile.model ? { ...profile, model } : profile;
}

function buildAdaptiveOpenRouterResolvedModelContext(profile: AgentProfile, model: string): string {
  if (!isAdaptiveOpenRouterProfile(profile) && !(isOpenRouterProvider(profile) && Boolean(profile.adaptiveOpenRouter))) return "";
  const configuredModel = [profile.provider, profile.model].filter(Boolean).join("/") || "adaptive";
  return [
    "Adaptive OpenRouter routing context:",
    `- Configured adaptive model: ${configuredModel}`,
    `- Concrete model selected for this request: ${model}`,
    "- If the user asks which model is responding, answer with the concrete model selected for this request, not the adaptive configuration name.",
    "- Do not claim the OpenRouter endpoint cannot be verified; this request is already being served through the selected concrete model.",
  ].join("\n");
}

function isOpenRouterProvider(profile: AgentProfile) {
  return profile.provider?.trim().toLowerCase() === "openrouter";
}

function parseEnvFileValue(raw: string, key: string) {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.*)\\s*$`, "m");
  const match = raw.match(pattern);
  if (!match) return "";
  const value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

async function openRouterApiKey() {
  const existing = process.env.OPENROUTER_API_KEY?.trim();
  if (existing) return existing;
  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    const value = parseEnvFileValue(raw, "OPENROUTER_API_KEY");
    if (value) return value;
  }
  return "";
}

async function openRouterCompatibleProfile(profile: AgentProfile) {
  const model = profile.model?.trim();
  if (!model) throw new Error("OpenRouter model is required.");
  const token = profile.token?.trim() || await openRouterApiKey();
  if (!token) throw new Error("OPENROUTER_API_KEY is required for OpenRouter Adaptive agents.");
  return {
    ...profile,
    runtime: HIVEMIND_OS_RUNTIME as AgentProfile["runtime"],
    gatewayUrl: "https://openrouter.ai/api",
    chatPath: "/v1/chat/completions",
    provider: "openrouter",
    model,
    token,
  };
}

function retryableAdaptiveOpenRouterStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status === 502 || status === 503 || status === 504;
}

function providerErrorMessage(body: string, status: number, model?: string) {
  const parsed = (() => {
    try {
      return JSON.parse(body || "{}") as { error?: { message?: string; code?: string | number }; message?: string };
    } catch {
      return null;
    }
  })();
  const rawMessage = parsed?.error?.message || parsed?.message || body.trim();
  if (status === 429) {
    return model
      ? `OpenRouter rate-limited ${model}. Adaptive will try another free model when available.`
      : "OpenRouter rate-limited this free model. Adaptive will try another free model when available.";
  }
  if (rawMessage) return rawMessage;
  return `Provider returned error (${status})`;
}

function finalAdaptiveOpenRouterError(status: number, modelAttempts: string[]) {
  if (status === 429) {
    return `OpenRouter's free models are currently rate-limited or out of promo capacity. Adaptive tried ${modelAttempts.length} configured model${modelAttempts.length === 1 ? "" : "s"}${modelAttempts.length ? `, ending with ${modelAttempts.at(-1)}` : ""}. Try again shortly or choose an optional paid fallback model in Adaptive advanced settings.`;
  }
  return `OpenRouter could not complete this Adaptive request after trying ${modelAttempts.length || 1} configured model${modelAttempts.length === 1 ? "" : "s"}.`;
}

function finalAdaptiveHermesOpenRouterError(attempts: string[], lastError: string) {
  const attempted = attempts.length
    ? ` Adaptive tried ${attempts.length} Hermes/OpenRouter model${attempts.length === 1 ? "" : "s"}, ending with ${attempts.at(-1)}.`
    : "";
  return `Hermes Adaptive OpenRouter could not produce assistant text.${attempted}${lastError ? ` Last error: ${lastError}` : ""}`;
}

function isHermesCliFailureText(value: string) {
  return /^(?:api call failed|provider resolver returned|unknown provider|session not found|hermes exited)\b/i.test(value.trim());
}

function finalAdaptiveProviderError(status: number, attempts: string[]) {
  const attempted = attempts.length ? ` Adaptive tried ${attempts.length} route${attempts.length === 1 ? "" : "s"}, ending with ${attempts.at(-1)}.` : "";
  if (status === 429) return `Adaptive free routing is currently rate-limited or out of free capacity.${attempted} Try again shortly or disable that provider in Adaptive settings.`;
  return `Adaptive could not complete this request.${attempted}`;
}

async function recordChatHoney(profile: AgentProfile, inputText: string, outputText: string, enabled: boolean, source: "chat" | "kanban-chat" = "chat") {
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

function validateHttpRuntimeProfile(profile: AgentProfile): string | null {
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

function runtimeFetchError(profile: AgentProfile, url: string, error: unknown) {
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

function runtimeStreamErrorMessage(profile: AgentProfile, error: unknown) {
  const reason = error instanceof Error ? error.message : "";
  const aborted = error instanceof Error && error.name === "AbortError";
  if (aborted || /^(terminated|aborted)$/i.test(reason)) {
    return `Connection to ${profile.name || profile.runtime} closed before a final response arrived. The local agent bridge may have restarted or the stream was interrupted; retry the message.`;
  }
  return reason || "Runtime stream failed";
}

async function collectorChatProfile(profile: AgentProfile): Promise<AgentProfile | null> {
  if (profile.runtime !== "hermes") return null;
  if (!profile.telemetryUrl?.trim()) return null;
  return {
    ...profile,
    gatewayUrl: await canonicalLocalCollectorUrl(profile),
    chatPath: "/chat",
  };
}

async function streamAdaptiveHermesOpenRouterRuntime(
  profile: AgentProfile,
  messages: IncomingMessage[],
  userText: string,
  sharedVault: SharedVaultConfig | null,
  agentMode: AgentMode,
  url: string,
  lockKey: string,
  workingDirectory?: string,
  wallet?: AgentWalletConfig,
  honeyLedgerEnabled = false,
  runtimeSessionId = "",
  telemetry?: RuntimeRouteTelemetry,
  taskRetrievalContext = "",
  sharedBrainMemoryContext = "",
  vaultPromptContext = "",
) {
  let candidateModels: string[];
  try {
    candidateModels = await resolveAdaptiveOpenRouterModels(profile, messages);
  } catch (error) {
    releaseInteractiveRuntime(lockKey);
    return Response.json({ error: error instanceof Error ? error.message : "Adaptive OpenRouter model selection failed." }, { status: 502 });
  }
  const fallbackModel = profile.adaptiveOpenRouter?.fallbackModel?.trim()
    || profile.adaptiveRouting?.fallbackModel?.trim()
    || DEFAULT_ADAPTIVE_HERMES_OPENROUTER_FALLBACK_MODEL;
  if (fallbackModel) {
    const freeModels = candidateModels.filter((model) => model !== fallbackModel);
    candidateModels = [...freeModels.slice(0, ADAPTIVE_HERMES_OPENROUTER_FREE_ATTEMPTS), fallbackModel];
  } else {
    candidateModels = candidateModels.slice(0, ADAPTIVE_HERMES_OPENROUTER_FREE_ATTEMPTS);
  }
  const openRouterToken = await openRouterApiKey().catch(() => "");

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const fetchStartedAt = Date.now();
  const readable = new ReadableStream({
    async start(controller) {
      let streamClosed = false;
      const safeEnqueue = (payload: string) => {
        if (streamClosed) return false;
        try {
          controller.enqueue(encoder.encode(payload));
          return true;
        } catch {
          streamClosed = true;
          return false;
        }
      };
      const safeClose = () => {
        if (streamClosed) return;
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // The browser may have already closed the SSE stream.
        }
      };
      let sessionWrite = Promise.resolve();
      const queueSessionWrite = (operation: () => Promise<void>) => {
        if (!runtimeSessionId) return;
        sessionWrite = sessionWrite.then(operation, operation).catch(() => undefined);
      };
      if (runtimeSessionId) {
        safeEnqueue(ssePayload({
          session: { id: runtimeSessionId, runtime: profile.runtime, source: "hivemindos-chat", startedAt: fetchStartedAt },
        }));
      }

      const attemptedModels: string[] = [];
      let lastError = "";
      try {
        for (const candidateModel of candidateModels) {
          const candidateProfile = profileWithResolvedModel(profile, candidateModel);
          const promptEnvelope = buildHivemindPromptEnvelope({
            profile: candidateProfile,
            agentMode,
            workingDirectory,
            vaultContext: vaultPromptContext,
            sharedBrainMemoryContext,
            taskRetrievalContext,
            wallet,
            runtimeSessionId,
            extraDynamicContext: buildAdaptiveOpenRouterResolvedModelContext(profile, candidateModel),
          });
          const runtimeMessages = prependHivemindSystemMessage(messages, promptEnvelope);
          attemptedModels.push(`openrouter/${candidateModel}`);
          recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.fetch.start", {
            ...telemetryPayloadForProfile(candidateProfile),
            url,
            model: candidateModel,
            adaptiveOpenRouter: true,
            attempt: attemptedModels.length,
            remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
          });

          let upstream: Response;
          const attemptController = new AbortController();
          const attemptTimer = setTimeout(() => attemptController.abort(), ADAPTIVE_HERMES_OPENROUTER_ATTEMPT_TIMEOUT_MS);
          try {
            upstream = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(profile.token ? { Authorization: `Bearer ${profile.token}` } : {}),
              },
              body: JSON.stringify({
                agent: candidateProfile,
                agentId: candidateProfile.agentId || candidateProfile.id,
                sessionKey: candidateProfile.sessionKey,
                provider: candidateProfile.provider || undefined,
                model: candidateModel,
                agentEnv: safeAgentEnv({
                  ...candidateProfile.agentEnv,
                  ...(openRouterToken ? { OPENROUTER_API_KEY: openRouterToken } : {}),
                }),
                rawUserMessage: userText,
                forceHermesCli: true,
                disableHermesResume: true,
                agentMode,
                mode: agentMode,
                runtimeSessionId: runtimeSessionId || undefined,
                hermesSessionId: runtimeSessionId || undefined,
                message: userText,
                messages: runtimeMessages,
                stream: true,
                sharedVault,
                obsidianVault: sharedVault,
                workingDirectory,
                controlRoomPath: sharedVault?.controlRoomPath,
                wallet,
                walletTools: buildWalletTools(wallet),
                context: promptEnvelope.systemContext || undefined,
              }),
              signal: attemptController.signal,
            });
          } catch (error) {
            clearTimeout(attemptTimer);
            lastError = runtimeFetchError(candidateProfile, url, error);
            recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.fetch.failed", {
              ...telemetryPayloadForProfile(candidateProfile),
              url,
              model: candidateModel,
              adaptiveOpenRouter: true,
              errorName: error instanceof Error ? error.name : null,
              errorMessage: error instanceof Error ? error.message : String(error),
              attempt: attemptedModels.length,
              remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
              elapsedMs: Date.now() - fetchStartedAt,
            });
            queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive retry", lastError));
            continue;
          }

          if (!upstream.ok || !upstream.body) {
            clearTimeout(attemptTimer);
            const errorText = await upstream.text().catch(() => "");
            lastError = errorText || `Hermes returned ${upstream.status || 502} for ${candidateModel}.`;
            recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.upstream_error", {
              ...telemetryPayloadForProfile(candidateProfile),
              url,
              model: candidateModel,
              adaptiveOpenRouter: true,
              status: upstream.status,
              bodyPreview: lastError.slice(0, 500),
              attempt: attemptedModels.length,
              remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
              elapsedMs: Date.now() - fetchStartedAt,
            });
            queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive retry", lastError));
            continue;
          }

          const reader = upstream.body.getReader();
          let buffer = "";
          let fullText = "";
          let sawFirstChunk = false;
          let textDeltaCount = 0;
          const channelMarkupState = createChannelMarkupState();
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (!sawFirstChunk) {
                sawFirstChunk = true;
                recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.stream.first_chunk", {
                  ...telemetryPayloadForProfile(candidateProfile),
                  url,
                  model: candidateModel,
                  adaptiveOpenRouter: true,
                  byteLength: value.byteLength,
                  attempt: attemptedModels.length,
                  streamElapsedMs: Date.now() - fetchStartedAt,
                });
              }
              buffer += decoder.decode(value, { stream: true });
              const events = buffer.split("\n\n");
              buffer = events.pop() ?? "";
              for (const eventText of events) {
                const dataLine = eventText.split("\n").find((line) => line.startsWith("data:"));
                if (!dataLine) {
                  if (eventText.trim().startsWith(":")) safeEnqueue(`${eventText}\n\n`);
                  continue;
                }
                const raw = dataLine.replace(/^data:\s*/, "");
                if (raw === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(raw);
                  const errorMessage = typeof parsed?.error === "string"
                    ? parsed.error
                    : typeof parsed?.error?.message === "string"
                      ? parsed.error.message
                      : "";
                  if (errorMessage.trim()) {
                    lastError = errorMessage.trim();
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", `${candidateModel}: ${lastError}`, parsed));
                    continue;
                  }
                  const outputCheck = proxyOutput(extractChunk(parsed));
                  const reasoningCheck = proxyOutput(extractReasoningChunk(parsed));
                  if (outputCheck.verdict === "block") {
                    lastError = outputCheck.reason ?? "Response blocked by security policy";
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", lastError, parsed));
                    continue;
                  }
                  if (reasoningCheck.verdict === "block") {
                    lastError = reasoningCheck.reason ?? "Response blocked by security policy";
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", lastError, parsed));
                    continue;
                  }
                  const routed = routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
                  const thinking = [reasoningCheck.text, routed.thinking].filter(Boolean).join("");
                  if (thinking) {
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", thinking, parsed));
                    safeEnqueue(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: thinking }));
                  }
                if (routed.content) {
                  if (isHermesCliFailureText(routed.content)) {
                    lastError = routed.content.trim();
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", `${candidateModel}: ${lastError}`, parsed));
                  } else {
                    fullText += routed.content;
                    textDeltaCount += 1;
                    queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", routed.content, parsed));
                    safeEnqueue(ssePayload({ choices: [{ delta: { content: routed.content } }] }));
                  }
                  } else if (!thinking && isTerminalOpenAiStreamMetadata(parsed)) {
                    continue;
                  } else if (!thinking && parsed?.session) {
                    safeEnqueue(ssePayload(parsed));
                  } else if (!thinking) {
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(
                      runtimeSessionId,
                      typeof parsed?.type === "string" ? parsed.type : typeof parsed?.event?.type === "string" ? parsed.event.type : "Runtime event",
                      typeof parsed?.message === "string" ? parsed.message : undefined,
                      parsed,
                    ));
                  }
                } catch {
                  const outputCheck = proxyOutput(raw);
                  const routed = outputCheck.verdict === "block"
                    ? { content: "", thinking: "" }
                    : routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
                  if (outputCheck.verdict === "block") {
                    lastError = outputCheck.reason ?? "Response blocked by security policy";
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", lastError));
                  } else {
                    if (routed.thinking) {
                      queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", routed.thinking));
                      safeEnqueue(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: routed.thinking }));
                    }
                    if (routed.content) {
                      if (isHermesCliFailureText(routed.content)) {
                        lastError = routed.content.trim();
                        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", lastError));
                      } else {
                        fullText += routed.content;
                        textDeltaCount += 1;
                        queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", routed.content));
                        safeEnqueue(ssePayload({ choices: [{ delta: { content: routed.content } }] }));
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            lastError = runtimeStreamErrorMessage(candidateProfile, error);
            recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.stream.failed", {
              ...telemetryPayloadForProfile(candidateProfile),
              url,
              model: candidateModel,
              adaptiveOpenRouter: true,
              message: lastError,
              attempt: attemptedModels.length,
              remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
              streamElapsedMs: Date.now() - fetchStartedAt,
            });
            queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive retry", `${candidateModel}: ${lastError}`));
          } finally {
            clearTimeout(attemptTimer);
          }

          if (fullText.trim()) {
            const event = await recordChatHoney(candidateProfile, userText, fullText, honeyLedgerEnabled);
            if (event) safeEnqueue(ssePayload({ honey: event }));
            safeEnqueue("data: [DONE]\n\n");
            recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.stream.completed", {
              ...telemetryPayloadForProfile(candidateProfile),
              url,
              model: candidateModel,
              adaptiveOpenRouter: true,
              attempt: attemptedModels.length,
              outputLength: fullText.length,
              textDeltaCount,
              attemptedModels,
              streamElapsedMs: Date.now() - fetchStartedAt,
            });
            queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "completed"));
            await sessionWrite.catch(() => undefined);
            releaseInteractiveRuntime(lockKey);
            safeClose();
            return;
          }

          lastError ||= `Hermes returned no assistant text for ${candidateModel}.`;
          recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.empty_model", {
            ...telemetryPayloadForProfile(candidateProfile),
            url,
            model: candidateModel,
            adaptiveOpenRouter: true,
            attempt: attemptedModels.length,
            remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
            lastError,
            streamElapsedMs: Date.now() - fetchStartedAt,
          });
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive retry", `${candidateModel}: ${lastError}`));
        }

        const message = finalAdaptiveHermesOpenRouterError(attemptedModels, lastError);
        safeEnqueue(ssePayload({ error: message }));
        safeEnqueue("data: [DONE]\n\n");
        recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.failed", {
          ...telemetryPayloadForProfile(profile),
          url,
          adaptiveOpenRouter: true,
          attemptedModels,
          lastError,
          elapsedMs: Date.now() - fetchStartedAt,
        });
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive failed", message));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
      } catch (error) {
        const message = runtimeStreamErrorMessage(profile, error);
        safeEnqueue(ssePayload({ error: message }));
        safeEnqueue("data: [DONE]\n\n");
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive stream failed", message));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
      } finally {
        await sessionWrite.catch(() => undefined);
        releaseInteractiveRuntime(lockKey);
        safeClose();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function streamHttpRuntime(
  profile: AgentProfile,
  messages: IncomingMessage[],
  userText: string,
  sharedVault: SharedVaultConfig | null,
  agentMode: AgentMode,
  workingDirectory?: string,
  wallet?: AgentWalletConfig,
  honeyLedgerEnabled = false,
  runtimeSessionId = "",
  telemetry?: RuntimeRouteTelemetry,
  taskRetrievalContext = "",
  sharedBrainMemoryContext = "",
  vaultPromptContext = "",
) {
  const inputCheck = proxyInput(userText);
  if (inputCheck.verdict === "block") {
    return Response.json({ error: inputCheck.reason ?? "Message blocked by security policy" }, { status: 400 });
  }
  if (isAdaptiveProviderProfile(profile)) {
    try {
      const adaptiveRoutePlan = await resolveAdaptiveRoutePlan(profile, messages);
      if (adaptiveRoutePlan.profile.runtime === HIVEMIND_OS_RUNTIME) {
        return streamOpenAICompatibleRuntime(adaptiveRoutePlan.profile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, adaptiveRoutePlan, vaultPromptContext);
      }
      profile = adaptiveRoutePlan.profile;
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Adaptive provider routing failed." }, { status: 502 });
    }
  }
  if (isBankrLlmProfile(profile)) {
    return streamOpenAICompatibleRuntime(profile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, undefined, vaultPromptContext);
  }
  if (isOpenAICompatibleRuntime(profile)) {
    return streamOpenAICompatibleRuntime(profile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, undefined, vaultPromptContext);
  }
  if (isOpenRouterProvider(profile) && !isAdaptiveOpenRouterProfile(profile)) {
    try {
      const openRouterProfile = await openRouterCompatibleProfile(profile);
      return streamOpenAICompatibleRuntime(openRouterProfile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, undefined, vaultPromptContext);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "OpenRouter model selection failed." }, { status: 502 });
    }
  }
  let runtimeProfile = profile;
  let adaptiveResolvedModel = "";
  if (isBankrAdaptiveModel(profile)) {
    try {
      const [resolvedModel] = await resolveAdaptiveBankrLlmModels(profile, messages);
      runtimeProfile = profileWithResolvedModel(profile, resolvedModel);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Adaptive Bankr model selection failed." }, { status: 502 });
    }
  }
  if (isAdaptiveOpenRouterProfile(profile) && profile.runtime !== "hermes") {
    try {
      adaptiveResolvedModel = await resolveAdaptiveOpenRouterModel(profile, messages);
      runtimeProfile = profileWithResolvedModel(profile, adaptiveResolvedModel);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Adaptive OpenRouter model selection failed." }, { status: 502 });
    }
  }
  const url = getRuntimeUrl(profile, profile.chatPath || "/chat");
  const lockKey = interactiveRuntimeLockKey(profile, url);
  if (!reserveInteractiveRuntime(lockKey)) {
    const message = `${profile.name || profile.runtime} is already running another interactive request at ${url}. Wait for that run to finish before sending another chat, scheduler run, or Kanban assignment.`;
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.busy", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
    });
    return Response.json({ error: message }, { status: 409 });
  }
  if (isAdaptiveOpenRouterProfile(profile) && profile.runtime === "hermes") {
    return streamAdaptiveHermesOpenRouterRuntime(profile, messages, userText, sharedVault, agentMode, url, lockKey, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, vaultPromptContext);
  }
  const vaultContext = vaultPromptContext;
  const promptEnvelope = buildHivemindPromptEnvelope({
    profile: runtimeProfile,
    agentMode,
    workingDirectory,
    vaultContext,
    sharedBrainMemoryContext,
    taskRetrievalContext,
    wallet,
    runtimeSessionId,
  });
  const hermesSlashCommand = profile.runtime === "hermes" && /^\/[^\s/]*(?:\s|$)/.test(inputCheck.text.trim());
  const runtimeMessages = hermesSlashCommand ? messages : prependHivemindSystemMessage(messages, promptEnvelope);
  const runtimeMessage = inputCheck.text;
  const workspaceBefore = await readWorkspaceSnapshot(workingDirectory);
  let upstream: Response;
  const fetchStartedAt = Date.now();
  let fetchSettled = false;
  const slowTimers = [10_000, 30_000, 60_000].map((waitMs) => setTimeout(() => {
    if (fetchSettled) return;
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.fetch.slow", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      waitMs,
      fetchElapsedMs: Date.now() - fetchStartedAt,
    });
  }, waitMs));
  try {
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.fetch.start", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model: runtimeProfile.model || null,
      adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
      contextLength: hermesSlashCommand ? 0 : promptEnvelope.systemContext.length,
      messageCount: runtimeMessages.length,
      runtimeMessageLength: runtimeMessage.length,
    });
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(profile.token ? { Authorization: `Bearer ${profile.token}` } : {}),
      },
      body: JSON.stringify({
        agent: runtimeProfile,
        agentId: runtimeProfile.agentId || runtimeProfile.id,
        sessionKey: runtimeProfile.sessionKey,
        provider: runtimeProfile.provider || undefined,
        model: runtimeProfile.model || undefined,
        agentEnv: safeAgentEnv(runtimeProfile.agentEnv),
        rawUserMessage: inputCheck.text,
        agentMode,
        mode: agentMode,
        runtimeSessionId: runtimeSessionId || undefined,
        hermesSessionId: runtimeSessionId || undefined,
        message: runtimeMessage,
        messages: runtimeMessages,
        stream: true,
        sharedVault,
        obsidianVault: sharedVault,
        workingDirectory,
        controlRoomPath: sharedVault?.controlRoomPath,
        wallet,
        walletTools: buildWalletTools(wallet),
        context: hermesSlashCommand ? undefined : promptEnvelope.systemContext || undefined,
      }),
      signal: AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
    });
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.fetch.response", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model: runtimeProfile.model || null,
      adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
      status: upstream.status,
      ok: upstream.ok,
      contentType: upstream.headers.get("content-type") ?? null,
      fetchElapsedMs: Date.now() - fetchStartedAt,
    });
  } catch (error) {
    releaseInteractiveRuntime(lockKey);
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.fetch.failed", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model: runtimeProfile.model || null,
      adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
      fetchElapsedMs: Date.now() - fetchStartedAt,
    });
    await appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime fetch failed", runtimeFetchError(profile, url, error)).catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    return Response.json(
      {
        error: runtimeFetchError(profile, url, error),
      },
      { status: 502 },
    );
  } finally {
    fetchSettled = true;
    slowTimers.forEach(clearTimeout);
  }

  if (!upstream.ok) {
    const errorText = await upstream.text().catch(() => "");
    const message = upstream.status === 404 && profile.runtime === "hermes" && profile.telemetryUrl
      ? "This machine's local agent bridge is connected but does not have the Hermes chat bridge yet. Run Update/Setup on that machine, then try again."
      : errorText || `${profile.runtime} returned ${upstream.status}`;
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.upstream_error", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model: runtimeProfile.model || null,
      adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
      status: upstream.status,
      bodyPreview: message.slice(0, 500),
      fetchElapsedMs: Date.now() - fetchStartedAt,
    });
    releaseInteractiveRuntime(lockKey);
    await appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime upstream error", message).catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    return new Response(
      ssePayload({ error: message }) + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.non_stream_response", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model: runtimeProfile.model || null,
      adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
      contentType,
      fetchElapsedMs: Date.now() - fetchStartedAt,
    });
    const json = await upstream.json().catch(async () => ({ text: await upstream.text().catch(() => "") }));
    const outputCheck = proxyOutput(extractChunk(json));
    if (outputCheck.verdict === "block") {
      releaseInteractiveRuntime(lockKey);
      return new Response(
        ssePayload({ error: outputCheck.reason ?? "Response blocked by security policy" }) + "data: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
      );
    }
    const chunk = outputCheck.text;
    const event = await recordChatHoney(runtimeProfile, userText, chunk, honeyLedgerEnabled);
    await appendRuntimeChatSessionText(runtimeSessionId, "assistant", chunk || JSON.stringify(json), json).catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "completed").catch(() => undefined);
    releaseInteractiveRuntime(lockKey);
    return new Response(
      ssePayload({ choices: [{ delta: { content: chunk || JSON.stringify(json) } }] })
      + (event ? ssePayload({ honey: event }) : "")
      + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readable = new ReadableStream({
    async start(controller) {
      let streamClosed = false;
      const safeEnqueue = (payload: string) => {
        if (streamClosed) return false;
        try {
          controller.enqueue(encoder.encode(payload));
          return true;
        } catch {
          streamClosed = true;
          return false;
        }
      };
      const safeClose = () => {
        if (streamClosed) return;
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // The browser may have already closed the SSE stream.
        }
      };
      let sessionWrite = Promise.resolve();
      const queueSessionWrite = (operation: () => Promise<void>) => {
        if (!runtimeSessionId) return;
        sessionWrite = sessionWrite.then(operation, operation).catch(() => undefined);
      };
      if (runtimeSessionId) {
        safeEnqueue(ssePayload({
          session: { id: runtimeSessionId, runtime: runtimeProfile.runtime, source: "hivemindos-chat", startedAt: fetchStartedAt },
        }));
      }
      const reader = upstream.body?.getReader();
      if (!reader) {
        safeEnqueue(ssePayload({ error: "Runtime response body is empty" }));
        safeEnqueue("data: [DONE]\n\n");
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime response body is empty"));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
        await sessionWrite.catch(() => undefined);
        releaseInteractiveRuntime(lockKey);
        safeClose();
        return;
      }

      let buffer = "";
      let fullText = "";
      let sawFirstChunk = false;
      let commentEventCount = 0;
      let dataEventCount = 0;
      let textDeltaCount = 0;
      let processEventCount = 0;
      let lastRuntimeError = "";
      const channelMarkupState = createChannelMarkupState();
      recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.start", {
        ...telemetryPayloadForProfile(runtimeProfile),
        url,
        model: runtimeProfile.model || null,
        adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
        fetchElapsedMs: Date.now() - fetchStartedAt,
      });
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!sawFirstChunk) {
            sawFirstChunk = true;
            recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.first_chunk", {
              ...telemetryPayloadForProfile(runtimeProfile),
              url,
              model: runtimeProfile.model || null,
              adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
              byteLength: value.byteLength,
              streamElapsedMs: Date.now() - fetchStartedAt,
            });
          }
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const eventText of events) {
            const dataLine = eventText.split("\n").find((line) => line.startsWith("data:"));
            if (!dataLine) {
              if (eventText.trim().startsWith(":")) {
                commentEventCount += 1;
                recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.comment", {
                  ...telemetryPayloadForProfile(runtimeProfile),
                  url,
                  model: runtimeProfile.model || null,
                  adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
                  commentEventCount,
                  preview: eventText.replace(/^:\s?/gm, "").trim().slice(0, 240),
                  streamElapsedMs: Date.now() - fetchStartedAt,
                });
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime stream comment", eventText.replace(/^:\s?/gm, "").trim()));
                safeEnqueue(`${eventText}\n\n`);
              }
              continue;
            }
            dataEventCount += 1;
            const raw = dataLine.replace(/^data:\s*/, "");
            if (raw === "[DONE]") continue;
            try {
              const parsed = JSON.parse(raw);
              let parsedRuntimeError = "";
              if (parsed && typeof parsed === "object") {
                const record = parsed as Record<string, unknown>;
                const event = record.event && typeof record.event === "object" ? record.event as Record<string, unknown> : null;
                const rawError = record.error ?? event?.error;
                const rawMessage = record.message ?? event?.message;
                if (typeof rawError === "string" && rawError.trim()) parsedRuntimeError = rawError.trim();
                else if (rawError && typeof rawError === "object") {
                  const nestedError = rawError as Record<string, unknown>;
                  const message = String(nestedError.message ?? nestedError.error ?? nestedError.detail ?? "").trim();
                  if (message) parsedRuntimeError = message;
                } else if (typeof rawMessage === "string" && /error|failed|failure|empty|without returning/i.test(rawMessage)) {
                  parsedRuntimeError = rawMessage.trim();
                }
                if (parsedRuntimeError) lastRuntimeError = parsedRuntimeError;
              }
              const rawOutput = extractChunk(parsed);
              const rawReasoning = extractReasoningChunk(parsed);
              if (parsedRuntimeError && !rawOutput.trim() && !rawReasoning.trim()) {
                processEventCount += 1;
                recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.error_event", {
                  ...telemetryPayloadForProfile(runtimeProfile),
                  url,
                  model: runtimeProfile.model || null,
                  adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
                  processEventCount,
                  message: parsedRuntimeError,
                  streamElapsedMs: Date.now() - fetchStartedAt,
                });
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime stream failed", parsedRuntimeError, parsed));
                queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", `Error: ${parsedRuntimeError}`));
                queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
                safeEnqueue(ssePayload({ error: parsedRuntimeError }));
                safeEnqueue("data: [DONE]\n\n");
                return;
              }
              const outputCheck = proxyOutput(rawOutput);
              const reasoningCheck = proxyOutput(rawReasoning);
              if (outputCheck.verdict === "block") {
                safeEnqueue(ssePayload({ error: outputCheck.reason ?? "Response blocked by security policy" }));
                continue;
              }
              if (reasoningCheck.verdict === "block") {
                safeEnqueue(ssePayload({ error: reasoningCheck.reason ?? "Response blocked by security policy" }));
                continue;
              }
              const routed = routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
              const thinking = [reasoningCheck.text, routed.thinking].filter(Boolean).join("");
              const chunk = routed.content;
              if (thinking) {
                processEventCount += 1;
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", thinking, parsed));
                safeEnqueue(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: thinking }));
              }
              if (chunk) {
                fullText += chunk;
                textDeltaCount += 1;
                queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", chunk, parsed));
                if (textDeltaCount === 1 || textDeltaCount % 20 === 0) {
                  recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.text_delta", {
                    ...telemetryPayloadForProfile(runtimeProfile),
                    url,
                    model: runtimeProfile.model || null,
                    adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
                    textDeltaCount,
                    outputLength: fullText.length,
                    streamElapsedMs: Date.now() - fetchStartedAt,
                  });
                }
              } else if (!thinking && isTerminalOpenAiStreamMetadata(parsed)) {
                continue;
              } else if (!thinking) {
                processEventCount += 1;
                const eventDetail = typeof parsed?.message === "string"
                  ? parsed.message
                  : typeof parsed?.error === "string"
                    ? parsed.error
                    : undefined;
                queueSessionWrite(() => appendRuntimeChatSessionEvent(
                  runtimeSessionId,
                  typeof parsed?.type === "string" ? parsed.type : typeof parsed?.event?.type === "string" ? parsed.event.type : "Runtime event",
                  eventDetail,
                  parsed,
                ));
                recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.process_event", {
                  ...telemetryPayloadForProfile(runtimeProfile),
                  url,
                  model: runtimeProfile.model || null,
                  adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
                  processEventCount,
                  eventType: typeof parsed?.type === "string" ? parsed.type : typeof parsed?.event?.type === "string" ? parsed.event.type : null,
                  keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 12) : [],
                  streamElapsedMs: Date.now() - fetchStartedAt,
                });
              }
              if (chunk) {
                safeEnqueue(ssePayload({ choices: [{ delta: { content: chunk } }] }));
              } else if (!thinking) {
                safeEnqueue(ssePayload(parsed));
              }
            } catch {
              const outputCheck = proxyOutput(raw);
              const routed = outputCheck.verdict === "block"
                ? { content: "", thinking: "" }
                : routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
              if (outputCheck.verdict !== "block" && routed.thinking) {
                processEventCount += 1;
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", routed.thinking));
                safeEnqueue(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: routed.thinking }));
              }
              if (outputCheck.verdict !== "block") fullText += routed.content;
              if (outputCheck.verdict !== "block" && routed.content) queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", routed.content));
              if (outputCheck.verdict === "block") {
                safeEnqueue(ssePayload({ error: outputCheck.reason ?? "Response blocked by security policy" }));
              } else if (routed.content) {
                safeEnqueue(ssePayload({ choices: [{ delta: { content: routed.content } }] }));
              }
            }
          }
        }
        if (!fullText.trim()) {
          const workspaceAfter = await readWorkspaceSnapshot(workingDirectory);
          const summary = workspaceChangeSummary(workspaceBefore, workspaceAfter);
          if (summary) {
            fullText = summary;
            safeEnqueue(ssePayload({ choices: [{ delta: { content: summary } }] }));
            queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", summary));
            recordRuntimeTelemetry(telemetry, "agent_runtime.http.workspace_completed", {
              ...telemetryPayloadForProfile(runtimeProfile),
              url,
              model: runtimeProfile.model || null,
              adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
              changedFiles: workspaceAfter?.statusLines.length ?? 0,
              headChanged: Boolean(workspaceBefore?.head && workspaceAfter?.head && workspaceBefore.head !== workspaceAfter.head),
            });
          }
        }
        if (!fullText.trim()) {
          const emptyMessage = lastRuntimeError
            || `${runtimeProfile.runtime === "hermes" ? "Hermes API" : "Runtime"} stream finished without returning any text. Check the active provider, model, and credentials.`;
          recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.empty", {
            ...telemetryPayloadForProfile(runtimeProfile),
            url,
            model: runtimeProfile.model || null,
            adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
            sawFirstChunk,
            commentEventCount,
            dataEventCount,
            textDeltaCount,
            processEventCount,
            message: emptyMessage,
            streamElapsedMs: Date.now() - fetchStartedAt,
          });
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime stream failed", emptyMessage));
          queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", `Error: ${emptyMessage}`));
          queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
          safeEnqueue(ssePayload({ error: emptyMessage }));
          safeEnqueue("data: [DONE]\n\n");
          return;
        }
        const event = await recordChatHoney(runtimeProfile, userText, fullText, honeyLedgerEnabled);
        if (event) safeEnqueue(ssePayload({ honey: event }));
        recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.completed", {
          ...telemetryPayloadForProfile(runtimeProfile),
          url,
          model: runtimeProfile.model || null,
          adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
          outputLength: fullText.length,
          sawFirstChunk,
          commentEventCount,
          dataEventCount,
          textDeltaCount,
          processEventCount,
          streamElapsedMs: Date.now() - fetchStartedAt,
        });
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "completed"));
        safeEnqueue("data: [DONE]\n\n");
      } catch (error) {
        const message = runtimeStreamErrorMessage(profile, error);
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime stream failed", message));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
        recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.failed", {
          ...telemetryPayloadForProfile(runtimeProfile),
          url,
          model: runtimeProfile.model || null,
          adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
          message,
          streamElapsedMs: Date.now() - fetchStartedAt,
        });
        safeEnqueue(ssePayload({ error: message }));
        safeEnqueue("data: [DONE]\n\n");
      } finally {
        await sessionWrite.catch(() => undefined);
        releaseInteractiveRuntime(lockKey);
        safeClose();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

const IMAGE_TOOL_DISPATCH_TIMEOUT_MS = 190_000;
const IMAGE_GENERATION_TOOL_NAME = "generate_image";

// Single tool offered to OpenAI-compatible models when the user is asking for an
// image. The model only supplies the prompt; HivemindOS picks the best reachable
// connected app server-side (see appScore in /api/chat/image-generation), so the
// "strongest endpoint wins" ranking applies instead of a name-only model guess.
function imageGenerationToolDefinition() {
  return {
    type: "function",
    function: {
      name: IMAGE_GENERATION_TOOL_NAME,
      description: "Generate an image from a text prompt using a connected HivemindOS image-generation app (for example Open Generative AI, ComfyUI, or Z-Image). Call this whenever the user asks to generate, create, draw, or render an image. HivemindOS automatically routes to the best reachable connected app, so do not pick an app yourself — just pass the full prompt.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The complete image-generation prompt to render." },
        },
        required: ["prompt"],
      },
    },
  };
}

type AccumulatedToolCall = { id: string; name: string; arguments: string };

function parseToolCallArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

type ImageGenerationDispatchResult = {
  ok: boolean;
  error?: string;
  prompt?: string;
  app?: { id?: string; name?: string; machineName?: string; serviceKind?: string };
  endpoint?: string;
  images?: Array<{ url: string; width?: number; height?: number; seed?: string | number }>;
};

async function dispatchImageGenerationViaRoute(origin: string, prompt: string, signal?: AbortSignal): Promise<ImageGenerationDispatchResult> {
  const response = await fetch(new URL("/api/chat/image-generation", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(IMAGE_TOOL_DISPATCH_TIMEOUT_MS),
  });
  const json = await response.json().catch(() => null) as ImageGenerationDispatchResult | null;
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error || `Image generation failed (${response.status}).`);
  }
  return json;
}

function imageGenerationArtifacts(images?: Array<{ url: string }>) {
  const urls = (images ?? []).map((image) => image?.url).filter((url): url is string => Boolean(url));
  return urls.map((url, index) => ({
    kind: "image",
    url,
    label: urls.length === 1 ? "Generated image" : `Generated image ${index + 1}`,
  }));
}

async function streamOpenAICompatibleRuntime(
  profile: AgentProfile,
  messages: IncomingMessage[],
  userText: string,
  sharedVault: SharedVaultConfig | null,
  agentMode: AgentMode,
  workingDirectory?: string,
  wallet?: AgentWalletConfig,
  honeyLedgerEnabled = false,
  runtimeSessionId = "",
  telemetry?: RuntimeRouteTelemetry,
  taskRetrievalContext = "",
  sharedBrainMemoryContext = "",
  adaptiveRoutePlan?: AdaptiveRoutePlan,
  vaultPromptContext = "",
) {
  const inputCheck = proxyInput(userText);
  if (inputCheck.verdict === "block") {
    return Response.json({ error: inputCheck.reason ?? "Message blocked by security policy" }, { status: 400 });
  }
  let runtimeProfile = profile;
  let usePodHeaders: Record<string, string> = {};
  let providerHeaders: Record<string, string> = {};
  const usePodEnabled = isUsePodProfile(profile);
  try {
    const usePodConfig = await resolveUsePodRuntimeConfig(profile);
    if (usePodConfig) {
      runtimeProfile = {
        ...profile,
        gatewayUrl: usePodConfig.baseUrl,
        chatPath: usePodConfig.chatPath,
        statusPath: usePodConfig.statusPath,
        token: "",
      };
      usePodHeaders = usePodConfig.headers;
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "UsePod setup is incomplete." }, { status: 502 });
  }
  if (isBankrLlmProfile(profile)) {
    const resolved = await resolveBankrLlmRuntimeProfile(runtimeProfile);
    if (resolved.error) return Response.json({ error: resolved.error }, { status: 400 });
    runtimeProfile = resolved.profile;
    providerHeaders = resolved.headers;
  }
  const url = buildOpenAICompatibleUrl(runtimeProfile);
  const lockKey = interactiveRuntimeLockKey(runtimeProfile, url);
  if (!reserveInteractiveRuntime(lockKey)) {
    return Response.json({ error: `${runtimeProfile.name || runtimeProfile.runtime} is already running another interactive request at ${url}.` }, { status: 409 });
  }

  const adaptiveProvider = Boolean(adaptiveRoutePlan);
  const adaptiveOpenRouter = isAdaptiveOpenRouterProfile(runtimeProfile) || (isOpenRouterProvider(runtimeProfile) && Boolean(runtimeProfile.adaptiveOpenRouter));
  if (usePodEnabled) {
    const capLabel = [
      profile.usePod?.maxPriceInputMicrounits ? `input cap ${profile.usePod.maxPriceInputMicrounits}` : "",
      profile.usePod?.maxPriceOutputMicrounits ? `output cap ${profile.usePod.maxPriceOutputMicrounits}` : "",
    ].filter(Boolean).join(", ");
    await appendRuntimeChatSessionEvent(
      runtimeSessionId,
      "UsePod request",
      `UsePod · ${openAICompatibleModel(runtimeProfile)}${capLabel ? ` · ${capLabel}` : ""}`,
    ).catch(() => undefined);
  }
  const modelMessagesFor = (candidateProfile: AgentProfile, candidateModel: string) => {
    const promptEnvelope = buildHivemindPromptEnvelope({
      profile: candidateProfile,
      agentMode,
      workingDirectory,
      vaultContext: vaultPromptContext,
      sharedBrainMemoryContext,
      taskRetrievalContext,
      wallet,
      runtimeSessionId,
      extraDynamicContext: buildAdaptiveOpenRouterResolvedModelContext(runtimeProfile, candidateModel),
    });
    return prependHivemindSystemMessage(messages, promptEnvelope);
  };
  let candidateModels: string[];
  try {
    candidateModels = isAdaptiveOpenRouterProfile(runtimeProfile)
      ? await resolveAdaptiveOpenRouterModels(runtimeProfile, messages)
      : isBankrAdaptiveModel(profile)
        ? await resolveAdaptiveBankrLlmModels(profile, messages)
        : [openAICompatibleModel(runtimeProfile)];
  } catch (error) {
    releaseInteractiveRuntime(lockKey);
    return Response.json({ error: error instanceof Error ? error.message : "Adaptive OpenRouter model selection failed." }, { status: 502 });
  }
  const requestOrigin = (() => {
    try {
      return new URL(telemetry?.request?.url ?? "").origin;
    } catch {
      return "";
    }
  })();
  // Only advertise the image tool when the user is actually asking for an image and we
  // can reach our own dispatch route. Every other chat is byte-for-byte unchanged.
  const offerImageTool = Boolean(requestOrigin) && imageGenerationRequest(userText);
  // Advertise the real-command tool to agents whose profile declares the
  // skillActions runtime capability. This gives a hivemind-os chat agent an
  // actual local-execution loop (allowlisted commands) instead of letting it
  // role-play "I ran osascript…". Agents without the capability are unchanged.
  const offerCommandTool = profile.runtimeCapabilities?.skillActions === true;
  // Tool definitions advertised on every request attempt. Empty → no tools
  // field is sent and the chat path is byte-for-byte unchanged.
  const toolDefinitions = [
    ...(offerImageTool ? [imageGenerationToolDefinition()] : []),
    ...(offerCommandTool ? [runCommandToolDefinition()] : []),
  ];
  let winningRequest: { url: string; headers: Record<string, string>; messages: IncomingMessage[]; model: string; sentTools: boolean } | null = null;
  const fetchStartedAt = Date.now();
  let upstream: Response | null = null;
  let model = candidateModels[0] ?? openAICompatibleModel(profile);
  let lastStatus = 0;
  let lastFetchError: unknown = null;
  const attemptedModels: string[] = [];
  const adaptiveRouteCandidates = adaptiveRoutePlan?.candidates.filter((candidate) => candidate.runtime === HIVEMIND_OS_RUNTIME) ?? [];
  const routeAttempts = adaptiveRouteCandidates.length
    ? adaptiveRouteCandidates
    : candidateModels.map((candidateModel) => ({
      provider: runtimeProfile.provider || "openai-compatible",
      providerName: runtimeProfile.provider || "OpenAI-compatible",
      model: candidateModel,
      gatewayUrl: runtimeProfile.gatewayUrl,
      chatPath: runtimeProfile.chatPath || "/v1/chat/completions",
      token: runtimeProfile.token,
      headers: {} as Record<string, string>,
    }));
  const startLmStudioServerForProfile = async (candidateProfile: AgentProfile, failedUrl: string, error: unknown) => {
    if (!isLocalLmStudioProfile(candidateProfile) || adaptiveProvider || adaptiveOpenRouter || usePodEnabled || isBankrLlmProfile(candidateProfile)) return false;
    let port = "1234";
    try {
      const parsed = new URL(candidateProfile.gatewayUrl);
      port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    } catch {
      return false;
    }
    if (!/^\d+$/.test(port)) return false;
    recordRuntimeTelemetry(telemetry, "agent_runtime.lm_studio_server.start", {
      ...telemetryPayloadForProfile(candidateProfile),
      failedUrl,
      port,
      originalError: error instanceof Error ? error.message : String(error),
    });
    await appendRuntimeChatSessionEvent(
      runtimeSessionId,
      "Starting LM Studio server",
      `LM Studio has the model loaded, but ${failedUrl} is not listening. Starting the local LM Studio OpenAI-compatible server on port ${port}.`,
    ).catch(() => undefined);
    try {
      const { stdout, stderr } = await execFileAsync(await resolveLmStudioCliBin(), ["server", "start", "--port", port, "--bind", "127.0.0.1"], {
        timeout: 20_000,
        maxBuffer: 1_000_000,
        env: lmStudioCliEnv(),
        signal: telemetry?.request.signal,
      });
      const detail = stripTerminalControls([stdout, stderr].filter(Boolean).join("\n"));
      recordRuntimeTelemetry(telemetry, "agent_runtime.lm_studio_server.started", {
        ...telemetryPayloadForProfile(candidateProfile),
        port,
        detail: detail.slice(0, 500),
        elapsedMs: Date.now() - fetchStartedAt,
      });
      return true;
    } catch (serverError) {
      recordRuntimeTelemetry(telemetry, "agent_runtime.lm_studio_server.start_failed", {
        ...telemetryPayloadForProfile(candidateProfile),
        port,
        errorName: serverError instanceof Error ? serverError.name : null,
        errorMessage: serverError instanceof Error ? serverError.message : String(serverError),
        elapsedMs: Date.now() - fetchStartedAt,
      });
      await appendRuntimeChatSessionEvent(
        runtimeSessionId,
        "LM Studio server start failed",
        serverError instanceof Error ? serverError.message : "Could not start LM Studio server.",
      ).catch(() => undefined);
      return false;
    }
  };
  for (const routeAttempt of routeAttempts) {
    const candidateModel = routeAttempt.model;
    model = candidateModel;
    const candidateProfile = {
      ...runtimeProfile,
      provider: routeAttempt.provider,
      model: candidateModel,
      gatewayUrl: routeAttempt.gatewayUrl,
      chatPath: routeAttempt.chatPath,
      token: routeAttempt.token ?? runtimeProfile.token,
    };
    const candidateUrl = buildOpenAICompatibleUrl(candidateProfile);
    attemptedModels.push(`${routeAttempt.provider}/${candidateModel}`);
    const modelMessages = modelMessagesFor(candidateProfile, candidateModel);
    const attemptHeaders = {
      "Content-Type": "application/json",
      ...(candidateProfile.token ? { Authorization: `Bearer ${candidateProfile.token}` } : {}),
      ...usePodHeaders,
      ...providerHeaders,
      ...(routeAttempt.headers ?? {}),
    };
    let sentTools = toolDefinitions.length > 0;
    const requestBodyFor = (withTools: boolean) => JSON.stringify({
      model,
      messages: modelMessages,
      stream: true,
      ...(withTools && toolDefinitions.length ? { tools: toolDefinitions, tool_choice: "auto" } : {}),
    });
    recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.fetch.start", {
      ...telemetryPayloadForProfile(candidateProfile),
      url: candidateUrl,
      model,
      adaptiveOpenRouter,
      adaptiveProvider,
      usePod: usePodEnabled,
      offerImageTool: sentTools,
      messageCount: modelMessages.length,
    });
    try {
      upstream = await fetch(candidateUrl, {
        method: "POST",
        headers: attemptHeaders,
        body: requestBodyFor(sentTools),
        signal: AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
      });
      // Some OpenAI-compatible providers reject a `tools` array with a 400. Retry the
      // same candidate once without tools so image chats still get a normal text reply.
      if (sentTools && !upstream.ok && upstream.status === 400) {
        recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.tools_unsupported", {
          ...telemetryPayloadForProfile(candidateProfile),
          url: candidateUrl,
          model,
          status: upstream.status,
          elapsedMs: Date.now() - fetchStartedAt,
        });
        sentTools = false;
        upstream = await fetch(candidateUrl, {
          method: "POST",
          headers: attemptHeaders,
          body: requestBodyFor(false),
          signal: AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
        });
      }
    } catch (error) {
      lastFetchError = error;
      recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.fetch.failed", {
        ...telemetryPayloadForProfile(candidateProfile),
        url: candidateUrl,
        model,
        adaptiveOpenRouter,
        adaptiveProvider,
        usePod: usePodEnabled,
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        attempt: attemptedModels.length,
        remainingCandidates: Math.max(0, routeAttempts.length - attemptedModels.length),
        elapsedMs: Date.now() - fetchStartedAt,
      });
      if ((adaptiveOpenRouter || adaptiveProvider) && attemptedModels.length < routeAttempts.length) {
        continue;
      }
      if (await startLmStudioServerForProfile(candidateProfile, candidateUrl, error)) {
        try {
          upstream = await fetch(candidateUrl, {
            method: "POST",
            headers: attemptHeaders,
            body: requestBodyFor(sentTools),
            signal: AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
          });
          recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.fetch.retry_response", {
            ...telemetryPayloadForProfile(candidateProfile),
            url: candidateUrl,
            model,
            status: upstream.status,
            ok: upstream.ok,
            elapsedMs: Date.now() - fetchStartedAt,
          });
          if (upstream.ok) {
            winningRequest = { url: candidateUrl, headers: attemptHeaders, messages: modelMessages, model, sentTools };
            break;
          }
        } catch (retryError) {
          lastFetchError = retryError;
          recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.fetch.retry_failed", {
            ...telemetryPayloadForProfile(candidateProfile),
            url: candidateUrl,
            model,
            errorName: retryError instanceof Error ? retryError.name : null,
            errorMessage: retryError instanceof Error ? retryError.message : String(retryError),
            elapsedMs: Date.now() - fetchStartedAt,
          });
        }
      }
      await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible fetch failed", runtimeFetchError(candidateProfile, candidateUrl, error)).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
      releaseInteractiveRuntime(lockKey);
      return Response.json({ error: runtimeFetchError(candidateProfile, candidateUrl, error) }, { status: 502 });
    }
    if (upstream.ok) {
      winningRequest = { url: candidateUrl, headers: attemptHeaders, messages: modelMessages, model, sentTools };
      break;
    }
    lastStatus = upstream.status;
    const errorText = await upstream.text().catch(() => "");
    recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.upstream_error", {
      ...telemetryPayloadForProfile(candidateProfile),
      url: candidateUrl,
      model,
      adaptiveOpenRouter,
      adaptiveProvider,
      usePod: usePodEnabled,
      status: upstream.status,
      bodyPreview: errorText.slice(0, 500),
      attempt: attemptedModels.length,
      remainingCandidates: Math.max(0, routeAttempts.length - attemptedModels.length),
      elapsedMs: Date.now() - fetchStartedAt,
    });
    if ((adaptiveOpenRouter || adaptiveProvider) && retryableAdaptiveOpenRouterStatus(upstream.status) && attemptedModels.length < routeAttempts.length) {
      continue;
    }
    await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible upstream error", providerErrorMessage(errorText, upstream.status, model)).catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    releaseInteractiveRuntime(lockKey);
    return new Response(
      ssePayload({ error: adaptiveOpenRouter && retryableAdaptiveOpenRouterStatus(upstream.status)
        ? finalAdaptiveOpenRouterError(upstream.status, attemptedModels)
        : adaptiveProvider && retryableAdaptiveOpenRouterStatus(upstream.status)
          ? finalAdaptiveProviderError(upstream.status, attemptedModels)
        : providerErrorMessage(errorText, upstream.status, model) }) + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  if (!upstream?.ok) {
    await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible upstream error", lastFetchError ? "Network issue while trying provider models." : finalAdaptiveOpenRouterError(lastStatus || 502, attemptedModels)).catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    releaseInteractiveRuntime(lockKey);
    return new Response(
      ssePayload({ error: lastFetchError
        ? `${adaptiveProvider ? "Adaptive" : "OpenRouter"} had a network issue while trying configured models. Adaptive tried ${attemptedModels.length || 1} route${attemptedModels.length === 1 ? "" : "s"}. Try again shortly or disable the failing provider in Adaptive settings.`
        : adaptiveProvider
          ? finalAdaptiveProviderError(lastStatus || 502, attemptedModels)
        : finalAdaptiveOpenRouterError(lastStatus || 502, attemptedModels) }) + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  const usePodResponse = usePodEnabled ? summarizeUsePodResponseHeaders(upstream.headers) : null;
  if (usePodResponse) {
    const detail = [
      usePodResponse.route ? `Route: ${usePodResponse.route}` : "",
      usePodResponse.balanceRemaining ? `Balance remaining: ${usePodResponse.balanceRemaining}` : "",
    ].filter(Boolean).join(" · ");
    recordRuntimeTelemetry(telemetry, "agent_runtime.usepod.response", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model,
      route: usePodResponse.route || null,
      balanceRemaining: usePodResponse.balanceRemaining || null,
    });
    await appendRuntimeChatSessionEvent(runtimeSessionId, "UsePod inference metadata", detail).catch(() => undefined);
  }

  if (!upstream.body) {
    await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible response body is empty").catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    releaseInteractiveRuntime(lockKey);
    return new Response(
      ssePayload({ error: "OpenAI-compatible runtime response body is empty" }) + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const json = await upstream.json().catch(async () => ({ text: await upstream.text().catch(() => "") }));
    const outputCheck = proxyOutput(extractChunk(json));
    const channelMarkupState = createChannelMarkupState();
    const routed = outputCheck.verdict === "block"
      ? { content: "", thinking: "" }
      : routeChannelMarkupDelta(outputCheck.text || JSON.stringify(json), channelMarkupState);
    const chunk = routed.content;
    const event = outputCheck.verdict === "block" ? null : await recordChatHoney(profile, userText, chunk, honeyLedgerEnabled);
    if (outputCheck.verdict === "block") {
      await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible response blocked", outputCheck.reason ?? "Response blocked by security policy").catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    } else {
      await appendRuntimeChatSessionText(runtimeSessionId, "assistant", chunk, json).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "completed").catch(() => undefined);
    }
    releaseInteractiveRuntime(lockKey);
    return new Response(
      (routed.thinking ? ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: routed.thinking }) : "")
      +
      ssePayload(outputCheck.verdict === "block"
        ? { error: outputCheck.reason ?? "Response blocked by security policy" }
        : { choices: [{ delta: { content: chunk } }] })
      + (event ? ssePayload({ honey: event }) : "")
      + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readable = new ReadableStream({
    async start(controller) {
      let sessionWrite = Promise.resolve();
      const queueSessionWrite = (operation: () => Promise<void>) => {
        if (!runtimeSessionId) return;
        sessionWrite = sessionWrite.then(operation, operation).catch(() => undefined);
      };
      if (runtimeSessionId) {
        controller.enqueue(encoder.encode(ssePayload({
          session: { id: runtimeSessionId, runtime: profile.runtime, source: "hivemindos-chat", startedAt: fetchStartedAt },
        })));
      }
      let fullText = "";
      // Consume one upstream SSE stream: emit content/thinking to the client exactly as
      // before, and (when allowed) accumulate any tool_calls instead of leaking them as
      // raw deltas. Returns the completed tool calls so the caller can run the tool loop.
      const consume = async (stream: Response, allowTools: boolean): Promise<{ toolCalls: AccumulatedToolCall[] }> => {
        const streamReader = stream.body?.getReader();
        if (!streamReader) return { toolCalls: [] };
        let buffer = "";
        const channelMarkupState = createChannelMarkupState();
        const toolAcc = new Map<number, AccumulatedToolCall>();
        while (true) {
          const { value, done } = await streamReader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const eventText of events) {
            const dataLine = eventText.split("\n").find((line) => line.startsWith("data:"));
            if (!dataLine) continue;
            const raw = dataLine.replace(/^data:\s*/, "");
            if (raw === "[DONE]") continue;
            try {
              const parsed = JSON.parse(raw);
              const toolDeltas = parsed?.choices?.[0]?.delta?.tool_calls;
              if (Array.isArray(toolDeltas) && toolDeltas.length) {
                if (allowTools) {
                  for (const toolDelta of toolDeltas) {
                    const index = typeof toolDelta?.index === "number" ? toolDelta.index : 0;
                    const slot = toolAcc.get(index) ?? { id: "", name: "", arguments: "" };
                    if (typeof toolDelta?.id === "string" && toolDelta.id) slot.id = toolDelta.id;
                    if (typeof toolDelta?.function?.name === "string" && toolDelta.function.name) slot.name = toolDelta.function.name;
                    if (typeof toolDelta?.function?.arguments === "string") slot.arguments += toolDelta.function.arguments;
                    toolAcc.set(index, slot);
                  }
                }
                continue;
              }
              const outputCheck = proxyOutput(extractChunk(parsed));
              const reasoningCheck = proxyOutput(extractReasoningChunk(parsed));
              if (outputCheck.verdict === "block") {
                controller.enqueue(encoder.encode(ssePayload({ error: outputCheck.reason ?? "Response blocked by security policy" })));
                continue;
              }
              if (reasoningCheck.verdict === "block") {
                controller.enqueue(encoder.encode(ssePayload({ error: reasoningCheck.reason ?? "Response blocked by security policy" })));
                continue;
              }
              const routed = routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
              const thinking = [reasoningCheck.text, routed.thinking].filter(Boolean).join("");
              if (thinking) {
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", thinking, parsed));
                controller.enqueue(encoder.encode(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: thinking })));
              }
              if (routed.content) fullText += routed.content;
              if (routed.content) queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", routed.content, parsed));
              if (!routed.content && !thinking && isTerminalOpenAiStreamMetadata(parsed)) continue;
              if (!routed.content && !thinking) queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime event", String(parsed?.type ?? parsed?.event?.type ?? "").trim(), parsed));
              if (routed.content || (!thinking && !outputCheck.text)) {
                controller.enqueue(encoder.encode(routed.content
                  ? ssePayload({ choices: [{ delta: { content: routed.content } }] })
                  : ssePayload(parsed)));
              }
            } catch {
              const outputCheck = proxyOutput(raw);
              const routed = outputCheck.verdict === "block"
                ? { content: "", thinking: "" }
                : routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
              if (outputCheck.verdict === "block") {
                controller.enqueue(encoder.encode(ssePayload({ error: outputCheck.reason ?? "Response blocked by security policy" })));
              }
              if (routed.thinking) {
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", routed.thinking));
                controller.enqueue(encoder.encode(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: routed.thinking })));
              }
              if (routed.content) {
                controller.enqueue(encoder.encode(ssePayload({ choices: [{ delta: { content: routed.content } }] })));
                fullText += routed.content;
                queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", routed.content));
              }
            }
          }
        }
        return { toolCalls: [...toolAcc.values()].filter((call) => call.name) };
      };

      // Execute the generate_image tool: stream a running card, dispatch to the connected
      // image app (which runs the appScore endpoint-strength ranking), then a ready/error
      // card. Returns the tool-result payload and a fallback line for the continuation turn.
      const runImageToolCall = async (call: AccumulatedToolCall) => {
        const args = parseToolCallArguments(call.arguments);
        const imagePrompt = typeof args.prompt === "string" && args.prompt.trim() ? args.prompt.trim() : userText;
        controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: { status: "running", prompt: imagePrompt, title: "Image generation" } })));
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Image generation", "Dispatching the prompt to the best reachable connected image app."));
        recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.image_tool.dispatch", {
          ...telemetryPayloadForProfile(profile),
          url,
          model,
          promptLength: imagePrompt.length,
        });
        // Image dispatch can poll for up to ~2 minutes. Emit an inert keepalive every 20s
        // so the client's 130s stall-abort timer never fires mid-generation.
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(ssePayload({})));
          } catch {
            // controller already closed; nothing to keep alive
          }
        }, 20_000);
        try {
          const result = await dispatchImageGenerationViaRoute(requestOrigin, imagePrompt, telemetry?.request?.signal);
          clearInterval(heartbeat);
          const artifacts = imageGenerationArtifacts(result.images);
          controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: {
            status: "ready",
            prompt: result.prompt || imagePrompt,
            title: "Image generation",
            appName: result.app?.name,
            machineName: result.app?.machineName,
            artifacts,
            completedAt: Date.now(),
          } })));
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Image generation completed", `${artifacts.length} image${artifacts.length === 1 ? "" : "s"} from ${result.app?.name ?? "connected app"}.`));
          recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.image_tool.completed", {
            ...telemetryPayloadForProfile(profile),
            appName: result.app?.name ?? null,
            endpoint: result.endpoint ?? null,
            imageCount: artifacts.length,
          });
          return {
            toolResultContent: JSON.stringify({ ok: true, app: result.app?.name, endpoint: result.endpoint, images: artifacts.map((artifact) => artifact.url) }),
            fallbackText: artifacts.length
              ? `Generated ${artifacts.length} image${artifacts.length === 1 ? "" : "s"} with ${result.app?.name ?? "the connected app"}.`
              : "The image generation finished.",
          };
        } catch (error) {
          clearInterval(heartbeat);
          const message = error instanceof Error ? error.message : "Image generation failed.";
          controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: { status: "error", prompt: imagePrompt, title: "Image generation", error: message } })));
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Image generation failed", message));
          recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.image_tool.failed", {
            ...telemetryPayloadForProfile(profile),
            errorMessage: message,
          });
          return {
            toolResultContent: JSON.stringify({ ok: false, error: message }),
            fallbackText: `I couldn't complete the image generation: ${message}`,
          };
        }
      };

      // Execute a run_command tool call: stream a running/finished tool card (the
      // same chat.tool.* shape the dashboard + mobile client render), run the
      // allowlisted command, then return the tool-result payload for the
      // continuation turn. Real local execution — see command-tool.ts.
      const runCommandToolCall = async (call: AccumulatedToolCall) => {
        const args = parseToolCallArguments(call.arguments);
        const commandLine = [
          typeof args.command === "string" ? args.command : "",
          ...(Array.isArray(args.args) ? args.args.filter((a): a is string => typeof a === "string") : []),
        ].filter(Boolean).join(" ");
        const label = typeof args.reason === "string" && args.reason.trim()
          ? args.reason.trim()
          : `Run ${typeof args.command === "string" && args.command ? args.command : "command"}`;
        controller.enqueue(encoder.encode(ssePayload({
          type: RUNTIME_STREAM_EVENT_TYPES.TOOL_START,
          toolName: RUN_COMMAND_TOOL_NAME,
          name: RUN_COMMAND_TOOL_NAME,
          message: label,
          detail: commandLine,
          status: "running",
        })));
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, label, commandLine));
        recordRuntimeTelemetry(telemetry, "agent_runtime.command_tool.dispatch", {
          ...telemetryPayloadForProfile(profile),
          command: typeof args.command === "string" ? args.command : null,
          argCount: Array.isArray(args.args) ? args.args.length : 0,
        });
        const result = await runAgentCommand({
          command: args.command,
          args: args.args,
          cwd: workingDirectory,
          signal: telemetry?.request?.signal,
        });
        controller.enqueue(encoder.encode(ssePayload({
          type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
          toolName: RUN_COMMAND_TOOL_NAME,
          name: RUN_COMMAND_TOOL_NAME,
          message: label,
          detail: result.ok
            ? (result.stdout?.split("\n").find(Boolean)?.slice(0, 200) || "Done")
            : (result.error || result.stderr || "Failed"),
          status: result.ok ? "completed" : "failed",
        })));
        queueSessionWrite(() => appendRuntimeChatSessionEvent(
          runtimeSessionId,
          result.ok ? "Command finished" : "Command failed",
          (result.stdout || result.stderr || result.error || "").slice(0, 500),
        ));
        recordRuntimeTelemetry(telemetry, result.ok ? "agent_runtime.command_tool.completed" : "agent_runtime.command_tool.failed", {
          ...telemetryPayloadForProfile(profile),
          command: result.command || null,
          exitCode: result.exitCode ?? null,
          elapsedMs: result.elapsedMs,
        });
        return {
          toolResultContent: JSON.stringify({
            ok: result.ok,
            command: result.command,
            args: result.args,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            error: result.error,
          }),
          fallbackText: result.ok
            ? `Ran \`${commandLine}\`.`
            : `Command failed: ${result.error ?? result.stderr ?? "unknown error"}`,
        };
      };

      // Dispatch one accumulated tool call by name. Unknown tools return an
      // error result so the model can recover instead of stalling.
      const runToolCall = async (call: AccumulatedToolCall) => {
        if (call.name === IMAGE_GENERATION_TOOL_NAME) return runImageToolCall(call);
        if (call.name === RUN_COMMAND_TOOL_NAME) return runCommandToolCall(call);
        return {
          toolResultContent: JSON.stringify({ ok: false, error: `Unknown tool: ${call.name}` }),
          fallbackText: "",
        };
      };

      try {
        let active: Response = upstream as Response;
        // The image tool needs a single round; the command tool can chain
        // several (inspect → act → verify), so allow a bounded number when it
        // is on offer. Each round consumes the model's tool_calls, runs them,
        // and feeds the results back for a continuation turn.
        let toolRoundsLeft = winningRequest?.sentTools ? (offerCommandTool ? 6 : 1) : 0;
        const conversation: Array<Record<string, unknown>> = winningRequest
          ? [...(winningRequest.messages as unknown as Array<Record<string, unknown>>)]
          : [];
        while (true) {
          const { toolCalls } = await consume(active, toolRoundsLeft > 0);
          if (!toolCalls.length || toolRoundsLeft <= 0 || !winningRequest) break;
          toolRoundsLeft -= 1;
          // Run every tool call the model emitted this round and collect the
          // assistant tool_calls + tool results for the continuation request.
          const assistantToolCalls: Array<Record<string, unknown>> = [];
          const toolResultMessages: Array<Record<string, unknown>> = [];
          const fallbacks: string[] = [];
          for (const call of toolCalls) {
            const callId = call.id || `call_${call.name}`;
            const outcome = await runToolCall(call);
            assistantToolCalls.push({ id: callId, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } });
            toolResultMessages.push({ role: "tool", tool_call_id: callId, content: outcome.toolResultContent });
            if (outcome.fallbackText) fallbacks.push(outcome.fallbackText);
          }
          conversation.push({ role: "assistant", content: "", tool_calls: assistantToolCalls });
          conversation.push(...toolResultMessages);
          // Keep offering tools on the continuation so the model can chain
          // another command; stop offering once the round budget is spent.
          const continuationBody: Record<string, unknown> = {
            model: winningRequest.model,
            messages: conversation,
            stream: true,
            ...(toolRoundsLeft > 0 && toolDefinitions.length ? { tools: toolDefinitions, tool_choice: "auto" } : {}),
          };
          let continuation: Response | null = null;
          try {
            continuation = await fetch(winningRequest.url, {
              method: "POST",
              headers: winningRequest.headers,
              body: JSON.stringify(continuationBody),
              signal: AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
            });
          } catch {
            continuation = null;
          }
          if (!continuation || !continuation.ok || !continuation.body) {
            const fallbackText = fallbacks.join(" ") || "The tool finished.";
            controller.enqueue(encoder.encode(ssePayload({ choices: [{ delta: { content: fallbackText } }] })));
            fullText += fallbackText;
            queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", fallbackText));
            break;
          }
          active = continuation;
        }
        const event = await recordChatHoney(profile, userText, fullText, honeyLedgerEnabled);
        if (event) controller.enqueue(encoder.encode(ssePayload({ honey: event })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.stream.done", {
          ...telemetryPayloadForProfile(profile),
          url,
          model,
          adaptiveOpenRouter,
          outputLength: fullText.length,
          elapsedMs: Date.now() - fetchStartedAt,
        });
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "completed"));
      } catch (error) {
        const message = error instanceof Error ? error.message : "OpenAI-compatible stream failed";
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime stream failed", message));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
        controller.enqueue(encoder.encode(ssePayload({ error: message })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        await sessionWrite.catch(() => undefined);
        releaseInteractiveRuntime(lockKey);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: NextRequest) {
  const routeStartedAt = Date.now();
  let profile: AgentProfile;
  let messages: IncomingMessage[];
  let sharedVault: SharedVaultConfig | undefined;
  let workingDirectory: string | undefined;
  let wallet: AgentWalletConfig | undefined;
  let honeyLedgerEnabled = false;
  let runtimeSessionId = "";
  let chatStorageKey = "";
  let clientRunId = "";
  let agentMode: AgentMode = "act";
  let latencyMode = "";
  try {
    const body = (await request.json()) as {
      agent?: AgentProfile;
      messages?: IncomingMessage[];
      sharedVault?: SharedVaultConfig;
      workingDirectory?: string;
      wallet?: AgentWalletConfig;
      honeyLedgerEnabled?: boolean;
      agentMode?: string;
      runtimeSessionId?: string;
      hermesSessionId?: string;
      chatStorageKey?: string;
      clientRunId?: string;
      latencyMode?: string;
    };
    if (!body.agent || !Array.isArray(body.messages)) throw new Error("Missing agent or messages");
    profile = { ...body.agent, runtime: normalizeAgentRuntime(body.agent.runtime) };
    messages = body.messages;
    sharedVault = body.sharedVault;
    workingDirectory = body.workingDirectory;
    wallet = body.wallet;
    honeyLedgerEnabled = body.honeyLedgerEnabled === true;
    agentMode = normalizeAgentMode(body.agentMode);
    runtimeSessionId = typeof body.runtimeSessionId === "string"
      ? body.runtimeSessionId
      : typeof body.hermesSessionId === "string"
        ? body.hermesSessionId
        : "";
    chatStorageKey = typeof body.chatStorageKey === "string" ? body.chatStorageKey : "";
    clientRunId = typeof body.clientRunId === "string" ? body.clientRunId : "";
    latencyMode = typeof body.latencyMode === "string" ? body.latencyMode : "";
  } catch {
    await recordRouteTelemetry(request, "agent_runtime.request.invalid", { elapsedMs: Date.now() - routeStartedAt });
    return Response.json({ error: "Expected { agent, messages }" }, { status: 400 });
  }
  await recordRouteTelemetry(request, "agent_runtime.request.received", {
    ...telemetryPayloadForProfile(profile),
    messageCount: messages.length,
    workingDirectorySet: Boolean(workingDirectory?.trim()),
    runtimeSessionIdSet: Boolean(runtimeSessionId.trim()),
    runtimeSessionId: runtimeSessionId || null,
    chatStorageKey: chatStorageKey || null,
    clientRunId: clientRunId || null,
    agentMode,
    latencyMode: latencyMode || null,
    sharedVaultEnabled: Boolean(sharedVault?.enabled),
    honeyLedgerEnabled,
    elapsedMs: Date.now() - routeStartedAt,
  });

  const userMessage = latestUserMessage(messages);
  const userText = extractUserText(messages).trim();
  const userPrompt = userText || attachmentPromptSummary(userMessage);
  if (!userMessage || !userPrompt) {
    await recordRouteTelemetry(request, "agent_runtime.request.invalid", {
      reason: "empty-user-message",
      ...telemetryPayloadForProfile(profile),
      elapsedMs: Date.now() - routeStartedAt,
    });
    return Response.json({ error: "User message is empty" }, { status: 400 });
  }
  const promptCheck = proxyInput(userPrompt);
  if (promptCheck.verdict === "block") {
    await recordRouteTelemetry(request, "agent_runtime.security.blocked", {
      reason: promptCheck.reason ?? null,
      ...telemetryPayloadForProfile(profile),
      elapsedMs: Date.now() - routeStartedAt,
    });
    return Response.json({ error: promptCheck.reason ?? "Message blocked by security policy" }, { status: 400 });
  }
  const vault = activeSharedVault(profile, sharedVault);
  runtimeSessionId = createRuntimeChatSessionId(profile, runtimeSessionId || clientRunId);
  const lowLatencyVoiceTurn = latencyMode === "voice";
  if (lowLatencyVoiceTurn) {
    const effectiveProfile = isBankrLlmProfile(profile) ? profile : await collectorChatProfile(profile) ?? profile;
    const profileError = isBankrLlmProfile(effectiveProfile) ? null : validateHttpRuntimeProfile(effectiveProfile);
    if (profileError) {
      await recordRouteTelemetry(request, "agent_runtime.voice.validation_failed", {
        reason: "profile-error",
        message: profileError,
        ...telemetryPayloadForProfile(effectiveProfile),
        elapsedMs: Date.now() - routeStartedAt,
      });
      return Response.json({ error: profileError }, { status: 400 });
    }
    await recordRouteTelemetry(request, "agent_runtime.voice.fast_path.dispatch", {
      ...telemetryPayloadForProfile(effectiveProfile),
      runtimeSessionId,
      chatStorageKey: chatStorageKey || null,
      agentMode,
      elapsedMs: Date.now() - routeStartedAt,
    });
    return streamHttpRuntime(effectiveProfile, messages, promptCheck.text, null, agentMode, workingDirectory, undefined, false, runtimeSessionId, {
      request,
      routeStartedAt,
      runtimeSessionId,
      chatStorageKey,
    }, "", "", "");
  }
  const fallbackRuntimeCapabilityContext: Awaited<ReturnType<typeof runtimeImageGenerationCapabilityContext>> = {
    runtime: profile.runtime,
    hasRuntimeImageGeneration: false,
    runtimeImageGenerationSource: undefined,
  };
  const emptyTaskRetrievalResult = { context: "", telemetry: null as TaskRetrievalTelemetry | null };
  const runtimeCapabilityPreflight = lowLatencyVoiceTurn
    ? { value: undefined as Awaited<ReturnType<typeof runtimeImageGenerationCapabilityContext>> | undefined, timedOut: false, failed: false }
    : await bestEffortPreflight(
      runtimeImageGenerationCapabilityContext(profile),
      CHAT_PREFLIGHT_RUNTIME_CAPABILITY_TIMEOUT_MS,
      fallbackRuntimeCapabilityContext,
    );
  const runtimeCapabilityContext = runtimeCapabilityPreflight.value;
  const [taskRetrievalPreflight, sharedBrainMemoryPreflight] = await Promise.all([
    bestEffortPreflight(
      buildTaskRetrievalContextResult({
        origin: request.url,
        query: userPrompt,
        sharedVault: vault,
        runtime: runtimeCapabilityContext,
        agent: {
          workerClass: profile.workerClass,
          preferredSkillSlugs: profile.preferredSkillSlugs,
          taskPreferences: profile.taskPreferences,
        },
      }),
      CHAT_PREFLIGHT_CAPABILITY_SEARCH_TIMEOUT_MS,
      emptyTaskRetrievalResult,
    ),
    lowLatencyVoiceTurn
      ? Promise.resolve({ value: "", timedOut: false, failed: false })
      : bestEffortPreflight(
        buildSharedBrainMemoryContext(vault, userPrompt),
        CHAT_PREFLIGHT_MEMORY_TIMEOUT_MS,
        "",
      ),
  ]);
  const taskRetrievalResult = taskRetrievalPreflight.value;
  const sharedBrainMemoryContext = sharedBrainMemoryPreflight.value;
  const taskRetrievalContext = taskRetrievalResult.context || buildTaskRetrievalFallbackContext({
    query: userPrompt,
    origin: request.url,
    timeoutMs: CHAT_PREFLIGHT_CAPABILITY_SEARCH_TIMEOUT_MS,
    timedOut: taskRetrievalPreflight.timedOut,
    failed: taskRetrievalPreflight.failed,
  });
  await recordRouteTelemetry(request, "agent_runtime.capability_search.completed", {
    ...telemetryPayloadForProfile(profile),
    runtimeSessionId,
    chatStorageKey: chatStorageKey || null,
    skipped: false,
    lowLatencyVoiceTurn,
    runtimeCapabilityTimedOut: runtimeCapabilityPreflight.timedOut,
    runtimeCapabilityFailed: runtimeCapabilityPreflight.failed,
    capabilitySearchTimedOut: taskRetrievalPreflight.timedOut,
    capabilitySearchFailed: taskRetrievalPreflight.failed,
    sharedBrainMemoryTimedOut: sharedBrainMemoryPreflight.timedOut,
    sharedBrainMemoryFailed: sharedBrainMemoryPreflight.failed,
    contextInjected: Boolean(taskRetrievalContext),
    telemetry: taskRetrievalResult.telemetry,
    elapsedMs: Date.now() - routeStartedAt,
  });
  const runtimeSession = await startRuntimeChatSession({
    sessionId: runtimeSessionId,
    agent: profile,
    chatStorageKey,
    sharedVaultPath: vault?.vaultPath,
    userContent: userPrompt,
    startedAt: routeStartedAt,
  }).catch(() => null);
  await recordRouteTelemetry(request, "agent_runtime.session.started", {
    ...telemetryPayloadForProfile(profile),
    runtimeSessionId,
    chatStorageKey: chatStorageKey || null,
    session: chatTelemetrySession(runtimeSession),
    elapsedMs: Date.now() - routeStartedAt,
  });
  const capabilitySearchProcessDetail = taskRetrievalResult.telemetry?.queryCount
    ? formatTaskRetrievalProcessDetail(taskRetrievalResult.telemetry)
    : formatTaskRetrievalFallbackProcessDetail({
      timeoutMs: CHAT_PREFLIGHT_CAPABILITY_SEARCH_TIMEOUT_MS,
      timedOut: taskRetrievalPreflight.timedOut,
      failed: taskRetrievalPreflight.failed,
    });
  if (capabilitySearchProcessDetail) {
    await appendRuntimeChatSessionEvent(runtimeSessionId, "Hive capability search", capabilitySearchProcessDetail).catch(() => undefined);
  }
  const naturalMiroSharkX402 = await maybeExecuteNaturalMiroSharkX402({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (naturalMiroSharkX402) return naturalMiroSharkX402;
  const confirmedPrivateX402 = await maybeExecuteConfirmedPrivateX402({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (confirmedPrivateX402) return confirmedPrivateX402;
  const confirmedPublicX402 = await maybeExecuteConfirmedPublicX402({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (confirmedPublicX402) return confirmedPublicX402;
  const naturalPrivateX402 = await maybePrepareNaturalPrivateX402({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (naturalPrivateX402) return naturalPrivateX402;
  const naturalPublicX402 = await maybePrepareNaturalPublicX402({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (naturalPublicX402) return naturalPublicX402;
  const naturalPrivateTransfer = await maybeExecuteNaturalPrivateTransfer({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (naturalPrivateTransfer) return naturalPrivateTransfer;
  const confirmedPrivateTransfer = await maybeExecuteConfirmedPrivateTransfer({
    request,
    routeStartedAt,
    profile,
    messages,
    wallet,
    runtimeSessionId,
  });
  if (confirmedPrivateTransfer) return confirmedPrivateTransfer;
  const vaultPromptContext = buildChatVaultContext(vault, userPrompt);
  const promptEnvelope = buildHivemindPromptEnvelope({
    profile,
    agentMode,
    workingDirectory,
    vaultContext: vaultPromptContext,
    sharedBrainMemoryContext,
    taskRetrievalContext,
    wallet,
    runtimeSessionId,
    chatStorageKey,
  });
  const textWithVaultContext = buildHivemindUserContextText(promptEnvelope, userPrompt) || promptCheck.text;
  if (profile.runtime !== "openclaw" || isBankrLlmProfile(profile)) {
    const adapter = getRuntimeAdapter(profile.runtime);
    if (!isBankrLlmProfile(profile) && adapter && !adapter.capabilities.chat) {
      await recordRouteTelemetry(request, "agent_runtime.validation_failed", {
        reason: "adapter-chat-unavailable",
        adapterKind: adapter.kind,
        adapterLabel: adapter.label,
        ...telemetryPayloadForProfile(profile),
        elapsedMs: Date.now() - routeStartedAt,
      });
      await appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime chat unavailable", `${adapter.label} is configured as a ${adapter.kind} runtime here.`).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
      return Response.json({
        error: `${adapter.label} is configured as a ${adapter.kind} runtime here and does not expose interactive chat. Use Scheduler, skills, or runs for this runtime.`,
      }, { status: 400 });
    }
    if (!isBankrLlmProfile(profile) && profile.runtime === "hermes" && profile.telemetryUrl?.trim() && profile.collectorCapabilities?.chat === false) {
      await recordRouteTelemetry(request, "agent_runtime.validation_failed", {
        reason: "collector-chat-unavailable",
        ...telemetryPayloadForProfile(profile),
        elapsedMs: Date.now() - routeStartedAt,
      });
      await appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime chat bridge unavailable", `${userFacingMachineName(profile)} needs setup/update.`).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
      return Response.json({
        error: `${userFacingMachineName(profile)} is connected, but its local agent bridge does not have the Hermes chat bridge installed yet. Run setup/update on that machine after these dashboard changes are available there.`,
      }, { status: 400 });
    }
    const effectiveProfile = isBankrLlmProfile(profile) ? profile : await collectorChatProfile(profile) ?? profile;
    const profileError = isBankrLlmProfile(effectiveProfile) ? null : validateHttpRuntimeProfile(effectiveProfile);
    if (profileError) {
      await recordRouteTelemetry(request, "agent_runtime.validation_failed", {
        reason: "profile-error",
        message: profileError,
        ...telemetryPayloadForProfile(effectiveProfile),
        elapsedMs: Date.now() - routeStartedAt,
      });
      await appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime profile invalid", profileError).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
      return Response.json({ error: profileError }, { status: 400 });
    }
    await recordRouteTelemetry(request, "agent_runtime.dispatch.http", {
      ...telemetryPayloadForProfile(effectiveProfile),
      promptLength: userPrompt.length,
      contextLength: promptEnvelope.systemContext.length,
      runtimeSessionId,
      chatStorageKey: chatStorageKey || null,
      agentMode,
      elapsedMs: Date.now() - routeStartedAt,
    });
    return streamHttpRuntime(effectiveProfile, messages, promptCheck.text, vault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, {
      request,
      routeStartedAt,
      runtimeSessionId,
      chatStorageKey,
    }, taskRetrievalContext, sharedBrainMemoryContext, vaultPromptContext);
  }

  const token = await getGatewayAuthToken(profile.token);
  if (!profile.gatewayUrl || !token) {
    await recordRouteTelemetry(request, "agent_runtime.validation_failed", {
      reason: "missing-openclaw-gateway-or-token",
      ...telemetryPayloadForProfile(profile),
      elapsedMs: Date.now() - routeStartedAt,
    });
    await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenClaw gateway unavailable", "Missing OpenClaw gateway URL or token.").catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    return Response.json({ error: "Missing OpenClaw gateway URL or token" }, { status: 400 });
  }
  await recordRouteTelemetry(request, "agent_runtime.dispatch.openclaw", {
    ...telemetryPayloadForProfile(profile),
    promptLength: userPrompt.length,
    contextLength: promptEnvelope.systemContext.length,
    runtimeSessionId,
    chatStorageKey: chatStorageKey || null,
    agentMode,
    elapsedMs: Date.now() - routeStartedAt,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let sessionWrite = Promise.resolve();
      const queueSessionWrite = (operation: () => Promise<void>) => {
        sessionWrite = sessionWrite.then(operation, operation).catch(() => undefined);
      };
      controller.enqueue(encoder.encode(ssePayload({
        session: { id: runtimeSessionId, runtime: profile.runtime, source: "hivemindos-chat", startedAt: routeStartedAt },
      })));
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 5_000);

      try {
        let fullText = "";
        let contentChunkCount = 0;
        let statusEventCount = 0;
        let toolEventCount = 0;
        await sendMessageViaGateway(
          {
            gatewayUrl: profile.gatewayUrl,
            token,
            text: textWithVaultContext,
            agentId: profile.agentId,
            ...(runtimeSessionId || profile.sessionKey ? { sessionKey: runtimeSessionId || profile.sessionKey } : {}),
          },
          (chunk) => {
            fullText += chunk;
            contentChunkCount += 1;
            if (contentChunkCount === 1 || contentChunkCount % 5 === 0) {
              void recordRouteTelemetry(request, "agent_runtime.openclaw.content", {
                ...telemetryPayloadForProfile(profile),
                runtimeSessionId,
                chatStorageKey: chatStorageKey || null,
                contentChunkCount,
                outputLength: fullText.length,
                elapsedMs: Date.now() - routeStartedAt,
              });
            }
            queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", chunk));
            controller.enqueue(encoder.encode(ssePayload({ choices: [{ delta: { content: chunk } }] })));
          },
          undefined,
          (toolData) => {
            toolEventCount += 1;
            void recordRouteTelemetry(request, "agent_runtime.openclaw.tool_call", {
              ...telemetryPayloadForProfile(profile),
              runtimeSessionId,
              chatStorageKey: chatStorageKey || null,
              toolEventCount,
              toolName: typeof toolData.name === "string" ? toolData.name : typeof toolData.tool === "string" ? toolData.tool : null,
              toolData: chatTelemetryValue(toolData),
              elapsedMs: Date.now() - routeStartedAt,
            });
            queueSessionWrite(() => appendRuntimeChatSessionEvent(
              runtimeSessionId,
              typeof toolData.name === "string" ? toolData.name : typeof toolData.tool === "string" ? toolData.tool : "Tool call",
              typeof toolData.message === "string" ? toolData.message : undefined,
              toolData,
            ));
            controller.enqueue(encoder.encode(ssePayload({ tool_call: toolData })));
          },
          (status) => {
            statusEventCount += 1;
            void recordRouteTelemetry(request, "agent_runtime.openclaw.status", {
              ...telemetryPayloadForProfile(profile),
              runtimeSessionId,
              chatStorageKey: chatStorageKey || null,
              statusEventCount,
              statusType: status.type,
              status: chatTelemetryValue(status),
              elapsedMs: Date.now() - routeStartedAt,
            });
            queueSessionWrite(() => appendRuntimeChatSessionEvent(
              runtimeSessionId,
              typeof status.data?.message === "string" ? status.data.message : status.type ?? "Runtime status",
              typeof status.data?.detail === "string" ? status.data.detail : typeof status.data?.phase === "string" ? status.data.phase : undefined,
              status,
            ));
            controller.enqueue(encoder.encode(ssePayload({ status })));
          },
        );
        const event = await recordChatHoney(profile, textWithVaultContext, fullText, honeyLedgerEnabled);
        if (event) controller.enqueue(encoder.encode(ssePayload({ honey: event })));
        await recordRouteTelemetry(request, "agent_runtime.openclaw.completed", {
          ...telemetryPayloadForProfile(profile),
          runtimeSessionId,
          chatStorageKey: chatStorageKey || null,
          outputLength: fullText.length,
          contentChunkCount,
          statusEventCount,
          toolEventCount,
          elapsedMs: Date.now() - routeStartedAt,
        });
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "completed"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent runtime error";
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "OpenClaw runtime failed", message));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
        await recordRouteTelemetry(request, "agent_runtime.openclaw.failed", {
          ...telemetryPayloadForProfile(profile),
          runtimeSessionId,
          chatStorageKey: chatStorageKey || null,
          errorName: error instanceof Error ? error.name : "unknown",
          message,
          elapsedMs: Date.now() - routeStartedAt,
        });
        controller.enqueue(encoder.encode(ssePayload({ error: message })));
      } finally {
        await sessionWrite.catch(() => undefined);
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
