import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";

import type { BrainReviewProposalInput } from "@/lib/types/brain-review";
import {
  applyUpDownSnapshot,
  evaluateUpDownConsistentProfit,
  fetchUpDownMarketsForStep,
  fetchUpDownSnapshots,
  resolvedPredictionOutcomeId,
  settleUpDownMarket,
  upDownMarketFromPrediction,
  withUpDownPublicReadTimeout,
  UPDOWN_PAPER_DEFAULT_ROOT,
  type UpDownConsistentProfitReport,
  type UpDownKnownMarket,
  type UpDownPaperFill,
  type UpDownPaperRun,
  type UpDownPaperState,
  type UpDownPolicy,
  type UpDownPublicFetcher,
} from "@/lib/services/trading/prediction-updown-paper-loop";
import {
  buildUpDownLossAttribution,
  createUpDownV2Generation,
  DEFAULT_UPDOWN_V2_POLICY,
  evaluateUpDownNegativeEvidence,
  evaluateUpDownV2Review,
  type UpDownAppliedLearning,
  type UpDownLossAttribution,
  type UpDownNegativeEvidenceReport,
  type UpDownV2Generation,
  type UpDownV2Review,
} from "@/lib/services/trading/prediction-updown-learning";

export const UPDOWN_V2_SCHEMA_VERSION = 2;
export const UPDOWN_V2_DEFAULT_ROOT = join(
  homedir(),
  ".hivemindos",
  "experiments",
  "polymarket-updown-self-learning-paper-v2",
);

const DEFAULT_PUBLIC_FETCH_TIMEOUT_MS = 15_000;
const STALE_LOCK_MS = 15 * 60 * 1_000;
const MAX_STATE_REVIEW_SUMMARIES = 32;

export type UpDownV2Status =
  | "running"
  | "winding-down-profit"
  | "consistent-paper-profit"
  | "winding-down-negative-evidence"
  | "retired-negative-evidence";

export type UpDownHistoricalDerivation = {
  sourceExperimentRoot: string;
  importedAt: string;
  sourceStateDigest: string | null;
  sourceGenerationId: string | null;
  settledMarkets: number;
  tradedMarkets: number;
  totalPnlUsd: number;
  attribution: UpDownLossAttribution | null;
  excludedFromV2Scoring: true;
  warning: string;
};

export type UpDownKnowledgeReceipt = {
  runId: string;
  recordedAt: string;
  status: "enqueued" | "deduplicated" | "failed" | "not-proposed";
  proposalId: string | null;
  error: string | null;
};

export type UpDownV2State = {
  schemaVersion: 2;
  experimentId: "polymarket-updown-self-learning-paper-v2";
  createdAt: string;
  updatedAt: string;
  status: UpDownV2Status;
  nextRunSequence: number;
  lastRunId: string | null;
  runCount: number;
  dataErrorCount: number;
  activeGenerationId: string;
  generations: UpDownV2Generation[];
  knownMarkets: Record<string, UpDownKnownMarket>;
  consistentProfit: UpDownConsistentProfitReport | null;
  negativeEvidence: UpDownNegativeEvidenceReport | null;
  historicalDerivation: UpDownHistoricalDerivation;
  consumedAppliedLearningProposalIds: string[];
  latestAppliedMemoryId: string | null;
  reviewHistory: Array<{
    runId: string;
    generationId: string;
    evaluatedAt: string;
    decision: UpDownV2Review["decision"];
    reason: string;
  }>;
};

export type UpDownV2Run = {
  schemaVersion: 2;
  runId: string;
  priorRunId: string | null;
  generationId: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "completed-with-errors" | "consistent-paper-profit" | "retired-negative-evidence";
  publicReadsOnly: true;
  historicalEvidenceUsedForScoring: false;
  discoveredSlugs: string[];
  snapshotCount: number;
  snapshots: UpDownPaperRun["snapshots"];
  settledMarketCount: number;
  settlements: UpDownPaperRun["settlements"];
  fills: Array<UpDownPaperFill & { armId: string }>;
  errors: string[];
  review: UpDownV2Review;
  negativeEvidence: UpDownNegativeEvidenceReport;
  consistentProfit: UpDownConsistentProfitReport;
  knowledgeProposal: BrainReviewProposalInput | null;
  policyContractUpgrade: {
    fromVersion: number;
    toVersion: 2;
    closedGenerationId: string;
    replacementGenerationId: string;
    reason: string;
  } | null;
};

type HistoricalRunEvidence = {
  fills: UpDownPaperFill[];
  resolutionDates: Record<string, string>;
};

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function activeGeneration(state: UpDownV2State): UpDownV2Generation {
  const generation = state.generations.find((item) => item.id === state.activeGenerationId);
  if (!generation) throw new Error(`Active v2 generation ${state.activeGenerationId} is missing.`);
  return generation;
}

function championPolicy(generation: UpDownV2Generation): UpDownPolicy {
  const policy = generation.arms.find((arm) => arm.role === "champion")?.policy;
  if (!policy) throw new Error(`Generation ${generation.id} has no champion policy.`);
  return policy;
}

function createRunId(state: UpDownV2State, now: Date): string {
  return `${now.toISOString().replace(/[:.]/g, "-")}-v2-r${String(state.nextRunSequence).padStart(6, "0")}`;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function ensureExperimentDirectories(root: string): Promise<void> {
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(join(root, "runs"), { recursive: true }),
    mkdir(join(root, "generations"), { recursive: true }),
    mkdir(join(root, "locks"), { recursive: true }),
    mkdir(join(root, "knowledge-receipts"), { recursive: true }),
  ]);
}

async function acquireStepLock(root: string, now: Date): Promise<() => Promise<void>> {
  const lockPath = join(root, "step.lock");
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: now.toISOString() })}\n`);
    return async () => {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const lockStat = await stat(lockPath);
    if (now.getTime() - lockStat.mtimeMs <= STALE_LOCK_MS) {
      throw new Error("Another Up/Down v2 paper step holds the experiment lock.");
    }
    await rename(lockPath, join(root, "locks", `stale-${now.toISOString().replace(/[:.]/g, "-")}.lock`));
    return acquireStepLock(root, now);
  }
}

async function readHistoricalRuns(root: string, generationId: string | null): Promise<HistoricalRunEvidence> {
  const fills: UpDownPaperFill[] = [];
  const resolutionDates: Record<string, string> = {};
  try {
    const files = (await readdir(join(root, "runs"))).filter((file) => file.endsWith(".json")).sort();
    for (const file of files) {
      const run = await readJson<UpDownPaperRun>(join(root, "runs", file));
      if (generationId && run.generationId !== generationId) continue;
      for (const fill of run.fills) {
        if (fill.armId === "champion") fills.push(fill);
      }
      for (const snapshot of run.snapshots) resolutionDates[snapshot.slug] = snapshot.resolutionDate;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { fills, resolutionDates };
}

async function loadHistoricalDerivation(
  historicalRoot: string,
  now: Date,
): Promise<UpDownHistoricalDerivation> {
  const empty: UpDownHistoricalDerivation = {
    sourceExperimentRoot: historicalRoot,
    importedAt: now.toISOString(),
    sourceStateDigest: null,
    sourceGenerationId: null,
    settledMarkets: 0,
    tradedMarkets: 0,
    totalPnlUsd: 0,
    attribution: null,
    excludedFromV2Scoring: true,
    warning: "No readable v1 state was available. The conservative v2 preregistration was frozen without historical scoring data.",
  };
  try {
    const rawState = await readFile(join(historicalRoot, "state.json"), "utf8");
    const state = JSON.parse(rawState) as UpDownPaperState;
    const generation = state.generations.find((item) => item.id === state.activeGenerationId);
    const champion = generation?.arms.find((arm) => arm.role === "champion");
    if (!generation || !champion) return empty;
    const runFiles = (await readdir(join(historicalRoot, "runs")))
      .filter((file) => file.endsWith(".json"))
      .sort();
    const stateDigest = createHash("sha256")
      .update(rawState)
      .update("\n")
      .update(runFiles.join("\n"))
      .digest("hex");
    const evidence = await readHistoricalRuns(historicalRoot, generation.id);
    const attribution = buildUpDownLossAttribution({
      arm: champion,
      fills: evidence.fills,
      resolutionDates: evidence.resolutionDates,
    });
    return {
      sourceExperimentRoot: historicalRoot,
      importedAt: now.toISOString(),
      sourceStateDigest: stateDigest,
      sourceGenerationId: generation.id,
      settledMarkets: attribution.settledMarkets,
      tradedMarkets: attribution.tradedMarkets,
      totalPnlUsd: attribution.totalPnlUsd,
      attribution,
      excludedFromV2Scoring: true,
      warning: "V1 outcomes generated hypotheses only. They are post-hoc context and are excluded from every v2 promotion, retirement, and profit gate.",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    return { ...empty, warning: `Historical derivation failed closed: ${safeError(error)}` };
  }
}

function freshAppliedLearning(
  state: Pick<UpDownV2State, "consumedAppliedLearningProposalIds">,
  available: UpDownAppliedLearning[],
): UpDownAppliedLearning[] {
  const consumed = new Set(state.consumedAppliedLearningProposalIds);
  return available.filter((item) => !consumed.has(item.proposalId));
}

export function migrateUnscoredUpDownV2PolicyContract(input: {
  state: UpDownV2State;
  now: Date;
  appliedLearning?: UpDownAppliedLearning[];
}): {
  closedGeneration: UpDownV2Generation;
  replacementGeneration: UpDownV2Generation;
  reason: string;
} | null {
  const generation = activeGeneration(input.state);
  const contractVersion = (generation.registration as { policyContractVersion?: number }).policyContractVersion ?? 1;
  if (contractVersion >= 2) return null;
  const hasScoredEvidence = generation.arms.some((arm) => (
    arm.results.length > 0 || Object.keys(arm.positions).length > 0
  ));
  if (hasScoredEvidence) return null;
  const availableLearning = freshAppliedLearning(input.state, input.appliedLearning ?? []);
  generation.status = "closed";
  generation.closedAt = input.now.toISOString();
  const nextPolicy = {
    ...DEFAULT_UPDOWN_V2_POLICY,
    version: championPolicy(generation).version + 1,
  };
  const replacement = createUpDownV2Generation({
    id: `generation-${input.state.generations.length + 1}`,
    now: input.now,
    championPolicy: nextPolicy,
    parentGenerationId: generation.id,
    derivationGenerationId: generation.id,
    derivationStateDigest: createHash("sha256").update(JSON.stringify(generation)).digest("hex"),
    attribution: input.state.historicalDerivation.attribution,
    appliedLearning: availableLearning,
  });
  input.state.generations.push(replacement);
  input.state.activeGenerationId = replacement.id;
  input.state.consumedAppliedLearningProposalIds.push(...availableLearning.map((item) => item.proposalId));
  return {
    closedGeneration: generation,
    replacementGeneration: replacement,
    reason: "Replaced the unscored temporal prototype with policy contract v2 before any v2 fill or settlement; immediate-pair entries require both executable legs in one observation.",
  };
}

async function createState(input: {
  now: Date;
  historicalRoot: string;
  appliedLearning: UpDownAppliedLearning[];
  latestAppliedMemoryId: string | null;
}): Promise<UpDownV2State> {
  const historicalDerivation = await loadHistoricalDerivation(input.historicalRoot, input.now);
  const generation = createUpDownV2Generation({
    id: "generation-1",
    now: input.now,
    championPolicy: { ...DEFAULT_UPDOWN_V2_POLICY },
    derivationGenerationId: historicalDerivation.sourceGenerationId,
    derivationStateDigest: historicalDerivation.sourceStateDigest,
    attribution: historicalDerivation.attribution,
    appliedLearning: input.appliedLearning,
  });
  return {
    schemaVersion: UPDOWN_V2_SCHEMA_VERSION,
    experimentId: "polymarket-updown-self-learning-paper-v2",
    createdAt: input.now.toISOString(),
    updatedAt: input.now.toISOString(),
    status: "running",
    nextRunSequence: 1,
    lastRunId: null,
    runCount: 0,
    dataErrorCount: 0,
    activeGenerationId: generation.id,
    generations: [generation],
    knownMarkets: {},
    consistentProfit: null,
    negativeEvidence: null,
    historicalDerivation,
    consumedAppliedLearningProposalIds: input.appliedLearning.map((item) => item.proposalId),
    latestAppliedMemoryId: input.latestAppliedMemoryId,
    reviewHistory: [],
  };
}

async function loadOrCreateState(input: {
  root: string;
  now: Date;
  historicalRoot: string;
  appliedLearning: UpDownAppliedLearning[];
  latestAppliedMemoryId: string | null;
}): Promise<UpDownV2State> {
  const statePath = join(input.root, "state.json");
  try {
    const state = await readJson<UpDownV2State>(statePath);
    if (state.schemaVersion !== UPDOWN_V2_SCHEMA_VERSION) {
      throw new Error(`Unsupported Up/Down v2 paper schema ${state.schemaVersion}.`);
    }
    state.latestAppliedMemoryId = input.latestAppliedMemoryId ?? state.latestAppliedMemoryId;
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const state = await createState(input);
    await writeFile(
      join(input.root, "experiment.json"),
      `${JSON.stringify({
        schemaVersion: UPDOWN_V2_SCHEMA_VERSION,
        experimentId: state.experimentId,
        createdAt: state.createdAt,
        authority: "paper-only-public-reads",
        liveTradingPath: false,
        historicalEvidenceUsedForScoring: false,
        historicalDerivation: state.historicalDerivation,
        learningContract: {
          frozenBeforeObservation: true,
          oneParameterPerCandidate: true,
          multipleTestingControl: "Benjamini-Hochberg FDR q<=0.05",
          sharedBrain: "Only explicitly applied Brain Review memories may affect a later generation.",
          negativeEvidenceRetirement: true,
        },
      }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    await atomicWriteJson(statePath, state);
    return state;
  }
}

async function generationEvidence(
  root: string,
  state: UpDownV2State,
  generation: UpDownV2Generation,
): Promise<HistoricalRunEvidence> {
  const resolutionDates = Object.fromEntries(
    Object.values(state.knownMarkets).map((market) => [market.slug, market.resolutionDate]),
  );
  const fills: UpDownPaperFill[] = [];
  try {
    const files = (await readdir(join(root, "runs"))).filter((file) => file.endsWith(".json")).sort();
    for (const file of files) {
      const run = await readJson<UpDownV2Run>(join(root, "runs", file));
      if (run.generationId !== generation.id) continue;
      fills.push(...run.fills.filter((fill) => fill.armId === "champion"));
      for (const snapshot of run.snapshots) resolutionDates[snapshot.slug] = snapshot.resolutionDate;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { fills, resolutionDates };
}

function allOpenPositions(state: UpDownV2State): number {
  return state.generations.reduce((total, generation) => (
    total + generation.arms.reduce((armTotal, arm) => armTotal + Object.keys(arm.positions).length, 0)
  ), 0);
}

function evidenceState(state: UpDownV2State) {
  return {
    activeGenerationId: state.activeGenerationId,
    generations: state.generations,
    runCount: state.runCount,
    dataErrorCount: state.dataErrorCount,
  };
}

function renderStatus(
  state: UpDownV2State,
  report: UpDownConsistentProfitReport,
  negative: UpDownNegativeEvidenceReport,
): string {
  const generation = activeGeneration(state);
  const failedProfitGates = Object.entries(report.gates).filter(([, passed]) => !passed).map(([name]) => name);
  const firedRetirementGates = Object.entries(negative.gates).filter(([, fired]) => fired).map(([name]) => name);
  return [
    "# Polymarket Up/Down prospective self-learning paper v2",
    "",
    `Updated: ${state.updatedAt}`,
    `Status: ${state.status}`,
    `Runs: ${state.runCount}`,
    `Active generation: ${generation.id}`,
    `Generation registration: ${generation.registration.registeredAt}`,
    `Historical v1 evidence used for scoring: no`,
    `Lifetime champion settled/traded: ${negative.settledMarkets}/${negative.tradedMarkets}`,
    `Lifetime champion paper PnL: $${negative.totalPnlUsd.toFixed(2)}`,
    `Lifetime mean PnL CI95: [$${negative.meanPnlCi95Usd[0].toFixed(4)}, $${negative.meanPnlCi95Usd[1].toFixed(4)}]`,
    `Lifetime max drawdown: ${negative.maxDrawdownPct.toFixed(2)}%`,
    `Open paper positions across cohorts: ${allOpenPositions(state)}`,
    `Negative-evidence gates fired: ${firedRetirementGates.length ? firedRetirementGates.join(", ") : "none"}`,
    `Consistent-profit gate: ${report.passed ? "passed" : "not passed"}`,
    `Waiting profit gates: ${failedProfitGates.length ? failedProfitGates.join(", ") : "none"}`,
    `Shared Brain: ${state.latestAppliedMemoryId ? "reviewed learning available" : "no applied v2 learning yet"}`,
    "",
    negative.reason,
    report.claim,
    "Paper performance does not establish live profitability.",
    "",
  ].join("\n");
}

function finalizeReview(input: {
  state: UpDownV2State;
  generation: UpDownV2Generation;
  review: UpDownV2Review;
  now: Date;
  appliedLearning: UpDownAppliedLearning[];
}): UpDownV2Generation | null {
  if (!input.review.evaluated) return null;
  if (input.generation.status !== "active") return null;
  input.generation.lastEvolutionAt = input.now.toISOString();
  input.generation.lastEvolutionEvaluationSamples = input.review.resultCount;
  if (input.review.decision === "retire-negative-evidence") {
    input.generation.status = "retired";
    input.generation.closedAt = input.now.toISOString();
    return input.generation;
  }
  if (input.review.decision !== "promote" && input.review.decision !== "refresh-challengers") return null;
  const oldPolicy = championPolicy(input.generation);
  const promoted = input.review.promotedArmId
    ? input.generation.arms.find((arm) => arm.id === input.review.promotedArmId)?.policy
    : null;
  const nextPolicy = promoted
    ? { ...promoted, version: oldPolicy.version + 1 }
    : { ...oldPolicy };
  input.generation.status = promoted ? "promoted" : "closed";
  input.generation.closedAt = input.now.toISOString();
  const availableLearning = freshAppliedLearning(input.state, input.appliedLearning);
  const nextId = `generation-${input.state.generations.length + 1}`;
  const next = createUpDownV2Generation({
    id: nextId,
    now: input.now,
    championPolicy: nextPolicy,
    parentGenerationId: input.generation.id,
    derivationGenerationId: input.generation.id,
    derivationStateDigest: createHash("sha256").update(JSON.stringify(input.generation)).digest("hex"),
    attribution: input.review.attribution,
    appliedLearning: availableLearning,
  });
  input.state.generations.push(next);
  input.state.activeGenerationId = next.id;
  input.state.consumedAppliedLearningProposalIds.push(...availableLearning.map((item) => item.proposalId));
  return input.generation;
}

export async function runUpDownV2PaperStep(options: {
  root?: string;
  historicalRoot?: string;
  now?: Date;
  fetcher?: UpDownPublicFetcher;
  fetchTimeoutMs?: number;
  appliedLearning?: UpDownAppliedLearning[];
  latestAppliedMemoryId?: string | null;
} = {}): Promise<{ state: UpDownV2State; run: UpDownV2Run; root: string }> {
  const root = options.root ?? UPDOWN_V2_DEFAULT_ROOT;
  const historicalRoot = options.historicalRoot ?? UPDOWN_PAPER_DEFAULT_ROOT;
  const now = options.now ?? new Date();
  const fetcher = withUpDownPublicReadTimeout(
    options.fetcher ?? fetch,
    options.fetchTimeoutMs ?? DEFAULT_PUBLIC_FETCH_TIMEOUT_MS,
  );
  const appliedLearning = options.appliedLearning ?? [];
  await ensureExperimentDirectories(root);
  const releaseLock = await acquireStepLock(root, now);
  try {
    const state = await loadOrCreateState({
      root,
      now,
      historicalRoot,
      appliedLearning,
      latestAppliedMemoryId: options.latestAppliedMemoryId ?? null,
    });
    const runId = createRunId(state, now);
    const policyContractUpgrade = migrateUnscoredUpDownV2PolicyContract({
      state,
      now,
      appliedLearning,
    });
    const runGeneration = activeGeneration(state);
    const startedAt = now.toISOString();
    const marketRead = await fetchUpDownMarketsForStep(state, now, fetcher);
    const errors = [...marketRead.errors];
    const settlements: UpDownV2Run["settlements"] = [];
    for (const market of marketRead.markets) {
      const winnerOutcomeId = resolvedPredictionOutcomeId(market);
      const known = upDownMarketFromPrediction(market, winnerOutcomeId);
      const prior = state.knownMarkets[market.slug];
      state.knownMarkets[market.slug] = {
        ...known,
        settledAt: winnerOutcomeId ? prior?.settledAt ?? now.toISOString() : null,
      };
      if (!winnerOutcomeId) continue;
      const settledAt = state.knownMarkets[market.slug].settledAt ?? now.toISOString();
      const settledGenerations: UpDownV2Run["settlements"][number]["generations"] = [];
      for (const generation of state.generations) {
        if (!settleUpDownMarket(generation, state.knownMarkets[market.slug], settledAt)) continue;
        settledGenerations.push({
          generationId: generation.id,
          armResults: generation.arms.flatMap((arm) => {
            const result = arm.results.find((item) => item.slug === market.slug);
            return result ? [{ ...result }] : [];
          }),
        });
      }
      if (settledGenerations.length) settlements.push({
        slug: market.slug,
        winnerOutcomeId,
        settledAt,
        generations: settledGenerations,
      });
    }

    const preliminaryProfit = evaluateUpDownConsistentProfit(evidenceState(state), now);
    const profitEvidenceBeforeOpenPositions = Object.entries(preliminaryProfit.gates)
      .filter(([name]) => name !== "noOpenChampionPositions")
      .every(([, passed]) => passed);
    const negativeEvidence = evaluateUpDownNegativeEvidence({ generations: state.generations, now });
    if (state.status === "running" && negativeEvidence.triggered) {
      state.status = "winding-down-negative-evidence";
      state.negativeEvidence = negativeEvidence;
    } else if (state.status === "running" && profitEvidenceBeforeOpenPositions) {
      state.status = "winding-down-profit";
    }

    const snapshotRead = state.status === "running"
      ? await fetchUpDownSnapshots(marketRead.markets, startedAt, fetcher)
      : { snapshots: [], errors: [] };
    errors.push(...snapshotRead.errors);
    const fills = state.status === "running"
      ? snapshotRead.snapshots.flatMap((snapshot) => {
        state.knownMarkets[snapshot.slug] ??= {
          marketId: snapshot.marketId,
          conditionId: snapshot.conditionId,
          slug: snapshot.slug,
          title: snapshot.title,
          asset: snapshot.asset,
          intervalMinutes: snapshot.intervalMinutes,
          resolutionDate: snapshot.resolutionDate,
          outcomeIds: [snapshot.sides[0].outcomeId, snapshot.sides[1].outcomeId],
          outcomeLabels: [snapshot.sides[0].label, snapshot.sides[1].label],
          status: "active",
          winnerOutcomeId: null,
          settledAt: null,
        };
        return applyUpDownSnapshot(runGeneration, snapshot, runId);
      })
      : [];

    const currentEvidence = await generationEvidence(root, state, runGeneration);
    currentEvidence.fills.push(...fills.filter((fill) => fill.armId === "champion"));
    const review = state.status === "running" || state.status === "winding-down-negative-evidence"
      ? evaluateUpDownV2Review({
        generation: runGeneration,
        now,
        fills: currentEvidence.fills,
        resolutionDates: currentEvidence.resolutionDates,
        priorAppliedMemoryId: state.latestAppliedMemoryId,
        negativeEvidence,
        appliedLearning: freshAppliedLearning(state, appliedLearning),
      })
      : evaluateUpDownV2Review({
        generation: runGeneration,
        now,
        fills: currentEvidence.fills,
        resolutionDates: currentEvidence.resolutionDates,
      });
    const closedGeneration = finalizeReview({
      state,
      generation: runGeneration,
      review,
      now,
      appliedLearning,
    });

    state.runCount += 1;
    state.dataErrorCount += errors.length > 0 ? 1 : 0;
    const consistentProfit = evaluateUpDownConsistentProfit(evidenceState(state), now);
    const finalNegativeEvidence = evaluateUpDownNegativeEvidence({ generations: state.generations, now });
    if (consistentProfit.passed) {
      state.status = "consistent-paper-profit";
      state.consistentProfit = consistentProfit;
    } else if (state.status === "winding-down-profit" && !profitEvidenceBeforeOpenPositions) {
      state.status = "running";
    }
    if (
      state.status === "winding-down-negative-evidence"
      && allOpenPositions(state) === 0
    ) {
      state.status = "retired-negative-evidence";
    }
    if (finalNegativeEvidence.triggered) state.negativeEvidence = finalNegativeEvidence;
    if (review.evaluated) {
      state.reviewHistory = [
        ...state.reviewHistory,
        {
          runId,
          generationId: review.generationId,
          evaluatedAt: review.evaluatedAt,
          decision: review.decision,
          reason: review.reason,
        },
      ].slice(-MAX_STATE_REVIEW_SUMMARIES);
    }

    const completedAt = new Date().toISOString();
    const run: UpDownV2Run = {
      schemaVersion: UPDOWN_V2_SCHEMA_VERSION,
      runId,
      priorRunId: state.lastRunId,
      generationId: runGeneration.id,
      startedAt,
      completedAt,
      status: state.status === "consistent-paper-profit"
        ? "consistent-paper-profit"
        : state.status === "retired-negative-evidence"
          ? "retired-negative-evidence"
          : errors.length
            ? "completed-with-errors"
            : "completed",
      publicReadsOnly: true,
      historicalEvidenceUsedForScoring: false,
      discoveredSlugs: marketRead.discoveredSlugs,
      snapshotCount: snapshotRead.snapshots.length,
      snapshots: snapshotRead.snapshots,
      settledMarketCount: settlements.length,
      settlements,
      fills,
      errors,
      review,
      negativeEvidence: finalNegativeEvidence,
      consistentProfit,
      knowledgeProposal: review.knowledgeProposal,
      policyContractUpgrade: policyContractUpgrade
        ? {
          fromVersion: 1,
          toVersion: 2,
          closedGenerationId: policyContractUpgrade.closedGeneration.id,
          replacementGenerationId: policyContractUpgrade.replacementGeneration.id,
          reason: policyContractUpgrade.reason,
        }
        : null,
    };
    state.lastRunId = runId;
    state.nextRunSequence += 1;
    state.updatedAt = completedAt;
    await writeFile(
      join(root, "runs", `${runId}.json`),
      `${JSON.stringify(run, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    for (const generation of [policyContractUpgrade?.closedGeneration, closedGeneration].filter(Boolean) as UpDownV2Generation[]) {
      await writeFile(
        join(root, "generations", `${generation.id}.json`),
        `${JSON.stringify(generation, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
    }
    await atomicWriteJson(join(root, "state.json"), state);
    await writeFile(
      join(root, "STATUS.md"),
      renderStatus(state, consistentProfit, finalNegativeEvidence),
      { encoding: "utf8", mode: 0o600 },
    );
    return { state, run, root };
  } finally {
    await releaseLock();
  }
}

export async function recordUpDownV2KnowledgeReceipt(
  root: string,
  receipt: UpDownKnowledgeReceipt,
): Promise<void> {
  const path = join(root, "knowledge-receipts", `${receipt.runId}.json`);
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

export async function readUpDownV2PaperStatus(root = UPDOWN_V2_DEFAULT_ROOT): Promise<{
  state: UpDownV2State;
  report: UpDownConsistentProfitReport;
  negativeEvidence: UpDownNegativeEvidenceReport;
}> {
  const state = await readJson<UpDownV2State>(join(root, "state.json"));
  return {
    state,
    report: evaluateUpDownConsistentProfit(evidenceState(state)),
    negativeEvidence: evaluateUpDownNegativeEvidence({ generations: state.generations }),
  };
}

export function summarizeUpDownV2State(state: UpDownV2State) {
  const generation = activeGeneration(state);
  const champion = generation.arms.find((arm) => arm.role === "champion");
  return {
    status: state.status,
    runs: state.runCount,
    lastRunId: state.lastRunId,
    activeGenerationId: state.activeGenerationId,
    championPolicy: champion?.policy ?? null,
    candidatePolicies: generation.arms
      .filter((arm) => arm.role === "challenger")
      .map((arm) => ({ id: arm.id, changedDimension: arm.changedDimension, policy: arm.policy })),
    historicalEvidenceUsedForScoring: false,
    historicalDerivation: {
      sourceStateDigest: state.historicalDerivation.sourceStateDigest,
      settledMarkets: state.historicalDerivation.settledMarkets,
      tradedMarkets: state.historicalDerivation.tradedMarkets,
      totalPnlUsd: round(state.historicalDerivation.totalPnlUsd, 6),
      excludedFromV2Scoring: true,
    },
  };
}
