import type { LoopEvaluationRubric, LoopSpec } from "@/lib/types/loops";
import { withObservation } from "@/lib/services/loops/loop-engine";
import { loopGateFromVerifier } from "@/lib/services/loops/verifier-registry";

export type SkillAutoresearchBackendId = "hivemind-native" | "evo";
export type SkillAutoresearchBackendPreference = "auto" | SkillAutoresearchBackendId;

export type SkillAutoresearchBackendSelection = {
  id: SkillAutoresearchBackendId;
  ready: boolean;
  requiresInitialization: boolean;
  reason: string;
};

export type SkillAutoresearchVariant = {
  id: "better-inputs" | "sharper-output" | "more-robust" | "rethink";
  title: string;
  thesis: string;
};

export type SkillAutoresearchEvent = {
  id: string;
  skillSlug: string;
  event: string;
  status?: string;
  taskId?: string;
  taskSource?: string;
  companyId?: string;
  note?: string;
  createdAt: string;
};

export type SkillAutoresearchCandidate = {
  skillSlug: string;
  failureCount: number;
  distinctExecutionCount: number;
  companyIds: string[];
  latestFailureAt: string;
  evidence: SkillAutoresearchEvent[];
};

export type SkillAutoresearchPlan = {
  skillSlug: string;
  targetPath?: string;
  symptom: string;
  backend: SkillAutoresearchBackendSelection;
  benchmarkCommand?: string;
  variants: SkillAutoresearchVariant[];
  rubric: LoopEvaluationRubric;
  applyPolicy: "review-gated";
  createdAt: number;
};

export const DEFAULT_SKILL_AUTORESEARCH_POLICY = {
  enabled: true,
  minFailureCount: 3,
  minDistinctExecutions: 3,
  applyPolicy: "review-gated" as const,
  backendPreference: "auto" as const,
};

export const SKILL_AUTORESEARCH_VARIANTS: SkillAutoresearchVariant[] = [
  {
    id: "better-inputs",
    title: "Better inputs",
    thesis: "Improve source selection, context gathering, freshness checks, and fallback inputs without changing the skill's purpose.",
  },
  {
    id: "sharper-output",
    title: "Sharper output",
    thesis: "Make the result more decisive, useful, concise, and explicitly structured for its consumer.",
  },
  {
    id: "more-robust",
    title: "More robust",
    thesis: "Strengthen empty-data handling, retries, deduplication, rate limits, validation, and failure reporting.",
  },
  {
    id: "rethink",
    title: "Rethink",
    thesis: "Try a materially different methodology that preserves the same user-facing capability and safety boundary.",
  },
];

const SKILL_AUTORESEARCH_RUBRIC: LoopEvaluationRubric = {
  id: "skill-autoresearch-v1",
  title: "Skill autoresearch evaluator rubric",
  scale: "0-1",
  passThreshold: 0.78,
  axes: [
    { id: "improvement", title: "Improvement vs baseline", weight: 0.3, description: "Measured performance improves over the original skill on representative cases.", scoreFloor: 0.72 },
    { id: "output-value", title: "Output value", weight: 0.2, description: "The result is more useful, decisive, and appropriate to the consuming task.", scoreFloor: 0.7 },
    { id: "clarity", title: "Clarity", weight: 0.125, description: "Instructions and outputs are specific, understandable, and free of filler.", scoreFloor: 0.68 },
    { id: "data-quality", title: "Data quality", weight: 0.125, description: "Inputs, sources, and validation improve or remain at least as strong as baseline.", scoreFloor: 0.68 },
    { id: "robustness", title: "Robustness", weight: 0.15, description: "Failures, edge cases, retries, and empty results are handled safely.", scoreFloor: 0.7 },
    { id: "conventions", title: "Conventions", weight: 0.1, description: "The candidate preserves purpose, frontmatter, credential names, and HivemindOS safety policy.", scoreFloor: 0.75 },
  ],
  notes: [
    "Score the unchanged original on the same cases before evaluating candidates.",
    "A higher aggregate score cannot override an axis floor, failed safety gate, or benchmark regression.",
    "An LLM rubric alone is advisory; prefer deterministic or evidence-backed benchmark cases whenever available.",
  ],
};

export function selectSkillAutoresearchBackend(input: {
  preference?: SkillAutoresearchBackendPreference;
  evoInstalled: boolean;
  evoWorkspaceInitialized?: boolean;
  repoRoot?: string;
  benchmarkCommand?: string;
}): SkillAutoresearchBackendSelection {
  const preference = input.preference ?? DEFAULT_SKILL_AUTORESEARCH_POLICY.backendPreference;
  const evoCanRun = input.evoInstalled && Boolean(input.repoRoot?.trim()) && Boolean(input.benchmarkCommand?.trim());
  if (preference === "hivemind-native") {
    return { id: "hivemind-native", ready: true, requiresInitialization: false, reason: "HivemindOS native agents will run the measured variant loop through the Work Board." };
  }
  if (preference === "evo" && !evoCanRun) {
    const missing = !input.evoInstalled ? "Evo is not installed." : !input.repoRoot?.trim() ? "A git repository is required for Evo." : "A benchmark command is required for Evo.";
    return { id: "evo", ready: false, requiresInitialization: false, reason: missing };
  }
  if (evoCanRun) {
    const requiresInitialization = input.evoWorkspaceInitialized !== true;
    return {
      id: "evo",
      ready: true,
      requiresInitialization,
      reason: requiresInitialization
        ? "Evo is installed; the approved optimizer task will initialize a repo-local Evo workspace before dispatching variants."
        : "Evo is installed and the repo-local workspace is initialized for this benchmark.",
    };
  }
  const reason = !input.evoInstalled
    ? "Evo is not installed, so HivemindOS will use its native Work Board optimizer."
    : !input.repoRoot?.trim()
      ? "No git repository was supplied, so HivemindOS will use its native Work Board optimizer."
      : "No benchmark command was supplied, so HivemindOS will use its native Work Board optimizer with evidence and judge gates.";
  return { id: "hivemind-native", ready: true, requiresInitialization: false, reason };
}

export function buildSkillAutoresearchPlan(input: {
  skillSlug: string;
  targetPath?: string;
  symptom?: string;
  backend: SkillAutoresearchBackendSelection;
  benchmarkCommand?: string;
  now?: number;
}): SkillAutoresearchPlan {
  const skillSlug = cleanSkillSlug(input.skillSlug);
  if (!skillSlug) throw new Error("A valid target skill slug is required.");
  if (!input.backend.ready) throw new Error(input.backend.reason);
  return {
    skillSlug,
    targetPath: cleanOptional(input.targetPath),
    symptom: cleanOptional(input.symptom) ?? "The skill has repeated failures or reviewed low-quality outcomes.",
    backend: input.backend,
    benchmarkCommand: cleanOptional(input.benchmarkCommand),
    variants: SKILL_AUTORESEARCH_VARIANTS.map((variant) => ({ ...variant })),
    rubric: {
      ...SKILL_AUTORESEARCH_RUBRIC,
      axes: SKILL_AUTORESEARCH_RUBRIC.axes.map((axis) => ({ ...axis })),
      notes: [...(SKILL_AUTORESEARCH_RUBRIC.notes ?? [])],
    },
    applyPolicy: "review-gated",
    createdAt: input.now ?? Date.now(),
  };
}

export function buildSkillAutoresearchLoop(plan: SkillAutoresearchPlan, now = Date.now()): LoopSpec {
  const benchmarkNotes = [
    `Target skill: ${plan.skillSlug}.`,
    `Selected backend: ${plan.backend.id}.`,
    plan.backend.requiresInitialization ? "Initialize the repo-local Evo workspace inside the approved task before dispatch." : "Use the selected backend without additional runtime setup.",
    "Score the unchanged original and every candidate against the same cases.",
  ];
  return withObservation({
    mode: "optimizer",
    goal: `Improve ${plan.skillSlug} without changing its purpose, credential contract, or safety boundary.`,
    successCriteria: [
      "The original and all four complete variants are scored against the same representative cases.",
      "The winning candidate clears every rubric floor, safety gate, and measured baseline.",
      "If no candidate improves the original, record a no-improvement result and leave the target unchanged.",
      "The winning diff remains review-gated before it replaces an installed skill.",
    ],
    contract: {
      id: `contract_skill_autoresearch_${stableHash(`${plan.skillSlug}:${plan.createdAt}`)}`,
      title: `${plan.skillSlug} autoresearch contract`,
      plannerAssertions: [
        `The observed symptom is: ${plan.symptom}`,
        `The target is ${plan.targetPath ?? plan.skillSlug}.`,
        `The execution backend is ${plan.backend.id}.`,
      ],
      evaluatorPushback: [
        "Was the unchanged original measured on the exact same cases?",
        "Did any candidate trade safety, source quality, or robustness for a prettier score?",
        "Is the claimed winner supported by benchmark output and an independent reviewer?",
      ],
      agreedDone: [
        "All four variants and the baseline have inspectable score receipts.",
        "The selected candidate has a reviewable diff or a no-improvement receipt.",
        "No installed skill was overwritten automatically.",
      ],
      artifacts: ["Baseline snapshot", "Four candidate SKILL.md files", "Scoring table", "Winning diff or no-improvement receipt"],
      createdAt: now,
    },
    evaluationRubric: plan.rubric,
    evalGates: [
      loopGateFromVerifier("evo:score", { now, required: true, title: "Candidate improves the measured baseline" }),
      loopGateFromVerifier("agent:judge", { now, required: true, title: "Independent skill-quality review accepts the winner" }),
      loopGateFromVerifier("receipt:evidence", { now, required: true, title: "Baseline, candidates, scores, and diff are attached" }),
      loopGateFromVerifier("human:approval", { now, required: true, phase: "post", title: "Winning skill diff approved before installation" }),
    ],
    benchmark: {
      command: plan.benchmarkCommand,
      target: `Improve ${plan.skillSlug} while preserving all regression floors.`,
      metricName: "skill_autoresearch_score",
      metricDirection: "max",
      scoreFloor: plan.rubric.passThreshold,
      instrumentation: plan.benchmarkCommand ? "inline" : "manual",
      discoveredAt: now,
      notes: benchmarkNotes,
    },
    frontierStrategy: { kind: "pareto_per_task", params: { k: 4, task_floor: 0 }, seed: now },
    experiments: plan.variants.map((variant) => ({
      id: `skill_${stableHash(`${plan.skillSlug}:${variant.id}:${now}`)}`,
      title: variant.title,
      hypothesis: variant.thesis,
      status: "candidate" as const,
      createdAt: now,
      updatedAt: now,
    })),
    antiPatterns: [],
    budget: { maxAttempts: 4, maxRuntimeMs: 2 * 60 * 60 * 1_000 },
    retryPolicy: { maxAttempts: 4, onFailure: "needs-human" },
    handoffRules: [
      "Work in an isolated worktree or candidate directory and do not overwrite the installed target skill.",
      "Preserve the target skill's purpose, frontmatter shape, declared credential names, and explicit safety gates.",
      "Treat generated candidates and their self-scores as hypotheses until benchmark and independent-review receipts pass.",
      "Return the winning diff for Brain Review; do not merge, install, publish, or schedule it automatically.",
    ],
    evidenceRequired: [
      "The unchanged baseline and its score.",
      "Each complete candidate and per-axis scoring evidence.",
      "Benchmark output, regression-gate results, and independent reviewer verdict.",
      "A winning diff or an explicit no-improvement receipt.",
    ],
  });
}

export function detectSkillAutoresearchCandidates(
  events: SkillAutoresearchEvent[],
  policy: Partial<Pick<typeof DEFAULT_SKILL_AUTORESEARCH_POLICY, "minFailureCount" | "minDistinctExecutions">> = {},
): SkillAutoresearchCandidate[] {
  const minFailureCount = positiveInteger(policy.minFailureCount) ?? DEFAULT_SKILL_AUTORESEARCH_POLICY.minFailureCount;
  const minDistinctExecutions = positiveInteger(policy.minDistinctExecutions) ?? DEFAULT_SKILL_AUTORESEARCH_POLICY.minDistinctExecutions;
  const bySkill = new Map<string, SkillAutoresearchEvent[]>();
  for (const event of events) {
    const skillSlug = cleanSkillSlug(event.skillSlug);
    if (!skillSlug) continue;
    const current = bySkill.get(skillSlug) ?? [];
    current.push({ ...event, skillSlug });
    bySkill.set(skillSlug, current);
  }
  const candidates: SkillAutoresearchCandidate[] = [];
  for (const [skillSlug, skillEvents] of bySkill) {
    const latestSuggestion = skillEvents
      .filter((event) => event.event === "improvement-suggested")
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
    const latestSuggestionAt = latestSuggestion ? Date.parse(latestSuggestion.createdAt) : Number.NEGATIVE_INFINITY;
    const latestByExecution = new Map<string, SkillAutoresearchEvent>();
    for (const event of skillEvents
      .filter((candidate) => candidate.event !== "improvement-suggested")
      .filter((candidate) => Date.parse(candidate.createdAt) > latestSuggestionAt)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))) {
      latestByExecution.set(executionKey(event), event);
    }
    const failures = [...latestByExecution.values()]
      .filter(isFailureEvent)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    if (failures.length < minFailureCount) continue;
    const latestFailureAt = failures.at(-1)?.createdAt ?? "";
    const executionKeys = new Set(failures.map(executionKey));
    if (executionKeys.size < minDistinctExecutions) continue;
    candidates.push({
      skillSlug,
      failureCount: failures.length,
      distinctExecutionCount: executionKeys.size,
      companyIds: [...new Set(failures.map((event) => cleanOptional(event.companyId)).filter(Boolean) as string[])].sort(),
      latestFailureAt,
      evidence: failures.slice(-8),
    });
  }
  return candidates.sort((left, right) => right.failureCount - left.failureCount || left.skillSlug.localeCompare(right.skillSlug));
}

function executionKey(event: SkillAutoresearchEvent) {
  return event.taskId?.trim() || event.taskSource?.trim() || event.id;
}

function isFailureEvent(event: SkillAutoresearchEvent) {
  return event.status === "failure" || event.status === "blocked" || event.event === "action-failed" || event.event === "task-failed" || event.event === "task-blocked";
}

function cleanSkillSlug(value: string | undefined) {
  const cleaned = value?.trim().toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9._-]*$/.test(cleaned) ? cleaned : "";
}

function cleanOptional(value: string | undefined) {
  return value?.trim() || undefined;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : undefined;
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}
