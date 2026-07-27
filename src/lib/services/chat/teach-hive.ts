import "server-only";

import { createBrainReviewProposal } from "@/lib/services/brain-review-queue";
import type { PrincipalContext } from "@/lib/types/principal";
import { workspaceScope } from "@/lib/types/principal";

const TEACH_HIVE_PATTERNS = [
  /\bteach\s+(?:the\s+)?hive\s+(?:that|this)\b/i,
  /\b(?:please\s+)?remember\s+(?:that|this)\b/i,
  /\b(?:save|store)\s+(?:this|that)\s+(?:for\s+later|for\s+future|in\s+memory)\b/i,
  /\bfor\s+future\s+reference\b/i,
];

export type TeachHiveDetectionInput = {
  userPrompt: string;
  principal?: PrincipalContext | null;
  runtimeSessionId?: string;
  chatStorageKey?: string;
};

export async function maybeCreateTeachHiveReviewProposal(input: TeachHiveDetectionInput) {
  const prompt = input.userPrompt.trim();
  if (!prompt || !TEACH_HIVE_PATTERNS.some((pattern) => pattern.test(prompt))) return null;
  const title = teachHiveTitle(prompt);
  const sourceId = input.runtimeSessionId || input.chatStorageKey || undefined;
  const result = await createBrainReviewProposal({
    kind: "memory",
    title,
    summary: "The user explicitly asked HivemindOS to remember or preserve durable context. This proposal waits for Brain Review approval before writing Shared Brain Memory.",
    proposedContent: prompt,
    evidence: [
      {
        sourceType: "conversation",
        sourceId,
        excerpt: prompt.slice(0, 1_500),
      },
    ],
    risk: "low",
    createdByPrincipalId: input.principal?.principalId,
    scope: workspaceScope(["brain:read"], ["teach-hive", "brain-review"]),
  });
  return result.proposal;
}

function teachHiveTitle(prompt: string) {
  const cleaned = prompt
    .replace(/\s+/g, " ")
    .replace(/^please\s+/i, "")
    .trim();
  const withoutLead = cleaned
    .replace(/^remember\s+(?:that|this)\s+/i, "")
    .replace(/^teach\s+(?:the\s+)?hive\s+(?:that|this)\s+/i, "")
    .replace(/^for\s+future\s+reference[:,]?\s*/i, "")
    .trim();
  const title = withoutLead || cleaned || "Teach Hive memory proposal";
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}
