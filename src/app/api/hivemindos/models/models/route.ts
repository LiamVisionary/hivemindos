import { NextResponse } from "next/server";

import {
  HIVEMINDOS_WALLET_PAID_MODELS_NAME,
  HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
  customHivemindosWalletPaidModelId,
} from "@/lib/config/hivemindos-wallet-paid-models";
import { hivemindosWalletPaidModelAgentSlug, hivemindosWalletPaidModelOptions } from "@/lib/services/hivemindos-wallet-paid-models";
import { fetchOfficialPaidAgentModelList } from "@/lib/services/paid-agent-cloud-client";

// The static options (free model first, then the wallet-paid routes) are
// always available; the hosted gateway's live inventory is appended as
// selectable custom models when the gateway exposes it.
export async function GET() {
  const staticOptions = hivemindosWalletPaidModelOptions();
  const staticUpstreamIds = new Set(staticOptions.map((model) => model.upstreamModel));
  const gatewayModels = await fetchOfficialPaidAgentModelList(hivemindosWalletPaidModelAgentSlug());
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

  return NextResponse.json({
    object: "list",
    provider: HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
    name: HIVEMINDOS_WALLET_PAID_MODELS_NAME,
    data: [
      ...staticOptions.map((model) => ({
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
        },
      })),
      ...customEntries,
    ],
  });
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
