import "server-only";

import {
  buildOutcomeAwareAllocation,
  evaluateEarnedScale,
  mineDelightProposals,
  summarizeSwarmBlackboard,
  type EarnedScaleObservation,
} from "@/lib/earned-scale";
import { readAgentChallengesState } from "@/lib/services/agent-challenges";
import type { CompanyIntelligenceSnapshot, CompanyIntelligenceUsageEvent } from "@/lib/services/company-intelligence-usage";
import { readOutcomeRoutingRecords } from "@/lib/services/outcome-router";
import { readSkillAnalytics } from "@/lib/services/skills/skill-os";
import type { CompanyFrontierLabPolicy } from "@/lib/types/company";

export async function readEarnedScaleInsights(input: {
  companyId: string;
  policy: CompanyFrontierLabPolicy;
  snapshot: CompanyIntelligenceSnapshot;
}) {
  const [challengeState, skillEvents, outcomeRecords] = await Promise.all([
    readAgentChallengesState().catch(() => ({ summaries: [] })),
    readSkillAnalytics(1_000).catch(() => []),
    readOutcomeRoutingRecords().catch(() => []),
  ]);
  const settled = input.snapshot.recent.filter((event) => event.status === "settled");
  const stageOrder = ["pilot", "team", "frontier"] as const;
  const currentIndex = stageOrder.indexOf(input.policy.stage);
  const baselineStage = currentIndex > 0 ? stageOrder[currentIndex - 1] : undefined;
  const baseline = baselineStage
    ? settled.filter((event) => event.stage === baselineStage && event.scaleEvidence).map(usageEventObservation)
    : [];
  const treatment = settled.filter((event) => event.stage === input.policy.stage && event.scaleEvidence).map(usageEventObservation);
  const failureRate = input.snapshot.settledTasks
    ? (input.snapshot.blockedTasks + input.snapshot.failedTasks) / input.snapshot.settledTasks
    : 0;
  return {
    scaleCurve: {
      ...evaluateEarnedScale({ baseline, treatment }),
      baselineStage,
      treatmentStage: input.policy.stage,
    },
    allocator: buildOutcomeAwareAllocation({
      frontierEnabled: input.policy.enabled,
      models: input.policy.models,
      evidenceSamples: outcomeRecords.length,
      recentFailureRate: failureRate,
    }),
    blackboard: summarizeSwarmBlackboard(challengeState.summaries),
    delight: {
      proposals: mineDelightProposals(skillEvents, input.companyId),
      analyzedEvents: skillEvents.length,
      autoApply: false,
    },
  };
}

function usageEventObservation(event: CompanyIntelligenceUsageEvent): EarnedScaleObservation {
  const scale = event.scaleEvidence;
  return {
    id: event.id,
    settledTasks: 1,
    completedTasks: event.outcome === "completed" ? 1 : 0,
    outcomeScore: scale?.outcomeScore,
    proofRate: scale?.proofSatisfied === undefined ? undefined : Number(scale.proofSatisfied),
    latencyMs: scale?.latencyMs,
    totalTokens: event.usage?.totalTokens,
    uniqueContributionRate: scale?.uniqueContribution === undefined ? undefined : Number(scale.uniqueContribution),
    duplicationConflictRate: scale?.duplicationConflict === undefined ? undefined : Number(scale.duplicationConflict),
    humanInterventionRate: scale?.humanIntervention === undefined ? undefined : Number(scale.humanIntervention),
    reviewerDisagreementRate: scale?.reviewerDisagreement === undefined ? undefined : Number(scale.reviewerDisagreement),
  };
}
