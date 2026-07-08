import type { ReasoningTrail } from "@/lib/types/reasoning-trail";
import { compactReasoningTrailList, normalizeReasoningTrail } from "@/lib/types/reasoning-trail";

export type SpendApprovalReasoningInput = {
  agentId: string;
  agentName?: string;
  companyId?: string;
  companyName?: string;
  kind: string;
  asset: string;
  amountUsd: number;
  assetAmount?: number;
  target?: string;
  reason?: string;
  thresholdUsd?: number;
  source?: string;
  summary?: string;
  whyNow?: string;
  impact?: string;
  requestedAction?: string;
  evidence?: string[];
  missingContext?: string[];
  nextSteps?: string[];
  explanation?: Partial<ReasoningTrail>;
};

function money(value: number): string {
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `$${amount.toFixed(2)}`;
}

function actor(input: Pick<SpendApprovalReasoningInput, "agentId" | "agentName">): string {
  return input.agentName?.trim() || input.agentId.trim() || "An agent";
}

function kindLabel(kind: string): string {
  if (kind === "x402") return "paid API call";
  if (kind === "send") return "wallet transfer";
  if (kind === "veil-transfer") return "private transfer";
  if (kind === "trade") return "trade";
  if (kind === "platform-fee") return "platform fee";
  if (kind === "approval") return "approval request";
  return `${kind || "spend"} request`;
}

function targetText(target?: string): string {
  const value = target?.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.pathname ? `${url.origin}${url.pathname}` : url.origin;
  } catch {
    return value;
  }
}

export function buildSpendApprovalReasoning(input: SpendApprovalReasoningInput): ReasoningTrail {
  const amount = `${money(input.amountUsd)} ${input.asset || "USDC"}`;
  const target = targetText(input.target);
  const human = actor(input);
  const label = kindLabel(input.kind);
  const threshold = Number(input.thresholdUsd);
  const thresholdLine = Number.isFinite(threshold) && threshold > 0
    ? `${amount} is over the wallet's ${money(threshold)} approval threshold.`
    : input.reason || "The wallet policy requires a human review before this action can continue.";
  const baseEvidence = compactReasoningTrailList([
    `Requester: ${human}${input.agentId ? ` (${input.agentId})` : ""}`,
    input.companyName ? `Company: ${input.companyName}` : input.companyId ? `Company id: ${input.companyId}` : null,
    `Amount: ${amount}`,
    input.assetAmount != null && input.assetAmount !== input.amountUsd ? `Asset amount: ${input.assetAmount} ${input.asset}` : null,
    target ? `Target: ${target}` : null,
    input.reason ? `Policy reason: ${input.reason}` : null,
    Number.isFinite(threshold) && threshold > 0 ? `Approval threshold: ${money(threshold)}` : null,
    ...(input.evidence ?? []),
  ]);
  const fallbackMissing = input.missingContext ?? input.explanation?.missingContext ?? [
    "The approval record does not include the full upstream task context unless the calling route attached it.",
  ];
  const built = normalizeReasoningTrail({
    headline: `${human} wants approval for a ${label} of ${amount}${target ? ` to ${target}` : ""}.`,
    summary: input.summary || `This is a governed ${label}. The system paused it before spending and created a review request.`,
    whyNow: input.whyNow || thresholdLine,
    impact: input.impact || `Approving lets the agent retry and spend up to ${amount}. Rejecting keeps the action blocked and sends the decision back to the agent.`,
    requestedAction: input.requestedAction || "Approve only if this exact spend should happen now. Reject if the agent should revise, wait, or use a cheaper path.",
    evidence: baseEvidence,
    missingContext: fallbackMissing,
    nextSteps: input.nextSteps,
    source: input.source || "Spend governance",
  })!;
  const override = normalizeReasoningTrail(input.explanation);
  if (!override) return built;
  return {
    ...built,
    ...override,
    evidence: compactReasoningTrailList([...built.evidence, ...override.evidence], 12),
    missingContext: compactReasoningTrailList([...(built.missingContext ?? []), ...(override.missingContext ?? [])]),
    nextSteps: compactReasoningTrailList([...(built.nextSteps ?? []), ...(override.nextSteps ?? [])]),
  };
}

export function fallbackSpendApprovalReasoning(input: SpendApprovalReasoningInput): ReasoningTrail {
  return buildSpendApprovalReasoning({
    ...input,
    source: input.source || "Legacy spend approval",
    summary: input.summary || "This approval was created before detailed reasoning trails were stored.",
    whyNow: input.whyNow || input.reason || "The original record only saved the short approval reason, amount, and target.",
    impact: input.impact || "Approving or rejecting still works, but the original task context is not recoverable from this approval row.",
    requestedAction: input.requestedAction || "Use the amount, target, requester, and any linked task details before deciding.",
    missingContext: input.missingContext ?? [
      "This older approval row did not save the richer explanation trail.",
      "The original agent prompt is not attached to the stored approval.",
    ],
  });
}
