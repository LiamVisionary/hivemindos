import {
  HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV,
  HIVE_COMPUTE_CONFIDENTIAL_MODE_ENV,
  HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_TOKEN_ENV,
  HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_URL_ENV,
  HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_SIGNING_PUBLIC_KEY_ENV,
  HIVE_COMPUTE_DEFAULT_MODEL,
  HIVE_COMPUTE_GATEWAY_URL_ENV,
  HIVE_COMPUTE_MPP_POLICY_URL_ENV,
  HIVE_COMPUTE_MPP_REQUIRE_SESSION_ENV,
  HIVE_COMPUTE_MPP_SESSION_TOKEN_ENV,
  HIVE_COMPUTE_PAYMENT_RAIL_ENV,
  HIVE_COMPUTE_PRODUCT_NAME,
  HIVE_COMPUTE_TEE_ATTESTATION_COMMAND_ENV,
  HIVE_COMPUTE_TEE_ATTESTATION_FILE_ENV,
  HIVE_COMPUTE_TEE_ATTESTATION_FORMAT_ENV,
  HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE_ENV,
  HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY_ENV,
  HIVE_COMPUTE_TEE_IMAGE_DIGEST_ENV,
  HIVE_COMPUTE_TEE_MEASUREMENT_ENV,
  HIVE_COMPUTE_TEE_PAYLOAD_KEY_ENV,
  HIVE_COMPUTE_TEE_PROVIDER_ENV,
  HIVE_COMPUTE_WORKER_PACKAGE_NAME,
  HIVE_COMPUTE_WORKER_REQUIRE_PAYMENT_PROOF_ENV,
  HIVE_COMPUTE_WORKER_VERSION,
  HIVE_COMPUTE_WORKER_TOKEN_ENV,
  HIVE_COMPUTE_WORKLOAD_MANIFEST_ENV,
} from "@/lib/config/hive-compute-marketplace";

export function hiveComputeWorkerPackageJson() {
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

export function hiveComputeWorkerReadme() {
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
- HIVE_COMPUTE_MODEL_ENGINES_JSON: optional JSON mapping local model ids to
  \`openai\` or \`ollama\` so one worker can serve both backends at once.
- HIVE_COMPUTE_WORKER_HOST_WHEN: \`idle\` (default), \`always\`, or \`sched\`.
  Idle-only hosting refuses jobs while the machine is in use (macOS/Linux
  input-idle detection; unsupported platforms never block).
- HIVE_COMPUTE_WORKER_SCHEDULE_JSON: optional \`{"startHour":22,"endHour":8}\`
  local-time window enforced when HOST_WHEN is \`sched\`.
- HIVE_COMPUTE_WORKER_PAUSE_ON_BATTERY: set to \`1\` to refuse jobs while the
  machine reports it is running on battery power.
- HIVE_COMPUTE_WORKER_YIELD_TO_USER: set to \`1\` to refuse new jobs while the
  user is actively using the machine.
- HIVE_COMPUTE_WORKER_DAILY_CAP_USD: optional daily earnings cap; once the
  local earnings summary reaches it (UTC day), new jobs are refused.
- ${HIVE_COMPUTE_WORKLOAD_MANIFEST_ENV}: versioned JSON manifest of typed
  image, video, audio, music, speech, 3D, embedding, rerank, or custom-model
  offerings. Every offering uses the confidential-sidecar adapter, encrypted
  input, renter-key output encryption, progress, cancellation, and HIVEART1
  length-prefixed encrypted artifact streams.
- ${HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_URL_ENV}: loopback URL of the attested
  confidential executor. The outer worker forwards only ciphertext, signed
  upload grants, progress, cancellation, and ciphertext artifact manifests.
- ${HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_TOKEN_ENV}: optional bearer token for the
  loopback confidential executor. It is never sent to the marketplace gateway.
- HIVE_COMPUTE_IMAGE_MODELS and HIVE_COMPUTE_IMAGE_PRICE_USD_MICRO_JSON remain
  image-v1 migration inputs only. They create confidential-sidecar offerings
  only when the sidecar is configured; the retired plaintext image backend is
  never advertised by the official worker.

The worker enforces every guardrail above locally before accepting a job (it
does not rely on the gateway honoring advertised limits), and it keeps a local
\`earnings-summary.json\` next to worker.mjs recording per-day and per-model
earnings received from the gateway — the dashboard reads it for actual (not
projected) earnings.
- HIVE_COMPUTE_MODEL_LISTINGS_JSON: authenticated per-model input/output prices,
  optional minimum-job prices, and local benchmark receipts advertised to the
  gateway. The gateway validates all values against its official bounds.
- HIVE_COMPUTE_DEFAULT_OPENAI_MODEL: optional default local model for
  OpenAI-compatible mode.
- HIVE_COMPUTE_WORKER_WS_PATH: optional, defaults to /hive-compute/worker/ws.
- HIVE_COMPUTE_WORKER_MAX_CONCURRENCY: optional advertised concurrency limit.
- ${HIVE_COMPUTE_PAYMENT_RAIL_ENV}: \`x402\`, \`mpp\`, \`prepaid\`, or
  \`self-hosted\`.
- ${HIVE_COMPUTE_MPP_POLICY_URL_ENV}: optional hosted MPP session policy URL.
- ${HIVE_COMPUTE_MPP_SESSION_TOKEN_ENV}: optional session authorization from a
  compatible gateway.
- ${HIVE_COMPUTE_MPP_REQUIRE_SESSION_ENV}: set to \`1\` to reject jobs without
  MPP session proof.
- ${HIVE_COMPUTE_CONFIDENTIAL_MODE_ENV}: optional, set to \`tee-attested\` only
  when this worker runs inside a verifiable confidential-compute runtime.
- ${HIVE_COMPUTE_TEE_PROVIDER_ENV}: optional provider label such as \`sev-snp\`,
  \`tdx\`, \`nitro\`, or \`nvidia-cc\`.
- ${HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV}: optional hosted attestation policy
  used by compatible gateways for verified-only routing.
- ${HIVE_COMPUTE_TEE_ATTESTATION_FILE_ENV}: optional TEE evidence/quote file.
- ${HIVE_COMPUTE_TEE_ATTESTATION_COMMAND_ENV}: optional command that emits fresh
  attestation evidence. The worker passes the challenge nonce in
  \`HIVE_COMPUTE_TEE_NONCE\` and the full server challenge in
  \`HIVE_COMPUTE_TEE_CHALLENGE_JSON\` so the hardware report can bind the job,
  model, modality, renter output key, enclave input key, and completion key.
- ${HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY_ENV}: public key advertised to the
  gateway for encrypted prompt delivery.
- ${HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE_ENV}: optional RSA-OAEP or
  X25519 private key PEM path for encrypted job payloads.
- ${HIVE_COMPUTE_TEE_PAYLOAD_KEY_ENV}: optional sealed symmetric AES-256-GCM key
  for encrypted job payloads.

Ordinary compatibility chat is non-confidential and must be explicitly enabled
only by a self-hosted gateway. Official jobs require gateway-verified hardware
attestation. Typed workload jobs are forwarded to the confidential sidecar
without decrypting their inputs or materializing their generated outputs.

## Run

\`\`\`sh
npm install --omit=dev
hive-env-run -- npm start
\`\`\`
`;
}

export function hiveComputeWorkerNotice() {
  return `Hive Compute Worker

Generated by HivemindOS as an optional installable module. It implements a
small native WebSocket worker protocol compatible with Hive Compute gateways,
with local Ollama and OpenAI-compatible serving adapters.
TEE privacy, x402 settlement, MPP sessions, bonds, payouts, and reputation are
gateway-side capabilities. This worker can enforce gateway-supplied payment
proofs, collect remote-attestation evidence, decrypt encrypted payloads, and
encrypt response output when the enclosing runtime supplies enclave keys.
The public HivemindOS app contains no official marketplace ledger, payout,
quota, entitlement, treasury, or fraud-control authority; official authority
belongs in hosted HivemindOS infrastructure or in a self-hosted operator's own
gateway.
`;
}

export const HIVE_COMPUTE_WORKER_SOURCE = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { constants, createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const chatAdvertisedModels = splitList(process.env.HIVE_COMPUTE_MODELS || "${HIVE_COMPUTE_DEFAULT_MODEL},hive-compute/fast");
const modelMap = parseModelMap(process.env.HIVE_COMPUTE_MODEL_MAP_JSON || "");
const modelEngines = parseModelMap(process.env.HIVE_COMPUTE_MODEL_ENGINES_JSON || "");
const chatModelListings = parseModelListings(process.env.HIVE_COMPUTE_MODEL_LISTINGS_JSON || "");
const wsPath = process.env.HIVE_COMPUTE_WORKER_WS_PATH || "/hive-compute/worker/ws";
const maxConcurrency = positiveInteger(process.env.HIVE_COMPUTE_WORKER_MAX_CONCURRENCY, 1);
const hostWhen = process.env.HIVE_COMPUTE_WORKER_HOST_WHEN || "idle";
const schedule = parseSchedule(process.env.HIVE_COMPUTE_WORKER_SCHEDULE_JSON || "");
const pauseOnBattery = booleanEnv(process.env.HIVE_COMPUTE_WORKER_PAUSE_ON_BATTERY, false);
const yieldToUser = booleanEnv(process.env.HIVE_COMPUTE_WORKER_YIELD_TO_USER, false);
const dailyCapUsd = Number(process.env.HIVE_COMPUTE_WORKER_DAILY_CAP_USD || "") || 0;
// Guardrail probes: only these platforms have a working detector; elsewhere the
// guardrail never blocks and the heartbeat reports it as unsupported.
const idleDetectionSupported = process.platform === "darwin" || process.platform === "linux";
const batteryDetectionSupported = process.platform === "darwin" || process.platform === "linux" || process.platform === "win32";
const IDLE_ONLY_MIN_IDLE_SECONDS = 300;
const YIELD_MIN_IDLE_SECONDS = 15;
// Typed non-chat workloads never run in this ordinary relay. The relay forwards
// ciphertext and upload grants to a separately attested confidential sidecar.
const confidentialSidecarUrl = (process.env.${HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_URL_ENV} || "").replace(/\\/+$/, "");
const confidentialSidecarToken = process.env.${HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_TOKEN_ENV} || "";
const confidentialSidecarSigningPublicKey = (process.env.${HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_SIGNING_PUBLIC_KEY_ENV} || "").replace(/\\\\n/g, "\\n");
const imageModels = splitList(process.env.HIVE_COMPUTE_IMAGE_MODELS || "");
const imagePriceByModel = parseModelMap(process.env.HIVE_COMPUTE_IMAGE_PRICE_USD_MICRO_JSON || "");
const DEFAULT_IMAGE_PRICE_USD_MICRO = 20000;
const CONFIDENTIAL_WORKLOADS = new Set(["image", "video", "audio", "music", "speech", "3d", "embedding", "rerank", "custom"]);
const ARTIFACT_WORKLOADS = new Set(["image", "video", "audio", "music", "speech", "3d"]);
const WORKLOAD_BILLING_UNITS = new Set(["image", "second", "frame", "megapixel", "sample", "artifact", "job", "gpu-second"]);
const SAFE_WORKLOAD_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SAFE_TASK = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SAFE_MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const workloadManifest = parseWorkloadManifest(process.env.${HIVE_COMPUTE_WORKLOAD_MANIFEST_ENV} || "", {
  imageModels,
  imagePriceByModel,
  sidecarConfigured: Boolean(confidentialSidecarUrl),
});
const workloadOfferings = workloadManifest.offerings;
const MODALITIES = Array.from(new Set(["chat", ...workloadOfferings.map((offering) => offering.workload)]));
const advertisedModels = Array.from(new Set([...chatAdvertisedModels, ...workloadOfferings.map((offering) => offering.model)]));
const modelListings = [
  ...chatModelListings.map((listing) => ({
    ...listing,
    modality: "chat",
    privacy: { hostConfidentialOutput: false },
  })),
  ...workloadOfferings.map(workloadListing),
];
const SUMMARY_FILE = join(dirname(fileURLToPath(import.meta.url)), "earnings-summary.json");
const activeJobs = new Map();
const jobModelById = new Map();
const paymentRail = normalizeRail(process.env.${HIVE_COMPUTE_PAYMENT_RAIL_ENV} || "x402");
const mppPolicyUrl = process.env.${HIVE_COMPUTE_MPP_POLICY_URL_ENV} || "";
const mppSessionToken = process.env.${HIVE_COMPUTE_MPP_SESSION_TOKEN_ENV} || "";
const mppRequireSession = booleanEnv(process.env.${HIVE_COMPUTE_MPP_REQUIRE_SESSION_ENV}, paymentRail === "mpp");
const requirePaymentProof = booleanEnv(process.env.${HIVE_COMPUTE_WORKER_REQUIRE_PAYMENT_PROOF_ENV}, mppRequireSession || paymentRail === "mpp");
const confidentialMode = process.env.${HIVE_COMPUTE_CONFIDENTIAL_MODE_ENV} || "standard";
const teeProvider = process.env.${HIVE_COMPUTE_TEE_PROVIDER_ENV} || "";
const attestationPolicyUrl = process.env.${HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV} || "";
const attestationFile = process.env.${HIVE_COMPUTE_TEE_ATTESTATION_FILE_ENV} || "";
const attestationCommand = process.env.${HIVE_COMPUTE_TEE_ATTESTATION_COMMAND_ENV} || "";
const attestationFormat = process.env.${HIVE_COMPUTE_TEE_ATTESTATION_FORMAT_ENV} || "raw";
const teeMeasurement = process.env.${HIVE_COMPUTE_TEE_MEASUREMENT_ENV} || "";
const teeImageDigest = process.env.${HIVE_COMPUTE_TEE_IMAGE_DIGEST_ENV} || "";
const teeEncryptionPublicKey = process.env.${HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY_ENV} || "";
const teePrivateKeyFile = process.env.${HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE_ENV} || "";
const teePayloadKey = process.env.${HIVE_COMPUTE_TEE_PAYLOAD_KEY_ENV} || "";
let socket = null;
let reconnectDelayMs = 1000;

connect();

const registerInterval = setInterval(() => void register(), 30000);
registerInterval.unref && registerInterval.unref();
const heartbeatInterval = setInterval(sendHeartbeat, 15000);
heartbeatInterval.unref && heartbeatInterval.unref();

function sendHeartbeat() {
  emit("worker.heartbeat", {
    workerId,
    workerName,
    models: advertisedModels,
    listings: modelListings,
    engine: localEngine,
    localBaseUrl: localEngine === "openai" ? openAiBaseUrl : ollamaHost,
    capabilities: workerCapabilities(),
    availability: workerAvailability(),
    version: VERSION,
    at: new Date().toISOString(),
  });
}

function connect() {
  const url = websocketUrl(joinUrl(gateway, wsPath));
  socket = new WebSocket(url, {
    headers: { Authorization: "Bearer " + token },
  });

  socket.on("open", () => {
    reconnectDelayMs = 1000;
    void register();
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
  if (message.type === "server.ready" || message.type === "worker.registered" || message.type === "worker.attestation.accepted") return;
  if (message.type === "worker.attestation.challenge" || message.type === "attestation.challenge") {
    const challenge = message.payload && typeof message.payload === "object" ? message.payload : {};
    emit("worker.attestation", { workerId, attestation: collectAttestation(challenge) });
    return;
  }
  if (message.type === "job.attestation.challenge") {
    const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
    emit("job.attestation", { jobId: String(payload.jobId || ""), workerId, ...collectAttestation(payload) });
    return;
  }
  if (message.type === "job.assign") {
    const assignedJobId = message.payload && typeof message.payload === "object"
      ? String(message.payload.jobId || message.payload.id || "")
      : "";
    // Guardrails are enforced here, not just advertised: capacity, daily cap,
    // schedule window, battery, and user-activity checks all run before the
    // job is accepted, and a refusal tells the gateway to reroute.
    const refusal = jobRefusalReason();
    if (refusal) {
      console.log("[hive-compute] refused job", assignedJobId || "(unknown)", "-", refusal);
      if (assignedJobId) emit("job.error", { jobId: assignedJobId, error: "worker-unavailable: " + refusal, refused: true });
      sendHeartbeat();
      return;
    }
    try {
      await runJob(message.payload);
    } catch (error) {
      emitJobError(message.payload && message.payload.jobId, error);
    }
    return;
  }
  if (message.type === "job.cancel") {
    const canceledJobId = message.payload && typeof message.payload === "object"
      ? String(message.payload.jobId || message.payload.id || "")
      : "";
    if (canceledJobId) await cancelActiveJob(canceledJobId);
    return;
  }
  if (message.type === "worker.earning") {
    const earning = message.payload;
    if (!earning || typeof earning !== "object") return;
    const earnedUsdMicro = Math.max(0, Math.round(Number(earning.usdMicro) || 0));
    if (earnedUsdMicro > 0) recordEarning(String(earning.jobId || ""), earnedUsdMicro);
    const amount = earning.usdMicro ? "$" + (Number(earning.usdMicro) / 1_000_000).toFixed(6) : "pending";
    console.log("[hive-compute] earning", earning.jobId || "", amount);
    return;
  }
  if (message.type === "server.error") {
    console.error("[hive-compute] server error:", JSON.stringify(message.payload || {}));
  }
}

async function register() {
  emit("worker.register", {
    workerId,
    workerName,
    models: advertisedModels,
    listings: modelListings,
    capabilities: workerCapabilities(),
    version: VERSION,
  });
}

function workerCapabilities() {
  const attestation = collectAttestation("");
  return {
    chat: true,
    streaming: true,
    modalities: MODALITIES,
    workloadProtocol: "hive-compute.workload.v1",
    workloadOfferings,
    engine: localEngine,
    maxConcurrency,
    hostWhen,
    guardrails: {
      hostWhen,
      schedule,
      pauseOnBattery,
      yieldToUser,
      dailyCapUsd: dailyCapUsd > 0 ? dailyCapUsd : null,
      idleDetectionSupported,
      batteryDetectionSupported,
    },
    payments: {
      x402: true,
      mpp: Boolean(mppPolicyUrl || mppSessionToken || paymentRail === "mpp"),
      mppPolicyUrl,
      requireSession: mppRequireSession,
    },
    privacy: {
      mode: confidentialMode,
      provider: teeProvider,
      teeAttestation: attestation.ready,
      encryptedPromptDelivery: Boolean(teeEncryptionPublicKey && confidentialSidecarUrl),
      encryptedOutputDelivery: true,
      completionSigningPublicKey: confidentialSidecarSigningPublicKey || undefined,
      completionSigningPublicKeySha256: confidentialSidecarSigningPublicKey ? sha256(confidentialSidecarSigningPublicKey) : undefined,
      hostConfidentialOutput: false,
      confidentialSidecar: {
        configured: Boolean(confidentialSidecarUrl),
        attested: attestation.ready,
        workloads: workloadOfferings.map((offering) => offering.workload),
      },
      attestationPolicyUrl,
      encryptionPublicKey: teeEncryptionPublicKey,
      attestation,
    },
  };
}

function workerAvailability() {
  const reason = jobRefusalReason();
  return {
    accepting: !reason,
    activeJobs: activeJobs.size,
    maxConcurrency,
    ...(reason ? { reason } : {}),
  };
}

// ---- guardrail enforcement -------------------------------------------------

function jobRefusalReason() {
  if (activeJobs.size >= maxConcurrency) {
    return "at capacity (" + activeJobs.size + "/" + maxConcurrency + " slots busy)";
  }
  if (dailyCapUsd > 0 && todayEarnedUsdMicro() >= dailyCapUsd * 1000000) {
    return "daily earnings cap reached ($" + dailyCapUsd + ")";
  }
  if (hostWhen === "sched" && !withinSchedule()) {
    return "outside the scheduled hosting window";
  }
  if (pauseOnBattery && onBatteryPower() === true) {
    return "paused on battery power";
  }
  const idle = userIdleSeconds();
  if (hostWhen === "idle" && idle !== null && idle < IDLE_ONLY_MIN_IDLE_SECONDS) {
    return "host is idle-only and the machine is in use";
  }
  if (yieldToUser && idle !== null && idle < YIELD_MIN_IDLE_SECONDS) {
    return "yielding to user activity";
  }
  return "";
}

function parseSchedule(raw) {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    const startHour = Number(parsed && parsed.startHour);
    const endHour = Number(parsed && parsed.endHour);
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return null;
    return {
      startHour: Math.max(0, Math.min(23, Math.round(startHour))),
      endHour: Math.max(0, Math.min(23, Math.round(endHour))),
    };
  } catch {
    return null;
  }
}

// Window is [startHour, endHour) in this machine's local time; endHour below
// startHour wraps past midnight, equal hours mean all day.
function withinSchedule() {
  if (!schedule) return true;
  const hour = new Date().getHours();
  if (schedule.startHour === schedule.endHour) return true;
  if (schedule.startHour < schedule.endHour) return hour >= schedule.startHour && hour < schedule.endHour;
  return hour >= schedule.startHour || hour < schedule.endHour;
}

let batteryCheckedAt = 0;
let batteryDischarging = null;
// true = on battery, false = plugged in, null = undetectable on this platform.
function onBatteryPower() {
  if (!batteryDetectionSupported) return null;
  const now = Date.now();
  if (now - batteryCheckedAt < 30000) return batteryDischarging;
  batteryCheckedAt = now;
  try {
    if (process.platform === "darwin") {
      const result = spawnSync("pmset", ["-g", "batt"], { timeout: 1500 });
      const out = result.stdout ? result.stdout.toString() : "";
      batteryDischarging = out ? /Battery Power/i.test(out) : null;
    } else if (process.platform === "linux") {
      const result = spawnSync("sh", ["-c", "cat /sys/class/power_supply/BAT*/status 2>/dev/null | head -1"], { timeout: 1500 });
      const out = result.stdout ? result.stdout.toString().trim() : "";
      batteryDischarging = out ? /discharging/i.test(out) : null;
    } else if (process.platform === "win32") {
      const result = spawnSync("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_Battery).BatteryStatus"], { timeout: 5000 });
      const out = result.stdout ? result.stdout.toString().trim() : "";
      batteryDischarging = out ? out.split(/\\s+/).includes("1") : null;
    } else {
      batteryDischarging = null;
    }
  } catch {
    batteryDischarging = null;
  }
  return batteryDischarging;
}

let idleCheckedAt = 0;
let idleSecondsCache = null;
// Seconds since last user input, or null when undetectable on this platform.
function userIdleSeconds() {
  if (!idleDetectionSupported) return null;
  const now = Date.now();
  if (now - idleCheckedAt < 5000) return idleSecondsCache;
  idleCheckedAt = now;
  try {
    if (process.platform === "darwin") {
      const result = spawnSync("sh", ["-c", "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF/1000000000; exit}'"], { timeout: 1500 });
      const out = result.stdout ? result.stdout.toString().trim() : "";
      const parsed = Number(out);
      idleSecondsCache = out && Number.isFinite(parsed) ? parsed : null;
    } else if (process.platform === "linux") {
      const result = spawnSync("xprintidle", [], { timeout: 1500 });
      const out = result.stdout ? result.stdout.toString().trim() : "";
      idleSecondsCache = /^\\d+$/.test(out) ? Number(out) / 1000 : null;
    } else {
      idleSecondsCache = null;
    }
  } catch {
    idleSecondsCache = null;
  }
  return idleSecondsCache;
}

// ---- local earnings summary --------------------------------------------------
// The worker is the only writer of earnings-summary.json; the dashboard reads
// it to show actual (not projected) earnings, and the daily cap reads it too.

const earnings = loadEarningsSummary();

function loadEarningsSummary() {
  try {
    const parsed = JSON.parse(readFileSync(SUMMARY_FILE, "utf8"));
    if (parsed && typeof parsed === "object") {
      return {
        version: 1,
        totalUsdMicro: Math.max(0, Math.round(Number(parsed.totalUsdMicro) || 0)),
        totalJobs: Math.max(0, Math.round(Number(parsed.totalJobs) || 0)),
        days: parsed.days && typeof parsed.days === "object" ? parsed.days : {},
        models: parsed.models && typeof parsed.models === "object" ? parsed.models : {},
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      };
    }
  } catch {
    // Missing or invalid file: start a fresh summary.
  }
  return { version: 1, totalUsdMicro: 0, totalJobs: 0, days: {}, models: {}, recent: [], updatedAt: "" };
}

function utcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function bumpTotals(map, key, usdMicro, jobs) {
  if (!key) return;
  const entry = map[key] || (map[key] = { usdMicro: 0, jobs: 0 });
  entry.usdMicro = Math.max(0, Math.round(Number(entry.usdMicro) || 0)) + usdMicro;
  entry.jobs = Math.max(0, Math.round(Number(entry.jobs) || 0)) + jobs;
}

function todayEarnedUsdMicro() {
  const today = earnings.days[utcDayKey()];
  return today ? Math.max(0, Math.round(Number(today.usdMicro) || 0)) : 0;
}

function recordJobCompleted(model) {
  earnings.totalJobs += 1;
  bumpTotals(earnings.days, utcDayKey(), 0, 1);
  bumpTotals(earnings.models, model, 0, 1);
  scheduleEarningsFlush();
}

function recordEarning(jobId, usdMicro) {
  const model = jobModelById.get(jobId) || undefined;
  earnings.totalUsdMicro += usdMicro;
  bumpTotals(earnings.days, utcDayKey(), usdMicro, 0);
  bumpTotals(earnings.models, model, usdMicro, 0);
  earnings.recent.push({ at: new Date().toISOString(), jobId, model, usdMicro });
  if (earnings.recent.length > 100) earnings.recent = earnings.recent.slice(-100);
  pruneEarnings();
  scheduleEarningsFlush();
}

function pruneEarnings() {
  const dayKeys = Object.keys(earnings.days).sort();
  while (dayKeys.length > 90) delete earnings.days[dayKeys.shift()];
  const modelKeys = Object.keys(earnings.models);
  if (modelKeys.length > 50) {
    modelKeys
      .sort((left, right) => (Number(earnings.models[left].usdMicro) || 0) - (Number(earnings.models[right].usdMicro) || 0))
      .slice(0, modelKeys.length - 50)
      .forEach((key) => delete earnings.models[key]);
  }
}

let earningsFlushTimer = null;
function scheduleEarningsFlush() {
  earnings.updatedAt = new Date().toISOString();
  if (earningsFlushTimer) return;
  earningsFlushTimer = setTimeout(() => {
    earningsFlushTimer = null;
    writeFile(SUMMARY_FILE, JSON.stringify(earnings, null, 2)).catch((error) => {
      console.error("[hive-compute] could not persist earnings summary:", error instanceof Error ? error.message : String(error));
    });
  }, 500);
  earningsFlushTimer.unref && earningsFlushTimer.unref();
}

function engineForModel(localModel) {
  const engine = modelEngines[localModel];
  return engine === "ollama" || engine === "openai" ? engine : localEngine;
}

async function runJob(job) {
  if (!job || typeof job !== "object") throw new Error("Invalid job assignment.");
  validateJobPayment(job);
  const jobId = String(job.jobId || job.id || "");
  if (!jobId) throw new Error("Job assignment is missing jobId.");
  const kind = normalizeWorkloadKind(job.kind || job.workload);
  const routeModel = String(job.model || advertisedModels[0] || "${HIVE_COMPUTE_DEFAULT_MODEL}");
  const offering = workloadOfferings.find((candidate) => candidate.workload === kind && candidate.model === routeModel);
  if (kind !== "chat") {
    if (!offering) throw new Error("This worker did not advertise the assigned confidential workload.");
    return runConfidentialSidecarJob({ jobId, job, offering });
  }
  const requestedPrivacy = job.privacy && typeof job.privacy === "object" ? job.privacy : {};
  if (requestedPrivacy.hardwareTeeRequired === true || requestedPrivacy.verifiedOnly === true) {
    return runConfidentialSidecarJob({
      jobId,
      job,
      offering: {
        model: routeModel,
        workload: "chat",
        descriptor: { protocol: "hive-compute.chat-confidential.v1", kind: "chat", model: routeModel },
      },
    });
  }

  const normalizedJob = normalizeEncryptedJob(job);
  const localModel = modelMap[routeModel] || modelMap["*"] || defaultLocalModel(routeModel);
  const engine = engineForModel(localModel);
  const outputEncryption = outputEncryptionFromJob(normalizedJob);
  console.log("[hive-compute] job", jobId, kind, routeModel, "->", localModel, "(" + engine + ")");
  emit("job.accepted", { jobId, workerId, model: routeModel, localModel, engine, kind });

  const abortController = new AbortController();
  activeJobs.set(jobId, { model: routeModel, localModel, kind, startedAt: Date.now(), abortController, canceled: false });
  jobModelById.set(jobId, localModel);
  while (jobModelById.size > 200) {
    jobModelById.delete(jobModelById.keys().next().value);
  }
  try {
    if (engine === "openai") {
      const messages = normalizeMessages(normalizedJob);
      await runOpenAICompatibleJob({ jobId, localModel, messages, options: normalizedJob.options, outputEncryption, signal: abortController.signal });
    } else {
      const messages = normalizeMessages(normalizedJob);
      await runOllamaJob({ jobId, localModel, messages, options: normalizedJob.options, outputEncryption, signal: abortController.signal });
    }
    recordJobCompleted(localModel);
  } finally {
    activeJobs.delete(jobId);
  }
}

async function runConfidentialSidecarJob(input) {
  const { jobId, job, offering } = input;
  const attestation = collectAttestation("");
  if (!confidentialSidecarUrl || !attestation.ready) {
    throw new Error("Confidential workload refused: an attested confidential sidecar is required.");
  }
  const encryptedPayload = job.encryptedPayload || job.encrypted_payload;
  if (!encryptedPayload || typeof encryptedPayload !== "object") {
    throw new Error("Confidential workload refused: encrypted input is required.");
  }
  const privacy = job.privacy && typeof job.privacy === "object" ? job.privacy : {};
  const workload = job.workload && typeof job.workload === "object" ? job.workload : {};
  const outputEncryption = privacy.outputEncryption && typeof privacy.outputEncryption === "object" ? privacy.outputEncryption : {};
  if (outputEncryption.required !== true || !outputEncryption.publicKey || !outputEncryption.publicKeySha256) {
    throw new Error("Confidential workload refused: renter-key output encryption is required.");
  }
  const artifactUploads = Array.isArray(workload.artifactUploads) ? workload.artifactUploads : [];
  const inputArtifacts = Array.isArray(workload.inputArtifacts) ? workload.inputArtifacts : [];
  if (isArtifactWorkload(offering.workload) && !artifactUploads.length) {
    throw new Error("Confidential artifact workload refused: signed upload grants are required.");
  }
  const abortController = new AbortController();
  activeJobs.set(jobId, { model: offering.model, localModel: offering.model, kind: offering.workload, startedAt: Date.now(), abortController, canceled: false });
  jobModelById.set(jobId, offering.model);
  emit("job.accepted", { jobId, workerId, model: offering.model, kind: offering.workload, engine: "confidential-sidecar" });
  try {
    const headers = { "Content-Type": "application/json", Accept: "application/x-ndjson" };
    if (confidentialSidecarToken) headers.Authorization = "Bearer " + confidentialSidecarToken;
    const response = await fetch(joinUrl(confidentialSidecarUrl, "/v1/jobs"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        protocol: "hive-compute.workload.v1",
        jobId,
        workerId,
        descriptor: offering.descriptor,
        encryptedPayload,
        outputEncryption,
        artifactUploads,
        inputArtifacts,
        attestationNonce: job.attestationNonce || job.nonce,
      }),
      signal: abortController.signal,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error("Confidential sidecar returned HTTP " + response.status + (text ? ": " + text.slice(0, 300) : ""));
    }
    await relayConfidentialSidecarEvents(jobId, response.body, offering, abortController.signal);
    recordJobCompleted(offering.model);
  } catch (error) {
    const active = activeJobs.get(jobId);
    if (active && active.canceled) return;
    throw error;
  } finally {
    activeJobs.delete(jobId);
  }
}

function validateJobPayment(job) {
  if (!requirePaymentProof) return;
  const payment = job.payment && typeof job.payment === "object" ? job.payment : {};
  const rail = normalizeRail(String(payment.rail || payment.protocol || ""));
  if (mppRequireSession && rail !== "mpp") throw new Error("MPP session payment proof is required.");
  if (rail === "mpp") {
    if (!payment.sessionId && !payment.receipt && !payment.authorization) throw new Error("MPP job is missing session proof.");
    return;
  }
  if (rail === "x402" && (payment.settled === true || payment.authorized === true || payment.receipt)) return;
  if (rail === "prepaid" && (payment.authorized === true || payment.receipt)) return;
  throw new Error("Job is missing a gateway-authorized payment proof.");
}

function outputEncryptionFromJob(job) {
  const privacy = job.privacy && typeof job.privacy === "object" ? job.privacy : {};
  const output = privacy.outputEncryption && typeof privacy.outputEncryption === "object" ? privacy.outputEncryption : {};
  const required = output.required === true;
  if (!required) return null;
  const publicKey = normalizePublicKeyMaterial(String(output.publicKey || ""));
  if (!publicKey) throw new Error("Output encryption is required but no client public key was provided.");
  return {
    required: true,
    algorithm: "rsa-oaep-a256gcm",
    publicKey,
    publicKeySha256: String(output.publicKeySha256 || sha256(publicKey)).trim() || sha256(publicKey),
  };
}

function normalizeEncryptedJob(job) {
  const encrypted = job.encryptedPayload || job.encrypted_payload;
  if (!encrypted) return job;
  const decrypted = decryptPayload(encrypted);
  return { ...job, ...decrypted, encryptedPayload: undefined, encrypted_payload: undefined };
}

function decryptPayload(envelope) {
  if (!envelope || typeof envelope !== "object") throw new Error("Encrypted payload envelope is invalid.");
  const algorithm = String(envelope.algorithm || "").toLowerCase();
  if (algorithm === "dir-a256gcm" || algorithm === "aes-256-gcm") return decryptAesGcm(envelope, directPayloadKey());
  if (algorithm === "rsa-oaep-a256gcm") return decryptRsaOaepAesGcm(envelope);
  if (algorithm === "x25519-chacha20-poly1305") return decryptX25519Chacha(envelope);
  throw new Error("Unsupported encrypted payload algorithm: " + algorithm);
}

function directPayloadKey() {
  if (!teePayloadKey) throw new Error("${HIVE_COMPUTE_TEE_PAYLOAD_KEY_ENV} is required for AES-GCM encrypted payloads.");
  const key = Buffer.from(teePayloadKey, "base64");
  if (key.length !== 32) throw new Error("${HIVE_COMPUTE_TEE_PAYLOAD_KEY_ENV} must decode to 32 bytes.");
  return key;
}

function decryptAesGcm(envelope, key) {
  const nonce = b64(envelope.nonce || envelope.iv);
  const tag = b64(envelope.tag);
  const ciphertext = b64(envelope.ciphertext);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  if (envelope.aad) decipher.setAAD(Buffer.from(String(envelope.aad)));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
}

function decryptRsaOaepAesGcm(envelope) {
  if (!teePrivateKeyFile) throw new Error("${HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE_ENV} is required for RSA-OAEP encrypted payloads.");
  const privateKey = readFileSync(teePrivateKeyFile, "utf8");
  const key = privateDecrypt({
    key: privateKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, b64(envelope.encryptedKey || envelope.encrypted_key));
  return decryptAesGcm(envelope, key);
}

function decryptX25519Chacha(envelope) {
  if (!teePrivateKeyFile) throw new Error("${HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE_ENV} is required for X25519 encrypted payloads.");
  const privateKey = createPrivateKey(readFileSync(teePrivateKeyFile, "utf8"));
  const peerPublicKey = createPublicKey({
    key: { kty: "OKP", crv: "X25519", x: String(envelope.ephemeralPublicKey || envelope.ephemeral_public_key || "") },
    format: "jwk",
  });
  const shared = diffieHellman({ privateKey, publicKey: peerPublicKey });
  const salt = envelope.salt ? b64(envelope.salt) : Buffer.alloc(0);
  const info = Buffer.from(String(envelope.info || "hivemindos-hive-compute-v1"));
  const key = Buffer.from(hkdfSync("sha256", shared, salt, info, 32));
  const nonce = b64(envelope.nonce);
  const tag = b64(envelope.tag);
  const ciphertext = b64(envelope.ciphertext);
  const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  if (envelope.aad) decipher.setAAD(Buffer.from(String(envelope.aad)));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
}

function emitJobToken(input, tokenText, sequence) {
  if (!tokenText) return;
  if (!input.outputEncryption) {
    emit("job.token", { jobId: input.jobId, token: tokenText });
    return;
  }
  emit("job.encrypted_token", {
    jobId: input.jobId,
    encryptedToken: encryptOutputPayload(input.outputEncryption, {
      type: "delta",
      text: tokenText,
      sequence,
    }, outputAad(input.jobId, "delta", sequence)),
  });
}

function emitJobComplete(input, finalText, usage) {
  const finalUsage = usageWithCompletionEstimate(finalText, usage);
  if (!input.outputEncryption) {
    emit("job.complete", { jobId: input.jobId, text: finalText, usage: finalUsage });
    return;
  }
  emit("job.complete", {
    jobId: input.jobId,
    encryptedOutput: encryptOutputPayload(input.outputEncryption, {
      type: "final",
      text: finalText,
    }, outputAad(input.jobId, "final", 0)),
    usage: finalUsage,
    outputEncryption: {
      algorithm: input.outputEncryption.algorithm,
      publicKeySha256: input.outputEncryption.publicKeySha256,
    },
  });
}

function usageWithCompletionEstimate(text, usage) {
  const normalized = usage && typeof usage === "object" ? { ...usage } : {};
  if (!Number.isFinite(Number(normalized.completionTokens)) || Number(normalized.completionTokens) <= 0) {
    normalized.completionTokens = estimateTokens(text);
  }
  return normalized;
}

function encryptOutputPayload(outputEncryption, payload, aad) {
  if (outputEncryption.algorithm !== "rsa-oaep-a256gcm") throw new Error("Unsupported output encryption algorithm.");
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const encryptedKey = publicEncrypt({
    key: outputEncryption.publicKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, key);
  return {
    algorithm: "rsa-oaep-a256gcm",
    encryptedKey: encryptedKey.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    aad,
    publicKeySha256: outputEncryption.publicKeySha256,
    sequence: payload.sequence,
  };
}

function outputAad(jobId, kind, sequence) {
  return "hivemindos-hive-compute-output:" + jobId + ":" + kind + ":" + sequence;
}

function normalizePublicKeyMaterial(value) {
  const trimmed = String(value || "").trim().replace(/\\\\n/g, "\\n");
  if (!trimmed) return "";
  if (trimmed.includes("-----BEGIN PUBLIC KEY-----")) return trimmed;
  const compact = trimmed.replace(/\\s+/g, "");
  return "-----BEGIN PUBLIC KEY-----\\n" + (compact.match(/.{1,64}/g) || [compact]).join("\\n") + "\\n-----END PUBLIC KEY-----";
}

function collectAttestation(challenge) {
  const suppliedChallenge = challenge && typeof challenge === "object"
    ? challenge
    : { nonce: String(challenge || "") };
  const normalizedChallenge = {
    provider: teeProvider,
    imageDigest: teeImageDigest,
    workerEncryptionKeySha256: teeEncryptionPublicKey ? sha256(teeEncryptionPublicKey) : "",
    completionSigningKeySha256: confidentialSidecarSigningPublicKey ? sha256(confidentialSidecarSigningPublicKey) : "",
    ...suppliedChallenge,
    nonce: String(suppliedChallenge.nonce || randomBytes(32).toString("hex")),
  };
  const nonce = String(normalizedChallenge.nonce || "");
  const evidence = readAttestationEvidence(normalizedChallenge);
  const evidenceHash = evidence ? sha256(evidence) : "";
  return {
    ready: confidentialMode === "tee-attested" && Boolean(teeProvider && evidenceHash),
    mode: confidentialMode,
    provider: teeProvider,
    format: attestationFormat,
    nonce: nonce || undefined,
    evidenceHash,
    evidenceLength: evidence ? evidence.length : 0,
    evidenceBase64: evidence && evidence.length <= 512 * 1024 ? evidence.toString("base64") : undefined,
    evidenceSource: attestationCommand ? "command" : attestationFile ? "file" : undefined,
    measurement: teeMeasurement || undefined,
    imageDigest: teeImageDigest || undefined,
    encryptionPublicKey: teeEncryptionPublicKey || undefined,
    completionSigningPublicKey: confidentialSidecarSigningPublicKey || undefined,
    completionSigningPublicKeySha256: confidentialSidecarSigningPublicKey ? sha256(confidentialSidecarSigningPublicKey) : undefined,
    collectedAt: new Date().toISOString(),
  };
}

function readAttestationEvidence(challenge) {
  try {
    if (attestationCommand) {
      const result = spawnSync(attestationCommand, {
        shell: true,
        timeout: 10_000,
        maxBuffer: 768 * 1024,
        env: {
          ...process.env,
          HIVE_COMPUTE_TEE_NONCE: String(challenge.nonce || ""),
          HIVE_COMPUTE_TEE_CHALLENGE_JSON: JSON.stringify(challenge),
        },
      });
      if (result.status !== 0) return null;
      return Buffer.from(result.stdout || result.stderr || "");
    }
    if (attestationFile) return readFileSync(attestationFile);
  } catch {
    return null;
  }
  return null;
}

async function runOllamaJob(input) {
  const response = await fetch(joinUrl(ollamaHost, "/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.localModel,
      messages: input.messages.map(ollamaMessage),
      stream: true,
      options: input.options && typeof input.options === "object" ? input.options : undefined,
    }),
    signal: input.signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error("Ollama returned HTTP " + response.status + (text ? ": " + text.slice(0, 400) : ""));
  }

  let finalText = "";
  const decoder = new TextDecoder();
  let buffer = "";
  let sequence = 0;
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
        emitJobToken(input, tokenText, sequence++);
      }
      if (payload.done) {
        emitJobComplete(input, finalText, payload.eval_count || payload.prompt_eval_count ? {
            promptTokens: payload.prompt_eval_count || 0,
            completionTokens: payload.eval_count || 0,
          } : undefined);
        console.log("[hive-compute] completed", input.jobId);
        return;
      }
    }
  }
  emitJobComplete(input, finalText);
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
    signal: input.signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error("OpenAI-compatible server returned HTTP " + response.status + (text ? ": " + text.slice(0, 400) : ""));
  }

  let finalText = "";
  let finalUsage = undefined;
  const decoder = new TextDecoder();
  let buffer = "";
  let sequence = 0;
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\\r?\\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        emitJobComplete(input, finalText, finalUsage);
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
        emitJobToken(input, tokenText, sequence++);
      }
    }
  }
  emitJobComplete(input, finalText, finalUsage);
}

function normalizeMessages(job) {
  if (Array.isArray(job.messages)) {
    return job.messages
      .filter((message) => message && typeof message === "object")
      .map((message) => ({
        role: typeof message.role === "string" ? message.role : "user",
        // Multimodal chat: OpenAI content-part arrays (text + image_url parts)
        // pass through untouched so vision-capable local models receive their
        // image inputs instead of a JSON-stringified blob.
        content: typeof message.content === "string" || Array.isArray(message.content)
          ? message.content
          : JSON.stringify(message.content || ""),
      }));
  }
  const prompt = typeof job.prompt === "string" ? job.prompt : "";
  if (!prompt) throw new Error("Job assignment is missing messages or prompt.");
  return [{ role: "user", content: prompt }];
}

// Ollama's chat API takes flat text content plus a base64 images array, so
// OpenAI-style content parts are converted; non-data-URL image parts are
// dropped (the worker has no business fetching remote URLs for a job).
function ollamaMessage(message) {
  if (typeof message.content === "string") return message;
  const parts = Array.isArray(message.content) ? message.content : [];
  const text = parts
    .map((part) => (part && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\\n");
  const images = parts.flatMap((part) => {
    if (!part || part.type !== "image_url") return [];
    const url = typeof part.image_url === "string" ? part.image_url : part.image_url && part.image_url.url;
    const match = typeof url === "string" ? url.match(/^data:[^;]+;base64,(.+)$/) : null;
    return match ? [match[1]] : [];
  });
  return { role: message.role, content: text, ...(images.length ? { images } : {}) };
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

function parseWorkloadManifest(raw, legacy) {
  if (!raw.trim()) {
    if (!legacy.sidecarConfigured || !legacy.imageModels.length) return { protocol: "hive-compute.workload.v1", offerings: [] };
    return {
      protocol: "hive-compute.workload.v1",
      offerings: legacy.imageModels.map((model) => normalizeWorkloadOffering({
        id: "image-" + model.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 96),
        adapter: "confidential-sidecar",
        protocol: "hive-compute.workload.v1",
        kind: "image",
        task: "image.generate",
        model,
        inputMimeTypes: ["application/json"],
        outputMimeTypes: ["image/png"],
        billingUnit: "image",
        usdMicroPerUnit: positiveInteger(legacy.imagePriceByModel[model], DEFAULT_IMAGE_PRICE_USD_MICRO),
        minimumJobUsdMicro: 0,
        maxUnits: 4,
        maxInputBytes: 1048576,
        maxOutputBytes: 67108864,
        asynchronous: true,
        privacy: "hardware-tee-e2ee",
      })),
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("${HIVE_COMPUTE_WORKLOAD_MANIFEST_ENV} must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || parsed.protocol !== "hive-compute.workload.v1" || !Array.isArray(parsed.offerings)) {
    throw new Error("${HIVE_COMPUTE_WORKLOAD_MANIFEST_ENV} must use hive-compute.workload.v1 with an offerings array.");
  }
  if (!confidentialSidecarUrl && parsed.offerings.length) {
    throw new Error("${HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_URL_ENV} is required before advertising typed workloads.");
  }
  const offerings = parsed.offerings.map(normalizeWorkloadOffering);
  const ids = new Set();
  for (const offering of offerings) {
    if (ids.has(offering.id)) throw new Error("Duplicate Hive Compute workload offering id: " + offering.id);
    ids.add(offering.id);
  }
  return { protocol: "hive-compute.workload.v1", offerings };
}

function normalizeWorkloadOffering(value) {
  if (!value || typeof value !== "object") throw new Error("Hive Compute workload offering must be an object.");
  const kind = String(value.kind || "").trim().toLowerCase();
  const task = String(value.task || "").trim();
  const model = String(value.model || "").trim();
  const id = String(value.id || kind + "-" + model).trim();
  const billingUnit = String(value.billingUnit || "").trim().toLowerCase();
  const inputMimeTypes = normalizeMimeTypes(value.inputMimeTypes);
  const outputMimeTypes = normalizeMimeTypes(value.outputMimeTypes);
  if (value.adapter !== "confidential-sidecar" || value.protocol !== "hive-compute.workload.v1") throw new Error("Typed workloads must use the confidential-sidecar v1 protocol.");
  if (!CONFIDENTIAL_WORKLOADS.has(kind) || !SAFE_WORKLOAD_ID.test(id) || !SAFE_TASK.test(task) || !SAFE_WORKLOAD_ID.test(model)) throw new Error("Hive Compute workload identity is invalid.");
  if (kind === "custom" && !task.includes(".")) throw new Error("Custom Hive Compute tasks must use a fixed namespaced task id.");
  if (!WORKLOAD_BILLING_UNITS.has(billingUnit)) throw new Error("Hive Compute workload billing unit is invalid.");
  const descriptor = {
    protocol: "hive-compute.workload.v1",
    kind,
    task,
    model,
    inputMimeTypes,
    outputMimeTypes,
    billingUnit,
    usdMicroPerUnit: positiveInteger(value.usdMicroPerUnit, 0),
    minimumJobUsdMicro: nonNegativeInteger(value.minimumJobUsdMicro),
    maxUnits: positiveInteger(value.maxUnits, 0),
    maxInputBytes: positiveInteger(value.maxInputBytes, 0),
    maxOutputBytes: positiveInteger(value.maxOutputBytes, 0),
    asynchronous: true,
    privacy: "hardware-tee-e2ee",
  };
  if (!descriptor.usdMicroPerUnit || !descriptor.maxUnits || !descriptor.maxInputBytes || !descriptor.maxOutputBytes) {
    throw new Error("Hive Compute workload limits and unit price must be positive integers.");
  }
  return { id, adapter: "confidential-sidecar", workload: kind, model, descriptor };
}

function workloadListing(offering) {
  const descriptor = offering.descriptor;
  return {
    model: descriptor.model,
    modality: descriptor.kind,
    kind: descriptor.kind,
    task: descriptor.task,
    adapter: offering.adapter,
    billingUnit: descriptor.billingUnit,
    usdMicroPerUnit: descriptor.usdMicroPerUnit,
    minimumJobUsdMicro: descriptor.minimumJobUsdMicro,
    descriptor,
    privacy: {
      hostConfidentialOutput: true,
      encryptedInputRequired: true,
      ciphertextArtifactUploadRequired: isArtifactWorkload(descriptor.kind),
    },
    ...(descriptor.kind === "image" ? { usdMicroPerImage: descriptor.usdMicroPerUnit } : {}),
  };
}

function normalizeMimeTypes(value) {
  if (!Array.isArray(value) || !value.length || value.length > 32) throw new Error("Hive Compute workload MIME types are invalid.");
  const values = Array.from(new Set(value.map((item) => String(item || "").trim().toLowerCase())));
  if (values.some((item) => !SAFE_MIME.test(item))) throw new Error("Hive Compute workload MIME type is invalid.");
  return values;
}

function nonNegativeInteger(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizeWorkloadKind(value) {
  const kind = String(value || "chat").trim().toLowerCase();
  return CONFIDENTIAL_WORKLOADS.has(kind) ? kind : "chat";
}

function isArtifactWorkload(kind) {
  return ARTIFACT_WORKLOADS.has(kind);
}

async function relayConfidentialSidecarEvents(jobId, body, offering, signal) {
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  for await (const chunk of body) {
    if (signal.aborted) return;
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\\r?\\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      completed = relayConfidentialSidecarEvent(jobId, JSON.parse(line), offering) || completed;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) completed = relayConfidentialSidecarEvent(jobId, JSON.parse(buffer), offering) || completed;
  if (!completed && !signal.aborted) throw new Error("Confidential sidecar ended without a signed completion.");
}

function relayConfidentialSidecarEvent(jobId, event, offering) {
  if (!event || typeof event !== "object") throw new Error("Confidential sidecar emitted an invalid event.");
  if (event.type === "progress") {
    const progress = normalizeSidecarProgress(event.progress || event);
    if (offering.workload !== "chat") emit("job.progress", { jobId, progress: Math.floor(progress.percent || 0), ...progress });
    return false;
  }
  if (event.type === "complete") {
    if (containsForbiddenPlaintext(event)) throw new Error("Confidential sidecar attempted to return plaintext through the relay.");
    if (offering.workload === "chat") {
      if (!event.encryptedOutput || typeof event.encryptedOutput !== "object" || !event.usage || typeof event.usage !== "object") {
        throw new Error("Confidential chat sidecar completion is missing ciphertext or usage.");
      }
      emit("job.complete", { jobId, encryptedOutput: event.encryptedOutput, usage: event.usage });
      return true;
    }
    const completion = normalizeConfidentialCompletion(event.completion, jobId, offering.workload);
    emit("job.confidential_complete", {
      jobId,
      completion,
      ...(event.encryptedOutput && typeof event.encryptedOutput === "object" ? { encryptedOutput: event.encryptedOutput } : {}),
    });
    return true;
  }
  if (event.type === "error") throw new Error(String(event.error || "Confidential sidecar failed."));
  throw new Error("Confidential sidecar emitted an unsupported event type.");
}

function normalizeSidecarProgress(value) {
  const phase = String(value.phase || "running").trim().slice(0, 80) || "running";
  const percent = Number(value.percent);
  const current = Number(value.current);
  const total = Number(value.total);
  const etaMs = Number(value.etaMs);
  return {
    phase,
    ...(Number.isFinite(percent) ? { percent: Math.min(100, Math.max(0, percent)) } : {}),
    ...(Number.isFinite(current) && current >= 0 ? { current } : {}),
    ...(Number.isFinite(total) && total > 0 ? { total } : {}),
    ...(Number.isFinite(etaMs) && etaMs >= 0 ? { etaMs: Math.floor(etaMs) } : {}),
  };
}

function normalizeConfidentialCompletion(value, jobId, kind) {
  if (!value || typeof value !== "object" || !value.usage || typeof value.usage !== "object") throw new Error("Confidential completion is invalid.");
  const usage = value.usage;
  const artifacts = Array.isArray(usage.outputArtifacts) ? usage.outputArtifacts.map(normalizeCiphertextArtifactManifest) : [];
  if (usage.protocol !== "hive-compute.workload.v1" || usage.jobId !== jobId || usage.kind !== kind || !artifacts.length && isArtifactWorkload(kind)) {
    throw new Error("Confidential completion is not bound to the assigned workload.");
  }
  if (value.signatureAlgorithm !== "ecdsa-p256-sha256" || !String(value.signature || "")) throw new Error("Confidential completion signature is missing.");
  return { ...value, usage: { ...usage, outputArtifacts: artifacts } };
}

function normalizeCiphertextArtifactManifest(value) {
  const encryption = value && typeof value.encryption === "object" ? value.encryption : {};
  if (!value || typeof value !== "object" || !SAFE_WORKLOAD_ID.test(String(value.artifactId || "")) || value.role !== "output" || !SAFE_MIME.test(String(value.mimeType || ""))) throw new Error("Confidential artifact manifest is invalid.");
  if (!positiveInteger(value.ciphertextBytes, 0) || !SHA256_HEX.test(String(value.ciphertextSha256 || "").toLowerCase())) throw new Error("Confidential artifact ciphertext receipt is invalid.");
  if (encryption.algorithm !== "hive-artifact-aes256gcm-v1" || !String(encryption.encryptedKey || "") || !SHA256_HEX.test(String(encryption.publicKeySha256 || "").toLowerCase()) || !positiveInteger(encryption.chunkSize, 0) || !positiveInteger(encryption.chunks, 0)) throw new Error("Confidential artifact encryption manifest is invalid.");
  return value;
}

function containsForbiddenPlaintext(value) {
  if (!value || typeof value !== "object") return false;
  for (const [key, entry] of Object.entries(value)) {
    if (["text", "images", "videos", "audio", "b64_json", "b64Json", "dataUrl", "plaintext", "content"].includes(key) && typeof entry !== "undefined") return true;
    if (entry && typeof entry === "object" && containsForbiddenPlaintext(entry)) return true;
  }
  return false;
}

async function cancelActiveJob(jobId) {
  const active = activeJobs.get(jobId);
  if (!active) return;
  active.canceled = true;
  active.abortController && active.abortController.abort();
  if (active.kind !== "chat" && confidentialSidecarUrl) {
    const headers = { "Content-Type": "application/json" };
    if (confidentialSidecarToken) headers.Authorization = "Bearer " + confidentialSidecarToken;
    await fetch(joinUrl(confidentialSidecarUrl, "/v1/jobs/" + encodeURIComponent(jobId) + "/cancel"), {
      method: "POST",
      headers,
      body: JSON.stringify({ jobId }),
    }).catch(() => undefined);
  }
  activeJobs.delete(jobId);
  console.log("[hive-compute] canceled", jobId);
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

function parseModelListings(raw) {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch (error) {
    console.warn("[hive-compute] ignoring invalid HIVE_COMPUTE_MODEL_LISTINGS_JSON:", error.message);
    return [];
  }
}

function splitList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").trim().length / 4));
}

function booleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(String(value).trim().toLowerCase());
}

function normalizeRail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "mpp" || normalized === "prepaid" || normalized === "self-hosted") return normalized;
  return "x402";
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

function b64(value) {
  return Buffer.from(String(value || ""), "base64");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
`;
