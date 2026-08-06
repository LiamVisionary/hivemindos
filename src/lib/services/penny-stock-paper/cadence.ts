import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  fetchPennyStockMonitoringEvidence,
} from "./research";
import {
  pennyCorporateActionKey,
  pennyFilingMarkerKey,
} from "./risk-intelligence";
import {
  defaultPennyPaperRoot,
  readPennyPaperPolicy,
} from "./runner";
import type {
  PennyPaperCandidateOutcome,
  PennyPaperEvolutionResult,
  PennyPaperOutcomeLearning,
  PennyPaperRunManifest,
  PennyPaperWeeklyAudit,
  PennyStockMonitorArtifact,
  PennyStockMonitorCandidate,
  PennyStockMonitoringEvidence,
  PennyStockResearchArtifact,
} from "./types";

type MonitoringEvidenceProvider = (
  input: Parameters<typeof fetchPennyStockMonitoringEvidence>[0],
) => Promise<PennyStockMonitoringEvidence>;

export type PennyStockMonitorRunResult =
  | {
    status: "recorded";
    monitorId: string;
    artifactPath: string;
    reportPath: string;
    artifact: PennyStockMonitorArtifact;
  }
  | {
    status: "skipped";
    monitorId: string;
    reason: string;
    sourceRunId: string;
    observedAt: string;
  };

export async function runPennyStockEvidenceMonitor(options: {
  runRoot?: string;
  monitorId?: string;
  asOf?: Date;
  evidenceProvider?: MonitoringEvidenceProvider;
} = {}): Promise<PennyStockMonitorRunResult> {
  const runRoot = resolve(options.runRoot ?? defaultPennyPaperRoot());
  const asOf = options.asOf ?? new Date();
  const observedAt = asOf.toISOString();
  const monitorId = safeIdentifier(options.monitorId ?? createMonitorId(asOf));
  const research = await readLatestCompletedResearch(runRoot, observedAt);
  const priorMonitors = (await readMonitorArtifacts(runRoot))
    .filter((artifact) =>
      artifact.sourceResearchArtifactHash === research.artifactHash
      && artifact.observedAt < observedAt
    )
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt));
  const previous = priorMonitors[0] ?? null;
  const known = knownEvidence(research, previous);
  const provider = options.evidenceProvider ?? fetchPennyStockMonitoringEvidence;
  const evidence = await provider({
    candidates: research.candidates.map((row) => ({
      symbol: row.symbol,
      priceUsd: row.priceUsd,
    })),
    asOf,
    knownFilingKeys: known.filings,
    knownFilingThroughDate: known.filingThroughDate,
    knownCorporateActionKeys: known.corporateActions,
  });
  const candidates = research.candidates.map((row) =>
    buildMonitorCandidate({
      researchRow: row,
      previous: previous?.candidates.find((candidate) => candidate.symbol === row.symbol),
      evidence,
      knownFilingKeys: new Set(known.filings[row.symbol] ?? []),
      knownFilingThroughDate: known.filingThroughDate[row.symbol] ?? null,
      knownCorporateActionKeys: new Set(known.corporateActions[row.symbol] ?? []),
    })
  );
  const newEvidenceAvailable = candidates.some((candidate) =>
    hasNewCandidateEvidence(candidate)
  );
  if (!newEvidenceAvailable) {
    return {
      status: "skipped",
      monitorId,
      reason:
        "No newer SIP quote endpoint, SEC filing marker, or corporate action was found; unchanged evidence was not written again.",
      sourceRunId: research.runId,
      observedAt,
    };
  }
  const materialAlerts = candidates.flatMap((candidate) =>
    candidate.alerts.map((alert) => `${candidate.symbol}: ${alert}`)
  );
  const withoutHash = {
    schemaVersion: 1 as const,
    monitorId,
    observedAt,
    sourceRunId: research.runId,
    sourceAsOf: research.asOf,
    sourceResearchArtifactHash: research.artifactHash,
    previousMonitorId: previous?.monitorId ?? null,
    marketSession: marketSessionAt(asOf),
    candidates,
    newEvidenceAvailable,
    materialAlerts,
    deepRiskRefreshSymbols: evidence.deepRiskRefreshSymbols,
    policyMutationAllowed: false as const,
    researchOnly: true as const,
    liveTradingEnabled: false as const,
  };
  const artifact: PennyStockMonitorArtifact = {
    ...withoutHash,
    artifactHash: sha256(stableJson(withoutHash)),
  };
  const directory = join(runRoot, "monitors", observedAt.slice(0, 10));
  const artifactPath = join(directory, `${monitorId}.json`);
  const reportPath = join(directory, `${monitorId}.md`);
  await writeOnce(artifactPath, stableJson(artifact), "Monitor artifact");
  await writeOnce(reportPath, renderMonitorReport(artifact), "Monitor report");
  return { status: "recorded", monitorId, artifactPath, reportPath, artifact };
}

export async function runPennyPaperWeeklyAudit(options: {
  runRoot?: string;
  auditId?: string;
  asOf?: Date;
} = {}): Promise<{
  auditId: string;
  artifactPath: string;
  reportPath: string;
  artifact: PennyPaperWeeklyAudit;
}> {
  const runRoot = resolve(options.runRoot ?? defaultPennyPaperRoot());
  const asOf = options.asOf ?? new Date();
  const auditedAt = asOf.toISOString();
  const auditId = safeIdentifier(options.auditId ?? createWeeklyAuditId(asOf));
  const runs = await readRunEvidence(runRoot, auditedAt);
  const failedRuns = await countFailedRuns(runRoot, auditedAt);
  const completed = runs.filter((run) => run.manifest?.status === "completed");
  const evolutions = completed.flatMap((run) => run.evolution ? [run.evolution] : []);
  const snapshots = new Set(completed.map((run) => run.research.universe.snapshotHash));
  const outcomeRows = deduplicateOutcomes(completed);
  const latestOutcomeLearning = completed
    .flatMap((run) => run.outcomes ? [run.outcomes] : [])
    .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt))[0] ?? null;
  const prospectiveEntryLearning = latestOutcomeLearning?.entryDistanceLearning;
  const monitors = (await readMonitorArtifacts(runRoot))
    .filter((artifact) => artifact.observedAt <= auditedAt);
  const policy = await readPennyPaperPolicy({ runRoot });
  const gatePassRates = aggregateGatePassRates(evolutions);
  const horizon20 = outcomeRows.filter((outcome) => outcome.horizons["20"].matured);
  const selectedHorizon20 = horizon20.filter((outcome) => outcome.selected);
  const unselectedHorizon20 = horizon20.filter((outcome) => !outcome.selected);
  const latestDecisionReviews = outcomeRows.flatMap((outcome) => {
    const review = latestOutcomeDecisionReview(outcome);
    return review ? [review] : [];
  });
  const observedSpreads = monitors.flatMap((monitor) =>
    monitor.candidates.flatMap((candidate) =>
      candidate.currentExecutionEvidence.p90SpreadBps == null
        ? []
        : [candidate.currentExecutionEvidence.p90SpreadBps]
    )
  );
  const firstResearchAsOf = completed
    .map((run) => run.research.asOf)
    .sort()[0] ?? null;
  const lastResearchAsOf = completed
    .map((run) => run.research.asOf)
    .sort()
    .at(-1) ?? null;
  const readinessGates = {
    multipleDistinctSnapshots: snapshots.size >= 5,
    minimumCompletedRuns: completed.length >= 5,
    intradayCoverage: monitors.length >= 18,
    selectorSampleSize: horizon20.length >= 100,
    frozenSelectorHoldout:
      selectedHorizon20.length >= 25 && unselectedHorizon20.length >= 25,
    outcomeCompleteness:
      latestOutcomeLearning?.labelCoverage?.promotionCoverageGate === true,
    prospectiveEntrySample:
      (prospectiveEntryLearning?.maturedPanelObservations20 ?? 0)
        >= (prospectiveEntryLearning?.minimumProspectiveObservations ?? 100),
  };
  const conclusions = Object.values(readinessGates).every(Boolean)
    ? "The accumulated evidence clears the weekly coverage floors, but this audit cannot promote or mutate either paper policy."
    : "Evidence is still accumulating; sparse or incomplete cohorts block any inference that higher-frequency monitoring improves paper PnL.";
  const withoutHash = {
    schemaVersion: 1 as const,
    auditId,
    auditedAt,
    window: {
      firstResearchAsOf,
      lastResearchAsOf,
      completedRuns: completed.length,
      failedRuns,
      awaitingReviewRuns: runs.filter((run) =>
        !run.manifest && !run.failure && run.research
      ).length,
      distinctUniverseSnapshots: snapshots.size,
      monitorArtifacts: monitors.length,
    },
    decisions: {
      accepted: evolutions.filter((row) => row.decision === "accepted").length,
      rejected: evolutions.filter((row) => row.decision === "rejected").length,
      cash: evolutions.filter((row) => row.decision === "cash").length,
      selectedCandidateSlots: completed.reduce(
        (sum, run) => sum + (run.manifest?.selectedSymbols.length ?? 0),
        0,
      ),
    },
    evaluationMetrics: {
      meanBaselinePnlUsd: nullableMean(evolutions.map((row) => row.baselineAggregatePnlUsd)),
      meanTreatmentPnlUsd: nullableMean(evolutions.map((row) => row.treatmentAggregatePnlUsd)),
      worstTreatmentDrawdownPct: nullableMaximum(
        evolutions.map((row) => row.treatmentMaxDrawdownPct),
      ),
      gatePassRates,
      positiveCostStressRuns: {
        "1": positiveCostStressRuns(evolutions, 1),
        "2": positiveCostStressRuns(evolutions, 2),
        "3": positiveCostStressRuns(evolutions, 3),
      },
    },
    maturedOutcomes: {
      horizon1: outcomeRows.filter((row) => row.horizons["1"].matured).length,
      horizon5: outcomeRows.filter((row) => row.horizons["5"].matured).length,
      horizon10: outcomeRows.filter((row) => row.horizons["10"].matured).length,
      horizon20: horizon20.length,
      selectedHorizon20: selectedHorizon20.length,
      unselectedHorizon20: unselectedHorizon20.length,
      selectedMeanCloseReturnPct: nullableMean(selectedHorizon20.flatMap((row) =>
        row.horizons["20"].closeReturnPct == null
          ? []
          : [row.horizons["20"].closeReturnPct]
      )),
      unselectedMeanCloseReturnPct: nullableMean(unselectedHorizon20.flatMap((row) =>
        row.horizons["20"].closeReturnPct == null
          ? []
          : [row.horizons["20"].closeReturnPct]
      )),
      latestDecisionReviews: latestDecisionReviews.length,
      supportedDecisions: latestDecisionReviews.filter((row) =>
        row.status === "supported"
      ).length,
      challengedDecisions: latestDecisionReviews.filter((row) =>
        row.status === "challenged"
      ).length,
      mixedDecisions: latestDecisionReviews.filter((row) =>
        row.status === "mixed"
      ).length,
      inconclusiveDecisions: latestDecisionReviews.filter((row) =>
        row.status === "inconclusive"
      ).length,
      logicErrorCandidates: latestDecisionReviews.filter((row) =>
        row.logicErrorCandidate
      ).length,
      materialMoverReviews: latestDecisionReviews.filter((row) =>
        row.marketContext.materialMove
      ).length,
      sourceCoveragePct: latestOutcomeLearning?.labelCoverage?.sourceCoveragePct ?? null,
      maturityCoveragePct20:
        latestOutcomeLearning?.labelCoverage?.maturityCoveragePct20 ?? null,
      outcomeCompletenessGate:
        latestOutcomeLearning?.labelCoverage?.promotionCoverageGate ?? false,
    },
    prospectiveEntryLearning: {
      maturedPanelObservations20:
        prospectiveEntryLearning?.maturedPanelObservations20 ?? 0,
      minimumRequired:
        prospectiveEntryLearning?.minimumProspectiveObservations ?? 100,
      promotionEligibleForFullGateStack:
        prospectiveEntryLearning?.promotionEligible ?? false,
      variants: (prospectiveEntryLearning?.variants ?? []).map((row) => ({
        entryDiscountPct: row.entryDiscountPct,
        fills: row.fills,
        observations: row.observations,
        meanReturnPctPerOrder: row.meanReturnPctPerOrder,
        holdoutMeanReturnPctPerOrder: row.holdoutMeanReturnPctPerOrder,
      })),
    },
    monitoring: {
      artifactsWithNewEvidence: monitors.filter((row) => row.newEvidenceAvailable).length,
      materialAlerts: monitors.reduce(
        (sum, row) => sum + credibleMaterialAlerts(row),
        0,
      ),
      deepRiskRefreshes: monitors.reduce(
        (sum, row) => sum + row.deepRiskRefreshSymbols.filter((symbol) => {
          const candidate = row.candidates.find((value) => value.symbol === symbol);
          return candidate ? hasCredibleRiskChange(row, candidate) : false;
        }).length,
        0,
      ),
      medianObservedP90SpreadBps: nullableMedian(observedSpreads),
    },
    policy: {
      strategyVersion: policy.version,
      selectorVersion: policy.selectorPolicyVersion,
    },
    readinessGates,
    conclusion: conclusions,
    policyMutationAllowed: false as const,
    researchOnly: true as const,
    liveTradingEnabled: false as const,
  };
  const artifact: PennyPaperWeeklyAudit = {
    ...withoutHash,
    artifactHash: sha256(stableJson(withoutHash)),
  };
  const directory = join(runRoot, "weekly-audits");
  const artifactPath = join(directory, `${auditId}.json`);
  const reportPath = join(directory, `${auditId}.md`);
  await writeOnce(artifactPath, stableJson(artifact), "Weekly audit artifact");
  await writeOnce(reportPath, renderWeeklyAuditReport(artifact), "Weekly audit report");
  return { auditId, artifactPath, reportPath, artifact };
}

function buildMonitorCandidate(input: {
  researchRow: PennyStockResearchArtifact["candidates"][number];
  previous: PennyStockMonitorCandidate | undefined;
  evidence: PennyStockMonitoringEvidence;
  knownFilingKeys: Set<string>;
  knownFilingThroughDate: string | null;
  knownCorporateActionKeys: Set<string>;
}): PennyStockMonitorCandidate {
  const row = input.researchRow;
  const priorExecutionEvidence =
    input.previous?.currentExecutionEvidence ?? row.executionEvidence;
  const currentExecutionEvidence =
    input.evidence.execution[row.symbol] ?? priorExecutionEvidence;
  const riskUpdate = input.evidence.riskUpdates[row.symbol];
  const filingMarkers = riskUpdate?.filingMarkers ?? [];
  const corporateActions = riskUpdate?.corporateActions ?? [];
  const newFilingMarkers = filingMarkers.filter((marker) =>
    !input.knownFilingKeys.has(pennyFilingMarkerKey(marker))
    && !input.knownFilingKeys.has(`${marker.form}|${marker.filedAt}|`)
    && (!input.knownFilingThroughDate || marker.filedAt > input.knownFilingThroughDate)
  );
  const newCorporateActions = corporateActions.filter((action) =>
    !input.knownCorporateActionKeys.has(pennyCorporateActionKey(action))
  );
  const p90SpreadChangeBps =
    priorExecutionEvidence.p90SpreadBps == null
      || currentExecutionEvidence.p90SpreadBps == null
      ? null
      : round(
        currentExecutionEvidence.p90SpreadBps - priorExecutionEvidence.p90SpreadBps,
        4,
      );
  const fillRatioChangePct = round(
    currentExecutionEvidence.estimatedFillRatioPct
      - priorExecutionEvidence.estimatedFillRatioPct,
    4,
  );
  const refreshedFilingSummary = input.evidence.refreshedFilings[row.symbol] ?? null;
  const alerts: string[] = [];
  if (newFilingMarkers.length) {
    alerts.push(
      `New SEC markers: ${newFilingMarkers.map((marker) =>
        `${marker.form} filed ${marker.filedAt}`
      ).join(", ")}. Full issuer-risk evidence was refreshed.`,
    );
  }
  if (newCorporateActions.length) {
    alerts.push(
      `New corporate actions: ${newCorporateActions.map((action) =>
        `${action.type} on ${action.processDate || "an unresolved date"}`
      ).join(", ")}.`,
    );
  }
  if (refreshedFilingSummary?.vetoReasons.length) {
    alerts.push(`Refreshed hard-veto evidence: ${refreshedFilingSummary.vetoReasons.join(" ")}`);
  }
  if (
    currentExecutionEvidence.p90SpreadBps != null
    && currentExecutionEvidence.p90SpreadBps >= 1_500
  ) {
    alerts.push(
      `Observed p90 SIP spread is ${currentExecutionEvidence.p90SpreadBps.toFixed(1)} bps.`,
    );
  }
  if (p90SpreadChangeBps != null && p90SpreadChangeBps >= 250) {
    alerts.push(`Observed p90 SIP spread deteriorated ${p90SpreadChangeBps.toFixed(1)} bps.`);
  }
  if (
    currentExecutionEvidence.estimatedFillRatioPct < 25
    || fillRatioChangePct <= -20
  ) {
    alerts.push(
      `Modeled displayed-size fill ratio is ${currentExecutionEvidence.estimatedFillRatioPct.toFixed(1)}% (${fillRatioChangePct.toFixed(1)} points versus prior evidence).`,
    );
  }
  return {
    symbol: row.symbol,
    sourceRank: row.rank,
    referencePriceUsd: row.priceUsd,
    priorExecutionEvidence,
    currentExecutionEvidence,
    p90SpreadChangeBps,
    fillRatioChangePct,
    filingMarkers,
    newFilingMarkers,
    corporateActions,
    newCorporateActions,
    refreshedFilingSummary,
    alerts,
  };
}

function hasNewCandidateEvidence(candidate: PennyStockMonitorCandidate) {
  return (
    (candidate.currentExecutionEvidence.quoteEndAt ?? "")
      > (candidate.priorExecutionEvidence.quoteEndAt ?? "")
    || candidate.newFilingMarkers.length > 0
    || candidate.newCorporateActions.length > 0
  );
}

function credibleMaterialAlerts(artifact: PennyStockMonitorArtifact) {
  return artifact.candidates.reduce((sum, candidate) => {
    const credibleRiskChange = hasCredibleRiskChange(artifact, candidate);
    return sum + candidate.alerts.filter((alert) =>
      credibleRiskChange
      || (
        !alert.startsWith("New SEC markers:")
        && !alert.startsWith("Refreshed hard-veto evidence:")
      )
    ).length;
  }, 0);
}

function hasCredibleRiskChange(
  artifact: PennyStockMonitorArtifact,
  candidate: PennyStockMonitorCandidate,
) {
  if (candidate.newCorporateActions.length) return true;
  if (artifact.previousMonitorId) return candidate.newFilingMarkers.length > 0;
  const sourceDate = newYorkDate(new Date(artifact.sourceAsOf));
  return candidate.newFilingMarkers.some((marker) => marker.filedAt > sourceDate);
}

function knownEvidence(
  research: PennyStockResearchArtifact,
  previous: PennyStockMonitorArtifact | null,
) {
  return {
    filings: Object.fromEntries(research.candidates.map((row) => {
      const prior = previous?.candidates.find((candidate) => candidate.symbol === row.symbol);
      const keys = prior
        ? prior.filingMarkers.map(pennyFilingMarkerKey)
        : [
          ...row.filings.riskEvidence.map((evidence) =>
            `${evidence.form}|${evidence.filedAt}|${evidence.accessionNumber}`
          ),
          ...(row.filings.latestPeriodicForm && row.filings.latestPeriodicFiledAt
            ? [`${row.filings.latestPeriodicForm}|${row.filings.latestPeriodicFiledAt}|`]
            : []),
          ...(row.filings.latestEventForm && row.filings.latestEventFiledAt
            ? [`${row.filings.latestEventForm}|${row.filings.latestEventFiledAt}|`]
            : []),
        ];
      return [row.symbol, [...new Set(keys)]];
    })),
    filingThroughDate: Object.fromEntries(research.candidates.map((row) => [
      row.symbol,
      previous ? "" : newYorkDate(new Date(research.asOf)),
    ])),
    corporateActions: Object.fromEntries(research.candidates.map((row) => {
      const prior = previous?.candidates.find((candidate) => candidate.symbol === row.symbol);
      return [
        row.symbol,
        (prior?.corporateActions ?? row.corporateActions).map(pennyCorporateActionKey),
      ];
    })),
  };
}

async function readLatestCompletedResearch(runRoot: string, asOf: string) {
  const runs = await readRunEvidence(runRoot, asOf);
  const completed = runs
    .filter((run) => run.manifest?.status === "completed")
    .sort((left, right) =>
      right.research.asOf.localeCompare(left.research.asOf)
      || right.research.researchedAt.localeCompare(left.research.researchedAt)
    );
  const latest = completed[0]?.research;
  if (!latest) {
    throw new Error("A completed penny-stock paper research run is required before monitoring.");
  }
  return latest;
}

async function readRunEvidence(runRoot: string, asOf: string) {
  const entries = await readdir(join(runRoot, "runs"), { withFileTypes: true })
    .catch(() => []);
  const values = [];
  for (const entry of entries.filter((row) => row.isDirectory())) {
    const directory = join(runRoot, "runs", entry.name);
    const rawResearch = await readJson(join(directory, "research.json"));
    if (!isResearchArtifact(rawResearch) || rawResearch.asOf > asOf) continue;
    const rawManifest = await readJson(join(directory, "manifest.json"));
    const rawEvolution = await readJson(join(directory, "evolution.json"));
    const rawOutcomes = await readJson(join(directory, "outcomes.json"));
    const failure = await readJson(join(directory, "failure.json"));
    values.push({
      research: rawResearch,
      manifest: isRunManifest(rawManifest) ? rawManifest : null,
      evolution: isEvolutionResult(rawEvolution) ? rawEvolution : null,
      outcomes: isOutcomeLearning(rawOutcomes) ? rawOutcomes : null,
      failure: isRecord(failure) ? failure : null,
    });
  }
  return values;
}

async function countFailedRuns(runRoot: string, asOf: string) {
  const entries = await readdir(join(runRoot, "runs"), { withFileTypes: true })
    .catch(() => []);
  let failures = 0;
  for (const entry of entries.filter((row) => row.isDirectory())) {
    const directory = join(runRoot, "runs", entry.name);
    const [failure, manifest] = await Promise.all([
      readJson(join(directory, "failure.json")),
      readJson(join(directory, "manifest.json")),
    ]);
    if (
      isRecord(failure)
      && String(failure.failedAt ?? "") <= asOf
      && !isRunManifest(manifest)
    ) {
      failures += 1;
    }
  }
  return failures;
}

async function readMonitorArtifacts(runRoot: string) {
  const root = join(runRoot, "monitors");
  const dateDirectories = await readdir(root, { withFileTypes: true }).catch(() => []);
  const artifacts: PennyStockMonitorArtifact[] = [];
  for (const dateDirectory of dateDirectories.filter((entry) => entry.isDirectory())) {
    const directory = join(root, dateDirectory.name);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.filter((row) =>
      row.isFile() && row.name.endsWith(".json")
    )) {
      const value = await readJson(join(directory, entry.name));
      if (isMonitorArtifact(value)) artifacts.push(value);
    }
  }
  return artifacts.sort((left, right) => left.observedAt.localeCompare(right.observedAt));
}

function deduplicateOutcomes(
  runs: Array<{
    research: PennyStockResearchArtifact;
    outcomes: PennyPaperOutcomeLearning | null;
  }>,
) {
  const values = new Map<string, {
    evaluatedAt: string;
    outcome: PennyPaperCandidateOutcome;
  }>();
  for (const run of runs) {
    if (!run.outcomes) continue;
    for (const outcome of run.outcomes.outcomes) {
      const key = `${outcome.sourceRunId}|${outcome.symbol}`;
      const previous = values.get(key);
      if (!previous || previous.evaluatedAt < run.outcomes.evaluatedAt) {
        values.set(key, {
          evaluatedAt: run.outcomes.evaluatedAt,
          outcome,
        });
      }
    }
  }
  return [...values.values()].map((value) => value.outcome);
}

function latestOutcomeDecisionReview(outcome: PennyPaperCandidateOutcome) {
  for (const horizon of ["20", "10", "5", "1"] as const) {
    const review = outcome.decisionReviews?.[horizon];
    if (review) return review;
  }
  return null;
}

function aggregateGatePassRates(evolutions: PennyPaperEvolutionResult[]) {
  const totals = new Map<string, { passed: number; evaluated: number }>();
  for (const evolution of evolutions) {
    for (const [gate, passed] of Object.entries(evolution.gates)) {
      const current = totals.get(gate) ?? { passed: 0, evaluated: 0 };
      current.evaluated += 1;
      if (passed) current.passed += 1;
      totals.set(gate, current);
    }
  }
  return Object.fromEntries([...totals.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  ).map(([gate, value]) => [gate, {
    ...value,
    ratePct: value.evaluated
      ? round(value.passed / value.evaluated * 100, 2)
      : 0,
  }]));
}

function positiveCostStressRuns(
  evolutions: PennyPaperEvolutionResult[],
  multiplier: 1 | 2 | 3,
) {
  return evolutions.filter((evolution) =>
    (evolution.statisticalEvidence.costStress.find((row) =>
      row.multiplier === multiplier
    )?.pnlUsd ?? 0) > 0
  ).length;
}

function marketSessionAt(date: Date): PennyStockMonitorArtifact["marketSession"] {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = !["Sat", "Sun"].includes(parts.weekday ?? "");
  return {
    timeZone: "America/New_York",
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: `${parts.hour}:${parts.minute}`,
    regularHoursWindow: "09:30-16:00",
    withinScheduledRegularHours: weekday && minutes >= 570 && minutes < 960,
    calendarLimitation:
      "The schedule uses weekday New York clock time; exchange holidays and unscheduled halts are inferred only from whether newer SIP evidence appears.",
  };
}

function newYorkDate(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function renderMonitorReport(artifact: PennyStockMonitorArtifact) {
  const rows = artifact.candidates.map((candidate) =>
    `| ${candidate.sourceRank} | ${candidate.symbol} | ${candidate.currentExecutionEvidence.quoteEndAt ?? "n/a"} | ${candidate.currentExecutionEvidence.p90SpreadBps?.toFixed(1) ?? "n/a"} | ${candidate.currentExecutionEvidence.estimatedFillRatioPct.toFixed(1)}% | ${candidate.newFilingMarkers.length} | ${candidate.newCorporateActions.length} | ${candidate.alerts.length} |`
  ).join("\n");
  return `# Penny-stock intraday evidence monitor

Research-only evidence observed at ${artifact.observedAt}. This monitor cannot select candidates, mutate a policy, place or simulate an order through a broker, or move money.

Source run: \`${artifact.sourceRunId}\` / \`${artifact.sourceResearchArtifactHash}\`

| Rank | Symbol | Latest quote | p90 spread bps | Modeled fill | New SEC markers | New actions | Alerts |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
${rows}

## Material alerts

${artifact.materialAlerts.length
    ? artifact.materialAlerts.map((value) => `- ${value}`).join("\n")
    : "- No material alert crossed the monitor thresholds."}

Deep issuer-risk refreshes: ${artifact.deepRiskRefreshSymbols.join(", ") || "none"}.

Artifact SHA-256: \`${artifact.artifactHash}\`
`;
}

function renderWeeklyAuditReport(artifact: PennyPaperWeeklyAudit) {
  const gates = Object.entries(artifact.readinessGates)
    .map(([gate, passed]) => `- ${passed ? "PASS" : "WAIT"} — ${gate}`)
    .join("\n");
  return `# Penny-stock accumulated-cohort weekly audit

Research-only audit at ${artifact.auditedAt}. It summarizes evidence and cannot mutate a strategy or selector policy.

- Completed runs / distinct snapshots: ${artifact.window.completedRuns} / ${artifact.window.distinctUniverseSnapshots}
- Failed / awaiting review: ${artifact.window.failedRuns} / ${artifact.window.awaitingReviewRuns}
- Intraday evidence artifacts: ${artifact.window.monitorArtifacts}
- Decisions accepted / rejected / cash: ${artifact.decisions.accepted} / ${artifact.decisions.rejected} / ${artifact.decisions.cash}
- Mean baseline / treatment evaluation PnL: ${formatNullableUsd(artifact.evaluationMetrics.meanBaselinePnlUsd)} / ${formatNullableUsd(artifact.evaluationMetrics.meanTreatmentPnlUsd)}
- Worst treatment drawdown: ${artifact.evaluationMetrics.worstTreatmentDrawdownPct?.toFixed(2) ?? "n/a"}%
- Matured outcomes 1/5/10/20: ${artifact.maturedOutcomes.horizon1}/${artifact.maturedOutcomes.horizon5}/${artifact.maturedOutcomes.horizon10}/${artifact.maturedOutcomes.horizon20}
- Outcome label coverage source / mature-eligible 20-session: ${artifact.maturedOutcomes.sourceCoveragePct?.toFixed(1) ?? "n/a"}% / ${artifact.maturedOutcomes.maturityCoveragePct20?.toFixed(1) ?? "n/a"}%
- Latest decision audits supported/challenged/mixed/inconclusive: ${artifact.maturedOutcomes.supportedDecisions ?? 0}/${artifact.maturedOutcomes.challengedDecisions ?? 0}/${artifact.maturedOutcomes.mixedDecisions ?? 0}/${artifact.maturedOutcomes.inconclusiveDecisions ?? 0}
- Logic-error candidates / material movers: ${artifact.maturedOutcomes.logicErrorCandidates ?? 0}/${artifact.maturedOutcomes.materialMoverReviews ?? 0}
- Prospective entry-distance panels: ${artifact.prospectiveEntryLearning.maturedPanelObservations20}/${artifact.prospectiveEntryLearning.minimumRequired}; eligible to enter full gate stack: ${artifact.prospectiveEntryLearning.promotionEligibleForFullGateStack ? "yes" : "no"}
- Entry variants: ${artifact.prospectiveEntryLearning.variants.map((row) => `${row.entryDiscountPct}% ${row.fills}/${row.observations} fills, mean/order ${row.meanReturnPctPerOrder.toFixed(2)}%, holdout ${row.holdoutMeanReturnPctPerOrder?.toFixed(2) ?? "n/a"}%`).join("; ") || "no matured prospectively registered panels"}
- Strategy / selector policy versions: ${artifact.policy.strategyVersion} / ${artifact.policy.selectorVersion}

## Coverage readiness

${gates}

${artifact.conclusion}

Evaluation PnL values come from overlapping research windows and are not additive portfolio earnings. Simulated results do not establish future returns.

Artifact SHA-256: \`${artifact.artifactHash}\`
`;
}

function isResearchArtifact(value: unknown): value is PennyStockResearchArtifact {
  return isRecord(value)
    && value.schemaVersion === 2
    && value.researchOnly === true
    && value.liveTradingEnabled === false
    && typeof value.runId === "string"
    && typeof value.asOf === "string"
    && typeof value.researchedAt === "string"
    && typeof value.artifactHash === "string"
    && isRecord(value.universe)
    && typeof value.universe.snapshotHash === "string"
    && Array.isArray(value.candidates);
}

function isRunManifest(value: unknown): value is PennyPaperRunManifest {
  return isRecord(value)
    && value.schemaVersion === 2
    && value.status === "completed"
    && value.researchOnly === true
    && value.liveTradingEnabled === false
    && Array.isArray(value.selectedSymbols);
}

function isEvolutionResult(value: unknown): value is PennyPaperEvolutionResult {
  return isRecord(value)
    && value.schemaVersion === 2
    && value.researchOnly === true
    && value.liveTradingEnabled === false
    && isRecord(value.gates)
    && isRecord(value.statisticalEvidence);
}

function isOutcomeLearning(value: unknown): value is PennyPaperOutcomeLearning {
  return isRecord(value)
    && [1, 2].includes(Number(value.schemaVersion))
    && value.researchOnly === true
    && typeof value.evaluatedAt === "string"
    && Array.isArray(value.outcomes);
}

function isMonitorArtifact(value: unknown): value is PennyStockMonitorArtifact {
  return isRecord(value)
    && value.schemaVersion === 1
    && value.policyMutationAllowed === false
    && value.researchOnly === true
    && value.liveTradingEnabled === false
    && typeof value.monitorId === "string"
    && typeof value.observedAt === "string"
    && Array.isArray(value.candidates);
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}

async function writeOnce(path: string, content: string, label: string) {
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing) throw new Error(`${label} already exists; append-only artifacts cannot be overwritten.`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortValue(value[key])]),
  );
}

function safeIdentifier(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(trimmed)) {
    throw new Error("Artifact ids may contain only letters, numbers, dots, underscores, and hyphens.");
  }
  return trimmed;
}

function createMonitorId(date: Date) {
  return `penny-monitor-${date.toISOString().replace(/\D/g, "").slice(0, 12)}`;
}

function createWeeklyAuditId(date: Date) {
  return `penny-weekly-${date.toISOString().slice(0, 10).replace(/\D/g, "")}`;
}

function nullableMean(values: number[]) {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 4) : null;
}

function nullableMaximum(values: number[]) {
  return values.length ? round(Math.max(...values), 4) : null;
}

function nullableMedian(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return round(
    ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2,
    4,
  );
}

function formatNullableUsd(value: number | null) {
  return value == null ? "n/a" : `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
