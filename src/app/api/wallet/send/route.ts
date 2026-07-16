import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/utils/server-auth";
import { executeGovernedUsdcSend } from "@/lib/services/wallet/governed-send";
import { executePersonalWalletAssetSend } from "@/lib/services/wallet/personal-wallet-asset-send";

type SendUsdcBody = {
  action?: string;
  agentId?: string;
  toAddress?: string;
  amountUsd?: number;
  maxPaymentUsd?: number;
  autoPayEnabled?: boolean;
  confirmation?: string;
  approvalToken?: string;
  gasSponsorAgentId?: string;
  companyTaskId?: string;
  asset?: string;
  assetAmount?: string | number;
  tokenAddress?: string;
};

type RouteSendApproval = (
  | { kind: "stable"; agentId: string; toAddress: string; amountUsd: number; maxPaymentUsd?: number; gasSponsorAgentId?: string; companyTaskId?: string }
  | { kind: "asset"; agentId: string; toAddress: string; asset: string; assetAmount: string; tokenAddress?: string }
) & { expiresAtMs: number };

const SEND_APPROVAL_TTL_MS = 60_000;
const routeSendApprovals = new Map<string, RouteSendApproval>();

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as SendUsdcBody;
    const validation = validateSendBody(body);
    if (validation) return validation;
    const assetTransfer = hasAssetTransferFields(body);
    // Personal (`user:`) wallets never auto-spend: ignore any auto-pay flag so an
    // explicit SEND_USDC confirmation is always required. The user (or an agent
    // they tell) can still send "from my wallet" — it just always confirms.
    const isPersonalWallet = String(body.agentId || "").startsWith("user:");
    const autoPayEnabled = Boolean(body.autoPayEnabled) && !isPersonalWallet;
    if (assetTransfer && !isPersonalWallet) {
      return sendError("Arbitrary-token sends are available only from personal wallets.");
    }
    if (assetTransfer && body.confirmation !== "SEND_TOKEN") {
      return sendError("Confirm this personal-wallet token transfer before sending.");
    }
    if (!assetTransfer && !autoPayEnabled && body.confirmation !== "SEND_USDC") {
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

    if (assetTransfer) {
      const result = await executePersonalWalletAssetSend({
        agentId: body.agentId!.trim(),
        toAddress: body.toAddress!.trim(),
        asset: normalizeAssetSymbol(body.asset),
        assetAmount: canonicalAssetAmount(body.assetAmount),
        tokenAddress: body.tokenAddress?.trim() || undefined,
      });
      if (!result.ok) return sendExecutionError(result);
      return NextResponse.json({ ok: true, signature: result.signature, network: result.network, assetSymbol: result.assetSymbol, assetAmount: result.assetAmount });
    }
    const result = await executeGovernedUsdcSend({
      agentId: body.agentId!.trim(),
      toAddress: body.toAddress!.trim(),
      amountUsd: Number(body.amountUsd),
      gasSponsorAgentId: body.gasSponsorAgentId?.trim() || undefined,
      approvalToken: body.approvalToken,
      approvalThresholdSatisfied: true,
      companyTaskId: body.companyTaskId?.trim() || undefined,
    });
    if (!result.ok) return sendExecutionError(result);
    return NextResponse.json({ ok: true, signature: result.signature, network: result.network, assetSymbol: result.assetSymbol, platformFee: result.platformFee, gasAssist: result.gasAssist });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to send stablecoin" }, { status: 500 });
  }
}

function sendExecutionError(result: { status: string; error: string; approval?: unknown }) {
  const status = result.status === "not_found" ? 404 : result.status === "blocked" ? 403 : result.status === "pending_approval" ? 202 : 400;
  return NextResponse.json({ ok: false, status: result.status === "error" ? undefined : result.status, error: result.error, approval: result.approval }, { status });
}

function createRouteSendApproval(body: SendUsdcBody) {
  pruneRouteSendApprovals();
  const token = randomUUID();
  const expiresAtMs = Date.now() + SEND_APPROVAL_TTL_MS;
  routeSendApprovals.set(token, hasAssetTransferFields(body) ? {
    kind: "asset",
    agentId: body.agentId!.trim(),
    toAddress: body.toAddress!.trim(),
    asset: normalizeAssetSymbol(body.asset),
    assetAmount: canonicalAssetAmount(body.assetAmount),
    tokenAddress: body.tokenAddress?.trim() || undefined,
    expiresAtMs,
  } : {
    kind: "stable",
    agentId: body.agentId!.trim(),
    toAddress: body.toAddress!.trim(),
    amountUsd: Number(body.amountUsd),
    maxPaymentUsd: body.maxPaymentUsd == null ? undefined : Number(body.maxPaymentUsd),
    gasSponsorAgentId: body.gasSponsorAgentId?.trim() || undefined,
    companyTaskId: body.companyTaskId?.trim() || undefined,
    expiresAtMs,
  });
  return { token, expiresAtMs };
}

function consumeRouteSendApproval(body: SendUsdcBody) {
  pruneRouteSendApprovals();
  const token = body.approvalToken?.trim();
  if (!token) return sendError("A fresh server approval is required before sending this transfer.");
  const approval = routeSendApprovals.get(token);
  if (approval) routeSendApprovals.delete(token);
  if (!approval || !matchesRouteSendApproval(approval, body)) {
    return sendError("A fresh server approval is required before sending this transfer.");
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
  if (approval.agentId !== body.agentId?.trim() || approval.toAddress.toLowerCase() !== body.toAddress?.trim().toLowerCase()) return false;
  if (approval.kind === "asset") {
    return approval.asset === normalizeAssetSymbol(body.asset)
      && approval.assetAmount === canonicalAssetAmount(body.assetAmount)
      && approval.tokenAddress === (body.tokenAddress?.trim() || undefined);
  }
  return !hasAssetTransferFields(body)
    && sameUsd(approval.amountUsd, Number(body.amountUsd))
    && sameOptionalUsd(approval.maxPaymentUsd, body.maxPaymentUsd == null ? undefined : Number(body.maxPaymentUsd))
    && approval.gasSponsorAgentId === (body.gasSponsorAgentId?.trim() || undefined)
    && approval.companyTaskId === (body.companyTaskId?.trim() || undefined);
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
  if (!agentId) return sendError("agentId is required");
  if (!toAddress) return sendError("Recipient address is required");
  if (hasAssetTransferFields(body)) {
    const asset = normalizeAssetSymbol(body.asset);
    if (!asset || !/^[A-Z0-9._-]{1,32}$/.test(asset)) return sendError("A valid asset symbol is required");
    const amount = canonicalAssetAmount(body.assetAmount);
    if (!amount || Number(amount) <= 0) return sendError("Asset amount must be greater than zero");
    if ((body.tokenAddress?.trim().length ?? 0) > 128) return sendError("Token address is too long");
    return null;
  }
  const amountUsd = Number(body.amountUsd);
  const maxPaymentUsd = Number(body.maxPaymentUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return sendError("Amount must be greater than zero");
  if (body.maxPaymentUsd != null && (!Number.isFinite(maxPaymentUsd) || maxPaymentUsd < 0)) {
    return sendError("Per-payment cap must be zero or greater.");
  }
  if (body.maxPaymentUsd != null && amountUsd > maxPaymentUsd) {
    return sendError(`Amount exceeds this agent's per-payment cap ($${maxPaymentUsd.toFixed(2)})`);
  }
  return null;
}

function hasAssetTransferFields(body: SendUsdcBody): boolean {
  return body.asset != null || body.assetAmount != null || body.tokenAddress != null;
}

function normalizeAssetSymbol(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function canonicalAssetAmount(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return "";
  const [whole, fraction = ""] = text.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function sendError(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
