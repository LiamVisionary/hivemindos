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
