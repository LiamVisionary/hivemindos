import type { AgentChallenge, AgentChallengeSummary } from "@/lib/services/agent-challenges";

export type CapabilityPromotionStage = "collecting" | "candidate" | "reviewable";

export type CapabilityPromotionDraft = {
  challengeId: string;
  stage: CapabilityPromotionStage;
  skillSlug: string;
  title: string;
  summary: string;
  evidence: string[];
  evals: Array<{ title: string; score: number; metric?: string; verified: boolean }>;
  knownFailureModes: string[];
  operatingLevers: string[];
  requiredReview: true;
  blockers: string[];
};

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "verified-capability";
}

export function buildCapabilityPromotionDraft(challenge: AgentChallenge, summary: AgentChallengeSummary): CapabilityPromotionDraft {
  const validResults = challenge.lineage.filter((node) => node.status !== "invalid");
  const evidenced = validResults.filter((node) => node.evidence.length > 0);
  const verified = validResults.filter((node) => Boolean(node.verifier) || challenge.rulings.some((ruling) => ruling.targetLineageId === node.id && ruling.kind === "valid"));
  const blockers: string[] = [];
  if (!validResults.length) blockers.push("Record at least one measured result.");
  if (!evidenced.length) blockers.push("Attach concrete evidence to a result.");
  if (!verified.length) blockers.push("Have a verifier or human ruling validate a result.");
  if (!challenge.playbook.levers.length) blockers.push("Distill at least one reusable operating lever.");
  const stage: CapabilityPromotionStage = blockers.length === 0 ? "reviewable" : validResults.length ? "candidate" : "collecting";
  return {
    challengeId: challenge.id,
    stage,
    skillSlug: slug(challenge.title),
    title: challenge.title,
    summary: `Reusable method for ${challenge.objective}${summary.bestScore === undefined ? "" : `; current best measured score: ${summary.bestScore}`}`,
    evidence: [...new Set(evidenced.flatMap((node) => node.evidence))].slice(0, 20),
    evals: validResults.map((node) => ({
      title: node.title,
      score: node.score,
      metric: node.metricName ?? challenge.metricName,
      verified: verified.some((candidate) => candidate.id === node.id),
    })),
    knownFailureModes: challenge.playbook.antiPatterns,
    operatingLevers: challenge.playbook.levers,
    requiredReview: true,
    blockers,
  };
}
