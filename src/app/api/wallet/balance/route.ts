import { NextRequest, NextResponse } from "next/server";
import { getWalletBalance } from "@/lib/services/wallet/chain-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to fetch balance" }, { status: 500 });
  }
}
