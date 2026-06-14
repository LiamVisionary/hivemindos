import { NextRequest, NextResponse } from "next/server";
import {
  VEIL_CASH_NETWORK,
  VEIL_CASH_TRANSFER_ASSETS,
  VEIL_CASH_TRANSFER_CONFIRMATION,
  VEIL_CASH_TRANSFER_CONFIRMATION_LABEL,
  VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM,
  type VeilCashTransferAsset,
} from "@/lib/config/veil-cash";
import { veilEnvValue } from "@/lib/services/wallet/veil-cli";
import { executeVeilPrivateTransfer, veilPrivateTransferErrorMessage } from "@/lib/services/wallet/veil-private-transfer";
import { requireAuth } from "@/lib/utils/server-auth";
import { evaluateSpend, resolveSpendGovernance } from "@/lib/services/wallet/spend-governance";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const USDC_DECIMAL = /^\d+(?:\.\d{1,6})?$/;
const ETH_DECIMAL = /^\d+(?:\.\d{1,18})?$/;

type VeilTransferBody = {
  agentId?: string;
  enabled?: boolean;
  provider?: string;
  network?: string;
  asset?: string;
  recipientMode?: string;
  recipientAddress?: string;
  amount?: number | string;
  amountUsd?: number | string;
  maxPaymentUsd?: number | string;
  maxAssetAmount?: number | string;
  confirmation?: string;
  autoShield?: boolean;
  duplicateGuardEnabled?: boolean;
  duplicateGuardSeconds?: number | string;
  approvalToken?: string;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as VeilTransferBody;
    const validation = validateTransferBody(body);
    if (validation) return validation;

    const asset = normalizeAsset(body.asset);
    if (!asset) return sendError("Veil private transfers currently support ETH or USDC.");
    const amount = normalizeAmount(body.amount ?? body.amountUsd, asset);
    const recipient = body.recipientAddress!.trim();
    const veilKey = await veilEnvValue("VEIL_KEY");
    if (!veilKey) return sendError("VEIL_KEY is not configured in the server environment. Run Veil setup before private transfers.", 424);

    // Governance: company kill switch, cumulative budgets, and approval escalation.
    // USDC is 1:1 USD; ETH uses the caller-supplied USD value when available.
    const usdValue = asset === "USDC" ? Number(amount) : Number(body.amountUsd ?? 0);
    const governance = body.agentId ? await resolveSpendGovernance(body.agentId.trim()) : null;
    let grantId: string | undefined;
    let companyId: string | undefined;
    if (governance) {
      const decision = await evaluateSpend({
        wallet: governance.wallet,
        agentName: governance.agentName,
        kind: "veil-transfer",
        asset,
        amountUsd: usdValue,
        assetAmount: Number(amount),
        target: recipient,
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

    const result = await executeVeilPrivateTransfer({
      agentId: body.agentId,
      asset,
      amount,
      recipient,
      recipientMode: normalizeRecipientMode(body.recipientMode),
      autoShield: body.autoShield === true,
      duplicateGuardEnabled: body.duplicateGuardEnabled !== false,
      duplicateGuardSeconds: normalizeGuardSeconds(body.duplicateGuardSeconds),
    });
    if (governance) {
      await appendSpend({
        agentId: body.agentId!.trim(),
        companyId,
        kind: "veil-transfer",
        asset,
        amountUsd: usdValue,
        assetAmount: Number(amount),
        target: shortTarget(recipient),
        status: "executed",
        approvalId: grantId,
      }).catch(() => {});
    }
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: veilPrivateTransferErrorMessage(error) }, { status: 400 });
  }
}

function validateTransferBody(body: VeilTransferBody) {
  if (body.enabled !== true) return sendError("Wallet spending is off for this agent. Enable Spend on before executing private transfers.", 403);
  if (body.provider !== "veil") return sendError("Set this agent's payment provider to Veil Cash before private transfers.");
  if (body.network !== VEIL_CASH_NETWORK) return sendError("Veil Cash transfers are only supported on Base mainnet.");
  const asset = normalizeAsset(body.asset);
  if (!asset || !VEIL_CASH_TRANSFER_ASSETS.includes(asset)) return sendError("Veil private transfers currently support ETH or USDC.");
  if (!isTransferConfirmed(body.confirmation)) return sendError(`Type ${VEIL_CASH_TRANSFER_CONFIRMATION_LABEL} to confirm this private transfer.`);

  const recipient = body.recipientAddress?.trim();
  if (!recipient || !EVM_ADDRESS.test(recipient)) return sendError("Recipient must be a valid 0x Ethereum address.");

  const amount = normalizeAmount(body.amount ?? body.amountUsd, asset);
  const amountPattern = asset === "ETH" ? ETH_DECIMAL : USDC_DECIMAL;
  if (!amountPattern.test(amount) || Number(amount) <= 0) {
    return sendError(asset === "ETH"
      ? "Amount must be a positive ETH value with up to 18 decimals."
      : "Amount must be a positive USDC value with up to 6 decimals.");
  }

  const maxAssetAmount = Number(body.maxAssetAmount ?? body.maxPaymentUsd);
  if (!Number.isFinite(maxAssetAmount) || maxAssetAmount < 0) return sendError(`${asset} spend cap must be zero or greater.`);
  if (Number(amount) > maxAssetAmount) return sendError(`Amount exceeds this agent's ${asset} spend cap (${formatAssetAmount(maxAssetAmount, asset)}).`);
  if (normalizeRecipientMode(body.recipientMode) !== "registered" && asset === "USDC" && Number(amount) < VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM) {
    return sendError(`Veil public-recipient USDC withdrawals currently require at least ${VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM} USDC.`);
  }
  return null;
}

function normalizeAmount(value: number | string | undefined, asset: VeilCashTransferAsset): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toFixed(asset === "ETH" ? 18 : 6).replace(/\.?0+$/, "") : "";
  return value?.trim() ?? "";
}

function normalizeAsset(value: unknown): VeilCashTransferAsset | null {
  if (value == null || value === "") return "USDC";
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase();
  if (normalized === "ETH" || normalized === "USDC") return normalized;
  return null;
}

function normalizeRecipientMode(value: unknown): "public" | "registered" {
  return typeof value === "string" && value.trim().toLowerCase() === "registered" ? "registered" : "public";
}

function normalizeGuardSeconds(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : undefined;
}

function isTransferConfirmed(value: unknown) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toUpperCase();
  return normalized === VEIL_CASH_TRANSFER_CONFIRMATION || normalized === VEIL_CASH_TRANSFER_CONFIRMATION_LABEL;
}

function formatAssetAmount(value: number, asset: VeilCashTransferAsset): string {
  if (asset === "ETH") return `${value.toFixed(6)} ETH`;
  return `$${value.toFixed(2)} USDC`;
}

function sendError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
