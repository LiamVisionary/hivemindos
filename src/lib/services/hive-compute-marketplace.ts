import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  HIVE_COMPUTE_API_KEY_ENV,
  HIVE_COMPUTE_SELF_HOSTED_ALLOW_NONCONFIDENTIAL_ENV,
  HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV,
  HIVE_COMPUTE_CONFIDENTIAL_MODE_ENV,
  HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_TOKEN_ENV,
  HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_URL_ENV,
  HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_SIGNING_PUBLIC_KEY_ENV,
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
  HIVE_COMPUTE_WORKLOAD_MANIFEST_ENV,
  normalizeHiveComputeModel,
} from "@/lib/config/hive-compute-marketplace";
import { prepareHiveComputeConfidentialChat } from "@/lib/services/hive-compute-confidential-chat";
import {
  HIVE_COMPUTE_WORKER_SOURCE,
  hiveComputeWorkerNotice,
  hiveComputeWorkerPackageJson,
  hiveComputeWorkerReadme,
} from "@/lib/services/hive-compute-marketplace/worker-module";
import { capacityFromHealth, modelPerformanceLabel, performanceBadge, probeJsonPayload } from "@/lib/services/hive-compute-marketplace/gateway-status";
import {
  discoverHiveComputeBackend,
  isRemoteTargetIntent,
  localBackendCandidates,
} from "@/lib/services/hive-compute-marketplace/backend-discovery";
import { readHiveComputeEarningsSummary } from "@/lib/services/hive-compute-marketplace/earnings";
import {
  booleanSetting,
  envPresence,
  errorMessage,
  exists,
  joinUrl,
  parseJson,
  readEnv,
  type EnvRead,
} from "@/lib/services/hive-compute-marketplace/shared-io";
import { benchmarkHiveComputeModel } from "@/lib/services/hive-compute-benchmark";
import { isHiveComputeBenchmarkCurrent, normalizeHiveComputePricingConfig, selectHiveComputeRouteModels } from "@/lib/services/hive-compute-pricing";
import { homedir } from "@/lib/home-dir";
import type {
  HiveComputeBenchmarkFailure,
  HiveComputeBenchmarkReport,
  HiveComputeBinaryStatus,
  HiveComputeHostContext,
  HiveComputeHostDiscovery,
  HiveComputeHostModel,
  HiveComputeHostRunConfig,
  HiveComputeHostSchedule,
  HiveComputeHostTarget,
  HiveComputeInstallResult,
  HiveComputeLocalBackendStatus,
  HiveComputeMarketplaceStatus,
  HiveComputeModelOption,
  HiveComputePaymentRail,
  HiveComputeWorkerRunStatus,
} from "@/lib/types/hive-compute-marketplace";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { startLmStudioServerOnPort } from "@/lib/services/runtime-adapters/openai-compatible";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";

const execFileAsync = promisify(execFile);
const MODULE_DIR = join(homedir(), ".hivemindos", "modules", "hive-compute-worker");
const WORKER_FILE = join(MODULE_DIR, "worker.mjs");
const PACKAGE_FILE = join(MODULE_DIR, "package.json");
const README_FILE = join(MODULE_DIR, "README.md");
const NOTICE_FILE = join(MODULE_DIR, "NOTICE.md");
const NODE_MODULES_WS = join(MODULE_DIR, "node_modules", "ws");
const MARKETPLACE_CHAT_TIMEOUT_MS = 600_000;
const MARKETPLACE_STATUS_TIMEOUT_MS = 2_500;
const HIVE_COMPUTE_RUN_CONFIG_FILE = join(MODULE_DIR, "hivemind-host-config.json");
const HIVE_COMPUTE_MPP_SESSION_FILE = join(MODULE_DIR, "hivemind-mpp-session.json");

type HiveComputeWorkerSession = {
  child: ChildProcessWithoutNullStreams;
  output: string;
  error: string;
  status: "starting" | "running" | "stopped" | "failed";
  startedAt: number;
  /** Snapshot of the env used to spawn, reused for automatic respawns. */
  env: NodeJS.ProcessEnv;
  restarts: number;
  /** Set before an intentional stop so the exit handler doesn't respawn. */
  stopRequested: boolean;
};

const WORKER_MAX_AUTO_RESTARTS = 5;

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

export async function readHiveComputeMarketplaceStatus(target?: HiveComputeHostTarget | null): Promise<HiveComputeMarketplaceStatus> {
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
    target,
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
      promptPrivacy: "Official jobs require gateway-verified hardware TEE execution and renter-only output encryption; plaintext is self-hosted compatibility only.",
      confidentialCompute: "Hardware-enforced privacy requires gateway-verified TEE attestation plus encrypted prompt and output delivery. Local app state can request private routing, but it cannot prove confidential compute by itself.",
      micropayments: "x402 per-call settlement is the default machine-payment rail. MPP session settlement is enabled only when a hosted gateway exposes a Stripe/Tempo-compatible session policy.",
    },
  };
  return {
    ...status,
    models: hiveComputeModelOptions(status),
  };
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

function normalizeSchedule(value: unknown): HiveComputeHostSchedule | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const startHour = Number(record.startHour);
  const endHour = Number(record.endHour);
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return null;
  return {
    startHour: Math.min(23, Math.max(0, Math.round(startHour))),
    endHour: Math.min(23, Math.max(0, Math.round(endHour))),
  };
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
  const pricing = normalizeHiveComputePricingConfig(value);
  return {
    ...pricing,
    maxConcurrency: Math.round(clampNumber(value?.maxConcurrency, 1, 1, 256)),
    selectedModelIds: normalizeSelectedModelIds(value?.selectedModelIds),
    hostWhen: normalizeHostWhen(value?.hostWhen),
    schedule: normalizeSchedule(value?.schedule),
    dailyCapUsd: value?.dailyCapUsd === null || typeof value?.dailyCapUsd === "undefined"
      ? null
      : clampNumber(value.dailyCapUsd, 25, 1, 10_000),
    pauseOnBattery: value?.pauseOnBattery !== false,
    yieldToUser: value?.yieldToUser !== false,
  };
}

type HiveComputeRunFileRecord = Record<string, unknown> & {
  config?: unknown;
  lastBenchmark?: unknown;
  shouldRun?: unknown;
};

async function savedHiveComputeRunFile(): Promise<HiveComputeRunFileRecord | null> {
  const raw = await readFile(HIVE_COMPUTE_RUN_CONFIG_FILE, "utf8").catch(() => "");
  if (!raw) return null;
  const parsed = parseJson(raw);
  return parsed && typeof parsed === "object" ? parsed as HiveComputeRunFileRecord : null;
}

async function savedHiveComputeRunConfig() {
  const record = await savedHiveComputeRunFile();
  if (!record) return null;
  return (record.config && typeof record.config === "object"
    ? record.config
    : record) as Partial<HiveComputeHostRunConfig>;
}

function normalizeBenchmarkReport(value: unknown): HiveComputeBenchmarkReport | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const at = typeof record.at === "string" ? record.at : "";
  if (!at) return null;
  const benchmarkedModelIds = Array.isArray(record.benchmarkedModelIds)
    ? record.benchmarkedModelIds.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];
  const failures: HiveComputeBenchmarkFailure[] = Array.isArray(record.failures)
    ? record.failures.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const failure = item as Record<string, unknown>;
      const modelId = String(failure.modelId ?? "").trim();
      if (!modelId) return [];
      return [{ modelId, message: String(failure.message ?? "").trim() }];
    })
    : [];
  return { at, benchmarkedModelIds, failures };
}

async function savedHiveComputeBenchmarkReport() {
  return normalizeBenchmarkReport((await savedHiveComputeRunFile())?.lastBenchmark);
}

/** True when the worker was live at last intent (used to resume after an app restart). */
export async function savedHiveComputeShouldRun() {
  return (await savedHiveComputeRunFile())?.shouldRun === true;
}

async function installedHiveComputeWorkerVersion() {
  const raw = await readFile(PACKAGE_FILE, "utf8").catch(() => "");
  if (!raw) return "";
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object") return "";
  return String((parsed as { version?: unknown }).version || "").trim();
}

async function resolveHiveComputeRunConfig(value?: Partial<HiveComputeHostRunConfig> | null) {
  const saved = await savedHiveComputeRunConfig().catch(() => null);
  if (!value) return normalizeRunConfig(saved);
  const merged = normalizeRunConfig(value);
  // A client-provided config can carry stale modelBenchmarks (e.g. the host
  // panel benchmarking one model per request): saved measurements are the base
  // and the client's newer ones override, so a partial run never erases the
  // previous model's fresh benchmark.
  if (saved) {
    merged.modelBenchmarks = {
      ...normalizeRunConfig(saved).modelBenchmarks,
      ...merged.modelBenchmarks,
    };
  }
  return merged;
}

type HiveComputeBenchmarkRunResult = {
  config: HiveComputeHostRunConfig;
  report: HiveComputeBenchmarkReport;
};

/**
 * Benchmark the selected (or explicitly requested) models, tolerating per-model
 * failures: a model that cannot be measured is recorded in the report and
 * dropped from the advertised selection instead of blocking the whole run.
 * Throws only when no model could be measured at all.
 */
async function benchmarkHiveComputePricingConfig(
  config: HiveComputeHostRunConfig,
  options: { force: boolean; onlyModels?: string[] },
): Promise<HiveComputeBenchmarkRunResult> {
  const discovered = await discoverHiveComputeBackend(config);
  const anyReachable = discovered.backends.some((backend) => backend.reachable);
  if (!anyReachable || !discovered.models.length) {
    throw new HiveComputeMarketplaceError(
      discovered.backend.message || "Start a local model backend before benchmarking Hive Compute prices.",
      424,
    );
  }
  const selected = selectedHostModels(discovered.models, config);
  if (!selected.length) {
    throw new HiveComputeMarketplaceError("Select at least one local model before benchmarking Hive Compute prices.", 424);
  }
  const only = options.onlyModels?.length ? new Set(options.onlyModels) : null;
  const models = only ? selected.filter((model) => only.has(model.providerModelId)) : selected;
  if (!models.length) {
    throw new HiveComputeMarketplaceError("None of the requested models are in the advertised selection.", 400);
  }
  const modelBenchmarks = { ...config.modelBenchmarks };
  const failures: HiveComputeBenchmarkFailure[] = [];
  const benchmarkedModelIds: string[] = [];
  for (const model of models) {
    if (!options.force && isHiveComputeBenchmarkCurrent(modelBenchmarks[model.providerModelId])) {
      benchmarkedModelIds.push(model.providerModelId);
      continue;
    }
    const backend = discovered.backends.find(
      (candidate) => candidate.kind === model.backendKind && candidate.reachable,
    ) ?? discovered.backend;
    try {
      modelBenchmarks[model.providerModelId] = await benchmarkHiveComputeModel({
        backend,
        model: model.providerModelId,
      });
      benchmarkedModelIds.push(model.providerModelId);
    } catch (error) {
      failures.push({
        modelId: model.providerModelId,
        message: errorMessage(error, "local inference benchmark failed"),
      });
    }
  }
  if (!benchmarkedModelIds.length && failures.length) {
    throw new HiveComputeMarketplaceError(
      `Could not benchmark any selected model. First failure — ${failures[0].modelId}: ${failures[0].message}`,
      502,
    );
  }
  // Drop failing models from the advertised selection so one broken model
  // cannot block go-live; the report tells the UI what was excluded and why.
  let selectedModelIds = config.selectedModelIds;
  if (failures.length) {
    const failed = new Set(failures.map((failure) => failure.modelId));
    const baseline = selectedModelIds ?? discovered.models.map((model) => model.providerModelId);
    selectedModelIds = baseline.filter((id) => !failed.has(id));
  }
  return {
    config: { ...config, modelBenchmarks, selectedModelIds },
    report: {
      at: new Date().toISOString(),
      benchmarkedModelIds,
      failures,
    },
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
    ...(session.restarts ? { restarts: session.restarts } : {}),
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
  backendReachable: boolean;
  modelCount: number;
  advertisedModelCount: number;
}) {
  if (!params.nodeInstalled) return "Install Node.js before running the Hive Compute worker.";
  if (!params.installed) return "Install the Hive Compute worker module.";
  if (!params.depsInstalled) return "Install worker dependencies.";
  if (!params.gatewayConfigured) return `Set ${HIVE_COMPUTE_GATEWAY_URL_ENV} for the gateway that issues jobs.`;
  if (!params.workerTokenPresent) return `Set ${HIVE_COMPUTE_WORKER_TOKEN_ENV} from the gateway.`;
  if (!params.backendReachable) return params.backend.message || "Start LM Studio or Ollama so the worker has a local model backend.";
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
  target?: HiveComputeHostTarget | null;
}): Promise<HiveComputeHostContext> {
  const config = await resolveHiveComputeRunConfig(params.config);
  const [discovered, earnings, lastBenchmark] = await Promise.all([
    discoverHiveComputeBackend(config, params.target),
    readHiveComputeEarningsSummary(MODULE_DIR),
    savedHiveComputeBenchmarkReport(),
  ]);
  const advertisedModels = advertisedWorkerModels(discovered.models, config);
  const anyBackendReachable = discovered.backends.some((backend) => backend.reachable);
  const canRun = Boolean(
    params.installed &&
    params.depsInstalled &&
    params.nodeInstalled &&
    params.workerTokenPresent &&
    params.gatewayConfigured &&
    anyBackendReachable &&
    discovered.models.length &&
    advertisedModels.length,
  );
  const remoteTarget = isRemoteTargetIntent(params.target);
  const discoveredFrom: HiveComputeHostDiscovery = remoteTarget
    ? {
      remote: true,
      ...(params.target?.machineName ? { machineName: params.target.machineName } : {}),
      ...(params.target?.collectorUrl ? { collectorUrl: params.target.collectorUrl } : {}),
      ...(params.target?.location ? { location: params.target.location } : {}),
    }
    : { remote: false, ...(params.target?.machineName ? { machineName: params.target.machineName } : {}) };
  return {
    backend: discovered.backend,
    backends: discovered.backends,
    models: discovered.models,
    advertisedModels,
    config,
    canRun,
    message: hostReadinessMessage({
      ...params,
      backend: discovered.backend,
      backendReachable: anyBackendReachable,
      modelCount: discovered.models.length,
      advertisedModelCount: advertisedModels.length,
    }),
    run: currentWorkerRun(),
    discoveredFrom,
    earnings,
    lastBenchmark,
    // Remote targets would need collector systemStats; self is authoritative.
    ...(remoteTarget ? {} : { machineMemoryBytes: totalmem() }),
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
  const requestedConfig = await resolveHiveComputeRunConfig(config);
  const priced = await benchmarkHiveComputePricingConfig(requestedConfig, { force: false });
  const host = await readHiveComputeHostContext(priced.config);
  if (host.config) {
    await writeHiveComputeRunConfig(host, { lastBenchmark: priced.report });
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

export async function benchmarkHiveComputeHostingPrices(
  config?: Partial<HiveComputeHostRunConfig> | null,
  options: { onlyModels?: string[] } = {},
) {
  const requestedConfig = await resolveHiveComputeRunConfig(config);
  const priced = await benchmarkHiveComputePricingConfig(requestedConfig, {
    force: true,
    ...(options.onlyModels?.length ? { onlyModels: options.onlyModels } : {}),
  });
  const host = await readHiveComputeHostContext(priced.config);
  // A partial (per-model) run merges its result into the prior report so the
  // UI's failure list stays complete across a model-by-model setup sequence.
  const previous = options.onlyModels?.length ? await savedHiveComputeBenchmarkReport() : null;
  const report: HiveComputeBenchmarkReport = previous
    ? {
      at: priced.report.at,
      benchmarkedModelIds: Array.from(new Set([...previous.benchmarkedModelIds, ...priced.report.benchmarkedModelIds])),
      failures: [
        ...previous.failures.filter((failure) =>
          !priced.report.benchmarkedModelIds.includes(failure.modelId) &&
          !priced.report.failures.some((next) => next.modelId === failure.modelId)),
        ...priced.report.failures,
      ],
    }
    : priced.report;
  await writeHiveComputeRunConfig(host, { lastBenchmark: report });
  return readHiveComputeMarketplaceStatus();
}

/** Persist run-config edits (guardrails, pricing, selection) without requiring
 * a benchmark or go-live — the host panel debounce-saves through this. */
export async function saveHiveComputeRunConfig(config?: Partial<HiveComputeHostRunConfig> | null) {
  const host = await readHiveComputeHostContext(config);
  await writeHiveComputeRunConfig(host);
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

function lmStudioServerPort(host: string) {
  try {
    const port = new URL(host).port;
    return /^\d+$/.test(port) ? port : "1234";
  } catch {
    return "1234";
  }
}

/**
 * Start this machine's LM Studio server so its models can be advertised.
 *
 * Only ever targets the dashboard host: a remote machine's LM Studio has to be
 * started on that machine, and silently starting the local one instead would
 * misreport whose models are being hosted.
 */
export async function startHiveComputeLocalBackend(target?: HiveComputeHostTarget | null) {
  if (isRemoteTargetIntent(target)) {
    throw new Error("Hive Compute can only start LM Studio on this machine. Start it on the remote host directly.");
  }
  const lmStudio = (await localBackendCandidates()).find((candidate) => candidate.kind === "lmstudio");
  if (!lmStudio) {
    throw new Error("This machine has no LM Studio backend configured. Point HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL at it, or start Ollama instead.");
  }
  await startLmStudioServerOnPort(lmStudioServerPort(lmStudio.host)).catch((error) => {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error("LM Studio is not installed on this machine — its `lms` command line tool could not be found.");
    }
    throw error;
  });
  return readHiveComputeMarketplaceStatus(target);
}

export async function startHiveComputeWorker(config?: Partial<HiveComputeHostRunConfig> | null) {
  const existing = globalHiveComputeState.__hivemindHiveComputeWorkerRun;
  if (existing && existing.status !== "failed" && existing.status !== "stopped" && !existing.child.killed) {
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
    imageBaseUrl,
    imageApiKey,
    imageModels,
    imagePrices,
    workloadManifest,
    confidentialSidecarUrl,
    confidentialSidecarToken,
    confidentialSidecarSigningPublicKey,
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
    readEnv("HIVE_COMPUTE_LOCAL_IMAGE_BASE_URL"),
    readEnv("HIVE_COMPUTE_LOCAL_IMAGE_API_KEY"),
    readEnv("HIVE_COMPUTE_IMAGE_MODELS"),
    readEnv("HIVE_COMPUTE_IMAGE_PRICE_USD_MICRO_JSON"),
    readEnv(HIVE_COMPUTE_WORKLOAD_MANIFEST_ENV),
    readEnv(HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_URL_ENV),
    readEnv(HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_TOKEN_ENV),
    readEnv(HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_SIGNING_PUBLIC_KEY_ENV),
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

  const requestedConfig = await resolveHiveComputeRunConfig(config);
  const priced = await benchmarkHiveComputePricingConfig(requestedConfig, { force: false });
  const host = await readHiveComputeHostContext(priced.config);
  if (!host.canRun) throw new HiveComputeMarketplaceError(host.message, 424);
  await writeHiveComputeRunConfig(host, { lastBenchmark: priced.report, shouldRun: true });

  const openAiBackend = host.backends.find((backend) => backend.reachable && backend.kind !== "ollama");
  const ollamaBackend = host.backends.find((backend) => backend.reachable && backend.kind === "ollama");
  const modelEngines: Record<string, "openai" | "ollama"> = {};
  for (const model of selectedHostModels(host.models, host.config)) {
    modelEngines[model.providerModelId] = model.backendKind === "ollama" ? "ollama" : "openai";
  }

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
    HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL: openAiBackend?.host || "",
    OLLAMA_HOST: ollamaBackend?.host || process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
    HIVE_COMPUTE_MODELS: host.advertisedModels.join(","),
    HIVE_COMPUTE_MODEL_MAP_JSON: JSON.stringify(workerModelMap(host)),
    HIVE_COMPUTE_MODEL_ENGINES_JSON: JSON.stringify(modelEngines),
    HIVE_COMPUTE_MODEL_LISTINGS_JSON: JSON.stringify(workerModelListings(host)),
    HIVE_COMPUTE_WORKER_MAX_CONCURRENCY: String(host.config.maxConcurrency),
    HIVE_COMPUTE_WORKER_HOST_WHEN: host.config.hostWhen,
    ...(host.config.hostWhen === "sched" && host.config.schedule
      ? { HIVE_COMPUTE_WORKER_SCHEDULE_JSON: JSON.stringify(host.config.schedule) }
      : {}),
    HIVE_COMPUTE_WORKER_PAUSE_ON_BATTERY: host.config.pauseOnBattery ? "1" : "0",
    HIVE_COMPUTE_WORKER_YIELD_TO_USER: host.config.yieldToUser ? "1" : "0",
    ...(host.config.dailyCapUsd !== null ? { HIVE_COMPUTE_WORKER_DAILY_CAP_USD: String(host.config.dailyCapUsd) } : {}),
    // Image-modality hosting (env-configured v1): forward the shared-hive-env
    // values so a managed go-live advertises image models too.
    ...(imageBaseUrl.value ? { HIVE_COMPUTE_LOCAL_IMAGE_BASE_URL: imageBaseUrl.value } : {}),
    ...(imageApiKey.value ? { HIVE_COMPUTE_LOCAL_IMAGE_API_KEY: imageApiKey.value } : {}),
    ...(imageModels.value ? { HIVE_COMPUTE_IMAGE_MODELS: imageModels.value } : {}),
    ...(imagePrices.value ? { HIVE_COMPUTE_IMAGE_PRICE_USD_MICRO_JSON: imagePrices.value } : {}),
    ...(workloadManifest.value ? { [HIVE_COMPUTE_WORKLOAD_MANIFEST_ENV]: workloadManifest.value } : {}),
    ...(confidentialSidecarUrl.value ? { [HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_URL_ENV]: confidentialSidecarUrl.value } : {}),
    ...(confidentialSidecarToken.value ? { [HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_TOKEN_ENV]: confidentialSidecarToken.value } : {}),
    ...(confidentialSidecarSigningPublicKey.value ? { [HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_SIGNING_PUBLIC_KEY_ENV]: confidentialSidecarSigningPublicKey.value } : {}),
  };

  const session = spawnHiveComputeWorkerSession(env);
  globalHiveComputeState.__hivemindHiveComputeWorkerRun = session;

  await new Promise((resolve) => setTimeout(resolve, 1_200));
  if (session.status === "failed") {
    throw new HiveComputeMarketplaceError(session.error || "Hive Compute worker stopped before it could host.", 500);
  }
  session.status = "running";
  return readHiveComputeMarketplaceStatus();
}

function spawnHiveComputeWorkerSession(env: NodeJS.ProcessEnv): HiveComputeWorkerSession {
  const session: HiveComputeWorkerSession = {
    child: spawn("npm", ["start"], { cwd: MODULE_DIR, env }),
    output: "",
    error: "",
    status: "starting",
    startedAt: Date.now(),
    env,
    restarts: 0,
    stopRequested: false,
  };
  attachHiveComputeWorkerChild(session, session.child);
  return session;
}

function attachHiveComputeWorkerChild(session: HiveComputeWorkerSession, child: ChildProcessWithoutNullStreams) {
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
    if (session.child !== child) return;
    if (session.stopRequested) {
      session.status = "stopped";
      return;
    }
    if (session.status === "failed") return;
    // Unexpected exit: respawn with backoff so a worker crash doesn't silently
    // end hosting while the dashboard still shows it as live.
    if (session.restarts < WORKER_MAX_AUTO_RESTARTS) {
      session.restarts += 1;
      session.status = "starting";
      session.output = cleanOutput([
        session.output,
        `[hive-compute] worker exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}; restarting (attempt ${session.restarts}/${WORKER_MAX_AUTO_RESTARTS})…`,
      ].join("\n"));
      const delayMs = Math.min(30_000, 2_000 * 2 ** (session.restarts - 1));
      const timer = setTimeout(() => {
        // The session may have been intentionally stopped or replaced while waiting.
        if (globalHiveComputeState.__hivemindHiveComputeWorkerRun !== session || session.stopRequested) return;
        session.child = spawn("npm", ["start"], { cwd: MODULE_DIR, env: session.env });
        attachHiveComputeWorkerChild(session, session.child);
      }, delayMs);
      timer.unref?.();
      return;
    }
    session.status = "failed";
    session.error = cleanOutput([
      `Hive Compute worker exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""} after ${WORKER_MAX_AUTO_RESTARTS} automatic restarts.`,
      session.output,
    ].join("\n\n"));
  });
}

export async function stopHiveComputeWorker() {
  const session = globalHiveComputeState.__hivemindHiveComputeWorkerRun;
  if (session) {
    session.stopRequested = true;
    if (!session.child.killed) session.child.kill("SIGTERM");
    session.status = "stopped";
    session.error = "";
    session.output = cleanOutput(`${session.output}\n[hive-compute] stopped from the Hive Compute dashboard.`);
  }
  await updateHiveComputeRunFile({ shouldRun: false });
  return readHiveComputeMarketplaceStatus();
}

/**
 * Restart the worker after an app-server restart when the saved intent says it
 * should be live. Called from the boot hook via the marketplace API route; a
 * no-op when hosting was stopped intentionally or is already running.
 */
export async function resumeHiveComputeWorker() {
  if (!(await savedHiveComputeShouldRun())) return readHiveComputeMarketplaceStatus();
  const existing = globalHiveComputeState.__hivemindHiveComputeWorkerRun;
  if (existing && (existing.status === "running" || existing.status === "starting")) {
    return readHiveComputeMarketplaceStatus();
  }
  return startHiveComputeWorker();
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
  const routes = selectHiveComputeRouteModels(selectedModels.map((model) => ({
    id: model.providerModelId,
    price: {
      inputUsdMicroPerMTok: model.inputPer1m,
      outputUsdMicroPerMTok: model.outputPer1m,
      minimumJobUsdMicro: model.minimumJobUsdMicro,
    },
    benchmark: model.benchmark,
  })));
  const fallback = routes.auto || selectedModels[0]?.providerModelId || HIVE_COMPUTE_DEFAULT_MODEL;
  const map: Record<string, string> = {
    [HIVE_COMPUTE_DEFAULT_MODEL]: routes.auto || fallback,
    "hive-compute/fast": routes.fast || fallback,
    "hive-compute/deep": routes.deep || fallback,
    "*": fallback,
  };
  for (const model of selectedModels) map[model.providerModelId] = model.providerModelId;
  return map;
}

function workerModelListings(host: HiveComputeHostContext) {
  const selectedModels = selectedHostModels(host.models, host.config);
  const modelById = new Map(selectedModels.map((model) => [model.providerModelId, model]));
  const modelMap = workerModelMap(host);
  const listings = host.advertisedModels.flatMap((advertisedModel) => {
    const providerModelId = modelMap[advertisedModel] || advertisedModel;
    const model = modelById.get(providerModelId);
    if (!model) return [];
    return [{
      model: advertisedModel,
      inputUsdMicroPerMTok: model.inputPer1m,
      outputUsdMicroPerMTok: model.outputPer1m,
      minimumJobUsdMicro: model.minimumJobUsdMicro,
      ...(model.benchmark ? { benchmark: model.benchmark } : {}),
    }];
  });
  return Array.from(new Map(listings.map((listing) => [listing.model, listing])).values());
}

async function updateHiveComputeRunFile(patch: Record<string, unknown>) {
  const existing = await savedHiveComputeRunFile() ?? {};
  await mkdir(MODULE_DIR, { recursive: true });
  await writeFile(HIVE_COMPUTE_RUN_CONFIG_FILE, JSON.stringify({
    ...existing,
    ...patch,
    writtenAt: new Date().toISOString(),
  }, null, 2), { mode: 0o600 });
}

async function writeHiveComputeRunConfig(host: HiveComputeHostContext, extras: Record<string, unknown> = {}) {
  await updateHiveComputeRunFile({
    config: host.config,
    backend: host.backend,
    backends: host.backends,
    models: host.models,
    advertisedModels: host.advertisedModels,
    ...extras,
  });
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
    allowNonConfidential,
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
    readEnv(HIVE_COMPUTE_SELF_HOSTED_ALLOW_NONCONFIDENTIAL_ENV),
  ]);
  const openAiBase = openAiBaseUrl.value || (gatewayUrl.value ? joinUrl(gatewayUrl.value, "/v1") : "");
  if (!openAiBase) {
    throw new HiveComputeMarketplaceError(
      `Set ${HIVE_COMPUTE_GATEWAY_URL_ENV} or ${HIVE_COMPUTE_OPENAI_BASE_URL_ENV} before routing Hive Compute inference jobs.`,
      424,
    );
  }
  const model = normalizeHiveComputeModel(String(body.model || HIVE_COMPUTE_DEFAULT_MODEL));
  const confidential = booleanSetting(allowNonConfidential.value) && isExplicitSelfHostedHiveComputeUrl(openAiBase)
    ? null
    : await prepareHiveComputeConfidentialChat();
  const upstream = await fetch(joinUrl(openAiBase, "/chat/completions"), {
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
      ...(confidential?.headers ?? {}),
      ...(apiKey.value ? { Authorization: `Bearer ${apiKey.value}` } : {}),
    },
    body: JSON.stringify({ ...body, model }),
    signal: signal ?? AbortSignal.timeout(MARKETPLACE_CHAT_TIMEOUT_MS),
  });
  return confidential ? confidential.decryptResponse(upstream) : upstream;
}

function isExplicitSelfHostedHiveComputeUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname !== "hivemindos-compute-gateway.hivemindos.workers.dev" && !hostname.endsWith(".hivemindos.com");
  } catch {
    return false;
  }
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
