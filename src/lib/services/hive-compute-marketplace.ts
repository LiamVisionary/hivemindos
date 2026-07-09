import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  HIVE_COMPUTE_API_KEY_ENV,
  HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV,
  HIVE_COMPUTE_CONFIDENTIAL_MODE_ENV,
  HIVE_COMPUTE_DEFAULT_MODEL,
  HIVE_COMPUTE_TEE_ATTESTATION_COMMAND_ENV,
  HIVE_COMPUTE_TEE_ATTESTATION_FILE_ENV,
  HIVE_COMPUTE_TEE_ATTESTATION_FORMAT_ENV,
  HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE_ENV,
  HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY_ENV,
  HIVE_COMPUTE_TEE_IMAGE_DIGEST_ENV,
  HIVE_COMPUTE_TEE_MEASUREMENT_ENV,
  HIVE_COMPUTE_TEE_PAYLOAD_KEY_ENV,
  HIVE_COMPUTE_TEE_PROVIDER_ENV,
  HIVE_COMPUTE_ESTIMATED_EARNINGS_ENV,
  HIVE_COMPUTE_GATEWAY_URL_ENV,
  HIVE_COMPUTE_MPP_ENABLED_ENV,
  HIVE_COMPUTE_MPP_POLICY_URL_ENV,
  HIVE_COMPUTE_MPP_REQUIRE_SESSION_ENV,
  HIVE_COMPUTE_MPP_SESSION_TOKEN_ENV,
  HIVE_COMPUTE_MODEL_OPTIONS,
  HIVE_COMPUTE_OPENAI_BASE_URL_ENV,
  HIVE_COMPUTE_PAYMENT_RAIL_ENV,
  HIVE_COMPUTE_PRODUCT_NAME,
  HIVE_COMPUTE_PROVIDER_SLUG,
  HIVE_COMPUTE_TEE_REQUIRED_ENV,
  HIVE_COMPUTE_WORKER_REQUIRE_PAYMENT_PROOF_ENV,
  HIVE_COMPUTE_WORKER_PACKAGE_NAME,
  HIVE_COMPUTE_WORKER_TOKEN_ENV,
  HIVE_COMPUTE_WORKER_VERSION,
  normalizeHiveComputeModel,
} from "@/lib/config/hive-compute-marketplace";
import {
  HIVE_COMPUTE_WORKER_SOURCE,
  hiveComputeWorkerNotice,
  hiveComputeWorkerPackageJson,
  hiveComputeWorkerReadme,
} from "@/lib/services/hive-compute-marketplace/worker-module";
import { homedir } from "@/lib/home-dir";
import type {
  HiveComputeBinaryStatus,
  HiveComputeEnvPresence,
  HiveComputeGatewayStatus,
  HiveComputeHostContext,
  HiveComputeHostModel,
  HiveComputeHostRunConfig,
  HiveComputeInstallResult,
  HiveComputeLocalBackendStatus,
  HiveComputeMarketplaceStatus,
  HiveComputeModelPerformance,
  HiveComputeModelOption,
  HiveComputePaymentRail,
  HiveComputeWorkerRunStatus,
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
const HIVE_COMPUTE_DEFAULT_INPUT_MICRO_USDC_PER_1M = 500_000;
const HIVE_COMPUTE_DEFAULT_OUTPUT_MICRO_USDC_PER_1M = 750_000;
const HIVE_COMPUTE_RUN_CONFIG_FILE = join(MODULE_DIR, "hivemind-host-config.json");
const HIVE_COMPUTE_MPP_SESSION_FILE = join(MODULE_DIR, "hivemind-mpp-session.json");

type EnvRead = HiveComputeEnvPresence & { value: string };

type HiveComputeWorkerSession = {
  child: ChildProcessWithoutNullStreams;
  output: string;
  error: string;
  status: "starting" | "running" | "failed";
  startedAt: number;
};

const globalHiveComputeState = globalThis as typeof globalThis & {
  __hivemindHiveComputeWorkerRun?: HiveComputeWorkerSession;
};

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
  const performance = status.gateway.capacity?.modelPerformance.find((item) => item.model === id);
  const speedLabel = modelPerformanceLabel(performance);
  if (alias) {
    return {
      ...alias,
      ...(performance ? { performance } : {}),
      subtitle: status.gateway.capacity?.fallbackConfigured && !status.gateway.capacity.liveWorkers
        ? "Routes through centralized fallback when no worker is live."
        : speedLabel || alias.subtitle,
      badge: status.gateway.capacity?.fallbackConfigured && !status.gateway.capacity.liveWorkers
        ? "Fallback"
        : performanceBadge(performance) || alias.badge,
    };
  }
  const live = liveModels.has(id);
  const relay = keyRelayModels.has(id);
  return {
    id,
    name: id,
    group: "Marketplace",
    ...(performance ? { performance } : {}),
    subtitle: speedLabel || (live ? "Live worker model" : relay ? "Key-relay model" : "Marketplace model"),
    badge: performanceBadge(performance) || (live ? "Live" : relay ? "Relay" : "Gateway"),
  };
}

function modelPerformanceLabel(performance?: HiveComputeModelPerformance) {
  if (!performance?.samples || !performance.tokensPerSecond) return "";
  if (performance.speedTier === "warming") return "Measuring speed";
  const tier = performance.speedTier === "fast"
      ? "Fast"
      : performance.speedTier === "balanced"
        ? "Balanced"
        : "Heavy";
  return `${tier} · ${performance.tokensPerSecond.toFixed(1)} tok/s`;
}

function performanceBadge(performance?: HiveComputeModelPerformance) {
  if (!performance?.samples || !performance.speedTier || performance.speedTier === "unmeasured") return "";
  if (performance.speedTier === "warming") return "Measuring";
  if (performance.speedTier === "fast") return "Fast";
  if (performance.speedTier === "balanced") return "Balanced";
  return "Heavy";
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
  const [
    gatewayUrl,
    openAiBaseUrl,
    apiKey,
    workerToken,
    earningsLabel,
    paymentRail,
    mppEnabled,
    mppPolicyUrl,
    mppSessionToken,
    mppRequireSession,
    teeRequired,
    confidentialMode,
    attestationPolicyUrl,
    teeProvider,
    teeAttestationFile,
    teeAttestationCommand,
    teeAttestationFormat,
    teeMeasurement,
    teeImageDigest,
    teeEncryptionPublicKey,
    teeDecryptionPrivateKeyFile,
    teePayloadKey,
    node,
    ollama,
    installed,
    depsInstalled,
    installedWorkerVersion,
  ] = await Promise.all([
    readEnv(HIVE_COMPUTE_GATEWAY_URL_ENV),
    readEnv(HIVE_COMPUTE_OPENAI_BASE_URL_ENV),
    readEnv(HIVE_COMPUTE_API_KEY_ENV),
    readEnv(HIVE_COMPUTE_WORKER_TOKEN_ENV),
    readEnv(HIVE_COMPUTE_ESTIMATED_EARNINGS_ENV),
    readEnv(HIVE_COMPUTE_PAYMENT_RAIL_ENV),
    readEnv(HIVE_COMPUTE_MPP_ENABLED_ENV),
    readEnv(HIVE_COMPUTE_MPP_POLICY_URL_ENV),
    readMppSessionToken(),
    readEnv(HIVE_COMPUTE_MPP_REQUIRE_SESSION_ENV),
    readEnv(HIVE_COMPUTE_TEE_REQUIRED_ENV),
    readEnv(HIVE_COMPUTE_CONFIDENTIAL_MODE_ENV),
    readEnv(HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV),
    readEnv(HIVE_COMPUTE_TEE_PROVIDER_ENV),
    readEnv(HIVE_COMPUTE_TEE_ATTESTATION_FILE_ENV),
    readEnv(HIVE_COMPUTE_TEE_ATTESTATION_COMMAND_ENV),
    readEnv(HIVE_COMPUTE_TEE_ATTESTATION_FORMAT_ENV),
    readEnv(HIVE_COMPUTE_TEE_MEASUREMENT_ENV),
    readEnv(HIVE_COMPUTE_TEE_IMAGE_DIGEST_ENV),
    readEnv(HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY_ENV),
    readEnv(HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE_ENV),
    readEnv(HIVE_COMPUTE_TEE_PAYLOAD_KEY_ENV),
    commandStatus("node", ["--version"]),
    commandStatus("ollama", ["--version"]),
    exists(WORKER_FILE),
    exists(NODE_MODULES_WS),
    installedHiveComputeWorkerVersion(),
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
  const estimatedEarningsLabel = earningsLabel.value.trim();
  const paymentStatus = paymentStatusFromEnv({
    rail: paymentRail.value,
    gatewayConfigured,
    mppEnabled: mppEnabled.value,
    mppPolicyUrl: mppPolicyUrl.value,
    mppSessionToken,
    mppRequireSession: mppRequireSession.value,
  });
  const privacyStatus = privacyStatusFromEnv({
    teeRequired: teeRequired.value,
    confidentialMode: confidentialMode.value,
    attestationPolicyUrl: attestationPolicyUrl.value,
    teeProvider: teeProvider.value,
    teeAttestationFile: teeAttestationFile.value,
    teeAttestationCommand: teeAttestationCommand.value,
    teeAttestationFormat: teeAttestationFormat.value,
    teeMeasurement: teeMeasurement.value,
    teeImageDigest: teeImageDigest.value,
    teeEncryptionPublicKey: teeEncryptionPublicKey.value,
    teeDecryptionPrivateKeyFile: teeDecryptionPrivateKeyFile.value,
    teePayloadKey: teePayloadKey.value,
  });
  const host = await buildHiveComputeHostContext({
    installed,
    depsInstalled,
    nodeInstalled: node.installed,
    workerTokenPresent: workerToken.present,
    gatewayConfigured,
  });
  const earningReady = host.canRun;
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
    payments: paymentStatus,
    privacy: privacyStatus,
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
      ...(installedWorkerVersion ? { installedVersion: installedWorkerVersion } : {}),
      updateAvailable: installedWorkerVersion !== "" && installedWorkerVersion !== HIVE_COMPUTE_WORKER_VERSION,
      runCommand: "cd ~/.hivemindos/modules/hive-compute-worker && hive-env-run -- npm start",
      dependencyInstallCommand: "cd ~/.hivemindos/modules/hive-compute-worker && npm install --omit=dev",
    },
    host,
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
        ? "This machine has the worker module, gateway URL, worker token, and a local model backend ready."
        : host.message,
      cta: `Want to earn on your spare GPU? Install ${HIVE_COMPUTE_PRODUCT_NAME} Worker to rent out your GPUs and earn ${estimatedEarningsLabel || "per completed inference job"}.`,
    },
    boundary: {
      mode: "client-module",
      officialAuthority: "Official marketplace matching, prepaid balances, x402/deposit crediting, key relays, fallback policy, payouts, quotas, receipts, provider bonds, reputation, and fraud controls must be enforced by HivemindOS-controlled hosted infrastructure.",
      selfHosted: "Forks can point this app and worker module at their own compatible gateway for self-hosted marketplaces.",
      promptPrivacy: "Standard workers receive prompt contents for jobs they accept; use a gateway policy and worker allowlist you trust.",
      confidentialCompute: "Hardware-enforced privacy requires gateway-verified TEE attestation plus encrypted prompt and output delivery. Local app state can request private routing, but it cannot prove confidential compute by itself.",
      micropayments: "x402 per-call settlement is the default machine-payment rail. MPP session settlement is enabled only when a hosted gateway exposes a Stripe/Tempo-compatible session policy.",
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
  const totalSlots = positiveNumber(record.totalSlots, 0);
  const busySlots = positiveNumber(record.busySlots, 0);
  const availableSlots = positiveNumber(record.availableSlots, 0);
  const hardwareTeeWorkers = positiveNumber(record.hardwareTeeWorkers, 0);
  const pendingJobs = positiveNumber(record.pendingJobs, 0);
  const liveModels = stringArray(record.liveModels);
  const keyRelayModels = stringArray(record.keyRelayModels);
  const modelPerformance = modelPerformanceArray(record.modelPerformance);
  const fallbackConfigured = record.fallbackConfigured === true;
  const statusLabel = liveWorkers > 0
    ? totalSlots > 0
      ? `${availableSlots}/${totalSlots} slot${totalSlots === 1 ? "" : "s"} open`
      : `${liveWorkers} worker${liveWorkers === 1 ? "" : "s"} live`
    : fallbackConfigured
      ? "Fallback only"
      : keyRelayModels.length
        ? `${keyRelayModels.length} relay model${keyRelayModels.length === 1 ? "" : "s"}`
        : "No live workers";
  return {
    liveWorkers,
    ...(totalSlots ? { totalSlots, busySlots, availableSlots } : {}),
    ...(hardwareTeeWorkers ? { hardwareTeeWorkers } : {}),
    liveModels,
    keyRelayModels,
    modelPerformance,
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

function positiveFloat(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function modelPerformanceArray(value: unknown): HiveComputeModelPerformance[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): HiveComputeModelPerformance[] => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const model = String(record.model || "").trim();
    if (!model) return [];
    const speedTier = String(record.speedTier || "").trim();
    return [{
      model,
      samples: positiveNumber(record.samples, 0),
      completionTokens: positiveNumber(record.completionTokens, 0),
      tokensPerSecond: positiveFloat(record.tokensPerSecond, 0),
      timeToFirstTokenMs: positiveNumber(record.timeToFirstTokenMs, 0),
      durationMs: positiveNumber(record.durationMs, 0),
      speedTier: speedTier === "warming" || speedTier === "heavy" || speedTier === "balanced" || speedTier === "fast"
        ? speedTier
        : "unmeasured",
      ...(String(record.updatedAt || "").trim() ? { updatedAt: String(record.updatedAt).trim() } : {}),
    }];
  });
}

function booleanSetting(value: string) {
  return ["1", "true", "yes", "on", "enabled"].includes(value.trim().toLowerCase());
}

function normalizePaymentRail(value: string): HiveComputePaymentRail {
  const lowered = value.trim().toLowerCase();
  if (lowered === "mpp" || lowered === "prepaid" || lowered === "self-hosted") return lowered;
  return "x402";
}

function paymentStatusFromEnv(params: {
  rail: string;
  gatewayConfigured: boolean;
  mppEnabled: string;
  mppPolicyUrl: string;
  mppSessionToken: EnvRead;
  mppRequireSession: string;
}): HiveComputeMarketplaceStatus["payments"] {
  const defaultRail = normalizePaymentRail(params.rail);
  const mppEnabled = booleanSetting(params.mppEnabled) || defaultRail === "mpp";
  const requireSession = booleanSetting(params.mppRequireSession) || defaultRail === "mpp";
  const mppReady = mppEnabled && Boolean(params.mppPolicyUrl.trim()) && (!requireSession || params.mppSessionToken.present);
  return {
    defaultRail,
    railEnv: HIVE_COMPUTE_PAYMENT_RAIL_ENV,
    x402: {
      ready: params.gatewayConfigured,
      message: params.gatewayConfigured
        ? "Gateway handles x402 per-call settlement for paid marketplace requests."
        : "Configure a Hive Compute gateway before x402 settlement can be checked.",
    },
    mpp: {
      enabled: mppEnabled,
      ready: mppReady,
      enabledEnv: HIVE_COMPUTE_MPP_ENABLED_ENV,
      policyUrlEnv: HIVE_COMPUTE_MPP_POLICY_URL_ENV,
      sessionTokenEnv: HIVE_COMPUTE_MPP_SESSION_TOKEN_ENV,
      requireSessionEnv: HIVE_COMPUTE_MPP_REQUIRE_SESSION_ENV,
      ...(params.mppPolicyUrl.trim() ? { policyUrl: params.mppPolicyUrl.trim() } : {}),
      sessionToken: envPresence(params.mppSessionToken),
      requireSession,
      message: mppReady
        ? "MPP session policy and session authorization are configured for machine-speed settlement."
        : mppEnabled
          ? requireSession && !params.mppSessionToken.present
            ? `Set ${HIVE_COMPUTE_MPP_SESSION_TOKEN_ENV} or open a gateway MPP session before requiring session settlement.`
            : `Set ${HIVE_COMPUTE_MPP_POLICY_URL_ENV} to let the gateway advertise MPP sessions.`
          : "MPP is available as an optional session rail, off by default.",
    },
  };
}

function privacyStatusFromEnv(params: {
  teeRequired: string;
  confidentialMode: string;
  attestationPolicyUrl: string;
  teeProvider: string;
  teeAttestationFile: string;
  teeAttestationCommand: string;
  teeAttestationFormat: string;
  teeMeasurement: string;
  teeImageDigest: string;
  teeEncryptionPublicKey: string;
  teeDecryptionPrivateKeyFile: string;
  teePayloadKey: string;
}): HiveComputeMarketplaceStatus["privacy"] {
  const verifiedOnly = booleanSetting(params.teeRequired);
  const confidentialMode = params.confidentialMode.trim().toLowerCase();
  const attestationPolicyUrl = params.attestationPolicyUrl.trim();
  const hasPolicy = Boolean(attestationPolicyUrl);
  const teeProvider = params.teeProvider.trim();
  const evidenceSource = params.teeAttestationCommand.trim()
    ? "command" as const
    : params.teeAttestationFile.trim()
      ? "file" as const
      : undefined;
  const attestationReady = confidentialMode === "tee-attested" && hasPolicy && Boolean(teeProvider) && Boolean(evidenceSource);
  const encryptedDeliveryReady = Boolean(params.teeEncryptionPublicKey.trim()) &&
    (Boolean(params.teeDecryptionPrivateKeyFile.trim()) || Boolean(params.teePayloadKey.trim()));
  return {
    mode: verifiedOnly ? "tee-required" : hasPolicy || confidentialMode === "tee-attested" ? "attestation-policy" : "standard",
    verifiedOnly,
    teeRequiredEnv: HIVE_COMPUTE_TEE_REQUIRED_ENV,
    confidentialModeEnv: HIVE_COMPUTE_CONFIDENTIAL_MODE_ENV,
    attestationPolicyUrlEnv: HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV,
    teeProviderEnv: HIVE_COMPUTE_TEE_PROVIDER_ENV,
    attestationFileEnv: HIVE_COMPUTE_TEE_ATTESTATION_FILE_ENV,
    attestationCommandEnv: HIVE_COMPUTE_TEE_ATTESTATION_COMMAND_ENV,
    attestationFormatEnv: HIVE_COMPUTE_TEE_ATTESTATION_FORMAT_ENV,
    measurementEnv: HIVE_COMPUTE_TEE_MEASUREMENT_ENV,
    imageDigestEnv: HIVE_COMPUTE_TEE_IMAGE_DIGEST_ENV,
    encryptionPublicKeyEnv: HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY_ENV,
    decryptionPrivateKeyFileEnv: HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE_ENV,
    ...(attestationPolicyUrl ? { attestationPolicyUrl } : {}),
    ...(teeProvider ? { teeProvider } : {}),
    attestationReady,
    encryptedDeliveryReady,
    ...(evidenceSource ? { evidenceSource } : {}),
    message: verifiedOnly
      ? attestationReady && encryptedDeliveryReady
        ? "Verified-only routing, attestation evidence, and encrypted prompt delivery are configured."
        : "Verified-only routing is requested, but this worker still needs TEE evidence and encrypted prompt delivery before it can prove hardware privacy."
      : attestationReady
        ? "TEE attestation evidence is configured; eligible gateways can verify this worker before routing private jobs."
        : hasPolicy
          ? "Attestation policy is configured; add TEE provider evidence and encryption keys before advertising hardware privacy."
        : "Standard local workers are not hardware-confidential. Enable TEE policy when the gateway supports remote attestation.",
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeHostWhen(value: unknown): HiveComputeHostRunConfig["hostWhen"] {
  return value === "always" || value === "sched" || value === "idle" ? value : "idle";
}

function normalizeSelectedModelIds(value: unknown): string[] | null {
  if (value === null || typeof value === "undefined") return null;
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    const id = String(item ?? "").trim();
    if (!id || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizeRunConfig(value?: Partial<HiveComputeHostRunConfig> | null): HiveComputeHostRunConfig {
  return {
    markdown: Math.round(clampNumber(value?.markdown, 20, 0, 80)),
    maxConcurrency: Math.round(clampNumber(value?.maxConcurrency, 1, 1, 256)),
    selectedModelIds: normalizeSelectedModelIds(value?.selectedModelIds),
    hostWhen: normalizeHostWhen(value?.hostWhen),
    dailyCapUsd: value?.dailyCapUsd === null || typeof value?.dailyCapUsd === "undefined"
      ? null
      : clampNumber(value.dailyCapUsd, 25, 1, 10_000),
    pauseOnBattery: value?.pauseOnBattery !== false,
    yieldToUser: value?.yieldToUser !== false,
  };
}

async function savedHiveComputeRunConfig() {
  const raw = await readFile(HIVE_COMPUTE_RUN_CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return null;
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { config?: unknown };
  return (record.config && typeof record.config === "object"
    ? record.config
    : parsed) as Partial<HiveComputeHostRunConfig>;
}

async function installedHiveComputeWorkerVersion() {
  const raw = await readFile(PACKAGE_FILE, "utf8").catch(() => "");
  if (!raw) return "";
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object") return "";
  return String((parsed as { version?: unknown }).version || "").trim();
}

async function resolveHiveComputeRunConfig(value?: Partial<HiveComputeHostRunConfig> | null) {
  return normalizeRunConfig(value ?? await savedHiveComputeRunConfig().catch(() => null));
}

function advertisedPriceMicroUsdc(basePrice: number, config: HiveComputeHostRunConfig) {
  const multiplier = Math.max(0.2, 1 - config.markdown / 100);
  return Math.max(1, Math.round(basePrice * multiplier));
}

async function readSavedEnvValue(key: string) {
  const direct = process.env[key]?.trim();
  if (direct) return direct;
  if (!hiveEnvCache) hiveEnvCache = readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  return parseEnvFileValue(await hiveEnvCache, key);
}

function normalizeOpenAiLocalBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

async function localBackendCandidates(): Promise<HiveComputeLocalBackendStatus[]> {
  const localOpenAiBase = normalizeOpenAiLocalBaseUrl(
    await readSavedEnvValue("HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL") ||
    await readSavedEnvValue("LOCAL_OPENAI_BASE_URL") ||
    await readSavedEnvValue("NEXT_PUBLIC_LOCAL_OPENAI_BASE_URL") ||
    "http://127.0.0.1:1234/v1",
  );
  const ollamaBase = (await readSavedEnvValue("OLLAMA_HOST") || await readSavedEnvValue("OLLAMA_BASE_URL") || "http://127.0.0.1:11434")
    .trim()
    .replace(/\/+$/, "");
  const candidates: HiveComputeLocalBackendStatus[] = [
    {
      kind: /1234(?:\/v1)?$/i.test(localOpenAiBase) ? "lmstudio" : "openai",
      label: /1234(?:\/v1)?$/i.test(localOpenAiBase) ? "LM Studio" : "OpenAI-compatible",
      host: localOpenAiBase,
      reachable: false,
      message: "",
    },
    {
      kind: "ollama",
      label: "Ollama",
      host: ollamaBase,
      reachable: false,
      message: "",
    },
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.host}`;
    if (!candidate.host || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function extractOllamaModels(data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const rawModels = Array.isArray(record.models) ? record.models : [];
  const models: Array<{ id: string; name?: string }> = [];
  const seen = new Set<string>();
  for (const item of rawModels) {
    const id = item && typeof item === "object" && typeof (item as Record<string, unknown>).name === "string"
      ? String((item as Record<string, unknown>).name).trim()
      : item && typeof item === "object" && typeof (item as Record<string, unknown>).model === "string"
        ? String((item as Record<string, unknown>).model).trim()
        : typeof item === "string"
          ? item.trim()
          : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id });
  }
  return models;
}

async function probeBackend(candidate: HiveComputeLocalBackendStatus, config: HiveComputeHostRunConfig) {
  const url = candidate.kind === "ollama" ? joinUrl(candidate.host, "/api/tags") : joinUrl(candidate.host, "/models");
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        backend: { ...candidate, reachable: false, message: `${candidate.label} returned HTTP ${response.status}.` },
        models: [],
      };
    }
    const inputPer1m = advertisedPriceMicroUsdc(HIVE_COMPUTE_DEFAULT_INPUT_MICRO_USDC_PER_1M, config);
    const outputPer1m = advertisedPriceMicroUsdc(HIVE_COMPUTE_DEFAULT_OUTPUT_MICRO_USDC_PER_1M, config);
    const parsedModels = candidate.kind === "ollama" ? extractOllamaModels(data) : extractOpenAiModels(data);
    return {
      backend: {
        ...candidate,
        reachable: true,
        message: parsedModels.length
          ? `${candidate.label} reported ${parsedModels.length} model${parsedModels.length === 1 ? "" : "s"}.`
          : `${candidate.label} is reachable but did not report models.`,
      },
      models: parsedModels.map((model) => ({
        id: model.id,
        name: model.name,
        providerModelId: model.id,
        backendKind: candidate.kind,
        inputPer1m,
        outputPer1m,
      })),
    };
  } catch (error) {
    return {
      backend: {
        ...candidate,
        reachable: false,
        message: error instanceof Error && error.name === "TimeoutError"
          ? `${candidate.label} did not answer before timeout.`
          : `${candidate.label} is not reachable at ${candidate.host}.`,
      },
      models: [],
    };
  }
}

async function discoverHiveComputeBackend(config: HiveComputeHostRunConfig) {
  const checked = await Promise.all((await localBackendCandidates()).map((candidate) => probeBackend(candidate, config)));
  return checked.find((candidate) => candidate.backend.reachable && candidate.models.length) ??
    checked.find((candidate) => candidate.backend.reachable) ??
    checked[0] ?? {
      backend: {
        kind: "openai" as const,
        label: "OpenAI-compatible",
        host: "http://127.0.0.1:1234/v1",
        reachable: false,
        message: "No local OpenAI-compatible backend was checked.",
      },
      models: [],
    };
}

function currentWorkerRun(): HiveComputeWorkerRunStatus {
  const session = globalHiveComputeState.__hivemindHiveComputeWorkerRun;
  if (!session) return { status: "idle", output: "", error: "", startedAt: 0 };
  return {
    status: session.status,
    output: session.output,
    error: session.error,
    startedAt: session.startedAt,
    ...(session.child.pid ? { pid: session.child.pid } : {}),
  };
}

function hostReadinessMessage(params: {
  installed: boolean;
  depsInstalled: boolean;
  nodeInstalled: boolean;
  workerTokenPresent: boolean;
  gatewayConfigured: boolean;
  backend: HiveComputeLocalBackendStatus;
  modelCount: number;
  advertisedModelCount: number;
}) {
  if (!params.nodeInstalled) return "Install Node.js before running the Hive Compute worker.";
  if (!params.installed) return "Install the Hive Compute worker module.";
  if (!params.depsInstalled) return "Install worker dependencies.";
  if (!params.gatewayConfigured) return `Set ${HIVE_COMPUTE_GATEWAY_URL_ENV} for the gateway that issues jobs.`;
  if (!params.workerTokenPresent) return `Set ${HIVE_COMPUTE_WORKER_TOKEN_ENV} from the gateway.`;
  if (!params.backend.reachable) return params.backend.message || "Start LM Studio or Ollama so the worker has a local model backend.";
  if (!params.modelCount) return `${params.backend.label} is reachable, but it did not report any models.`;
  if (!params.advertisedModelCount) return "Choose at least one local model to advertise before going live.";
  return "This machine can go live as a Hive Compute worker.";
}

async function buildHiveComputeHostContext(params: {
  installed: boolean;
  depsInstalled: boolean;
  nodeInstalled: boolean;
  workerTokenPresent: boolean;
  gatewayConfigured: boolean;
  config?: Partial<HiveComputeHostRunConfig> | null;
}): Promise<HiveComputeHostContext> {
  const config = await resolveHiveComputeRunConfig(params.config);
  const discovered = await discoverHiveComputeBackend(config);
  const advertisedModels = advertisedWorkerModels(discovered.models, config);
  const canRun = Boolean(
    params.installed &&
    params.depsInstalled &&
    params.nodeInstalled &&
    params.workerTokenPresent &&
    params.gatewayConfigured &&
    discovered.backend.reachable &&
    discovered.models.length &&
    advertisedModels.length,
  );
  return {
    backend: discovered.backend,
    models: discovered.models,
    advertisedModels,
    config,
    canRun,
    message: hostReadinessMessage({
      ...params,
      backend: discovered.backend,
      modelCount: discovered.models.length,
      advertisedModelCount: advertisedModels.length,
    }),
    run: currentWorkerRun(),
  };
}

export async function installHiveComputeWorkerModule(options: { force?: boolean } = {}): Promise<HiveComputeInstallResult> {
  const wrote: string[] = [];
  const skipped: string[] = [];
  await mkdir(MODULE_DIR, { recursive: true });
  await writeManagedFile(PACKAGE_FILE, hiveComputeWorkerPackageJson(), options.force, wrote, skipped);
  await writeManagedFile(WORKER_FILE, HIVE_COMPUTE_WORKER_SOURCE, options.force, wrote, skipped);
  await writeManagedFile(README_FILE, hiveComputeWorkerReadme(), options.force, wrote, skipped);
  await writeManagedFile(NOTICE_FILE, hiveComputeWorkerNotice(), options.force, wrote, skipped);
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

export async function setupHiveComputeHosting(config?: Partial<HiveComputeHostRunConfig> | null) {
  const before = await readHiveComputeMarketplaceStatus();
  if (!before.workerModule.installed || before.workerModule.updateAvailable) {
    await installHiveComputeWorkerModule({ force: before.workerModule.updateAvailable });
  }
  if (!before.workerModule.nodeModulesInstalled) {
    await installHiveComputeWorkerDependencies();
  }
  const host = await readHiveComputeHostContext(config);
  if (host.config) {
    await writeHiveComputeRunConfig(host);
  }
  const afterDeps = await readHiveComputeMarketplaceStatus();
  if (
    afterDeps.payments.mpp.enabled &&
    !afterDeps.payments.mpp.sessionToken.present &&
    afterDeps.gateway.configured &&
    afterDeps.gateway.apiKey.present
  ) {
    try {
      return await openHiveComputeMppSession();
    } catch (error) {
      if (afterDeps.payments.mpp.requireSession) throw error;
    }
  }
  return readHiveComputeMarketplaceStatus();
}

export async function readHiveComputeHostContext(config?: Partial<HiveComputeHostRunConfig> | null) {
  const [gatewayUrl, openAiBaseUrl, workerToken, node, installed, depsInstalled] = await Promise.all([
    readEnv(HIVE_COMPUTE_GATEWAY_URL_ENV),
    readEnv(HIVE_COMPUTE_OPENAI_BASE_URL_ENV),
    readEnv(HIVE_COMPUTE_WORKER_TOKEN_ENV),
    commandStatus("node", ["--version"]),
    exists(WORKER_FILE),
    exists(NODE_MODULES_WS),
  ]);
  return buildHiveComputeHostContext({
    installed,
    depsInstalled,
    nodeInstalled: node.installed,
    workerTokenPresent: workerToken.present,
    gatewayConfigured: Boolean(gatewayUrl.value || openAiBaseUrl.value),
    config,
  });
}

export async function startHiveComputeWorker(config?: Partial<HiveComputeHostRunConfig> | null) {
  const existing = globalHiveComputeState.__hivemindHiveComputeWorkerRun;
  if (existing && existing.status !== "failed" && !existing.child.killed) {
    existing.status = existing.status === "starting" ? "running" : existing.status;
    return readHiveComputeMarketplaceStatus();
  }

  const [
    gatewayUrl,
    workerToken,
    apiKey,
    paymentRail,
    mppPolicyUrl,
    mppSessionToken,
    mppRequireSession,
    attestationPolicyUrl,
    confidentialMode,
    teeProvider,
    teeAttestationFile,
    teeAttestationCommand,
    teeAttestationFormat,
    teeMeasurement,
    teeImageDigest,
    teeEncryptionPublicKey,
    teeDecryptionPrivateKeyFile,
    teePayloadKey,
  ] = await Promise.all([
    readEnv(HIVE_COMPUTE_GATEWAY_URL_ENV),
    readEnv(HIVE_COMPUTE_WORKER_TOKEN_ENV),
    readEnv(HIVE_COMPUTE_API_KEY_ENV),
    readEnv(HIVE_COMPUTE_PAYMENT_RAIL_ENV),
    readEnv(HIVE_COMPUTE_MPP_POLICY_URL_ENV),
    readMppSessionToken(),
    readEnv(HIVE_COMPUTE_MPP_REQUIRE_SESSION_ENV),
    readEnv(HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV),
    readEnv(HIVE_COMPUTE_CONFIDENTIAL_MODE_ENV),
    readEnv(HIVE_COMPUTE_TEE_PROVIDER_ENV),
    readEnv(HIVE_COMPUTE_TEE_ATTESTATION_FILE_ENV),
    readEnv(HIVE_COMPUTE_TEE_ATTESTATION_COMMAND_ENV),
    readEnv(HIVE_COMPUTE_TEE_ATTESTATION_FORMAT_ENV),
    readEnv(HIVE_COMPUTE_TEE_MEASUREMENT_ENV),
    readEnv(HIVE_COMPUTE_TEE_IMAGE_DIGEST_ENV),
    readEnv(HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY_ENV),
    readEnv(HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE_ENV),
    readEnv(HIVE_COMPUTE_TEE_PAYLOAD_KEY_ENV),
  ]);
  if (!await exists(WORKER_FILE)) {
    throw new HiveComputeMarketplaceError("Install the Hive Compute worker module before going live.", 424);
  }
  if (await installedHiveComputeWorkerVersion() !== HIVE_COMPUTE_WORKER_VERSION) {
    await installHiveComputeWorkerModule({ force: true });
  }
  if (!await exists(NODE_MODULES_WS)) {
    throw new HiveComputeMarketplaceError("Install Hive Compute worker dependencies before going live.", 424);
  }
  if (!gatewayUrl.value) {
    throw new HiveComputeMarketplaceError(`Set ${HIVE_COMPUTE_GATEWAY_URL_ENV} before going live.`, 424);
  }
  if (!workerToken.value) {
    throw new HiveComputeMarketplaceError(`Set ${HIVE_COMPUTE_WORKER_TOKEN_ENV} before going live.`, 424);
  }

  const host = await readHiveComputeHostContext(config);
  if (!host.canRun) throw new HiveComputeMarketplaceError(host.message, 424);
  await writeHiveComputeRunConfig(host);

  const env = {
    ...process.env,
    [HIVE_COMPUTE_GATEWAY_URL_ENV]: gatewayUrl.value,
    [HIVE_COMPUTE_WORKER_TOKEN_ENV]: workerToken.value,
    ...(apiKey.value ? { [HIVE_COMPUTE_API_KEY_ENV]: apiKey.value } : {}),
    [HIVE_COMPUTE_PAYMENT_RAIL_ENV]: normalizePaymentRail(paymentRail.value),
    ...(mppPolicyUrl.value ? { [HIVE_COMPUTE_MPP_POLICY_URL_ENV]: mppPolicyUrl.value } : {}),
    ...(mppSessionToken.value ? { [HIVE_COMPUTE_MPP_SESSION_TOKEN_ENV]: mppSessionToken.value } : {}),
    ...(mppRequireSession.value ? { [HIVE_COMPUTE_MPP_REQUIRE_SESSION_ENV]: mppRequireSession.value } : {}),
    ...(attestationPolicyUrl.value ? { [HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV]: attestationPolicyUrl.value } : {}),
    ...(confidentialMode.value ? { [HIVE_COMPUTE_CONFIDENTIAL_MODE_ENV]: confidentialMode.value } : {}),
    ...(teeProvider.value ? { [HIVE_COMPUTE_TEE_PROVIDER_ENV]: teeProvider.value } : {}),
    ...(teeAttestationFile.value ? { [HIVE_COMPUTE_TEE_ATTESTATION_FILE_ENV]: teeAttestationFile.value } : {}),
    ...(teeAttestationCommand.value ? { [HIVE_COMPUTE_TEE_ATTESTATION_COMMAND_ENV]: teeAttestationCommand.value } : {}),
    ...(teeAttestationFormat.value ? { [HIVE_COMPUTE_TEE_ATTESTATION_FORMAT_ENV]: teeAttestationFormat.value } : {}),
    ...(teeMeasurement.value ? { [HIVE_COMPUTE_TEE_MEASUREMENT_ENV]: teeMeasurement.value } : {}),
    ...(teeImageDigest.value ? { [HIVE_COMPUTE_TEE_IMAGE_DIGEST_ENV]: teeImageDigest.value } : {}),
    ...(teeEncryptionPublicKey.value ? { [HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY_ENV]: teeEncryptionPublicKey.value } : {}),
    ...(teeDecryptionPrivateKeyFile.value ? { [HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE_ENV]: teeDecryptionPrivateKeyFile.value } : {}),
    ...(teePayloadKey.value ? { [HIVE_COMPUTE_TEE_PAYLOAD_KEY_ENV]: teePayloadKey.value } : {}),
    [HIVE_COMPUTE_WORKER_REQUIRE_PAYMENT_PROOF_ENV]: booleanSetting(mppRequireSession.value) || normalizePaymentRail(paymentRail.value) === "mpp" ? "1" : "0",
    HIVE_COMPUTE_LOCAL_ENGINE: host.backend.kind === "ollama" ? "ollama" : "openai",
    HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL: host.backend.kind === "ollama" ? "" : host.backend.host,
    OLLAMA_HOST: host.backend.kind === "ollama" ? host.backend.host : process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
    HIVE_COMPUTE_MODELS: host.advertisedModels.join(","),
    HIVE_COMPUTE_MODEL_MAP_JSON: JSON.stringify(workerModelMap(host)),
    HIVE_COMPUTE_WORKER_MAX_CONCURRENCY: String(host.config.maxConcurrency),
    HIVE_COMPUTE_WORKER_HOST_WHEN: host.config.hostWhen,
    HIVE_COMPUTE_WORKER_PAUSE_ON_BATTERY: host.config.pauseOnBattery ? "1" : "0",
    HIVE_COMPUTE_WORKER_YIELD_TO_USER: host.config.yieldToUser ? "1" : "0",
    ...(host.config.dailyCapUsd !== null ? { HIVE_COMPUTE_WORKER_DAILY_CAP_USD: String(host.config.dailyCapUsd) } : {}),
  };

  const child = spawn("npm", ["start"], {
    cwd: MODULE_DIR,
    env,
  });
  const session: HiveComputeWorkerSession = {
    child,
    output: "",
    error: "",
    status: "starting",
    startedAt: Date.now(),
  };
  const appendOutput = (chunk: Buffer) => {
    session.output = cleanOutput(`${session.output}\n${chunk.toString("utf8")}`).split(/\r?\n/).slice(-80).join("\n");
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
      `Hive Compute worker exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`,
      session.output,
    ].join("\n\n"));
  });
  globalHiveComputeState.__hivemindHiveComputeWorkerRun = session;

  await new Promise((resolve) => setTimeout(resolve, 1_200));
  if (session.status === "failed") {
    throw new HiveComputeMarketplaceError(session.error || "Hive Compute worker stopped before it could host.", 500);
  }
  session.status = "running";
  return readHiveComputeMarketplaceStatus();
}

export async function stopHiveComputeWorker() {
  const session = globalHiveComputeState.__hivemindHiveComputeWorkerRun;
  if (session && !session.child.killed) {
    session.child.kill("SIGTERM");
    session.status = "failed";
    session.error = "Stopped from the Hive Compute dashboard.";
  }
  delete globalHiveComputeState.__hivemindHiveComputeWorkerRun;
  return readHiveComputeMarketplaceStatus();
}

export async function openHiveComputeMppSession(maxUsdMicro = 1_000_000) {
  const [gatewayUrl, apiKey] = await Promise.all([
    readEnv(HIVE_COMPUTE_GATEWAY_URL_ENV),
    readEnv(HIVE_COMPUTE_API_KEY_ENV),
  ]);
  if (!gatewayUrl.value) {
    throw new HiveComputeMarketplaceError(`Set ${HIVE_COMPUTE_GATEWAY_URL_ENV} before opening an MPP session.`, 424);
  }
  if (!apiKey.value) {
    throw new HiveComputeMarketplaceError(`Set ${HIVE_COMPUTE_API_KEY_ENV} before opening an MPP session.`, 424);
  }
  const response = await fetch(joinUrl(gatewayUrl.value, "/hive-compute/mpp/sessions"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.value}`,
    },
    body: JSON.stringify({ maxUsdMicro }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  const json = parseJson(text);
  if (!response.ok || !json || typeof json !== "object") {
    throw new HiveComputeMarketplaceError(upstreamError(json, text) || `MPP session request returned HTTP ${response.status}.`, response.status || 502);
  }
  const token = String((json as { token?: unknown }).token || "").trim();
  const sessionId = String((json as { sessionId?: unknown }).sessionId || "").trim();
  if (!token || !sessionId) throw new HiveComputeMarketplaceError("MPP session response did not include a session token.", 502);
  await mkdir(MODULE_DIR, { recursive: true });
  await writeFile(HIVE_COMPUTE_MPP_SESSION_FILE, JSON.stringify({
    sessionId,
    token,
    expiresAt: (json as { expiresAt?: unknown }).expiresAt || null,
    maxUsdMicro,
    writtenAt: new Date().toISOString(),
  }, null, 2), { mode: 0o600 });
  return readHiveComputeMarketplaceStatus();
}

function cleanOutput(value: unknown) {
  return String(value ?? "").trim();
}

function selectedHostModels(models: HiveComputeHostModel[], config: HiveComputeHostRunConfig) {
  if (config.selectedModelIds === null) return models;
  const selected = new Set(config.selectedModelIds);
  return models.filter((model) => selected.has(model.providerModelId));
}

function advertisedWorkerModels(models: HiveComputeHostModel[], config: HiveComputeHostRunConfig) {
  const selectedModels = selectedHostModels(models, config);
  if (!selectedModels.length) return [];
  const ids = [
    HIVE_COMPUTE_DEFAULT_MODEL,
    "hive-compute/fast",
    "hive-compute/deep",
    ...selectedModels.map((model) => model.providerModelId),
  ];
  return Array.from(new Set(ids.filter(Boolean)));
}

function workerModelMap(host: HiveComputeHostContext) {
  const selectedModels = selectedHostModels(host.models, host.config);
  const first = selectedModels[0]?.providerModelId || HIVE_COMPUTE_DEFAULT_MODEL;
  const map: Record<string, string> = {
    [HIVE_COMPUTE_DEFAULT_MODEL]: first,
    "hive-compute/fast": first,
    "hive-compute/deep": first,
    "*": first,
  };
  for (const model of selectedModels) map[model.providerModelId] = model.providerModelId;
  return map;
}

async function writeHiveComputeRunConfig(host: HiveComputeHostContext) {
  await mkdir(MODULE_DIR, { recursive: true });
  await writeFile(HIVE_COMPUTE_RUN_CONFIG_FILE, JSON.stringify({
    config: host.config,
    backend: host.backend,
    models: host.models,
    advertisedModels: host.advertisedModels,
    writtenAt: new Date().toISOString(),
  }, null, 2), { mode: 0o600 });
}

export async function proxyHiveComputeChatCompletion(body: Record<string, unknown>, signal?: AbortSignal, requestHeaders?: Headers): Promise<Response> {
  const [
    gatewayUrl,
    openAiBaseUrl,
    apiKey,
    paymentRail,
    mppPolicyUrl,
    mppSessionToken,
    mppRequireSession,
    teeRequired,
    attestationPolicyUrl,
    teeProvider,
    teeEncryptionPublicKey,
  ] = await Promise.all([
    readEnv(HIVE_COMPUTE_GATEWAY_URL_ENV),
    readEnv(HIVE_COMPUTE_OPENAI_BASE_URL_ENV),
    readEnv(HIVE_COMPUTE_API_KEY_ENV),
    readEnv(HIVE_COMPUTE_PAYMENT_RAIL_ENV),
    readEnv(HIVE_COMPUTE_MPP_POLICY_URL_ENV),
    readMppSessionToken(),
    readEnv(HIVE_COMPUTE_MPP_REQUIRE_SESSION_ENV),
    readEnv(HIVE_COMPUTE_TEE_REQUIRED_ENV),
    readEnv(HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV),
    readEnv(HIVE_COMPUTE_TEE_PROVIDER_ENV),
    readEnv(HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY_ENV),
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
      "X-HivemindOS-Compute-Payment-Rail": normalizePaymentRail(paymentRail.value),
      ...(mppPolicyUrl.value ? { "X-HivemindOS-Compute-MPP-Policy": mppPolicyUrl.value } : {}),
      ...(mppSessionToken.value ? { "X-HivemindOS-Compute-MPP-Authorization": mppSessionToken.value } : {}),
      ...(booleanSetting(mppRequireSession.value) || normalizePaymentRail(paymentRail.value) === "mpp" ? { "X-HivemindOS-Compute-MPP-Require-Session": "true" } : {}),
      ...(booleanSetting(teeRequired.value) ? { "X-HivemindOS-Compute-Verified-Only": "true" } : {}),
      ...(attestationPolicyUrl.value ? { "X-HivemindOS-Compute-Attestation-Policy": attestationPolicyUrl.value } : {}),
      ...(teeProvider.value ? { "X-HivemindOS-Compute-TEE-Provider": teeProvider.value } : {}),
      ...(teeEncryptionPublicKey.value ? { "X-HivemindOS-Compute-TEE-Encryption-Key": teeEncryptionPublicKey.value } : {}),
      ...forwardedHiveComputePrivacyHeaders(requestHeaders),
      ...(apiKey.value ? { Authorization: `Bearer ${apiKey.value}` } : {}),
    },
    body: JSON.stringify({ ...body, model }),
    signal: signal ?? AbortSignal.timeout(MARKETPLACE_CHAT_TIMEOUT_MS),
  });
}

function forwardedHiveComputePrivacyHeaders(headers?: Headers): Record<string, string> {
  if (!headers) return {};
  const forwarded: Record<string, string> = {};
  for (const name of [
    "X-HivemindOS-Compute-Output-Encryption",
    "X-HivemindOS-Compute-Output-Public-Key",
    "X-HivemindOS-Compute-Output-Encryption-Key",
    "X-HivemindOS-Compute-Hardware-TEE-Required",
  ]) {
    const value = headers.get(name)?.trim();
    if (value) forwarded[name] = value;
  }
  return forwarded;
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

async function readMppSessionToken(): Promise<EnvRead> {
  const configured = await readEnv(HIVE_COMPUTE_MPP_SESSION_TOKEN_ENV);
  if (configured.present) return configured;
  const raw = await readFile(HIVE_COMPUTE_MPP_SESSION_FILE, "utf8").catch(() => "");
  const parsed = parseJson(raw);
  const token = parsed && typeof parsed === "object" ? String((parsed as { token?: unknown }).token || "").trim() : "";
  return token
    ? { name: HIVE_COMPUTE_MPP_SESSION_TOKEN_ENV, value: token, present: true, source: "local-session" }
    : { name: HIVE_COMPUTE_MPP_SESSION_TOKEN_ENV, value: "", present: false };
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
