import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { evaluatePennyPaperEvolution } from "./evolution";
import {
  discoverPennyStockCandidates,
  fetchPennyOutcomeCatalystSignals,
  fetchPennyStockLongHistory,
  PENNY_RESEARCH_FILTERS,
  PROSPECTIVE_ENTRY_DISCOUNTS_PCT,
} from "./research";
import {
  carryForwardPennyOutcomeCatalystEvidence,
  evaluatePennyCandidateOutcomes,
  selectPennyOutcomeCatalystReviewSymbols,
} from "./outcomes";
import {
  DEFAULT_PENNY_PAPER_ASSUMPTIONS,
  DEFAULT_PENNY_PAPER_STRATEGY,
} from "./simulation";
import type {
  PennyPaperOutcomeLearning,
  PennyPaperPolicy,
  PennyPaperReflection,
  PennyPaperRunManifest,
  PennyPaperSelection,
  PennyStockBar,
  PennyStockResearchArtifact,
  PennyStockResearchRow,
  PennyStockUniverseRow,
} from "./types";
import { DEFAULT_PENNY_SELECTOR_WEIGHTS } from "./research";

export type PennyStockResearchRunResult = {
  status: "created";
  runId: string;
  researchPath: string;
  reportPath: string;
  artifact: PennyStockResearchArtifact;
};

export type PennyStockResearchSkippedResult = {
  status: "skipped";
  reason: "unchanged-as-of-snapshot";
  existingRunId: string;
  asOf: string;
  snapshotHash: string;
};

export function defaultPennyPaperRoot() {
  return join(homedir(), ".hivemindos", "penny-stock-paper-lab");
}

export function pennyResearchSnapshotIdentityHash(input: {
  universe: PennyStockUniverseRow[];
  rankedCandidates: PennyStockResearchArtifact["candidates"];
}) {
  return sha256(stableJson({
    schemaVersion: 2,
    universe: input.universe,
    rankedCandidates: input.rankedCandidates,
  }));
}

export async function runPennyStockResearch(options: {
  runRoot?: string;
  runId?: string;
  asOf?: Date;
} = {}): Promise<PennyStockResearchRunResult | PennyStockResearchSkippedResult> {
  const runRoot = resolve(options.runRoot ?? defaultPennyPaperRoot());
  const runId = safeIdentifier(options.runId ?? createRunId());
  const runDirectory = join(runRoot, "runs", runId);
  await mkdir(join(runRoot, "runs"), { recursive: true, mode: 0o700 });
  const policy = await readPennyPaperPolicy({ runRoot });
  let discovery: Awaited<ReturnType<typeof discoverPennyStockCandidates>>;
  try {
    discovery = await retryReadOnlyProvider("candidate discovery", () =>
      discoverPennyStockCandidates({
        asOf: options.asOf,
        strategy: policy.strategy,
        selectorWeights: policy.selectorWeights,
      })
    );
  } catch (error) {
    await createAppendOnlyRunDirectory(runDirectory, runId);
    await writeFailure(runDirectory, runId, "research", error);
    throw error;
  }
  if (discovery.candidates.length !== PENNY_RESEARCH_FILTERS.outputCandidates) {
    const error = new Error(
      `Research needed ${PENNY_RESEARCH_FILTERS.outputCandidates} eligible candidates but found ${discovery.candidates.length}.`,
    );
    await createAppendOnlyRunDirectory(runDirectory, runId);
    await writeFailure(runDirectory, runId, "research", error);
    throw error;
  }
  const snapshotIdentity = {
    schemaVersion: 2,
    universe: discovery.universeSnapshot,
    rankedCandidates: discovery.candidates,
  };
  const snapshotHash = pennyResearchSnapshotIdentityHash({
    universe: discovery.universeSnapshot,
    rankedCandidates: discovery.candidates,
  });
  const priorReceipt = await readJson(join(runRoot, "last-evaluation.json"));
  if (
    isRecord(priorReceipt)
    && (
      priorReceipt.snapshotIdentityHash === snapshotHash
      || (
        typeof priorReceipt.snapshotIdentityHash !== "string"
        && String(priorReceipt.asOf ?? "").slice(0, 10) === discovery.asOf.slice(0, 10)
      )
    )
  ) {
    return {
      status: "skipped",
      reason: "unchanged-as-of-snapshot",
      existingRunId: String(priorReceipt.runId ?? "unknown"),
      asOf: discovery.asOf,
      snapshotHash,
    };
  }
  await createAppendOnlyRunDirectory(runDirectory, runId);
  const researchedAt = new Date().toISOString();
  const snapshotBody = {
    runId,
    capturedAt: researchedAt,
    asOf: discovery.asOf,
    ...snapshotIdentity,
    researchOnly: true,
  };
  const snapshotPath = join(runRoot, "universe-snapshots", `${runId}.json`);
  await writeOnce(
    snapshotPath,
    stableJson({ ...snapshotBody, snapshotHash }),
    "Universe snapshot",
  );
  const snapshots = await readdir(join(runRoot, "universe-snapshots")).catch(() => []);
  const withoutHash = {
    schemaVersion: 2 as const,
    runId,
    researchedAt,
    asOf: discovery.asOf,
    universe: {
      minimumPriceUsd: PENNY_RESEARCH_FILTERS.minimumPriceUsd,
      maximumPriceUsd: PENNY_RESEARCH_FILTERS.maximumPriceUsd,
      minimumMarketCapUsd: PENNY_RESEARCH_FILTERS.minimumMarketCapUsd,
      maximumMarketCapUsd: PENNY_RESEARCH_FILTERS.maximumMarketCapUsd,
      minimumCurrentVolume: PENNY_RESEARCH_FILTERS.minimumCurrentVolume,
      eligibleBeforeHistory: discovery.eligibleBeforeHistory,
      historyCandidates: discovery.historyCandidates,
      snapshotPath,
      snapshotHash,
      pointInTimeCoverage: snapshots.length > 1
        ? "multi-snapshot" as const
        : "current-snapshot-only" as const,
    },
    method: {
      description:
        "Rank with Wilson-bound expected value, SIP quote execution quality, SEC/corporate-action risk, liquidity, and drawdown. A standing limit is modeled below the prior close with pessimistic partial fills, costs, gaps, and portfolio loss controls.",
      baselineStrategy: policy.strategy,
      selectorWeights: policy.selectorWeights,
      prospectiveEntryDiscountsPct: [...PROSPECTIVE_ENTRY_DISCOUNTS_PCT],
      prospectiveRegisteredAt: researchedAt,
    },
    candidates: discovery.candidates,
    dataSources: [
      {
        name: "Nasdaq stock screener",
        url: "https://api.nasdaq.com/api/screener/stocks",
        role: "Current listed-stock price, market cap, industry, country, and volume.",
      },
      {
        name: "Alpaca assets, SIP bars, SIP quotes, and corporate actions",
        url: "https://data.alpaca.markets",
        role: "Tradability, adjusted OHLCV, consolidated quotes and sizes, and corporate actions.",
      },
      {
        name: "SEC EDGAR submissions, filing documents, and Companyfacts",
        url: "https://data.sec.gov",
        role: "Point-in-time filing text, shares outstanding, cash, operating cash flow, and risk flags.",
      },
    ],
    limitations: [
      snapshots.length > 1
        ? "The lab now preserves multiple dated universe snapshots, but coverage begins when snapshots were first recorded and is not a complete historical delisting archive."
        : "This is the first preserved universe snapshot, so prior delisted securities and older point-in-time membership remain unavailable.",
      "Historical SIP quote evidence is sampled to a bounded recent window; long walk-forward cohorts use a pessimistic daily-bar execution fallback.",
      "Displayed quote size is haircut to 10% participation, but executable queue priority remains unknowable and is never claimed as observed.",
      "SEC phrases are classified as confirmed, planned, conditional, boilerplate, or unclear before veto rules are applied; Companyfacts runway calculations remain screening evidence, not accounting conclusions.",
      "No candidate is a recommendation, and no order, broker mutation, wallet action, or live-trading path exists.",
    ],
    researchOnly: true as const,
    liveTradingEnabled: false as const,
  };
  const artifactHash = sha256(stableJson(withoutHash));
  const artifact: PennyStockResearchArtifact = { ...withoutHash, artifactHash };
  const researchPath = join(runDirectory, "research.json");
  const reportPath = join(runDirectory, "research.md");
  await atomicWrite(researchPath, stableJson(artifact));
  await atomicWrite(reportPath, renderPennyResearchReport(artifact));
  return { status: "created", runId, researchPath, reportPath, artifact };
}

export function reasonPennyStockSelection(
  research: PennyStockResearchArtifact,
): string[] {
  const eligible = research.candidates
    .filter((row) =>
      !row.vetoed
      && !(row.reviewRequired ?? false)
      && row.conservativeEv.positive
    )
    .sort((left, right) =>
      right.conservativeEv.expectedValueLowPctPerOrder
        - left.conservativeEv.expectedValueLowPctPerOrder
      || right.score - left.score
      || left.symbol.localeCompare(right.symbol)
    );
  const selected: PennyStockResearchRow[] = [];
  for (const candidate of eligible) {
    if (selected.length >= 3) break;
    const sectorAlreadySelected = selected.some((row) => row.sector === candidate.sector);
    const unusedSectorAvailable = eligible.some((row) =>
      !selected.includes(row)
      && !selected.some((chosen) => chosen.sector === row.sector)
    );
    if (sectorAlreadySelected && unusedSectorAvailable) continue;
    selected.push(candidate);
  }
  for (const candidate of eligible) {
    if (selected.length >= 3) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  return selected.map((row) => row.symbol);
}

export async function reviewPennyStockSelection(input: {
  runId: string;
  symbols: string[];
  reviewedBy: string;
  rationale: string;
  runRoot?: string;
  now?: Date;
}): Promise<{ selection: PennyPaperSelection; path: string }> {
  const runId = safeIdentifier(input.runId);
  const runRoot = resolve(input.runRoot ?? defaultPennyPaperRoot());
  const runDirectory = join(runRoot, "runs", runId);
  const research = await readResearch(join(runDirectory, "research.json"));
  const selected = [...new Set(input.symbols.map(normalizeSymbol).filter(Boolean))];
  if (selected.length > 3) throw new Error("Selection review permits zero to three unique symbols.");
  const rows = new Map(research.candidates.map((row) => [row.symbol, row]));
  for (const symbol of selected) {
    const row = rows.get(symbol);
    if (!row) throw new Error(`${symbol} is not in research run ${runId}'s top ten.`);
    if (row.vetoed) {
      throw new Error(`${symbol} is blocked by evidence vetoes: ${row.vetoReasons.join(" ")}`);
    }
    if (row.reviewRequired) {
      throw new Error(
        `${symbol} is quarantined pending issuer-risk review: ${row.reviewReasons.join(" ")}`,
      );
    }
    if (!row.conservativeEv.positive) {
      throw new Error(`${symbol} has non-positive Wilson-bound conservative expected value.`);
    }
  }
  const reviewedBy = input.reviewedBy.trim();
  const rationale = input.rationale.trim();
  if (reviewedBy.length < 2) throw new Error("reviewedBy is required.");
  if (rationale.length < 20) throw new Error("The selection rationale must be at least 20 characters.");
  const rejectedSymbols = Object.fromEntries(research.candidates
    .filter((row) => !selected.includes(row.symbol))
    .map((row) => [row.symbol, rejectionRationale(row)]));
  const selection: PennyPaperSelection = {
    schemaVersion: 2,
    runId,
    reviewedAt: (input.now ?? new Date()).toISOString(),
    reviewedBy,
    selectedSymbols: selected,
    heldCash: selected.length === 0,
    rationale,
    symbolRationales: Object.fromEntries(
      selected.map((symbol) => [symbol, defaultSymbolRationale(rows.get(symbol)!)]),
    ),
    rejectedSymbols,
    researchArtifactHash: research.artifactHash,
    selectorPolicyVersion: (await readPennyPaperPolicy({ runRoot })).selectorPolicyVersion,
    portfolioControls: {
      maximumNames: 3,
      requirePositiveConservativeEv: true,
      blockVetoedCandidates: true,
      blockUnresolvedIssuerRisk: true,
      diversifySectorsWhenPossible: true,
    },
    researchOnly: true,
    liveTradingEnabled: false,
  };
  const path = join(runDirectory, "selection.json");
  await writeOnce(path, stableJson(selection), "Selection review");
  return { selection, path };
}

export async function runPennyStockAfterClose(options: {
  runRoot?: string;
  runId?: string;
  asOf?: Date;
  reviewedBy?: string;
} = {}) {
  const research = await runPennyStockResearch(options);
  if (research.status === "skipped") return research;
  const symbols = reasonPennyStockSelection(research.artifact);
  const reviewedBy = options.reviewedBy?.trim() || "HivemindOS bounded paper reasoner";
  const monitoringContext = await readSameDayMonitoringContext(
    resolve(options.runRoot ?? defaultPennyPaperRoot()),
    research.artifact,
  );
  const rationale = `${buildBoundedReasonerRationale(research.artifact, symbols)} ${monitoringContext}`;
  const review = await reviewPennyStockSelection({
    runId: research.runId,
    symbols,
    reviewedBy,
    rationale,
    runRoot: options.runRoot,
  });
  const manifest = await evolvePennyStockPaperRun({
    runId: research.runId,
    runRoot: options.runRoot,
    asOf: options.asOf,
  });
  return {
    status: "completed" as const,
    runId: research.runId,
    selectedSymbols: review.selection.selectedSymbols,
    heldCash: review.selection.heldCash,
    rationale,
    researchPath: research.researchPath,
    researchReportPath: research.reportPath,
    selectionPath: review.path,
    manifest,
    researchOnly: true as const,
    liveTradingEnabled: false as const,
  };
}

export async function evolvePennyStockPaperRun(input: {
  runId: string;
  runRoot?: string;
  asOf?: Date;
}): Promise<PennyPaperRunManifest> {
  const runId = safeIdentifier(input.runId);
  const runRoot = resolve(input.runRoot ?? defaultPennyPaperRoot());
  const runDirectory = join(runRoot, "runs", runId);
  const paths = runPaths(runDirectory);
  const research = await readResearch(paths.researchPath);
  const selection = await readSelection(paths.selectionPath, research);
  const policy = await readPennyPaperPolicy({ runRoot });
  const priorReceipt = await readJson(join(runRoot, "last-evaluation.json"));
  const priorAsOf = isRecord(priorReceipt) ? String(priorReceipt.asOf ?? "") : null;
  const priorSnapshotHash = isRecord(priorReceipt)
    ? String(priorReceipt.snapshotHash ?? "")
    : "";
  if (
    priorAsOf === research.asOf
    && priorSnapshotHash === research.universe.snapshotHash
  ) {
    throw new Error(
      "This as-of dataset was already evaluated; wait for a new dated snapshot instead of mining unchanged evidence.",
    );
  }

  try {
    const barsBySymbol = selection.selectedSymbols.length
      ? await retryReadOnlyProvider("selected-symbol history", () =>
        fetchPennyStockLongHistory({
          symbols: selection.selectedSymbols,
          asOf: input.asOf ?? new Date(research.asOf),
        })
      )
      : {};
    const assumptions = {
      ...DEFAULT_PENNY_PAPER_ASSUMPTIONS,
      startingCashUsd: DEFAULT_PENNY_PAPER_ASSUMPTIONS.notionalUsdPerSymbol
        * Math.max(1, selection.selectedSymbols.length),
      maxConcurrentPositions: Math.max(1, selection.selectedSymbols.length),
    };
    const evolution = evaluatePennyPaperEvolution({
      runId,
      symbols: selection.selectedSymbols,
      barsBySymbol,
      policy,
      assumptions,
      asOf: research.asOf,
      priorEvidenceAsOf: priorAsOf,
    });
    const outcomeSources = await readOutcomeSources(runRoot, research.asOf);
    const outcomeHistories = await retryReadOnlyProvider("outcome histories", () =>
      fetchOutcomeHistories(
        outcomeSources.flatMap((row) => row.research.candidates.map((candidate) => candidate.symbol)),
        input.asOf ?? new Date(research.asOf),
        barsBySymbol,
      )
    );
    const outcomeEvaluatedAt = new Date();
    const preliminaryOutcomes = evaluatePennyCandidateOutcomes({
      runs: outcomeSources,
      barsBySymbol: outcomeHistories,
      policy,
      evaluatedAt: outcomeEvaluatedAt,
    });
    const previousOutcomeLearning = await readLatestOutcomeLearning(runRoot, runId);
    const catalystReviewSymbols = selectPennyOutcomeCatalystReviewSymbols(
      preliminaryOutcomes.outcomes,
      20,
      previousOutcomeLearning,
    );
    const riskUpdatesBySymbol = catalystReviewSymbols.length
      ? await retryReadOnlyProvider("outcome catalyst signals", () =>
        fetchPennyOutcomeCatalystSignals({
          symbols: catalystReviewSymbols,
          asOf: input.asOf ?? new Date(research.asOf),
        })
      )
      : {};
    const outcomes = carryForwardPennyOutcomeCatalystEvidence(
      evaluatePennyCandidateOutcomes({
      runs: outcomeSources,
      barsBySymbol: outcomeHistories,
      riskUpdatesBySymbol,
      policy,
      evaluatedAt: outcomeEvaluatedAt,
      }),
      previousOutcomeLearning,
    );
    outcomes.catalystReviewSymbols = catalystReviewSymbols;
    const reflection = buildReflection({
      runId,
      research,
      evolution,
      outcomes,
      priorAsOf,
    });
    await writeOnce(paths.evolutionPath, stableJson(evolution), "Evolution artifact");
    await writeOnce(paths.outcomesPath, stableJson(outcomes), "Outcome-learning artifact");
    await writeOnce(paths.reflectionPath, stableJson(reflection), "Reflection artifact");
    await writeOnce(
      join(runRoot, "generations", `${runId}.json`),
      stableJson({ evolution, reflection, outcomes }),
      "Generation artifact",
    );
    if (evolution.decision === "accepted" || outcomes.promoted) {
      const nextPolicy: PennyPaperPolicy = {
        schemaVersion: 2,
        version: evolution.policyVersionAfter,
        strategy: evolution.decision === "accepted"
          ? evolution.proposedStrategy
          : policy.strategy,
        selectorWeights: outcomes.promoted
          ? outcomes.proposedWeights
          : policy.selectorWeights,
        selectorPolicyVersion: outcomes.selectorPolicyVersionAfter,
        acceptedAt: evolution.evaluatedAt,
        acceptedFromRunId: runId,
        lastEvidenceAsOf: research.asOf,
        researchOnly: true,
        liveTradingEnabled: false,
      };
      await atomicWrite(join(runRoot, "policy.json"), stableJson(nextPolicy));
    }
    await writeOnce(
      paths.reportPath,
      renderPennyPaperReport(research, selection, evolution, outcomes, reflection),
      "Final report",
    );
    const manifest: PennyPaperRunManifest = {
      schemaVersion: 2,
      runId,
      status: "completed",
      researchedAt: research.researchedAt,
      completedAt: new Date().toISOString(),
      selectedSymbols: selection.selectedSymbols,
      heldCash: selection.heldCash,
      policyVersionBefore: evolution.policyVersionBefore,
      policyVersionAfter: evolution.policyVersionAfter,
      evolutionDecision: evolution.decision,
      ...paths,
      researchArtifactHash: research.artifactHash,
      researchOnly: true,
      liveTradingEnabled: false,
    };
    await writeOnce(paths.manifestPath, stableJson(manifest), "Run manifest");
    await atomicWrite(join(runRoot, "last-evaluation.json"), stableJson({
      schemaVersion: 1,
      runId,
      evaluatedAt: evolution.evaluatedAt,
      asOf: research.asOf,
      snapshotHash: research.universe.snapshotHash,
      snapshotIdentityHash: research.universe.snapshotHash,
      decision: evolution.decision,
      failedGates: Object.entries(evolution.gates)
        .filter(([, passed]) => !passed)
        .map(([key]) => key),
      researchOnly: true,
    }));
    return manifest;
  } catch (error) {
    await writeFailure(runDirectory, runId, "evolution", error, research.artifactHash);
    throw error;
  }
}

export async function readPennyPaperPolicy(options: {
  runRoot?: string;
} = {}): Promise<PennyPaperPolicy> {
  const runRoot = resolve(options.runRoot ?? defaultPennyPaperRoot());
  const value = await readJson(join(runRoot, "policy.json"));
  if (!value) return defaultPolicy();
  if (
    !isRecord(value)
    || value.researchOnly !== true
    || value.liveTradingEnabled !== false
    || typeof value.version !== "number"
    || !isRecord(value.strategy)
  ) {
    throw new Error("The penny-stock paper policy is invalid.");
  }
  if (value.schemaVersion === 1) {
    return {
      ...defaultPolicy(),
      version: value.version,
      strategy: value.strategy as unknown as PennyPaperPolicy["strategy"],
      acceptedAt: typeof value.acceptedAt === "string" ? value.acceptedAt : null,
      acceptedFromRunId:
        typeof value.acceptedFromRunId === "string" ? value.acceptedFromRunId : null,
    };
  }
  if (
    value.schemaVersion !== 2
    || !isRecord(value.selectorWeights)
    || typeof value.selectorPolicyVersion !== "number"
  ) throw new Error("The penny-stock paper policy schema is unsupported.");
  return value as unknown as PennyPaperPolicy;
}

export async function listPennyPaperRuns(options: {
  runRoot?: string;
} = {}) {
  const runRoot = resolve(options.runRoot ?? defaultPennyPaperRoot());
  const runsRoot = join(runRoot, "runs");
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const values = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(
    async (entry) => {
      const directory = join(runsRoot, entry.name);
      const manifest = await readJson(join(directory, "manifest.json"));
      const research = await readJson(join(directory, "research.json"));
      const failure = await readJson(join(directory, "failure.json"));
      return {
        runId: entry.name,
        status: isRecord(manifest)
          ? String(manifest.status ?? "completed")
          : isRecord(failure)
            ? "failed"
            : isRecord(research)
              ? "awaiting-review"
              : "incomplete",
        researchedAt: isRecord(research) ? String(research.researchedAt ?? "") : "",
        selectedSymbols: isRecord(manifest) && Array.isArray(manifest.selectedSymbols)
          ? manifest.selectedSymbols.map(String)
          : [],
      };
    },
  ));
  return values.sort((left, right) =>
    right.researchedAt.localeCompare(left.researchedAt)
    || right.runId.localeCompare(left.runId)
  );
}

export function renderPennyResearchReport(artifact: PennyStockResearchArtifact) {
  const rows = artifact.candidates.map((row) =>
    `| ${row.rank} | ${row.symbol} | ${formatUsd(row.marketCapUsd)} | ${formatInteger(row.averageDailyVolume90)} | ${row.volatility90Pct.toFixed(1)}% | ${row.maxDrawdown90Pct.toFixed(1)}% | ${row.methodEvidence.limitTouchRatePct.toFixed(1)}% | ${row.methodEvidence.bounceRatePct.toFixed(1)}% | ${row.conservativeEv.expectedValueLowPctPerOrder.toFixed(2)}% | ${row.executionEvidence.p90SpreadBps?.toFixed(0) ?? "n/a"} | ${row.vetoed ? "VETO" : row.reviewRequired ? "REVIEW" : "eligible"} |`
  ).join("\n");
  const details = artifact.candidates.map((row) => `### ${row.rank}. ${row.symbol} — ${row.name}

- Price / market cap: ${formatUsd(row.priceUsd)} / ${formatUsd(row.marketCapUsd)}
- 90-session SIP volume: average ${formatInteger(row.averageDailyVolume90)}, median ${formatInteger(row.medianDailyVolume90)}, average dollar volume ${formatUsd(row.averageDailyDollarVolume90)}
- Volatility / drawdown / return: ${row.volatility90Pct.toFixed(1)}% / ${row.maxDrawdown90Pct.toFixed(1)}% / ${row.return90Pct.toFixed(1)}%
- Modeled touch / bounce: ${row.methodEvidence.limitTouches}/${row.methodEvidence.observations} touches; ${row.methodEvidence.bouncesAfterTouch}/${row.methodEvidence.limitTouches} target bounces
- Conservative EV: ${row.conservativeEv.expectedValueLowPctPerOrder.toFixed(2)}% per order (${row.conservativeEv.touchProbabilityLowPct.toFixed(1)}% touch lower bound; ${row.conservativeEv.bounceProbabilityLowPct.toFixed(1)}% bounce lower bound; ${row.conservativeEv.roundTripFrictionPct.toFixed(1)}% friction)
- Quote execution: ${row.executionEvidence.quoteObservations} observations; median/p90 spread ${row.executionEvidence.medianSpreadBps?.toFixed(1) ?? "n/a"}/${row.executionEvidence.p90SpreadBps?.toFixed(1) ?? "n/a"} bps; estimated fill ${row.executionEvidence.estimatedFillRatioPct.toFixed(1)}%; queue priority unknown
- SEC / corporate action: ${row.filings.coverage} coverage; shares growth ${row.filings.sharesOutstandingGrowthPct?.toFixed(1) ?? "n/a"}%; cash runway ${row.filings.estimatedCashRunwayMonths?.toFixed(1) ?? "n/a"} months; ${row.corporateActions.length} actions
- Decision evidence: ${row.vetoed ? `VETO — ${row.vetoReasons.join(" ")}` : row.reviewRequired ? `REVIEW QUARANTINE — ${row.reviewReasons.join(" ")}` : "No hard veto or unresolved issuer-risk quarantine."}
- Risks: ${row.risks.length ? row.risks.join(" ") : "General microcap liquidity, dilution, manipulation, and delisting risk."}`).join("\n\n");
  return `# Penny-stock standing-limit paper research

Research-only output as of ${artifact.asOf}. It is not an investment recommendation and has no broker, order, wallet, or money-movement path.

| Rank | Symbol | Market cap | Avg SIP volume | Volatility | Drawdown | Touch rate | Bounce rate | Conservative EV | p90 spread bps | Status |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${rows}

## Separate candidate evidence

${details}

## Method and lineage

${artifact.method.description}

Prospective entry-distance panel: ${(artifact.method.prospectiveEntryDiscountsPct ?? []).map((value) => `${value}%`).join(", ") || "not registered"}. These variants are observation-only and cannot mutate policy from historical backfill.

Universe snapshot: \`${artifact.universe.snapshotHash}\` (${artifact.universe.pointInTimeCoverage}).

## Limitations

${artifact.limitations.map((value) => `- ${value}`).join("\n")}

Artifact SHA-256: \`${artifact.artifactHash}\`
`;
}

function renderPennyPaperReport(
  research: PennyStockResearchArtifact,
  selection: PennyPaperSelection,
  evolution: ReturnType<typeof evaluatePennyPaperEvolution>,
  outcomes: PennyPaperOutcomeLearning,
  reflection: PennyPaperReflection,
) {
  const selected = selection.selectedSymbols.length
    ? selection.selectedSymbols.map((symbol) => {
      const row = research.candidates.find((candidate) => candidate.symbol === symbol)!;
      return `- ${symbol} (#${row.rank}): EV ${row.conservativeEv.expectedValueLowPctPerOrder.toFixed(2)}%; ${selection.symbolRationales[symbol]}`;
    }).join("\n")
    : "- Cash retained because no candidate cleared the reasoner controls.";
  const windows = evolution.windows.map((window) =>
    `| ${window.id} | ${window.regime} | ${window.startDate} → ${window.endDate} | ${formatUsd(window.baseline.totalPnlUsd)} | ${formatUsd(window.treatment.totalPnlUsd)} | ${window.treatment.maxDrawdownPct.toFixed(2)}% |`
  ).join("\n");
  const gates = Object.entries(evolution.gates).map(([key, passed]) =>
    `- ${passed ? "PASS" : "FAIL"} — ${key}`
  ).join("\n");
  const stats = evolution.statisticalEvidence;
  const calibration = outcomes.decisionCalibration;
  const coverage = outcomes.labelCoverage;
  const entryLearning = outcomes.entryDistanceLearning;
  const decisionAuditRows = outcomes.outcomes.flatMap((outcome) => {
    const review = latestOutcomeDecisionReview(outcome);
    if (
      !review
      || (!review.logicErrorCandidate && !review.marketContext.materialMove)
    ) return [];
    const horizonKey = String(review.horizonSessions) as "1" | "5" | "10" | "20";
    const horizon = outcome.horizons[horizonKey];
    const catalystSummary = review.catalystHypotheses.length
      ? review.catalystHypotheses.map((row) => row.kind).join(", ")
      : "none";
    return [{
      materialMove: review.marketContext.materialMove,
      logicErrorCandidate: review.logicErrorCandidate,
      row:
        `| ${outcome.sourceRunId} | ${outcome.symbol} | ${review.horizonSessions} | ${review.sourceDecision} | ${review.status} | ${formatUsd(outcome.sourceScreenPriceUsd ?? outcome.referenceCloseUsd ?? 0)} | ${formatUsd(horizon.observedCloseUsd ?? 0)} | ${horizon.closeReturnPct?.toFixed(2) ?? "n/a"}% | ${review.methodCounterfactual.returnPct.toFixed(2)}% | ${catalystSummary} |`,
    }];
  }).sort((left, right) =>
    Number(right.logicErrorCandidate) - Number(left.logicErrorCandidate)
    || Number(right.materialMove) - Number(left.materialMove)
  ).slice(0, 30).map((value) => value.row).join("\n");
  return `# Penny-stock research-only loop ${evolution.runId}

No order was submitted or simulated through a broker. No account, wallet, or money path was connected. Candidates are experiment inputs, not recommendations.

## Reasoner selection (zero to three)

${selection.rationale}

${selected}

## Walk-forward result

- Decision: ${evolution.decision.toUpperCase()}
- One major change: ${evolution.majorChange}
- Policy: ${evolution.policyVersionBefore} → ${evolution.policyVersionAfter}
- Baseline / treatment PnL: ${formatUsd(evolution.baselineAggregatePnlUsd)} / ${formatUsd(evolution.treatmentAggregatePnlUsd)}
- Baseline / treatment drawdown: ${evolution.baselineMaxDrawdownPct.toFixed(2)}% / ${evolution.treatmentMaxDrawdownPct.toFixed(2)}%
- Paired bootstrap 95% interval: ${evolution.pairedDailyReturnCi95Pct[0].toFixed(6)}% to ${evolution.pairedDailyReturnCi95Pct[1].toFixed(6)}%
- DSR probability: ${(stats.deflatedSharpe.probability * 100).toFixed(2)}%; PBO: ${(stats.pbo.probability * 100).toFixed(2)}%; placebo p=${stats.placebo.pValue.toFixed(4)}; FDR q=${stats.fdr.candidateQValue.toFixed(4)}
- 1x/2x/3x cost stress PnL: ${stats.costStress.map((row) => `${row.multiplier}x ${formatUsd(row.pnlUsd)}`).join(", ")}
- Neighborhood: ${stats.parameterNeighborhood.positiveVariants}/${stats.parameterNeighborhood.variants} positive; median ${formatUsd(stats.parameterNeighborhood.medianPnlUsd)}

| Cohort | Regime | Dates | Baseline PnL | Treatment PnL | Treatment drawdown |
| --- | --- | --- | ---: | ---: | ---: |
${windows || "| cash | n/a | n/a | $0.00 | $0.00 | 0.00% |"}

## Promotion gates

${gates}

## Outcome learning

- Matured 20-session candidate outcomes: ${outcomes.completeTwentySessionOutcomes}
- Learning target: ${outcomes.learningTarget ?? "legacy close return"}
- Selector policy: ${outcomes.selectorPolicyVersionBefore} → ${outcomes.selectorPolicyVersionAfter}
- Selector promotion: ${outcomes.promoted ? "accepted" : "rejected"}
- Evidence: ${outcomes.promotionReason}
- Label coverage: source ${coverage?.sourceCoveragePct.toFixed(1) ?? "n/a"}%; mature-eligible 20-session ${coverage?.maturityCoveragePct20.toFixed(1) ?? "n/a"}%; completeness gate ${coverage?.promotionCoverageGate ? "PASS" : "FAIL"}
- Latest decision reviews: ${calibration?.latestMaturedCandidateReviews ?? 0}; supported/challenged/mixed/inconclusive ${calibration?.supported ?? 0}/${calibration?.challenged ?? 0}/${calibration?.mixed ?? 0}/${calibration?.inconclusive ?? 0}
- Logic-error candidates: ${calibration?.logicErrorCandidates ?? 0}; material movers: ${calibration?.materialMoverReviews ?? 0}; catalyst-evidence reviews: ${calibration?.catalystEvidenceReviews ?? 0}
- Prospective entry-distance panels: ${entryLearning?.maturedPanelObservations20 ?? 0}/${entryLearning?.minimumProspectiveObservations ?? 100}; policy mutation allowed: no
- Entry variants: ${entryLearning?.variants.map((row) => `${row.entryDiscountPct}%: ${row.fills}/${row.observations} fills, posterior fill ${(row.posteriorFillProbabilityPct).toFixed(1)}%, mean/order ${row.meanReturnPctPerOrder.toFixed(2)}%, frozen holdout ${row.holdoutMeanReturnPctPerOrder?.toFixed(2) ?? "n/a"}%`).join("; ") || "no prospectively registered 20-session panels yet"}

Later price increases do not by themselves prove a rejected candidate was a mistake. The audit separately checks whether the tested standing limit would have filled and what its pessimistic counterfactual return would have been. SEC filings, corporate actions, volume shocks, and gaps are recorded as catalyst hypotheses only; temporal overlap is not causal proof.

| Source run | Symbol | Sessions | Decision | Audit | Screen price | Later close | Close return | Method return | Catalyst candidates |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
${decisionAuditRows || "| none | none | 0 | n/a | no material or logic-error review yet | $0.00 | $0.00 | n/a | n/a | none |"}

## Reflection

- Observed failure: ${reflection.observedFailure}
- Causal hypothesis: ${reflection.causalHypothesis}
- Pre-test prediction: ${reflection.preTestPrediction}
- Falsification: ${reflection.falsificationCriteria.join(" ")}
- Result: ${reflection.result}
- Retain/reject: ${reflection.decision.toUpperCase()}

Rejected generations and failed gates remain in append-only artifacts. Simulated PnL does not establish future earnings.
`;
}

function buildReflection(input: {
  runId: string;
  research: PennyStockResearchArtifact;
  evolution: ReturnType<typeof evaluatePennyPaperEvolution>;
  outcomes: PennyPaperOutcomeLearning;
  priorAsOf: string | null;
}): PennyPaperReflection {
  const failedGates = Object.entries(input.evolution.gates)
    .filter(([, passed]) => !passed)
    .map(([key]) => key);
  const positiveEv = input.research.candidates.filter((row) =>
    row.conservativeEv.positive
  );
  const eligiblePositiveEv = positiveEv.filter((row) => !row.vetoed);
  const calibration = input.outcomes.decisionCalibration;
  const outcomeFeedback = calibration?.logicErrorCandidates
    ? `${calibration.logicErrorCandidates} latest matured decision review(s) are candidate logic errors, but they remain diagnostic until the existing cohort and frozen-holdout gates pass.`
    : "No latest matured decision review currently identifies a candidate logic error.";
  const cashHypothesis = eligiblePositiveEv.length
    ? `${eligiblePositiveEv.length} non-vetoed positive-confidence-EV candidate(s) existed, but the reasoner retained cash; that decision is directly challengeable by later standing-limit counterfactuals.`
    : positiveEv.length
      ? `${positiveEv.length} positive-confidence-EV candidate(s) were blocked by hard issuer-risk vetoes; later gains would be missed outcomes, not proof that the veto logic was invalid.`
      : "All ten candidates had non-positive confidence-bound expected value after execution friction, so cash was the rule-consistent decision.";
  return {
    schemaVersion: 1,
    runId: input.runId,
    createdAt: new Date().toISOString(),
    observedFailure: input.evolution.decision === "cash"
      ? "No candidate cleared both the issuer-risk vetoes and positive confidence-bound expected value."
      : input.evolution.decision === "accepted"
        ? "The prior policy left robust forward PnL on the table."
        : `The treatment failed ${failedGates.join(", ")}.`,
    causalHypothesis: input.evolution.decision === "cash"
      ? `${cashHypothesis} ${outcomeFeedback}`
      : "A single strategy dimension may improve limit-touch payoff while execution friction, regime dependence, and selection bias explain apparent gains that fail robustness gates.",
    proposedChange: input.evolution.majorChange,
    majorChangeCount: 1,
    preTestPrediction:
      "The treatment should beat cash, the frozen baseline, simple and random benchmarks, stay positive at 3x costs, and avoid worse drawdown.",
    falsificationCriteria: [
      "Reject if any promotion gate fails.",
      "Reject if the parameter neighborhood is fragile.",
      "Reject if DSR, PBO, placebo, or FDR evidence indicates likely overfit.",
    ],
    result: input.evolution.decision === "cash"
      ? `Cash retained and strategy search skipped; policy remains version ${input.evolution.policyVersionBefore}.`
      : input.evolution.decision === "accepted"
      ? `All gates passed; policy advanced to version ${input.evolution.policyVersionAfter}.`
      : `Generation preserved as rejected; policy remains version ${input.evolution.policyVersionBefore}.`,
    decision: input.evolution.decision === "accepted" ? "retain" : "reject",
    failedGates,
    priorAsOf: input.priorAsOf,
    currentAsOf: input.research.asOf,
    newEvidenceAvailable: input.evolution.gates.newEvidenceAvailable,
    researchOnly: true,
  };
}

function latestOutcomeDecisionReview(
  outcome: PennyPaperOutcomeLearning["outcomes"][number],
) {
  for (const horizon of ["20", "10", "5", "1"] as const) {
    const review = outcome.decisionReviews?.[horizon];
    if (review) return review;
  }
  return null;
}

async function readLatestOutcomeLearning(
  runRoot: string,
  excludedRunId: string,
): Promise<PennyPaperOutcomeLearning | null> {
  const entries = await readdir(join(runRoot, "runs"), { withFileTypes: true })
    .catch(() => []);
  let latest: PennyPaperOutcomeLearning | null = null;
  for (const entry of entries.filter((row) =>
    row.isDirectory() && row.name !== excludedRunId
  )) {
    const value = await readJson(join(runRoot, "runs", entry.name, "outcomes.json"));
    if (
      !isRecord(value)
      || ![1, 2].includes(Number(value.schemaVersion))
      || value.researchOnly !== true
      || typeof value.evaluatedAt !== "string"
      || !Array.isArray(value.outcomes)
    ) continue;
    const candidate = value as unknown as PennyPaperOutcomeLearning;
    if (!latest || candidate.evaluatedAt > latest.evaluatedAt) latest = candidate;
  }
  return latest;
}

async function readOutcomeSources(
  runRoot: string,
  currentAsOf: string,
) {
  const entries = await readdir(join(runRoot, "runs"), { withFileTypes: true })
    .catch(() => []);
  const sources = [];
  const retainedEntries = entries
    .filter((row) => row.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(-250);
  for (const entry of retainedEntries) {
    const directory = join(runRoot, "runs", entry.name);
    const research = await readJson(join(directory, "research.json"));
    if (
      !isRecord(research)
      || ![1, 2].includes(Number(research.schemaVersion))
      || String(research.asOf ?? "") > currentAsOf
      || !Array.isArray(research.candidates)
    ) continue;
    const selection = await readJson(join(directory, "selection.json"));
    sources.push({
      research: research as unknown as PennyStockResearchArtifact,
      selectedSymbols: isRecord(selection) && Array.isArray(selection.selectedSymbols)
        ? selection.selectedSymbols.map(String)
        : [],
    });
  }
  return sources;
}

async function fetchOutcomeHistories(
  rawSymbols: string[],
  asOf: Date,
  existing: Record<string, PennyStockBar[]>,
) {
  const output = { ...existing };
  const symbols = [...new Set(rawSymbols.map(normalizeSymbol).filter(Boolean))]
    .filter((symbol) => !output[symbol]);
  for (let index = 0; index < symbols.length; index += 10) {
    Object.assign(output, await fetchPennyStockLongHistory({
      symbols: symbols.slice(index, index + 10),
      asOf,
      calendarDays: 2_000,
    }));
  }
  return output;
}

function runPaths(runDirectory: string) {
  return {
    researchPath: join(runDirectory, "research.json"),
    researchReportPath: join(runDirectory, "research.md"),
    selectionPath: join(runDirectory, "selection.json"),
    evolutionPath: join(runDirectory, "evolution.json"),
    reflectionPath: join(runDirectory, "reflection.json"),
    outcomesPath: join(runDirectory, "outcomes.json"),
    reportPath: join(runDirectory, "report.md"),
    manifestPath: join(runDirectory, "manifest.json"),
  };
}

function rejectionRationale(row: PennyStockResearchRow) {
  if (row.vetoed) return `Blocked: ${row.vetoReasons.join(" ")}`;
  if (row.reviewRequired) return `Quarantined: ${row.reviewReasons.join(" ")}`;
  if (!row.conservativeEv.positive) {
    return `Wilson-bound conservative EV is ${row.conservativeEv.expectedValueLowPctPerOrder.toFixed(2)}%.`;
  }
  return `Eligible but ranked behind the balanced zero-to-three basket at EV ${row.conservativeEv.expectedValueLowPctPerOrder.toFixed(2)}%.`;
}

function defaultSymbolRationale(row: PennyStockResearchRow) {
  return `No hard SEC/corporate-action veto or unresolved issuer-risk quarantine; Wilson-bound EV ${row.conservativeEv.expectedValueLowPctPerOrder.toFixed(2)}%, ${formatUsd(row.averageDailyDollarVolume90)} average daily dollar volume, p90 spread ${row.executionEvidence.p90SpreadBps?.toFixed(1) ?? "unavailable"} bps, and modeled fill ratio ${row.executionEvidence.estimatedFillRatioPct.toFixed(1)}%.`;
}

function buildBoundedReasonerRationale(
  research: PennyStockResearchArtifact,
  selectedSymbols: string[],
) {
  const selected = new Set(selectedSymbols);
  const eligiblePositive = research.candidates.filter((row) =>
    !row.vetoed
    && !row.reviewRequired
    && row.conservativeEv.positive
  );
  const disposition = research.candidates.map((row) => {
    if (selected.has(row.symbol)) {
      return `${row.symbol} selected: conservative EV ${row.conservativeEv.expectedValueLowPctPerOrder.toFixed(2)}%, p90 spread ${row.executionEvidence.p90SpreadBps?.toFixed(0) ?? "n/a"} bps, drawdown ${row.maxDrawdown90Pct.toFixed(1)}%.`;
    }
    return `${row.symbol} rejected: ${rejectionRationale(row)}`;
  }).join(" ");
  const decision = selectedSymbols.length
    ? `Selected ${selectedSymbols.join(", ")} as the zero-to-three balanced paper basket after issuer-risk quarantine, positive Wilson-bound EV, execution, drawdown, and sector-diversification controls.`
    : eligiblePositive.length
      ? "Retained cash because the eligible positive-EV set did not produce a balanced bounded basket after all controls."
      : "Retained cash because no candidate cleared both positive Wilson-bound expected value and the issuer-risk controls.";
  return `${decision} ${disposition} This is a research-only counterfactual decision, not an investment recommendation.`;
}

async function readSameDayMonitoringContext(
  runRoot: string,
  research: PennyStockResearchArtifact,
) {
  const root = join(runRoot, "monitors");
  const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
  const targetDate = newYorkDate(new Date(research.asOf));
  const symbols = new Set(research.candidates.map((row) => row.symbol));
  const artifacts: Array<Record<string, any>> = [];
  for (const directory of directories.filter((entry) => entry.isDirectory()).slice(-3)) {
    const directoryPath = join(root, directory.name);
    const files = await readdir(directoryPath).catch(() => []);
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      const value = await readJson(join(directoryPath, file));
      if (
        isRecord(value)
        && typeof value.observedAt === "string"
        && newYorkDate(new Date(value.observedAt)) === targetDate
        && Array.isArray(value.candidates)
      ) artifacts.push(value);
    }
  }
  const overlapping = artifacts.flatMap((artifact) => artifact.candidates)
    .filter((candidate) => isRecord(candidate) && symbols.has(String(candidate.symbol ?? "")));
  const alerts = artifacts.flatMap((artifact) =>
    Array.isArray(artifact.materialAlerts) ? artifact.materialAlerts.map(String) : []
  ).filter((alert) => [...symbols].some((symbol) => alert.startsWith(`${symbol}:`)));
  if (!artifacts.length) {
    return "No same-session monitor artifact was available; the after-close discovery used its fresh bounded SIP, SEC, and corporate-action fetches and recorded this coverage gap.";
  }
  return `Reviewed ${artifacts.length} same-session monitor artifact(s), including ${overlapping.length} overlapping candidate observations and ${alerts.length} overlapping material alert(s); monitor evidence remained supporting-only and could not mutate selection or policy.`;
}

function newYorkDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function defaultPolicy(): PennyPaperPolicy {
  return {
    schemaVersion: 2,
    version: 1,
    strategy: DEFAULT_PENNY_PAPER_STRATEGY,
    selectorWeights: DEFAULT_PENNY_SELECTOR_WEIGHTS,
    selectorPolicyVersion: 1,
    acceptedAt: null,
    acceptedFromRunId: null,
    lastEvidenceAsOf: null,
    researchOnly: true,
    liveTradingEnabled: false,
  };
}

async function readResearch(path: string): Promise<PennyStockResearchArtifact> {
  const value = await readJson(path);
  if (
    !isRecord(value)
    || value.schemaVersion !== 2
    || value.researchOnly !== true
    || value.liveTradingEnabled !== false
    || !Array.isArray(value.candidates)
    || typeof value.artifactHash !== "string"
  ) throw new Error("A schema-v2 penny-stock research artifact is required.");
  return value as unknown as PennyStockResearchArtifact;
}

async function readSelection(
  path: string,
  research: PennyStockResearchArtifact,
): Promise<PennyPaperSelection> {
  const value = await readJson(path);
  if (
    !isRecord(value)
    || value.schemaVersion !== 2
    || value.researchOnly !== true
    || value.liveTradingEnabled !== false
    || !Array.isArray(value.selectedSymbols)
    || value.selectedSymbols.length > 3
    || value.heldCash !== (value.selectedSymbols.length === 0)
    || value.researchArtifactHash !== research.artifactHash
  ) throw new Error("A valid zero-to-three-symbol selection review is required before evolution.");
  return value as unknown as PennyPaperSelection;
}

async function writeFailure(
  runDirectory: string,
  runId: string,
  phase: string,
  error: unknown,
  researchArtifactHash?: string,
) {
  await atomicWrite(join(runDirectory, "failure.json"), stableJson({
    schemaVersion: 1,
    runId,
    failedAt: new Date().toISOString(),
    phase,
    failureReason: error instanceof Error ? error.message : String(error),
    researchArtifactHash,
    researchOnly: true,
    liveTradingEnabled: false,
  }));
}

async function createAppendOnlyRunDirectory(runDirectory: string, runId: string) {
  try {
    await mkdir(runDirectory, { mode: 0o700 });
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST") {
      throw new Error(`Penny-stock paper run ${runId} already exists; run lineage is append-only.`);
    }
    throw error;
  }
}

async function retryReadOnlyProvider<T>(
  label: string,
  task: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} failed after ${attempts} bounded read-only attempts: ${detail}`);
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}

async function atomicWrite(path: string, content: string) {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

async function writeOnce(path: string, content: string, label: string) {
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing) throw new Error(`${label} already exists; append-only artifacts cannot be overwritten.`);
  await atomicWrite(path, content);
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeIdentifier(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(trimmed)) {
    throw new Error("runId may contain only letters, numbers, dots, underscores, and hyphens.");
  }
  return trimmed;
}

function createRunId() {
  return `penny-paper-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
}

function normalizeSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!symbol) return "";
  if (!/^[A-Z][A-Z.]{0,9}$/.test(symbol)) throw new Error(`Invalid stock symbol "${value}".`);
  return symbol;
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function formatUsd(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(1)}K`;
  if (absolute < 1) return `${sign}$${absolute.toFixed(4)}`;
  return `${sign}$${absolute.toFixed(2)}`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
