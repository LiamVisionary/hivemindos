import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "os";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AgentProfile } from "@/lib/types/agent-runtime";

export const BANKR_LLM_BASE_URL = "https://llm.bankr.bot";
export const BANKR_LLM_CHAT_PATH = "/v1/chat/completions";
export const BANKR_LLM_MODELS_PATH = "/v1/models";

const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const BANKR_CONFIG_FILE = join(homedir(), ".bankr", "config.json");
const BANKR_LLM_KEY_ENV_NAMES = ["BANKR_LLM_KEY", "BANKR_API_KEY", "BANKR_MANAGEMENT_KEY"] as const;
const BANKR_MODEL_CACHE_TTL_MS = 5 * 60_000;
const BANKR_MODEL_ERROR_CACHE_TTL_MS = 10_000;
const BANKR_MODEL_LOW_CREDIT_ERROR_CACHE_TTL_MS = 2_000;
const BANKR_MODEL_DISCOVERY_TIMEOUT_MS = 5_000;
const BANKR_CLI_MODEL_DISCOVERY_TIMEOUT_MS = 12_000;
const BANKR_MODEL_DISK_CACHE_TTL_MS = 24 * 60 * 60_000;
const BANKR_MODEL_DISK_CACHE_FILE = join(homedir(), ".hivemindos", "cache", "bankr-llm-models.json");
const execFileAsync = promisify(execFile);

type BankrModelListResult = {
  models: string[];
  error: string;
};

export type BankrLlmAccessStatus = {
  clubActive: boolean | null;
  creditsBalanceUsd: number | null;
  error: string;
};

type IncomingMessage = {
  role: string;
  content: string | Array<{
    type: string;
    text?: string;
    image_url?: { url?: string };
    file?: { filename?: string; file_data?: string };
  }>;
};

export type BankrLlmModelOption = {
  id: string;
  name?: string;
  subtitle?: string;
  group?: string;
  badge?: string;
  disabled?: boolean;
  disabledReason?: string;
};

export type BankrLlmCreditTopUpResult = {
  creditsGranted: number | null;
  newBalance: number | null;
  txHash: string;
};

export const BANKR_BASE_MODEL_ID = "gemini-3-flash";
export const BANKR_ADAPTIVE_MODEL_ID = "adaptive";

let bankrModelCache: {
  keyHash: string;
  expiresAt: number;
  value: BankrModelListResult;
} | null = null;
let bankrModelInFlight: {
  keyHash: string;
  promise: Promise<BankrModelListResult>;
} | null = null;
let bankrAccessCache: { expiresAt: number; value: BankrLlmAccessStatus } | null = null;

export function clearBankrLlmCaches() {
  bankrModelCache = null;
  bankrModelInFlight = null;
  bankrAccessCache = null;
}

export function isBankrLlmProfile(profile: Pick<AgentProfile, "provider">) {
  return profile.provider?.trim().toLowerCase() === "bankr";
}

export function isBankrAdaptiveModel(profile: Pick<AgentProfile, "provider" | "model">) {
  return isBankrLlmProfile(profile) && profile.model?.trim().toLowerCase() === BANKR_ADAPTIVE_MODEL_ID;
}

export async function bankrLlmApiKey() {
  const raw = await readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  for (const key of BANKR_LLM_KEY_ENV_NAMES) {
    const value = parseEnvFileValue(raw, key);
    if (value) return value;
  }

  for (const key of BANKR_LLM_KEY_ENV_NAMES) {
    const value = process.env[key]?.trim();
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
  const key = await bankrLlmApiKey() || profile?.token?.trim() || "";
  return key ? { Authorization: `Bearer ${key}`, "X-API-Key": key } : {};
}

export function bankrLlmModel(profile: Pick<AgentProfile, "model">) {
  const model = profile.model?.trim() || "";
  return model && model !== BANKR_ADAPTIVE_MODEL_ID ? model : BANKR_BASE_MODEL_ID;
}

export function bankrLlmModelOptions(modelIds: string[], error = "", access: BankrLlmAccessStatus = { clubActive: null, creditsBalanceUsd: null, error: "" }): BankrLlmModelOption[] {
  if (isBankrCredentialSetupError(error) && !modelIds.length) return [];
  const creditsEmpty = access.creditsBalanceUsd === 0 || isBankrLlmLowCreditError(error);
  const seen = new Set<string>();
  const add = (model: BankrLlmModelOption) => {
    if (!model.id || seen.has(model.id)) return null;
    seen.add(model.id);
    return model;
  };
  return [
    add({
      id: BANKR_BASE_MODEL_ID,
      name: "Gemini 3 Flash",
      subtitle: "Free with Bankr Club",
      group: "Bankr Club",
      badge: "Club",
      ...(access.clubActive === false ? { disabled: true, disabledReason: "Requires Bankr Club" } : {}),
    }),
    add({
      id: BANKR_ADAPTIVE_MODEL_ID,
      name: "Adaptive",
      subtitle: "Gemini 3 Flash for simple tasks, Max Mode for complex tasks",
      group: "Bankr",
      badge: "Auto",
      ...(creditsEmpty || access.clubActive === false ? { disabled: true, disabledReason: access.clubActive === false ? "Requires Bankr Club" : "Top up credits" } : {}),
    }),
    ...modelIds.map((id) => add({
      id,
      name: bankrModelDisplayName(id),
      subtitle: "Max Mode",
      group: "Max Mode",
      ...(creditsEmpty ? { disabled: true, disabledReason: "Top up credits" } : {}),
    })),
  ].filter((model): model is BankrLlmModelOption => Boolean(model));
}

export async function bankrCommandEnv() {
  const { env } = await bankrCommandCredentials();
  return env;
}

export async function bankrApiKey() {
  const { apiKey } = await bankrCommandCredentials();
  return apiKey;
}

async function bankrCommandCredentials() {
  const raw = await readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  const sharedEnv = parseEnvFile(raw);
  const env: NodeJS.ProcessEnv = { ...process.env, ...sharedEnv };
  const sharedApiKey = sharedEnv.BANKR_API_KEY?.trim() || sharedEnv.BANKR_MANAGEMENT_KEY?.trim() || "";
  const sharedLlmKey = sharedEnv.BANKR_LLM_KEY?.trim() || "";
  const processApiKey = process.env.BANKR_API_KEY?.trim() || process.env.BANKR_MANAGEMENT_KEY?.trim() || "";
  const processLlmKey = process.env.BANKR_LLM_KEY?.trim() || "";
  const apiKey = sharedApiKey || sharedLlmKey || processApiKey || processLlmKey;
  const llmKey = sharedLlmKey || sharedApiKey || processLlmKey || processApiKey;
  if (apiKey) env.BANKR_API_KEY = apiKey;
  if (llmKey) env.BANKR_LLM_KEY = llmKey;
  const config = await bankrCliConfig();
  return {
    env,
    config,
    apiKey: apiKey || config.apiKey?.trim() || config.llmKey?.trim() || "",
    llmKey: llmKey || config.llmKey?.trim() || config.apiKey?.trim() || "",
    apiUrl: env.BANKR_API_URL?.trim() || config.apiUrl?.trim() || "https://api.bankr.bot",
    llmUrl: env.BANKR_LLM_URL?.trim() || config.llmUrl?.trim() || BANKR_LLM_BASE_URL,
  };
}

export async function execBankrCommand(args: string[], options: { timeout?: number; maxBuffer?: number } = {}) {
  const { env, apiKey, llmKey, apiUrl, llmUrl } = await bankrCommandCredentials();
  if (!apiKey && !llmKey) return execFileAsync("bankr", args, { ...options, env });

  const tempDir = await mkdtemp(join(tmpdir(), "hivemindos-bankr-"));
  const configPath = join(tempDir, "config.json");
  await writeFile(configPath, JSON.stringify({
    apiKey,
    llmKey,
    apiUrl,
    llmUrl,
  }, null, 2), { mode: 0o600 });
  try {
    return await execFileAsync("bankr", ["--config", configPath, ...args], { ...options, env });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function bankrLlmCreditTopUp(amountUsd: number, sourceToken: string): Promise<BankrLlmCreditTopUpResult> {
  const { apiKey, apiUrl } = await bankrCommandCredentials();
  if (!apiKey) throw new Error("BANKR_LLM_KEY is not configured.");
  const response = await fetch(`${apiUrl}/llm/credits/topup`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
      "User-Agent": "hivemindos/bankr-llm",
    },
    body: JSON.stringify({
      amountUsd,
      ...(sourceToken && sourceToken.trim().toUpperCase() !== "USDC" ? { sourceToken } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(bankrApiErrorMessage(data, bankrTopUpFallbackError(response.status)));
  const record = asPlainRecord(data);
  clearBankrLlmCaches();
  return {
    creditsGranted: numberFromUnknown(record.creditsGranted),
    newBalance: numberFromUnknown(record.newBalance),
    txHash: stringFromUnknown(record.txHash),
  };
}

export async function bankrLlmAccessStatus() {
  const now = Date.now();
  if (bankrAccessCache?.expiresAt && bankrAccessCache.expiresAt > now) return bankrAccessCache.value;
  const [credits, club] = await Promise.all([
    runBankr(["llm", "credits"], 20_000).then(parseCreditBalance).catch((error) => ({ balanceUsd: null, error: error instanceof Error ? error.message : "Could not read Bankr LLM credits." })),
    runBankr(["club", "status"], 15_000).then(parseClubStatus).catch((error) => ({ clubActive: null, error: error instanceof Error ? error.message : "Could not read Bankr Club status." })),
  ]);
  const value = {
    clubActive: club.clubActive,
    creditsBalanceUsd: credits.balanceUsd,
    error: [credits.error, club.error].filter(Boolean).join(" "),
  };
  bankrAccessCache = { expiresAt: now + 30_000, value };
  return value;
}

export async function resolveAdaptiveBankrLlmModels(profile: Pick<AgentProfile, "provider" | "model" | "token" | "workerClass" | "name" | "skillProfilePrompt" | "preferredSkillSlugs">, messages: IncomingMessage[]) {
  if (bankrAdaptivePrefersBase(profile, messages)) return [BANKR_BASE_MODEL_ID];
  const result = await listBankrLlmModels(profile);
  const maxModels = result.models
    .filter((model) => model !== BANKR_BASE_MODEL_ID)
    .sort((left, right) => bankrMaxModelScore(right, profile, messages) - bankrMaxModelScore(left, profile, messages));
  return Array.from(new Set([...maxModels.slice(0, 5), BANKR_BASE_MODEL_ID]));
}

export async function listBankrLlmModels(profile?: Pick<AgentProfile, "token">) {
  const headers = await bankrLlmAuthHeaders(profile);
  const apiKey = headers["X-API-Key"];
  if (!apiKey) return { models: [], error: "BANKR_LLM_KEY is not configured." };
  const keyHash = secretFingerprint(apiKey);
  const now = Date.now();
  if (bankrModelCache?.keyHash === keyHash && bankrModelCache.expiresAt > now) {
    return bankrModelCache.value;
  }
  if (bankrModelInFlight?.keyHash === keyHash) return bankrModelInFlight.promise;
  const promise = fetchBankrLlmModels(headers)
    .then((value) => {
      bankrModelCache = {
        keyHash,
        expiresAt: Date.now() + bankrModelCacheTtl(value),
        value,
      };
      return value;
    })
    .finally(() => {
      if (bankrModelInFlight?.keyHash === keyHash) bankrModelInFlight = null;
    });
  bankrModelInFlight = { keyHash, promise };
  return promise;
}

async function fetchBankrLlmModels(headers: Record<string, string>): Promise<BankrModelListResult> {
  const response = await fetch(`${BANKR_LLM_BASE_URL}${BANKR_LLM_MODELS_PATH}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(BANKR_MODEL_DISCOVERY_TIMEOUT_MS),
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
  if (!response.ok) {
    const fallbackModels = isBankrLlmLowCreditError(error)
      ? await listCachedOrCliBankrModels()
      : [];
    return { models: fallbackModels, error };
  }
  return {
    models: (data?.data ?? [])
      .map((model) => typeof model.id === "string" ? model.id : "")
      .filter(Boolean),
    error: "",
  };
}

export function isBankrLlmLowCreditError(error: string) {
  return /insufficient_credits|credits exhausted|402|balance|fund/i.test(error);
}

function bankrModelCacheTtl(value: BankrModelListResult) {
  if (isBankrLlmLowCreditError(value.error)) return BANKR_MODEL_LOW_CREDIT_ERROR_CACHE_TTL_MS;
  if (value.models.length) return BANKR_MODEL_CACHE_TTL_MS;
  return BANKR_MODEL_ERROR_CACHE_TTL_MS;
}

function isBankrCredentialSetupError(error: string) {
  return /BANKR_LLM_KEY.*(not configured|required|missing)|missing.*BANKR_LLM_KEY|(?:invalid|inactive|unauthorized|401).*api key|api key.*(?:invalid|inactive|unauthorized)/i.test(error);
}

function bankrModelDisplayName(id: string) {
  return id
    .replace(/^gpt-/, "GPT ")
    .replace(/^claude-/, "Claude ")
    .replace(/^gemini-/, "Gemini ")
    .replace(/^gemma-/, "Gemma ")
    .replace(/^grok-/, "Grok ")
    .replace(/^qwen/, "Qwen ")
    .replace(/^deepseek-/, "DeepSeek ")
    .replace(/^kimi-/, "Kimi ")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bGpt\b/g, "GPT");
}

function latestUserText(messages: IncomingMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === "user");
  if (!latest) return "";
  if (typeof latest.content === "string") return latest.content;
  return latest.content.map((part) => part.text ?? "").join(" ");
}

function requestHasAttachment(messages: IncomingMessage[]) {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url" || part.type === "file"));
}

function bankrAdaptivePrefersBase(profile: Pick<AgentProfile, "workerClass" | "name" | "skillProfilePrompt" | "preferredSkillSlugs">, messages: IncomingMessage[]) {
  if (requestHasAttachment(messages)) return false;
  const text = [
    profile.workerClass,
    profile.name,
    profile.skillProfilePrompt,
    profile.preferredSkillSlugs?.join(" "),
    latestUserText(messages),
  ].filter(Boolean).join(" ").toLowerCase();
  if (text.length > 700) return false;
  return !/\b(code|coding|debug|repo|test|refactor|architecture|research|compare|analysis|deep|reason|strategy|plan|complex|image|vision|file|pdf|spreadsheet|legal|financial model|forecast)\b/.test(text);
}

function bankrMaxModelScore(model: string, profile: Pick<AgentProfile, "workerClass" | "name" | "skillProfilePrompt" | "preferredSkillSlugs">, messages: IncomingMessage[]) {
  const text = [
    profile.workerClass,
    profile.name,
    profile.skillProfilePrompt,
    profile.preferredSkillSlugs?.join(" "),
    latestUserText(messages),
  ].filter(Boolean).join(" ").toLowerCase();
  const haystack = model.toLowerCase();
  let score = 0;
  if (/\b(code|coding|debug|repo|test|refactor|typescript|python|react|api)\b/.test(text) && /codex|coder|qwen|gpt|claude|deepseek/.test(haystack)) score += 60;
  if (/\b(research|analysis|compare|reason|strategy|plan|complex)\b/.test(text) && /opus|sonnet|gpt|gemini.*pro|deepseek|kimi/.test(haystack)) score += 52;
  if (requestHasAttachment(messages) && /gemini|claude|gpt|gemma/.test(haystack)) score += 48;
  if (/opus|gpt-5\.5|gpt-5\.4|gemini-3\.1-pro|sonnet|deepseek-v4-pro/.test(haystack)) score += 36;
  if (/pro|max|reason|opus/.test(haystack)) score += 18;
  if (/mini|nano|lite|flash/.test(haystack)) score -= 20;
  if (/deprecated/.test(haystack)) score -= 200;
  return score;
}

function secretFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function listBankrCliModels() {
  try {
    const { stdout } = await execBankrCommand(["llm", "models"], {
      timeout: BANKR_CLI_MODEL_DISCOVERY_TIMEOUT_MS,
      maxBuffer: 1_000_000,
    });
    const models = parseBankrCliModelIds(stdout);
    if (models.length) await writeBankrModelDiskCache(models);
    return models;
  } catch {
    return readBankrModelDiskCache();
  }
}

async function listCachedOrCliBankrModels() {
  const cached = await readBankrModelDiskCache();
  return cached.length ? cached : listBankrCliModels();
}

function parseBankrCliModelIds(output: string) {
  const modelIds = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s{2,}([a-z0-9][a-z0-9._-]+)\s{2,}/i);
    if (match) modelIds.add(match[1]);
  }
  return [...modelIds];
}

async function readBankrModelDiskCache() {
  const raw = await readFile(BANKR_MODEL_DISK_CACHE_FILE, "utf8").catch(() => "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; models?: unknown };
    const fetchedAt = typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0;
    if (!fetchedAt || Date.now() - fetchedAt > BANKR_MODEL_DISK_CACHE_TTL_MS) return [];
    return Array.isArray(parsed.models)
      ? parsed.models.filter((model): model is string => typeof model === "string" && Boolean(model.trim()))
      : [];
  } catch {
    return [];
  }
}

async function writeBankrModelDiskCache(models: string[]) {
  await mkdir(dirname(BANKR_MODEL_DISK_CACHE_FILE), { recursive: true });
  await writeFile(BANKR_MODEL_DISK_CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), models }, null, 2), { mode: 0o600 });
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

function parseEnvFile(raw: string) {
  const values: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    value = value.replace(/\s+#.*$/, "").replaceAll("\0", "").trim();
    if (value) values[key] = value;
  }
  return values;
}

function bankrTopUpFallbackError(status: number) {
  if (status === 402) return "Insufficient wallet balance. Add funds to your Bankr wallet or choose another source token.";
  if (status === 403) return "Bankr rejected this key for LLM Gateway credit funding.";
  if (status === 502) return "Token swap failed. Try USDC or a different token.";
  return `Failed to add Bankr LLM credits (HTTP ${status}).`;
}

function bankrApiErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const messages = value.map((item) => bankrApiErrorMessage(item, "")).filter(Boolean);
    return dedupeMessages(messages).join("; ") || fallback;
  }
  const record = asPlainRecord(value);
  if (!Object.keys(record).length) return fallback;
  const directIssue = bankrValidationIssueMessage(record);
  const primaryMessages = [];
  for (const key of ["error", "message", "detail", "reason", "description"]) {
    const message = bankrApiErrorMessage(record[key], "");
    if (message) primaryMessages.push(message);
  }
  const nestedMessages = [];
  for (const key of ["details", "errors", "issues", "validationErrors", "cause"]) {
    const message = bankrApiErrorMessage(record[key], "");
    if (message) nestedMessages.push(message);
  }
  const messages = dedupeMessages([directIssue, ...primaryMessages, ...nestedMessages].filter(Boolean));
  if (messages.length > 1 && /^validation error$/i.test(messages[0])) return `${messages[0]}: ${messages.slice(1).join("; ")}`;
  if (messages.length) return messages.join("; ");
  const code = stringFromUnknown(record.code);
  const status = stringFromUnknown(record.status);
  const summary = [code, status].filter(Boolean).join(": ");
  if (summary) return summary;
  return fallback;
}

function bankrValidationIssueMessage(record: Record<string, unknown>) {
  const path = validationPath(record.path ?? record.field ?? record.param ?? record.property);
  let message = stringFromUnknown(record.message)
    || stringFromUnknown(record.reason)
    || stringFromUnknown(record.description)
    || stringFromUnknown(record.code);
  if (path && message.toLowerCase().startsWith(`${path.toLowerCase()} `)) message = message.slice(path.length).trim();
  if (path && message) return `${path}: ${message}`;
  return message;
}

function validationPath(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join(".");
  if (typeof value === "string") return value.trim();
  return "";
}

function dedupeMessages(messages: string[]) {
  const unique: string[] = [];
  for (const message of messages.map((item) => item.trim()).filter(Boolean)) {
    const comparable = comparableValidationMessage(message);
    if (unique.some((item) => {
      const uniqueComparable = comparableValidationMessage(item);
      return item === message || uniqueComparable === comparable || item.endsWith(`: ${message}`) || message.endsWith(`: ${item}`);
    })) continue;
    unique.push(message);
  }
  return unique;
}

function comparableValidationMessage(message: string) {
  return message.replace(/^([A-Za-z0-9_.-]+):\s*/, "$1 ").toLowerCase();
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberFromUnknown(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[$,]/g, "")) : NaN;
  return Number.isFinite(number) ? number : null;
}

async function runBankr(args: string[], timeout: number) {
  const { stdout, stderr } = await execBankrCommand(args, {
    timeout,
    maxBuffer: 1_000_000,
  });
  return `${stdout}${stderr ? `\n${stderr}` : ""}`;
}

function parseCreditBalance(output: string) {
  const match = output.match(/Credit Balance:\s*\$?\s*([0-9][0-9,]*(?:\.\d+)?)/i);
  return {
    balanceUsd: match ? Number(match[1].replace(/,/g, "")) : null,
    error: "",
  };
}

function parseClubStatus(output: string) {
  if (/\b(?:not active|inactive|not subscribed|no active|expired|cancelled|canceled)\b/i.test(output)) return { clubActive: false, error: "" };
  if (/\b(?:active|subscribed|member|renews|expires|club)\b/i.test(output)) return { clubActive: true, error: "" };
  return { clubActive: null, error: "" };
}

async function bankrCliConfig() {
  const raw = await readFile(BANKR_CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { llmKey?: unknown; apiKey?: unknown; apiUrl?: unknown; llmUrl?: unknown };
    return {
      llmKey: typeof parsed.llmKey === "string" ? parsed.llmKey : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : "",
      llmUrl: typeof parsed.llmUrl === "string" ? parsed.llmUrl : "",
    };
  } catch {
    return {};
  }
}
