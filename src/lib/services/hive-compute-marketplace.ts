import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  HIVE_COMPUTE_API_KEY_ENV,
  HIVE_COMPUTE_DEFAULT_MODEL,
  HIVE_COMPUTE_ESTIMATED_EARNINGS_ENV,
  HIVE_COMPUTE_GATEWAY_URL_ENV,
  HIVE_COMPUTE_MODEL_OPTIONS,
  HIVE_COMPUTE_OPENAI_BASE_URL_ENV,
  HIVE_COMPUTE_PRODUCT_NAME,
  HIVE_COMPUTE_PROVIDER_SLUG,
  HIVE_COMPUTE_WORKER_PACKAGE_NAME,
  HIVE_COMPUTE_WORKER_TOKEN_ENV,
  HIVE_COMPUTE_WORKER_VERSION,
  normalizeHiveComputeModel,
} from "@/lib/config/hive-compute-marketplace";
import { homedir } from "@/lib/home-dir";
import type {
  HiveComputeBinaryStatus,
  HiveComputeEnvPresence,
  HiveComputeGatewayStatus,
  HiveComputeInstallResult,
  HiveComputeMarketplaceStatus,
  HiveComputeModelOption,
} from "@/lib/types/hive-compute-marketplace";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

const execFileAsync = promisify(execFile);
const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");
const MODULE_DIR = join(homedir(), ".hivemindos", "modules", "hive-compute-worker");
const WORKER_FILE = join(MODULE_DIR, "worker.mjs");
const PACKAGE_FILE = join(MODULE_DIR, "package.json");
const README_FILE = join(MODULE_DIR, "README.md");
const NOTICE_FILE = join(MODULE_DIR, "NOTICE.md");
const NODE_MODULES_WS = join(MODULE_DIR, "node_modules", "ws");
const MARKETPLACE_CHAT_TIMEOUT_MS = 600_000;
const MARKETPLACE_STATUS_TIMEOUT_MS = 2_500;

type EnvRead = HiveComputeEnvPresence & { value: string };

export type HiveComputeRuntimeConfig = {
  baseUrl: string;
  chatPath: string;
  statusPath: string;
  model: string;
  headers: Record<string, string>;
};

export class HiveComputeMarketplaceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HiveComputeMarketplaceError";
    this.status = status;
  }
}

const HIVE_COMPUTE_ALIAS_BY_ID = new Map(HIVE_COMPUTE_MODEL_OPTIONS.map((model) => [model.id, model]));

export function isHiveComputeProfile(profile: Pick<AgentProfile, "provider">) {
  return profile.provider?.trim().toLowerCase() === HIVE_COMPUTE_PROVIDER_SLUG;
}

export function hiveComputeWorkerModuleRoot() {
  return MODULE_DIR;
}

export function hiveComputeModelOptions(status?: HiveComputeMarketplaceStatus): HiveComputeModelOption[] {
  const discovered = status?.gateway.models?.ok && status.gateway.models.ids.length
    ? status.gateway.models.ids.map((id) => hiveComputeModelOptionFromGateway(id, status))
    : HIVE_COMPUTE_MODEL_OPTIONS;
  if (status?.routing.ready || !status) return discovered;
  return discovered.map((model) => ({
    ...model,
    disabled: true,
    disabledReason: status.routing.message,
  }));
}

function hiveComputeModelOptionFromGateway(id: string, status: HiveComputeMarketplaceStatus): HiveComputeModelOption {
  const alias = HIVE_COMPUTE_ALIAS_BY_ID.get(id);
  const liveModels = new Set(status.gateway.capacity?.liveModels ?? []);
  const keyRelayModels = new Set(status.gateway.capacity?.keyRelayModels ?? []);
  if (alias) {
    return {
      ...alias,
      subtitle: status.gateway.capacity?.fallbackConfigured && !status.gateway.capacity.liveWorkers
        ? "Routes through centralized fallback when no worker is live."
        : alias.subtitle,
      badge: status.gateway.capacity?.fallbackConfigured && !status.gateway.capacity.liveWorkers ? "Fallback" : alias.badge,
    };
  }
  const live = liveModels.has(id);
  const relay = keyRelayModels.has(id);
  return {
    id,
    name: id,
    group: "Marketplace",
    subtitle: live ? "Live worker model" : relay ? "Key-relay model" : "Marketplace model",
    badge: live ? "Live" : relay ? "Relay" : "Gateway",
  };
}

export function resolveHiveComputeRuntimeConfig(
  profile: Pick<AgentProfile, "model">,
  requestOrigin: string,
): HiveComputeRuntimeConfig {
  if (!requestOrigin) {
    throw new HiveComputeMarketplaceError("Hive Compute needs the dashboard request origin to route marketplace calls.", 400);
  }
  return {
    baseUrl: `${requestOrigin.replace(/\/+$/, "")}/api/hive-compute`,
    chatPath: "/chat/completions",
    statusPath: "/marketplace",
    model: normalizeHiveComputeModel(profile.model || HIVE_COMPUTE_DEFAULT_MODEL),
    headers: internalApiAuthHeaders(),
  };
}

export async function readHiveComputeMarketplaceStatus(): Promise<HiveComputeMarketplaceStatus> {
  const [gatewayUrl, openAiBaseUrl, apiKey, workerToken, earningsLabel, node, ollama, installed, depsInstalled] = await Promise.all([
    readEnv(HIVE_COMPUTE_GATEWAY_URL_ENV),
    readEnv(HIVE_COMPUTE_OPENAI_BASE_URL_ENV),
    readEnv(HIVE_COMPUTE_API_KEY_ENV),
    readEnv(HIVE_COMPUTE_WORKER_TOKEN_ENV),
    readEnv(HIVE_COMPUTE_ESTIMATED_EARNINGS_ENV),
    commandStatus("node", ["--version"]),
    commandStatus("ollama", ["--version"]),
    exists(WORKER_FILE),
    exists(NODE_MODULES_WS),
  ]);
  const openAiBase = openAiBaseUrl.value || (gatewayUrl.value ? joinUrl(gatewayUrl.value, "/v1") : "");
  const gatewayConfigured = Boolean(gatewayUrl.value || openAiBaseUrl.value);
  const [health, models] = gatewayConfigured
    ? await Promise.all([
      probeJson(joinUrl(gatewayUrl.value || openAiBase, "/health"), apiKey.value).catch((error) => ({
        ok: false,
        message: errorMessage(error, "Gateway health check failed."),
      })),
      probeJson(joinUrl(openAiBase, "/models"), apiKey.value).then(modelsFromResponse).catch((error) => ({
        ok: false,
        count: 0,
        ids: [],
        message: errorMessage(error, "Gateway model list is unavailable."),
      })),
    ])
    : [undefined, undefined];
  const routingReady = Boolean(gatewayConfigured && (health?.ok !== false || openAiBaseUrl.value));
  const earningReady = Boolean(installed && workerToken.present && gatewayUrl.present && ollama.installed);
  const estimatedEarningsLabel = earningsLabel.value.trim();
  const status: HiveComputeMarketplaceStatus = {
    productName: HIVE_COMPUTE_PRODUCT_NAME,
    providerSlug: HIVE_COMPUTE_PROVIDER_SLUG,
    defaultModel: HIVE_COMPUTE_DEFAULT_MODEL,
    gatewayEnv: HIVE_COMPUTE_GATEWAY_URL_ENV,
    openAiBaseEnv: HIVE_COMPUTE_OPENAI_BASE_URL_ENV,
    apiKeyEnv: HIVE_COMPUTE_API_KEY_ENV,
    workerTokenEnv: HIVE_COMPUTE_WORKER_TOKEN_ENV,
    estimatedEarningsEnv: HIVE_COMPUTE_ESTIMATED_EARNINGS_ENV,
    ...(estimatedEarningsLabel ? { estimatedEarningsLabel } : {}),
    checkedAt: new Date().toISOString(),
    gateway: {
      configured: gatewayConfigured,
      ...(gatewayUrl.value ? { baseUrl: gatewayUrl.value } : {}),
      ...(openAiBase ? { openAiBaseUrl: openAiBase } : {}),
      apiKey: envPresence(apiKey),
      capacity: capacityFromHealth(probeJsonPayload(health)),
      ...(health ? { health } : {}),
      ...(models ? { models } : {}),
    },
    workerToken: envPresence(workerToken),
    workerModule: {
      root: MODULE_DIR,
      installed,
      packageJsonPath: PACKAGE_FILE,
      workerPath: WORKER_FILE,
      readmePath: README_FILE,
      nodeModulesInstalled: depsInstalled,
      packageName: HIVE_COMPUTE_WORKER_PACKAGE_NAME,
      version: HIVE_COMPUTE_WORKER_VERSION,
      runCommand: "cd ~/.hivemindos/modules/hive-compute-worker && hive-env-run -- npm start",
      dependencyInstallCommand: "cd ~/.hivemindos/modules/hive-compute-worker && npm install --omit=dev",
    },
    prerequisites: { node, ollama },
    models: HIVE_COMPUTE_MODEL_OPTIONS,
    routing: {
      ready: routingReady,
      message: routingReady
        ? "Marketplace inference is configured for OpenAI-compatible chat routing."
        : `Set ${HIVE_COMPUTE_GATEWAY_URL_ENV} or ${HIVE_COMPUTE_OPENAI_BASE_URL_ENV} to route jobs through a Hive Compute gateway.`,
      chatPath: "/api/hive-compute/chat/completions",
    },
    earning: {
      ready: earningReady,
      message: earningReady
        ? "This machine has the worker module, gateway URL, worker token, and Ollama ready."
        : "Install the worker module, set the worker token, and make sure Ollama can serve the models you advertise.",
      cta: `Want to earn on your spare GPU? Install ${HIVE_COMPUTE_PRODUCT_NAME} Worker to rent out your GPUs and earn ${estimatedEarningsLabel || "per completed inference job"}.`,
    },
    boundary: {
      mode: "client-module",
      officialAuthority: "Official marketplace matching, prepaid balances, x402/deposit crediting, key relays, fallback policy, payouts, quotas, receipts, provider bonds, reputation, and fraud controls must be enforced by HivemindOS-controlled hosted infrastructure.",
      selfHosted: "Forks can point this app and worker module at their own compatible gateway for self-hosted marketplaces.",
      promptPrivacy: "Workers receive the prompt contents for jobs they accept; use a gateway policy and worker allowlist you trust.",
    },
  };
  return {
    ...status,
    models: hiveComputeModelOptions(status),
  };
}

function capacityFromHealth(json: unknown): HiveComputeGatewayStatus["capacity"] {
  const marketplace = json && typeof json === "object" && "marketplace" in json
    ? (json as { marketplace?: unknown }).marketplace
    : undefined;
  const record = marketplace && typeof marketplace === "object" ? marketplace as Record<string, unknown> : {};
  const liveWorkers = positiveNumber(record.liveWorkers, 0);
  const pendingJobs = positiveNumber(record.pendingJobs, 0);
  const liveModels = stringArray(record.liveModels);
  const keyRelayModels = stringArray(record.keyRelayModels);
  const fallbackConfigured = record.fallbackConfigured === true;
  const statusLabel = liveWorkers > 0
    ? `${liveWorkers} worker${liveWorkers === 1 ? "" : "s"} live`
    : fallbackConfigured
      ? "Fallback only"
      : keyRelayModels.length
        ? `${keyRelayModels.length} relay model${keyRelayModels.length === 1 ? "" : "s"}`
        : "No live workers";
  return {
    liveWorkers,
    liveModels,
    keyRelayModels,
    fallbackConfigured,
    pendingJobs,
    statusLabel,
    statusTone: liveWorkers > 0 ? "live" : fallbackConfigured || keyRelayModels.length ? "fallback" : "empty",
  };
}

function probeJsonPayload(input: unknown) {
  return input && typeof input === "object" && "json" in input
    ? (input as { json?: unknown }).json
    : undefined;
}

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

export async function installHiveComputeWorkerModule(options: { force?: boolean } = {}): Promise<HiveComputeInstallResult> {
  const wrote: string[] = [];
  const skipped: string[] = [];
  await mkdir(MODULE_DIR, { recursive: true });
  await writeManagedFile(PACKAGE_FILE, workerPackageJson(), options.force, wrote, skipped);
  await writeManagedFile(WORKER_FILE, HIVE_COMPUTE_WORKER_SOURCE, options.force, wrote, skipped);
  await writeManagedFile(README_FILE, workerReadme(), options.force, wrote, skipped);
  await writeManagedFile(NOTICE_FILE, workerNotice(), options.force, wrote, skipped);
  return {
    installed: true,
    wrote,
    skipped,
    status: await readHiveComputeMarketplaceStatus(),
  };
}

export async function installHiveComputeWorkerDependencies() {
  if (!await exists(PACKAGE_FILE)) {
    await installHiveComputeWorkerModule();
  }
  try {
    await execFileAsync("npm", ["install", "--omit=dev"], {
      cwd: MODULE_DIR,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new HiveComputeMarketplaceError(errorMessage(error, "Could not install Hive Compute worker dependencies."), 500);
  }
  return readHiveComputeMarketplaceStatus();
}

export async function proxyHiveComputeChatCompletion(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const [gatewayUrl, openAiBaseUrl, apiKey] = await Promise.all([
    readEnv(HIVE_COMPUTE_GATEWAY_URL_ENV),
    readEnv(HIVE_COMPUTE_OPENAI_BASE_URL_ENV),
    readEnv(HIVE_COMPUTE_API_KEY_ENV),
  ]);
  const openAiBase = openAiBaseUrl.value || (gatewayUrl.value ? joinUrl(gatewayUrl.value, "/v1") : "");
  if (!openAiBase) {
    throw new HiveComputeMarketplaceError(
      `Set ${HIVE_COMPUTE_GATEWAY_URL_ENV} or ${HIVE_COMPUTE_OPENAI_BASE_URL_ENV} before routing Hive Compute inference jobs.`,
      424,
    );
  }
  const model = normalizeHiveComputeModel(String(body.model || HIVE_COMPUTE_DEFAULT_MODEL));
  return fetch(joinUrl(openAiBase, "/chat/completions"), {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "X-HivemindOS-Compute-Client": "dashboard",
      ...(apiKey.value ? { Authorization: `Bearer ${apiKey.value}` } : {}),
    },
    body: JSON.stringify({ ...body, model }),
    signal: signal ?? AbortSignal.timeout(MARKETPLACE_CHAT_TIMEOUT_MS),
  });
}

async function writeManagedFile(path: string, content: string, force: boolean | undefined, wrote: string[], skipped: string[]) {
  if (!force && await exists(path)) {
    skipped.push(path);
    return;
  }
  await writeFile(path, content, "utf8");
  wrote.push(path);
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

let hiveEnvCache: Promise<string> | null = null;

async function readEnv(key: string): Promise<EnvRead> {
  const processValue = process.env[key]?.trim();
  if (processValue) return { name: key, value: processValue, present: true, source: "process" };
  if (!hiveEnvCache) hiveEnvCache = readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  const value = parseEnvFileValue(await hiveEnvCache, key);
  return value
    ? { name: key, value, present: true, source: "shared-hive-env" }
    : { name: key, value: "", present: false };
}

function envPresence(read: EnvRead): HiveComputeEnvPresence {
  return {
    name: read.name,
    present: read.present,
    ...(read.source ? { source: read.source } : {}),
  };
}

function parseEnvFileValue(raw: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*)\\s*$`, "m"));
  if (!match) return "";
  const value = match[1].trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

async function commandStatus(command: string, args: string[]): Promise<HiveComputeBinaryStatus> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 5_000, maxBuffer: 32 * 1024 });
    const version = String(stdout || stderr || "").trim().split(/\r?\n/)[0];
    return { name: command, installed: true, ...(version ? { version } : {}) };
  } catch (error) {
    return { name: command, installed: false, error: errorMessage(error, `${command} was not found.`) };
  }
}

async function probeJson(url: string, apiKey: string) {
  if (!url) return { ok: false, message: "No gateway URL configured." };
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(MARKETPLACE_STATUS_TIMEOUT_MS),
  });
  const text = await response.text();
  const json = parseJson(text);
  return {
    ok: response.ok,
    status: response.status,
    message: response.ok ? jsonMessage(json) || "Gateway responded." : upstreamError(json, text) || `HTTP ${response.status}`,
    json,
  };
}

function modelsFromResponse(input: { ok: boolean; status?: number; message?: string; json?: unknown }) {
  const data = input.json && typeof input.json === "object" && "data" in input.json
    ? (input.json as { data?: unknown }).data
    : undefined;
  const raw = Array.isArray(data) ? data : [];
  const ids = raw.map((item) => {
    if (item && typeof item === "object" && "id" in item) return String((item as { id?: unknown }).id || "").trim();
    return "";
  }).filter(Boolean);
  return {
    ok: input.ok,
    count: ids.length,
    ids,
    ...(input.status ? { status: input.status } : {}),
    ...(input.message ? { message: input.message } : {}),
  };
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function jsonMessage(json: unknown) {
  if (!json || typeof json !== "object") return "";
  const message = (json as { message?: unknown; status?: unknown }).message || (json as { message?: unknown; status?: unknown }).status;
  return typeof message === "string" ? message : "";
}

function upstreamError(json: unknown, fallback: string) {
  if (json && typeof json === "object") {
    const error = (json as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
      return String((error as { message?: unknown }).message);
    }
    if (typeof (json as { message?: unknown }).message === "string") return String((json as { message?: unknown }).message);
  }
  return fallback.trim();
}

function joinUrl(base: string, suffix: string) {
  return `${base.trim().replace(/\/+$/, "")}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

function workerPackageJson() {
  return `${JSON.stringify({
    name: HIVE_COMPUTE_WORKER_PACKAGE_NAME,
    version: HIVE_COMPUTE_WORKER_VERSION,
    private: true,
    type: "module",
    description: "Optional HivemindOS marketplace worker for renting out local GPUs through a compatible gateway.",
    scripts: {
      start: "node worker.mjs",
    },
    dependencies: {
      "ws": "^8.18.0",
    },
    engines: {
      node: ">=20",
    },
  }, null, 2)}\n`;
}

function workerReadme() {
  return `# ${HIVE_COMPUTE_PRODUCT_NAME} Worker

This optional module lets this machine accept marketplace inference jobs from a
compatible Hive Compute gateway and serve them with local Ollama or
OpenAI-compatible models such as LM Studio.

## Configure

Set these in the shared hive env, project env, or process env:

- ${HIVE_COMPUTE_GATEWAY_URL_ENV}: HTTPS URL of the official or self-hosted gateway.
- ${HIVE_COMPUTE_WORKER_TOKEN_ENV}: worker token issued by that gateway.
- HIVE_COMPUTE_LOCAL_ENGINE: optional, \`ollama\` or \`openai\`; defaults to
  \`openai\` when HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL is set, otherwise
  \`ollama\`.
- OLLAMA_HOST: optional for Ollama mode, defaults to http://127.0.0.1:11434.
- HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL: optional for LM Studio/OpenAI-compatible
  mode, for example http://127.0.0.1:1234/v1.
- HIVE_COMPUTE_LOCAL_OPENAI_API_KEY: optional bearer token for the local
  OpenAI-compatible server.
- HIVE_COMPUTE_MODELS: optional comma-separated model routes to advertise.
- HIVE_COMPUTE_MODEL_MAP_JSON: optional JSON mapping route ids to local model
  ids.
- HIVE_COMPUTE_DEFAULT_OPENAI_MODEL: optional default local model for
  OpenAI-compatible mode.
- HIVE_COMPUTE_WORKER_WS_PATH: optional, defaults to /hive-compute/worker/ws.

The worker receives prompt contents for jobs it accepts. Use only with a gateway
and allowlist policy you trust.

## Run

\`\`\`sh
npm install --omit=dev
hive-env-run -- npm start
\`\`\`
`;
}

function workerNotice() {
  return `Hive Compute Worker

Generated by HivemindOS as an optional installable module. It implements a
small native WebSocket worker protocol compatible with Hive Compute gateways,
with local Ollama and OpenAI-compatible serving adapters.
The public HivemindOS app contains no official marketplace ledger, payout,
quota, entitlement, treasury, or fraud-control authority; official authority
belongs in hosted HivemindOS infrastructure or in a self-hosted operator's own
gateway.
`;
}

const HIVE_COMPUTE_WORKER_SOURCE = `#!/usr/bin/env node
import os from "node:os";
import WebSocket from "ws";

const VERSION = "${HIVE_COMPUTE_WORKER_VERSION}";
const gateway = requiredEnv("${HIVE_COMPUTE_GATEWAY_URL_ENV}");
const token = requiredEnv("${HIVE_COMPUTE_WORKER_TOKEN_ENV}");
const ollamaHost = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\\/+$/, "");
const openAiBaseUrl = (process.env.HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL || "").replace(/\\/+$/, "");
const openAiApiKey = process.env.HIVE_COMPUTE_LOCAL_OPENAI_API_KEY || "";
const localEngine = normalizeEngine(process.env.HIVE_COMPUTE_LOCAL_ENGINE || (openAiBaseUrl ? "openai" : "ollama"));
const workerName = process.env.HIVE_COMPUTE_WORKER_NAME || os.hostname();
const workerId = process.env.HIVE_COMPUTE_WORKER_ID || workerName;
const advertisedModels = splitList(process.env.HIVE_COMPUTE_MODELS || "${HIVE_COMPUTE_DEFAULT_MODEL},hive-compute/fast");
const modelMap = parseModelMap(process.env.HIVE_COMPUTE_MODEL_MAP_JSON || "");
const wsPath = process.env.HIVE_COMPUTE_WORKER_WS_PATH || "/hive-compute/worker/ws";
let socket = null;
let reconnectDelayMs = 1000;

connect();

const registerInterval = setInterval(register, 30000);
registerInterval.unref && registerInterval.unref();
const heartbeatInterval = setInterval(() => {
  emit("worker.heartbeat", {
    workerId,
    workerName,
    models: advertisedModels,
    engine: localEngine,
    localBaseUrl: localEngine === "openai" ? openAiBaseUrl : ollamaHost,
    version: VERSION,
    at: new Date().toISOString(),
  });
}, 15000);
heartbeatInterval.unref && heartbeatInterval.unref();

function connect() {
  const url = websocketUrl(joinUrl(gateway, wsPath));
  socket = new WebSocket(url, {
    headers: { Authorization: "Bearer " + token },
  });

  socket.on("open", () => {
    reconnectDelayMs = 1000;
    register();
    console.log("[hive-compute] connected", url);
  });

  socket.on("message", (raw) => {
    const message = parseServerMessage(raw);
    if (!message) return;
    handleServerMessage(message).catch((error) => {
      console.error("[hive-compute] server message failed:", error instanceof Error ? error.message : String(error));
    });
  });

  socket.on("close", (code, reason) => {
    console.log("[hive-compute] disconnected", code, String(reason || ""));
    scheduleReconnect();
  });

  socket.on("error", (error) => {
    console.error("[hive-compute] connection failed:", error.message);
  });
}

function scheduleReconnect() {
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
  const timer = setTimeout(connect, delay);
  timer.unref && timer.unref();
}

async function handleServerMessage(message) {
  if (message.type === "server.ready" || message.type === "worker.registered") return;
  if (message.type === "job.assign") {
    try {
      await runJob(message.payload);
    } catch (error) {
      emitJobError(message.payload && message.payload.jobId, error);
    }
    return;
  }
  if (message.type === "worker.earning") {
    const earning = message.payload;
    if (!earning || typeof earning !== "object") return;
    const amount = earning.usdMicro ? "$" + (Number(earning.usdMicro) / 1_000_000).toFixed(6) : "pending";
    console.log("[hive-compute] earning", earning.jobId || "", amount);
    return;
  }
  if (message.type === "server.error") {
    console.error("[hive-compute] server error:", JSON.stringify(message.payload || {}));
  }
}

function register() {
  emit("worker.register", {
    workerId,
    workerName,
    models: advertisedModels,
    capabilities: {
      chat: true,
      streaming: true,
      engine: localEngine,
    },
    version: VERSION,
  });
}

async function runJob(job) {
  if (!job || typeof job !== "object") throw new Error("Invalid job assignment.");
  const jobId = String(job.jobId || job.id || "");
  if (!jobId) throw new Error("Job assignment is missing jobId.");
  const routeModel = String(job.model || advertisedModels[0] || "${HIVE_COMPUTE_DEFAULT_MODEL}");
  const localModel = modelMap[routeModel] || modelMap["*"] || defaultLocalModel(routeModel);
  const messages = normalizeMessages(job);
  console.log("[hive-compute] job", jobId, routeModel, "->", localModel, "(" + localEngine + ")");
  emit("job.accepted", { jobId, workerId, model: routeModel, localModel, engine: localEngine });

  if (localEngine === "openai") {
    await runOpenAICompatibleJob({ jobId, localModel, messages, options: job.options });
    return;
  }
  await runOllamaJob({ jobId, localModel, messages, options: job.options });
}

async function runOllamaJob(input) {
  const response = await fetch(joinUrl(ollamaHost, "/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.localModel,
      messages: input.messages,
      stream: true,
      options: input.options && typeof input.options === "object" ? input.options : undefined,
    }),
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error("Ollama returned HTTP " + response.status + (text ? ": " + text.slice(0, 400) : ""));
  }

  let finalText = "";
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\\r?\\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const payload = JSON.parse(trimmed);
      const tokenText = payload.message && typeof payload.message.content === "string" ? payload.message.content : "";
      if (tokenText) {
        finalText += tokenText;
        emit("job.token", { jobId: input.jobId, token: tokenText });
      }
      if (payload.done) {
        emit("job.complete", {
          jobId: input.jobId,
          text: finalText,
          usage: payload.eval_count || payload.prompt_eval_count ? {
            promptTokens: payload.prompt_eval_count || 0,
            completionTokens: payload.eval_count || 0,
          } : undefined,
        });
        console.log("[hive-compute] completed", input.jobId);
        return;
      }
    }
  }
  emit("job.complete", { jobId: input.jobId, text: finalText });
}

async function runOpenAICompatibleJob(input) {
  if (!openAiBaseUrl) throw new Error("HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL is required when HIVE_COMPUTE_LOCAL_ENGINE=openai.");
  const headers = { "Content-Type": "application/json" };
  if (openAiApiKey) headers.Authorization = "Bearer " + openAiApiKey;
  const response = await fetch(joinUrl(openAiBaseUrl, "/chat/completions"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: input.localModel,
      messages: input.messages,
      stream: true,
      ...openAIOptions(input.options),
    }),
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error("OpenAI-compatible server returned HTTP " + response.status + (text ? ": " + text.slice(0, 400) : ""));
  }

  let finalText = "";
  let finalUsage = undefined;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\\r?\\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        emit("job.complete", { jobId: input.jobId, text: finalText, usage: finalUsage });
        console.log("[hive-compute] completed", input.jobId);
        return;
      }
      const payload = JSON.parse(data);
      if (payload.usage && typeof payload.usage === "object") finalUsage = normalizeOpenAIUsage(payload.usage);
      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      for (const choice of choices) {
        const delta = choice && typeof choice === "object" ? choice.delta || choice.message || {} : {};
        const tokenText = typeof delta.content === "string"
          ? delta.content
          : Array.isArray(delta.content)
            ? delta.content.map((part) => typeof part?.text === "string" ? part.text : "").join("")
            : "";
        if (!tokenText) continue;
        finalText += tokenText;
        emit("job.token", { jobId: input.jobId, token: tokenText });
      }
    }
  }
  emit("job.complete", { jobId: input.jobId, text: finalText, usage: finalUsage });
}

function normalizeMessages(job) {
  if (Array.isArray(job.messages)) {
    return job.messages
      .filter((message) => message && typeof message === "object")
      .map((message) => ({
        role: typeof message.role === "string" ? message.role : "user",
        content: typeof message.content === "string" ? message.content : JSON.stringify(message.content || ""),
      }));
  }
  const prompt = typeof job.prompt === "string" ? job.prompt : "";
  if (!prompt) throw new Error("Job assignment is missing messages or prompt.");
  return [{ role: "user", content: prompt }];
}

function emitJobError(jobId, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[hive-compute] job failed", jobId || "", message);
  if (jobId) emit("job.error", { jobId, error: message });
}

function emit(type, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type, payload }));
  return true;
}

function parseServerMessage(raw) {
  try {
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function openAIOptions(options) {
  const source = options && typeof options === "object" ? options : {};
  const next = {};
  if (typeof source.temperature === "number") next.temperature = source.temperature;
  if (Number.isFinite(Number(source.num_predict)) && Number(source.num_predict) > 0) {
    next.max_tokens = Math.floor(Number(source.num_predict));
  }
  if (Number.isFinite(Number(source.max_tokens)) && Number(source.max_tokens) > 0) {
    next.max_tokens = Math.floor(Number(source.max_tokens));
  }
  return next;
}

function normalizeOpenAIUsage(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const promptTokens = Number(usage.prompt_tokens ?? usage.promptTokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? usage.completionTokens ?? 0);
  const normalized = {};
  if (Number.isFinite(promptTokens) && promptTokens > 0) normalized.promptTokens = Math.floor(promptTokens);
  if (Number.isFinite(completionTokens) && completionTokens > 0) normalized.completionTokens = Math.floor(completionTokens);
  return Object.keys(normalized).length ? normalized : undefined;
}

function defaultLocalModel(routeModel) {
  if (localEngine === "openai") {
    return process.env.HIVE_COMPUTE_DEFAULT_OPENAI_MODEL || process.env.HIVE_COMPUTE_DEFAULT_LM_STUDIO_MODEL || routeModel;
  }
  if (/deep|large|70b/i.test(routeModel)) return "llama3.3:70b";
  return process.env.HIVE_COMPUTE_DEFAULT_OLLAMA_MODEL || "llama3.2:3b";
}

function normalizeEngine(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "openai" || normalized === "lmstudio" || normalized === "lm-studio") return "openai";
  return "ollama";
}

function parseModelMap(raw) {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("[hive-compute] ignoring invalid HIVE_COMPUTE_MODEL_MAP_JSON:", error.message);
    return {};
  }
}

function splitList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function requiredEnv(key) {
  const value = process.env[key] && process.env[key].trim();
  if (!value) {
    console.error("[hive-compute] missing required env:", key);
    process.exit(1);
  }
  return value;
}

function joinUrl(base, suffix) {
  return base.replace(/\\/+$/, "") + (suffix.startsWith("/") ? suffix : "/" + suffix);
}

function websocketUrl(url) {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed.toString();
}
`;
