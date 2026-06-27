import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  CLAWBANK_CONFIRM,
  clawbankSendUsdc,
  clawbankTokenBalance,
  clawbankTopupLink,
  clawbankWalletAddress,
} from "@/lib/services/clawbank";
import { clawbankRouteError, numberField, readJsonBody, requireConfirmation, stringField } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ClawBank self-custody wallet (Base/XRPL, KYC-free).
 *
 *   GET  ?symbol=USDC                          -> { address, balance }
 *   POST { action: "send_usdc", toAddress, amount, confirmation } (gated)
 *   POST { action: "topup_link", amount }      -> card/Apple Pay funding link
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const symbol = new URL(request.url).searchParams.get("symbol")?.trim() || undefined;
  const [address, balance] = await Promise.all([
    clawbankWalletAddress(),
    clawbankTokenBalance(symbol),
  ]);
  if (!address.ok && !balance.ok) return clawbankRouteError(address);
  return NextResponse.json({
    ok: true,
    address: address.ok ? address.data : null,
    balance: balance.ok ? balance.data : null,
    ...(address.ok ? {} : { addressError: address.error }),
    ...(balance.ok ? {} : { balanceError: balance.error }),
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(request);
  const action = stringField(body, "action") || "send_usdc";

  if (action === "topup_link") {
    const amount = numberField(body, "amount");
    if (amount === null || amount <= 0) return NextResponse.json({ ok: false, error: "A positive amount is required for a top-up link." }, { status: 400 });
    const result = await clawbankTopupLink(amount);
    if (!result.ok) return clawbankRouteError(result);
    return NextResponse.json({ ok: true, action, data: result.data });
  }

  if (action === "send_usdc") {
    const toAddress = stringField(body, "toAddress") || stringField(body, "to_address");
    const amount = numberField(body, "amount") ?? numberField(body, "amountUsdc") ?? numberField(body, "amount_usdc") ?? numberField(body, "amountUsd");
    if (!toAddress) return NextResponse.json({ ok: false, error: "A recipient address is required." }, { status: 400 });
    if (amount === null || amount <= 0) return NextResponse.json({ ok: false, error: "A positive USDC amount is required." }, { status: 400 });
    const gate = requireConfirmation(body.confirmation, CLAWBANK_CONFIRM.SEND_USDC, "ClawBank USDC sends move real funds from the self-custody wallet.");
    if (gate) return gate;
    const result = await clawbankSendUsdc({ toAddress, amount });
    if (!result.ok) return clawbankRouteError(result);
    return NextResponse.json({ ok: true, action, data: result.data });
  }

  return NextResponse.json({ ok: false, error: `Unknown wallet action "${action}". Use send_usdc or topup_link.` }, { status: 400 });
}
