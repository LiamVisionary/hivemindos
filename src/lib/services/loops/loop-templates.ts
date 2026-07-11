import type { LoopSpec } from "@/lib/types/loops";
import { withObservation } from "@/lib/services/loops/loop-engine";
import { listLoopPatterns } from "@/lib/services/loops/pattern-registry";
import { loopGateFromVerifier, type LoopVerifierId } from "@/lib/services/loops/verifier-registry";

export type LoopTemplateId =
  | "engineering-discipline"
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
  const gates = input.templateId === "engineering-discipline"
    ? buildEngineeringDisciplineGates(now)
    : [
      ...requiredVerifierIds.map((verifierId) => loopGateFromVerifier(verifierId, { now, required: true })),
      ...optionalVerifierIds.map((verifierId) => loopGateFromVerifier(verifierId, { now, required: false })),
    ];
  const loop: LoopSpec = {
    mode: template.defaultMode,
    goal: input.goal.trim(),
    successCriteria: input.successCriteria?.filter(Boolean) ?? defaultSuccessCriteria(input.templateId),
    contract: buildTemplateContract(input, template.title, now),
    evaluationRubric: buildTemplateRubric(input.templateId, input.title ?? template.title, now),
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
  const usesProductTasteRubric = shouldUseProductTasteRubric(input);
  return withObservation({
    mode: "optimizer",
    goal: `${input.workTitle}: improve "${goal}" while preserving the unit's charter, budget, and evidence trail.`,
    successCriteria: [
      input.metricTarget ? `${metric} moves toward ${input.metricTarget}.` : `${metric} has measurable evidence of improvement or a clear next measurement.`,
      "The result includes reusable learning: artifact, workflow, decision, customer signal, or anti-pattern.",
      `Any spend or external action stays inside ${governanceLabel}.`,
    ],
    contract: buildOperatingUnitContract(input, goal, metric, now),
    evaluationRubric: usesProductTasteRubric
      ? buildProductTasteRubric(`rubric_unit_${stableHash(`${input.unitId}:${input.workTitle}`)}`, "Product/design evaluator rubric")
      : undefined,
    evalGates: [
      loopGateFromVerifier("receipt:evidence", { id: `${gatePrefix}-outcome`, title: `Outcome evidence for ${metric}`, required: true, now }),
      ...(usesProductTasteRubric
        ? [loopGateFromVerifier("agent:judge", { id: `${gatePrefix}-judge`, title: "Independent product-quality review", required: true, now })]
        : []),
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
      "Use an isolated worktree or equivalent checkout for code-changing work tied to a repo.",
    ],
    evidenceRequired: [
      "Outcome evidence tied to the operating metric.",
      "Reusable learning or a clear reason none was found.",
      "Artifacts, receipts, links, or test output when available.",
    ],
  });
}

function defaultSuccessCriteria(templateId: LoopTemplateId): string[] {
  if (templateId === "engineering-discipline") return [
    "The scoped user-visible outcome is implemented without unauthorized expansion.",
    "Baseline and final evidence exercise the relevant entry path.",
    "Tests, lint, types, and independent review pass or unchanged pre-existing failures are named precisely.",
  ];
  if (templateId === "app-build-harness") return ["Planner scope is implemented.", "Independent judge accepts the result.", "The app renders and core workflow works."];
  if (templateId === "code-fix") return ["Focused failure is fixed.", "No new lint or type failures are introduced."];
  if (templateId === "evo-benchmark") return ["Benchmark score improves or a defensible no-improvement receipt is recorded."];
  return ["The requested outcome is delivered with evidence.", "Weak or failed attempts are recorded before retrying."];
}

function defaultHandoffRules(templateId: LoopTemplateId): string[] {
  if (templateId === "engineering-discipline") return [
    "Use only the planning, TDD, debugging, worktree, delegation, and review stages proportionate to this task.",
    "Preserve concurrent work; do not commit, push, merge, delete, deploy, or fan out without authorization.",
    "Report changes, baseline-to-final deltas, real-path verification, known gaps, rollback, and repository state.",
  ];
  if (templateId === "app-build-harness") return ["Keep planner, builder, and judge roles separate when possible.", "Attach screenshots or artifact links for judge review."];
  if (templateId === "evo-benchmark") return ["Use Evo when a benchmark command and isolated worktree are available.", "Record losing branches as experiments or anti-patterns."];
  return ["Record receipts for decisions, evidence, and unresolved risk."];
}

function defaultEvidenceRequired(templateId: LoopTemplateId): string[] {
  if (templateId === "engineering-discipline") return [
    "Scope, constraints, rollback, and design decision or a documented reason a separate design gate was unnecessary.",
    "Baseline output from the relevant entry path.",
    "Red/green regression evidence for breakable logic, or a concrete non-applicability receipt.",
    "Focused test, lint, type, runtime, browser, or artifact outputs appropriate to the change.",
    "Independent review receipt and a final verification-before-completion receipt.",
  ];
  if (templateId === "code-fix") return ["Test, lint, or typecheck output.", "Files changed."];
  if (templateId === "daily-brief") return ["Sources checked.", "Delivery receipt."];
  return ["Result summary.", "Verification evidence.", "Known gaps or next retry target."];
}

function buildEngineeringDisciplineGates(now: number): LoopSpec["evalGates"] {
  return [
    loopGateFromVerifier("human:approval", {
      id: "engineering-design-approval",
      title: "Material design decision approved when required",
      required: false,
      phase: "pre",
      now,
    }),
    loopGateFromVerifier("receipt:evidence", {
      id: "engineering-baseline-evidence",
      title: "Relevant baseline captured",
      required: true,
      phase: "pre",
      now,
    }),
    loopGateFromVerifier("receipt:evidence", {
      id: "engineering-red-green-evidence",
      title: "Red/green evidence or non-applicability recorded",
      required: true,
      phase: "post",
      now,
    }),
    loopGateFromVerifier("command:test", { id: "engineering-focused-tests", title: "Focused tests pass", required: true, now }),
    loopGateFromVerifier("command:lint", { id: "engineering-lint", title: "Relevant lint gate passes", required: true, now }),
    loopGateFromVerifier("command:typecheck", { id: "engineering-typecheck", title: "Relevant type gate passes", required: true, now }),
    loopGateFromVerifier("agent:judge", { id: "engineering-independent-review", title: "Independent engineering review accepts", required: true, now }),
    loopGateFromVerifier("receipt:evidence", { id: "engineering-final-evidence", title: "Final completion evidence attached", required: true, now }),
  ];
}

function buildTemplateContract(input: BuildLoopTemplateInput, templateTitle: string, now: number): LoopSpec["contract"] {
  const title = input.title?.trim() || templateTitle;
  const criteria = input.successCriteria?.filter(Boolean) ?? defaultSuccessCriteria(input.templateId);
  return {
    id: `contract_${input.templateId}_${stableHash(`${title}:${input.goal}`)}`,
    title: `${title} done contract`,
    plannerAssertions: [
      `The loop goal is: ${input.goal.trim()}.`,
      `The selected pattern is ${templateTitle}; work should follow its phases before completion.`,
      "The worker may finish only with durable evidence, not a summary of intent.",
    ],
    evaluatorPushback: [
      "What artifact, command output, receipt, or reviewer decision proves this is done?",
      "What would make the result unsafe, fabricated, too shallow, or blocked on a human?",
      "Which side effects need a human gate before the worker proceeds?",
    ],
    agreedDone: criteria,
    artifacts: [
      "Work Board task result",
      "loop-receipts block",
      "Any deliverable paths, URLs, screenshots, or command output referenced by the gates",
    ],
    createdAt: now,
  };
}

function buildOperatingUnitContract(input: OperatingUnitLearningLoopInput, goal: string, metric: string, now: number): LoopSpec["contract"] {
  return {
    id: `contract_unit_${stableHash(`${input.unitId}:${input.runId}:${input.workTitle}`)}`,
    title: `${input.unitName} - ${input.workTitle} contract`,
    plannerAssertions: [
      `This branch should advance the strategic goal: ${goal}.`,
      `The branch should produce measurable evidence for ${metric}.`,
      "The branch should avoid repeating recently completed company work.",
    ],
    evaluatorPushback: [
      "Does the output prove an outcome, or only describe activity?",
      "Are customer-facing URLs, files, receipts, or decisions explicitly named?",
      "Did the worker respect spend, approval, and external-action policy?",
    ],
    agreedDone: [
      input.metricTarget ? `${metric} has evidence of movement toward ${input.metricTarget}.` : `${metric} has a measurement or an honest next measurement.`,
      "Reusable learning is captured as an artifact, workflow, decision, customer signal, or anti-pattern.",
      "Human approval is requested instead of bypassed for policy exceptions or irreversible side effects.",
    ],
    artifacts: [
      "Work Board result",
      "Loop receipts",
      "Company memory digest entry",
      "Customer-facing deliverables when produced",
    ],
    createdAt: now,
  };
}

function buildTemplateRubric(templateId: LoopTemplateId, title: string, now: number): LoopSpec["evaluationRubric"] {
  if (templateId === "app-build-harness") return buildProductTasteRubric(`rubric_${templateId}_${stableHash(`${title}:${now}`)}`, "App/product evaluator rubric");
  if (templateId === "content") {
    return {
      id: `rubric_${templateId}_${stableHash(`${title}:${now}`)}`,
      title: "Content evaluator rubric",
      scale: "0-1",
      passThreshold: 0.78,
      axes: [
        { id: "clarity", title: "Clarity", weight: 0.3, description: "The piece is easy to understand, specific, and structured for the intended audience.", scoreFloor: 0.7 },
        { id: "originality", title: "Originality", weight: 0.2, description: "The piece avoids generic phrasing and contains a distinctive angle or useful synthesis.", scoreFloor: 0.65 },
        { id: "craft", title: "Craft", weight: 0.25, description: "The language, pacing, formatting, and proofing feel deliberate and polished.", scoreFloor: 0.7 },
        { id: "fit", title: "Fit", weight: 0.25, description: "The result satisfies the brief, brand risk, evidence needs, and publication context.", scoreFloor: 0.7 },
      ],
      notes: ["A result below threshold should revise or request human direction before publication."],
    };
  }
  return undefined;
}

function buildProductTasteRubric(id: string, title: string): LoopSpec["evaluationRubric"] {
  return {
    id,
    title,
    scale: "0-1",
    passThreshold: 0.8,
    axes: [
      { id: "design", title: "Design", weight: 0.3, description: "The product is visually coherent, scan-friendly, accessible, and appropriate to the domain.", scoreFloor: 0.72 },
      { id: "originality", title: "Originality", weight: 0.2, description: "The result has a clear point of view and avoids template-like or generic execution.", scoreFloor: 0.65 },
      { id: "craft", title: "Craft", weight: 0.25, description: "Interactions, copy, motion, states, and edge cases feel finished rather than merely assembled.", scoreFloor: 0.72 },
      { id: "functionality", title: "Functionality", weight: 0.25, description: "The core workflow works through the real user path and has evidence of verification.", scoreFloor: 0.72 },
    ],
    notes: [
      "The evaluator should score each axis from 0 to 1 and reject if the weighted score is below threshold.",
      "Design and functionality cannot be satisfied by screenshots or prose alone when a runnable surface exists.",
    ],
  };
}

function shouldUseProductTasteRubric(input: OperatingUnitLearningLoopInput): boolean {
  return /app|brand|checkout|content|copy|customer|demo|design|email|landing|page|preview|product|site|store|ui|video|website/i.test(
    [input.workTitle, input.strategicGoal, input.branchAgent].filter(Boolean).join(" "),
  );
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}
