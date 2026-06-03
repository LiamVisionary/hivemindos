import { execFile, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { constants } from "fs";
import { access, mkdir, readFile, rm, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { promisify } from "util";
import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { USEPOD_API_BASE, USEPOD_PROVIDER_BOND_USDC, USEPOD_PROVIDER_EARN_SHARE } from "@/lib/config/usepod-features";
import { generateWallet } from "@/lib/services/wallet/chain-wallet";
import { getWalletInfo, getWalletSecret, storeWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import {
  bondDepositCodeFromEnrollmentCode,
  getUsePodBondUsdcBalance,
  postUsePodOperatorBond,
} from "@/lib/services/usepod/host-bond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HostSetupAction = "status" | "install" | "pair" | "pair-status" | "preflight" | "run" | "setup";
type HostSetupBody = {
  action?: HostSetupAction;
  hostToken?: string;
  tokenEnvName?: string;
  activatedModels?: unknown;
  config?: UsePodProviderRunConfig;
  displayName?: string;
};

const execFileAsync = promisify(execFile);
const USER_LOCAL_PREFIX = join(homedir(), ".local");
const USER_LOCAL_BIN = join(USER_LOCAL_PREFIX, "bin");
const USER_LOCAL_AGENT = join(USER_LOCAL_BIN, "usepod-agent");
const PAIRING_URL_FALLBACK = "https://usepod.ai/host/pair";
const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const HERMES_ENV_FILE = join(homedir(), ".hermes", ".env");
const USEPOD_HOST_FUNDING_STATE_FILE = join(homedir(), ".hivemindos", "usepod-host-funding.json");
const USEPOD_HOST_AGENT_CONFIG_FILE = join(homedir(), ".hivemindos", "usepod-agent", "agent.toml");
const USEPOD_HOST_RUN_CONFIG_FILE = join(homedir(), ".hivemindos", "usepod-agent", "hivemind-host-config.json");
const USEPOD_HOST_PROVIDER_WALLET_ID = "usepod-host-provider";
const USEPOD_HOST_FUNDING_PENDING_MS = 5 * 60 * 1000;
const USEPOD_PROVIDER_COORDINATOR_URL = "wss://api.usepod.ai/provider/connect";
const USEPOD_HOST_DEFAULT_INPUT_MICRO_USDC_PER_1M = 500_000;
const USEPOD_HOST_DEFAULT_OUTPUT_MICRO_USDC_PER_1M = 750_000;
const USEPOD_HOST_DEFAULT_TOKENS_PER_MINUTE = 200_000;

type ExecFailure = Error & {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  code?: string | number;
  signal?: NodeJS.Signals;
};

type PairingSession = {
  child: ChildProcessWithoutNullStreams;
  output: string;
  pairingCode: string;
  pairingUrl: string;
  status: "starting" | "waiting" | "paired" | "failed";
  error: string;
  startedAt: number;
};

type ProviderRunSession = {
  child: ChildProcessWithoutNullStreams;
  output: string;
  status: "starting" | "running" | "failed";
  error: string;
  startedAt: number;
};

type PairingClaimResult = {
  status: "claimed" | "missing-token" | "failed";
  message: string;
  enrolled?: boolean;
  walletAddress?: string;
  response?: unknown;
};

type UsePodHostEnrollment = {
  token: string;
  walletAddress: string;
  enrolled: boolean;
  bondAmountUsdc: number;
  bondDepositCode: string;
  enrollmentCode: string;
  profileStatus: string;
};

type UsePodHostProfile = {
  status?: string;
  bond?: {
    amount_usdc?: number | string;
    deposit_code?: string;
  };
  metadata?: {
    enrollment_code?: string;
  };
};

type UsePodHostProviderGate =
  | { status: "ready"; message: string; walletAddress: string; bondSignature?: string }
  | { status: "funded"; message: string; walletAddress: string; bondAmountUsdc: number; balanceUsdc: number; depositCode: string }
  | { status: "needs-bond"; message: string; walletAddress: string; bondAmountUsdc: number; balanceUsdc: number; depositCode: string }
  | { status: "failed"; message: string; walletAddress?: string };

type UsePodHostWhen = "idle" | "always" | "sched";

type UsePodProviderRunConfig = {
  markdown?: unknown;
  maxConcurrency?: unknown;
  hostWhen?: unknown;
  dailyCapUsd?: unknown;
  pauseOnBattery?: unknown;
  yieldToUser?: unknown;
};

type NormalizedUsePodProviderRunConfig = {
  markdown: number;
  maxConcurrency: number;
  hostWhen: UsePodHostWhen;
  dailyCapUsd: number | null;
  pauseOnBattery: boolean;
  yieldToUser: boolean;
};

type UsePodHostBackendContext = {
  kind: "lmstudio" | "ollama";
  label: string;
  host: string;
  reachable: boolean;
  message: string;
};

type UsePodHostModelContext = {
  id: string;
  name?: string;
  providerModelId: string;
  backendKind: UsePodHostBackendContext["kind"];
  inputPer1m: number;
  outputPer1m: number;
};

type UsePodHostContext = {
  backend: UsePodHostBackendContext;
  models: UsePodHostModelContext[];
  config: NormalizedUsePodProviderRunConfig;
  payoutWallet: string;
  bondAmountUsdc: number;
  earnShare: number;
  agentConfigPath: string;
  profileStatus?: string;
  run?: ProviderRunSessionResponse["run"];
};

type ProviderRunSessionResponse = ReturnType<typeof providerRunResponse>;

const globalPairingState = globalThis as typeof globalThis & {
  __hivemindUsePodPairing?: PairingSession;
  __hivemindUsePodRun?: ProviderRunSession;
  __hivemindUsePodHostFunding?: Record<string, {
    balanceUsdc: number;
    bondAmountUsdc: number;
    depositCode: string;
    detectedAt: number;
    walletAddress: string;
  }>;
};

function hostFundingKey(walletAddress: string, depositCode: string) {
  return `${walletAddress}:${depositCode || "no-code"}`;
}

function clearUsePodHostFundingPending(walletAddress: string, depositCode: string) {
  delete globalPairingState.__hivemindUsePodHostFunding?.[hostFundingKey(walletAddress, depositCode)];
  void rm(USEPOD_HOST_FUNDING_STATE_FILE, { force: true }).catch(() => undefined);
}

function markUsePodHostFundingPending(params: {
  balanceUsdc: number;
  bondAmountUsdc: number;
  depositCode: string;
  walletAddress: string;
}) {
  const record = {
    ...params,
    detectedAt: Date.now(),
  };
  globalPairingState.__hivemindUsePodHostFunding ??= {};
  globalPairingState.__hivemindUsePodHostFunding[hostFundingKey(params.walletAddress, params.depositCode)] = record;
  void writeUsePodHostFundingRecord(record);
}

async function readUsePodHostFundingRecord(walletAddress: string, depositCode: string) {
  const raw = await readFile(USEPOD_HOST_FUNDING_STATE_FILE, "utf8").catch(() => "");
  if (!raw) return null;
  const parsed = JSON.parse(raw) as {
    balanceUsdc?: unknown;
    bondAmountUsdc?: unknown;
    depositCode?: unknown;
    detectedAt?: unknown;
    walletAddress?: unknown;
  };
  if (parsed.walletAddress !== walletAddress || parsed.depositCode !== depositCode) return null;
  const balanceUsdc = Number(parsed.balanceUsdc);
  const bondAmountUsdc = Number(parsed.bondAmountUsdc);
  const detectedAt = Number(parsed.detectedAt);
  if (!Number.isFinite(balanceUsdc) || !Number.isFinite(bondAmountUsdc) || !Number.isFinite(detectedAt)) return null;
  return { balanceUsdc, bondAmountUsdc, depositCode, detectedAt, walletAddress };
}

async function readUsePodHostFundingRecordForWallet(walletAddress: string) {
  const raw = await readFile(USEPOD_HOST_FUNDING_STATE_FILE, "utf8").catch(() => "");
  if (!raw) return null;
  const parsed = JSON.parse(raw) as {
    balanceUsdc?: unknown;
    bondAmountUsdc?: unknown;
    depositCode?: unknown;
    detectedAt?: unknown;
    walletAddress?: unknown;
  };
  if (parsed.walletAddress !== walletAddress || typeof parsed.depositCode !== "string") return null;
  const balanceUsdc = Number(parsed.balanceUsdc);
  const bondAmountUsdc = Number(parsed.bondAmountUsdc);
  const detectedAt = Number(parsed.detectedAt);
  if (!Number.isFinite(balanceUsdc) || !Number.isFinite(bondAmountUsdc) || !Number.isFinite(detectedAt)) return null;
  return { balanceUsdc, bondAmountUsdc, depositCode: parsed.depositCode, detectedAt, walletAddress };
}

async function writeUsePodHostFundingRecord(record: {
  balanceUsdc: number;
  bondAmountUsdc: number;
  depositCode: string;
  detectedAt: number;
  walletAddress: string;
}) {
  await mkdir(dirname(USEPOD_HOST_FUNDING_STATE_FILE), { recursive: true, mode: 0o700 });
  await writeFile(USEPOD_HOST_FUNDING_STATE_FILE, JSON.stringify(record, null, 2), { mode: 0o600 });
}

async function recentUsePodHostFundingPending(walletAddress: string, depositCode: string) {
  const pending = globalPairingState.__hivemindUsePodHostFunding?.[hostFundingKey(walletAddress, depositCode)] ||
    await readUsePodHostFundingRecord(walletAddress, depositCode).catch(() => null);
  if (!pending) return null;
  if (Date.now() - pending.detectedAt > USEPOD_HOST_FUNDING_PENDING_MS) {
    clearUsePodHostFundingPending(walletAddress, depositCode);
    return null;
  }
  return pending;
}

function cleanOutput(value: unknown) {
  return String(value ?? "").trim();
}

function agentEnv() {
  return {
    ...process.env,
    PATH: [USER_LOCAL_BIN, process.env.PATH].filter(Boolean).join(":"),
  };
}

function errorDetails(label: string, error: unknown) {
  const failure = error as ExecFailure;
  const output = cleanOutput([failure.stdout, failure.stderr].filter(Boolean).join("\n"));
  const status = failure.code || failure.signal ? ` (${[failure.code, failure.signal].filter(Boolean).join(", ")})` : "";
  return [failure.message || `${label} failed${status}.`, output].filter(Boolean).join("\n\n");
}

function parsePairingCode(output: string) {
  return output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0] ?? "";
}

function parsePairingUrl(output: string) {
  return output.match(/https:\/\/usepod\.ai\/host\/pair[^\s]*/)?.[0] ?? PAIRING_URL_FALLBACK;
}

function parseEnvFileValues(raw: string, predicate: (key: string) => boolean) {
  const values: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !predicate(match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) values.push(value);
  }
  return values;
}

async function savedUsePodHostBondSignature() {
  const candidates = [process.env.USEPOD_HOST_BOND_SIGNATURE?.trim() || ""];
  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    candidates.push(...parseEnvFileValues(raw, (key) => key === "USEPOD_HOST_BOND_SIGNATURE"));
  }
  return candidates.find(Boolean) ?? "";
}

function normalizeEnvValue(value: string) {
  return value.replace(/^export\s+/, "").trim();
}

function quoteEnvValue(value: string) {
  if (!value || /[\s#'"\\$`]/.test(value)) {
    return `'${value.replace(/'/g, "'\"'\"'")}'`;
  }
  return value;
}

function upsertEnvValues(raw: string, values: Record<string, string>) {
  const remaining = new Map(Object.entries(values));
  const output: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      output.push(line);
      continue;
    }
    const match = normalizeEnvValue(line).match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !remaining.has(match[1])) {
      output.push(line);
      continue;
    }
    const value = remaining.get(match[1]) ?? "";
    output.push(`${match[1]}=${quoteEnvValue(value)}`);
    remaining.delete(match[1]);
  }
  if (remaining.size && output.length && output[output.length - 1]?.trim()) output.push("");
  for (const [key, value] of remaining) {
    output.push(`${key}=${quoteEnvValue(value)}`);
  }
  return `${output.join("\n").replace(/\n*$/, "")}\n`;
}

async function saveUsePodHostEnvValues(values: Record<string, string>) {
  await mkdir(dirname(HIVE_ENV_FILE), { recursive: true, mode: 0o700 });
  const raw = await readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  await writeFile(HIVE_ENV_FILE, upsertEnvValues(raw, values), { mode: 0o600 });
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function isSolanaAddress(value: string) {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function extractHostToken(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const values = new Set<unknown>();
  const stack: unknown[] = [data];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current)) {
      if (/token/i.test(key)) values.add(value);
      if (value && typeof value === "object") stack.push(value);
    }
  }
  for (const value of values) {
    if (typeof value === "string" && value.startsWith("pod_host_")) return value.trim();
  }
  return "";
}

function hostProfileStatus(profile: UsePodHostProfile | null) {
  return profile?.status?.trim().toLowerCase() || "";
}

function hostProfileHasActiveBond(profile: UsePodHostProfile | null) {
  const status = hostProfileStatus(profile);
  return Boolean(status && status !== "pending");
}

function hostBondAmount(profile: UsePodHostProfile | null) {
  const raw = profile?.bond?.amount_usdc;
  const amount = typeof raw === "number" ? raw : Number(raw ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : USEPOD_PROVIDER_BOND_USDC;
}

function hostBondDepositCode(profile: UsePodHostProfile | null) {
  return profile?.bond?.deposit_code?.trim() ||
    bondDepositCodeFromEnrollmentCode(profile?.metadata?.enrollment_code) ||
    "";
}

function hostEnrollmentCode(profile: UsePodHostProfile | null) {
  return profile?.metadata?.enrollment_code?.trim() || "";
}

async function fetchUsePodHostProfile(token: string) {
  try {
    const response = await fetch(`${USEPOD_API_BASE}/v1/host/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json().catch(() => null) as UsePodHostProfile | null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUsePodHostBond(token: string, timeoutMs: number) {
  const startedAt = Date.now();
  let profile = await fetchUsePodHostProfile(token);
  while (!hostProfileHasActiveBond(profile) && Date.now() - startedAt < timeoutMs) {
    await sleep(2_000);
    profile = await fetchUsePodHostProfile(token);
  }
  return profile;
}

async function savedUsePodHostWalletAddress() {
  const candidates: string[] = [
    process.env.USEPOD_HOST_WALLET_ADDRESS?.trim() || "",
    process.env.USEPOD_HOST_WALLET?.trim() || "",
    process.env.SOLANA_WALLET_ADDRESS?.trim() || "",
  ];
  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    candidates.push(...parseEnvFileValues(raw, (key) => (
      key === "USEPOD_HOST_WALLET_ADDRESS" ||
      key === "USEPOD_HOST_WALLET" ||
      key === "SOLANA_WALLET_ADDRESS"
    )));
  }
  return candidates.find(isSolanaAddress) ?? "";
}

async function ensureUsePodHostWalletAddress() {
  const savedAddress = await savedUsePodHostWalletAddress();
  if (savedAddress) return savedAddress;

  const existing = await getWalletInfo(USEPOD_HOST_PROVIDER_WALLET_ID).catch(() => null);
  if (existing?.address && isSolanaAddress(existing.address)) {
    await saveUsePodHostEnvValues({ USEPOD_HOST_WALLET_ADDRESS: existing.address });
    return existing.address;
  }

  const wallet = generateWallet("solana:mainnet");
  await storeWalletSecret({
    agentId: USEPOD_HOST_PROVIDER_WALLET_ID,
    address: wallet.address,
    network: wallet.network,
    secret: wallet.secret,
  });
  await saveUsePodHostEnvValues({ USEPOD_HOST_WALLET_ADDRESS: wallet.address });
  return wallet.address;
}

function enrollmentDisplayName(body: HostSetupBody) {
  const requested = body.displayName?.trim();
  if (requested) return requested.slice(0, 80);
  return "HivemindOS This Mac";
}

async function enrollUsePodHostProvider(body: HostSetupBody): Promise<UsePodHostEnrollment> {
  const existing = await savedUsePodHostTokenCandidates(body);
  if (existing[0]) {
    const profile = await fetchUsePodHostProfile(existing[0]);
    return {
      token: existing[0],
      walletAddress: await ensureUsePodHostWalletAddress(),
      enrolled: false,
      bondAmountUsdc: hostBondAmount(profile),
      bondDepositCode: hostBondDepositCode(profile),
      enrollmentCode: hostEnrollmentCode(profile),
      profileStatus: hostProfileStatus(profile),
    };
  }

  const walletAddress = await ensureUsePodHostWalletAddress();
  const response = await fetch(`${USEPOD_API_BASE}/v1/host/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      display_name: enrollmentDisplayName(body),
      wallet: walletAddress,
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(async () => ({ message: await response.text().catch(() => "") }));
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data ? String(data.message) : JSON.stringify(data);
    throw new Error(`UsePod host enrollment failed (${response.status}): ${message || response.statusText}`);
  }
  const token = extractHostToken(data);
  if (!token) throw new Error("UsePod host enrollment did not return a provider token.");
  const profile = await fetchUsePodHostProfile(token);
  await saveUsePodHostEnvValues({
    USEPOD_HOST_TOKEN: token,
    USEPOD_HOST_WALLET_ADDRESS: walletAddress,
  });
  return {
    token,
    walletAddress,
    enrolled: true,
    bondAmountUsdc: hostBondAmount(profile),
    bondDepositCode: hostBondDepositCode(profile),
    enrollmentCode: hostEnrollmentCode(profile),
    profileStatus: hostProfileStatus(profile),
  };
}

async function savedUsePodHostTokenCandidates(body: HostSetupBody) {
  const candidates: string[] = [
    body.hostToken?.trim() || "",
  ];
  const envNames = new Set(
    ["USEPOD_HOST_TOKEN", body.tokenEnvName?.trim()].filter((value): value is string => Boolean(value)),
  );
  for (const envName of envNames) {
    candidates.push(process.env[envName]?.trim() || "");
  }

  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    for (const envName of envNames) {
      candidates.push(...parseEnvFileValues(raw, (key) => key === envName));
    }
    candidates.push(...parseEnvFileValues(raw, (key) => /^USEPOD_HOST_TOKEN(?:_|$)/.test(key)));
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (/^USEPOD_HOST_TOKEN(?:_|$)/.test(key)) candidates.push(value?.trim() || "");
  }

  return Array.from(new Set(candidates.filter((candidate) => candidate.startsWith("pod_host_"))));
}

function activatedModelsFromBody(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

async function getUsePodAgentPath() {
  try {
    const result = await execFileAsync("sh", ["-lc", "command -v usepod-agent"], {
      env: agentEnv(),
      timeout: 5_000,
    });
    return cleanOutput(result.stdout);
  } catch {
    try {
      await access(USER_LOCAL_AGENT, constants.X_OK);
      return USER_LOCAL_AGENT;
    } catch {
      return "";
    }
  }
}

async function getUsePodAgentStatus() {
  const agentPath = await getUsePodAgentPath();
  const installed = Boolean(agentPath);
  if (!installed) return { installed, version: "", path: "" };
  const version = await execFileAsync(agentPath, ["--version"], {
    env: agentEnv(),
    timeout: 8_000,
  })
    .then((result) => cleanOutput(result.stdout || result.stderr))
    .catch(() => "");
  return { installed, version, path: agentPath };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeHostWhen(value: unknown): UsePodHostWhen {
  return value === "always" || value === "sched" || value === "idle" ? value : "idle";
}

function normalizeRunConfig(value: UsePodProviderRunConfig | undefined): NormalizedUsePodProviderRunConfig {
  return {
    markdown: Math.round(clampNumber(value?.markdown, 20, 0, 80)),
    maxConcurrency: Math.round(clampNumber(value?.maxConcurrency, 4, 1, 256)),
    hostWhen: normalizeHostWhen(value?.hostWhen),
    dailyCapUsd: value?.dailyCapUsd === null || typeof value?.dailyCapUsd === "undefined"
      ? null
      : clampNumber(value.dailyCapUsd, 25, 1, 10_000),
    pauseOnBattery: value?.pauseOnBattery !== false,
    yieldToUser: value?.yieldToUser !== false,
  };
}

async function savedRunConfig() {
  const raw = await readFile(USEPOD_HOST_RUN_CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return undefined;
  return JSON.parse(raw) as UsePodProviderRunConfig;
}

async function resolveRunConfig(value: UsePodProviderRunConfig | undefined) {
  return normalizeRunConfig(value ?? await savedRunConfig().catch(() => undefined));
}

function advertisedPriceMicroUsdc(basePrice: number, config: NormalizedUsePodProviderRunConfig) {
  const multiplier = Math.max(0.2, 1 - config.markdown / 100);
  return Math.max(1, Math.round(basePrice * multiplier));
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

function modelName(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  return name;
}

function extractOpenAiModels(data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const rawModels = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  const models: Array<{ id: string; name?: string }> = [];
  const seen = new Set<string>();
  for (const item of rawModels) {
    const id = typeof item === "string"
      ? item.trim()
      : item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"
        ? String((item as Record<string, unknown>).id).trim()
        : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, name: modelName(item) || undefined });
  }
  return models;
}

async function readSavedEnvValue(key: string) {
  const direct = process.env[key]?.trim();
  if (direct) return direct;
  for (const path of [HIVE_ENV_FILE, HERMES_ENV_FILE]) {
    const raw = await readFile(path, "utf8").catch(() => "");
    const value = parseEnvFileValues(raw, (candidate) => candidate === key)[0]?.trim();
    if (value) return value;
  }
  return "";
}

async function localBackendCandidates(): Promise<UsePodHostBackendContext[]> {
  const localOpenAiBase = (await readSavedEnvValue("LOCAL_OPENAI_BASE_URL")) ||
    (await readSavedEnvValue("NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL")) ||
    "http://127.0.0.1:1234";
  const ollamaBase = (await readSavedEnvValue("OLLAMA_BASE_URL")) || "http://127.0.0.1:11434";
  const candidates: UsePodHostBackendContext[] = [
    {
      kind: "lmstudio",
      label: /1234(?:\/|$)/.test(localOpenAiBase) ? "LM Studio" : "OpenAI-compatible",
      host: localOpenAiBase.replace(/\/$/, ""),
      reachable: false,
      message: "",
    },
    {
      kind: "ollama",
      label: "Ollama",
      host: ollamaBase.replace(/\/$/, ""),
      reachable: false,
      message: "",
    },
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.host}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function probeBackend(candidate: UsePodHostBackendContext, config: NormalizedUsePodProviderRunConfig) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(`${candidate.host}/v1/models`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        backend: { ...candidate, reachable: false, message: `${candidate.label} returned ${response.status}.` },
        models: [] as UsePodHostModelContext[],
      };
    }
    const inputPer1m = advertisedPriceMicroUsdc(USEPOD_HOST_DEFAULT_INPUT_MICRO_USDC_PER_1M, config);
    const outputPer1m = advertisedPriceMicroUsdc(USEPOD_HOST_DEFAULT_OUTPUT_MICRO_USDC_PER_1M, config);
    const models = extractOpenAiModels(data).map((model): UsePodHostModelContext => ({
      id: model.id,
      name: model.name,
      providerModelId: model.id,
      backendKind: candidate.kind,
      inputPer1m,
      outputPer1m,
    }));
    return {
      backend: {
        ...candidate,
        reachable: true,
        message: models.length
          ? `${candidate.label} reported ${models.length} model${models.length === 1 ? "" : "s"}.`
          : `${candidate.label} is reachable but did not report models.`,
      },
      models,
    };
  } catch (error) {
    return {
      backend: {
        ...candidate,
        reachable: false,
        message: error instanceof Error && error.name === "AbortError"
          ? `${candidate.label} did not answer /v1/models before timeout.`
          : `${candidate.label} is not reachable at ${candidate.host}.`,
      },
      models: [] as UsePodHostModelContext[],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function discoverUsePodHostBackend(config: NormalizedUsePodProviderRunConfig) {
  const checked = await Promise.all((await localBackendCandidates()).map((candidate) => probeBackend(candidate, config)));
  return checked.find((candidate) => candidate.backend.reachable && candidate.models.length) ??
    checked.find((candidate) => candidate.backend.reachable) ??
    checked[0] ?? {
      backend: {
        kind: "lmstudio" as const,
        label: "OpenAI-compatible",
        host: "http://127.0.0.1:1234",
        reachable: false,
        message: "No local OpenAI-compatible backend was checked.",
      },
      models: [] as UsePodHostModelContext[],
    };
}

async function buildUsePodHostContext(body: HostSetupBody, provider?: UsePodHostProviderGate, run?: ProviderRunSession): Promise<UsePodHostContext> {
  const config = await resolveRunConfig(body.config);
  const enrollment = await enrollUsePodHostProvider(body).catch(() => null);
  const profile = enrollment?.token ? await fetchUsePodHostProfile(enrollment.token) : null;
  const discovered = await discoverUsePodHostBackend(config);
  return {
    backend: discovered.backend,
    models: discovered.models,
    config,
    payoutWallet: provider?.walletAddress || enrollment?.walletAddress || await savedUsePodHostWalletAddress(),
    bondAmountUsdc: provider && "bondAmountUsdc" in provider ? Number(provider.bondAmountUsdc) || USEPOD_PROVIDER_BOND_USDC : hostBondAmount(profile),
    earnShare: USEPOD_PROVIDER_EARN_SHARE,
    agentConfigPath: USEPOD_HOST_AGENT_CONFIG_FILE,
    profileStatus: hostProfileStatus(profile) || enrollment?.profileStatus,
    run: run ? providerRunResponse(run).run : undefined,
  };
}

function buildUsePodAgentToml(params: {
  backend: UsePodHostBackendContext;
  config: NormalizedUsePodProviderRunConfig;
  displayName: string;
  enrollmentCode?: string;
  models: UsePodHostModelContext[];
  walletAddress: string;
}) {
  const lines = [
    "[operator]",
    `display_name = ${tomlString(params.displayName)}`,
    `wallet = ${tomlString(params.walletAddress)}`,
    "",
    "[coordinator]",
    `url = ${tomlString(USEPOD_PROVIDER_COORDINATOR_URL)}`,
  ];
  if (params.enrollmentCode) lines.push(`enrollment_code = ${tomlString(params.enrollmentCode)}`);
  lines.push(
    "",
    "[identity]",
    "key_path = \"~/.usepod-agent/identity.key\"",
    "",
    "[[backends]]",
    `kind = ${tomlString(params.backend.kind)}`,
    `url = ${tomlString(params.backend.host)}`,
  );
  if (params.models.length) {
    lines.push("models = [");
    for (const model of params.models) lines.push(`  ${tomlString(model.providerModelId)},`);
    lines.push("]");
  }
  lines.push(
    "",
    "[pricing]",
    `default_input_per_1m = ${params.models[0]?.inputPer1m ?? advertisedPriceMicroUsdc(USEPOD_HOST_DEFAULT_INPUT_MICRO_USDC_PER_1M, params.config)}`,
    `default_output_per_1m = ${params.models[0]?.outputPer1m ?? advertisedPriceMicroUsdc(USEPOD_HOST_DEFAULT_OUTPUT_MICRO_USDC_PER_1M, params.config)}`,
    "",
    "[pricing.models]",
  );
  for (const model of params.models) {
    lines.push(`${tomlString(model.providerModelId)} = { input_per_1m = ${model.inputPer1m}, output_per_1m = ${model.outputPer1m} }`);
  }
  lines.push(
    "",
    "[limits]",
    `max_concurrent = ${params.config.maxConcurrency}`,
    `max_tokens_per_minute = ${USEPOD_HOST_DEFAULT_TOKENS_PER_MINUTE}`,
    "",
    "[observability]",
    "prometheus_addr = \"127.0.0.1:9090\"",
    "log_level = \"info\"",
    "",
  );
  return lines.join("\n");
}

async function writeUsePodHostRunConfig(body: HostSetupBody, provider: Extract<UsePodHostProviderGate, { status: "ready" }>) {
  const enrollment = await enrollUsePodHostProvider(body);
  const context = await buildUsePodHostContext(body, provider);
  if (!context.backend.reachable) {
    throw new Error(`${context.backend.message} Start LM Studio on port 1234 or Ollama on port 11434 before going live.`);
  }
  if (!context.models.length) {
    throw new Error(`${context.backend.label} is reachable, but it did not report any /v1/models to advertise to UsePod.`);
  }
  await mkdir(dirname(USEPOD_HOST_AGENT_CONFIG_FILE), { recursive: true, mode: 0o700 });
  await writeFile(USEPOD_HOST_AGENT_CONFIG_FILE, buildUsePodAgentToml({
    backend: context.backend,
    config: context.config,
    displayName: enrollmentDisplayName(body),
    enrollmentCode: enrollment.enrollmentCode,
    models: context.models,
    walletAddress: enrollment.walletAddress,
  }), { mode: 0o600 });
  await writeFile(USEPOD_HOST_RUN_CONFIG_FILE, JSON.stringify({
    ...context.config,
    backend: context.backend,
    models: context.models,
    writtenAt: new Date().toISOString(),
  }, null, 2), { mode: 0o600 });
  const agentPath = await getUsePodAgentPath();
  if (!agentPath) throw new Error(`usepod-agent is not installed at ${USER_LOCAL_AGENT}.`);
  try {
    await execFileAsync(agentPath, ["--config", USEPOD_HOST_AGENT_CONFIG_FILE, "validate"], {
      env: agentEnv(),
      timeout: 8_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new Error(errorDetails("UsePod host config validation", error));
  }
  return context;
}

function stopPairingSession(reason: string) {
  const existing = globalPairingState.__hivemindUsePodPairing;
  if (!existing || existing.status === "paired" || existing.status === "failed") return;
  existing.status = "failed";
  existing.error = reason;
  if (!existing.child.killed) existing.child.kill("SIGTERM");
}

async function installUsePodAgent() {
  await mkdir(USER_LOCAL_BIN, { recursive: true });
  try {
    const result = await execFileAsync("sh", ["-c", "curl -fsSL https://usepod.ai/install.sh | sh"], {
      env: {
        ...agentEnv(),
        USEPOD_PREFIX: USER_LOCAL_PREFIX,
      },
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    return cleanOutput(result.stdout || result.stderr);
  } catch (error) {
    throw new Error(errorDetails("UsePod host install", error));
  }
}

async function startUsePodPairing() {
  const existing = globalPairingState.__hivemindUsePodPairing;
  if (existing && existing.status !== "paired" && existing.status !== "failed" && !existing.child.killed) {
    return existing;
  }

  const agentPath = await getUsePodAgentPath();
  if (!agentPath) throw new Error(`usepod-agent is not installed at ${USER_LOCAL_AGENT}.`);
  const child = spawn(agentPath, ["setup"], {
    env: agentEnv(),
  });
  const session: PairingSession = {
    child,
    output: "",
    pairingCode: "",
    pairingUrl: PAIRING_URL_FALLBACK,
    status: "starting",
    error: "",
    startedAt: Date.now(),
  };
  const appendOutput = (chunk: Buffer) => {
    session.output = cleanOutput(`${session.output}\n${chunk.toString("utf8")}`);
    session.pairingCode ||= parsePairingCode(session.output);
    session.pairingUrl = parsePairingUrl(session.output);
    if (session.pairingCode && session.status === "starting") session.status = "waiting";
  };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  child.on("error", (error) => {
    session.status = "failed";
    session.error = error.message;
  });
  child.on("exit", (code, signal) => {
    if (code === 0) {
      session.status = "paired";
      return;
    }
    session.status = "failed";
    session.error = cleanOutput([
      `usepod-agent setup exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`,
      session.output,
    ].join("\n\n"));
  });
  globalPairingState.__hivemindUsePodPairing = session;

  const prompt = await waitForPairingPrompt(session);
  return prompt;
}

function waitForPairingPrompt(session: PairingSession) {
  return new Promise<PairingSession>((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (session.pairingCode || session.status === "paired") {
        clearInterval(timer);
        resolve(session);
        return;
      }
      if (session.status === "failed") {
        clearInterval(timer);
        reject(new Error(session.error || "UsePod host pairing failed before a code was created."));
        return;
      }
      if (Date.now() - startedAt > 15_000) {
        clearInterval(timer);
        reject(new Error(cleanOutput([
          "UsePod host pairing did not print a pairing code within 15 seconds.",
          session.output,
        ].join("\n\n"))));
      }
    }, 250);
  });
}

function pairingSessionResponse(session: PairingSession) {
  return {
    pairingCode: session.pairingCode,
    pairingUrl: session.pairingUrl || PAIRING_URL_FALLBACK,
    status: session.status,
    error: session.error,
    output: session.output,
    startedAt: session.startedAt,
  };
}

function providerRunResponse(session: ProviderRunSession) {
  return {
    run: {
      status: session.status,
      error: session.error,
      output: session.output,
      startedAt: session.startedAt,
    },
  };
}

function failedProviderRunResponse(error: string) {
  return {
    run: {
      status: "failed" as const,
      error,
      output: "",
      startedAt: 0,
    },
  };
}

async function startUsePodProviderRun(body: HostSetupBody, provider: Extract<UsePodHostProviderGate, { status: "ready" }>) {
  const existing = globalPairingState.__hivemindUsePodRun;
  if (existing && existing.status !== "failed" && !existing.child.killed) {
    existing.status = existing.status === "starting" ? "running" : existing.status;
    return existing;
  }

  await writeUsePodHostRunConfig(body, provider);
  const agentPath = await getUsePodAgentPath();
  if (!agentPath) throw new Error(`usepod-agent is not installed at ${USER_LOCAL_AGENT}.`);
  const child = spawn(agentPath, ["--config", USEPOD_HOST_AGENT_CONFIG_FILE, "run"], {
    env: agentEnv(),
  });
  const session: ProviderRunSession = {
    child,
    output: "",
    status: "starting",
    error: "",
    startedAt: Date.now(),
  };
  const appendOutput = (chunk: Buffer) => {
    session.output = cleanOutput(`${session.output}\n${chunk.toString("utf8")}`);
    if (session.status === "starting") session.status = "running";
  };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  child.on("error", (error) => {
    session.status = "failed";
    session.error = error.message;
  });
  child.on("exit", (code, signal) => {
    if (session.status === "failed") return;
    session.status = "failed";
    session.error = cleanOutput([
      `usepod-agent run exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`,
      session.output,
    ].join("\n\n"));
  });
  globalPairingState.__hivemindUsePodRun = session;

  await new Promise((resolve) => setTimeout(resolve, 1_200));
  if (session.status === "failed") throw new Error(session.error || "UsePod provider agent stopped before it could host.");
  session.status = "running";
  return session;
}

function claimNeedsActiveBond(claim: PairingClaimResult | null) {
  return claim?.status === "failed" && /operator bond must be active before pairing/i.test(claim.message);
}

async function claimUsePodPairing(pairingCode: string, body: HostSetupBody): Promise<PairingClaimResult> {
  let enrollment: UsePodHostEnrollment;
  try {
    enrollment = await enrollUsePodHostProvider(body);
  } catch (error) {
    return {
      status: "missing-token",
      message: error instanceof Error ? error.message : "UsePod host enrollment failed.",
    };
  }
  const activatedModels = activatedModelsFromBody(body.activatedModels);
  let lastError = "";
  const tokens = Array.from(new Set([enrollment.token, ...await savedUsePodHostTokenCandidates(body)]));
  for (const token of tokens) {
    const response = await fetch(`${USEPOD_API_BASE}/v1/host/pair/claim`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pair_code: pairingCode, activated_models: activatedModels }),
      cache: "no-store",
    });
    const data = await response.json().catch(async () => ({ message: await response.text().catch(() => "") }));
    if (response.ok) {
      return {
        status: "claimed",
        message: enrollment.enrolled
          ? "UsePod host provider token created and pairing accepted."
          : "UsePod host provider token accepted the pairing code.",
        enrolled: enrollment.enrolled,
        walletAddress: enrollment.walletAddress,
        response: data,
      };
    }
    const error = data && typeof data === "object" && "message" in data ? String(data.message) : JSON.stringify(data);
    lastError = `UsePod pair claim failed (${response.status}): ${error || response.statusText}`;
  }
  return {
    status: "failed",
    message: lastError || "UsePod pair claim failed with every saved token.",
    enrolled: enrollment.enrolled,
    walletAddress: enrollment.walletAddress,
  };
}

async function ensureUsePodHostProviderReady(body: HostSetupBody): Promise<UsePodHostProviderGate> {
  let enrollment: UsePodHostEnrollment;
  try {
    enrollment = await enrollUsePodHostProvider(body);
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "UsePod host provider enrollment failed.",
    };
  }

  const profile = await fetchUsePodHostProfile(enrollment.token);
  if (hostProfileHasActiveBond(profile)) {
    clearUsePodHostFundingPending(enrollment.walletAddress, hostBondDepositCode(profile) || enrollment.bondDepositCode);
    return {
      status: "ready",
      message: "UsePod provider bond is active.",
      walletAddress: enrollment.walletAddress,
    };
  }

  const savedFunding = await readUsePodHostFundingRecordForWallet(enrollment.walletAddress).catch(() => null);
  const bondAmountUsdc = hostBondAmount(profile) || enrollment.bondAmountUsdc || savedFunding?.bondAmountUsdc || USEPOD_PROVIDER_BOND_USDC;
  const depositCode = hostBondDepositCode(profile) || enrollment.bondDepositCode || savedFunding?.depositCode || "";
  const submittedBondSignature = await savedUsePodHostBondSignature();
  if (submittedBondSignature) {
    const creditedProfile = await waitForUsePodHostBond(enrollment.token, 12_000);
    if (hostProfileHasActiveBond(creditedProfile)) {
      clearUsePodHostFundingPending(enrollment.walletAddress, hostBondDepositCode(creditedProfile) || depositCode);
      return {
        status: "ready",
        message: "UsePod provider bond is active.",
        walletAddress: enrollment.walletAddress,
        bondSignature: submittedBondSignature,
      };
    }
    return {
      status: "funded",
      message: "UsePod bond transaction was submitted. Press Continue again after UsePod credits the provider bond.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc: await getUsePodBondUsdcBalance(enrollment.walletAddress).catch(() => 0),
      depositCode,
    };
  }
  if (!depositCode) {
    return {
      status: "needs-bond",
      message: "UsePod created the provider account, but did not return a bond deposit code yet.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc: await getUsePodBondUsdcBalance(enrollment.walletAddress).catch(() => 0),
      depositCode: "",
    };
  }

  const balanceUsdc = await getUsePodBondUsdcBalance(enrollment.walletAddress).catch(() => 0);
  if (balanceUsdc < bondAmountUsdc) {
    const pendingFunding = await recentUsePodHostFundingPending(enrollment.walletAddress, depositCode);
    if (pendingFunding) {
      return {
        status: "funded",
        message: "Funding was detected, but UsePod has not credited the provider bond yet. Press Continue again in a moment.",
        walletAddress: enrollment.walletAddress,
        bondAmountUsdc: pendingFunding.bondAmountUsdc,
        balanceUsdc: pendingFunding.balanceUsdc,
        depositCode,
      };
    }
    return {
      status: "needs-bond",
      message: `Provider wallet has $${balanceUsdc.toFixed(2)} USDC; UsePod requires $${bondAmountUsdc.toFixed(2)} USDC for the operator bond.`,
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc,
      depositCode,
    };
  }

  const wallet = await getWalletSecret(USEPOD_HOST_PROVIDER_WALLET_ID).catch(() => null);
  if (!wallet || wallet.info.address !== enrollment.walletAddress) {
    return {
      status: "needs-bond",
      message: "UsePod provider bond needs the local provider wallet key before HivemindOS can post it.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc,
      depositCode,
    };
  }

  const bond = await postUsePodOperatorBond({
    fromAddress: enrollment.walletAddress,
    secret: wallet.secret,
    amountUsdc: bondAmountUsdc,
    depositCode,
  });
  if (bond.status === "needs-funds") {
    return {
      status: "needs-bond",
      message: `Provider wallet has $${bond.balanceUsdc.toFixed(2)} USDC; UsePod requires $${bond.requiredUsdc.toFixed(2)} USDC for the operator bond.`,
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc: bond.balanceUsdc,
      depositCode,
    };
  }

  await saveUsePodHostEnvValues({ USEPOD_HOST_BOND_SIGNATURE: bond.signature });
  markUsePodHostFundingPending({ walletAddress: enrollment.walletAddress, depositCode, bondAmountUsdc, balanceUsdc });
  const creditedProfile = await waitForUsePodHostBond(enrollment.token, 12_000);
  if (!hostProfileHasActiveBond(creditedProfile)) {
    return {
      status: "funded",
      message: "UsePod bond transaction was submitted. Press Continue again after UsePod credits the provider bond.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc: await getUsePodBondUsdcBalance(enrollment.walletAddress).catch(() => 0),
      depositCode,
    };
  }
  clearUsePodHostFundingPending(enrollment.walletAddress, hostBondDepositCode(creditedProfile) || depositCode);
  return {
    status: "ready",
    message: "UsePod operator bond posted.",
    walletAddress: enrollment.walletAddress,
    bondSignature: bond.signature,
  };
}

async function preflightUsePodHostProvider(body: HostSetupBody): Promise<UsePodHostProviderGate> {
  let enrollment: UsePodHostEnrollment;
  try {
    enrollment = await enrollUsePodHostProvider(body);
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "UsePod host provider enrollment failed.",
    };
  }

  const profile = await fetchUsePodHostProfile(enrollment.token);
  if (hostProfileHasActiveBond(profile)) {
    clearUsePodHostFundingPending(enrollment.walletAddress, hostBondDepositCode(profile) || enrollment.bondDepositCode);
    return {
      status: "ready",
      message: "UsePod provider bond is active.",
      walletAddress: enrollment.walletAddress,
    };
  }

  const savedFunding = await readUsePodHostFundingRecordForWallet(enrollment.walletAddress).catch(() => null);
  const bondAmountUsdc = hostBondAmount(profile) || enrollment.bondAmountUsdc || savedFunding?.bondAmountUsdc || USEPOD_PROVIDER_BOND_USDC;
  const depositCode = hostBondDepositCode(profile) || enrollment.bondDepositCode || savedFunding?.depositCode || "";
  const submittedBondSignature = await savedUsePodHostBondSignature();
  if (submittedBondSignature) {
    return {
      status: "funded",
      message: "UsePod bond transaction was submitted. Press Continue to finish provider setup.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc: await getUsePodBondUsdcBalance(enrollment.walletAddress).catch(() => 0),
      depositCode,
    };
  }
  const balanceUsdc = await getUsePodBondUsdcBalance(enrollment.walletAddress).catch(() => 0);
  if (balanceUsdc >= bondAmountUsdc) {
    markUsePodHostFundingPending({ walletAddress: enrollment.walletAddress, depositCode, bondAmountUsdc, balanceUsdc });
    return {
      status: "funded",
      message: "UsePod provider wallet is funded. Press Continue to post the provider bond and finish setup.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc,
      balanceUsdc,
      depositCode,
    };
  }
  const pendingFunding = await recentUsePodHostFundingPending(enrollment.walletAddress, depositCode);
  if (pendingFunding) {
    return {
      status: "funded",
      message: "Funding was detected. Press Continue to finish provider setup.",
      walletAddress: enrollment.walletAddress,
      bondAmountUsdc: pendingFunding.bondAmountUsdc,
      balanceUsdc: pendingFunding.balanceUsdc,
      depositCode,
    };
  }
  return {
    status: "needs-bond",
    message: `Provider wallet has $${balanceUsdc.toFixed(2)} USDC; UsePod requires $${bondAmountUsdc.toFixed(2)} USDC for the operator bond.`,
    walletAddress: enrollment.walletAddress,
    bondAmountUsdc,
    balanceUsdc,
    depositCode,
  };
}

function waitForPairingCompletion(session: PairingSession) {
  return new Promise<PairingSession>((resolve) => {
    if (session.status === "paired" || session.status === "failed") {
      resolve(session);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (session.status === "paired" || session.status === "failed" || Date.now() - startedAt > 60_000) {
        clearInterval(timer);
        resolve(session);
      }
    }, 500);
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as HostSetupBody;
    const action = body.action;
    if (action === "status") {
      return NextResponse.json({ ok: true, action, status: await getUsePodAgentStatus() });
    }
    if (action === "install") {
      const output = await installUsePodAgent();
      return NextResponse.json({ ok: true, action, output, status: await getUsePodAgentStatus() });
    }
    if (action === "preflight") {
      const provider = await preflightUsePodHostProvider(body);
      const context = await buildUsePodHostContext(body, provider);
      return NextResponse.json({ ok: true, action, status: provider.status, provider, context });
    }
    if (action === "run") {
      const provider = await preflightUsePodHostProvider(body);
      const context = await buildUsePodHostContext(body, provider);
      if (provider.status !== "ready") {
        return NextResponse.json({ ok: true, action, status: provider.status, provider, context, ...failedProviderRunResponse(provider.message) });
      }
      const run = await startUsePodProviderRun(body, provider);
      return NextResponse.json({ ok: true, action, status: run.status, provider, context: await buildUsePodHostContext(body, provider, run), ...providerRunResponse(run) });
    }
    if (action === "pair" || action === "setup") {
      const provider = await ensureUsePodHostProviderReady(body);
      if (provider.status !== "ready") {
        stopPairingSession(provider.message);
        const context = await buildUsePodHostContext(body, provider);
        return NextResponse.json({ ok: true, action, status: provider.status, provider, context, claim: null });
      }
      const pairing = await startUsePodPairing();
      const claim = pairing.pairingCode ? await claimUsePodPairing(pairing.pairingCode, body) : null;
      if (claimNeedsActiveBond(claim)) {
        stopPairingSession(claim?.message || "UsePod operator bond is not active yet.");
        const waitingProvider = await preflightUsePodHostProvider(body);
        const providerWaitingForBond = waitingProvider.status === "funded"
          ? {
            ...waitingProvider,
            message: "UsePod says the operator bond must be active before pairing. Try Continue again in a moment.",
          }
          : waitingProvider;
        const context = await buildUsePodHostContext(body, providerWaitingForBond);
        return NextResponse.json({ ok: true, action, status: providerWaitingForBond.status, provider: providerWaitingForBond, context, claim });
      }
      const settledPairing = claim?.status === "claimed" ? await waitForPairingCompletion(pairing) : pairing;
      const context = await buildUsePodHostContext(body, provider);
      return NextResponse.json({ ok: true, action, ...pairingSessionResponse(settledPairing), provider, context, claim });
    }
    if (action === "pair-status") {
      const pairing = globalPairingState.__hivemindUsePodPairing;
      return NextResponse.json({
        ok: true,
        action,
        ...(pairing ? pairingSessionResponse(pairing) : {
          pairingCode: "",
          pairingUrl: PAIRING_URL_FALLBACK,
          status: "idle",
          error: "",
          output: "",
          startedAt: 0,
        }),
      });
    }
    return NextResponse.json({ ok: false, error: "Unknown UsePod host setup action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "UsePod host setup failed.",
    }, { status: 500 });
  }
}
