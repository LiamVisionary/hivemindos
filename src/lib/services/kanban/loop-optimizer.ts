import type {
  KanbanEvalGate,
  KanbanEvalGateKind,
  KanbanEvalGatePhase,
  KanbanEvalGateStatus,
  KanbanLoopAntiPattern,
  KanbanLoopBenchmark,
  KanbanLoopExperiment,
  KanbanLoopExperimentStatus,
  KanbanLoopFrontierItem,
  KanbanLoopFrontierStrategy,
  KanbanLoopMetricDirection,
  KanbanLoopObservation,
  KanbanLoopReceipt,
  KanbanLoopSpec,
} from "@/lib/types/kanban";

const DEFAULT_FRONTIER_STRATEGY: KanbanLoopFrontierStrategy = {
  kind: "pareto_per_task",
  params: { k: 5, task_floor: 0 },
};

export type LoopExperimentInput = Partial<KanbanLoopExperiment> & {
  hypothesis: string;
};

export type LoopDiscoveryInput = Partial<KanbanLoopBenchmark> & {
  goal?: string;
  successCriteria?: string[];
  evalGates?: unknown[];
  frontierStrategy?: KanbanLoopFrontierStrategy;
};

export function normalizeLoopSpec(value: unknown, maxAttempts?: number, maxRuntimeMs?: number): KanbanLoopSpec | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<KanbanLoopSpec>;
  const goal = cleanOptional(input.goal);
  const evalGates = Array.isArray(input.evalGates)
    ? input.evalGates.map(normalizeEvalGate).filter(Boolean) as KanbanEvalGate[]
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
  const loop: KanbanLoopSpec = {
    mode: normalizeLoopMode(input.mode),
    goal: goal ?? "",
    successCriteria: cleanStringArray(input.successCriteria),
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

export function normalizeLoopReceipts(value: unknown): KanbanLoopReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeLoopReceipt).filter(Boolean) as KanbanLoopReceipt[];
}

export function mergeLoopReceipts(existing: unknown, next: unknown) {
  const receipts = new Map<string, KanbanLoopReceipt>();
  for (const item of [...normalizeLoopReceipts(existing), ...normalizeLoopReceipts(next)]) {
    receipts.set(item.id, item);
  }
  return [...receipts.values()].sort((left, right) => left.createdAt - right.createdAt);
}

export function loopCompletionBlock(loop: KanbanLoopSpec | undefined, receipts: KanbanLoopReceipt[]) {
  const requiredGates = loop?.evalGates.filter((gate) => gate.required) ?? [];
  if (!requiredGates.length) return null;
  const passedGateIds = new Set(receipts.filter((receipt) => receipt.status === "passed" && receipt.gateId).map((receipt) => receipt.gateId));
  const missing = requiredGates.filter((gate) => gate.status !== "passed" && !passedGateIds.has(gate.id));
  if (!missing.length) return null;
  return {
    missingGateIds: missing.map((gate) => gate.id),
    missingGateTitles: missing.map((gate) => gate.title),
  };
}

export function applyLoopReceipts(loop: KanbanLoopSpec | undefined, receipts: KanbanLoopReceipt[]) {
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

export function loopMaxAttempts(loop?: KanbanLoopSpec) {
  return positiveInteger(loop?.retryPolicy?.maxAttempts) ?? positiveInteger(loop?.budget?.maxAttempts);
}

export function discoverLoop(loop: KanbanLoopSpec | undefined, input: LoopDiscoveryInput): KanbanLoopSpec {
  return withObservation({
    ...loop,
    mode: loop?.mode ?? "optimizer",
    goal: cleanOptional(input.goal) ?? loop?.goal ?? "",
    successCriteria: cleanStringArray(input.successCriteria).length ? cleanStringArray(input.successCriteria) : loop?.successCriteria ?? [],
    evalGates: input.evalGates ? input.evalGates.map(normalizeEvalGate).filter(Boolean) as KanbanEvalGate[] : loop?.evalGates ?? [],
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

export function recordLoopExperiment(loop: KanbanLoopSpec | undefined, input: LoopExperimentInput): KanbanLoopSpec {
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

export function recordLoopAntiPatterns(loop: KanbanLoopSpec | undefined, values: unknown[]): KanbanLoopSpec | undefined {
  const normalized = values.map(normalizeAntiPattern).filter(Boolean) as KanbanLoopAntiPattern[];
  if (!normalized.length && !loop) return undefined;
  const prior = loop ?? { mode: "optimizer" as const, goal: "", successCriteria: [], evalGates: [] };
  const antiPatterns = new Map((prior.antiPatterns ?? []).map((item) => [item.id, item]));
  for (const item of normalized) antiPatterns.set(item.id, item);
  return withObservation({ ...prior, antiPatterns: [...antiPatterns.values()].sort((left, right) => left.createdAt - right.createdAt) });
}

export function withObservation(loop: KanbanLoopSpec): KanbanLoopSpec {
  return {
    ...loop,
    frontierStrategy: normalizeFrontierStrategy(loop.frontierStrategy),
    experiments: normalizeExperiments(loop.experiments),
    antiPatterns: normalizeAntiPatterns(loop.antiPatterns),
    observation: buildObservation(loop),
  };
}

function buildObservation(loop: KanbanLoopSpec): KanbanLoopObservation {
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

function pickFrontier(experiments: KanbanLoopExperiment[], strategy: KanbanLoopFrontierStrategy, direction: KanbanLoopMetricDirection): KanbanLoopFrontierItem[] {
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

function frontierCandidates(experiments: KanbanLoopExperiment[]) {
  const childParents = new Set(experiments.filter((item) => item.status !== "discarded" && item.status !== "failed" && item.parentId).map((item) => item.parentId));
  return experiments.filter((item) => ["candidate", "evaluated", "committed"].includes(item.status) && !childParents.has(item.id));
}

function rankFrontier(items: KanbanLoopExperiment[]): KanbanLoopFrontierItem[] {
  return items.map((item, index) => ({
    id: item.id,
    rank: index + 1,
    score: item.score,
    hypothesis: item.hypothesis,
    status: item.status,
    parentId: item.parentId,
  }));
}

function sortByScore(items: KanbanLoopExperiment[], direction: KanbanLoopMetricDirection) {
  return [...items].sort((left, right) => directionalScore(right.score, direction) - directionalScore(left.score, direction) || left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

function weightedSample(items: KanbanLoopExperiment[], direction: KanbanLoopMetricDirection, count: number, temperature: number, rng: () => number) {
  const remaining = [...items];
  const picked: KanbanLoopExperiment[] = [];
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

function paretoFront(items: KanbanLoopExperiment[], direction: KanbanLoopMetricDirection, count: number, taskFloor: number, rng: () => number) {
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
  const picked: KanbanLoopExperiment[] = [];
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

function runningBest(experiments: KanbanLoopExperiment[], direction: KanbanLoopMetricDirection) {
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

function normalizeBenchmark(value: unknown): KanbanLoopBenchmark | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<KanbanLoopBenchmark>;
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

function normalizeExperiment(value: unknown): KanbanLoopExperiment | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<KanbanLoopExperiment>;
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

function normalizeExperiments(value: unknown): KanbanLoopExperiment[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeExperiment).filter(Boolean).sort((left, right) => left!.createdAt - right!.createdAt) as KanbanLoopExperiment[];
}

function normalizeAntiPattern(value: unknown): KanbanLoopAntiPattern | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<KanbanLoopAntiPattern>;
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

function normalizeAntiPatterns(value: unknown): KanbanLoopAntiPattern[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeAntiPattern).filter(Boolean).sort((left, right) => left!.createdAt - right!.createdAt) as KanbanLoopAntiPattern[];
}

function normalizeLoopReceipt(value: unknown): KanbanLoopReceipt | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<KanbanLoopReceipt>;
  const summary = cleanOptional(input.summary);
  const gateId = cleanOptional(input.gateId);
  if (!summary && !gateId) return null;
  const seed = `${gateId ?? "loop"}:${summary ?? ""}:${positiveNumber(input.createdAt) ?? ""}`;
  return {
    id: cleanOptional(input.id) ?? `lr_${stableHash(seed)}`,
    gateId,
    status: input.status === "failed" ? "failed" : input.status === "skipped" ? "skipped" : "passed",
    summary: summary ?? "",
    evidence: cleanStringArray(input.evidence),
    verifier: cleanOptional(input.verifier),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : undefined,
    createdAt: positiveNumber(input.createdAt) ?? Date.now(),
  };
}

function normalizeEvalGate(value: unknown): KanbanEvalGate | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<KanbanEvalGate>;
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

function normalizeFrontierStrategy(value: unknown): KanbanLoopFrontierStrategy {
  if (!value || typeof value !== "object") return DEFAULT_FRONTIER_STRATEGY;
  const input = value as Partial<KanbanLoopFrontierStrategy>;
  const kind = ["argmax", "top_k", "epsilon_greedy", "softmax", "pareto_per_task"].includes(input.kind ?? "")
    ? input.kind as KanbanLoopFrontierStrategy["kind"]
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

function normalizeExperimentStatus(value?: string): KanbanLoopExperimentStatus {
  return ["candidate", "running", "committed", "discarded", "failed"].includes(value ?? "") ? value as KanbanLoopExperimentStatus : "evaluated";
}

function normalizeEvalGatePhase(value?: string): KanbanEvalGatePhase {
  return value === "pre" ? "pre" : "post";
}

function normalizeEvalGateKind(value?: string): KanbanEvalGateKind {
  return ["command", "test", "artifact", "agent", "human", "receipt"].includes(value ?? "")
    ? value as KanbanEvalGateKind
    : "receipt";
}

function normalizeEvalGateStatus(value?: string): KanbanEvalGateStatus {
  return ["passed", "failed", "skipped"].includes(value ?? "") ? value as KanbanEvalGateStatus : "pending";
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

function directionalScore(score: number | undefined, direction: KanbanLoopMetricDirection) {
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
