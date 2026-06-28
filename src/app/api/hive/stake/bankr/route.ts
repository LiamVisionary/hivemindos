import { NextRequest, NextResponse } from "next/server";
import { validateBankrActionReadiness } from "@/lib/services/bankr-actions";
import { stakeHiveFromBankrWallet } from "@/lib/services/hive-staking-bankr";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StakeBody = {
  amountHive?: string | number;
  tokenAddress?: string;
  confirmation?: string;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as StakeBody;
    const amountHive = String(body.amountHive ?? "").trim();
    if (!amountHive || !Number.isFinite(Number(amountHive)) || Number(amountHive) <= 0) {
      return stakeError("Stake amount must be greater than zero.");
    }
    if (body.confirmation !== "STAKE_HIVE") {
      return stakeError("Type STAKE_HIVE to confirm this staking transaction.");
    }
    const missing = await validateBankrActionReadiness();
    if (missing) return stakeError(missing);

    const result = await stakeHiveFromBankrWallet({ amountHive, tokenAddress: body.tokenAddress });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to stake HIVE through Bankr.";
    // A read-only key (or one without arbitrary contract calls) is the most common
    // setup failure here — surface the fix rather than the raw 403 text.
    const writeBlocked = /read[\s-]?only|not enabled|forbidden|\b403\b/i.test(message);
    return NextResponse.json({
      ok: false,
      error: writeBlocked
        ? "This Bankr API key can't submit transactions. Enable write access (and arbitrary contract calls) for the key in Bankr settings, then try again."
        : message,
    }, { status: writeBlocked ? 403 : 500 });
  }
}

function stakeError(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
