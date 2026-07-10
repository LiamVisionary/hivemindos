import "server-only";

import { createBrainReviewProposal, readBrainReviewQueue } from "@/lib/services/brain-review-queue";
import { listAgentOperationalEvents } from "@/lib/services/obsidian/agent-memory/events";
import { mineOperationalPatterns, type OperationalPatternCandidate } from "@/lib/services/obsidian/agent-memory/pattern-mining";
import { workspaceScope } from "@/lib/types/principal";
import type { BrainReviewProposal } from "@/lib/types/brain-review";

export type ReviewOperationalPatternsInput = {
  enqueueProposals?: boolean;
  query?: string;
  project?: string;
  since?: string;
  limit?: number;
};

function proposalRisk(candidate: OperationalPatternCandidate) {
  return candidate.reviewKind === "job" ? "medium" as const : "low" as const;
}

async function enqueueCandidate(candidate: OperationalPatternCandidate) {
  return createBrainReviewProposal({
    kind: candidate.reviewKind,
    title: candidate.title,
    summary: candidate.summary,
    proposedContent: candidate.proposedContent,
    evidence: candidate.evidence,
    risk: proposalRisk(candidate),
    createdByPrincipalId: "system:brain-pattern-miner",
    scope: workspaceScope(["brain:read"], ["brain-review", "pattern-mining"]),
  });
}

export async function reviewOperationalPatterns(input: ReviewOperationalPatternsInput = {}) {
  const journal = await listAgentOperationalEvents({
    query: input.query,
    project: input.project,
    since: input.since,
    limit: input.limit ?? 1_000,
  });
  const mining = mineOperationalPatterns(journal.events);
  const enqueued: BrainReviewProposal[] = [];
  const skippedExisting: string[] = [];
  if (input.enqueueProposals && mining.candidates.length) {
    const queue = await readBrainReviewQueue();
    const existingTitles = new Set(queue.proposals.map((proposal) => proposal.title.toLowerCase()));
    for (const candidate of mining.candidates) {
      if (existingTitles.has(candidate.title.toLowerCase())) {
        skippedExisting.push(candidate.key);
        continue;
      }
      const result = await enqueueCandidate(candidate);
      enqueued.push(result.proposal);
      existingTitles.add(result.proposal.title.toLowerCase());
    }
  }
  return {
    journalPath: journal.path,
    mining,
    enqueued,
    skippedExisting,
  };
}
