import type { FleetAgent } from "@/components/fleet/fleet-data";
import {
  HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
  isFreeHivemindosWalletPaidModel,
} from "@/lib/config/hivemindos-wallet-paid-models";

type ChatReadyFleetAgent = Pick<FleetAgent, "balance" | "model" | "provider">;
type RuntimeModelSelection = {
  provider?: string;
  model?: string;
  providers?: Array<{ slug?: string }>;
};

export type FleetAgentChatBlocker = {
  kind: "local-model" | "model" | "funding";
  runtimeDetected?: boolean;
  title: string;
};

export function isHivemindosModelsProvider(provider: string | null | undefined) {
  const normalized = provider?.trim().toLowerCase().replace(/[\s_]+/g, "-") || "";
  return normalized === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER || normalized === "hivemindos";
}

function normalizedProvider(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[\s_]+/g, "-") || "";
}

function runtimeModelForAgent(agent: ChatReadyFleetAgent, runtimeSelection?: RuntimeModelSelection) {
  const agentProvider = normalizedProvider(agent.provider);
  const runtimeProvider = normalizedProvider(runtimeSelection?.provider);
  if (agentProvider && runtimeProvider && agentProvider !== runtimeProvider) return "";
  return runtimeSelection?.model?.trim() || "";
}

export function fleetAgentNeedsModelSetup(agent: ChatReadyFleetAgent, runtimeSelection?: RuntimeModelSelection) {
  const selectedModel = agent.model?.trim() || runtimeModelForAgent(agent, runtimeSelection);
  if (!isHivemindosModelsProvider(agent.provider)) return !selectedModel;

  const freeModelSelected = isFreeHivemindosWalletPaidModel(selectedModel);
  if (freeModelSelected) return false;

  return !selectedModel || agent.balance === "off" || agent.balance === "dead";
}

export function fleetAgentChatBlocker(
  agent: ChatReadyFleetAgent,
  runtimeSelection?: RuntimeModelSelection,
): FleetAgentChatBlocker | null {
  if (!fleetAgentNeedsModelSetup(agent, runtimeSelection)) return null;
  const selectedModel = agent.model?.trim() || runtimeModelForAgent(agent, runtimeSelection);
  if (isHivemindosModelsProvider(agent.provider) && selectedModel) {
    return { kind: "funding", title: "Add model credits first" };
  }
  const localProviderDetected = [agent.provider, runtimeSelection?.provider, ...(runtimeSelection?.providers ?? []).map((provider) => provider.slug)]
    .some((provider) => ["lm-studio", "local", "openai-compatible"].includes(normalizedProvider(provider)));
  return localProviderDetected
    ? { kind: "local-model", runtimeDetected: Boolean(runtimeSelection), title: "Choose a local chat model" }
    : { kind: "model", title: "Choose a chat model" };
}
