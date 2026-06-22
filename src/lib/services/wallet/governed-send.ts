import { sendUsdc } from "@/lib/services/wallet/chain-wallet";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { evaluateSpend, resolveSpendGovernance } from "@/lib/services/wallet/spend-governance";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";

export type GovernedUsdcSendResult =
  | { ok: true; signature: string; network: string }
  | { ok: false; status: "not_found" | "blocked" | "pending_approval" | "error"; error: string; approval?: unknown };

/**
 * Execute a governed on-chain USDC transfer. This is the single source of truth
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
      asset: "USDC",
      amountUsd,
      target: toAddress,
      approvalToken: input.approvalToken,
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
  return { ok: true, signature: result.signature, network: stored.info.network };
}
