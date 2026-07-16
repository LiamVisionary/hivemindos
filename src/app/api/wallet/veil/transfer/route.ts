import { NextRequest, NextResponse } from "next/server";
import {
  VEIL_CASH_NETWORK,
  VEIL_CASH_TRANSFER_ASSETS,
  VEIL_CASH_TRANSFER_CONFIRMATION,
  VEIL_CASH_TRANSFER_CONFIRMATION_LABEL,
  VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM,
  type VeilCashTransferAsset,
} from "@/lib/config/veil-cash";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { veilEnvValue } from "@/lib/services/wallet/veil-cli";
import { executeVeilPrivateTransfer, veilPrivateTransferErrorMessage } from "@/lib/services/wallet/veil-private-transfer";
import { requireAuth } from "@/lib/utils/server-auth";
import { evaluateSpend, loadGovernanceWallet, resolveSpendGovernance } from "@/lib/services/wallet/spend-governance";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import {
  assertTradingPlatformFeeReady,
  collectTradingPlatformFee,
  quoteTradingPlatformFee,
} from "@/lib/services/wallet/platform-fees";

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
  /** Client hint only. The route trusts persisted wallet policy for auto-send. */
  autoSendEnabled?: boolean;
  autoShield?: boolean;
  duplicateGuardEnabled?: boolean;
  duplicateGuardSeconds?: number | string;
  approvalToken?: string;
  companyTaskId?: string;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as VeilTransferBody;
    const agentId = body.agentId?.trim();
    const persisted = agentId ? await loadGovernanceWallet(agentId).catch(() => null) : null;
    const governance = persisted
      ? await resolveSpendGovernance(agentId!, { companyTaskId: body.companyTaskId })
      : null;
    // Personal (`user:`) wallets never auto-spend: explicit confirmation is always
    // required for a private transfer, regardless of any persisted policy.
    const isPersonalWallet = Boolean(body.agentId?.trim().startsWith("user:"));
    const validation = validateTransferBody(body, {
      autoSendAllowed: !isPersonalWallet && canAutoSendVeilTransfer(persisted?.wallet),
      wallet: persisted?.wallet,
    });
    if (validation) return validation;

    const asset = normalizeAsset(body.asset);
    if (!asset) return sendError("Veil private transfers currently support ETH or USDC.");
    const amount = normalizeAmount(body.amount ?? body.amountUsd, asset);
    const recipient = body.recipientAddress!.trim();
    const veilKey = await veilEnvValue("VEIL_KEY");
    if (!veilKey) return sendError("VEIL_KEY is not configured in the server environment. Run Veil setup before private transfers.", 424);

    // Wallet governance is always active; explicit active company tasks add
    // their company freeze and cumulative budgets.
    // USDC is 1:1 USD; ETH uses the caller-supplied USD value when available.
    const usdValue = asset === "USDC" ? Number(amount) : Number(body.amountUsd ?? 0);
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
        companyId: governance.companyId,
        explanation: {
          summary: "This is a private transfer through Veil. The app paused before submitting it.",
          whyNow: "The transfer crossed a wallet governance rule and needs a human decision before execution.",
          impact: `Approving lets the agent send ${amount} ${asset} to the private recipient. Rejecting keeps the transfer blocked.`,
          requestedAction: "Approve only if the recipient, asset, and amount are expected. Reject if the agent should revise the transfer.",
          evidence: [
            `Recipient: ${recipient}`,
            `Asset: ${asset}`,
            `Amount: ${amount}`,
          ],
          missingContext: [],
          source: "Veil private transfer",
        },
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

    let feeWallet: Awaited<ReturnType<typeof getWalletSecret>> | null = null;
    if (usdValue > 0) {
      const feeNetwork = persisted?.wallet.network ?? VEIL_CASH_NETWORK;
      const feeQuote = await quoteTradingPlatformFee({ source: "veil-transfer", network: feeNetwork, amountUsd: usdValue });
      if (feeQuote.enabled) {
        if (!agentId) return sendError("agentId is required to collect the HivemindOS platform fee for private transfers.");
        feeWallet = await getWalletSecret(agentId);
        if (!feeWallet) return sendError("No local wallet exists for this agent, so the HivemindOS platform fee cannot be collected.", 424);
        await assertTradingPlatformFeeReady({ source: "veil-transfer", network: feeWallet.info.network, amountUsd: usdValue });
      }
    }

    const result = await executeVeilPrivateTransfer({
      agentId,
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
    const platformFee = feeWallet && usdValue > 0
      ? await collectTradingPlatformFee({
        agentId: agentId!,
        network: feeWallet.info.network,
        secret: feeWallet.secret,
        fromAddress: feeWallet.info.address,
        amountUsd: usdValue,
        source: "veil-transfer",
        companyId,
      })
      : undefined;
    return NextResponse.json({
      ok: true,
      platformFee,
      ...result,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: veilPrivateTransferErrorMessage(error) }, { status: 400 });
  }
}

function validateTransferBody(body: VeilTransferBody, options: { autoSendAllowed?: boolean; wallet?: AgentWalletConfig } = {}) {
  if (body.enabled !== true) return sendError("Wallet spending is off for this agent. Enable Spend on before executing private transfers.", 403);
  if (body.provider !== "veil") return sendError("Set this agent's payment provider to Veil Cash before private transfers.");
  if (body.network !== VEIL_CASH_NETWORK) return sendError("Veil Cash transfers are only supported on Base mainnet.");
  const asset = normalizeAsset(body.asset);
  if (!asset || !VEIL_CASH_TRANSFER_ASSETS.includes(asset)) return sendError("Veil private transfers currently support ETH or USDC.");
  if (!options.autoSendAllowed && !isTransferConfirmed(body.confirmation)) return sendError(`Type ${VEIL_CASH_TRANSFER_CONFIRMATION_LABEL} to confirm this private transfer, or enable Veil auto-send for this wallet.`);

  const recipient = body.recipientAddress?.trim();
  if (!recipient || !EVM_ADDRESS.test(recipient)) return sendError("Recipient must be a valid 0x Ethereum address.");

  const amount = normalizeAmount(body.amount ?? body.amountUsd, asset);
  const amountPattern = asset === "ETH" ? ETH_DECIMAL : USDC_DECIMAL;
  if (!amountPattern.test(amount) || Number(amount) <= 0) {
    return sendError(asset === "ETH"
      ? "Amount must be a positive ETH value with up to 18 decimals."
      : "Amount must be a positive USDC value with up to 6 decimals.");
  }

  // Resolve the per-asset cap. The crypto-router's prepared body omits the cap
  // for an asset the wallet has no explicit assetSpendCap for (e.g. a USDC
  // transfer from a wallet that only set an ETH cap), so fall back to the
  // persisted wallet's per-asset cap, then its USD payment cap. Without this the
  // in-app Veil USDC transfer rejected with "USDC spend cap must be zero or greater."
  const persistedCap = options.wallet ? (options.wallet.assetSpendCaps?.[asset] ?? options.wallet.maxPaymentUsd) : undefined;
  const maxAssetAmount = Number(body.maxAssetAmount ?? body.maxPaymentUsd ?? persistedCap);
  if (!Number.isFinite(maxAssetAmount) || maxAssetAmount < 0) return sendError(`${asset} spend cap must be zero or greater.`);
  if (Number(amount) > maxAssetAmount) return sendError(`Amount exceeds this agent's ${asset} spend cap (${formatAssetAmount(maxAssetAmount, asset)}).`);
  if (normalizeRecipientMode(body.recipientMode) !== "registered" && asset === "USDC" && Number(amount) < VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM) {
    return sendError(`Veil public-recipient USDC withdrawals currently require at least ${VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM} USDC.`);
  }
  return null;
}

function canAutoSendVeilTransfer(wallet?: AgentWalletConfig) {
  return Boolean(
    wallet?.veilAutoSendEnabled === true
    && wallet.enabled === true
    && wallet.provider === "veil"
    && wallet.network === VEIL_CASH_NETWORK
  );
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
