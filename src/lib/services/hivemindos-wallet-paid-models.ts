import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import {
  HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG_ENV,
  HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG_PUBLIC_ENV,
  HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL,
  HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
  HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS,
  normalizeHivemindosWalletPaidModel,
  normalizeHivemindosWalletPaidSlug,
} from "@/lib/config/hivemindos-wallet-paid-models";

export type HivemindosWalletPaidRuntimeConfig = {
  baseUrl: string;
  chatPath: string;
  statusPath: string;
  model: string;
  headers: Record<string, string>;
};

export function isHivemindosWalletPaidModelProfile(profile: Pick<AgentProfile, "provider">) {
  return profile.provider?.trim().toLowerCase() === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER;
}

export function hivemindosWalletPaidModelOptions() {
  return [...HIVEMINDOS_WALLET_PAID_MODEL_OPTIONS];
}

export function selectedHivemindosWalletPaidModel(profile: Pick<AgentProfile, "model">) {
  return normalizeHivemindosWalletPaidModel(profile.model || HIVEMINDOS_WALLET_PAID_MODELS_DEFAULT_MODEL);
}

export function hivemindosWalletPaidModelAgentSlug() {
  return normalizeHivemindosWalletPaidSlug(
    process.env[HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG_ENV]
    || process.env[HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG_PUBLIC_ENV],
  );
}

export function resolveHivemindosWalletPaidModelRuntimeConfig(
  profile: AgentProfile,
  wallet: AgentWalletConfig | undefined,
  requestOrigin: string,
): HivemindosWalletPaidRuntimeConfig {
  if (!requestOrigin) {
    throw new Error("HivemindOS Models need the dashboard request origin to route wallet-paid calls.");
  }
  const walletAgentId = profile.hivemindosModels?.walletVaultId?.trim() || wallet?.agentId?.trim() || profile.id?.trim();
  if (!walletAgentId) {
    throw new Error("Select an agent with a local wallet before using HivemindOS Models.");
  }
  return {
    baseUrl: `${requestOrigin.replace(/\/+$/, "")}/api/hivemindos/models`,
    chatPath: "/chat/completions",
    statusPath: "/models",
    model: selectedHivemindosWalletPaidModel(profile),
    headers: {
      "X-HivemindOS-Wallet-Agent-Id": walletAgentId,
      "X-HivemindOS-Wallet-Model-Slug": hivemindosWalletPaidModelAgentSlug(),
    },
  };
}
