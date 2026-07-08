import { NextResponse } from "next/server";

import { HIVE_COMPUTE_MODEL_OPTIONS, hiveComputeHostedModelId } from "@/lib/config/hive-compute-marketplace";
import {
  HIVEMINDOS_WALLET_PAID_MODELS_NAME,
  HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
  customHivemindosWalletPaidModelId,
  isComputeFirstHivemindosModel,
} from "@/lib/config/hivemindos-wallet-paid-models";
import { readHiveComputeMarketplaceStatus } from "@/lib/services/hive-compute-marketplace";
import { hivemindosWalletPaidModelAgentSlug, hivemindosWalletPaidModelOptions } from "@/lib/services/hivemindos-wallet-paid-models";
import { fetchOfficialPaidAgentModelList } from "@/lib/services/paid-agent-cloud-client";

// GPU-first tiers lead the list, then the free/default model and remaining
// OpenRouter-backed hosted routes. The hosted gateway's live inventory is
// appended as selectable custom models when the gateway exposes it.
export async function GET() {
  const staticOptions = hivemindosWalletPaidModelOptions();
  const staticUpstreamIds = new Set(staticOptions.map((model) => model.upstreamModel));
  const [gatewayModels, computeMarketplaceRows] = await Promise.all([
    fetchOfficialPaidAgentModelList(hivemindosWalletPaidModelAgentSlug()),
    fetchHiveComputeMarketplaceRows(),
  ]);
  const customEntries = gatewayModels
    .filter((model) => !staticUpstreamIds.has(model.id))
    .map((model) => ({
      id: customHivemindosWalletPaidModelId(model.id),
      object: "model",
      owned_by: "hivemindos",
      display_name: model.displayName || model.id,
      metadata: {
        subtitle: retailPriceSubtitle(model.promptUsdPerToken, model.completionUsdPerToken) || "Wallet-paid gateway model",
        group: "Gateway",
        badge: "Wallet",
        tier: "paid",
        upstreamModel: model.id,
        created: model.created,
        promptUsdPerToken: model.promptUsdPerToken,
        completionUsdPerToken: model.completionUsdPerToken,
      },
    }));
  const staticRows = staticOptions.map((model) => {
    const computeFirst = isComputeFirstHivemindosModel(model.id);
    let preferredRoute = "openrouter";
    if (computeFirst) preferredRoute = "hive-compute";
    else if (model.tier === "free") preferredRoute = "hivemindos-free";
    return {
      id: model.id,
      object: "model",
      owned_by: "hivemindos",
      display_name: model.name,
      metadata: {
        subtitle: model.subtitle,
        group: model.group,
        badge: model.badge,
        tier: model.tier,
        upstreamModel: model.upstreamModel,
        preferredRoute,
        fallbackRoute: computeFirst ? "openrouter" : undefined,
      },
    };
  });
  const computeFirstRows = staticRows.filter((model) => isComputeFirstHivemindosModel(model.id));
  const remainingStaticRows = staticRows.filter((model) => !isComputeFirstHivemindosModel(model.id));

  return NextResponse.json({
    object: "list",
    provider: HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
    name: HIVEMINDOS_WALLET_PAID_MODELS_NAME,
    data: [
      ...computeFirstRows,
      ...computeMarketplaceRows,
      ...remainingStaticRows,
      ...customEntries,
    ],
  });
}

async function fetchHiveComputeMarketplaceRows() {
  try {
    const status = await readHiveComputeMarketplaceStatus();
    const aliasIds = new Set(HIVE_COMPUTE_MODEL_OPTIONS.map((model) => model.id));
    const liveModels = new Set(status.gateway.capacity?.liveModels ?? []);
    const relayModels = new Set(status.gateway.capacity?.keyRelayModels ?? []);
    const ids = new Set([
      ...(status.gateway.models?.ok ? status.gateway.models.ids : []),
      ...liveModels,
      ...relayModels,
    ]);
    return [...ids].filter((id) => id && !aliasIds.has(id)).sort().map((id) => ({
      id: hiveComputeHostedModelId(id),
      object: "model",
      owned_by: "hivemindos",
      display_name: id,
      metadata: {
        subtitle: liveModels.has(id) ? "Live Hive Compute worker model" : relayModels.has(id) ? "Hive Compute key-relay model" : "Hive Compute marketplace model",
        group: "Hive Compute",
        badge: "SALE",
        tier: "paid",
        upstreamModel: id,
        preferredRoute: "hive-compute",
      },
    }));
  } catch {
    return [];
  }
}

// "$0.94 in · $5.63 out /1M" — retail per-million-token prices (markup already
// applied by the gateway), compact enough for a model chip subtitle.
function retailPriceSubtitle(promptUsdPerToken?: number, completionUsdPerToken?: number): string {
  if (promptUsdPerToken === undefined || completionUsdPerToken === undefined) return "";
  const perMillion = (value: number) => {
    const usd = value * 1_000_000;
    if (usd === 0) return "$0";
    if (usd >= 100) return `$${Math.round(usd)}`;
    return `$${usd.toFixed(2).replace(/0$/, "")}`;
  };
  return `${perMillion(promptUsdPerToken)} in · ${perMillion(completionUsdPerToken)} out /1M`;
}
