import type { FleetAgent } from "@/components/fleet/fleet-data";
import {
  HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
  isFreeHivemindosWalletPaidModel,
} from "@/lib/config/hivemindos-wallet-paid-models";

type ChatReadyFleetAgent = Pick<FleetAgent, "balance" | "model" | "provider">;

export function isHivemindosModelsProvider(provider: string | null | undefined) {
  const normalized = provider?.trim().toLowerCase().replace(/[\s_]+/g, "-") || "";
  return normalized === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER || normalized === "hivemindos";
}

export function fleetAgentNeedsModelSetup(agent: ChatReadyFleetAgent) {
  if (!isHivemindosModelsProvider(agent.provider)) return !agent.model?.trim();

  const freeModelSelected = isFreeHivemindosWalletPaidModel(agent.model);
  if (freeModelSelected) return false;

  return !agent.model?.trim() || agent.balance === "off" || agent.balance === "dead";
}
