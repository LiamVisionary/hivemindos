import type { HiveComputeModelOption } from "@/lib/types/hive-compute-marketplace";

export const HIVE_COMPUTE_PROVIDER_SLUG = "hive-compute";
export const HIVE_COMPUTE_PRODUCT_NAME = "Hive Compute";
export const HIVE_COMPUTE_WORKER_PACKAGE_NAME = "@hivemindos/hive-compute-worker";
export const HIVE_COMPUTE_WORKER_VERSION = "0.1.1";

export const HIVE_COMPUTE_GATEWAY_URL_ENV = "HIVEMINDOS_HIVE_COMPUTE_GATEWAY_URL";
export const HIVE_COMPUTE_OPENAI_BASE_URL_ENV = "HIVEMINDOS_HIVE_COMPUTE_OPENAI_BASE_URL";
export const HIVE_COMPUTE_API_KEY_ENV = "HIVEMINDOS_HIVE_COMPUTE_API_KEY";
export const HIVE_COMPUTE_WORKER_TOKEN_ENV = "HIVEMINDOS_HIVE_COMPUTE_WORKER_TOKEN";
export const HIVE_COMPUTE_ESTIMATED_EARNINGS_ENV = "HIVEMINDOS_HIVE_COMPUTE_ESTIMATED_EARNINGS_LABEL";
export const HIVE_COMPUTE_PAYMENT_RAIL_ENV = "HIVEMINDOS_HIVE_COMPUTE_PAYMENT_RAIL";
export const HIVE_COMPUTE_MPP_ENABLED_ENV = "HIVEMINDOS_HIVE_COMPUTE_MPP_ENABLED";
export const HIVE_COMPUTE_MPP_POLICY_URL_ENV = "HIVEMINDOS_HIVE_COMPUTE_MPP_POLICY_URL";
export const HIVE_COMPUTE_MPP_SESSION_TOKEN_ENV = "HIVEMINDOS_HIVE_COMPUTE_MPP_SESSION_TOKEN";
export const HIVE_COMPUTE_MPP_REQUIRE_SESSION_ENV = "HIVEMINDOS_HIVE_COMPUTE_MPP_REQUIRE_SESSION";
export const HIVE_COMPUTE_TEE_REQUIRED_ENV = "HIVEMINDOS_HIVE_COMPUTE_TEE_REQUIRED";
export const HIVE_COMPUTE_CONFIDENTIAL_MODE_ENV = "HIVEMINDOS_HIVE_COMPUTE_CONFIDENTIAL_MODE";
export const HIVE_COMPUTE_ATTESTATION_POLICY_URL_ENV = "HIVEMINDOS_HIVE_COMPUTE_ATTESTATION_POLICY_URL";
export const HIVE_COMPUTE_TEE_PROVIDER_ENV = "HIVEMINDOS_HIVE_COMPUTE_TEE_PROVIDER";
export const HIVE_COMPUTE_TEE_ATTESTATION_FILE_ENV = "HIVEMINDOS_HIVE_COMPUTE_TEE_ATTESTATION_FILE";
export const HIVE_COMPUTE_TEE_ATTESTATION_COMMAND_ENV = "HIVEMINDOS_HIVE_COMPUTE_TEE_ATTESTATION_COMMAND";
export const HIVE_COMPUTE_TEE_ATTESTATION_FORMAT_ENV = "HIVEMINDOS_HIVE_COMPUTE_TEE_ATTESTATION_FORMAT";
export const HIVE_COMPUTE_TEE_MEASUREMENT_ENV = "HIVEMINDOS_HIVE_COMPUTE_TEE_MEASUREMENT";
export const HIVE_COMPUTE_TEE_IMAGE_DIGEST_ENV = "HIVEMINDOS_HIVE_COMPUTE_TEE_IMAGE_DIGEST";
export const HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY_ENV = "HIVEMINDOS_HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY";
export const HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE_ENV = "HIVEMINDOS_HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE";
export const HIVE_COMPUTE_TEE_PAYLOAD_KEY_ENV = "HIVEMINDOS_HIVE_COMPUTE_TEE_PAYLOAD_KEY_B64";
export const HIVE_COMPUTE_WORKER_REQUIRE_PAYMENT_PROOF_ENV = "HIVEMINDOS_HIVE_COMPUTE_WORKER_REQUIRE_PAYMENT_PROOF";

export const HIVE_COMPUTE_DEFAULT_MODEL = "hive-compute/auto";
export const HIVE_COMPUTE_HOSTED_MODEL_PREFIX = "hive-compute/model:";
const HIVE_COMPUTE_MODEL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/;

export const HIVE_COMPUTE_MODEL_OPTIONS: HiveComputeModelOption[] = [
  {
    id: HIVE_COMPUTE_DEFAULT_MODEL,
    name: "Auto marketplace route",
    subtitle: "Gateway chooses an eligible worker by model, price, health, and latency.",
    group: "Marketplace",
    badge: "Auto",
  },
  {
    id: "hive-compute/fast",
    name: "Fast GPU route",
    subtitle: "Prefer low-latency workers for interactive chat.",
    group: "Marketplace",
    badge: "Fast",
  },
  {
    id: "hive-compute/deep",
    name: "Large-context route",
    subtitle: "Prefer workers advertising larger models or context windows.",
    group: "Marketplace",
    badge: "Deep",
  },
];

export function normalizeHiveComputeModel(model?: string | null) {
  const routed = hiveComputeHostedRouteModel(model);
  if (routed) return routed;
  const trimmed = model?.trim() || "";
  return HIVE_COMPUTE_MODEL_ID_RE.test(trimmed) ? trimmed : HIVE_COMPUTE_DEFAULT_MODEL;
}

export function hiveComputeHostedModelId(model: string) {
  const trimmed = model.trim();
  if (!trimmed) return HIVE_COMPUTE_DEFAULT_MODEL;
  return trimmed.startsWith("hive-compute/") ? trimmed : `${HIVE_COMPUTE_HOSTED_MODEL_PREFIX}${trimmed}`;
}

export function hiveComputeHostedRouteModel(model?: string | null) {
  const trimmed = model?.trim() || "";
  if (!trimmed) return "";
  if (trimmed.startsWith(HIVE_COMPUTE_HOSTED_MODEL_PREFIX)) {
    const routeModel = trimmed.slice(HIVE_COMPUTE_HOSTED_MODEL_PREFIX.length).trim();
    return HIVE_COMPUTE_MODEL_ID_RE.test(routeModel) ? routeModel : "";
  }
  return trimmed.startsWith("hive-compute/") && HIVE_COMPUTE_MODEL_ID_RE.test(trimmed) ? trimmed : "";
}

export function isHiveComputeHostedModelId(model?: string | null) {
  return Boolean(hiveComputeHostedRouteModel(model));
}
