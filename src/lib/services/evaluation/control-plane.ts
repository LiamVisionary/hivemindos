import type { LoopEvaluationRubric, LoopReceipt, LoopSpec } from "@/lib/types/loops";
import type {
  CompletionEvent,
  EvaluationCheck,
  EvaluationDependencies,
  EvaluationJudgeAxis,
  EvaluationJudgeVerdict,
  EvaluationHumanFeedback,
  EvaluationPolicy,
  EvaluationResult,
  EvaluationVerdict,
} from "@/lib/types/evaluation";

export type {
  CompletionEvent,
  EvaluationArtifact,
  EvaluationCheck,
  EvaluationCheckStatus,
  EvaluationDependencies,
  EvaluationJudgeAxis,
  EvaluationJudgeVerdict,
  EvaluationHumanFeedback,
  EvaluationHumanFeedbackRating,
  EvaluationPolicy,
  EvaluationResult,
  EvaluationSurface,
  EvaluationTier,
  EvaluationVerdict,
} from "@/lib/types/evaluation";

const HIGH_ASSURANCE_PATTERN = /\b(?:publish|production|payment|pay|purchase|customer|send|deploy|release|external|irreversible|delete|transfer|withdraw|invoice|contract)\b/i;
const BARE_REFUSAL_PATTERN = /^\s*(?:i\s+(?:can(?:not|'t)|won't|will not)\s+(?:help|assist|do|complete)|unable to (?:help|assist|complete)|sorry[,;:]?\s+i\s+(?:can(?:not|'t)|won't))\b[^\n]{0,180}[.!]?\s*$/i;
const MIN_SUBSTANTIVE_OUTPUT_LENGTH = 24;

export function evaluationPolicyForEvent(event: CompletionEvent): EvaluationPolicy {
  if (event.surface === "chat") {
    return { tier: "quick", requireArtifacts: false, requireJudge: false, reason: "Ordinary chat gets low-cost completion sanity checks." };
  }
  const highAssurance = event.risk === "high" || Boolean(event.rubric) || HIGH_ASSURANCE_PATTERN.test(event.output);
  if (highAssurance) {
    return {
      tier: "high-assurance",
      requireArtifacts: Boolean(event.artifacts?.length),
      requireJudge: true,
      reason: "High-risk, outward-facing, or rubric-scored work requires independent review.",
    };
  }
  return {
    tier: "verified",
    requireArtifacts: Boolean(event.artifacts?.length),
    requireJudge: false,
    reason: "Managed task completions require concrete output and verification of claimed artifacts.",
  };
}

export async function evaluateCompletionEvent(
  event: CompletionEvent,
  dependencies: EvaluationDependencies = {},
): Promise<EvaluationResult> {
  const evaluatedAt = dependencies.now?.() ?? Date.now();
  const policy = evaluationPolicyForEvent(event);
  const checks: EvaluationCheck[] = [];
  const base = (verdict: EvaluationVerdict, score: number | null, judge?: EvaluationJudgeVerdict): EvaluationResult => {
    const result: EvaluationResult = {
      id: `evaluation_${stableHash(`${event.id}:${event.completedAt}:${event.output}`)}`,
      eventId: event.id,
      surface: event.surface,
      tier: policy.tier,
      verdict,
      score,
      checks,
      judge,
      evaluatedAt,
      routingEligible: false,
    };
    result.routingEligible = evaluationRoutingEligible(result);
    return result;
  };

  if (!event.observed) {
    checks.push({ id: "completion", status: "skipped", summary: "The completion happened outside an observable HivemindOS run path.", evidence: [] });
    return base("unobserved", null);
  }
  if (event.status !== "completed") {
    checks.push({ id: "completion", status: "failed", summary: `Run ended with status ${event.status}.`, evidence: [] });
    return base("rejected", 0);
  }
  checks.push({ id: "completion", status: "passed", summary: "Run reported a completed terminal state.", evidence: [] });

  const output = String(event.output ?? "").trim();
  if (output.length < MIN_SUBSTANTIVE_OUTPUT_LENGTH || BARE_REFUSAL_PATTERN.test(output)) {
    checks.push({ id: "output", status: "failed", summary: "Completion output was empty, too thin, or only a refusal.", evidence: output ? [output.slice(0, 240)] : [] });
    return base("rejected", 0);
  }
  checks.push({ id: "output", status: "passed", summary: "Completion output is substantive enough for evaluation.", evidence: [output.slice(0, 240)] });

  if (event.artifacts?.length) {
    if (!dependencies.verifyArtifact) {
      checks.push({ id: "artifact", status: "failed", summary: "Claimed artifacts were not verified by a trusted verifier.", evidence: [] });
      return base("needs-evidence", null);
    }
    const artifactEvidence: string[] = [];
    for (const artifact of event.artifacts) {
      const verified = await dependencies.verifyArtifact(artifact, event).catch((error: unknown) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      artifactEvidence.push(...("evidence" in verified ? (verified.evidence ?? []) : []));
      if (!verified.ok) {
        checks.push({ id: "artifact", status: "failed", summary: verified.error || "A claimed artifact could not be verified.", evidence: artifactEvidence });
        return base("needs-evidence", null);
      }
    }
    checks.push({ id: "artifact", status: "passed", summary: `Verified ${event.artifacts.length} claimed artifact(s).`, evidence: artifactEvidence });
  }

  if (policy.requireJudge) {
    if (!dependencies.judge) {
      checks.push({ id: "judge", status: "skipped", summary: "Independent judge was required but unavailable.", evidence: [] });
      return base("needs-evidence", null);
    }
    let judge: EvaluationJudgeVerdict;
    try {
      judge = await dependencies.judge(event, policy);
    } catch (error) {
      checks.push({ id: "judge", status: "failed", summary: error instanceof Error ? error.message : String(error), evidence: [] });
      return base("evaluation-error", null);
    }
    const score = weightedJudgeScore(event.rubric, judge.axes);
    const passesFloors = rubricFloorsPass(event.rubric, judge.axes);
    const passesThreshold = !event.rubric || score >= event.rubric.passThreshold;
    const accepted = judge.verdict === "accepted" && judge.evaluator.independent && passesFloors && passesThreshold;
    checks.push({
      id: "judge",
      status: accepted ? "passed" : "failed",
      summary: judge.evaluator.independent ? judge.summary : "Judge was not independent from the worker.",
      evidence: judge.axes.flatMap((axis) => axis.evidence),
    });
    if (judge.verdict === "abstained") return base("abstained", score, judge);
    return base(accepted ? "accepted" : "rejected", score, judge);
  }

  return base("accepted", 1);
}

export function evaluationRoutingEligible(result: Pick<EvaluationResult, "surface" | "verdict" | "tier">): boolean {
  return result.surface !== "chat" && result.verdict === "accepted" && result.tier !== "quick";
}

export function applyHumanFeedbackToEvaluation(
  evaluation: EvaluationResult,
  feedback: EvaluationHumanFeedback,
): EvaluationResult {
  const negative = feedback.rating === "down";
  const result: EvaluationResult = {
    ...evaluation,
    id: `${evaluation.id}_feedback_${feedback.rating}_${feedback.providedAt.toString(36)}`,
    verdict: negative ? "rejected" : evaluation.verdict,
    checks: [
      ...evaluation.checks.filter((check) => check.id !== "human-feedback"),
      {
        id: "human-feedback",
        status: negative ? "failed" : "passed",
        summary: negative
          ? "A human marked this response as not useful."
          : "A human marked this response as useful.",
        evidence: [negative ? "Thumbs down" : "Thumbs up"],
      },
    ],
    humanFeedback: feedback,
    routingEligible: negative ? false : evaluation.routingEligible,
  };
  return result;
}

/**
 * Removes receipts for gates whose truth must be established inside the trusted
 * server/runtime boundary. Ordinary evidence receipts remain candidates; they do
 * not grant authority over judges, commands, artifact existence, policy, or scores.
 */
export function sanitizeClientLoopReceipts(loop: LoopSpec | undefined, receipts: LoopReceipt[] | undefined | null): LoopReceipt[] {
  if (!Array.isArray(receipts)) return [];
  const protectedGateIds = new Set(
    (loop?.evalGates ?? [])
      .filter((gate) => gate.kind === "agent"
        || gate.kind === "artifact"
        || Boolean(gate.command?.trim())
        || gate.verifier === "governance:policy"
        || gate.verifier?.startsWith("evo:"))
      .map((gate) => gate.id),
  );
  return receipts.filter((receipt) => {
    if (receipt.gateId && protectedGateIds.has(receipt.gateId)) return false;
    const verifier = receipt.verifier ?? "";
    return !/^(?:agent:|command:|artifact:|governance:|evo:|integrity:)/.test(verifier);
  });
}

function weightedJudgeScore(rubric: LoopEvaluationRubric | undefined, axes: EvaluationJudgeAxis[]): number {
  if (!axes.length) return 0;
  if (!rubric?.axes.length) return round(axes.reduce((sum, axis) => sum + clamp(axis.score), 0) / axes.length);
  const byId = new Map(axes.map((axis) => [axis.id, clamp(axis.score)]));
  const totalWeight = rubric.axes.reduce((sum, axis) => sum + Math.max(0, axis.weight), 0) || 1;
  return round(rubric.axes.reduce((sum, axis) => sum + (byId.get(axis.id) ?? 0) * Math.max(0, axis.weight), 0) / totalWeight);
}

function rubricFloorsPass(rubric: LoopEvaluationRubric | undefined, axes: EvaluationJudgeAxis[]): boolean {
  if (!rubric) return true;
  const byId = new Map(axes.map((axis) => [axis.id, clamp(axis.score)]));
  return rubric.axes.every((axis) => byId.has(axis.id) && (axis.scoreFloor === undefined || (byId.get(axis.id) ?? 0) >= axis.scoreFloor));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function evaluationOutputFingerprint(output: string): string {
  return stableHash(String(output ?? "").replace(/\r\n/g, "\n").trim());
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
