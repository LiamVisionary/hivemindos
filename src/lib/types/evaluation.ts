import type { LoopEvaluationRubric } from "@/lib/types/loops";

export type EvaluationSurface = "chat" | "work-board" | "company" | "scheduler" | "runtime-cli" | "aeon";
export type EvaluationTier = "quick" | "verified" | "high-assurance";
export type EvaluationVerdict = "accepted" | "rejected" | "needs-evidence" | "abstained" | "evaluation-error" | "unobserved";
export type EvaluationCheckStatus = "passed" | "failed" | "skipped";
export type EvaluationHumanFeedbackRating = "up" | "down";

export type EvaluationHumanFeedback = {
  rating: EvaluationHumanFeedbackRating;
  source: "human";
  providedAt: number;
};

export type EvaluationArtifact = {
  kind: "file" | "directory" | "url" | "other";
  path?: string;
  url?: string;
  label?: string;
};

export type CompletionEvent = {
  id: string;
  surface: EvaluationSurface;
  status: "completed" | "failed" | "blocked" | "cancelled";
  observed: boolean;
  output: string;
  startedAt?: number;
  completedAt: number;
  risk?: "low" | "medium" | "high";
  artifacts?: EvaluationArtifact[];
  rubric?: LoopEvaluationRubric;
  metadata?: Record<string, unknown>;
};

export type EvaluationPolicy = {
  tier: EvaluationTier;
  requireArtifacts: boolean;
  requireJudge: boolean;
  reason: string;
};

export type EvaluationCheck = {
  id: "completion" | "output" | "artifact" | "judge" | "human-feedback";
  status: EvaluationCheckStatus;
  summary: string;
  evidence: string[];
};

export type EvaluationJudgeAxis = {
  id: string;
  score: number;
  evidence: string[];
};

export type EvaluationJudgeVerdict = {
  verdict: "accepted" | "rejected" | "abstained";
  confidence: number;
  axes: EvaluationJudgeAxis[];
  summary: string;
  evaluator: {
    agentId?: string;
    model?: string;
    runtime?: string;
    independent: boolean;
  };
};

export type EvaluationResult = {
  id: string;
  eventId: string;
  surface: EvaluationSurface;
  tier: EvaluationTier;
  verdict: EvaluationVerdict;
  score: number | null;
  checks: EvaluationCheck[];
  judge?: EvaluationJudgeVerdict;
  humanFeedback?: EvaluationHumanFeedback;
  evaluatedAt: number;
  routingEligible: boolean;
};

export type EvaluationDependencies = {
  verifyArtifact?: (artifact: EvaluationArtifact, event: CompletionEvent) => Promise<{ ok: boolean; evidence?: string[]; error?: string }>;
  judge?: (event: CompletionEvent, policy: EvaluationPolicy) => Promise<EvaluationJudgeVerdict>;
  now?: () => number;
};

export function normalizeEvaluationHumanFeedback(value: unknown): EvaluationHumanFeedback | undefined {
  if (!value || typeof value !== "object") return undefined;
  const feedback = value as Partial<EvaluationHumanFeedback>;
  if (feedback.rating !== "up" && feedback.rating !== "down") return undefined;
  if (!Number.isFinite(feedback.providedAt)) return undefined;
  return {
    rating: feedback.rating,
    source: "human",
    providedAt: Number(feedback.providedAt),
  };
}
