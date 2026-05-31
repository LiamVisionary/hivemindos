import "server-only";

import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { AgentProfile } from "@/lib/types/agent-runtime";

export type UsePodRegistration = {
  token: string;
  depositAddress: string;
  raw: unknown;
};

export type UsePodRuntimeConfig = {
  token: string;
  tokenEnvName: string;
  baseUrl: string;
  chatPath: string;
  statusPath: string;
  headers: Record<string, string>;
};

export type UsePodModel = {
  id: string;
  name?: string;
};

export type UsePodCheckStatus = "ready" | "missing-token" | "needs-funding" | "cap-too-low" | "provider-unavailable" | "error";

export type UsePodCheckResult = {
  ok: boolean;
  status: UsePodCheckStatus;
  message: string;
  tokenEnvName: string;
  depositAddress: string;
  modelCount: number;
  models: UsePodModel[];
  balanceRemaining: string;
  route: string;
  checkedAt: string;
  httpStatus?: number;
};

const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const HERMES_ENV_FILE = join(homedir(), ".hermes", ".env");
const USEPOD_API_BASE = "https://api.usepod.ai";
const USEPOD_DEFAULT_TOKEN_ENV = "USEPOD_TOKEN";
const USEPOD_DEPOSIT_ENV = "USEPOD_DEPOSIT_ADDRESS";

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
  return models;
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
  return `${USEPOD_API_BASE}/proxy/${encodeURIComponent(token)}/v1`;
}

export async function readUsePodEnvValue(key: string) {
  const existing = process.env[key]?.trim();
  if (existing) return existing;
  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    const value = parseEnvFileValue(raw, key);
    if (value) return value;
  }
  return "";
}

export async function readUsePodDepositAddress(profile?: Pick<AgentProfile, "usePod">) {
  return profile?.usePod?.depositAddress?.trim() || await readUsePodEnvValue(USEPOD_DEPOSIT_ENV);
}

export async function resolveUsePodRuntimeConfig(profile: AgentProfile): Promise<UsePodRuntimeConfig | null> {
  if (!isUsePodProfile(profile)) return null;
  const tokenEnvName = profile.usePod?.tokenEnvName?.trim() || USEPOD_DEFAULT_TOKEN_ENV;
  const token = profile.token?.trim() || await readUsePodEnvValue(tokenEnvName);
  if (!token) {
    throw new Error(`${tokenEnvName} is required before this UsePod agent can run inference. Use the UsePod setup action or save a funded token in shared env.`);
  }
  const inputCeiling = cleanMicrounits(profile.usePod?.maxPriceInputMicrounits ?? await readUsePodEnvValue("USEPOD_MAX_PRICE_INPUT_MICRO_USDC"));
  const outputCeiling = cleanMicrounits(profile.usePod?.maxPriceOutputMicrounits ?? await readUsePodEnvValue("USEPOD_MAX_PRICE_OUTPUT_MICRO_USDC"));
  return {
    token,
    tokenEnvName,
    baseUrl: buildUsePodOpenAIBaseUrl(token),
    chatPath: "/chat/completions",
    statusPath: "/models",
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
  const depositAddress = firstString(data, ["depositAddress", "deposit_address", "address", "usdcDepositAddress", "usdc_deposit_address"]);
  if (!token || !depositAddress) throw new Error("UsePod did not return both a token and a USDC deposit address.");
  return { token, depositAddress, raw: data };
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
      depositAddress: await readUsePodDepositAddress(profile),
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
      depositAddress: await readUsePodDepositAddress(profile),
      modelCount: 0,
      models: [],
      balanceRemaining: "",
      route: "",
      checkedAt,
    };
  }
  const response = await fetch(`${config.baseUrl}${config.statusPath}`, {
    method: "GET",
    headers: config.headers,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const headers = summarizeUsePodResponseHeaders(response.headers);
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => "") })) as unknown;
  const models = extractUsePodModels(data);
  if (!response.ok) {
    const detail = extractErrorMessage(data, `UsePod returned HTTP ${response.status}.`);
    const status = categorizeUsePodError(response.status, detail);
    return {
      ok: false,
      status,
      message: messageForUsePodError(status, detail),
      tokenEnvName: config.tokenEnvName,
      depositAddress: await readUsePodDepositAddress(profile),
      modelCount: 0,
      models: [],
      balanceRemaining: headers?.balanceRemaining ?? "",
      route: headers?.route ?? "",
      checkedAt,
      httpStatus: response.status,
    };
  }
  return {
    ok: true,
    status: "ready",
    message: models.length ? `UsePod returned ${models.length} model${models.length === 1 ? "" : "s"}.` : "UsePod is reachable, but no models were returned.",
    tokenEnvName: config.tokenEnvName,
    depositAddress: await readUsePodDepositAddress(profile),
    modelCount: models.length,
    models,
    balanceRemaining: headers?.balanceRemaining ?? profile.usePod?.lastBalanceRemaining ?? "",
    route: headers?.route ?? profile.usePod?.lastRoute ?? "",
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
      message: error instanceof Error ? error.message : "UsePod model check failed.",
      tokenEnvName: profile.usePod?.tokenEnvName?.trim() || USEPOD_DEFAULT_TOKEN_ENV,
      depositAddress: await readUsePodDepositAddress(profile),
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
      depositAddress: await readUsePodDepositAddress(profile),
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
      depositAddress: await readUsePodDepositAddress(profile),
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
  if (!response.ok) {
    const detail = extractErrorMessage(data, `UsePod returned HTTP ${response.status}.`);
    const status = categorizeUsePodError(response.status, detail);
    return {
      ok: false,
      status,
      message: messageForUsePodError(status, detail),
      tokenEnvName: config.tokenEnvName,
      depositAddress: await readUsePodDepositAddress(profile),
      modelCount: 0,
      models: [],
      balanceRemaining: headers?.balanceRemaining ?? "",
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
    depositAddress: await readUsePodDepositAddress(profile),
    modelCount: 0,
    models: [],
    balanceRemaining: headers?.balanceRemaining ?? profile.usePod?.lastBalanceRemaining ?? "",
    route: headers?.route ?? profile.usePod?.lastRoute ?? "",
    checkedAt,
    httpStatus: response.status,
  };
}

async function writeHiveEnvValue(key: string, value: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.cwd(), "scripts", "hive-env-add"), [
      "--stdin",
      ...args,
      key,
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out while saving ${key} to shared env.`));
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
      reject(new Error(stderr.trim() || `hive-env-add exited with status ${code ?? "unknown"} while saving ${key}.`));
    });
    child.stdin.end(value);
  });
}

export async function saveUsePodRegistration(registration: UsePodRegistration) {
  const entries: Array<[string, string]> = [
    [USEPOD_DEFAULT_TOKEN_ENV, registration.token],
    [USEPOD_DEPOSIT_ENV, registration.depositAddress],
  ];
  for (const [key, value] of entries) {
    await writeHiveEnvValue(key, value, [
      "--scope",
      "agent",
      "--runtime",
      "generic",
    ]);
    for (const runtime of ["openclaw", "hermes", "aeon"]) {
      await writeHiveEnvValue(key, value, [
        "--no-backup",
        "--no-tailnet-sync",
        "--scope",
        "agent",
        "--runtime",
        runtime,
      ]);
    }
  }
}
