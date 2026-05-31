import { NextRequest, NextResponse } from "next/server";
import { sendUsdc } from "@/lib/services/wallet/chain-wallet";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { requireAuth } from "@/lib/utils/server-auth";

const APPROVAL_TTL_MS = 2 * 60 * 1000;
const approvals = new Map<string, { fingerprint: string; expiresAt: number }>();

type SendUsdcBody = {
  action?: "approve" | "send";
  agentId?: string;
  toAddress?: string;
  amountUsd?: number;
  maxPaymentUsd?: number;
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
    if (body.confirmation !== "SEND_USDC") return sendError("Type SEND_USDC to confirm this money-moving action.");

    if (body.action === "approve") {
      const approvalToken = crypto.randomUUID();
      approvals.set(approvalToken, {
        fingerprint: approvalFingerprint(body),
        expiresAt: Date.now() + APPROVAL_TTL_MS,
      });
      return NextResponse.json({ ok: true, approvalToken, expiresAt: Date.now() + APPROVAL_TTL_MS });
    }

    const approval = body.approvalToken ? approvals.get(body.approvalToken) : null;
    approvals.delete(body.approvalToken ?? "");
    if (!approval || approval.expiresAt <= Date.now() || approval.fingerprint !== approvalFingerprint(body)) {
      return sendError("Create a fresh server approval before sending USDC.");
    }

    const agentId = body.agentId!.trim();
    const toAddress = body.toAddress!.trim();
    const amountUsd = Number(body.amountUsd);
    const stored = await getWalletSecret(agentId);
    if (!stored) return NextResponse.json({ ok: false, error: "No local wallet exists for this agent." }, { status: 404 });
    const result = await sendUsdc({
      network: stored.info.network,
      secret: stored.secret,
      fromAddress: stored.info.address,
      toAddress,
      amountUsd,
    });
    return NextResponse.json({ ok: true, signature: result.signature, network: stored.info.network });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to send USDC" }, { status: 500 });
  }
}

function validateSendBody(body: SendUsdcBody) {
  const agentId = body.agentId?.trim();
  const toAddress = body.toAddress?.trim();
  const amountUsd = Number(body.amountUsd);
  if (!agentId) return sendError("agentId is required");
  if (!toAddress) return sendError("Recipient address is required");
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return sendError("Amount must be greater than zero");
  if (body.maxPaymentUsd != null && amountUsd > Number(body.maxPaymentUsd)) {
    return sendError(`Amount exceeds this agent's per-payment cap ($${Number(body.maxPaymentUsd).toFixed(2)})`);
  }
  return null;
}

function sendError(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function approvalFingerprint(body: SendUsdcBody) {
  return JSON.stringify({
    agentId: body.agentId?.trim() ?? "",
    toAddress: body.toAddress?.trim().toLowerCase() ?? "",
    amountUsd: Number(body.amountUsd),
    maxPaymentUsd: body.maxPaymentUsd == null ? null : Number(body.maxPaymentUsd),
  });
}
