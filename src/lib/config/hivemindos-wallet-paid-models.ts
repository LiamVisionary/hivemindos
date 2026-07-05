export const HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER = "hivemindos-models";
export const HIVEMINDOS_WALLET_PAID_MODELS_NAME = "HivemindOS Models";
export const HIVEMINDOS_FREE_MODEL_ID = "hivemindos/swarm-sovereign-scout";
export const HIVEMINDOS_FREE_MODEL_UPSTREAM = "swarm-sovereign-scout-12b";
export const HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL = HIVEMINDOS_FREE_MODEL_ID;
export const HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG_ENV = "HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG";
export const HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG_PUBLIC_ENV = "NEXT_PUBLIC_HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG";
export const HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_UPSTREAM_MODEL = "gpt-5.4-mini";
// Custom gateway models picked from the dynamic list are stored as
// "hivemindos/custom:<upstream-id>" so the profile stays a single string.
export const HIVEMINDOS_CUSTOM_MODEL_PREFIX = "hivemindos/custom:";
const CUSTOM_UPSTREAM_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export type HivemindosWalletPaidModelOption = {
  id: string;
  name: string;
  subtitle: string;
  group: string;
  badge: string;
  upstreamModel: string;
  tier: "free" | "paid";
};

export const HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS: HivemindosWalletPaidModelOption[] = [
  {
    id: HIVEMINDOS_FREE_MODEL_ID,
    name: "Swarm Sovereign Scout",
    subtitle: "Free daily allowance · no wallet needed",
    group: "HivemindOS",
    badge: "Free",
    upstreamModel: HIVEMINDOS_FREE_MODEL_UPSTREAM,
    tier: "free",
  },
  {
    id: "hivemindos/auto",
    name: "Auto",
    subtitle: "Best wallet-paid route",
    group: "HivemindOS",
    badge: "Wallet",
    upstreamModel: HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_UPSTREAM_MODEL,
    tier: "paid",
  },
  {
    id: "hivemindos/fast",
    name: "Fast",
    subtitle: "Low-latency wallet-paid route",
    group: "HivemindOS",
    badge: "Wallet",
    upstreamModel: "gpt-5.4-nano",
    tier: "paid",
  },
  {
    id: "hivemindos/frontier",
    name: "Frontier",
    subtitle: "Highest-quality wallet-paid route",
    group: "HivemindOS",
    badge: "Wallet",
    upstreamModel: "gpt-5.5",
    tier: "paid",
  },
  {
    id: "hivemindos/research",
    name: "Research",
    subtitle: "Deeper reasoning wallet-paid route",
    group: "HivemindOS",
    badge: "Wallet",
    upstreamModel: "claude-opus-4.8",
    tier: "paid",
  },
];

export function hivemindosWalletPaidModelIds() {
  return HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.map((model) => model.id);
}

export function isCustomHivemindosWalletPaidModel(model: string | undefined | null) {
  const trimmed = model?.trim() || "";
  if (!trimmed.startsWith(HIVEMINDOS_CUSTOM_MODEL_PREFIX)) return false;
  return CUSTOM_UPSTREAM_MODEL_RE.test(trimmed.slice(HIVEMINDOS_CUSTOM_MODEL_PREFIX.length));
}

export function customHivemindosWalletPaidModelId(upstreamModel: string) {
  return `${HIVEMINDOS_CUSTOM_MODEL_PREFIX}${upstreamModel.trim()}`;
}

export function normalizeHivemindosWalletPaidModel(model: string | undefined | null) {
  const trimmed = model?.trim() || "";
  if (HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.some((option) => option.id === trimmed)) return trimmed;
  if (isCustomHivemindosWalletPaidModel(trimmed)) return trimmed;
  return HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL;
}

export function upstreamHivemindosWalletPaidModel(model: string | undefined | null) {
  const normalized = normalizeHivemindosWalletPaidModel(model);
  if (isCustomHivemindosWalletPaidModel(normalized)) {
    return normalized.slice(HIVEMINDOS_CUSTOM_MODEL_PREFIX.length);
  }
  return HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.find((option) => option.id === normalized)?.upstreamModel
    || HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_UPSTREAM_MODEL;
}

// Free tier vs wallet-paid: only the bundled free model rides the free rail.
// Custom gateway models are always paid; the hosted gateway is the authority
// on free-tier allowances either way.
export function isFreeHivemindosWalletPaidModel(model: string | undefined | null) {
  return normalizeHivemindosWalletPaidModel(model) === HIVEMINDOS_FREE_MODEL_ID;
}

export function normalizeHivemindosWalletPaidSlug(slug: string | undefined | null) {
  const normalized = (slug || "default").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(normalized) ? normalized : "default";
}
