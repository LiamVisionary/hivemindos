import { access, readFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { delimiter, join } from "path";
import { HIVEMIND_OS_RUNTIME, type AgentProfile } from "@/lib/types/agent-runtime";
import { bankrLlmModel, isBankrLlmProfile } from "@/lib/services/bankr-llm";
import { isLocalCollectorUrl, remoteCollectorLocalServiceUrl } from "@/lib/services/local-collector-url";
import { sanitizeProcessEnv } from "@/lib/utils/safe-process-env";

const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const HERMES_ENV_FILE = join(homedir(), ".hermes", ".env");

export function isOpenAICompatibleRuntime(profile: AgentProfile) {
  return profile.runtime === HIVEMIND_OS_RUNTIME;
}

export function buildOpenAICompatibleUrl(profile: AgentProfile) {
  const base = profile.gatewayUrl.trim().replace(/\/+$/, "");
  const suffix = profile.chatPath?.trim() || "/v1/chat/completions";
  return remoteCollectorLocalServiceUrl(profile, `${base}${suffix.startsWith("/") ? suffix : `/${suffix}`}`);
}

export function openAICompatibleModel(profile: AgentProfile) {
  if (isBankrLlmProfile(profile)) return bankrLlmModel(profile);
  return profile.model?.trim() || process.env.LOCAL_OPENAI_MODEL?.trim() || process.env.NEXT_PUBLIC_LOCAL_OPENAI_MODEL?.trim() || "local-model";
}

export function isLocalLmStudioProfile(profile: AgentProfile) {
  return profile.runtime === HIVEMIND_OS_RUNTIME
    && profile.provider === "lm-studio"
    && isLocalCollectorUrl(profile.telemetryUrl);
}

export type LmStudioModelLoadState = "loaded" | "not-loaded" | "not-local" | "unknown";

/**
 * Ask LM Studio whether the model is already in memory before the chat fetch.
 * `/api/v0/models` lists only locally-downloaded models with a `state` field;
 * a model that LM Studio serves from an LM Link device (it shows in
 * `/v1/models` but not here) reports "not-local". A cold model means the chat
 * request will block on a JIT load — minutes locally, or a ~70s hang ending in
 * "No models loaded" when the LM Link host is offline — so callers use this to
 * tell the session what it's actually waiting on.
 */
export async function lmStudioModelLoadState(gatewayUrl: string, model: string): Promise<LmStudioModelLoadState> {
  try {
    const base = gatewayUrl.trim().replace(/\/+$/, "");
    const res = await fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return "unknown";
    const body = await res.json().catch(() => null) as { data?: Array<{ id?: string; state?: string }> } | null;
    const entry = body?.data?.find((m) => m?.id === model);
    if (!entry) return "not-local";
    return entry.state === "loaded" ? "loaded" : "not-loaded";
  } catch {
    return "unknown";
  }
}

export function lmStudioModelLoadNotice(model: string, loadState: LmStudioModelLoadState) {
  if (loadState === "not-local") {
    return `${model} is not downloaded on this machine — LM Studio will try to serve it from an LM Link device. If that device is offline, this can stall for about a minute and then fail.`;
  }
  return `${model} is not loaded yet — LM Studio is loading it now. The first reply can take a while.`;
}

/** A 400 whose body says the model isn't available — not a request-shape
 *  problem, so retrying (e.g. without tools) would only trigger another
 *  doomed JIT load. */
export function isModelUnavailableErrorBody(body: string) {
  return /no models? (?:are currently )?loaded|model (?:is )?not loaded|failed to load model/i.test(body);
}

export function lmStudioModelUnavailableMessage(model: string) {
  return `LM Studio could not serve "${model}" — it reports no model loaded. The model may need to be loaded (\`lms load ${model}\`), or it lives on an LM Link device that is offline — check LM Link status in LM Studio, then retry.`;
}

export function lmStudioCliEnv() {
  return sanitizeProcessEnv(process.env, {
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    TERM: "dumb",
    PATH: [join(homedir(), ".lmstudio", "bin"), process.env.PATH].filter(Boolean).join(delimiter),
  });
}

export async function resolveLmStudioCliBin() {
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

export function stripTerminalControls(value: string) {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r[^\n]*/g, "")
    .trim();
}

export function isAdaptiveOpenRouterProfile(profile: AgentProfile) {
  return profile.provider?.trim().toLowerCase() === "openrouter" && profile.model?.trim().toLowerCase() === "adaptive";
}

export function profileWithResolvedModel(profile: AgentProfile, model: string): AgentProfile {
  return model && model !== profile.model ? { ...profile, model } : profile;
}

export function buildAdaptiveOpenRouterResolvedModelContext(profile: AgentProfile, model: string): string {
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

export function isOpenRouterProvider(profile: AgentProfile) {
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

export async function openRouterApiKey() {
  const existing = process.env.OPENROUTER_API_KEY?.trim();
  if (existing) return existing;
  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    const value = parseEnvFileValue(raw, "OPENROUTER_API_KEY");
    if (value) return value;
  }
  return "";
}

export async function openRouterCompatibleProfile(profile: AgentProfile) {
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

export function retryableAdaptiveOpenRouterStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status === 502 || status === 503 || status === 504;
}

export function providerErrorMessage(body: string, status: number, model?: string) {
  const parsed = (() => {
    try {
      return JSON.parse(body || "{}") as { error?: string | { message?: string; code?: string | number }; message?: string };
    } catch {
      return null;
    }
  })();
  // Some providers (e.g. Venice) return `error` as a plain string, not an object.
  const errorString = typeof parsed?.error === "string" ? parsed.error : parsed?.error?.message;
  const rawMessage = errorString || parsed?.message || body.trim();
  if (status === 429) {
    return model
      ? `OpenRouter rate-limited ${model}. Adaptive will try another free model when available.`
      : "OpenRouter rate-limited this free model. Adaptive will try another free model when available.";
  }
  if (rawMessage) return rawMessage;
  return `Provider returned error (${status})`;
}

export function finalAdaptiveOpenRouterError(status: number, modelAttempts: string[]) {
  if (status === 429) {
    return `OpenRouter's free models are currently rate-limited or out of promo capacity. Adaptive tried ${modelAttempts.length} configured model${modelAttempts.length === 1 ? "" : "s"}${modelAttempts.length ? `, ending with ${modelAttempts.at(-1)}` : ""}. Try again shortly or choose an optional paid fallback model in Adaptive advanced settings.`;
  }
  return `OpenRouter could not complete this Adaptive request after trying ${modelAttempts.length || 1} configured model${modelAttempts.length === 1 ? "" : "s"}.`;
}

export function finalAdaptiveHermesOpenRouterError(attempts: string[], lastError: string) {
  const attempted = attempts.length
    ? ` Adaptive tried ${attempts.length} Hermes/OpenRouter model${attempts.length === 1 ? "" : "s"}, ending with ${attempts.at(-1)}.`
    : "";
  return `Hermes Adaptive OpenRouter could not produce assistant text.${attempted}${lastError ? ` Last error: ${lastError}` : ""}`;
}

const HERMES_CLI_FAILURE_PREFIXES = [
  "api call failed",
  "provider resolver returned",
  "unknown provider",
  "session not found",
  "hermes exited",
] as const;

function normalizeHermesCliFailureCandidate(value: string) {
  return stripTerminalControls(value)
    .replace(/^(?:(?:⚠️?|❌|🚫|⛔)\s*)+/u, "")
    .replace(/^(?:warning|error)\s*:\s*/i, "")
    .trimStart()
    .toLowerCase();
}

function isLeakedHermesTransportFailure(value: string) {
  const normalized = stripTerminalControls(value).replace(/\r\n?/g, "\n").toLowerCase();
  if (!normalized.includes("__hivemind_hermes_event__")) return false;
  return /(?:^|\n)\s*(?:api call failed after \d+ retries|provider resolver returned|unknown provider|session not found|rate limited after \d+ retries|final error:)(?:\s|$|[^a-z0-9])/.test(normalized);
}

export function isHermesCliFailureText(value: string) {
  const normalized = normalizeHermesCliFailureCandidate(value);
  return HERMES_CLI_FAILURE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || isLeakedHermesTransportFailure(value);
}

export function isPotentialHermesCliFailureText(value: string) {
  const normalized = normalizeHermesCliFailureCandidate(value);
  if (!normalized) return true;
  return HERMES_CLI_FAILURE_PREFIXES.some(
    (prefix) => prefix.startsWith(normalized) || normalized.startsWith(prefix),
  );
}

export function isFleetSharedEnvAccessErrorBody(value: string) {
  try {
    const parsed = JSON.parse(value) as { code?: unknown };
    return parsed?.code === "fleet_shared_env_access_blocked";
  } catch {
    return false;
  }
}

export function finalAdaptiveProviderError(status: number, attempts: string[]) {
  const attempted = attempts.length ? ` Adaptive tried ${attempts.length} route${attempts.length === 1 ? "" : "s"}, ending with ${attempts.at(-1)}.` : "";
  if (status === 429) return `Adaptive free routing is currently rate-limited or out of free capacity.${attempted} Try again shortly or disable that provider in Adaptive settings.`;
  return `Adaptive could not complete this request.${attempted}`;
}
