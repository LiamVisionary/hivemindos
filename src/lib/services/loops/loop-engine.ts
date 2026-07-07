import type {
  LoopEvalGate,
  LoopEvalGateKind,
  LoopEvalGatePhase,
  LoopEvalGateStatus,
  LoopAntiPattern,
  LoopBenchmark,
  LoopExperiment,
  LoopExperimentStatus,
  LoopFrontierItem,
  LoopFrontierStrategy,
  LoopMetricDirection,
  LoopObservation,
  LoopReceipt,
  LoopSpec,
  LoopContractSnapshot,
  LoopEvaluationRubric,
  LoopRubricAxis,
} from "@/lib/types/loops";

const DEFAULT_FRONTIER_STRATEGY: LoopFrontierStrategy = {
  kind: "pareto_per_task",
  params: { k: 5, task_floor: 0 },
};

export type LoopExperimentInput = Partial<LoopExperiment> & {
  hypothesis: string;
};

export type LoopDiscoveryInput = Partial<LoopBenchmark> & {
  goal?: string;
  successCriteria?: string[];
  contract?: unknown;
  evaluationRubric?: unknown;
  evalGates?: unknown[];
  frontierStrategy?: LoopFrontierStrategy;
};

export function normalizeLoopSpec(value: unknown, maxAttempts?: number, maxRuntimeMs?: number): LoopSpec | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<LoopSpec>;
  const goal = cleanOptional(input.goal);
  const evalGates = Array.isArray(input.evalGates)
    ? input.evalGates.map(normalizeEvalGate).filter(Boolean) as LoopEvalGate[]
    : [];
  const benchmark = normalizeBenchmark(input.benchmark);
  const experiments = normalizeExperiments(input.experiments);
  if (!goal && !evalGates.length && !benchmark && !experiments.length) return undefined;
  const retryPolicy = input.retryPolicy && typeof input.retryPolicy === "object"
    ? {
      maxAttempts: positiveInteger(input.retryPolicy.maxAttempts),
      onFailure: input.retryPolicy.onFailure === "needs-human" ? "needs-human" as const : input.retryPolicy.onFailure === "retry" ? "retry" as const : undefined,
    }
    : undefined;
  const budget = input.budget && typeof input.budget === "object" ? input.budget : {};
  const loop: LoopSpec = {
    mode: normalizeLoopMode(input.mode),
    goal: goal ?? "",
    successCriteria: cleanStringArray(input.successCriteria),
    contract: normalizeLoopContract(input.contract),
    evaluationRubric: normalizeLoopEvaluationRubric(input.evaluationRubric),
    evalGates,
    benchmark,
    frontierStrategy: normalizeFrontierStrategy(input.frontierStrategy),
    experiments,
    antiPatterns: normalizeAntiPatterns(input.antiPatterns),
    budget: {
      maxAttempts: positiveInteger(budget.maxAttempts) ?? positiveInteger(maxAttempts) ?? retryPolicy?.maxAttempts,
      maxRuntimeMs: positiveNumber(budget.maxRuntimeMs) ?? positiveNumber(maxRuntimeMs),
      maxTokens: positiveInteger(budget.maxTokens),
      maxCostUsd: positiveNumber(budget.maxCostUsd),
    },
    retryPolicy,
    handoffRules: cleanStringArray(input.handoffRules),
    evidenceRequired: cleanStringArray(input.evidenceRequired),
  };
  return withObservation(loop);
}

export function normalizeLoopReceipts(value: unknown): LoopReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeLoopReceipt).filter(Boolean) as LoopReceipt[];
}

export function mergeLoopReceipts(existing: unknown, next: unknown) {
  const receipts = new Map<string, LoopReceipt>();
  for (const item of [...normalizeLoopReceipts(existing), ...normalizeLoopReceipts(next)]) {
    receipts.set(item.id, item);
  }
  return [...receipts.values()].sort((left, right) => left.createdAt - right.createdAt);
}

export function loopCompletionBlock(loop: LoopSpec | undefined, receipts: LoopReceipt[]) {
  const requiredGates = loop?.evalGates.filter((gate) => gate.required) ?? [];
  const passedGateIds = new Set(receipts.filter((receipt) => receipt.status === "passed" && receipt.gateId).map((receipt) => receipt.gateId));
  const missing = requiredGates.filter((gate) => gate.status !== "passed" && !passedGateIds.has(gate.id));
  // A hard-fail receipt blocks completion regardless of whether any gate is "required".
  // A required-gate MISS means "no evidence yet" — recoverable and, by company design,
  // intentionally non-blocking (see buildOperatingUnitLearningLoop). A hard-fail means
  // "affirmatively false evidence" — e.g. a claimed-live URL that is dead or on a
  // reserved/example/mock host — which must never be allowed to pass as done.
  const hardFails = receipts.filter((receipt) => receipt.status === "failed" && isHardFailReceipt(receipt));
  if (!missing.length && !hardFails.length) return null;
  return {
    missingGateIds: [...missing.map((gate) => gate.id), ...hardFails.map((receipt) => receipt.gateId ?? receipt.id)],
    missingGateTitles: [...missing.map((gate) => gate.title), ...hardFails.map((receipt) => receipt.summary || "Integrity check failed")],
  };
}

function isHardFailReceipt(receipt: LoopReceipt): boolean {
  return (receipt.metadata as { hardFail?: unknown } | undefined)?.hardFail === true;
}

export function applyLoopReceipts(loop: LoopSpec | undefined, receipts: LoopReceipt[]) {
  if (!loop) return loop;
  const receiptsByGate = new Map(receipts.filter((receipt) => receipt.gateId).map((receipt) => [receipt.gateId, receipt]));
  return withObservation({
    ...loop,
    evalGates: loop.evalGates.map((gate) => {
      const receipt = receiptsByGate.get(gate.id);
      if (!receipt) return gate;
      return {
        ...gate,
        status: receipt.status,
        verifier: receipt.verifier ?? gate.verifier,
        evidence: receipt.evidence.length ? receipt.evidence : gate.evidence,
        summary: receipt.summary || gate.summary,
        updatedAt: receipt.createdAt,
      };
    }),
  });
}

export function loopMaxAttempts(loop?: LoopSpec) {
  return positiveInteger(loop?.retryPolicy?.maxAttempts) ?? positiveInteger(loop?.budget?.maxAttempts);
}

export function discoverLoop(loop: LoopSpec | undefined, input: LoopDiscoveryInput): LoopSpec {
  return withObservation({
    ...loop,
    mode: loop?.mode ?? "optimizer",
    goal: cleanOptional(input.goal) ?? loop?.goal ?? "",
    successCriteria: cleanStringArray(input.successCriteria).length ? cleanStringArray(input.successCriteria) : loop?.successCriteria ?? [],
    contract: normalizeLoopContract(input.contract) ?? loop?.contract,
    evaluationRubric: normalizeLoopEvaluationRubric(input.evaluationRubric) ?? loop?.evaluationRubric,
    evalGates: input.evalGates ? input.evalGates.map(normalizeEvalGate).filter(Boolean) as LoopEvalGate[] : loop?.evalGates ?? [],
    benchmark: normalizeBenchmark({ ...loop?.benchmark, ...input }) ?? loop?.benchmark,
    frontierStrategy: normalizeFrontierStrategy(input.frontierStrategy ?? loop?.frontierStrategy),
    experiments: loop?.experiments ?? [],
    antiPatterns: loop?.antiPatterns ?? [],
    budget: loop?.budget,
    retryPolicy: loop?.retryPolicy,
    handoffRules: loop?.handoffRules,
    evidenceRequired: loop?.evidenceRequired,
  });
}

export function recordLoopExperiment(loop: LoopSpec | undefined, input: LoopExperimentInput): LoopSpec {
  const now = Date.now();
  const prior = loop ?? {
    mode: "optimizer" as const,
    goal: "",
    successCriteria: [],
    evalGates: [],
    experiments: [],
    antiPatterns: [],
    frontierStrategy: DEFAULT_FRONTIER_STRATEGY,
  };
  const experiment = normalizeExperiment({
    ...input,
    id: cleanOptional(input.id) ?? `exp_${now.toString(36)}_${stableHash(input.hypothesis).slice(0, 5)}`,
    status: input.status ?? "evaluated",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  });
  if (!experiment) return withObservation(prior);
  const experiments = new Map((prior.experiments ?? []).map((item) => [item.id, item]));
  experiments.set(experiment.id, experiment);
  return withObservation({
    ...prior,
    experiments: [...experiments.values()].sort((left, right) => left.createdAt - right.createdAt),
  });
}

export function recordLoopAntiPatterns(loop: LoopSpec | undefined, values: unknown[]): LoopSpec | undefined {
  const normalized = values.map(normalizeAntiPattern).filter(Boolean) as LoopAntiPattern[];
  if (!normalized.length && !loop) return undefined;
  const prior = loop ?? { mode: "optimizer" as const, goal: "", successCriteria: [], evalGates: [] };
  const antiPatterns = new Map((prior.antiPatterns ?? []).map((item) => [item.id, item]));
  for (const item of normalized) antiPatterns.set(item.id, item);
  return withObservation({ ...prior, antiPatterns: [...antiPatterns.values()].sort((left, right) => left.createdAt - right.createdAt) });
}

export function withObservation(loop: LoopSpec): LoopSpec {
  return {
    ...loop,
    contract: normalizeLoopContract(loop.contract),
    evaluationRubric: normalizeLoopEvaluationRubric(loop.evaluationRubric),
    frontierStrategy: normalizeFrontierStrategy(loop.frontierStrategy),
    experiments: normalizeExperiments(loop.experiments),
    antiPatterns: normalizeAntiPatterns(loop.antiPatterns),
    observation: buildObservation(loop),
  };
}

function buildObservation(loop: LoopSpec): LoopObservation {
  const experiments = normalizeExperiments(loop.experiments);
  const metricDirection = loop.benchmark?.metricDirection ?? "max";
  const scored = experiments.filter((item) => typeof item.score === "number" && ["committed", "evaluated"].includes(item.status));
  const best = scored.sort((left, right) => directionalScore(right.score, metricDirection) - directionalScore(left.score, metricDirection) || left.createdAt - right.createdAt)[0];
  return {
    totalExperiments: experiments.length,
    committedExperiments: experiments.filter((item) => item.status === "committed").length,
    discardedExperiments: experiments.filter((item) => item.status === "discarded").length,
    failedExperiments: experiments.filter((item) => item.status === "failed").length,
    bestExperimentId: best?.id,
    bestScore: best?.score,
    runningBestExperimentIds: runningBest(experiments, metricDirection),
    frontier: pickFrontier(experiments, normalizeFrontierStrategy(loop.frontierStrategy), metricDirection),
    antiPatternCount: loop.antiPatterns?.length ?? 0,
    pendingRequiredGateCount: loop.evalGates.filter((gate) => gate.required && gate.status !== "passed").length,
    updatedAt: Date.now(),
  };
}

function pickFrontier(experiments: LoopExperiment[], strategy: LoopFrontierStrategy, direction: LoopMetricDirection): LoopFrontierItem[] {
  const candidates = frontierCandidates(experiments);
  if (!candidates.length) return [];
  const params = strategy.params ?? {};
  const rng = seededRandom(strategy.seed ?? stableHashNumber(JSON.stringify(candidates.map((item) => item.id))));
  if (strategy.kind === "argmax") return rankFrontier(sortByScore(candidates, direction).slice(0, 1));
  if (strategy.kind === "top_k") return rankFrontier(sortByScore(candidates, direction).slice(0, positiveInteger(params.k) ?? 5));
  if (strategy.kind === "epsilon_greedy") {
    const epsilon = clamp(Number(params.epsilon ?? 0.1), 0, 1);
    return rankFrontier([rng() < epsilon ? candidates[Math.floor(rng() * candidates.length)] : sortByScore(candidates, direction)[0]].filter(Boolean));
  }
  if (strategy.kind === "softmax") {
    return rankFrontier(weightedSample(candidates, direction, positiveInteger(params.k) ?? 5, positiveNumber(params.temperature) ?? 0.5, rng));
  }
  return rankFrontier(paretoFront(candidates, direction, positiveInteger(params.k) ?? 5, Number(params.task_floor ?? 0), rng));
}

function frontierCandidates(experiments: LoopExperiment[]) {
  const childParents = new Set(experiments.filter((item) => item.status !== "discarded" && item.status !== "failed" && item.parentId).map((item) => item.parentId));
  return experiments.filter((item) => ["candidate", "evaluated", "committed"].includes(item.status) && !childParents.has(item.id));
}

function rankFrontier(items: LoopExperiment[]): LoopFrontierItem[] {
  return items.map((item, index) => ({
    id: item.id,
    rank: index + 1,
    score: item.score,
    hypothesis: item.hypothesis,
    status: item.status,
    parentId: item.parentId,
  }));
}

function sortByScore(items: LoopExperiment[], direction: LoopMetricDirection) {
  return [...items].sort((left, right) => directionalScore(right.score, direction) - directionalScore(left.score, direction) || left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

function weightedSample(items: LoopExperiment[], direction: LoopMetricDirection, count: number, temperature: number, rng: () => number) {
  const remaining = [...items];
  const picked: LoopExperiment[] = [];
  while (picked.length < count && remaining.length) {
    const scores = remaining.map((item) => directionalScore(item.score, direction));
    const max = Math.max(...scores);
    const weights = scores.map((score) => Math.exp((score - max) / temperature));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let draw = rng() * total;
    const index = weights.findIndex((weight) => {
      draw -= weight;
      return draw <= 0;
    });
    picked.push(...remaining.splice(index >= 0 ? index : remaining.length - 1, 1));
  }
  return picked;
}

function paretoFront(items: LoopExperiment[], direction: LoopMetricDirection, count: number, taskFloor: number, rng: () => number) {
  const taskIds = intersect(items.map((item) => new Set(Object.keys(item.taskScores ?? {}))));
  if (!taskIds.size) return sortByScore(items, direction).slice(0, count);
  const winners = new Map<string, Set<string>>();
  for (const taskId of taskIds) {
    const taskDirection = items.find((item) => item.taskDirections?.[taskId])?.taskDirections?.[taskId] ?? direction;
    const scores = items.map((item) => Number(item.taskScores?.[taskId]));
    const best = Math.max(...scores.map((score) => directionalScore(score, taskDirection)));
    const bestRaw = Math.max(...scores);
    if (taskDirection === "max" && bestRaw <= taskFloor) continue;
    winners.set(taskId, new Set(items.filter((item) => directionalScore(Number(item.taskScores?.[taskId]), taskDirection) === best).map((item) => item.id)));
  }
  const survivorIds = new Set([...winners.values()].flatMap((set) => [...set]));
  const survivors = items.filter((item) => survivorIds.has(item.id));
  if (!survivors.length) return sortByScore(items, direction).slice(0, count);
  const weighted = survivors.map((item) => ({ item, weight: [...winners.values()].filter((set) => set.has(item.id)).length || 1 }));
  const picked: LoopExperiment[] = [];
  while (picked.length < count && weighted.length) {
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    let draw = rng() * total;
    const index = weighted.findIndex((item) => {
      draw -= item.weight;
      return draw <= 0;
    });
    picked.push(weighted.splice(index >= 0 ? index : weighted.length - 1, 1)[0].item);
  }
  return picked;
}

function runningBest(experiments: LoopExperiment[], direction: LoopMetricDirection) {
  const recordIds: string[] = [];
  let bestScore: number | undefined;
  for (const item of [...experiments].sort((left, right) => left.createdAt - right.createdAt)) {
    if (item.status !== "committed" || typeof item.score !== "number") continue;
    if (bestScore === undefined || directionalScore(item.score, direction) > directionalScore(bestScore, direction)) {
      bestScore = item.score;
      recordIds.push(item.id);
    }
  }
  return recordIds;
}

function normalizeBenchmark(value: unknown): LoopBenchmark | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<LoopBenchmark>;
  const target = cleanOptional(input.target);
  const command = cleanOptional(input.command);
  const metricName = cleanOptional(input.metricName);
  if (!target && !command && !metricName) return undefined;
  return {
    target,
    command,
    metricName,
    metricDirection: input.metricDirection === "min" ? "min" : "max",
    scoreFloor: typeof input.scoreFloor === "number" ? input.scoreFloor : undefined,
    resourceProfile: cleanOptional(input.resourceProfile),
    instrumentation: input.instrumentation === "sdk" || input.instrumentation === "inline" ? input.instrumentation : input.instrumentation === "manual" ? "manual" : undefined,
    discoveredAt: positiveNumber(input.discoveredAt) ?? Date.now(),
    notes: cleanStringArray(input.notes),
  };
}

function normalizeLoopContract(value: unknown): LoopContractSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<LoopContractSnapshot>;
  const plannerAssertions = cleanStringArray(input.plannerAssertions);
  const evaluatorPushback = cleanStringArray(input.evaluatorPushback);
  const agreedDone = cleanStringArray(input.agreedDone);
  const artifacts = cleanStringArray(input.artifacts);
  if (!plannerAssertions.length && !evaluatorPushback.length && !agreedDone.length && !artifacts.length) return undefined;
  const title = cleanOptional(input.title) ?? "Loop done contract";
  return {
    id: cleanOptional(input.id) ?? `contract_${stableHash(`${title}:${agreedDone.join("|")}`)}`,
    title,
    plannerAssertions,
    evaluatorPushback,
    agreedDone,
    artifacts,
    createdAt: positiveNumber(input.createdAt) ?? Date.now(),
  };
}

function normalizeLoopEvaluationRubric(value: unknown): LoopEvaluationRubric | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<LoopEvaluationRubric>;
  const axes = Array.isArray(input.axes)
    ? input.axes.map(normalizeRubricAxis).filter(Boolean) as LoopRubricAxis[]
    : [];
  if (!axes.length) return undefined;
  const title = cleanOptional(input.title) ?? "Loop evaluator rubric";
  return {
    id: cleanOptional(input.id) ?? `rubric_${stableHash(`${title}:${axes.map((axis) => axis.id).join("|")}`)}`,
    title,
    scale: "0-1",
    passThreshold: clamp(Number(input.passThreshold ?? 0.75), 0, 1),
    axes: axes.slice(0, 8),
    notes: cleanStringArray(input.notes),
  };
}

function normalizeRubricAxis(value: unknown): LoopRubricAxis | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<LoopRubricAxis>;
  const title = cleanOptional(input.title);
  const description = cleanOptional(input.description);
  if (!title || !description) return null;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const id = cleanOptional(input.id) ?? (slug || `axis_${stableHash(title)}`);
  return {
    id,
    title,
    weight: clamp(Number(input.weight ?? 0), 0, 1),
    description,
    scoreFloor: typeof input.scoreFloor === "number" ? clamp(input.scoreFloor, 0, 1) : undefined,
  };
}

function normalizeExperiment(value: unknown): LoopExperiment | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<LoopExperiment>;
  const hypothesis = cleanOptional(input.hypothesis);
  if (!hypothesis) return null;
  const now = Date.now();
  return {
    id: cleanOptional(input.id) ?? `exp_${stableHash(hypothesis)}`,
    parentId: cleanOptional(input.parentId),
    runId: cleanOptional(input.runId),
    title: cleanOptional(input.title),
    hypothesis,
    status: normalizeExperimentStatus(input.status),
    score: typeof input.score === "number" && Number.isFinite(input.score) ? input.score : undefined,
    taskScores: cleanNumberRecord(input.taskScores),
    taskDirections: cleanDirectionRecord(input.taskDirections),
    gateReceipts: normalizeLoopReceipts(input.gateReceipts),
    agent: cleanOptional(input.agent),
    result: cleanOptional(input.result),
    discardedReason: cleanOptional(input.discardedReason),
    createdAt: positiveNumber(input.createdAt) ?? now,
    updatedAt: positiveNumber(input.updatedAt) ?? now,
  };
}

function normalizeExperiments(value: unknown): LoopExperiment[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeExperiment).filter(Boolean).sort((left, right) => left!.createdAt - right!.createdAt) as LoopExperiment[];
}

function normalizeAntiPattern(value: unknown): LoopAntiPattern | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<LoopAntiPattern>;
  const title = cleanOptional(input.title);
  const reason = cleanOptional(input.reason);
  if (!title || !reason) return null;
  return {
    id: cleanOptional(input.id) ?? `anti_${stableHash(`${title}:${reason}`)}`,
    title,
    reason,
    sourceExperimentId: cleanOptional(input.sourceExperimentId),
    evidence: cleanStringArray(input.evidence),
    createdAt: positiveNumber(input.createdAt) ?? Date.now(),
  };
}

function normalizeAntiPatterns(value: unknown): LoopAntiPattern[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeAntiPattern).filter(Boolean).sort((left, right) => left!.createdAt - right!.createdAt) as LoopAntiPattern[];
}

function normalizeLoopReceipt(value: unknown): LoopReceipt | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<LoopReceipt>;
  const summary = cleanOptional(input.summary);
  const gateId = cleanOptional(input.gateId);
  if (!summary && !gateId) return null;
  const seed = `${gateId ?? "loop"}:${summary ?? ""}:${positiveNumber(input.createdAt) ?? ""}`;
  return {
    id: cleanOptional(input.id) ?? `lr_${stableHash(seed)}`,
    gateId,
    // Fail closed: only an explicit, recognized status counts. A missing/garbage status
    // must NOT default to "passed" — that would let a malformed receipt (e.g. one POSTed to
    // the complete API without a status) silently satisfy a required gate.
    status: input.status === "passed" || input.status === "failed" || input.status === "skipped" ? input.status : "failed",
    summary: summary ?? "",
    evidence: cleanStringArray(input.evidence),
    verifier: cleanOptional(input.verifier),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : undefined,
    createdAt: positiveNumber(input.createdAt) ?? Date.now(),
  };
}

function normalizeEvalGate(value: unknown): LoopEvalGate | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<LoopEvalGate>;
  const title = cleanOptional(input.title) ?? cleanOptional(input.id) ?? "Eval gate";
  const id = cleanOptional(input.id) ?? `gate_${stableHash(title)}`;
  const now = Date.now();
  return {
    id,
    title,
    kind: normalizeEvalGateKind(input.kind),
    phase: normalizeEvalGatePhase(input.phase),
    required: input.required !== false,
    status: normalizeEvalGateStatus(input.status),
    command: cleanOptional(input.command),
    verifier: cleanOptional(input.verifier),
    evidence: cleanStringArray(input.evidence),
    summary: cleanOptional(input.summary),
    createdAt: positiveNumber(input.createdAt) ?? now,
    updatedAt: positiveNumber(input.updatedAt),
  };
}

function normalizeFrontierStrategy(value: unknown): LoopFrontierStrategy {
  if (!value || typeof value !== "object") return DEFAULT_FRONTIER_STRATEGY;
  const input = value as Partial<LoopFrontierStrategy>;
  const kind = ["argmax", "top_k", "epsilon_greedy", "softmax", "pareto_per_task"].includes(input.kind ?? "")
    ? input.kind as LoopFrontierStrategy["kind"]
    : DEFAULT_FRONTIER_STRATEGY.kind;
  return {
    kind,
    params: cleanNumberRecord(input.params),
    seed: positiveInteger(input.seed),
  };
}

function normalizeLoopMode(value?: string) {
  return value === "open" || value === "optimizer" ? value : "closed";
}

function normalizeExperimentStatus(value?: string): LoopExperimentStatus {
  return ["candidate", "running", "committed", "discarded", "failed"].includes(value ?? "") ? value as LoopExperimentStatus : "evaluated";
}

function normalizeEvalGatePhase(value?: string): LoopEvalGatePhase {
  return value === "pre" ? "pre" : "post";
}

function normalizeEvalGateKind(value?: string): LoopEvalGateKind {
  return ["command", "test", "artifact", "agent", "human", "receipt"].includes(value ?? "")
    ? value as LoopEvalGateKind
    : "receipt";
}

function normalizeEvalGateStatus(value?: string): LoopEvalGateStatus {
  return ["passed", "failed", "skipped"].includes(value ?? "") ? value as LoopEvalGateStatus : "pending";
}

function cleanNumberRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, raw]) => {
    const numeric = Number(raw);
    return key && Number.isFinite(numeric) ? [[key, numeric] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function cleanDirectionRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, raw]) => raw === "min" || raw === "max" ? [[key, raw] as const] : []);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function cleanStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean).slice(0, 24)
    : [];
}

function cleanOptional(value?: string | null) {
  return value?.trim() || undefined;
}

function positiveNumber(value?: number | null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function positiveInteger(value?: number | null) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function directionalScore(score: number | undefined, direction: LoopMetricDirection) {
  if (typeof score !== "number" || !Number.isFinite(score)) return Number.NEGATIVE_INFINITY;
  return direction === "min" ? -score : score;
}

function intersect(sets: Array<Set<string>>) {
  if (!sets.length) return new Set<string>();
  return sets.reduce((left, right) => new Set([...left].filter((item) => right.has(item))));
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function stableHashNumber(value: string) {
  return parseInt(stableHash(value).slice(0, 8), 36) || 1;
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
