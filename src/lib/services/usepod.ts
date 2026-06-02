import "server-only";

import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { USEPOD_API_BASE, type UsePodApiCompatibility, type UsePodRoutingMode } from "@/lib/config/usepod-features";
import { resolveUsePodUsdcRecipientAddress } from "@/lib/services/usepod/deposit-recipient";
import type { AgentProfile } from "@/lib/types/agent-runtime";

export type UsePodRegistration = {
  token: string;
  tokenEnvName?: string;
  depositAddress: string;
  depositCode: string;
  dashboardUrl: string;
  raw: unknown;
};

export type UsePodRuntimeConfig = {
  token: string;
  tokenEnvName: string;
  tokenSource: UsePodTokenSource;
  baseUrl: string;
  apiCompatibility: UsePodApiCompatibility;
  routingMode: UsePodRoutingMode;
  chatPath: string;
  statusPath: string;
  headers: Record<string, string>;
};

export type UsePodModel = {
  id: string;
  name?: string;
};

export type UsePodCheckStatus = "ready" | "missing-token" | "needs-funding" | "cap-too-low" | "provider-unavailable" | "error";
export type UsePodTokenSource = "profile" | "dashboard-url" | "hivemindos-env" | "legacy-hermes-env" | "process-env" | "missing";

export type UsePodCheckResult = {
  ok: boolean;
  status: UsePodCheckStatus;
  message: string;
  tokenEnvName: string;
  tokenPresent: boolean;
  tokenSource: UsePodTokenSource;
  depositAddress: string;
  depositCode: string;
  dashboardUrl: string;
  modelCount: number;
  models: UsePodModel[];
  balanceRemaining: string;
  route: string;
  checkedAt: string;
  httpStatus?: number;
};

const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const HERMES_ENV_FILE = join(homedir(), ".hermes", ".env");
const USEPOD_DEFAULT_TOKEN_ENV = "USEPOD_TOKEN";
const USEPOD_DEPOSIT_ENV = "USEPOD_DEPOSIT_ADDRESS";
const USEPOD_DEPOSIT_CODE_ENV = "USEPOD_DEPOSIT_CODE";
const USEPOD_DASHBOARD_URL_ENV = "USEPOD_DASHBOARD_URL";

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

function firstString(record: unknown, keys: string[]) {
  if (!record || typeof record !== "object") return "";
  const source = record as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function nestedString(record: unknown, path: string[]) {
  let current = record;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : "";
}

function cleanMicrounits(value: unknown) {
  const text = typeof value === "string" ? value.trim() : Number.isFinite(value) ? String(value) : "";
  if (!text) return "";
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) return "";
  return String(Math.round(numeric));
}

function messageForUsePodError(status: UsePodCheckStatus, detail = "") {
  if (status === "missing-token") return detail || "Save a UsePod token before checking models.";
  if (status === "needs-funding") return detail || "UsePod is reachable, but the token needs USDC funding before inference.";
  if (status === "cap-too-low") return detail || "UsePod rejected the request under the current price caps.";
  if (status === "provider-unavailable") return detail || "UsePod is reachable, but no route was available for this check.";
  return detail || "UsePod could not be checked right now.";
}

function isRetryableUsePodError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const cause = "cause" in error ? error.cause : undefined;
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  return error.name === "TimeoutError"
    || error.message.toLowerCase().includes("fetch failed")
    || code.startsWith("UND_")
    || code === "ECONNRESET"
    || code === "ETIMEDOUT";
}

function messageForUsePodNetworkError(error: unknown) {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "UsePod did not answer the model check in time. If you just funded it, wait a moment and check again.";
  }
  return "HivemindOS could not reach UsePod for the model check. Your token may be funded, but the checker hit a network hiccup. Try Check funding again.";
}

function categorizeUsePodError(status: number, detail: string): UsePodCheckStatus {
  const text = detail.toLowerCase();
  if (status === 401 || status === 403) return "missing-token";
  if (status === 402 || text.includes("fund") || text.includes("balance") || text.includes("deposit")) return "needs-funding";
  if (status === 409 || status === 429 || text.includes("price") || text.includes("cap") || text.includes("ceiling")) return "cap-too-low";
  if (status >= 500 || text.includes("route") || text.includes("provider") || text.includes("capacity")) return "provider-unavailable";
  return "error";
}

function extractUsePodModels(data: unknown): UsePodModel[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const items = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  const models: UsePodModel[] = [];
  for (const item of items) {
    if (typeof item === "string" && item.trim()) {
      models.push({ id: item.trim() });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id) continue;
    const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : undefined;
    models.push({ id, name });
  }
  const uniqueModels = new Map<string, UsePodModel>();
  for (const model of models) {
    const existing = uniqueModels.get(model.id);
    if (!existing) {
      uniqueModels.set(model.id, model);
      continue;
    }
    if (!existing.name && model.name) uniqueModels.set(model.id, model);
  }
  return Array.from(uniqueModels.values());
}

function extractUsePodBalanceRemaining(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const queue: unknown[] = [data];
  const balanceKeys = new Set([
    "balance",
    "balance_remaining",
    "balanceRemaining",
    "remaining_balance",
    "remainingBalance",
    "remaining_usdc",
    "remainingUsdc",
    "usdcBalance",
    "usdBalance",
  ]);
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (balanceKeys.has(key) && (typeof value === "string" || typeof value === "number")) {
        const text = String(value).trim();
        if (text) return text;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) queue.push(value);
    }
  }
  return "";
}

function numericRecordValue(record: unknown, key: string): number | null {
  if (!record || typeof record !== "object") return null;
  const value = (record as Record<string, unknown>)[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const numeric = Number(value.trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function formatUsePodUsd(value: number) {
  if (!Number.isFinite(value) || value < 0) return "";
  return value.toFixed(2);
}

function parseUsePodUsd(value?: string | number | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : null;
  const text = value?.trim();
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function extractUsePodProxyBalance(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const direct = firstString(data, ["balance_usdc", "balanceUsd", "balance_usd"]);
  if (direct) return direct;
  const microUsdc = numericRecordValue(data, "usdc_balance") ?? numericRecordValue(data, "balance_units");
  if (microUsdc !== null) return formatUsePodUsd(microUsdc / 1_000_000);
  const creditBalance = numericRecordValue(data, "credit_balance");
  if (creditBalance !== null) return formatUsePodUsd(creditBalance);
  return "";
}

function extractErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  if (record.error && typeof record.error === "object") {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) return nested.message.trim();
  }
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  return fallback;
}

export function isUsePodProfile(profile: Pick<AgentProfile, "provider">) {
  return profile.provider?.trim().toLowerCase() === "usepod";
}

export function buildUsePodOpenAIBaseUrl(token: string) {
  return buildUsePodProxyBaseUrl(token, "openai");
}

export function buildUsePodAnthropicBaseUrl(token: string) {
  return buildUsePodProxyBaseUrl(token, "anthropic");
}

export function buildUsePodProxyBaseUrl(token: string, compatibility: UsePodApiCompatibility = "openai") {
  const encodedToken = encodeURIComponent(token);
  return compatibility === "anthropic"
    ? `${USEPOD_API_BASE}/proxy/${encodedToken}`
    : `${USEPOD_API_BASE}/proxy/${encodedToken}/v1`;
}

function tokenFromUsePodDashboardUrl(url?: string) {
  const text = url?.trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.searchParams.get("token")?.trim() || "";
  } catch {
    const match = text.match(/[?&]token=([^&#]+)/);
    return match ? decodeURIComponent(match[1]).trim() : "";
  }
}

export function buildUsePodTokenEnvNameFromToken(token: string) {
  const suffix = token
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 24)
    .toUpperCase();
  return suffix ? `USEPOD_TOKEN_${suffix}` : USEPOD_DEFAULT_TOKEN_ENV;
}

function buildUsePodTokenEnvName(registration: Pick<UsePodRegistration, "depositCode" | "token">) {
  return buildUsePodTokenEnvNameFromToken(registration.token || registration.depositCode);
}

async function readUsePodEnvValueWithSource(key: string): Promise<{ value: string; source: UsePodTokenSource }> {
  const existing = process.env[key]?.trim();
  if (existing) return { value: existing, source: "process-env" };
  const sources: Array<[string, UsePodTokenSource]> = [
    [HIVE_ENV_FILE, "hivemindos-env"],
    [HERMES_ENV_FILE, "legacy-hermes-env"],
  ];
  for (const [path, source] of sources) {
    const raw = await readFile(path, "utf8").catch(() => "");
    const value = parseEnvFileValue(raw, key);
    if (value) return { value, source };
  }
  return { value: "", source: "missing" };
}

export async function readUsePodEnvValue(key: string) {
  return (await readUsePodEnvValueWithSource(key)).value;
}

export async function readUsePodDepositAddress(profile?: Pick<AgentProfile, "usePod">, options?: { deriveFallback?: boolean }) {
  const saved = profile?.usePod?.depositAddress?.trim() || await readUsePodEnvValue(USEPOD_DEPOSIT_ENV);
  if (saved || !options?.deriveFallback) return saved;
  return await resolveUsePodUsdcRecipientAddress().catch(() => "");
}

export async function readUsePodDepositCode(profile?: Pick<AgentProfile, "usePod">) {
  return profile?.usePod?.depositCode?.trim() || await readUsePodEnvValue(USEPOD_DEPOSIT_CODE_ENV);
}

export async function readUsePodDashboardUrl(profile?: Pick<AgentProfile, "usePod">) {
  return profile?.usePod?.dashboardUrl?.trim() || await readUsePodEnvValue(USEPOD_DASHBOARD_URL_ENV);
}

export async function readUsePodSavedSetup(profile?: Pick<AgentProfile, "usePod">): Promise<UsePodCheckResult> {
  const tokenEnvName = profile?.usePod?.tokenEnvName?.trim() || USEPOD_DEFAULT_TOKEN_ENV;
  const depositCode = await readUsePodDepositCode(profile);
  const dashboardUrl = await readUsePodDashboardUrl(profile);
  const envToken = await readUsePodEnvValueWithSource(tokenEnvName);
  const dashboardToken = envToken.value ? "" : tokenFromUsePodDashboardUrl(dashboardUrl);
  const token = envToken.value || dashboardToken;
  const tokenSource: UsePodTokenSource = envToken.value ? envToken.source : dashboardToken ? "dashboard-url" : "missing";
  const depositAddress = await readUsePodDepositAddress(profile, { deriveFallback: Boolean(token || depositCode || dashboardUrl) });
  return {
    ok: Boolean(token),
    status: token ? "needs-funding" : "missing-token",
    message: token ? "UsePod token is saved." : "No saved UsePod token found.",
    tokenEnvName,
    tokenPresent: Boolean(token),
    tokenSource,
    depositAddress,
    depositCode,
    dashboardUrl,
    modelCount: 0,
    models: [],
    balanceRemaining: "",
    route: "",
    checkedAt: new Date().toISOString(),
  };
}

export async function resolveUsePodRuntimeConfig(profile: AgentProfile): Promise<UsePodRuntimeConfig | null> {
  if (!isUsePodProfile(profile)) return null;
  const tokenEnvName = profile.usePod?.tokenEnvName?.trim() || USEPOD_DEFAULT_TOKEN_ENV;
  const profileToken = profile.token?.trim() || "";
  const envToken = profileToken ? { value: "", source: "missing" as UsePodTokenSource } : await readUsePodEnvValueWithSource(tokenEnvName);
  const dashboardToken = profileToken || envToken.value ? "" : tokenFromUsePodDashboardUrl(profile.usePod?.dashboardUrl);
  const token = profileToken || envToken.value || dashboardToken;
  const tokenSource: UsePodTokenSource = profileToken ? "profile" : envToken.value ? envToken.source : dashboardToken ? "dashboard-url" : "missing";
  if (!token) {
    throw new Error(`${tokenEnvName} is required before this UsePod agent can run inference. Use the UsePod setup action or save a funded token in shared env.`);
  }
  const inputCeiling = cleanMicrounits(profile.usePod?.maxPriceInputMicrounits ?? await readUsePodEnvValue("USEPOD_MAX_PRICE_INPUT_MICRO_USDC"));
  const outputCeiling = cleanMicrounits(profile.usePod?.maxPriceOutputMicrounits ?? await readUsePodEnvValue("USEPOD_MAX_PRICE_OUTPUT_MICRO_USDC"));
  const apiCompatibility = profile.usePod?.apiCompatibility === "anthropic" ? "anthropic" : "openai";
  const routingMode = profile.usePod?.routingMode === "marketplace-only" ? "marketplace-only" : "auto";
  return {
    token,
    tokenEnvName,
    tokenSource,
    baseUrl: buildUsePodProxyBaseUrl(token, apiCompatibility),
    apiCompatibility,
    routingMode,
    chatPath: apiCompatibility === "anthropic" ? "/v1/messages" : "/chat/completions",
    statusPath: apiCompatibility === "anthropic" ? "/v1/models" : "/models",
    headers: {
      ...(inputCeiling ? { "X-Pod-Max-Price-Input": inputCeiling } : {}),
      ...(outputCeiling ? { "X-Pod-Max-Price-Output": outputCeiling } : {}),
    },
  };
}

export function summarizeUsePodResponseHeaders(headers: Headers) {
  const balanceRemaining = headers.get("X-Balance-Remaining") ?? headers.get("x-balance-remaining") ?? "";
  const route = headers.get("X-Pod-Route") ?? headers.get("x-pod-route") ?? "";
  if (!balanceRemaining && !route) return null;
  return {
    balanceRemaining,
    route,
  };
}

async function fetchUsePodTokenBalance(config: UsePodRuntimeConfig) {
  const response = await fetch(`${USEPOD_API_BASE}/proxy/${encodeURIComponent(config.token)}/balance`, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => "") })) as unknown;
  if (!response.ok) return "";
  return extractUsePodProxyBalance(data);
}

async function probeUsePodBalance(config: UsePodRuntimeConfig, model: string) {
  const response = await fetch(`${config.baseUrl}${config.chatPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...config.headers,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ok" }],
      stream: false,
      max_tokens: 1,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const headers = summarizeUsePodResponseHeaders(response.headers);
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => "") })) as unknown;
  const balanceRemaining = headers?.balanceRemaining || extractUsePodBalanceRemaining(data);
  const route = headers?.route ?? "";
  if (!response.ok) {
    const detail = extractErrorMessage(data, `UsePod returned HTTP ${response.status}.`);
    const status = categorizeUsePodError(response.status, detail);
    return {
      ok: false,
      status,
      message: messageForUsePodError(status, detail),
      balanceRemaining,
      route,
      httpStatus: response.status,
    };
  }
  return {
    ok: true,
    status: "ready" as const,
    message: `UsePod completed a tiny funding check with ${model}.`,
    balanceRemaining,
    route,
    httpStatus: response.status,
  };
}

export async function registerUsePodToken(): Promise<UsePodRegistration> {
  const response = await fetch(`${USEPOD_API_BASE}/v1/register`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => "") })) as unknown;
  if (!response.ok) {
    const message = firstString(data, ["error", "message"]) || `UsePod register returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  const token = firstString(data, ["token", "apiToken", "api_token", "access_token"]);
  const depositCode = firstString(data, ["depositCode", "deposit_code", "code"]);
  const apiDepositAddress = firstString(data, ["depositAddress", "deposit_address", "address", "usdcDepositAddress", "usdc_deposit_address"]);
  const depositAddress = apiDepositAddress || await resolveUsePodUsdcRecipientAddress().catch(() => "");
  const dashboardUrl = firstString(data, ["dashboardUrl", "dashboard_url", "fundingUrl", "funding_url"])
    || nestedString(data, ["instructions", "dashboard_url"]);
  if (!token) throw new Error("UsePod did not return an API token.");
  if (!depositAddress && !depositCode && !dashboardUrl) {
    throw new Error("UsePod did not return funding instructions for the token.");
  }
  return { token, tokenEnvName: buildUsePodTokenEnvName({ token, depositCode }), depositAddress, depositCode, dashboardUrl, raw: data };
}

async function requestUsePodModels(profile: AgentProfile): Promise<UsePodCheckResult> {
  const checkedAt = new Date().toISOString();
  let config: UsePodRuntimeConfig | null = null;
  try {
    config = await resolveUsePodRuntimeConfig({ ...profile, provider: "usepod" });
  } catch (error) {
    return {
      ok: false,
      status: "missing-token",
      message: error instanceof Error ? error.message : "UsePod token is missing.",
      tokenEnvName: profile.usePod?.tokenEnvName?.trim() || USEPOD_DEFAULT_TOKEN_ENV,
      tokenPresent: false,
      tokenSource: "missing",
      depositAddress: await readUsePodDepositAddress(profile),
      depositCode: await readUsePodDepositCode(profile),
      dashboardUrl: await readUsePodDashboardUrl(profile),
      modelCount: 0,
      models: [],
      balanceRemaining: "",
      route: "",
      checkedAt,
    };
  }
  if (!config) {
    return {
      ok: false,
      status: "missing-token",
      message: "UsePod token is missing.",
      tokenEnvName: profile.usePod?.tokenEnvName?.trim() || USEPOD_DEFAULT_TOKEN_ENV,
      tokenPresent: false,
      tokenSource: "missing",
      depositAddress: await readUsePodDepositAddress(profile),
      depositCode: await readUsePodDepositCode(profile),
      dashboardUrl: await readUsePodDashboardUrl(profile),
      modelCount: 0,
      models: [],
      balanceRemaining: "",
      route: "",
      checkedAt,
    };
  }
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${config.statusPath}`, {
      method: "GET",
      headers: config.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    if (!isRetryableUsePodError(error)) throw error;
    response = await fetch(`${config.baseUrl}${config.statusPath}`, {
      method: "GET",
      headers: config.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    }).catch((retryError) => {
      throw new Error(messageForUsePodNetworkError(retryError));
    });
  }
  const headers = summarizeUsePodResponseHeaders(response.headers);
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => "") })) as unknown;
  const models = extractUsePodModels(data);
  const bodyBalance = extractUsePodBalanceRemaining(data);
  let balanceRemaining = headers?.balanceRemaining || bodyBalance;
  let route = headers?.route ?? "";
  if (response.ok && !balanceRemaining) {
    balanceRemaining = await fetchUsePodTokenBalance(config).catch(() => "");
  }
  const balanceUsd = parseUsePodUsd(balanceRemaining);
  let fundingProbeSucceeded = false;
  if (response.ok && models[0]?.id && (balanceUsd === null || balanceUsd <= 0)) {
    const probe = await probeUsePodBalance(config, models[0].id).catch(() => null);
    balanceRemaining = probe?.balanceRemaining || balanceRemaining;
    route = probe?.route || route;
    if (probe && !probe.ok) {
      return {
        ok: false,
        status: probe.status,
        message: probe.message,
        tokenEnvName: config.tokenEnvName,
        tokenPresent: true,
        tokenSource: config.tokenSource,
        depositAddress: await readUsePodDepositAddress(profile, { deriveFallback: true }),
        depositCode: await readUsePodDepositCode(profile),
        dashboardUrl: await readUsePodDashboardUrl(profile),
        modelCount: 0,
        models: [],
        balanceRemaining,
        route,
        checkedAt,
        httpStatus: probe.httpStatus,
      };
    }
    if (!probe && balanceUsd !== null && balanceUsd <= 0) {
      return {
        ok: false,
        status: "needs-funding",
        message: messageForUsePodError("needs-funding"),
        tokenEnvName: config.tokenEnvName,
        tokenPresent: true,
        tokenSource: config.tokenSource,
        depositAddress: await readUsePodDepositAddress(profile, { deriveFallback: true }),
        depositCode: await readUsePodDepositCode(profile),
        dashboardUrl: await readUsePodDashboardUrl(profile),
        modelCount: 0,
        models: [],
        balanceRemaining,
        route,
        checkedAt,
        httpStatus: response.status,
      };
    }
    if (probe?.ok) fundingProbeSucceeded = true;
  }
  if (response.ok && models.length && !fundingProbeSucceeded && !balanceRemaining && parseUsePodUsd(balanceRemaining) === null) {
    return {
      ok: false,
      status: "provider-unavailable",
      message: "UsePod returned models, but HivemindOS could not confirm that the token is funded. Try Check funding again in a moment.",
      tokenEnvName: config.tokenEnvName,
      tokenPresent: true,
      tokenSource: config.tokenSource,
      depositAddress: await readUsePodDepositAddress(profile, { deriveFallback: true }),
      depositCode: await readUsePodDepositCode(profile),
      dashboardUrl: await readUsePodDashboardUrl(profile),
      modelCount: 0,
      models: [],
      balanceRemaining,
      route,
      checkedAt,
      httpStatus: response.status,
    };
  }
  if (!response.ok) {
    const detail = extractErrorMessage(data, `UsePod returned HTTP ${response.status}.`);
    const status = categorizeUsePodError(response.status, detail);
    return {
      ok: false,
      status,
      message: messageForUsePodError(status, detail),
      tokenEnvName: config.tokenEnvName,
      tokenPresent: true,
      tokenSource: config.tokenSource,
      depositAddress: await readUsePodDepositAddress(profile, { deriveFallback: true }),
      depositCode: await readUsePodDepositCode(profile),
      dashboardUrl: await readUsePodDashboardUrl(profile),
      modelCount: 0,
      models: [],
      balanceRemaining,
      route,
      checkedAt,
      httpStatus: response.status,
    };
  }
  if (!models.length) {
    return {
      ok: false,
      status: "provider-unavailable",
      message: "UsePod is reachable, but no models were returned.",
      tokenEnvName: config.tokenEnvName,
      tokenPresent: true,
      tokenSource: config.tokenSource,
      depositAddress: await readUsePodDepositAddress(profile, { deriveFallback: true }),
      depositCode: await readUsePodDepositCode(profile),
      dashboardUrl: await readUsePodDashboardUrl(profile),
      modelCount: 0,
      models: [],
      balanceRemaining,
      route,
      checkedAt,
      httpStatus: response.status,
    };
  }
  return {
    ok: true,
    status: "ready",
    message: `UsePod returned ${models.length} model${models.length === 1 ? "" : "s"}.`,
    tokenEnvName: config.tokenEnvName,
    tokenPresent: true,
    tokenSource: config.tokenSource,
    depositAddress: await readUsePodDepositAddress(profile, { deriveFallback: true }),
    depositCode: await readUsePodDepositCode(profile),
    dashboardUrl: await readUsePodDashboardUrl(profile),
    modelCount: models.length,
    models,
    balanceRemaining: balanceRemaining || profile.usePod?.lastBalanceRemaining || "",
    route: route || profile.usePod?.lastRoute || "",
    checkedAt,
    httpStatus: response.status,
  };
}

export async function checkUsePodModels(profile: AgentProfile): Promise<UsePodCheckResult> {
  try {
    return await requestUsePodModels(profile);
  } catch (error) {
    return {
      ok: false,
      status: "provider-unavailable",
      message: error instanceof Error && !error.message.toLowerCase().includes("fetch failed")
        ? error.message
        : messageForUsePodNetworkError(error),
      tokenEnvName: profile.usePod?.tokenEnvName?.trim() || USEPOD_DEFAULT_TOKEN_ENV,
      tokenPresent: Boolean(profile.token?.trim() || tokenFromUsePodDashboardUrl(profile.usePod?.dashboardUrl)),
      tokenSource: profile.token?.trim() ? "profile" : tokenFromUsePodDashboardUrl(profile.usePod?.dashboardUrl) ? "dashboard-url" : "missing",
      depositAddress: await readUsePodDepositAddress(profile, {
        deriveFallback: Boolean(
          profile.token?.trim()
            || tokenFromUsePodDashboardUrl(profile.usePod?.dashboardUrl)
            || profile.usePod?.depositCode
            || profile.usePod?.dashboardUrl,
        ),
      }),
      depositCode: await readUsePodDepositCode(profile),
      dashboardUrl: await readUsePodDashboardUrl(profile),
      modelCount: 0,
      models: [],
      balanceRemaining: profile.usePod?.lastBalanceRemaining ?? "",
      route: profile.usePod?.lastRoute ?? "",
      checkedAt: new Date().toISOString(),
    };
  }
}

export async function testUsePodChat(profile: AgentProfile, model: string): Promise<UsePodCheckResult> {
  const checkedAt = new Date().toISOString();
  let config: UsePodRuntimeConfig | null = null;
  try {
    config = await resolveUsePodRuntimeConfig({ ...profile, provider: "usepod" });
  } catch (error) {
    return {
      ok: false,
      status: "missing-token",
      message: error instanceof Error ? error.message : "UsePod token is missing.",
      tokenEnvName: profile.usePod?.tokenEnvName?.trim() || USEPOD_DEFAULT_TOKEN_ENV,
      tokenPresent: false,
      tokenSource: "missing",
      depositAddress: await readUsePodDepositAddress(profile),
      depositCode: await readUsePodDepositCode(profile),
      dashboardUrl: await readUsePodDashboardUrl(profile),
      modelCount: 0,
      models: [],
      balanceRemaining: "",
      route: "",
      checkedAt,
    };
  }
  if (!config) {
    return {
      ok: false,
      status: "missing-token",
      message: "UsePod token is missing.",
      tokenEnvName: profile.usePod?.tokenEnvName?.trim() || USEPOD_DEFAULT_TOKEN_ENV,
      tokenPresent: false,
      tokenSource: "missing",
      depositAddress: await readUsePodDepositAddress(profile),
      depositCode: await readUsePodDepositCode(profile),
      dashboardUrl: await readUsePodDashboardUrl(profile),
      modelCount: 0,
      models: [],
      balanceRemaining: "",
      route: "",
      checkedAt,
    };
  }
  const selectedModel = model.trim() || profile.model?.trim();
  if (!selectedModel) {
    const models = await checkUsePodModels(profile);
    return {
      ...models,
      ok: false,
      status: models.ok ? "error" : models.status,
      message: models.ok ? "Choose a UsePod model before running a chat test." : models.message,
    };
  }
  const response = await fetch(`${config.baseUrl}${config.chatPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...config.headers,
    },
    body: JSON.stringify({
      model: selectedModel,
      messages: [{ role: "user", content: "Reply with ok." }],
      stream: false,
      max_tokens: 2,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const headers = summarizeUsePodResponseHeaders(response.headers);
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => "") })) as unknown;
  const balanceRemaining = headers?.balanceRemaining
    || extractUsePodBalanceRemaining(data)
    || await fetchUsePodTokenBalance(config).catch(() => "");
  if (!response.ok) {
    const detail = extractErrorMessage(data, `UsePod returned HTTP ${response.status}.`);
    const status = categorizeUsePodError(response.status, detail);
    return {
      ok: false,
      status,
      message: messageForUsePodError(status, detail),
      tokenEnvName: config.tokenEnvName,
      tokenPresent: true,
      tokenSource: config.tokenSource,
      depositAddress: await readUsePodDepositAddress(profile, { deriveFallback: true }),
      depositCode: await readUsePodDepositCode(profile),
      dashboardUrl: await readUsePodDashboardUrl(profile),
      modelCount: 0,
      models: [],
      balanceRemaining,
      route: headers?.route ?? "",
      checkedAt,
      httpStatus: response.status,
    };
  }
  return {
    ok: true,
    status: "ready",
    message: `UsePod completed a tiny test request with ${selectedModel}.`,
    tokenEnvName: config.tokenEnvName,
    tokenPresent: true,
    tokenSource: config.tokenSource,
    depositAddress: await readUsePodDepositAddress(profile, { deriveFallback: true }),
    depositCode: await readUsePodDepositCode(profile),
    dashboardUrl: await readUsePodDashboardUrl(profile),
    modelCount: 0,
    models: [],
    balanceRemaining: balanceRemaining || profile.usePod?.lastBalanceRemaining || "",
    route: headers?.route ?? profile.usePod?.lastRoute ?? "",
    checkedAt,
    httpStatus: response.status,
  };
}

function envAssignments(entries: Array<[string, string]>) {
  return entries
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

async function importHiveEnvValues(entries: Array<[string, string]>, args: string[]) {
  const input = envAssignments(entries);
  if (!input) return;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.cwd(), "scripts", "hive-env-add"), [
      "--import-stdin",
      ...args,
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while saving UsePod credentials to shared env."));
    }, 30_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `hive-env-add exited with status ${code ?? "unknown"} while saving UsePod credentials.`));
    });
    child.stdin.end(`${input}\n`);
  });
}

export async function saveUsePodRegistration(registration: UsePodRegistration) {
  const tokenEnvName = registration.tokenEnvName || buildUsePodTokenEnvName(registration);
  const entries: Array<[string, string]> = [
    [tokenEnvName, registration.token],
    [USEPOD_DEPOSIT_ENV, registration.depositAddress],
    [USEPOD_DEPOSIT_CODE_ENV, registration.depositCode],
    [USEPOD_DASHBOARD_URL_ENV, registration.dashboardUrl],
  ];
  await importHiveEnvValues(entries, [
    "--scope",
    "agent",
    "--runtime",
    "generic",
  ]);
}
