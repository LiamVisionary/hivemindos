import "server-only";

import type { AgentSpendCapAsset, AgentWalletConfig } from "@/lib/types/agent-wallet";
import { getCompanyForAgent } from "@/lib/services/companies-store";
import { readWalletLedger } from "@/lib/services/obsidian/wallet-ledger";
import {
  ROLLING_DAY_MS,
  ROLLING_MONTH_MS,
  readSpendLedger,
  sumAgentSpendUsdSince,
  sumCompanySpendUsdSince,
} from "@/lib/services/wallet/spend-ledger";
import type { SpendKind } from "@/lib/services/wallet/spend-ledger";
import {
  consumeApproval,
  enqueueApproval,
  type SpendApprovalRequest,
} from "@/lib/services/wallet/spend-approvals";

/**
 * Single governance chokepoint for every spend rail. It layers three NEW
 * controls on top of the per-transaction hard cap / per-asset cap that each rail
 * already enforces inline:
 *   1. Company kill switch (frozen) — hard block across all member agents.
 *   2. Cumulative rolling budgets — per-agent and per-company daily/monthly/total.
 *   3. Approval threshold — escalate to a human, then execute once on retry.
 */

export type SpendGovernanceWallet = Pick<
  AgentWalletConfig,
  "agentId" | "approvalRequiredOverUsd" | "dailyBudgetUsd" | "monthlyBudgetUsd"
>;

export type SpendGovernanceInput = {
  wallet: SpendGovernanceWallet;
  agentName?: string;
  kind: SpendKind;
  asset: AgentSpendCapAsset;
  /** USD value of the proposed spend. For non-USD assets pass the best-effort USD value. */
  amountUsd: number;
  assetAmount?: number;
  target?: string;
  /** Granted approval id supplied by the agent when retrying an escalated spend. */
  approvalToken?: string;
  /** True when the caller already completed a concrete server-side user approval for this exact spend. */
  approvalThresholdSatisfied?: boolean;
  now?: number;
};

export type SpendBudgetSnapshot = {
  agentDailyRemainingUsd: number | null;
  agentMonthlyRemainingUsd: number | null;
  companyDailyRemainingUsd: number | null;
  companyMonthlyRemainingUsd: number | null;
  companyTotalRemainingUsd: number | null;
  companyFrozen: boolean;
};

export type SpendDecision = {
  decision: "allow" | "approve" | "block";
  reason: string;
  /** Resolved company id this agent belongs to (for ledger tagging), if any. */
  companyId?: string;
  /** Present when decision === "approve": the pending escalation row. */
  approval?: SpendApprovalRequest;
  /** Present when decision === "allow" via a consumed grant. */
  grant?: SpendApprovalRequest;
  budget: SpendBudgetSnapshot;
};

/**
 * Cheap predicate: does this wallet have any governance control that could bind?
 * Lets rails skip the (async, network-touching) governance path entirely for
 * agents that have not opted into budgets/companies/approval — zero behaviour
 * change for them.
 */
/**
 * Load the authoritative persisted wallet config for an agent so governance
 * reads its company/budget/threshold fields from the source of truth rather
 * than trusting a request body. Returns null when no wallet record exists.
 */
export async function loadGovernanceWallet(agentId: string): Promise<{ wallet: AgentWalletConfig; agentName: string } | null> {
  if (!agentId?.trim()) return null;
  const ledger = await readWalletLedger();
  const record = ledger.records.find((entry) => entry.agentId === agentId);
  if (!record) return null;
  return { wallet: record.wallet, agentName: record.agentName };
}

/**
 * Resolve the governance wallet for a spend. Prefers the agent's persisted wallet
 * config; when none exists but the agent is a company member, synthesizes a
 * minimal company-only wallet (no per-agent budgets/approval) so the company kill
 * switch + budgets STILL bind and the spend is tagged with its companyId. Returns
 * null only when neither a wallet config nor a company applies, so rails can keep
 * skipping governance entirely for truly ungoverned agents.
 */
export async function resolveSpendGovernance(
  agentId: string,
): Promise<{ wallet: SpendGovernanceWallet; agentName?: string } | null> {
  const direct = await loadGovernanceWallet(agentId);
  if (direct) return { wallet: direct.wallet, agentName: direct.agentName };
  if (!agentId?.trim()) return null;
  const company = await getCompanyForAgent(agentId.trim());
  if (company) return { wallet: { agentId: agentId.trim(), approvalRequiredOverUsd: 0 } };
  return null;
}

export function governanceActive(wallet: SpendGovernanceWallet): boolean {
  if ((wallet.dailyBudgetUsd ?? 0) > 0) return true;
  if ((wallet.monthlyBudgetUsd ?? 0) > 0) return true;
  return false;
}

/**
 * Approval can only ever bind when the threshold is below the per-transaction
 * cap (otherwise the hard cap clips the amount under the threshold first). Rails
 * pass their maxPaymentUsd so x402 can skip the pre-flight when approval is moot.
 */
export function approvalCanBind(wallet: SpendGovernanceWallet, maxPaymentUsd: number): boolean {
  const threshold = Number(wallet.approvalRequiredOverUsd) || 0;
  return threshold > 0 && threshold < maxPaymentUsd;
}

/**
 * Async gate for rails (x402) that want to skip the governance pre-flight
 * entirely when nothing could bind: any wallet budget, an approval threshold
 * below the per-payment cap, or membership in a company (which carries its own
 * budgets and kill switch).
 */
export async function shouldEvaluateSpend(wallet: SpendGovernanceWallet, maxPaymentUsd: number): Promise<boolean> {
  if (governanceActive(wallet) || approvalCanBind(wallet, maxPaymentUsd)) return true;
  return Boolean(await getCompanyForAgent(wallet.agentId));
}

function remaining(cap: number | undefined, spent: number, amount: number): { remaining: number | null; exceeded: boolean } {
  if (!cap || cap <= 0) return { remaining: null, exceeded: false };
  const left = Math.round((cap - spent) * 100) / 100;
  return { remaining: left, exceeded: spent + amount > cap + 1e-9 };
}

export async function evaluateSpend(input: SpendGovernanceInput): Promise<SpendDecision> {
  const now = input.now ?? Date.now();
  const amount = Math.max(0, Number(input.amountUsd) || 0);
  const wallet = input.wallet;

  const company = await getCompanyForAgent(wallet.agentId);
  const companyId = company?.id;
  const ledger = await readSpendLedger();

  const agentDaily = remaining(
    wallet.dailyBudgetUsd,
    await sumAgentSpendUsdSince(wallet.agentId, now - ROLLING_DAY_MS, ledger),
    amount,
  );
  const agentMonthly = remaining(
    wallet.monthlyBudgetUsd,
    await sumAgentSpendUsdSince(wallet.agentId, now - ROLLING_MONTH_MS, ledger),
    amount,
  );

  const companyDailySpent = company ? await sumCompanySpendUsdSince(company.id, now - ROLLING_DAY_MS, ledger) : 0;
  const companyMonthlySpent = company ? await sumCompanySpendUsdSince(company.id, now - ROLLING_MONTH_MS, ledger) : 0;
  const companyTotalSpent = company ? await sumCompanySpendUsdSince(company.id, 0, ledger) : 0;
  const companyDaily = remaining(company?.dailyBudgetUsd, companyDailySpent, amount);
  const companyMonthly = remaining(company?.monthlyBudgetUsd, companyMonthlySpent, amount);
  const companyTotal = remaining(company?.totalBudgetUsd, companyTotalSpent, amount);

  const budget: SpendBudgetSnapshot = {
    agentDailyRemainingUsd: agentDaily.remaining,
    agentMonthlyRemainingUsd: agentMonthly.remaining,
    companyDailyRemainingUsd: companyDaily.remaining,
    companyMonthlyRemainingUsd: companyMonthly.remaining,
    companyTotalRemainingUsd: companyTotal.remaining,
    companyFrozen: Boolean(company?.frozen),
  };

  const block = (reason: string): SpendDecision => ({ decision: "block", reason, companyId, budget });

  // 1. Kill switch.
  if (company?.frozen) {
    return block(`Company "${company.name}" is frozen (kill switch on). All agent spending is halted.`);
  }

  // 2. Cumulative budgets (hard — never overridable by an approval).
  if (agentDaily.exceeded) return block(`This spend would exceed the agent's daily budget ($${wallet.dailyBudgetUsd?.toFixed(2)}; $${agentDaily.remaining?.toFixed(2)} left).`);
  if (agentMonthly.exceeded) return block(`This spend would exceed the agent's monthly budget ($${wallet.monthlyBudgetUsd?.toFixed(2)}; $${agentMonthly.remaining?.toFixed(2)} left).`);
  if (companyDaily.exceeded) return block(`This spend would exceed company "${company?.name}"'s daily budget ($${company?.dailyBudgetUsd?.toFixed(2)}; $${companyDaily.remaining?.toFixed(2)} left).`);
  if (companyMonthly.exceeded) return block(`This spend would exceed company "${company?.name}"'s monthly budget ($${company?.monthlyBudgetUsd?.toFixed(2)}; $${companyMonthly.remaining?.toFixed(2)} left).`);
  if (companyTotal.exceeded) return block(`This spend would exceed company "${company?.name}"'s total budget ($${company?.totalBudgetUsd?.toFixed(2)}; $${companyTotal.remaining?.toFixed(2)} left).`);

  // 3. Approval threshold.
  const threshold = Number(wallet.approvalRequiredOverUsd) || 0;
  if (threshold > 0 && amount > threshold) {
    if (input.approvalThresholdSatisfied) {
      return { decision: "allow", reason: "Approval threshold satisfied by the direct send action.", companyId, budget };
    }
    const grant = await consumeApproval({ agentId: wallet.agentId, asset: input.asset, amountUsd: amount, token: input.approvalToken });
    if (grant) {
      return { decision: "allow", reason: `Authorised by approval ${grant.id}.`, companyId, grant, budget };
    }
    const approval = await enqueueApproval({
      agentId: wallet.agentId,
      agentName: input.agentName,
      companyId,
      kind: input.kind,
      asset: input.asset,
      amountUsd: amount,
      assetAmount: input.assetAmount,
      target: input.target,
      reason: `Exceeds approval threshold ($${threshold.toFixed(2)}).`,
    });
    return {
      decision: "approve",
      reason: `Spending $${amount.toFixed(2)} needs human approval (over $${threshold.toFixed(2)}). Pending request ${approval.id}.`,
      companyId,
      approval,
      budget,
    };
  }

  return { decision: "allow", reason: "Within budget and approval limits.", companyId, budget };
}
