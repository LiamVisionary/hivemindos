import { NextRequest, NextResponse } from "next/server";
import { sendUsdc } from "@/lib/services/wallet/chain-wallet";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { requireAuth } from "@/lib/utils/server-auth";
import { evaluateSpend, resolveSpendGovernance } from "@/lib/services/wallet/spend-governance";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";

type SendUsdcBody = {
  agentId?: string;
  toAddress?: string;
  amountUsd?: number;
  maxPaymentUsd?: number;
  autoPayEnabled?: boolean;
  confirmation?: string;
  approvalToken?: string;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as SendUsdcBody;
    const validation = validateSendBody(body);
    if (validation) return validation;
    // Personal (`user:`) wallets never auto-spend: ignore any auto-pay flag so an
    // explicit SEND_USDC confirmation is always required. The user (or an agent
    // they tell) can still send "from my wallet" — it just always confirms.
    const isPersonalWallet = String(body.agentId || "").startsWith("user:");
    const autoPayEnabled = Boolean(body.autoPayEnabled) && !isPersonalWallet;
    if (!autoPayEnabled && body.confirmation !== "SEND_USDC") {
      return sendError("Wallet auto-use is off. Type SEND_USDC to confirm this transfer.");
    }

    const agentId = body.agentId!.trim();
    const toAddress = body.toAddress!.trim();
    const amountUsd = Number(body.amountUsd);
    const stored = await getWalletSecret(agentId);
    if (!stored) return NextResponse.json({ ok: false, error: "No local wallet exists for this agent." }, { status: 404 });

    // Governance: company kill switch, cumulative budgets, and approval escalation.
    // resolveSpendGovernance also covers company members that lack their own wallet
    // config, so the company kill switch/budgets bind for them too.
    const governance = await resolveSpendGovernance(agentId);
    let grantId: string | undefined;
    let companyId: string | undefined;
    if (governance) {
      const decision = await evaluateSpend({
        wallet: governance.wallet,
        agentName: governance.agentName,
        kind: "send",
        asset: "USDC",
        amountUsd,
        target: toAddress,
        approvalToken: body.approvalToken,
      });
      if (decision.decision === "block") {
        return NextResponse.json({ ok: false, status: "blocked", error: decision.reason }, { status: 403 });
      }
      if (decision.decision === "approve") {
        return NextResponse.json(
          { ok: false, status: "pending_approval", error: decision.reason, approval: decision.approval },
          { status: 202 },
        );
      }
      grantId = decision.grant?.id;
      companyId = decision.companyId;
    }

    const result = await sendUsdc({
      network: stored.info.network,
      secret: stored.secret,
      fromAddress: stored.info.address,
      toAddress,
      amountUsd,
    });
    await appendSpend({
      agentId,
      companyId,
      kind: "send",
      asset: "USDC",
      amountUsd,
      target: shortTarget(toAddress),
      status: "executed",
      approvalId: grantId,
    }).catch(() => {});
    return NextResponse.json({ ok: true, signature: result.signature, network: stored.info.network });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to send USDC" }, { status: 500 });
  }
}

function validateSendBody(body: SendUsdcBody) {
  const agentId = body.agentId?.trim();
  const toAddress = body.toAddress?.trim();
  const amountUsd = Number(body.amountUsd);
  const maxPaymentUsd = Number(body.maxPaymentUsd);
  if (!agentId) return sendError("agentId is required");
  if (!toAddress) return sendError("Recipient address is required");
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return sendError("Amount must be greater than zero");
  if (body.maxPaymentUsd != null && (!Number.isFinite(maxPaymentUsd) || maxPaymentUsd < 0)) {
    return sendError("Per-payment cap must be zero or greater.");
  }
  if (body.maxPaymentUsd != null && amountUsd > maxPaymentUsd) {
    return sendError(`Amount exceeds this agent's per-payment cap ($${maxPaymentUsd.toFixed(2)})`);
  }
  return null;
}

function sendError(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
