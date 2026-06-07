import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentProfile } from "@/lib/types/agent-runtime";

export const BANKR_LLM_BASE_URL = "https://llm.bankr.bot";
export const BANKR_LLM_CHAT_PATH = "/v1/chat/completions";
export const BANKR_LLM_MODELS_PATH = "/v1/models";

const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const BANKR_CONFIG_FILE = join(homedir(), ".bankr", "config.json");
const BANKR_LLM_KEY_ENV_NAMES = ["BANKR_LLM_KEY", "BANKR_API_KEY", "BANKR_MANAGEMENT_KEY"] as const;

export function isBankrLlmProfile(profile: Pick<AgentProfile, "provider">) {
  return profile.provider?.trim().toLowerCase() === "bankr";
}

export async function bankrLlmApiKey() {
  for (const key of BANKR_LLM_KEY_ENV_NAMES) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }

  const raw = await readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  for (const key of BANKR_LLM_KEY_ENV_NAMES) {
    const value = parseEnvFileValue(raw, key);
    if (value) return value;
  }

  const bankrConfig = await bankrCliConfig();
  const cliLlmKey = bankrConfig.llmKey?.trim();
  if (cliLlmKey) return cliLlmKey;
  const cliApiKey = bankrConfig.apiKey?.trim();
  if (cliApiKey) return cliApiKey;

  return "";
}

export async function bankrLlmAuthHeaders(profile?: Pick<AgentProfile, "token">): Promise<Record<string, string>> {
  const key = profile?.token?.trim() || await bankrLlmApiKey();
  return key ? { Authorization: `Bearer ${key}`, "X-API-Key": key } : {};
}

export function bankrLlmModel(profile: Pick<AgentProfile, "model">) {
  return profile.model?.trim() || "";
}

export async function listBankrLlmModels(profile?: Pick<AgentProfile, "token">) {
  const headers = await bankrLlmAuthHeaders(profile);
  if (!headers["X-API-Key"]) return { models: [], error: "BANKR_LLM_KEY is not configured." };
  const response = await fetch(`${BANKR_LLM_BASE_URL}${BANKR_LLM_MODELS_PATH}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => null) as {
    data?: Array<{ id?: unknown }>;
    error?: string | { message?: unknown };
    message?: unknown;
  } | null;
  const error = typeof data?.error === "string"
    ? data.error
    : typeof data?.error?.message === "string"
      ? data.error.message
      : typeof data?.message === "string"
        ? data.message
        : `Bankr LLM returned HTTP ${response.status}.`;
  if (!response.ok) return { models: [], error };
  return {
    models: (data?.data ?? [])
      .map((model) => typeof model.id === "string" ? model.id : "")
      .filter(Boolean),
    error: "",
  };
}

export async function resolveBankrLlmRuntimeProfile(profile: AgentProfile) {
  const headers = await bankrLlmAuthHeaders(profile);
  if (!headers["X-API-Key"]) {
    return { profile, headers, error: "BANKR_LLM_KEY is required for Bankr LLM agents." };
  }
  return {
    profile: {
      ...profile,
      gatewayUrl: BANKR_LLM_BASE_URL,
      chatPath: BANKR_LLM_CHAT_PATH,
      statusPath: BANKR_LLM_MODELS_PATH,
      token: "",
    },
    headers,
    error: "",
  };
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

async function bankrCliConfig() {
  const raw = await readFile(BANKR_CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { llmKey?: unknown; apiKey?: unknown };
    return {
      llmKey: typeof parsed.llmKey === "string" ? parsed.llmKey : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return {};
  }
}
