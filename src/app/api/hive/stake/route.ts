import { NextRequest, NextResponse } from "next/server";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { stakeHiveFromLocalWallet } from "@/lib/services/hive-staking-local";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StakeBody = {
  agentId?: string;
  amountHive?: string | number;
  tokenAddress?: string;
  confirmation?: string;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as StakeBody;
    const agentId = body.agentId?.trim();
    const amountHive = String(body.amountHive ?? "").trim();
    if (!agentId) return stakeError("agentId is required");
    if (!amountHive || !Number.isFinite(Number(amountHive)) || Number(amountHive) <= 0) {
      return stakeError("Stake amount must be greater than zero.");
    }
    if (body.confirmation !== "STAKE_HIVE") {
      return stakeError("Type STAKE_HIVE to confirm this staking transaction.");
    }

    const stored = await getWalletSecret(agentId);
    if (!stored) return NextResponse.json({ ok: false, error: "No local wallet exists for this wallet row." }, { status: 404 });
    if (stored.info.network !== "eip155:8453") return stakeError("HIVE staking is only supported on Base mainnet.");

    const result = await stakeHiveFromLocalWallet({
      secret: stored.secret,
      fromAddress: stored.info.address,
      amountHive,
      tokenAddress: body.tokenAddress,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to stake HIVE." }, { status: 500 });
  }
}

function stakeError(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
