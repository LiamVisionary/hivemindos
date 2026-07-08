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
