import "server-only";

import {
  HIVE_COMPUTE_API_KEY_ENV,
  HIVE_COMPUTE_GATEWAY_URL_ENV,
} from "@/lib/config/hive-compute-marketplace";
import { readEnv } from "@/lib/services/hive-compute-marketplace/shared-io";
import { generateHiveComputeArtifactKeyPair } from "@/lib/services/hive-compute-artifact-e2ee";
import { decryptHiveComputeArtifactWireFromVault } from "@/lib/services/hive-compute-artifact-wire";
import {
  deleteHiveComputeJobPrivateKey,
  storeHiveComputeJobPrivateKey,
} from "@/lib/services/hive-compute-marketplace/job-key-vault";
import {
  normalizeHiveComputeJobSubmission,
  normalizeHiveComputeJobDraftRequest,
  normalizeHiveComputeArtifactDescriptor,
  normalizeHiveComputeResourceId,
  type HiveComputeJobSubmission,
} from "@/lib/services/hive-compute-workloads";

const CONTROL_TIMEOUT_MS = 30_000;
const ARTIFACT_TIMEOUT_MS = 600_000;

export type HiveComputeGatewayJsonResult = {
  status: number;
  payload: Record<string, unknown>;
  headers: Headers;
};

export async function listHiveComputeCapabilities(): Promise<HiveComputeGatewayJsonResult> {
  return gatewayJson("/v1/capabilities", { method: "GET" });
}

export async function createHiveComputeJobDraft(value: unknown): Promise<HiveComputeGatewayJsonResult> {
  const input = normalizeHiveComputeJobDraftRequest(value);
  const keys = await generateHiveComputeArtifactKeyPair();
  const result = await gatewayJson("/v1/jobs", {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      protocol: "hive-compute.workload.v1",
      kind: input.kind,
      task: input.task,
      model: input.model,
      billingUnit: input.billingUnit,
      requestedUnits: input.requestedUnits,
      inputMimeTypes: input.inputMimeTypes,
      outputMimeTypes: input.outputMimeTypes,
      maxInputBytes: input.maxInputBytes,
      maxOutputBytes: input.maxOutputBytes,
      outputPublicKey: keys.publicKeyPem,
      privacy: "hardware-tee-e2ee",
    }),
  });
  if (result.status < 200 || result.status >= 300) {
    keys.privateKeyPkcs8.fill(0);
    return result;
  }
  const jobRecord = isRecord(result.payload.job) ? result.payload.job : result.payload;
  const jobId = String(jobRecord.jobId || jobRecord.id || "").trim();
  const expiresAt = String(jobRecord.expiresAt || "").trim();
  if (!jobId || !expiresAt || Number.isNaN(Date.parse(expiresAt))) {
    return { ...result, status: 502, payload: { ok: false, error: "Hive Compute draft did not include a bounded job id and key expiry." } };
  }
  try {
    await storeHiveComputeJobPrivateKey({
      jobId,
      publicKeySha256: keys.publicKeySha256,
      privateKeyPkcs8: keys.privateKeyPkcs8,
      expiresAt,
    });
  } catch (error) {
    await gatewayJson(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  } finally {
    keys.privateKeyPkcs8.fill(0);
  }
  return {
    ...result,
    payload: {
      ...result.payload,
      jobId,
      renterOutputEncryption: {
        required: true,
        algorithm: "rsa-oaep-a256gcm",
        publicKey: keys.publicKeyPem,
        publicKeySha256: keys.publicKeySha256,
      },
    },
  };
}

export async function submitHiveComputeJob(value: unknown): Promise<HiveComputeGatewayJsonResult> {
  const input = normalizeHiveComputeJobSubmission(value);
  return gatewayJson(`/v1/jobs/${encodeURIComponent(input.jobId)}/submit`, {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify(gatewayJobBody(input)),
  });
}

export async function getHiveComputeJob(jobId: unknown): Promise<HiveComputeGatewayJsonResult> {
  const id = normalizeHiveComputeResourceId(jobId, "job id");
  const result = await gatewayJson(`/v1/jobs/${encodeURIComponent(id)}`, { method: "GET" });
  await cleanupTerminalJobKey(result.payload);
  return result;
}

export async function cancelHiveComputeJob(jobId: unknown): Promise<HiveComputeGatewayJsonResult> {
  const id = normalizeHiveComputeResourceId(jobId, "job id");
  const result = await gatewayJson(`/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  await cleanupTerminalJobKey(result.payload);
  return result;
}

export async function acknowledgeHiveComputeArtifacts(input: { jobId: unknown; publicKeySha256: unknown; artifactIds: unknown }) {
  const jobId = normalizeHiveComputeResourceId(input.jobId, "job id");
  const publicKeySha256 = String(input.publicKeySha256 || "").trim().toLowerCase();
  if (!Array.isArray(input.artifactIds) || !input.artifactIds.length) throw new Error("Artifact acknowledgement requires artifactIds.");
  for (const value of input.artifactIds) {
    const artifactId = normalizeHiveComputeResourceId(value, "artifact id");
    const deleted = await gatewayJson(`/v1/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`, { method: "DELETE" });
    if (deleted.status < 200 || deleted.status >= 300) throw new Error(String(deleted.payload.error || "Gateway artifact acknowledgement failed."));
  }
  return deleteHiveComputeJobPrivateKey({ jobId, publicKeySha256 });
}

export async function streamHiveComputeArtifact(input: {
  jobId: unknown;
  artifactId: unknown;
  range?: string | null;
  downloadGrant?: string | null;
  signal?: AbortSignal;
}) {
  const jobId = normalizeHiveComputeResourceId(input.jobId, "job id");
  const artifactId = normalizeHiveComputeResourceId(input.artifactId, "artifact id");
  const { baseUrl, apiKey } = await gatewayAuthority();
  return fetch(`${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`, {
    method: "GET",
    headers: {
      Accept: "application/octet-stream",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(boundedHeader(input.range, 200) ? { Range: boundedHeader(input.range, 200) } : {}),
      ...(boundedHeader(input.downloadGrant, 2_048) ? { "X-HivemindOS-Artifact-Grant": boundedHeader(input.downloadGrant, 2_048) } : {}),
    },
    cache: "no-store",
    signal: input.signal ?? AbortSignal.timeout(ARTIFACT_TIMEOUT_MS),
  });
}

export async function streamDecryptedHiveComputeArtifact(input: {
  jobId: unknown;
  artifactId: unknown;
  descriptor: unknown;
  downloadGrant?: string | null;
  signal?: AbortSignal;
}) {
  const jobId = normalizeHiveComputeResourceId(input.jobId, "job id");
  const artifactId = normalizeHiveComputeResourceId(input.artifactId, "artifact id");
  const descriptor = normalizeHiveComputeArtifactDescriptor(input.descriptor);
  if (descriptor.role !== "output" || descriptor.artifactId !== artifactId) {
    throw new Error("Output artifact manifest does not match the download path.");
  }
  const upstream = await streamHiveComputeArtifact({
    jobId,
    artifactId,
    downloadGrant: input.downloadGrant,
    signal: input.signal,
  });
  if (!upstream.ok || !upstream.body) {
    throw new Error(`Hive Compute artifact download failed with HTTP ${upstream.status}.`);
  }
  return {
    descriptor,
    body: await decryptHiveComputeArtifactWireFromVault({ body: upstream.body, jobId, descriptor }),
  };
}

export async function uploadHiveComputeInputArtifact(input: {
  jobId: unknown;
  artifactId: unknown;
  body: ReadableStream<Uint8Array> | null;
  uploadGrant?: string | null;
  manifest: unknown;
  signal?: AbortSignal;
}) {
  const jobId = normalizeHiveComputeResourceId(input.jobId, "job id");
  const artifactId = normalizeHiveComputeResourceId(input.artifactId, "artifact id");
  const manifest = normalizeHiveComputeArtifactDescriptor(input.manifest);
  if (manifest.role !== "input" || manifest.artifactId !== artifactId) throw new Error("Input artifact manifest does not match the upload path.");
  const { baseUrl, apiKey } = await gatewayAuthority();
  return fetch(`${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Length": String(manifest.ciphertextBytes),
      ...(boundedHeader(input.uploadGrant, 2_048) ? { "X-HivemindOS-Artifact-Grant": boundedHeader(input.uploadGrant, 2_048) } : {}),
      "X-Hive-Compute-Ciphertext-Sha256": manifest.ciphertextSha256,
      "X-Hive-Compute-Encrypted-Mime-Type": manifest.mimeType,
      "X-Hive-Compute-Encrypted-Key": manifest.encryption.encryptedKey,
      "X-Hive-Compute-Encryption-Public-Key-Sha256": manifest.encryption.publicKeySha256,
      "X-Hive-Compute-Chunk-Size": String(manifest.encryption.chunkSize),
      "X-Hive-Compute-Chunks": String(manifest.encryption.chunks),
    },
    body: input.body,
    cache: "no-store",
    signal: input.signal ?? AbortSignal.timeout(ARTIFACT_TIMEOUT_MS),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function gatewayJobBody(input: HiveComputeJobSubmission) {
  return {
    protocol: "hive-compute.workload.v1",
    kind: input.kind,
    model: input.model,
    encryptedPayload: input.encryptedPayload,
    inputArtifacts: input.inputArtifacts,
    outputPublicKey: input.outputEncryption.publicKey,
    privacy: {
      renterOnly: true,
      hardwareTeeRequired: true,
      encryptedInputRequired: true,
      outputEncryption: input.outputEncryption,
    },
  };
}

async function cleanupTerminalJobKey(payload: Record<string, unknown>) {
  const job = isRecord(payload.job) ? payload.job : payload;
  const status = String(job.status || "").toLowerCase();
  if (status !== "failed" && status !== "cancelled" && status !== "expired") return;
  const jobId = String(job.jobId || job.id || "").trim();
  const publicKeySha256 = String(job.outputPublicKeySha256 || job.publicKeySha256 || "").trim().toLowerCase();
  if (jobId && publicKeySha256) await deleteHiveComputeJobPrivateKey({ jobId, publicKeySha256 }).catch(() => false);
}

async function gatewayJson(path: string, init: RequestInit): Promise<HiveComputeGatewayJsonResult> {
  const { baseUrl, apiKey } = await gatewayAuthority();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    });
    const value = await response.json().catch(() => null);
    return {
      status: response.status,
      payload: isRecord(value)
        ? value
        : { ok: false, error: `Hive Compute gateway returned HTTP ${response.status} without JSON.` },
      headers: response.headers,
    };
  } catch (error) {
    return {
      status: 502,
      payload: { ok: false, error: error instanceof Error ? error.message : "Hive Compute gateway is unreachable." },
      headers: new Headers(),
    };
  }
}

async function gatewayAuthority() {
  const [gatewayUrl, apiKey] = await Promise.all([
    readEnv(HIVE_COMPUTE_GATEWAY_URL_ENV),
    readEnv(HIVE_COMPUTE_API_KEY_ENV),
  ]);
  const baseUrl = gatewayUrl.value.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error(`Set ${HIVE_COMPUTE_GATEWAY_URL_ENV} before using Hive Compute jobs.`);
  return { baseUrl, apiKey: apiKey.value };
}

function boundedHeader(value: unknown, maximum: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= maximum && !/[\r\n]/.test(text) ? text : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
