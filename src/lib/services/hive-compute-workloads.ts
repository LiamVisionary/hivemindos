export const HIVE_COMPUTE_WORKLOAD_KINDS = [
  "image",
  "video",
  "audio",
  "music",
  "speech",
  "3d",
  "embedding",
  "rerank",
  "custom",
] as const;

export type HiveComputeWorkloadKind = (typeof HIVE_COMPUTE_WORKLOAD_KINDS)[number];

export const HIVE_COMPUTE_GENERATIVE_ARTIFACT_WORKLOADS = [
  "image",
  "video",
  "audio",
  "music",
  "speech",
  "3d",
] as const satisfies readonly HiveComputeWorkloadKind[];

export type HiveComputeBillingUnit =
  | "image"
  | "second"
  | "frame"
  | "megapixel"
  | "sample"
  | "artifact"
  | "job"
  | "gpu-second";

export type HiveComputeWorkloadOffering = {
  id: string;
  protocol: "hive-compute.workload.v1";
  kind: HiveComputeWorkloadKind;
  task: string;
  model: string;
  adapter: "confidential-sidecar";
  billingUnit: HiveComputeBillingUnit;
  usdMicroPerUnit: number;
  minimumJobUsdMicro: number;
  inputMimeTypes: string[];
  outputMimeTypes: string[];
  maxUnits: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  asynchronous: true;
  privacy: "hardware-tee-e2ee";
};

export type HiveComputeWorkloadManifest = {
  protocol: "hive-compute.workload.v1";
  offerings: HiveComputeWorkloadOffering[];
};

export type HiveComputeArtifactDescriptor = {
  artifactId: string;
  role: "input" | "output";
  mimeType: string;
  ciphertextBytes: number;
  ciphertextSha256: string;
  encryption: {
    algorithm: "hive-artifact-aes256gcm-v1";
    encryptedKey: string;
    publicKeySha256: string;
    chunkSize: number;
    chunks: number;
  };
};

export type HiveComputeJobProgress = {
  phase: string;
  percent?: number;
  current?: number;
  total?: number;
  etaMs?: number;
  message?: string;
};

export type HiveComputeJobStatus = {
  jobId: string;
  status: "draft" | "queued" | "assigned" | "running" | "completed" | "failed" | "cancelled" | "expired";
  kind: HiveComputeWorkloadKind;
  model: string;
  progress?: HiveComputeJobProgress;
  artifacts?: HiveComputeArtifactDescriptor[];
  encryptedOutput?: unknown;
  receipt?: unknown;
  error?: string;
};

export type HiveComputeJobSubmission = {
  jobId: string;
  kind: HiveComputeWorkloadKind;
  model: string;
  encryptedPayload: Record<string, unknown>;
  inputArtifacts?: HiveComputeArtifactDescriptor[];
  outputEncryption: {
    required: true;
    algorithm: "rsa-oaep-a256gcm";
    publicKey: string;
    publicKeySha256: string;
  };
  idempotencyKey: string;
};

export type HiveComputeJobDraftRequest = {
  kind: HiveComputeWorkloadKind;
  model: string;
  task: string;
  billingUnit: HiveComputeBillingUnit;
  requestedUnits: number;
  inputMimeTypes: string[];
  outputMimeTypes: string[];
  maxInputBytes: number;
  maxOutputBytes: number;
  idempotencyKey: string;
};

const WORKLOAD_SET = new Set<string>(HIVE_COMPUTE_WORKLOAD_KINDS);
const ARTIFACT_WORKLOAD_SET = new Set<string>(HIVE_COMPUTE_GENERATIVE_ARTIFACT_WORKLOADS);
const BILLING_UNITS = new Set<HiveComputeBillingUnit>([
  "image", "second", "frame", "megapixel", "sample", "artifact", "job", "gpu-second",
]);
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/;
const RESOURCE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function isHiveComputeWorkloadKind(value: unknown): value is HiveComputeWorkloadKind {
  return typeof value === "string" && WORKLOAD_SET.has(value);
}

export function isHiveComputeGenerativeArtifactWorkload(value: unknown): boolean {
  return typeof value === "string" && ARTIFACT_WORKLOAD_SET.has(value);
}

export function normalizeHiveComputeWorkloadManifest(value: unknown): HiveComputeWorkloadManifest {
  const record = requireRecord(value, "Hive Compute workload manifest");
  if (record.protocol !== "hive-compute.workload.v1") throw new Error("Hive Compute workload manifest protocol must be hive-compute.workload.v1.");
  if (!Array.isArray(record.offerings)) throw new Error("Hive Compute workload manifest offerings must be an array.");
  const offerings = record.offerings.map((offering, index) => normalizeOffering(offering, index));
  const ids = new Set<string>();
  for (const offering of offerings) {
    if (ids.has(offering.id)) throw new Error(`Hive Compute workload offering id is duplicated: ${offering.id}.`);
    ids.add(offering.id);
  }
  return { protocol: "hive-compute.workload.v1", offerings };
}

export function normalizeHiveComputeJobSubmission(value: unknown): HiveComputeJobSubmission {
  const record = requireRecord(value, "Hive Compute job");
  if (typeof record.parameters !== "undefined" || typeof record.options !== "undefined") {
    throw new Error("Hive Compute submit accepts ciphertext only; plaintext parameters/options are forbidden.");
  }
  if (!isHiveComputeWorkloadKind(record.kind)) throw new Error("Hive Compute job kind is invalid.");
  const model = identifier(record.model, "model");
  const encryptedPayload = requireRecord(record.encryptedPayload, "Hive Compute encrypted payload");
  const output = requireRecord(record.outputEncryption, "Hive Compute output encryption");
  const publicKey = boundedString(output.publicKey, 16_384);
  const publicKeySha256 = boundedString(output.publicKeySha256, 64).toLowerCase();
  if (output.required !== true || output.algorithm !== "rsa-oaep-a256gcm" || !publicKey || !HASH_PATTERN.test(publicKeySha256)) {
    throw new Error("Hive Compute jobs require a renter RSA-OAEP public key and SHA-256 binding.");
  }
  const idempotencyKey = boundedString(record.idempotencyKey, 200);
  if (!idempotencyKey) throw new Error("Hive Compute job idempotencyKey is required.");
  const inputArtifacts = Array.isArray(record.inputArtifacts)
    ? record.inputArtifacts.map(normalizeHiveComputeArtifactDescriptor)
    : undefined;
  if (inputArtifacts?.some((artifact) => artifact.role !== "input")) throw new Error("Hive Compute job inputArtifacts must have role input.");
  return {
    jobId: resourceIdentifier(record.jobId, "job id"),
    kind: record.kind,
    model,
    encryptedPayload,
    ...(inputArtifacts?.length ? { inputArtifacts } : {}),
    outputEncryption: { required: true, algorithm: "rsa-oaep-a256gcm", publicKey, publicKeySha256 },
    idempotencyKey,
  };
}

export function normalizeHiveComputeJobDraftRequest(value: unknown): HiveComputeJobDraftRequest {
  const record = requireRecord(value, "Hive Compute job draft");
  if (!isHiveComputeWorkloadKind(record.kind)) throw new Error("Hive Compute job draft kind is invalid.");
  const task = boundedString(record.task, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(task)) throw new Error("Hive Compute job draft task is invalid.");
  if (record.kind === "custom" && !task.includes(".")) throw new Error("Custom Hive Compute draft tasks must be namespaced.");
  const idempotencyKey = boundedString(record.idempotencyKey, 200);
  if (!idempotencyKey) throw new Error("Hive Compute job draft idempotencyKey is required.");
  const billingUnit = typeof record.billingUnit === "string" && BILLING_UNITS.has(record.billingUnit as HiveComputeBillingUnit)
    ? record.billingUnit as HiveComputeBillingUnit
    : null;
  if (!billingUnit) throw new Error("Hive Compute job draft billingUnit is invalid.");
  return {
    kind: record.kind,
    model: identifier(record.model, "model"),
    task,
    billingUnit,
    requestedUnits: positiveInteger(record.requestedUnits, "requested units"),
    inputMimeTypes: mimeArray(record.inputMimeTypes, "input"),
    outputMimeTypes: mimeArray(record.outputMimeTypes, "output"),
    maxInputBytes: positiveInteger(record.maxInputBytes, "maximum input bytes"),
    maxOutputBytes: positiveInteger(record.maxOutputBytes, "maximum output bytes"),
    idempotencyKey,
  };
}

export function normalizeHiveComputeResourceId(value: unknown, label: string) {
  return resourceIdentifier(value, label);
}

export function normalizeHiveComputeArtifactDescriptor(value: unknown): HiveComputeArtifactDescriptor {
  const record = requireRecord(value, "Hive Compute artifact");
  const encryption = requireRecord(record.encryption, "Hive Compute artifact encryption");
  const ciphertextSha256 = boundedString(record.ciphertextSha256, 64).toLowerCase();
  const ciphertextBytes = Number(record.ciphertextBytes);
  const publicKeySha256 = boundedString(encryption.publicKeySha256, 64).toLowerCase();
  const encryptedKey = boundedString(encryption.encryptedKey, 16_384);
  const chunkSize = Number(encryption.chunkSize);
  const chunks = Number(encryption.chunks);
  if (encryption.algorithm !== "hive-artifact-aes256gcm-v1") throw new Error("Hive Compute artifact encryption is invalid.");
  if (!HASH_PATTERN.test(ciphertextSha256)) throw new Error("Hive Compute artifact ciphertext hash is invalid.");
  if (!HASH_PATTERN.test(publicKeySha256) || !encryptedKey) throw new Error("Hive Compute artifact key binding is invalid.");
  if (!Number.isSafeInteger(ciphertextBytes) || ciphertextBytes <= 0) throw new Error("Hive Compute artifact byte count is invalid.");
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || !Number.isSafeInteger(chunks) || chunks <= 0) {
    throw new Error("Hive Compute artifact chunk manifest is invalid.");
  }
  const mimeType = mime(record.mimeType, "artifact output");
  const role = record.role;
  if (role !== "input" && role !== "output") throw new Error("Hive Compute artifact role is invalid.");
  return {
    artifactId: resourceIdentifier(record.artifactId, "artifact id"),
    role,
    mimeType,
    ciphertextBytes,
    ciphertextSha256,
    encryption: {
      algorithm: "hive-artifact-aes256gcm-v1",
      encryptedKey,
      publicKeySha256,
      chunkSize,
      chunks,
    },
  };
}

function normalizeOffering(value: unknown, index: number): HiveComputeWorkloadOffering {
  const record = requireRecord(value, `Hive Compute workload offering ${index}`);
  if (!isHiveComputeWorkloadKind(record.kind)) throw new Error("Hive Compute offering kind is invalid.");
  if (record.adapter !== "confidential-sidecar") {
    throw new Error(`Hive Compute ${record.kind} offerings must use the confidential-sidecar adapter.`);
  }
  if (record.protocol !== "hive-compute.workload.v1" || record.privacy !== "hardware-tee-e2ee" || record.asynchronous !== true) {
    throw new Error(`Hive Compute ${record.kind} offerings must use the asynchronous hardware-tee-e2ee protocol.`);
  }
  const billingUnit = record.billingUnit;
  if (typeof billingUnit !== "string" || !BILLING_UNITS.has(billingUnit as HiveComputeBillingUnit)) {
    throw new Error("Hive Compute offering billingUnit is invalid.");
  }
  const usdMicroPerUnit = positiveInteger(record.usdMicroPerUnit, "unit price");
  const minimumJobUsdMicro = nonNegativeInteger(record.minimumJobUsdMicro, "minimum job price");
  const task = boundedString(record.task, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(task)) throw new Error("Hive Compute offering task is invalid.");
  if (record.kind === "custom" && !task.includes(".")) throw new Error("Custom Hive Compute tasks must be namespaced.");
  return {
    id: identifier(record.id || `${record.kind}:${String(record.model || "")}`, "offering id"),
    protocol: "hive-compute.workload.v1",
    kind: record.kind,
    task,
    model: identifier(record.model, "model"),
    adapter: "confidential-sidecar",
    billingUnit: billingUnit as HiveComputeBillingUnit,
    usdMicroPerUnit,
    minimumJobUsdMicro,
    inputMimeTypes: mimeArray(record.inputMimeTypes, "input"),
    outputMimeTypes: mimeArray(record.outputMimeTypes, "output"),
    maxUnits: positiveInteger(record.maxUnits, "maximum units"),
    maxInputBytes: positiveInteger(record.maxInputBytes, "maximum input bytes"),
    maxOutputBytes: positiveInteger(record.maxOutputBytes, "maximum output bytes"),
    asynchronous: true,
    privacy: "hardware-tee-e2ee",
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function identifier(value: unknown, label: string) {
  const text = boundedString(value, 200);
  if (!IDENTIFIER_PATTERN.test(text)) throw new Error(`Hive Compute ${label} is invalid.`);
  return text;
}

function resourceIdentifier(value: unknown, label: string) {
  const text = boundedString(value, 128);
  if (!RESOURCE_ID_PATTERN.test(text)) throw new Error(`Hive Compute ${label} is invalid.`);
  return text;
}

function boundedString(value: unknown, maximum: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= maximum ? text : "";
}

function mime(value: unknown, label: string) {
  const text = boundedString(value, 120).toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(text)) {
    throw new Error(`Hive Compute ${label} MIME type is invalid.`);
  }
  return text;
}

function mimeArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 32) throw new Error(`Hive Compute ${label} MIME types must be a bounded array.`);
  return Array.from(new Set(value.map((entry) => mime(entry, label))));
}

function positiveInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`Hive Compute ${label} must be a positive integer.`);
  return number;
}

function nonNegativeInteger(value: unknown, label: string) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Hive Compute ${label} must be a non-negative integer.`);
  return number;
}
