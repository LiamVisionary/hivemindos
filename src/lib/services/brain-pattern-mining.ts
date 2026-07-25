import "server-only";

import { createBrainReviewProposal, readBrainReviewQueue } from "@/lib/services/brain-review-queue";
import { listAgentOperationalEventsForMining } from "@/lib/services/obsidian/agent-memory/events";
import { mineOperationalPatterns, type OperationalPatternCandidate } from "@/lib/services/obsidian/agent-memory/pattern-mining";
import { workspaceScope } from "@/lib/types/principal";
import type { BrainReviewProposal } from "@/lib/types/brain-review";

export const PATTERN_SKEPTIC_VERDICTS = ["plausible", "weak", "spurious"] as const;

export type PatternSkepticVerdict = (typeof PATTERN_SKEPTIC_VERDICTS)[number];

export type PatternSkepticAnnotation = {
  verdict: PatternSkepticVerdict;
  objection: string;
};

export type ReviewOperationalPatternsInput = {
  enqueueProposals?: boolean;
  query?: string;
  project?: string;
  since?: string;
  limit?: number;
  /**
   * Opt-in cheap-model skeptic pass. Off by default so hermetic tests and
   * dry-run mining stay deterministic and offline.
   */
  skeptic?: boolean;
  /** Injectable skeptic for tests; takes precedence over the default model. */
  skepticWithModel?: (candidate: OperationalPatternCandidate) => Promise<PatternSkepticAnnotation>;
};

function proposalRisk(candidate: OperationalPatternCandidate) {
  return candidate.reviewKind === "job" ? "medium" as const : "low" as const;
}

async function defaultModelSkeptic(candidate: OperationalPatternCandidate) {
  const { critiquePatternCandidateWithModel } = await import("@/lib/services/brain/pattern-skeptic-model");
  return critiquePatternCandidateWithModel(candidate);
}

// Advisory only: the skeptic annotates reviewer attention, never gates the
// review-gated enqueue, and any failure or malformed verdict falls back to
// enqueueing with no annotation.
async function annotateCandidate(
  candidate: OperationalPatternCandidate,
  skeptic: (candidate: OperationalPatternCandidate) => Promise<PatternSkepticAnnotation>,
): Promise<PatternSkepticAnnotation | undefined> {
  try {
    const annotation = await skeptic(candidate);
    const verdict = PATTERN_SKEPTIC_VERDICTS.find((item) => item === annotation?.verdict);
    const objection = typeof annotation?.objection === "string"
      ? annotation.objection.trim().replace(/\s+/g, " ").slice(0, 300)
      : "";
    if (!verdict || !objection) return undefined;
    return { verdict, objection };
  } catch {
    return undefined;
  }
}

async function enqueueCandidate(candidate: OperationalPatternCandidate, skepticAnnotation?: PatternSkepticAnnotation) {
  return createBrainReviewProposal({
    kind: candidate.reviewKind,
    title: candidate.title,
    summary: candidate.summary,
    proposedContent: candidate.proposedContent,
    evidence: candidate.evidence,
    risk: proposalRisk(candidate),
    createdByPrincipalId: "system:brain-pattern-miner",
    scope: workspaceScope(["brain:read"], ["brain-review", "pattern-mining"]),
    metadata: skepticAnnotation
      ? { skepticVerdict: skepticAnnotation.verdict, skepticObjection: skepticAnnotation.objection }
      : undefined,
  });
}

export async function reviewOperationalPatterns(input: ReviewOperationalPatternsInput = {}) {
  // Mining reads the full bounded journal (not the public list clamp): an
  // explicit caller limit still caps the newest-first window and is reported
  // through `truncated`.
  const journal = await listAgentOperationalEventsForMining({
    query: input.query,
    project: input.project,
    since: input.since,
    maxEvents: input.limit,
  });
  const mining = mineOperationalPatterns(journal.events);
  const skeptic = typeof input.skepticWithModel === "function"
    ? input.skepticWithModel
    : input.skeptic === true
      ? defaultModelSkeptic
      : undefined;
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
      const annotation = skeptic ? await annotateCandidate(candidate, skeptic) : undefined;
      const result = await enqueueCandidate(candidate, annotation);
      enqueued.push(result.proposal);
      existingTitles.add(result.proposal.title.toLowerCase());
    }
  }
  return {
    journalPath: journal.path,
    truncated: journal.truncated,
    mining,
    enqueued,
    skippedExisting,
  };
}
