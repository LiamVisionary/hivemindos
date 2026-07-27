import "server-only";

import { randomUUID } from "crypto";
import { appendFile, mkdir, readFile } from "fs/promises";
import { dirname, join } from "path";

import { homedir } from "@/lib/home-dir";
import { redactSecretText } from "@/lib/services/agent-security-proxy";
import {
  HARNESS_CONDITIONS,
  HARNESS_DECISIONS,
  HARNESS_RUN_OUTCOMES,
  type HarnessAuthorityEnvelope,
  type HarnessBudget,
  type HarnessCondition,
  type HarnessContextEvidence,
  type HarnessDecision,
  type HarnessExperimentComparison,
  type HarnessExperimentCreateInput,
  type HarnessExperimentListFilter,
  type HarnessExperimentRecord,
  type HarnessIntervention,
  type HarnessJobContract,
  type HarnessProof,
  type HarnessRunMetrics,
  type HarnessRunRecord,
  type HarnessWorker,
} from "@/lib/types/harness-experiments";

const HARNESS_EXPERIMENT_FILE = join(homedir(), ".hivemindos", "harness-experiments.jsonl");
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 200;
const MAX_RUNS = 200;
const MAX_STRING = 2_000;
const MAX_EVIDENCE_ITEMS = 80;
const MIN_COMPARATIVE_RUNS = 3;

let harnessWriteQueue: Promise<unknown> = Promise.resolve();

export async function createHarnessExperiment(input: HarnessExperimentCreateInput) {
  const createdAt = finiteNumber(input.createdAt) ?? Date.now();
  const record: HarnessExperimentRecord = {
    schemaVersion: 1,
    id: cleanId(input.id) || `harness_${createdAt.toString(36)}_${randomUUID().slice(0, 8)}`,
    contract: normalizeJobContract(input.contract),
    intervention: normalizeIntervention(input.intervention),
    runs: [],
    comparison: emptyComparison(),
    decision: "pending",
    decisionEvidence: [],
    createdAt,
    updatedAt: createdAt,
  };
  return enqueueHarnessWrite(async () => {
    if ((await readHarnessExperimentHeads()).some((candidate) => candidate.id === record.id)) {
      throw new Error(`Harness experiment ${record.id} already exists.`);
    }
    await appendHarnessSnapshot(record);
    return record;
  });
}

export async function recordHarnessRun(experimentId: string, value: unknown) {
  return enqueueHarnessWrite(async () => {
    const current = await findHarnessExperiment(experimentId);
    const run = normalizeHarnessRun(value, current);
    if (current.runs.some((candidate) => candidate.id === run.id)) {
      throw new Error(`Harness run ${run.id} already exists.`);
    }
    enforceHarnessBudget(current, run);
    const runs = [...current.runs, run].slice(-MAX_RUNS);
    const updated: HarnessExperimentRecord = {
      ...current,
      runs,
      comparison: compareHarnessRuns(current.contract, runs),
      decision: "pending",
      decisionEvidence: [],
      retirementCondition: undefined,
      updatedAt: Math.max(Date.now(), run.completedAt, current.updatedAt + 1),
    };
    await appendHarnessSnapshot(updated);
    return updated;
  });
}

export async function decideHarnessExperiment(input: {
  experimentId: string;
  decision: unknown;
  evidence?: unknown;
  retirementCondition?: unknown;
}) {
  return enqueueHarnessWrite(async () => {
    const current = await findHarnessExperiment(input.experimentId);
    const decision = normalizeDecision(input.decision);
    const decisionEvidence = cleanStringList(input.evidence, MAX_EVIDENCE_ITEMS);
    if (!decisionEvidence.length) throw new Error("A harness decision requires evidence.");
    const block = harnessDecisionBlock(current.comparison, decision);
    if (block) throw new Error(block);
    const updated: HarnessExperimentRecord = {
      ...current,
      decision,
      decisionEvidence,
      retirementCondition: cleanString(input.retirementCondition),
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    };
    await appendHarnessSnapshot(updated);
    return updated;
  });
}

export async function getHarnessExperiment(id: string) {
  return findHarnessExperiment(id);
}

async function findHarnessExperiment(id: string) {
  const clean = cleanId(id);
  if (!clean) throw new Error("Harness experiment id is required.");
  const experiment = (await readHarnessExperimentHeads()).find((candidate) => candidate.id === clean);
  if (!experiment) throw new Error("Harness experiment not found.");
  return experiment;
}

export async function listHarnessExperiments(filter: HarnessExperimentListFilter = {}) {
  const limit = normalizeLimit(filter.limit);
  const decision = HARNESS_DECISIONS.includes(filter.decision as HarnessDecision)
    ? filter.decision as HarnessDecision
    : undefined;
  const experiments = (await readHarnessExperimentHeads())
    .filter((experiment) => !decision || experiment.decision === decision)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
  return { experiments, updatedAt: experiments[0]?.updatedAt ?? 0 };
}

export function compareHarnessRuns(contract: HarnessJobContract, runs: HarnessRunRecord[]): HarnessExperimentComparison {
  const baseline = runs.filter((run) => run.condition === "baseline");
  const treatment = runs.filter((run) => run.condition === "treatment");
  const ablation = runs.filter((run) => run.condition === "ablation");
  const parityFailures = harnessParityFailures(contract, [...baseline, ...treatment]);
  const baselineAcceptedRate = rate(baseline, (run) => run.outcome === "accepted");
  const treatmentAcceptedRate = rate(treatment, (run) => run.outcome === "accepted");
  const baselineProofRate = rate(baseline, proofSatisfied);
  const treatmentProofRate = rate(treatment, proofSatisfied);
  const baselineAverageElapsedMs = average(baseline, (run) => run.metrics.elapsedMs);
  const treatmentAverageElapsedMs = average(treatment, (run) => run.metrics.elapsedMs);
  const baselineAveragePromptTokens = averagePresent(baseline, (run) => run.metrics.promptTokens);
  const treatmentAveragePromptTokens = averagePresent(treatment, (run) => run.metrics.promptTokens);
  const claimLimits: string[] = [];
  if (baseline.length < MIN_COMPARATIVE_RUNS || treatment.length < MIN_COMPARATIVE_RUNS) {
    claimLimits.push(`Comparative claims require at least ${MIN_COMPARATIVE_RUNS} baseline and ${MIN_COMPARATIVE_RUNS} treatment runs.`);
  }
  if (parityFailures.length) claimLimits.push("Worker, target, authority, session, or environment parity was not held steady.");
  if (treatment.some((run) => !run.interventionAvailable)) claimLimits.push("The intervention was unavailable in at least one treatment run.");
  if (treatment.some((run) => !run.interventionExercised)) claimLimits.push("The intervention was not exercised in at least one treatment run.");
  if (baseline.some((run) => run.interventionAvailable)) claimLimits.push("The intervention leaked into at least one baseline run.");
  if (baseline.some((run) => run.interventionExercised)) claimLimits.push("The intervention was exercised in at least one baseline run.");
  return {
    baselineRuns: baseline.length,
    treatmentRuns: treatment.length,
    ablationRuns: ablation.length,
    baselineAcceptedRate,
    treatmentAcceptedRate,
    acceptanceDelta: subtract(treatmentAcceptedRate, baselineAcceptedRate),
    baselineProofRate,
    treatmentProofRate,
    proofDelta: subtract(treatmentProofRate, baselineProofRate),
    baselineAverageElapsedMs,
    treatmentAverageElapsedMs,
    elapsedDeltaMs: subtract(treatmentAverageElapsedMs, baselineAverageElapsedMs),
    baselineAveragePromptTokens,
    treatmentAveragePromptTokens,
    promptTokenDelta: subtract(treatmentAveragePromptTokens, baselineAveragePromptTokens),
    parityFailures,
    claimReady: claimLimits.length === 0,
    claimLimits,
  };
}

export function harnessDecisionBlock(comparison: HarnessExperimentComparison, decision: HarnessDecision) {
  if (decision === "pending") return null;
  if (!comparison.baselineRuns || !comparison.treatmentRuns) {
    return "A harness decision requires both baseline and treatment evidence.";
  }
  if (decision !== "retain") return null;
  if (!comparison.claimReady) return `The intervention cannot be retained yet: ${comparison.claimLimits.join(" ")}`;
  if (comparison.treatmentAcceptedRate !== 1 || comparison.treatmentProofRate !== 1) {
    return "The intervention cannot be retained unless every treatment run satisfies the accepted outcome and worker-produced proof requirement.";
  }
  if ((comparison.acceptanceDelta ?? 0) < 0 || (comparison.proofDelta ?? 0) < 0) {
    return "The intervention cannot be retained while accepted outcomes or proof quality regress.";
  }
  const improved = (comparison.acceptanceDelta ?? 0) > 0
    || (comparison.proofDelta ?? 0) > 0
    || (comparison.elapsedDeltaMs ?? 0) < 0
    || (comparison.promptTokenDelta ?? 0) < 0;
  return improved ? null : "The intervention cannot be retained without an observed outcome, proof, latency, or token improvement.";
}

function harnessParityFailures(contract: HarnessJobContract, runs: HarnessRunRecord[]) {
  const failures = new Set<string>();
  for (const run of runs) {
    if (run.targetRevision !== contract.targetRevision) failures.add(`Target revision differs in ${run.id}.`);
    if (workerIdentity(run.worker) !== workerIdentity(contract.worker)) failures.add(`Worker differs in ${run.id}.`);
    if (run.authorityMode !== contract.authority.mode) failures.add(`Authority differs in ${run.id}.`);
    if (run.evaluationId !== contract.evaluatorId) failures.add(`Evaluator differs in ${run.id}.`);
    if (!run.environmentFingerprint) failures.add(`Environment fingerprint is missing in ${run.id}.`);
    if (!run.freshSession) failures.add(`Fresh-session evidence is missing in ${run.id}.`);
    if (!run.isolatedTarget) failures.add(`Isolated-target evidence is missing in ${run.id}.`);
  }
  const fingerprints = new Set(runs.map((run) => run.environmentFingerprint).filter(Boolean));
  if (fingerprints.size > 1) failures.add("Environment fingerprints differ across conditions.");
  if (new Set(runs.map((run) => run.sessionId)).size !== runs.length) failures.add("A session id was reused across harness runs.");
  return [...failures];
}

function enforceHarnessBudget(experiment: HarnessExperimentRecord, run: HarnessRunRecord) {
  const budget = experiment.contract.budget;
  const conditionRuns = experiment.runs.filter((candidate) => candidate.condition === run.condition).length;
  if (conditionRuns >= budget.maxRunsPerCondition) {
    throw new Error(`Harness ${run.condition} run budget of ${budget.maxRunsPerCondition} is exhausted.`);
  }
  if (budget.maxRuntimeMs !== undefined && run.metrics.elapsedMs > budget.maxRuntimeMs) {
    throw new Error(`Harness run exceeds the ${budget.maxRuntimeMs} ms runtime budget.`);
  }
  const runTokens = (run.metrics.promptTokens ?? 0) + (run.metrics.completionTokens ?? 0);
  if (budget.maxTokens !== undefined && runTokens > budget.maxTokens) {
    throw new Error(`Harness run exceeds the ${budget.maxTokens} token budget.`);
  }
  if (budget.maxCostUsd !== undefined && (run.metrics.costUsd ?? 0) > budget.maxCostUsd) {
    throw new Error(`Harness run exceeds the $${budget.maxCostUsd} cost budget.`);
  }
}

function normalizeJobContract(value: unknown): HarnessJobContract {
  const input = objectValue(value);
  const proofRequired = cleanStringList(input.proofRequired, MAX_EVIDENCE_ITEMS);
  if (!proofRequired.length) throw new Error("Harness contract proofRequired must name at least one proof boundary.");
  return {
    title: requiredString(input.title, "Harness contract title"),
    targetRevision: requiredString(input.targetRevision, "Harness target revision"),
    externalState: requiredString(input.externalState, "Harness external state"),
    worker: normalizeWorker(input.worker),
    representativeJob: requiredString(input.representativeJob, "Harness representative job"),
    acceptedOutcome: requiredString(input.acceptedOutcome, "Harness accepted outcome"),
    evaluatorId: requiredString(input.evaluatorId, "Harness evaluator id"),
    proofRequired,
    authority: normalizeAuthority(input.authority),
    budget: normalizeBudget(input.budget),
    suspectedGap: requiredString(input.suspectedGap, "Harness suspected gap"),
  };
}

function normalizeIntervention(value: unknown): HarnessIntervention {
  const input = objectValue(value);
  return {
    owner: requiredString(input.owner, "Harness intervention owner"),
    change: requiredString(input.change, "Harness intervention change"),
    expectedBehavior: requiredString(input.expectedBehavior, "Harness expected behavior"),
    mechanism: requiredString(input.mechanism, "Harness intervention mechanism"),
    supportingEvidence: cleanStringList(input.supportingEvidence, MAX_EVIDENCE_ITEMS),
    weakeningEvidence: cleanStringList(input.weakeningEvidence, MAX_EVIDENCE_ITEMS),
    carryingCost: requiredString(input.carryingCost, "Harness carrying cost"),
  };
}

function normalizeHarnessRun(value: unknown, experiment: HarnessExperimentRecord): HarnessRunRecord {
  const input = objectValue(value);
  const condition = HARNESS_CONDITIONS.includes(input.condition as HarnessCondition)
    ? input.condition as HarnessCondition
    : undefined;
  if (!condition) throw new Error("Harness run condition must be baseline, treatment, or ablation.");
  const outcome = HARNESS_RUN_OUTCOMES.includes(input.outcome as HarnessRunRecord["outcome"])
    ? input.outcome as HarnessRunRecord["outcome"]
    : undefined;
  if (!outcome) throw new Error("Harness run outcome is invalid.");
  const startedAt = finiteNumber(input.startedAt) ?? Date.now();
  const completedAt = finiteNumber(input.completedAt) ?? startedAt;
  if (completedAt < startedAt) throw new Error("Harness run completedAt must not precede startedAt.");
  return {
    id: cleanId(input.id) || `run_${completedAt.toString(36)}_${randomUUID().slice(0, 8)}`,
    condition,
    sessionId: requiredString(input.sessionId, "Harness session id"),
    targetRevision: requiredString(input.targetRevision, "Harness run target revision"),
    environmentFingerprint: requiredString(input.environmentFingerprint, "Harness environment fingerprint"),
    worker: normalizeWorker(input.worker ?? experiment.contract.worker),
    authorityMode: normalizeAuthorityMode(input.authorityMode),
    freshSession: input.freshSession === true,
    isolatedTarget: input.isolatedTarget === true,
    interventionAvailable: input.interventionAvailable === true,
    interventionExercised: input.interventionExercised === true,
    context: normalizeContextEvidence(input.context),
    proof: normalizeProof(input.proof),
    outcome,
    evaluationId: requiredId(input.evaluationId, "Harness evaluation id"),
    notes: cleanStringList(input.notes, MAX_EVIDENCE_ITEMS),
    metrics: normalizeMetrics(input.metrics, completedAt - startedAt),
    startedAt,
    completedAt,
  };
}

function normalizeWorker(value: unknown): HarnessWorker {
  const input = objectValue(value);
  return {
    runtime: requiredString(input.runtime, "Harness worker runtime"),
    model: requiredString(input.model, "Harness worker model"),
    agentId: cleanString(input.agentId),
    host: cleanString(input.host),
    configurationHash: cleanString(input.configurationHash, 256),
  };
}

function normalizeAuthority(value: unknown): HarnessAuthorityEnvelope {
  const input = objectValue(value);
  return {
    mode: normalizeAuthorityMode(input.mode),
    approvalBoundary: requiredString(input.approvalBoundary, "Harness approval boundary"),
    recoveryPath: requiredString(input.recoveryPath, "Harness recovery path"),
    permissions: cleanStringList(input.permissions, MAX_EVIDENCE_ITEMS),
  };
}

function normalizeAuthorityMode(value: unknown): HarnessAuthorityEnvelope["mode"] {
  if (value === "read-only" || value === "workspace-write" || value === "consequential") return value;
  throw new Error("Harness authority mode must be read-only, workspace-write, or consequential.");
}

function normalizeBudget(value: unknown): HarnessBudget {
  const input = objectValue(value);
  return {
    maxRunsPerCondition: positiveInteger(input.maxRunsPerCondition) ?? MIN_COMPARATIVE_RUNS,
    maxRuntimeMs: positiveNumber(input.maxRuntimeMs),
    maxTokens: positiveInteger(input.maxTokens),
    maxCostUsd: nonNegativeNumber(input.maxCostUsd),
  };
}

function normalizeContextEvidence(value: unknown): HarnessContextEvidence {
  const input = objectValue(value);
  return {
    available: cleanStringList(input.available, MAX_EVIDENCE_ITEMS),
    retrieved: cleanStringList(input.retrieved, MAX_EVIDENCE_ITEMS),
    invoked: cleanStringList(input.invoked, MAX_EVIDENCE_ITEMS),
    relevant: cleanStringList(input.relevant, MAX_EVIDENCE_ITEMS),
  };
}

function normalizeProof(value: unknown): HarnessProof {
  const input = objectValue(value);
  return {
    outcome: cleanStringList(input.outcome, MAX_EVIDENCE_ITEMS),
    architecture: cleanStringList(input.architecture, MAX_EVIDENCE_ITEMS),
    workerProduced: cleanStringList(input.workerProduced, MAX_EVIDENCE_ITEMS),
    evaluatorOnly: cleanStringList(input.evaluatorOnly, MAX_EVIDENCE_ITEMS),
  };
}

function normalizeMetrics(value: unknown, elapsedFallback: number): HarnessRunMetrics {
  const input = objectValue(value);
  return {
    elapsedMs: nonNegativeNumber(input.elapsedMs) ?? Math.max(0, elapsedFallback),
    retries: nonNegativeInteger(input.retries) ?? 0,
    humanSteeringCount: nonNegativeInteger(input.humanSteeringCount) ?? 0,
    toolCallCount: nonNegativeInteger(input.toolCallCount) ?? 0,
    promptTokens: nonNegativeInteger(input.promptTokens),
    completionTokens: nonNegativeInteger(input.completionTokens),
    costUsd: nonNegativeNumber(input.costUsd),
  };
}

async function appendHarnessSnapshot(record: HarnessExperimentRecord) {
  await mkdir(dirname(HARNESS_EXPERIMENT_FILE), { recursive: true, mode: 0o700 });
  await appendFile(HARNESS_EXPERIMENT_FILE, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  return record;
}

async function readHarnessExperimentHeads() {
  const raw = await readFile(HARNESS_EXPERIMENT_FILE, "utf8").catch(() => "");
  const heads = new Map<string, HarnessExperimentRecord>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = normalizeStoredExperiment(JSON.parse(line));
      if (!record) continue;
      const current = heads.get(record.id);
      if (!current || record.updatedAt >= current.updatedAt) heads.set(record.id, record);
    } catch {
      // Append-only operational logs tolerate a damaged line without hiding valid records.
    }
  }
  return [...heads.values()];
}

function normalizeStoredExperiment(value: unknown): HarnessExperimentRecord | null {
  const input = objectValue(value);
  const id = cleanId(input.id);
  if (!id || input.schemaVersion !== 1) return null;
  try {
    const contract = normalizeJobContract(input.contract);
    const intervention = normalizeIntervention(input.intervention);
    const shell: HarnessExperimentRecord = {
      schemaVersion: 1,
      id,
      contract,
      intervention,
      runs: [],
      comparison: emptyComparison(),
      decision: "pending",
      decisionEvidence: [],
      createdAt: finiteNumber(input.createdAt) ?? 0,
      updatedAt: finiteNumber(input.updatedAt) ?? 0,
    };
    const runs = Array.isArray(input.runs)
      ? input.runs.map((run) => normalizeHarnessRun(run, shell)).slice(-MAX_RUNS)
      : [];
    return {
      ...shell,
      runs,
      comparison: compareHarnessRuns(contract, runs),
      decision: HARNESS_DECISIONS.includes(input.decision as HarnessDecision) ? input.decision as HarnessDecision : "pending",
      decisionEvidence: cleanStringList(input.decisionEvidence, MAX_EVIDENCE_ITEMS),
      retirementCondition: cleanString(input.retirementCondition),
    };
  } catch {
    return null;
  }
}

function proofSatisfied(run: HarnessRunRecord) {
  return run.proof.outcome.length > 0 && run.proof.workerProduced.length > 0;
}

function workerIdentity(worker: HarnessWorker) {
  return [worker.runtime, worker.model, worker.agentId, worker.host, worker.configurationHash].map((value) => value ?? "").join("|");
}

function emptyComparison(): HarnessExperimentComparison {
  return {
    baselineRuns: 0,
    treatmentRuns: 0,
    ablationRuns: 0,
    baselineAcceptedRate: null,
    treatmentAcceptedRate: null,
    acceptanceDelta: null,
    baselineProofRate: null,
    treatmentProofRate: null,
    proofDelta: null,
    baselineAverageElapsedMs: null,
    treatmentAverageElapsedMs: null,
    elapsedDeltaMs: null,
    baselineAveragePromptTokens: null,
    treatmentAveragePromptTokens: null,
    promptTokenDelta: null,
    parityFailures: [],
    claimReady: false,
    claimLimits: [`Comparative claims require at least ${MIN_COMPARATIVE_RUNS} baseline and ${MIN_COMPARATIVE_RUNS} treatment runs.`],
  };
}

function rate<T>(values: T[], predicate: (value: T) => boolean) {
  return values.length ? values.filter(predicate).length / values.length : null;
}

function average<T>(values: T[], getter: (value: T) => number) {
  return values.length ? values.reduce((sum, value) => sum + getter(value), 0) / values.length : null;
}

function averagePresent<T>(values: T[], getter: (value: T) => number | undefined) {
  const present = values.map(getter).filter((value): value is number => typeof value === "number");
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function subtract(left: number | null, right: number | null) {
  return left === null || right === null ? null : left - right;
}

function normalizeDecision(value: unknown): HarnessDecision {
  if (HARNESS_DECISIONS.includes(value as HarnessDecision)) return value as HarnessDecision;
  throw new Error("Harness decision must be pending, retain, revise, or remove.");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown, label: string) {
  const clean = cleanString(value);
  if (!clean) throw new Error(`${label} is required.`);
  return clean;
}

function cleanString(value: unknown, maxLength = MAX_STRING) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/[\0\r]+/g, " ").slice(0, maxLength);
  if (!cleaned) return undefined;
  return redactSecretText(cleaned).text || undefined;
}

function cleanId(value: unknown) {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(clean) ? clean : undefined;
}

function requiredId(value: unknown, label: string) {
  const clean = cleanId(value);
  if (!clean) throw new Error(`${label} is required and must contain only id-safe characters.`);
  return clean;
}

function cleanStringList(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => cleanString(entry)).filter((entry): entry is string => Boolean(entry)))].slice(0, limit);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeNumber(value: unknown) {
  const number = finiteNumber(value);
  return number === undefined ? undefined : Math.max(0, number);
}

function positiveNumber(value: unknown) {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function nonNegativeInteger(value: unknown) {
  const number = finiteNumber(value);
  return number === undefined ? undefined : Math.max(0, Math.trunc(number));
}

function positiveInteger(value: unknown) {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? Math.trunc(number) : undefined;
}

function normalizeLimit(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(numeric)));
}

function enqueueHarnessWrite<T>(operation: () => Promise<T>) {
  const next = harnessWriteQueue.catch(() => undefined).then(operation);
  harnessWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}
