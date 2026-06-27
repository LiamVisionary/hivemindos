import type { LoopSpec } from "@/lib/types/loops";
import { withObservation } from "@/lib/services/loops/loop-engine";
import { listLoopPatterns } from "@/lib/services/loops/pattern-registry";
import { loopGateFromVerifier, type LoopVerifierId } from "@/lib/services/loops/verifier-registry";

export type LoopTemplateId =
  | "code-fix"
  | "app-build-harness"
  | "research"
  | "content"
  | "daily-brief"
  | "operating-unit-learning"
  | "evo-benchmark";

export type LoopTemplateDefinition = {
  id: LoopTemplateId;
  title: string;
  description: string;
  defaultMode: LoopSpec["mode"];
  verifierIds: LoopVerifierId[];
};

export type BuildLoopTemplateInput = {
  templateId: LoopTemplateId;
  goal: string;
  title?: string;
  successCriteria?: string[];
  requiredVerifierIds?: LoopVerifierId[];
  optionalVerifierIds?: LoopVerifierId[];
  maxAttempts?: number;
  maxRuntimeMs?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  benchmarkCommand?: string;
  benchmarkMetricName?: string;
  benchmarkTarget?: string;
  evidenceRequired?: string[];
  handoffRules?: string[];
  now?: number;
};

export type OperatingUnitLearningLoopInput = {
  unitId: string;
  unitName: string;
  workTitle: string;
  runId: string;
  metricName?: string;
  metricTarget?: string;
  strategicGoal?: string;
  branchAgent?: string;
  governanceLabel?: string;
  now?: number;
};

export const LOOP_TEMPLATES: Record<LoopTemplateId, LoopTemplateDefinition> = Object.fromEntries(
  listLoopPatterns().map((pattern) => [
    pattern.id,
    {
      id: pattern.id as LoopTemplateId,
      title: pattern.name,
      description: pattern.description,
      defaultMode: pattern.defaultMode,
      verifierIds: pattern.verifierIds,
    },
  ]),
) as Record<LoopTemplateId, LoopTemplateDefinition>;

export function listLoopTemplates(): LoopTemplateDefinition[] {
  return Object.values(LOOP_TEMPLATES);
}

export function buildLoopFromTemplate(input: BuildLoopTemplateInput): LoopSpec {
  const template = LOOP_TEMPLATES[input.templateId];
  const now = input.now ?? Date.now();
  const requiredVerifierIds = input.requiredVerifierIds ?? template.verifierIds;
  const optionalVerifierIds = input.optionalVerifierIds ?? [];
  const gates = [
    ...requiredVerifierIds.map((verifierId) => loopGateFromVerifier(verifierId, { now, required: true })),
    ...optionalVerifierIds.map((verifierId) => loopGateFromVerifier(verifierId, { now, required: false })),
  ];
  const loop: LoopSpec = {
    mode: template.defaultMode,
    goal: input.goal.trim(),
    successCriteria: input.successCriteria?.filter(Boolean) ?? defaultSuccessCriteria(input.templateId),
    evalGates: gates,
    benchmark: input.benchmarkCommand || input.benchmarkMetricName || input.benchmarkTarget
      ? {
        command: input.benchmarkCommand,
        metricName: input.benchmarkMetricName,
        target: input.benchmarkTarget,
        metricDirection: "max",
        instrumentation: "manual",
        discoveredAt: now,
        notes: [`Created from ${template.title}.`],
      }
      : undefined,
    frontierStrategy: template.defaultMode === "optimizer"
      ? { kind: "pareto_per_task", params: { k: 5, task_floor: 0 }, seed: now }
      : undefined,
    experiments: template.defaultMode === "optimizer"
      ? [{
        id: `exp_${now.toString(36)}_${stableHash(input.goal)}`,
        title: input.title ?? template.title,
        hypothesis: input.goal.trim(),
        status: "candidate",
        createdAt: now,
        updatedAt: now,
      }]
      : [],
    antiPatterns: [],
    budget: {
      maxAttempts: input.maxAttempts ?? 3,
      maxRuntimeMs: input.maxRuntimeMs,
      maxTokens: input.maxTokens,
      maxCostUsd: input.maxCostUsd,
    },
    retryPolicy: {
      maxAttempts: input.maxAttempts ?? 3,
      onFailure: "retry",
    },
    handoffRules: input.handoffRules ?? defaultHandoffRules(input.templateId),
    evidenceRequired: input.evidenceRequired ?? defaultEvidenceRequired(input.templateId),
  };
  return withObservation(loop);
}

export function buildOperatingUnitLearningLoop(input: OperatingUnitLearningLoopInput): LoopSpec {
  const now = input.now ?? Date.now();
  const metric = input.metricName?.trim() || "outcome";
  const goal = input.strategicGoal?.trim() || input.unitName;
  const gatePrefix = `unit-${input.unitId}-${input.runId}-${input.workTitle}`.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
  const governanceLabel = input.governanceLabel ?? "governance policy";
  return withObservation({
    mode: "optimizer",
    goal: `${input.workTitle}: improve "${goal}" while preserving the unit's charter, budget, and evidence trail.`,
    successCriteria: [
      input.metricTarget ? `${metric} moves toward ${input.metricTarget}.` : `${metric} has measurable evidence of improvement or a clear next measurement.`,
      "The result includes reusable learning: artifact, workflow, decision, customer signal, or anti-pattern.",
      `Any spend or external action stays inside ${governanceLabel}.`,
    ],
    evalGates: [
      loopGateFromVerifier("receipt:evidence", { id: `${gatePrefix}-outcome`, title: `Outcome evidence for ${metric}`, required: false, now }),
      loopGateFromVerifier("receipt:evidence", { id: `${gatePrefix}-learning`, title: "Reviewed learning distillation candidate", required: false, now }),
      loopGateFromVerifier("governance:policy", { id: `${gatePrefix}-governance`, title: "Budget and policy constraints respected", required: false, now }),
    ],
    benchmark: {
      target: input.metricTarget ? `${metric} -> ${input.metricTarget}` : metric,
      metricName: metric,
      metricDirection: "max",
      instrumentation: "manual",
      discoveredAt: now,
      notes: [
        "Created from operating unit dispatch.",
        "Compatible with Evo-style branch scoring: task receipts can later become per-task benchmark scores.",
      ],
    },
    frontierStrategy: { kind: "pareto_per_task", params: { k: 5, task_floor: 0 }, seed: now },
    experiments: [{
      id: `exp_${input.runId}_${stableHash(input.workTitle)}`,
      title: input.workTitle,
      hypothesis: `This work item is a branch toward the operating goal: ${goal}.`,
      status: "candidate",
      agent: input.branchAgent,
      createdAt: now,
      updatedAt: now,
    }],
    antiPatterns: [],
    budget: { maxAttempts: 3, maxRuntimeMs: 60 * 60 * 1000 },
    retryPolicy: { maxAttempts: 3, onFailure: "needs-human" },
    handoffRules: [
      "Prefer recording evidence and reusable learning over only marking the task done.",
      "Escalate irreversible external actions or budget exceptions for human approval.",
    ],
    evidenceRequired: [
      "Outcome evidence tied to the operating metric.",
      "Reusable learning or a clear reason none was found.",
      "Artifacts, receipts, links, or test output when available.",
    ],
  });
}

function defaultSuccessCriteria(templateId: LoopTemplateId): string[] {
  if (templateId === "app-build-harness") return ["Planner scope is implemented.", "Independent judge accepts the result.", "The app renders and core workflow works."];
  if (templateId === "code-fix") return ["Focused failure is fixed.", "No new lint or type failures are introduced."];
  if (templateId === "evo-benchmark") return ["Benchmark score improves or a defensible no-improvement receipt is recorded."];
  return ["The requested outcome is delivered with evidence.", "Weak or failed attempts are recorded before retrying."];
}

function defaultHandoffRules(templateId: LoopTemplateId): string[] {
  if (templateId === "app-build-harness") return ["Keep planner, builder, and judge roles separate when possible.", "Attach screenshots or artifact links for judge review."];
  if (templateId === "evo-benchmark") return ["Use Evo when a benchmark command and isolated worktree are available.", "Record losing branches as experiments or anti-patterns."];
  return ["Record receipts for decisions, evidence, and unresolved risk."];
}

function defaultEvidenceRequired(templateId: LoopTemplateId): string[] {
  if (templateId === "code-fix") return ["Test, lint, or typecheck output.", "Files changed."];
  if (templateId === "daily-brief") return ["Sources checked.", "Delivery receipt."];
  return ["Result summary.", "Verification evidence.", "Known gaps or next retry target."];
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}
