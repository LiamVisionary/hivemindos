import "server-only";

import { createTask } from "@/lib/services/kanban/local-kanban-store";
import { buildSkillAutoresearchLoop, buildSkillAutoresearchPlan, selectSkillAutoresearchBackend } from "@/lib/services/skills/skill-autoresearch-policy";
import type { BrainReviewProposal } from "@/lib/types/brain-review";

export async function launchSkillAutoresearchTask(
  proposal: BrainReviewProposal,
  input: { vaultPath?: string; kanbanFolder?: string } = {},
) {
  if (proposal.kind !== "skill-evolution") throw new Error("Only skill-evolution proposals can launch autoresearch tasks.");
  const metadata = proposal.metadata ?? {};
  const skillSlug = cleanSkillSlug(metadata.skillSlug);
  if (!skillSlug) throw new Error("The skill-evolution proposal is missing a valid skillSlug.");
  const targetPath = cleanOptional(metadata.targetPath) ?? proposal.targetPath ?? `Skills/${skillSlug}/SKILL.md`;
  const backendRecord = metadata.backend && typeof metadata.backend === "object" ? metadata.backend as Record<string, unknown> : {};
  const backendId = backendRecord.id === "evo" ? "evo" : "hivemind-native";
  const backend = selectSkillAutoresearchBackend({
    preference: backendId,
    evoInstalled: backendId === "evo",
    evoWorkspaceInitialized: backendRecord.requiresInitialization !== true,
    repoRoot: cleanOptional(metadata.repoRoot),
    benchmarkCommand: cleanOptional(metadata.benchmarkCommand),
  });
  if (!backend.ready) throw new Error(backend.reason);
  const plan = buildSkillAutoresearchPlan({
    skillSlug,
    targetPath,
    symptom: cleanOptional(metadata.symptom) ?? proposal.summary,
    backend,
    benchmarkCommand: cleanOptional(metadata.benchmarkCommand),
  });
  const companyIds = cleanStringList(metadata.companyIds);
  const companyId = companyIds[0];
  const task = await createTask(null, {
    title: `Autoresearch ${skillSlug}`,
    body: taskBody(plan, cleanOptional(metadata.repoRoot)),
    assignee: "queen-bee",
    tenant: companyId,
    status: "ready",
    priority: "high",
    workspace: cleanOptional(metadata.repoRoot) ? "worktree" : "scratch",
    source: companyId ? `company:${companyId}:skill-autoresearch:${proposal.id}` : `skill-autoresearch:${proposal.id}`,
    skills: ["hive-skill-autoresearch", ...(backend.id === "evo" ? ["evo"] : [])],
    loop: buildSkillAutoresearchLoop(plan),
    idempotencyKey: `skill-autoresearch:${proposal.id}`,
    maxAttempts: 4,
    maxRuntimeMs: 2 * 60 * 60 * 1_000,
  }, {
    vaultPath: input.vaultPath,
    kanbanFolder: input.kanbanFolder,
  });
  return { ...task, plan, backend };
}

function taskBody(plan: ReturnType<typeof buildSkillAutoresearchPlan>, repoRoot?: string) {
  return [
    `Run the built-in HivemindOS skill autoresearch mechanism for \`${plan.skillSlug}\`.`,
    `Target: \`${plan.targetPath ?? plan.skillSlug}\`.`,
    repoRoot ? `Repository: \`${repoRoot}\`.` : "The target is a shared skill; use isolated candidate directories and leave the installed skill untouched.",
    `Observed symptom: ${plan.symptom}`,
    `Backend: ${plan.backend.id}. ${plan.backend.reason}`,
    plan.benchmarkCommand ? `Benchmark command: \`${plan.benchmarkCommand}\`.` : "First establish representative evaluation cases from the attached evidence.",
    "Baseline the original, create all four complete variants, score them on the same cases, run regression gates and independent review, then attach a winning diff or SKILL_AUTORESEARCH_NO_IMPROVEMENT.",
    "Do not install or overwrite the winner. The loop's final human-approval gate owns promotion.",
  ].join("\n\n");
}

function cleanSkillSlug(value: unknown) {
  const cleaned = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9][a-z0-9._-]*$/.test(cleaned) ? cleaned : "";
}

function cleanOptional(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanStringList(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))] : [];
}
