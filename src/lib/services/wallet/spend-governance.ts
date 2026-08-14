import "server-only";

import type { AgentSpendCapAsset, AgentWalletConfig } from "@/lib/types/agent-wallet";
import type { ReasoningTrail } from "@/lib/types/reasoning-trail";
import { getCompany } from "@/lib/services/companies-store";
import { readBoard } from "@/lib/services/kanban/local-kanban-store";
import { companyIdFromSource } from "@/lib/services/queen-bee/company-task-context";
import { readWalletLedger } from "@/lib/services/obsidian/wallet-ledger";
import {
  ROLLING_DAY_MS,
  ROLLING_MONTH_MS,
  readSpendLedger,
  sumAgentSpendUsdSince,
  sumCompanyMemberSpendUsdSince,
  sumCompanySpendUsdSince,
} from "@/lib/services/wallet/spend-ledger";
import type { SpendKind } from "@/lib/services/wallet/spend-ledger";
import {
  consumeApproval,
  enqueueApproval,
  type SpendApprovalRequest,
} from "@/lib/services/wallet/spend-approvals";
import { buildSpendApprovalReasoning } from "@/lib/utils/spend-approval-reasoning";
import {
  normalizeAgentWalletAssignments,
  primaryAgentWalletForAgent,
  walletPermissionForAgent,
  walletWithAgentPermission,
} from "@/lib/utils/agent-wallet";
import type { AgentWalletPermissionMode } from "@/lib/types/agent-wallet";

/**
 * Single governance chokepoint for every spend rail. It layers three NEW
 * controls on top of the per-transaction hard cap / per-asset cap that each rail
 * already enforces inline. Company controls are present only when the operation
 * is bound to a validated active company task:
 *   1. Company kill switch (frozen) — hard block for that company task.
 *   2. Cumulative rolling budgets — per-agent and task-company daily/monthly/total.
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
  /** Human-facing context to attach when this spend becomes an approval request. */
  explanation?: Partial<ReasoningTrail>;
  /** Validated company id returned by resolveSpendGovernance for a company task. */
  companyId?: string;
  now?: number;
};

export type SpendBudgetSnapshot = {
  agentDailyRemainingUsd: number | null;
  agentMonthlyRemainingUsd: number | null;
  companyMemberDailyRemainingUsd: number | null;
  companyDailyRemainingUsd: number | null;
  companyMonthlyRemainingUsd: number | null;
  companyTotalRemainingUsd: number | null;
  companyFrozen: boolean;
};

export type SpendDecision = {
  decision: "allow" | "approve" | "block";
  reason: string;
  /** Resolved company id for the active company task (for ledger tagging), if any. */
  companyId?: string;
  /** Present when decision === "approve": the pending escalation row. */
  approval?: SpendApprovalRequest;
  /** Present when decision === "allow" via a consumed grant. */
  grant?: SpendApprovalRequest;
  budget: SpendBudgetSnapshot;
  explanation?: ReasoningTrail;
};

/**
 * Cheap predicate: does this wallet have any governance control that could bind?
 * Lets rails skip the (async, network-touching) governance path entirely for
 * agents that have not opted into wallet budgets/approval — zero behaviour
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
  return { wallet: normalizeAgentWalletAssignments(record.wallet, record.agentId), agentName: record.agentName };
}

export type GovernedWalletAccess = {
  walletId: string;
  wallet: AgentWalletConfig;
  walletName: string;
  actingAgentId?: string;
  permissionMode?: AgentWalletPermissionMode;
};

/**
 * Resolve a wallet id (or, for compatibility, an agent id) to an authoritative
 * ledger wallet. When an acting agent is supplied, attachment is mandatory and
 * the returned auto-pay flag is narrowed to that agent's permission.
 */
export async function resolveGovernedWalletAccess(
  walletOrAgentId: string,
  actingAgentId?: string,
  options: { vaultPath?: string } = {},
): Promise<GovernedWalletAccess | null> {
  const requestedId = walletOrAgentId.trim();
  const actorId = actingAgentId?.trim() || "";
  if (!requestedId) return null;
  const ledger = await readWalletLedger(options.vaultPath);
  const direct = ledger.records.find((entry) => entry.agentId === requestedId);
  if (direct) {
    const normalized = normalizeAgentWalletAssignments(direct.wallet, direct.agentId);
    if (!actorId) {
      return { walletId: direct.agentId, wallet: normalized, walletName: direct.agentName };
    }
    const effective = walletWithAgentPermission(normalized, actorId);
    if (!effective) return null;
    return {
      walletId: direct.agentId,
      wallet: effective,
      walletName: direct.agentName,
      actingAgentId: actorId,
      permissionMode: walletPermissionForAgent(normalized, actorId) ?? undefined,
    };
  }

  const inferredActorId = actorId || requestedId;
  const walletsById = Object.fromEntries(ledger.records.map((entry) => [entry.agentId, entry.wallet]));
  const effective = primaryAgentWalletForAgent(walletsById, inferredActorId);
  if (!effective) return null;
  const record = ledger.records.find((entry) => entry.agentId === effective.agentId);
  return {
    walletId: effective.agentId,
    wallet: effective,
    walletName: record?.agentName || effective.name || effective.agentId,
    actingAgentId: inferredActorId,
    permissionMode: walletPermissionForAgent(effective, inferredActorId) ?? undefined,
  };
}

/**
 * Resolve the wallet policy for a spend. Company governance is deliberately
 * opt-in per operation: callers must supply an active company Work Board task.
 * Membership alone never changes an ordinary wallet operation.
 */
export async function resolveSpendGovernance(
  agentId: string,
  context: { companyTaskId?: string } = {},
): Promise<{ wallet: SpendGovernanceWallet; agentName?: string; companyId?: string; companyTaskId?: string } | null> {
  const direct = await loadGovernanceWallet(agentId);
  const companyTaskId = context.companyTaskId?.trim();
  if (!companyTaskId) return direct ? { wallet: direct.wallet, agentName: direct.agentName } : null;
  if (!agentId?.trim()) throw new Error("A company task spend requires an agent id.");

  const board = await readBoard(null);
  const task = board.tasks.find((candidate) => candidate.id === companyTaskId);
  if (!task) throw new Error("The supplied company task does not exist on the Work Board.");
  const companyId = companyIdFromSource(task.source);
  if (!companyId) throw new Error("The supplied Work Board task is not company work.");
  if (task.status !== "working") throw new Error("Company spend is allowed only while its Work Board task is actively working.");
  if (task.assignee?.trim() !== agentId.trim()) {
    throw new Error("The active company task is not assigned to this wallet agent.");
  }
  const company = await getCompany(companyId);
  if (!company) throw new Error("The company attached to this Work Board task no longer exists.");
  const isMember = company.agentIds.includes(agentId.trim())
    || company.members?.some((member) => member.agentId === agentId.trim());
  if (!isMember) throw new Error("This wallet agent is not a member of the company attached to the active task.");
  return {
    wallet: direct?.wallet ?? { agentId: agentId.trim(), approvalRequiredOverUsd: 0 },
    agentName: direct?.agentName,
    companyId,
    companyTaskId,
  };
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
 * below the per-payment cap, or an explicitly validated company task context.
 */
export async function shouldEvaluateSpend(
  wallet: SpendGovernanceWallet,
  maxPaymentUsd: number,
  options: { companyId?: string } = {},
): Promise<boolean> {
  if (governanceActive(wallet) || approvalCanBind(wallet, maxPaymentUsd)) return true;
  return Boolean(options.companyId);
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

  const company = input.companyId ? await getCompany(input.companyId) : undefined;
  if (input.companyId && !company) throw new Error("The company spend context is no longer valid.");
  if (company && !company.agentIds.includes(wallet.agentId) && !company.members?.some((member) => member.agentId === wallet.agentId)) {
    throw new Error("The wallet agent is not a member of the company spend context.");
  }
  const companyId = company?.id;
  const ledger = await readSpendLedger();

  const agentDailySpent = await sumAgentSpendUsdSince(wallet.agentId, now - ROLLING_DAY_MS, ledger);
  const agentDaily = remaining(
    wallet.dailyBudgetUsd,
    agentDailySpent,
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
  const companyMemberDailySpent = company ? await sumCompanyMemberSpendUsdSince(company.id, wallet.agentId, now - ROLLING_DAY_MS, ledger) : 0;
  const companyDaily = remaining(company?.dailyBudgetUsd, companyDailySpent, amount);
  const companyMonthly = remaining(company?.monthlyBudgetUsd, companyMonthlySpent, amount);
  const companyTotal = remaining(company?.totalBudgetUsd, companyTotalSpent, amount);
  const companyMember = company?.members?.find((member) => member.agentId === wallet.agentId);
  const companyMemberDaily = remaining(companyMember?.companyCap, companyMemberDailySpent, amount);

  const budget: SpendBudgetSnapshot = {
    agentDailyRemainingUsd: agentDaily.remaining,
    agentMonthlyRemainingUsd: agentMonthly.remaining,
    companyMemberDailyRemainingUsd: companyMemberDaily.remaining,
    companyDailyRemainingUsd: companyDaily.remaining,
    companyMonthlyRemainingUsd: companyMonthly.remaining,
    companyTotalRemainingUsd: companyTotal.remaining,
    companyFrozen: Boolean(company?.frozen),
  };

  const decisionExplanation = (reason: string, overrides?: Partial<ReasoningTrail>) => buildSpendApprovalReasoning({
    agentId: wallet.agentId,
    agentName: input.agentName,
    companyId,
    companyName: company?.name,
    kind: input.kind,
    asset: input.asset,
    amountUsd: amount,
    assetAmount: input.assetAmount,
    target: input.target,
    reason,
    explanation: {
      ...input.explanation,
      ...overrides,
    },
  });

  const block = (reason: string): SpendDecision => ({
    decision: "block",
    reason,
    companyId,
    budget,
    explanation: decisionExplanation(reason, {
      summary: "This spend was blocked before execution.",
      whyNow: reason,
      impact: "No payment was sent. The agent must change the request or the governing policy before retrying.",
      requestedAction: "Review the blocker and change the budget, company state, or task plan only if that is intended.",
      source: "Spend governance block",
    }),
  });

  // 1. Kill switch.
  if (company?.frozen) {
    return block(`Company "${company.name}" is frozen (kill switch on). All agent spending is halted.`);
  }

  // 2. Cumulative budgets (hard — never overridable by an approval).
  if (agentDaily.exceeded) return block(`This spend would exceed the agent's daily budget ($${wallet.dailyBudgetUsd?.toFixed(2)}; $${agentDaily.remaining?.toFixed(2)} left).`);
  if (agentMonthly.exceeded) return block(`This spend would exceed the agent's monthly budget ($${wallet.monthlyBudgetUsd?.toFixed(2)}; $${agentMonthly.remaining?.toFixed(2)} left).`);
  if (companyMemberDaily.exceeded) return block(`This spend would exceed the company member daily budget for "${company?.name}" ($${companyMember?.companyCap?.toFixed(2)}; $${companyMemberDaily.remaining?.toFixed(2)} left).`);
  if (companyDaily.exceeded) return block(`This spend would exceed company "${company?.name}"'s daily budget ($${company?.dailyBudgetUsd?.toFixed(2)}; $${companyDaily.remaining?.toFixed(2)} left).`);
  if (companyMonthly.exceeded) return block(`This spend would exceed company "${company?.name}"'s monthly budget ($${company?.monthlyBudgetUsd?.toFixed(2)}; $${companyMonthly.remaining?.toFixed(2)} left).`);
  if (companyTotal.exceeded) return block(`This spend would exceed company "${company?.name}"'s total budget ($${company?.totalBudgetUsd?.toFixed(2)}; $${companyTotal.remaining?.toFixed(2)} left).`);

  // 3. Approval threshold.
  const threshold = Number(wallet.approvalRequiredOverUsd) || 0;
  if (threshold > 0 && amount > threshold) {
    if (input.approvalThresholdSatisfied) {
      const reason = "Approval threshold satisfied by the direct user action.";
      return {
        decision: "allow",
        reason,
        companyId,
        budget,
        explanation: decisionExplanation(reason, {
          summary: "The spend crossed the approval threshold, but this request already carried a direct user confirmation.",
          whyNow: "The caller provided a confirmation for this exact spend.",
          impact: "The payment can execute without creating another approval card.",
          requestedAction: "No separate approval is needed for this attempt.",
          source: "Spend governance direct approval",
        }),
      };
    }
    const grant = await consumeApproval({
      agentId: wallet.agentId,
      asset: input.asset,
      amountUsd: amount,
      kind: input.kind,
      target: input.target,
      token: input.approvalToken,
    });
    if (grant) {
      const reason = `Authorized by approval ${grant.id}.`;
      return {
        decision: "allow",
        reason,
        companyId,
        grant,
        budget,
        explanation: grant.explanation,
      };
    }
    const approvalReason = `Exceeds approval threshold ($${threshold.toFixed(2)}).`;
    const approval = await enqueueApproval({
      agentId: wallet.agentId,
      agentName: input.agentName,
      companyId,
      kind: input.kind,
      asset: input.asset,
      amountUsd: amount,
      assetAmount: input.assetAmount,
      target: input.target,
      reason: approvalReason,
      thresholdUsd: threshold,
      explanation: input.explanation,
    });
    return {
      decision: "approve",
      reason: `Spending $${amount.toFixed(2)} needs human approval (over $${threshold.toFixed(2)}). Pending request ${approval.id}.`,
      companyId,
      approval,
      budget,
      explanation: approval.explanation,
    };
  }

  const reason = "Within budget and approval limits.";
  return {
    decision: "allow",
    reason,
    companyId,
    budget,
    explanation: decisionExplanation(reason, {
      summary: "The spend is inside the configured limits.",
      whyNow: "No company freeze, budget cap, or approval threshold blocked it.",
      impact: "The payment can proceed.",
      requestedAction: "No human decision is needed.",
      source: "Spend governance allow",
      missingContext: [],
    }),
  };
}
