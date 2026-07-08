import { sendUsdStable } from "@/lib/services/wallet/chain-wallet";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { evaluateSpend, resolveSpendGovernance } from "@/lib/services/wallet/spend-governance";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";
import {
  assertTradingPlatformFeeReady,
  collectTradingPlatformFee,
  quoteTradingPlatformFee,
  type PlatformFeeCollection,
  type PlatformFeeQuote,
} from "@/lib/services/wallet/platform-fees";

export type GovernedUsdcSendResult =
  | { ok: true; signature: string; network: string; assetSymbol: "USDC" | "USDG"; platformFee?: PlatformFeeCollection }
  | { ok: false; status: "not_found" | "blocked" | "pending_approval" | "error"; error: string; approval?: unknown };

export async function quoteGovernedUsdcSendFee(input: {
  network: string;
  amountUsd: number;
}): Promise<PlatformFeeQuote> {
  return quoteTradingPlatformFee({ source: "wallet-send", network: input.network, amountUsd: input.amountUsd });
}

/**
 * Execute a governed on-chain dollar-stable transfer. This is the single source of truth
 * shared by POST /api/wallet/send and the chat-runtime send interceptor, so both
 * apply the same governance (company kill switch, cumulative budgets, approval
 * escalation) and ledger accounting. Callers are responsible for the explicit
 * confirmation gate (SEND_USDC) and the never-auto rule for personal wallets —
 * this function assumes the spend was already authorized for execution.
 */
export async function executeGovernedUsdcSend(input: {
  agentId: string;
  toAddress: string;
  amountUsd: number;
  approvalToken?: string;
  approvalThresholdSatisfied?: boolean;
}): Promise<GovernedUsdcSendResult> {
  const agentId = input.agentId.trim();
  const toAddress = input.toAddress.trim();
  const amountUsd = Number(input.amountUsd);

  const stored = await getWalletSecret(agentId);
  if (!stored) return { ok: false, status: "not_found", error: "No local wallet exists for this agent." };

  // Governance: company kill switch, cumulative budgets, and approval escalation.
  const governance = await resolveSpendGovernance(agentId);
  let grantId: string | undefined;
  let companyId: string | undefined;
  if (governance) {
    const decision = await evaluateSpend({
      wallet: governance.wallet,
      agentName: governance.agentName,
      kind: "send",
      asset: stableAssetSymbol(stored.info.network),
      amountUsd,
      target: toAddress,
      approvalToken: input.approvalToken,
      approvalThresholdSatisfied: input.approvalThresholdSatisfied,
      explanation: {
        summary: "This is an on-chain stablecoin transfer from a local agent wallet.",
        whyNow: "The transfer amount crossed a wallet governance rule and was paused before signing.",
        impact: `Approving signs and sends $${amountUsd.toFixed(2)} to the recipient address. Rejecting keeps the transfer blocked.`,
        requestedAction: "Approve only if this recipient and amount are expected. Reject if the agent should revise the recipient, amount, or reason.",
        evidence: [
          `Recipient: ${toAddress}`,
          `Network: ${stored.info.network}`,
        ],
        missingContext: [],
        source: "Governed wallet send",
      },
    });
    if (decision.decision === "block") {
      return { ok: false, status: "blocked", error: decision.reason };
    }
    if (decision.decision === "approve") {
      return { ok: false, status: "pending_approval", error: decision.reason, approval: decision.approval };
    }
    grantId = decision.grant?.id;
    companyId = decision.companyId;
  }

  await assertTradingPlatformFeeReady({
    source: "wallet-send",
    network: stored.info.network,
    amountUsd,
  });

  const result = await sendUsdStable({
    network: stored.info.network,
    secret: stored.secret,
    fromAddress: stored.info.address,
    toAddress,
    amountUsd,
  });
  const platformFee = await collectTradingPlatformFee({
    agentId,
    network: stored.info.network,
    secret: stored.secret,
    fromAddress: stored.info.address,
    amountUsd,
    source: "wallet-send",
    companyId,
  });
  await appendSpend({
    agentId,
    companyId,
    kind: "send",
    asset: result.assetSymbol,
    amountUsd,
    target: shortTarget(toAddress),
    status: "executed",
    approvalId: grantId,
    transactionHash: result.signature,
  }).catch(() => {});
  return { ok: true, signature: result.signature, network: stored.info.network, assetSymbol: result.assetSymbol, platformFee };
}

function stableAssetSymbol(network: string): "USDC" | "USDG" {
  return network === "eip155:4663" ? "USDG" : "USDC";
}
