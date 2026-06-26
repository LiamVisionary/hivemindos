import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  CLAWBANK_CONFIRM,
  clawbankSpotSwap,
  clawbankTradingReport,
  clawbankTradingTokens,
} from "@/lib/services/clawbank";
import { clawbankRouteError, numberField, readJsonBody, requireConfirmation, stringField } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ClawBank autonomous trading (spot swaps against USDC from the self-custody
 * wallet). Engines, per-position P&L, and other surfaces are discovered at
 * runtime — reach them through /api/clawbank/run (clawbank_read / clawbank_call).
 *
 *   GET                                              -> { tokens, report }
 *   POST { action: "swap", baseToken, side, amountUsdc, maxSlippageBps, confirmation } (gated)
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const [tokens, report] = await Promise.all([
    clawbankTradingTokens(),
    clawbankTradingReport(),
  ]);
  if (!tokens.ok && !report.ok) return clawbankRouteError(tokens);
  return NextResponse.json({
    ok: true,
    tokens: tokens.ok ? tokens.data : null,
    report: report.ok ? report.data : null,
    ...(tokens.ok ? {} : { tokensError: tokens.error }),
    ...(report.ok ? {} : { reportError: report.error }),
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(request);
  const action = stringField(body, "action") || "swap";

  if (action === "swap") {
    const baseToken = stringField(body, "baseToken") || stringField(body, "base_token");
    const sideRaw = (stringField(body, "side") || "buy").toLowerCase();
    const amountUsdc = numberField(body, "amountUsdc") ?? numberField(body, "amount_usdc") ?? numberField(body, "amount");
    const maxSlippageBps = numberField(body, "maxSlippageBps") ?? numberField(body, "max_slippage_bps") ?? undefined;
    if (!baseToken) return NextResponse.json({ ok: false, error: "A base_token (the token to trade vs USDC) is required." }, { status: 400 });
    if (sideRaw !== "buy" && sideRaw !== "sell") return NextResponse.json({ ok: false, error: 'side must be "buy" or "sell".' }, { status: 400 });
    if (amountUsdc === null || amountUsdc <= 0) return NextResponse.json({ ok: false, error: "A positive amount_usdc is required." }, { status: 400 });
    const gate = requireConfirmation(body.confirmation, CLAWBANK_CONFIRM.SWAP, "ClawBank swaps trade real funds from the self-custody wallet.");
    if (gate) return gate;
    const result = await clawbankSpotSwap({
      baseToken,
      side: sideRaw as "buy" | "sell",
      amountUsdc,
      maxSlippageBps: maxSlippageBps === undefined ? undefined : maxSlippageBps,
    });
    if (!result.ok) return clawbankRouteError(result);
    return NextResponse.json({ ok: true, action, data: result.data });
  }

  return NextResponse.json({ ok: false, error: `Unknown trading action "${action}". Use swap, or /api/clawbank/run for engines and P&L.` }, { status: 400 });
}
