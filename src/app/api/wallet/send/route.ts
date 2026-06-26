import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/utils/server-auth";
import { executeGovernedUsdcSend } from "@/lib/services/wallet/governed-send";

type SendUsdcBody = {
  action?: string;
  agentId?: string;
  toAddress?: string;
  amountUsd?: number;
  maxPaymentUsd?: number;
  autoPayEnabled?: boolean;
  confirmation?: string;
  approvalToken?: string;
};

type RouteSendApproval = {
  agentId: string;
  toAddress: string;
  amountUsd: number;
  maxPaymentUsd?: number;
  expiresAtMs: number;
};

const SEND_APPROVAL_TTL_MS = 60_000;
const routeSendApprovals = new Map<string, RouteSendApproval>();

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
    if (body.action && body.action !== "approve" && body.action !== "send") {
      return sendError(`Unsupported wallet send action: ${body.action}`);
    }
    if (body.action === "approve") {
      const approval = createRouteSendApproval(body);
      return NextResponse.json({
        ok: true,
        approvalToken: approval.token,
        expiresAt: new Date(approval.expiresAtMs).toISOString(),
      });
    }
    const approvalError = consumeRouteSendApproval(body);
    if (approvalError) return approvalError;

    const result = await executeGovernedUsdcSend({
      agentId: body.agentId!.trim(),
      toAddress: body.toAddress!.trim(),
      amountUsd: Number(body.amountUsd),
      approvalToken: body.approvalToken,
      approvalThresholdSatisfied: true,
    });
    if (!result.ok) {
      const status = result.status === "not_found" ? 404 : result.status === "blocked" ? 403 : result.status === "pending_approval" ? 202 : 400;
      return NextResponse.json({ ok: false, status: result.status === "error" ? undefined : result.status, error: result.error, approval: result.approval }, { status });
    }
    return NextResponse.json({ ok: true, signature: result.signature, network: result.network, platformFee: result.platformFee });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to send USDC" }, { status: 500 });
  }
}

function createRouteSendApproval(body: SendUsdcBody) {
  pruneRouteSendApprovals();
  const token = randomUUID();
  const expiresAtMs = Date.now() + SEND_APPROVAL_TTL_MS;
  routeSendApprovals.set(token, {
    agentId: body.agentId!.trim(),
    toAddress: body.toAddress!.trim(),
    amountUsd: Number(body.amountUsd),
    maxPaymentUsd: body.maxPaymentUsd == null ? undefined : Number(body.maxPaymentUsd),
    expiresAtMs,
  });
  return { token, expiresAtMs };
}

function consumeRouteSendApproval(body: SendUsdcBody) {
  pruneRouteSendApprovals();
  const token = body.approvalToken?.trim();
  if (!token) return sendError("A fresh server approval is required before sending USDC.");
  const approval = routeSendApprovals.get(token);
  if (approval) routeSendApprovals.delete(token);
  if (!approval || !matchesRouteSendApproval(approval, body)) {
    return sendError("A fresh server approval is required before sending USDC.");
  }
  return null;
}

function pruneRouteSendApprovals() {
  const now = Date.now();
  for (const [token, approval] of routeSendApprovals) {
    if (approval.expiresAtMs <= now) routeSendApprovals.delete(token);
  }
}

function matchesRouteSendApproval(approval: RouteSendApproval, body: SendUsdcBody) {
  return approval.agentId === body.agentId?.trim()
    && approval.toAddress.toLowerCase() === body.toAddress?.trim().toLowerCase()
    && sameUsd(approval.amountUsd, Number(body.amountUsd))
    && sameOptionalUsd(approval.maxPaymentUsd, body.maxPaymentUsd == null ? undefined : Number(body.maxPaymentUsd));
}

function sameOptionalUsd(left: number | undefined, right: number | undefined) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return sameUsd(left, right);
}

function sameUsd(left: number, right: number) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 0.0001;
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
