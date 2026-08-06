// Client-safe model for the shared spend-approval surface.
//
// The approvals backend (`/api/wallet/approvals`, `src/lib/services/wallet/
// spend-approvals.ts`) is agent/company-general — it is NOT company-specific.
// This module owns the client-side shape + the row→view mapping so BOTH the
// Zero Human Companies approvals section and the Alerts "Review first" queue
// render and decide approvals through one code path (DRY). The mapping is lifted
// from the old company-only `mapApproval` in the ZHC mappers.
import type { ReasoningTrail } from "@/lib/types/reasoning-trail";
import { normalizeReasoningTrail } from "@/lib/types/reasoning-trail";
import { fallbackSpendApprovalReasoning } from "@/lib/utils/spend-approval-reasoning";

export type SpendApprovalStatus = "pending" | "approved" | "denied" | "expired" | "consumed";

/** The raw JSON an approval row arrives as from `/api/wallet/approvals`. */
export type SpendApprovalRaw = {
  id: string;
  agentId: string;
  agentName?: string;
  companyId?: string;
  kind: string;
  asset: string;
  amountUsd: number;
  assetAmount?: number;
  target?: string;
  reason: string;
  explanation?: ReasoningTrail;
  status: SpendApprovalStatus;
  createdAt?: string;
  createdAtMs: number;
  expiresAtMs?: number;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
};

export type ApprovalRisk = "high" | "med" | "low";

export type ApprovalDecision = "approved" | "denied";

export type ApprovalActionCopy = {
  approveLabel?: string;
  rejectLabel?: string;
  approveNoteLabel?: string;
  rejectNoteLabel?: string;
  approvePlaceholder?: string;
  rejectPlaceholder?: string;
  noteHint?: string;
  requireApproveNote?: boolean;
};

/**
 * The view shape both surfaces render. The core five fields are always present;
 * the money/provenance extras are optional so a lightweight producer (e.g. ZHC
 * demo fixtures) can satisfy the type without them — the modal shows each extra
 * only when present.
 */
export type SpendApprovalView = {
  id: string;
  /** One-line human summary, e.g. "Firecrawl top-up — $40.00 USDC → firecrawl". */
  title: string;
  /** Who requested it (agent display name). */
  agent: string;
  kind: string;
  risk: ApprovalRisk;
  agentId?: string;
  companyId?: string;
  amountUsd?: number;
  asset?: string;
  reason?: string;
  target?: string;
  createdAtMs?: number;
  explanation?: ReasoningTrail;
};

/** Risk tier by dollar amount (and optional daily cap) — from the ZHC mapper. */
export function riskForAmount(amountUsd: number, dailyCap?: number): ApprovalRisk {
  if (amountUsd >= 50 || (dailyCap && dailyCap > 0 && amountUsd >= dailyCap * 0.5)) return "high";
  if (amountUsd >= 10) return "med";
  return "low";
}

export function mapSpendApproval(row: SpendApprovalRaw, dailyCap?: number): SpendApprovalView {
  const amountUsd = Number(row.amountUsd) || 0;
  const asset = row.asset || "USDC";
  const amount = `$${amountUsd.toFixed(2)} ${asset}`;
  const head = row.reason?.trim() || `${row.kind} spend`;
  const explanation = normalizeReasoningTrail(row.explanation) ?? fallbackSpendApprovalReasoning({
    agentId: row.agentId,
    agentName: row.agentName,
    companyId: row.companyId,
    kind: row.kind || "spend",
    asset,
    amountUsd,
    assetAmount: row.assetAmount,
    target: row.target,
    reason: head,
  });
  return {
    id: row.id,
    title: `${head} — ${amount}${row.target ? ` → ${row.target}` : ""}`,
    agent: row.agentName || row.agentId,
    agentId: row.agentId,
    companyId: row.companyId,
    kind: row.kind || "spend",
    risk: riskForAmount(amountUsd, dailyCap),
    amountUsd,
    asset,
    reason: head,
    target: row.target,
    createdAtMs: Number(row.createdAtMs) || 0,
    explanation,
  };
}

export const APPROVAL_RISK_LABEL: Record<ApprovalRisk, string> = {
  high: "High risk",
  med: "Medium",
  low: "Low risk",
};
