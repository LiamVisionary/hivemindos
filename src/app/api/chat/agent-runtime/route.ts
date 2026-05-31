import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { readFile, stat } from "fs/promises";
import { homedir, hostname, networkInterfaces } from "os";
import { join, resolve } from "path";
import { promisify } from "util";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import { getRuntimeUrl } from "@/lib/types/agent-runtime";
import { sendMessageViaGateway } from "@/lib/services/openclaw/gateway-client";
import { getGatewayAuthToken } from "@/lib/services/openclaw/gateway-health";
import { proxyInput, proxyOutput } from "@/lib/services/agent-security-proxy";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { summarizeX402Policy } from "@/lib/services/wallet/x402-agent-fetch";
import { getRuntimeAdapter } from "@/lib/services/runtime-adapters/registry";
import { recordHoneyUsage } from "@/lib/services/wallet/honey-ledger";
import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";
import { normalizeRuntimeStreamEvent, RUNTIME_STREAM_EVENT_TYPES, type RuntimeStreamEvent } from "@/lib/services/runtime-stream-events";
import { isUsePodProfile, resolveUsePodRuntimeConfig, summarizeUsePodResponseHeaders } from "@/lib/services/usepod";
import { activeSharedVault, buildVaultContext } from "@/lib/services/chat/shared-vault-context";
import {
  appendRuntimeChatSessionEvent,
  appendRuntimeChatSessionText,
  createRuntimeChatSessionId,
  finishRuntimeChatSession,
  startRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";

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
};

type AgentMode = "plan" | "act";

const INTERACTIVE_RUNTIME_LOCK_MS = 130_000;
const RUNTIME_FETCH_TIMEOUT_MS = 10 * 60 * 1000;
const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const LOCAL_COLLECTOR_ENV_FILE = join(homedir(), ".hivemindos", "collector.env");
const HERMES_ENV_FILE = join(homedir(), ".hermes", ".env");
const interactiveRuntimeLocks = new Map<string, number>();
const execFileAsync = promisify(execFile);

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
  const runId = request.headers.get("x-hivemind-run-id");
  await recordTelemetryBatch([{
    source: "route",
    type,
    runId,
    payload,
  }]).catch(() => undefined);
}

function recordRuntimeTelemetry(telemetry: RuntimeRouteTelemetry | undefined, type: string, payload: Record<string, unknown> = {}) {
  if (!telemetry) return;
  void recordRouteTelemetry(telemetry.request, type, {
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
  if (profile.runtime !== "hermes" && profile.runtime !== "openai-compatible") return "";
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

function buildWorkingDirectoryContext(workingDirectory?: string): string {
  const trimmed = workingDirectory?.trim();
  if (!trimmed) return "";
  return [
    "Working directory context:",
    `- Use this directory for the chat unless the user says otherwise: ${trimmed}`,
  ].join("\n");
}

function normalizeAgentMode(value: unknown): AgentMode {
  return value === "plan" ? "plan" : "act";
}

function buildAgentModeContext(mode: AgentMode): string {
  if (mode === "plan") {
    return [
      "Agent operating mode: Plan.",
      "- Think through the approach, assumptions, and verification path before making changes.",
      "- Prefer explaining the intended steps and asking only when a decision is genuinely needed.",
      "- Do not mutate files, services, wallets, or remote systems unless the user explicitly asks you to proceed.",
    ].join("\n");
  }
  return [
    "Agent operating mode: Act.",
    "- Execute the user's request directly, make reasonable assumptions, and keep moving until the task is handled.",
    "- Use concise progress updates and surface blockers only when you cannot resolve them safely.",
  ].join("\n");
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

function buildWalletToolContext(wallet?: AgentWalletConfig): string {
  if (!wallet) return "";
  const lines = [
    "Agent wallet/payment context:",
    summarizeX402Policy(wallet),
    "- Tool: x402_fetch",
    "- Dashboard endpoint: POST /api/wallet/x402 with { agentId, url, method, headers, body, policy, confirmation }.",
    "- Approval gate: if autopay is off or the payment is over the approval threshold, do not proceed until the user explicitly supplies PAY_X402.",
    "- Hard rule: never ask for or reveal private keys; the dashboard signs from its encrypted local vault.",
  ];
  return lines.join("\n");
}

function buildAgentProfileContext(profile: AgentProfile): string {
  const usePod = isUsePodProfile(profile) ? profile.usePod : undefined;
  const lines = [
    "Agent profile context:",
    `- Name: ${profile.name || profile.id}`,
    `- Runtime: ${profile.runtime}`,
    profile.machineName ? `- Machine: ${profile.machineName}` : "",
    profile.beeRole ? `- Bee role: ${profile.beeRole}` : "",
    profile.workerClass ? `- Worker class: ${profile.workerClass}` : "",
    profile.provider || profile.model ? `- Preferred model: ${[profile.provider, profile.model].filter(Boolean).join("/")}` : "",
    usePod ? `- UsePod rail: prepaid marketplace inference${usePod.spendPreset ? `, ${usePod.spendPreset} spend caps` : ""}${usePod.lastBalanceRemaining ? `, last balance ${usePod.lastBalanceRemaining}` : ""}` : "",
    profile.skillProfilePrompt?.trim() ? `- Role instructions: ${profile.skillProfilePrompt.trim()}` : "",
    profile.preferredSkillSlugs?.length ? `- Preferred skills: ${profile.preferredSkillSlugs.join(", ")}` : "",
    "- HivemindOS chat bridge: do not use terminal-only interactive clarification prompts. If a question is unavoidable, emit or return a concise question with explicit choices so the dashboard can render it, otherwise make a reasonable assumption and continue.",
  ].filter(Boolean);
  return lines.length > 2 ? lines.join("\n") : "";
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
  return profile.runtime === "openai-compatible";
}

function buildOpenAICompatibleUrl(profile: AgentProfile) {
  const base = profile.gatewayUrl.trim().replace(/\/+$/, "");
  const suffix = profile.chatPath?.trim() || "/v1/chat/completions";
  return `${base}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

function openAICompatibleModel(profile: AgentProfile) {
  return profile.model?.trim() || process.env.LOCAL_OPENAI_MODEL?.trim() || process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL?.trim() || "local-model";
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
    runtime: "openai-compatible" as AgentProfile["runtime"],
    gatewayUrl: "https://openrouter.ai/api",
    chatPath: "/v1/chat/completions",
    provider: "openrouter",
    model,
    token,
  };
}

type OpenRouterModelRecord = {
  id?: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: Record<string, string | number | null | undefined>;
  supported_parameters?: string[];
};

function zeroPriced(value: unknown) {
  if (value === undefined || value === null || value === "") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric === 0;
}

function isFreeOpenRouterModel(model: OpenRouterModelRecord) {
  if (model.id?.endsWith(":free")) return true;
  const pricing = model.pricing ?? {};
  return ["prompt", "completion", "request", "image", "web_search", "internal_reasoning"].every((key) => zeroPriced(pricing[key]));
}

function configuredAdaptiveUseCase(profile: AgentProfile) {
  const useCase = profile.adaptiveOpenRouter?.useCase;
  return useCase && useCase !== "auto" ? [useCase] : null;
}

function adaptiveUseCases(profile: AgentProfile, messages: IncomingMessage[]) {
  const configured = configuredAdaptiveUseCase(profile);
  if (configured) return configured;
  const latest = latestUserMessage(messages);
  const latestText = typeof latest?.content === "string"
    ? latest.content
    : latest?.content?.map((part) => part.text ?? "").join(" ") ?? "";
  const hasImage = Array.isArray(latest?.content) && latest.content.some((part) => part.type === "image_url");
  const hasFile = Array.isArray(latest?.content) && latest.content.some((part) => part.type === "file");
  const text = [
    profile.workerClass,
    profile.name,
    profile.skillProfilePrompt,
    profile.preferredSkillSlugs?.join(" "),
    latestText,
  ].filter(Boolean).join(" ").toLowerCase();
  const cases = new Set<string>();
  if (hasImage) cases.add("vision");
  if (hasFile) cases.add("research");
  if (/\b(code|coding|program|developer|debug|repo|typescript|javascript|python|react|next\.?js|bug|test|refactor|cli|api|schema|sql)\b/.test(text)) cases.add("coding");
  if (/\b(write|writing|copy|essay|story|draft|edit|rewrite|tone|blog|newsletter|creative)\b/.test(text)) cases.add("writing");
  if (/\b(research|compare|summari[sz]e|sources?|search|evidence|market|analysis|report)\b/.test(text)) cases.add("research");
  if (/\b(image|draw|illustration|photo|visual|vision|screenshot|diagram)\b/.test(text)) cases.add(hasImage ? "vision" : "image");
  if (/\b(tool|function|agent|workflow|automation|shell|command|browser|github|filesystem)\b/.test(text)) cases.add("tool-use");
  if (!cases.size) cases.add("general");
  return [...cases];
}

function modelUseCaseScore(model: OpenRouterModelRecord, useCases: string[]) {
  const haystack = `${model.id ?? ""} ${model.name ?? ""} ${model.description ?? ""} ${(model.supported_parameters ?? []).join(" ")}`.toLowerCase();
  let score = 0;
  for (const useCase of useCases) {
    if (useCase === "coding" && /code|coding|coder|programming|developer|devstral|deepseek|qwen|kimi|agent|tools?/.test(haystack)) score += 40;
    if (useCase === "writing" && /write|writing|creative|story|copy|editor|chat|instruct/.test(haystack)) score += 32;
    if (useCase === "vision" && (/vision|visual|image|vlm|multimodal/.test(haystack) || model.architecture?.input_modalities?.includes("image"))) score += 44;
    if (useCase === "image" && (model.architecture?.output_modalities?.includes("image") || /image|diffusion|flux|stable/.test(haystack))) score += 44;
    if (useCase === "research" && /research|search|reason|r1|thinking|analysis/.test(haystack)) score += 34;
    if (useCase === "tool-use" && ((model.supported_parameters ?? []).includes("tools") || /tool|function/.test(haystack))) score += 30;
  }
  if ((model.supported_parameters ?? []).includes("tools")) score += 10;
  if ((model.supported_parameters ?? []).includes("reasoning")) score += 8;
  if (/latest|preview|turbo|pro|large|reason|thinking|instruct/.test(haystack)) score += 6;
  return score;
}

async function resolveAdaptiveOpenRouterModels(profile: AgentProfile, messages: IncomingMessage[]) {
  const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=all", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  const fallbackModel = profile.adaptiveOpenRouter?.fallbackModel?.trim();
  if (!response?.ok) {
    if (fallbackModel) return [fallbackModel];
    throw new Error("Could not fetch OpenRouter's free model inventory for Adaptive mode.");
  }
  const payload = await response.json().catch(() => null) as { data?: OpenRouterModelRecord[] } | null;
  const latest = latestUserMessage(messages);
  const requiresImage = Array.isArray(latest?.content) && latest.content.some((part) => part.type === "image_url");
  const requiredModalities = requiresImage ? ["text", "image"] : ["text"];
  const useCases = adaptiveUseCases(profile, messages);
  const candidates = (payload?.data ?? [])
    .filter((model) => model.id)
    .filter(isFreeOpenRouterModel)
    .filter((model) => requiredModalities.every((modality) => model.architecture?.input_modalities?.includes(modality)))
    .sort((left, right) => {
      const rightTools = right.supported_parameters?.includes("tools") ? 1 : 0;
      const leftTools = left.supported_parameters?.includes("tools") ? 1 : 0;
      return modelUseCaseScore(right, useCases) - modelUseCaseScore(left, useCases)
        || rightTools - leftTools
      || (right.context_length ?? 0) - (left.context_length ?? 0)
      || (right.created ?? 0) - (left.created ?? 0)
      || (left.name ?? left.id ?? "").localeCompare(right.name ?? right.id ?? "");
    });
  if (!candidates[0]?.id && fallbackModel) return [fallbackModel];
  if (!candidates[0]?.id) throw new Error("OpenRouter did not report any free model that matches this Adaptive request.");
  const ids = candidates.map((model) => model.id!).filter(Boolean);
  return fallbackModel && !ids.includes(fallbackModel) ? [...ids, fallbackModel] : ids;
}

async function resolveAdaptiveOpenRouterModel(profile: AgentProfile, messages: IncomingMessage[]) {
  const candidates = await resolveAdaptiveOpenRouterModels(profile, messages);
  return candidates[0];
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
    return `OpenRouter's free models are currently rate-limited or out of promo capacity. Adaptive tried ${modelAttempts.length} free model${modelAttempts.length === 1 ? "" : "s"}${modelAttempts.length ? `, ending with ${modelAttempts.at(-1)}` : ""}. Try again shortly or set a paid fallback model in Adaptive advanced settings.`;
  }
  return `OpenRouter could not complete this Adaptive request after trying ${modelAttempts.length || 1} free model${modelAttempts.length === 1 ? "" : "s"}.`;
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

async function canonicalLocalCollectorUrl(profile: AgentProfile) {
  const rawUrl = profile.telemetryUrl?.trim() ?? "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.pathname.startsWith("/peer/")) return rawUrl.replace(/\/$/, "");
    const isLocalProfile = userFacingMachineName(profile) === "This Mac"
      || [hostname(), `${hostname()}.local`].includes(profile.machineName?.trim() ?? "");
    if (!localInterfaceHosts().has(parsed.hostname) && !isLocalProfile) return rawUrl;
    parsed.hostname = "127.0.0.1";
    const localPort = await localCollectorPort();
    if (localPort) parsed.port = localPort;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

async function localCollectorPort() {
  const envText = await readFile(LOCAL_COLLECTOR_ENV_FILE, "utf8").catch(() => "");
  const port = envText.match(/^AGENT_TELEMETRY_PORT=(\d+)$/m)?.[1]?.trim();
  return port && /^\d+$/.test(port) ? port : "";
}

function localInterfaceHosts() {
  const hosts = new Set(["localhost", "127.0.0.1", "::1"]);
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const item of interfaces ?? []) {
      if (item.address) hosts.add(item.address);
    }
  }
  return hosts;
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
) {
  const inputCheck = proxyInput(userText);
  if (inputCheck.verdict === "block") {
    return Response.json({ error: inputCheck.reason ?? "Message blocked by security policy" }, { status: 400 });
  }
  if (isOpenAICompatibleRuntime(profile)) {
    return streamOpenAICompatibleRuntime(profile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry);
  }
  if (isOpenRouterProvider(profile)) {
    try {
      const openRouterProfile = await openRouterCompatibleProfile(profile);
      return streamOpenAICompatibleRuntime(openRouterProfile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "OpenRouter model selection failed." }, { status: 502 });
    }
  }
  let runtimeProfile = profile;
  let adaptiveResolvedModel = "";
  if (isAdaptiveOpenRouterProfile(profile)) {
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
  const vaultContext = buildVaultContext(sharedVault);
  const walletContext = buildWalletToolContext(wallet);
  const modeContext = buildAgentModeContext(agentMode);
  const context = [buildAgentProfileContext(runtimeProfile), modeContext, buildWorkingDirectoryContext(workingDirectory), vaultContext, walletContext].filter(Boolean).join("\n\n");
  const hermesSlashCommand = profile.runtime === "hermes" && /^\/[^\s/]*(?:\s|$)/.test(inputCheck.text.trim());
  const runtimeMessages = context && !hermesSlashCommand
    ? [{ role: "system", content: context }, ...messages]
    : messages;
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
      contextLength: context.length,
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
        walletTools: wallet ? { x402Fetch: "/api/wallet/x402" } : undefined,
        context: context || undefined,
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
              const outputCheck = proxyOutput(extractChunk(parsed));
              const reasoningCheck = proxyOutput(extractReasoningChunk(parsed));
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
              } else if (!thinking) {
                processEventCount += 1;
                queueSessionWrite(() => appendRuntimeChatSessionEvent(
                  runtimeSessionId,
                  typeof parsed?.type === "string" ? parsed.type : typeof parsed?.event?.type === "string" ? parsed.event.type : "Runtime event",
                  typeof parsed?.message === "string" ? parsed.message : undefined,
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
) {
  const inputCheck = proxyInput(userText);
  if (inputCheck.verdict === "block") {
    return Response.json({ error: inputCheck.reason ?? "Message blocked by security policy" }, { status: 400 });
  }
  let runtimeProfile = profile;
  let usePodHeaders: Record<string, string> = {};
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
  const url = buildOpenAICompatibleUrl(runtimeProfile);
  const lockKey = interactiveRuntimeLockKey(runtimeProfile, url);
  if (!reserveInteractiveRuntime(lockKey)) {
    return Response.json({ error: `${runtimeProfile.name || runtimeProfile.runtime} is already running another interactive request at ${url}.` }, { status: 409 });
  }

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
  const modelMessagesFor = (candidateModel: string) => {
    const candidateProfile = profileWithResolvedModel(runtimeProfile, candidateModel);
    const context = [
      buildAgentProfileContext(candidateProfile),
      buildAdaptiveOpenRouterResolvedModelContext(runtimeProfile, candidateModel),
      buildAgentModeContext(agentMode),
      buildWorkingDirectoryContext(workingDirectory),
      buildVaultContext(sharedVault),
      buildWalletToolContext(wallet),
    ].filter(Boolean).join("\n\n");
    return context ? [{ role: "system" as const, content: context }, ...messages] : messages;
  };
  let candidateModels: string[];
  try {
    candidateModels = isAdaptiveOpenRouterProfile(runtimeProfile)
      ? await resolveAdaptiveOpenRouterModels(runtimeProfile, messages)
      : [openAICompatibleModel(runtimeProfile)];
  } catch (error) {
    releaseInteractiveRuntime(lockKey);
    return Response.json({ error: error instanceof Error ? error.message : "Adaptive OpenRouter model selection failed." }, { status: 502 });
  }
  const fetchStartedAt = Date.now();
  let upstream: Response | null = null;
  let model = candidateModels[0] ?? openAICompatibleModel(profile);
  let lastStatus = 0;
  let lastFetchError: unknown = null;
  const attemptedModels: string[] = [];
  for (const candidateModel of candidateModels) {
    model = candidateModel;
    attemptedModels.push(candidateModel);
    const modelMessages = modelMessagesFor(candidateModel);
    recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.fetch.start", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model,
      adaptiveOpenRouter,
      usePod: usePodEnabled,
      messageCount: modelMessages.length,
    });
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(runtimeProfile.token ? { Authorization: `Bearer ${runtimeProfile.token}` } : {}),
          ...usePodHeaders,
        },
        body: JSON.stringify({
          model,
          messages: modelMessages,
          stream: true,
        }),
        signal: AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      lastFetchError = error;
      recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.fetch.failed", {
        ...telemetryPayloadForProfile(runtimeProfile),
        url,
        model,
        adaptiveOpenRouter,
        usePod: usePodEnabled,
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        attempt: attemptedModels.length,
        remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
        elapsedMs: Date.now() - fetchStartedAt,
      });
      if (adaptiveOpenRouter && attemptedModels.length < candidateModels.length) {
        continue;
      }
      await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible fetch failed", runtimeFetchError(runtimeProfile, url, error)).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
      releaseInteractiveRuntime(lockKey);
      return Response.json({ error: runtimeFetchError(runtimeProfile, url, error) }, { status: 502 });
    }
    if (upstream.ok) break;
    lastStatus = upstream.status;
    const errorText = await upstream.text().catch(() => "");
    recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.upstream_error", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model,
      adaptiveOpenRouter,
      usePod: usePodEnabled,
      status: upstream.status,
      bodyPreview: errorText.slice(0, 500),
      attempt: attemptedModels.length,
      remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
      elapsedMs: Date.now() - fetchStartedAt,
    });
    if (adaptiveOpenRouter && retryableAdaptiveOpenRouterStatus(upstream.status) && attemptedModels.length < candidateModels.length) {
      continue;
    }
    await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible upstream error", providerErrorMessage(errorText, upstream.status, model)).catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    releaseInteractiveRuntime(lockKey);
    return new Response(
      ssePayload({ error: adaptiveOpenRouter && retryableAdaptiveOpenRouterStatus(upstream.status)
        ? finalAdaptiveOpenRouterError(upstream.status, attemptedModels)
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
        ? `OpenRouter had a network issue while Adaptive was trying free models. Adaptive tried ${attemptedModels.length || 1} model${attemptedModels.length === 1 ? "" : "s"}. Try again shortly or set a paid fallback model in Adaptive advanced settings.`
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
      const reader = upstream.body?.getReader();
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
      let buffer = "";
      let fullText = "";
      const channelMarkupState = createChannelMarkupState();
      try {
        while (reader) {
          const { value, done } = await reader.read();
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
    };
    if (!body.agent || !Array.isArray(body.messages)) throw new Error("Missing agent or messages");
    profile = body.agent;
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
  } catch {
    await recordRouteTelemetry(request, "agent_runtime.request.invalid", { elapsedMs: Date.now() - routeStartedAt });
    return Response.json({ error: "Expected { agent, messages }" }, { status: 400 });
  }
  await recordRouteTelemetry(request, "agent_runtime.request.received", {
    ...telemetryPayloadForProfile(profile),
    messageCount: messages.length,
    workingDirectorySet: Boolean(workingDirectory?.trim()),
    runtimeSessionIdSet: Boolean(runtimeSessionId.trim()),
    agentMode,
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
  await startRuntimeChatSession({
    sessionId: runtimeSessionId,
    agent: profile,
    chatStorageKey,
    userContent: userPrompt,
    startedAt: routeStartedAt,
  }).catch(() => undefined);
  const runtimeContexts = [buildAgentProfileContext(profile), buildAgentModeContext(agentMode), buildWorkingDirectoryContext(workingDirectory), buildVaultContext(vault), buildWalletToolContext(wallet)].filter(Boolean).join("\n\n");
  const textWithVaultContext = runtimeContexts
    ? `${runtimeContexts}\n\nUser message:\n${userPrompt}`
    : promptCheck.text;
  if (profile.runtime !== "openclaw") {
    const adapter = getRuntimeAdapter(profile.runtime);
    if (adapter && !adapter.capabilities.chat) {
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
    if (profile.runtime === "hermes" && profile.telemetryUrl?.trim() && profile.collectorCapabilities?.chat === false) {
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
    const effectiveProfile = await collectorChatProfile(profile) ?? profile;
    const profileError = validateHttpRuntimeProfile(effectiveProfile);
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
      contextLength: runtimeContexts.length,
      agentMode,
      elapsedMs: Date.now() - routeStartedAt,
    });
    return streamHttpRuntime(effectiveProfile, messages, promptCheck.text, vault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, {
      request,
      routeStartedAt,
    });
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
    contextLength: runtimeContexts.length,
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
              toolEventCount,
              toolName: typeof toolData.name === "string" ? toolData.name : typeof toolData.tool === "string" ? toolData.tool : null,
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
              statusEventCount,
              statusType: status.type,
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
