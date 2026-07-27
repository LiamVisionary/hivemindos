import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  CLAWBANK_CONFIRM,
  clawbankDepositInstructions,
  clawbankMoneyBalance,
  clawbankMoneyTransfer,
} from "@/lib/services/clawbank";
import { clawbankRouteError, numberField, readJsonBody, requireConfirmation, stringField } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ClawBank bank rails (custodial, via Bridge.xyz — KYC-required, distinct from
 * the self-custody wallet). Off-ramp/bank-link flows are discovered at runtime;
 * reach them through /api/clawbank/run.
 *
 *   GET                                                  -> { balance, deposit }
 *   POST { action: "transfer", chain, toAddress, amount, confirmation } (gated)
 *
 * Banking endpoints are the only ones that return `bridge_customer_required`;
 * that surfaces as the upstream error here when KYC is incomplete.
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const [balance, deposit] = await Promise.all([
    clawbankMoneyBalance(),
    clawbankDepositInstructions(),
  ]);
  if (!balance.ok && !deposit.ok) return clawbankRouteError(balance);
  return NextResponse.json({
    ok: true,
    balance: balance.ok ? balance.data : null,
    deposit: deposit.ok ? deposit.data : null,
    ...(balance.ok ? {} : { balanceError: balance.error }),
    ...(deposit.ok ? {} : { depositError: deposit.error }),
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(request);
  const action = stringField(body, "action") || "transfer";

  if (action === "transfer") {
    const chain = stringField(body, "chain");
    const toAddress = stringField(body, "toAddress") || stringField(body, "to_address");
    const amount = numberField(body, "amount") ?? numberField(body, "amountUsdc") ?? numberField(body, "amount_usdc") ?? numberField(body, "amountUsd");
    if (!chain) return NextResponse.json({ ok: false, error: "A chain is required for a custodial transfer." }, { status: 400 });
    if (!toAddress) return NextResponse.json({ ok: false, error: "A recipient address is required." }, { status: 400 });
    if (amount === null || amount <= 0) return NextResponse.json({ ok: false, error: "A positive amount is required." }, { status: 400 });
    const gate = requireConfirmation(body.confirmation, CLAWBANK_CONFIRM.MONEY_TRANSFER, "ClawBank custodial transfers move real funds from the Bridge-backed account.");
    if (gate) return gate;
    const result = await clawbankMoneyTransfer({ chain, toAddress, amount });
    if (!result.ok) return clawbankRouteError(result);
    return NextResponse.json({ ok: true, action, data: result.data });
  }

  return NextResponse.json({ ok: false, error: `Unknown money action "${action}". Use transfer, or /api/clawbank/run for off-ramp and bank linking.` }, { status: 400 });
}
