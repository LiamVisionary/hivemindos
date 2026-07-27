import "server-only";

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createBrainReviewProposal, readBrainReviewQueue } from "@/lib/services/brain-review-queue";
import { getSharedBrainSkillsCached } from "@/lib/services/obsidian/brain-skills";
import { readRuntimeAvailabilityFor } from "@/lib/services/runtime-availability";
import { appendSkillAnalyticsEvent, readSkillAnalytics } from "@/lib/services/skills/skill-os";
import {
  DEFAULT_SKILL_AUTORESEARCH_POLICY,
  buildSkillAutoresearchPlan,
  detectSkillAutoresearchCandidates,
  selectSkillAutoresearchBackend,
  type SkillAutoresearchBackendPreference,
  type SkillAutoresearchCandidate,
  type SkillAutoresearchEvent,
} from "@/lib/services/skills/skill-autoresearch-policy";
import type { KanbanTask } from "@/lib/types/kanban";
import { workspaceScope } from "@/lib/types/principal";
import type { EvaluationResult } from "@/lib/services/evaluation/control-plane";
import type { ChatSkillAttribution } from "@/lib/services/chat/skill-attribution";

export type SkillAutoresearchRequest = {
  skillSlug: string;
  targetPath?: string;
  symptom?: string;
  repoRoot?: string;
  benchmarkCommand?: string;
  backendPreference?: SkillAutoresearchBackendPreference;
  companyIds?: string[];
  vaultPath?: string;
};

export async function skillAutoresearchStatus(input: Omit<SkillAutoresearchRequest, "skillSlug"> & { skillSlug?: string } = {}) {
  const [events, evo] = await Promise.all([
    readSkillAnalytics(1_000),
    readRuntimeAvailabilityFor("evo"),
  ]);
  const candidates = detectSkillAutoresearchCandidates(events as SkillAutoresearchEvent[])
    .filter((candidate) => !input.skillSlug || candidate.skillSlug === input.skillSlug.trim().toLowerCase());
  const repoRoot = cleanOptional(input.repoRoot);
  const backend = selectSkillAutoresearchBackend({
    preference: input.backendPreference,
    evoInstalled: evo.installed,
    evoWorkspaceInitialized: Boolean(repoRoot && existsSync(join(repoRoot, ".evo", "meta.json"))),
    repoRoot,
    benchmarkCommand: input.benchmarkCommand,
  });
  return {
    policy: DEFAULT_SKILL_AUTORESEARCH_POLICY,
    backend,
    evo,
    candidates,
  };
}

export async function proposeSkillAutoresearch(input: SkillAutoresearchRequest, candidate?: SkillAutoresearchCandidate) {
  const skillSlug = cleanSkillSlug(input.skillSlug);
  if (!skillSlug) throw new Error("A valid target skill slug is required.");
  const status = await skillAutoresearchStatus({ ...input, skillSlug });
  if (!status.backend.ready) throw new Error(status.backend.reason);
  const companyIds = [...new Set([...(input.companyIds ?? []), ...(candidate?.companyIds ?? [])].map((value) => value.trim()).filter(Boolean))];
  const targetPath = cleanOptional(input.targetPath) ?? `Skills/${skillSlug}/SKILL.md`;
  const symptom = cleanOptional(input.symptom)
    ?? candidate?.evidence.at(-1)?.note
    ?? `${candidate?.failureCount ?? DEFAULT_SKILL_AUTORESEARCH_POLICY.minFailureCount} repeated failures qualify this skill for measured autoresearch.`;
  const plan = buildSkillAutoresearchPlan({
    skillSlug,
    targetPath,
    symptom,
    backend: status.backend,
    benchmarkCommand: input.benchmarkCommand,
  });
  const result = await createBrainReviewProposal({
    kind: "skill-evolution",
    title: `Evolve skill: ${skillSlug}`,
    summary: `${candidate?.failureCount ?? "Reviewed"} observed failure${candidate?.failureCount === 1 ? "" : "s"} qualify ${skillSlug} for a ${status.backend.id} optimizer run. Applying this proposal launches a review-gated Work Board task; it does not replace the installed skill.`,
    proposedContent: proposalContent(plan),
    targetPath,
    risk: "medium",
    evidence: candidate?.evidence.map((event) => ({
      sourceType: "work-board" as const,
      sourceId: event.taskId ?? event.id,
      excerpt: bounded(event.note ?? `${event.event} (${event.status ?? "unknown"}) from ${event.taskSource ?? event.taskId ?? event.id}`, 1_500),
    })) ?? [{ sourceType: "manual" as const, excerpt: bounded(symptom, 1_500) }],
    createdByPrincipalId: "system:skill-autoresearch",
    scope: workspaceScope(["brain:read"], ["brain-review", "skill-autoresearch"]),
    metadata: {
      skillSlug,
      targetPath,
      symptom,
      repoRoot: cleanOptional(input.repoRoot),
      benchmarkCommand: cleanOptional(input.benchmarkCommand),
      backendPreference: input.backendPreference ?? "auto",
      backend: status.backend,
      companyIds,
      plan,
    },
  });
  await appendSkillAnalyticsEvent({
    skillSlug,
    event: "improvement-suggested",
    status: "review",
    taskSource: `brain-review:${result.proposal.id}`,
    note: `Review-gated ${status.backend.id} autoresearch proposed after ${candidate?.failureCount ?? "manual"} observed failures.`,
  });
  return { ...result, plan, backend: status.backend };
}

export async function maybeEnqueueSkillAutoresearch(input: { skillSlug?: string; vaultPath?: string } = {}) {
  const events = await readSkillAnalytics(1_000);
  const candidates = detectSkillAutoresearchCandidates(events as SkillAutoresearchEvent[])
    .filter((candidate) => !input.skillSlug || candidate.skillSlug === input.skillSlug.trim().toLowerCase());
  if (!candidates.length) return { candidates, enqueued: [], skipped: [] as string[] };

  const [inventory, queue] = await Promise.all([
    getSharedBrainSkillsCached(input.vaultPath, { summaryMode: "fast" }),
    readBrainReviewQueue(),
  ]);
  const installed = new Set(inventory.shared.map((skill) => skill.slug));
  const existing = new Set(queue.proposals
    .filter((proposal) => proposal.kind === "skill-evolution" && (proposal.status === "pending" || proposal.status === "approved"))
    .map((proposal) => cleanOptional(proposal.metadata?.skillSlug as string | undefined))
    .filter(Boolean));
  const enqueued = [];
  const skipped: string[] = [];
  for (const candidate of candidates) {
    if (!installed.has(candidate.skillSlug) || existing.has(candidate.skillSlug)) {
      skipped.push(candidate.skillSlug);
      continue;
    }
    const result = await proposeSkillAutoresearch({
      skillSlug: candidate.skillSlug,
      targetPath: `Skills/${candidate.skillSlug}/SKILL.md`,
      companyIds: candidate.companyIds,
      vaultPath: input.vaultPath,
    }, candidate);
    enqueued.push(result.proposal);
    existing.add(candidate.skillSlug);
  }
  return { candidates, enqueued, skipped };
}

export async function recordTaskSkillOutcome(
  task: KanbanTask,
  outcome: "completed" | "failed" | "blocked",
  note?: string,
  options: { vaultPath?: string } = {},
) {
  const companyId = companyIdFromSource(task.source);
  const lowQualityCompletion = outcome === "completed"
    && (task.evaluation?.verdict === "rejected" || task.evaluation?.verdict === "needs-evidence" || (typeof task.evaluation?.score === "number" && task.evaluation.score < 0.65));
  const status = outcome === "blocked" ? "blocked" : outcome === "failed" || lowQualityCompletion ? "failure" : "success";
  const event = outcome === "completed" ? "task-completed" : outcome === "failed" ? "task-failed" : "task-blocked";
  const skills = [...new Set(task.skills.map((skill) => cleanSkillSlug(skill)).filter(Boolean))]
    .filter((skill) => skill !== "hive-skill-autoresearch" && skill !== "evo");
  const recorded = await Promise.all(skills.map((skillSlug) => appendSkillAnalyticsEvent({
    skillSlug,
    event,
    status,
    taskId: task.id,
    taskSource: task.source ?? `work-board:${task.id}`,
    companyId,
    score: task.evaluation?.score ?? undefined,
    note: bounded(note ?? task.evaluation?.checks.map((check) => check.summary).filter(Boolean).join(" ") ?? `${task.title}: ${outcome}`, 1_000),
  })));
  const review = status === "success" ? { candidates: [], enqueued: [], skipped: [] } : await maybeEnqueueSkillAutoresearch({ vaultPath: options.vaultPath });
  return { recorded, review };
}

export async function recordSkillExecutionOutcome(input: {
  skillSlug: string;
  status: "success" | "failure" | "blocked";
  runtime?: string;
  agentId?: string;
  taskSource?: string;
  note?: string;
  score?: number;
  durationMs?: number;
  vaultPath?: string;
}) {
  const event = await appendSkillAnalyticsEvent({
    skillSlug: input.skillSlug,
    event: input.status === "success" ? "action-completed" : "action-failed",
    status: input.status,
    runtime: input.runtime,
    agentId: input.agentId,
    taskSource: input.taskSource,
    note: input.note,
    score: input.score,
    durationMs: input.durationMs,
  });
  const review = input.status === "success"
    ? { candidates: [], enqueued: [], skipped: [] }
    : await maybeEnqueueSkillAutoresearch({ skillSlug: input.skillSlug, vaultPath: input.vaultPath });
  return { event, review };
}

export async function recordChatSkillOutcomes(input: {
  sessionId: string;
  turnId?: string;
  messageIndex?: number;
  skillAttribution?: ChatSkillAttribution[];
  runtime?: string;
  agentId?: string;
  endReason?: string;
  evaluation: EvaluationResult;
  startedAt?: number;
  completedAt?: number;
  vaultPath?: string;
  feedbackRating?: "up" | "down" | null;
}) {
  const skills = [...new Set((input.skillAttribution ?? []).map((item) => cleanSkillSlug(item.skillSlug)).filter(Boolean))]
    .filter((skill) => skill !== "hive-skill-autoresearch" && skill !== "evo");
  if (!skills.length) return [];
  const status = chatOutcomeStatus(input.endReason, input.evaluation);
  const executionId = cleanOptional(input.turnId) ?? `message-${input.messageIndex ?? "latest"}`;
  const taskSource = `chat:${input.sessionId}:${executionId}`;
  const note = input.feedbackRating === "down"
    ? `The user marked this chat response as unhelpful. ${evaluationSummary(input.evaluation)}`
    : input.feedbackRating === "up"
      ? `The user marked this chat response as helpful. ${evaluationSummary(input.evaluation)}`
      : evaluationSummary(input.evaluation);
  return Promise.all(skills.map((skillSlug) => recordSkillExecutionOutcome({
    skillSlug,
    status,
    runtime: input.runtime,
    agentId: input.agentId,
    taskSource,
    note: bounded(note, 1_000),
    score: input.evaluation.score ?? undefined,
    durationMs: input.startedAt && input.completedAt
      ? Math.max(0, input.completedAt - input.startedAt)
      : undefined,
    vaultPath: input.vaultPath,
  })));
}

function chatOutcomeStatus(endReason: string | undefined, evaluation: EvaluationResult): "success" | "failure" | "blocked" {
  if (endReason === "blocked") return "blocked";
  if (
    (endReason && endReason !== "completed")
    || evaluation.verdict === "rejected"
    || evaluation.verdict === "needs-evidence"
    || (typeof evaluation.score === "number" && evaluation.score < 0.65)
  ) return "failure";
  return "success";
}

function evaluationSummary(evaluation: EvaluationResult) {
  const checks = evaluation.checks.map((check) => check.summary).filter(Boolean).join(" ");
  return checks || `Chat evaluation: ${evaluation.verdict}${typeof evaluation.score === "number" ? ` (${evaluation.score.toFixed(2)})` : ""}.`;
}

function proposalContent(plan: ReturnType<typeof buildSkillAutoresearchPlan>) {
  return [
    `Target: ${plan.targetPath ?? plan.skillSlug}`,
    `Observed symptom: ${plan.symptom}`,
    `Backend: ${plan.backend.id}. ${plan.backend.reason}`,
    plan.benchmarkCommand ? `Benchmark: ${plan.benchmarkCommand}` : "Benchmark: establish representative cases and evidence-backed scoring inside the task.",
    "Variants:",
    ...plan.variants.map((variant) => `- ${variant.title}: ${variant.thesis}`),
    "Applying this proposal launches an isolated Work Board optimizer task. The winning diff still requires its own human approval gate before installation.",
  ].join("\n");
}

function companyIdFromSource(source?: string) {
  return source?.match(/^company:([^:]+)/)?.[1];
}

function cleanSkillSlug(value: string | undefined) {
  const cleaned = value?.trim().toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9._-]*$/.test(cleaned) ? cleaned : "";
}

function cleanOptional(value: string | undefined) {
  return value?.trim() || undefined;
}

function bounded(value: string, max: number) {
  return value.trim().slice(0, max);
}
