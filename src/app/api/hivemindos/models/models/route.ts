import { NextResponse } from "next/server";

import {
  HIVEMINDOS_WALLET_PAID_MODELS_NAME,
  HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
} from "@/lib/config/hivemindos-wallet-paid-models";
import { hivemindosWalletPaidModelOptions } from "@/lib/services/hivemindos-wallet-paid-models";

export async function GET() {
  return NextResponse.json({
    object: "list",
    provider: HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
    name: HIVEMINDOS_WALLET_PAID_MODELS_NAME,
    data: hivemindosWalletPaidModelOptions().map((model) => ({
      id: model.id,
      object: "model",
      owned_by: "hivemindos",
      display_name: model.name,
      metadata: {
        subtitle: model.subtitle,
        group: model.group,
        badge: model.badge,
      },
    })),
  });
}
