export const HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER = "hivemindos-models";
export const HIVEMINDOS_WALLET_PAID_MODELS_NAME = "HivemindOS Models";
export const HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL = "hivemindos/auto";
export const HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG_ENV = "HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG";
export const HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG_PUBLIC_ENV = "NEXT_PUBLIC_HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG";
export const HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_UPSTREAM_MODEL = "gpt-5.4-mini";

export type HivemindosWalletPaidModelOption = {
  id: string;
  name: string;
  subtitle: string;
  group: string;
  badge: string;
  upstreamModel: string;
};

export const HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS: HivemindosWalletPaidModelOption[] = [
  {
    id: "hivemindos/auto",
    name: "Auto",
    subtitle: "Best wallet-paid route",
    group: "HivemindOS",
    badge: "Wallet",
    upstreamModel: HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_UPSTREAM_MODEL,
  },
  {
    id: "hivemindos/fast",
    name: "Fast",
    subtitle: "Low-latency wallet-paid route",
    group: "HivemindOS",
    badge: "Wallet",
    upstreamModel: "gpt-5.4-nano",
  },
  {
    id: "hivemindos/frontier",
    name: "Frontier",
    subtitle: "Highest-quality wallet-paid route",
    group: "HivemindOS",
    badge: "Wallet",
    upstreamModel: "gpt-5.5",
  },
  {
    id: "hivemindos/research",
    name: "Research",
    subtitle: "Deeper reasoning wallet-paid route",
    group: "HivemindOS",
    badge: "Wallet",
    upstreamModel: "claude-opus-4.8",
  },
];

export function hivemindosWalletPaidModelIds() {
  return HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.map((model) => model.id);
}

export function normalizeHivemindosWalletPaidModel(model: string | undefined | null) {
  const trimmed = model?.trim() || "";
  if (HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.some((option) => option.id === trimmed)) return trimmed;
  return HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL;
}

export function upstreamHivemindosWalletPaidModel(model: string | undefined | null) {
  const normalized = normalizeHivemindosWalletPaidModel(model);
  return HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS.find((option) => option.id === normalized)?.upstreamModel
    || HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_UPSTREAM_MODEL;
}

export function normalizeHivemindosWalletPaidSlug(slug: string | undefined | null) {
  const normalized = (slug || "default").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(normalized) ? normalized : "default";
}
