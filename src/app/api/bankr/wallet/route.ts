import { NextRequest, NextResponse } from "next/server";
import { executeBankrAction, validateBankrActionReadiness } from "@/lib/services/bankr-actions";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read the Bankr-managed wallet (the wallet behind the BANKR_API_KEY) so the Trade
 * tab can show it as a pickable account. Read-only: it just reads the portfolio.
 * Returns { configured:false } when no Bankr credential is set.
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const missing = await validateBankrActionReadiness();
  if (missing) return NextResponse.json({ ok: true, configured: false });

  try {
    const result = await executeBankrAction({ intent: "portfolio", prompt: "portfolio", readOnly: true });
    const raw = (result as { raw?: unknown }).raw;
    return NextResponse.json({
      ok: true,
      configured: true,
      address: extractWalletAddress(raw),
      balanceUsd: extractTotalUsd(raw),
    });
  } catch (error) {
    // Key is present but the read failed — still report configured so the wallet
    // shows up; the card just won't have a fresh balance.
    return NextResponse.json({ ok: true, configured: true, address: "", balanceUsd: null, error: error instanceof Error ? error.message : "Could not read the Bankr wallet." });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/** Defensive: the Bankr portfolio shape isn't a fixed contract, so probe common fields. */
function extractWalletAddress(raw: unknown): string {
  const record = asRecord(raw);
  const direct = firstString(record, ["address", "walletAddress", "account", "accountAddress", "evmAddress", "ethAddress"]);
  if (direct) return direct;
  return firstString(asRecord(record.wallet), ["address", "walletAddress", "account"]);
}

function extractTotalUsd(raw: unknown): number | null {
  const record = asRecord(raw);
  const direct = firstNumber(record, ["totalUsd", "totalValueUsd", "balanceUsd", "netWorthUsd", "portfolioValueUsd", "usdValue"]);
  if (direct !== null) return direct;
  // Bankr's actual shape: balances is a map of network -> { nativeUsd, tokenBalances: [{ token: { balanceUSD } }] }.
  const balances = record.balances;
  if (balances && typeof balances === "object" && !Array.isArray(balances)) {
    let total = 0;
    let found = false;
    for (const net of Object.values(balances as Record<string, unknown>)) {
      const netRecord = asRecord(net);
      const nativeUsd = Number(netRecord.nativeUsd);
      if (Number.isFinite(nativeUsd)) { total += nativeUsd; found = true; }
      const tokenBalances = netRecord.tokenBalances;
      if (Array.isArray(tokenBalances)) {
        for (const entry of tokenBalances) {
          const token = asRecord(asRecord(entry).token);
          const usd = Number(token.balanceUSD ?? token.balanceUsd);
          if (Number.isFinite(usd)) { total += usd; found = true; }
        }
      }
    }
    if (found) return Math.round(total * 100) / 100;
  }
  for (const key of ["tokens", "balances", "holdings", "assets", "positions"]) {
    const list = record[key];
    if (Array.isArray(list)) {
      return Math.round(list.reduce((sum: number, item) => sum + (firstNumber(asRecord(item), ["balanceUsd", "usdValue", "valueUsd", "value", "totalUsd"]) ?? 0), 0) * 100) / 100;
    }
  }
  return null;
}
