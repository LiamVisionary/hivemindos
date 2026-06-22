import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { executeGovernedUsdcSend } from "@/lib/services/wallet/governed-send";

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

    const result = await executeGovernedUsdcSend({
      agentId: body.agentId!.trim(),
      toAddress: body.toAddress!.trim(),
      amountUsd: Number(body.amountUsd),
      approvalToken: body.approvalToken,
    });
    if (!result.ok) {
      const status = result.status === "not_found" ? 404 : result.status === "blocked" ? 403 : result.status === "pending_approval" ? 202 : 400;
      return NextResponse.json({ ok: false, status: result.status === "error" ? undefined : result.status, error: result.error, approval: result.approval }, { status });
    }
    return NextResponse.json({ ok: true, signature: result.signature, network: result.network });
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
