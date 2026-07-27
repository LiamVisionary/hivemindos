import { NextRequest, NextResponse } from "next/server";
import { getWalletBalance } from "@/lib/services/wallet/chain-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function walletBalanceErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();
  if (lower.includes("over rate limit") || lower.includes("rate limit") || lower.includes("too many request") || lower.includes("429")) {
    return "Wallet RPC providers are temporarily rate limiting balance reads. Try Refresh again in a moment.";
  }
  if (lower.includes("fetch failed") || lower.includes("timeout") || lower.includes("etimedout") || lower.includes("econnreset")) {
    return "Could not reach the wallet balance providers. Try Refresh again in a moment.";
  }
  if (lower.includes("unsupported wallet network") || lower.includes("wallet address is required")) {
    return message;
  }
  return "Could not refresh this wallet balance. Try Refresh again in a moment.";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      address?: string;
      network?: string;
    };
    const address = body.address?.trim();
    if (!address) return NextResponse.json({ ok: false, error: "address is required" }, { status: 400 });
    const balance = await getWalletBalance(address, body.network || "eip155:8453");
    return NextResponse.json({ ok: true, balance });
  } catch (error) {
    return NextResponse.json({ ok: false, error: walletBalanceErrorMessage(error) }, { status: 500 });
  }
}
