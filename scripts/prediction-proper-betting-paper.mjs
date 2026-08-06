#!/usr/bin/env node

/**
 * Append-only CLI for the prospective proper-betting paper experiment.
 *
 * Commands only read public market data and write local research artifacts.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const prediction = await import("../src/lib/services/trading/prediction-markets.ts");
const proper = await import("../src/lib/services/trading/prediction-proper-betting-paper.ts");

function stringArgument(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

function numberArgument(args, name) {
  const value = stringArgument(args, name);
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} requires a finite number.`);
  return parsed;
}

export function parseProperBettingArguments(args) {
  const command = args[0];
  if (!["init", "snapshot", "paper", "settle"].includes(command)) {
    throw new Error("Use init, snapshot, paper, or settle.");
  }
  const experimentDir = stringArgument(args, "--experiment-dir");
  if (command === "init") {
    if (!experimentDir) throw new Error("init requires --experiment-dir.");
    const paperCapitalUsd = numberArgument(args, "--paper-capital-usd");
    return {
      command,
      experimentDir,
      ...(paperCapitalUsd == null ? {} : { paperCapitalUsd }),
    };
  }
  if (command === "snapshot") {
    const marketsPath = stringArgument(args, "--markets");
    if (!experimentDir) throw new Error("snapshot requires --experiment-dir.");
    if (!marketsPath) throw new Error("snapshot requires --markets.");
    return { command, experimentDir, marketsPath };
  }
  if (command === "paper") {
    const snapshotPath = stringArgument(args, "--snapshot");
    const forecastsPath = stringArgument(args, "--forecasts");
    if (!snapshotPath) throw new Error("paper requires --snapshot.");
    if (!forecastsPath) throw new Error("paper requires --forecasts.");
    return { command, snapshotPath, forecastsPath, ...(experimentDir ? { experimentDir } : {}) };
  }
  const runPath = stringArgument(args, "--run");
  const outcomesPath = stringArgument(args, "--outcomes");
  if (!runPath) throw new Error("settle requires --run.");
  if (!outcomesPath) throw new Error("settle requires --outcomes.");
  return { command, runPath, outcomesPath, ...(experimentDir ? { experimentDir } : {}) };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function snapshotDigest(snapshot) {
  const normalized = { ...snapshot, snapshotDigest: "" };
  return createHash("sha256").update(JSON.stringify(stableValue(normalized))).digest("hex");
}

async function readJson(filePath) {
  const raw = await readFile(path.resolve(filePath), "utf8");
  return JSON.parse(raw);
}

async function writeExclusiveJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return resolved;
}

function policyForPaperCapital(paperCapitalUsd) {
  const startingCapitalUsd = paperCapitalUsd ?? proper.DEFAULT_PROPER_BETTING_POLICY.startingCapitalUsd;
  if (!(startingCapitalUsd >= 100 && startingCapitalUsd <= 100_000)) {
    throw new Error("Paper capital must be between $100 and $100,000.");
  }
  if (startingCapitalUsd === proper.DEFAULT_PROPER_BETTING_POLICY.startingCapitalUsd) {
    return proper.DEFAULT_PROPER_BETTING_POLICY;
  }
  const capitalId = String(startingCapitalUsd).replaceAll(".", "-");
  return {
    ...proper.DEFAULT_PROPER_BETTING_POLICY,
    id: `${proper.DEFAULT_PROPER_BETTING_POLICY.id}-capital-${capitalId}`,
    startingCapitalUsd,
  };
}

function preregistrationArtifact(now = new Date(), paperCapitalUsd) {
  const policy = policyForPaperCapital(paperCapitalUsd);
  return {
    type: "prediction-proper-betting-preregistration",
    version: 1,
    registeredAt: now.toISOString(),
    researchOnly: true,
    hypothesis: "Reviewed public-evidence probabilities that clear a later executable ask, the live taker fee, and a fixed edge floor will earn positive settlement PnL when sized by the Brier-score gradient.",
    nullHypothesis: "Net settlement PnL is non-positive, forecast Brier score does not beat the frozen market midpoint, or the treatment does not beat its capital-matched equal-notional control.",
    primaryOutcome: `Settlement return on the treatment arm's fixed $${policy.startingCapitalUsd.toLocaleString("en-US")} paper capital after observed taker fees.`,
    controls: [
      "capital-matched equal-notional positions on the identical signals and fills",
      "cash with zero deployed capital",
      "forecast-versus-frozen-market Brier score",
    ],
    policy,
    validation: {
      minimumSettledMarkets: policy.minimumSettledMarkets,
      minimumForwardCohorts: policy.minimumForwardCohorts,
      minimumAbsoluteTStatistic: policy.minimumAbsoluteTStatistic,
      maximumPValue: policy.maximumPValue,
      bootstrapSamples: policy.bootstrapSamples,
      placeboTrials: policy.placeboTrials,
      maximumPbo: policy.maximumPbo,
      minimumDeflatedSharpeProbability: policy.minimumDeflatedSharpeProbability,
      additionalGates: [
        "positive 99% circular-block-bootstrap lower bound",
        "Benjamini-Hochberg false-discovery control",
        "forecast-shuffle and shifted-entry placebos",
        "positive results in at least two volatility/topic regimes",
        "no regime or category above 70% of absolute PnL",
        "treatment beats equal-notional and market Brier baselines",
      ],
    },
    exclusions: [
      "sports and social-post counts in the initial reviewed cohort",
      "ambiguous or unreviewed resolution criteria",
      "markets resolving outside 2-14 days",
      "entries inside three hours of resolution",
      "one-sided books and missing live fee schedules",
    ],
    execution: {
      entry: "A later public CLOB snapshot after the mandatory execution lag.",
      depth: "At most 25% of each displayed ask level.",
      signal: "Forecast side probability minus executable ask minus live taker fee must be at least 2%.",
      mutation: "No authenticated venue mutation exists in this experiment.",
      access: "Venue access restrictions are preserved in every frozen market and make the cohort paper-only; they are never bypassed.",
    },
    claimLimit: "A passing research artifact is not a recommendation and cannot establish constant or future profit.",
  };
}

export async function initializeProperBettingExperiment(options, now = new Date()) {
  const experimentDir = path.resolve(options.experimentDir);
  const preregistrationPath = await writeExclusiveJson(
    path.join(experimentDir, "preregistration-v1.json"),
    preregistrationArtifact(now, options.paperCapitalUsd),
  );
  const selectionTemplatePath = await writeExclusiveJson(
    path.join(experimentDir, "reviewed-markets.template.json"),
    {
      type: "prediction-proper-betting-market-selection",
      cohortId: `proper-${now.toISOString().slice(0, 10).replaceAll("-", "")}-a`,
      markets: [{
        slug: "replace-with-reviewed-polymarket-slug",
        category: "replace-with-topic-category",
        eventKey: "replace-with-correlated-event-key",
        criteriaReviewed: false,
      }],
    },
  );
  return { preregistrationPath, selectionTemplatePath };
}

function validateSelection(value) {
  if (value?.type !== "prediction-proper-betting-market-selection") {
    throw new Error("The market selection has an invalid type.");
  }
  if (!/^[a-z0-9][a-z0-9-]{5,100}$/i.test(String(value.cohortId ?? ""))) {
    throw new Error("The market selection needs a stable cohortId.");
  }
  if (!Array.isArray(value.markets) || value.markets.length < 1 || value.markets.length > 25) {
    throw new Error("Select between 1 and 25 reviewed markets.");
  }
  for (const item of value.markets) {
    if (!/^[a-z0-9-]{3,200}$/.test(String(item?.slug ?? ""))) throw new Error("Every selected market needs a valid slug.");
    if (!String(item?.category ?? "").trim()) throw new Error("Every selected market needs a category.");
    if (item?.criteriaReviewed !== true) throw new Error("Every selected market requires criteriaReviewed=true.");
  }
  return value;
}

async function fetchFillMarkets(markets, fetcher = fetch) {
  const refreshed = await Promise.all(
    markets.map((entry) => prediction.fetchPredictionMarketBySlug(entry.market.slug, fetcher)),
  );
  const outcomeIds = refreshed.flatMap((market) => market.outcomes.map((outcome) => outcome.id));
  const books = await prediction.fetchPredictionOrderBooks(outcomeIds, fetcher);
  const byOutcome = new Map(books.map((book) => [book.outcomeId, book]));
  return refreshed.map((market) => ({
    market,
    books: market.outcomes.map((outcome) => byOutcome.get(outcome.id)).filter(Boolean),
  }));
}

export async function captureProperBettingSnapshot(options, fetcher = fetch, now = new Date()) {
  const experimentDir = path.resolve(options.experimentDir);
  const preregistration = await readJson(path.join(experimentDir, "preregistration-v1.json"));
  const policy = preregistration?.policy;
  if (!policy?.researchOnly || !(policy.startingCapitalUsd > 0) || !String(policy.id ?? "").trim()) {
    throw new Error("The preregistration has an invalid research-only paper policy.");
  }
  const selection = validateSelection(await readJson(options.marketsPath));
  const selected = await Promise.all(selection.markets.map(async (item) => ({
    item,
    market: await prediction.fetchPredictionMarketBySlug(item.slug, fetcher),
  })));
  const outcomeIds = selected.flatMap(({ market }) => market.outcomes.map((outcome) => outcome.id));
  const books = await prediction.fetchPredictionOrderBooks(outcomeIds, fetcher);
  const byOutcome = new Map(books.map((book) => [book.outcomeId, book]));
  const observedAt = now.toISOString();
  const provisional = proper.createProperBettingSnapshot({
    cohortId: selection.cohortId,
    snapshotDigest: "pending",
    observedAt,
    policy,
    candidates: selected.map(({ item, market }) => ({
      market,
      books: market.outcomes.map((outcome) => byOutcome.get(outcome.id)).filter(Boolean),
      category: item.category,
      eventKey: item.eventKey,
      criteriaReviewed: item.criteriaReviewed,
    })),
  });
  const snapshot = { ...provisional, snapshotDigest: snapshotDigest(provisional) };
  const snapshotPath = await writeExclusiveJson(
    path.join(experimentDir, "snapshots", `${snapshot.cohortId}.json`),
    snapshot,
  );
  const forecastTemplatePath = await writeExclusiveJson(
    path.join(experimentDir, "forecasts", `${snapshot.cohortId}.template.json`),
    {
      type: "prediction-proper-betting-forecasts",
      cohortId: snapshot.cohortId,
      snapshotDigest: snapshot.snapshotDigest,
      createdAt: null,
      forecaster: null,
      forecasts: snapshot.markets.map(({ market }) => ({
        marketId: market.id,
        slug: market.slug,
        title: market.title,
        yesProbability: null,
        rationale: null,
        sources: [],
        criteriaReviewed: false,
      })),
    },
  );
  return { snapshotPath, forecastTemplatePath, snapshot };
}

export async function runProperBettingPaper(options, fetcher = fetch, now = new Date()) {
  const snapshot = await readJson(options.snapshotPath);
  const actualDigest = snapshotDigest(snapshot);
  if (snapshot.snapshotDigest !== actualDigest) throw new Error("Snapshot digest verification failed.");
  const forecasts = await readJson(options.forecastsPath);
  const fillMarkets = await fetchFillMarkets(snapshot.markets, fetcher);
  const fillObservedAt = now.toISOString();
  const run = proper.simulateProperBettingCohort({ snapshot, forecasts, fillMarkets, fillObservedAt });
  const experimentDir = path.resolve(options.experimentDir ?? path.dirname(path.dirname(options.snapshotPath)));
  const runPath = await writeExclusiveJson(path.join(experimentDir, "runs", `${run.runId}.json`), run);
  return { runPath, run };
}

export async function settleProperBettingPaper(options) {
  const run = await readJson(options.runPath);
  const outcomeArtifact = await readJson(options.outcomesPath);
  if (!Array.isArray(outcomeArtifact?.outcomes)) throw new Error("The outcomes artifact needs an outcomes array.");
  const outcomes = new Map(outcomeArtifact.outcomes.map((item) => {
    const outcome = String(item?.outcome ?? "").toLowerCase();
    if (outcome !== "yes" && outcome !== "no") throw new Error("Every outcome must be yes or no.");
    return [String(item.marketId), outcome];
  }));
  const settlement = proper.settleProperBettingCohort(run, outcomes);
  const experimentDir = path.resolve(options.experimentDir ?? path.dirname(path.dirname(options.runPath)));
  const settlementPath = await writeExclusiveJson(
    path.join(experimentDir, "settlements", `${settlement.runId}.json`),
    settlement,
  );
  return { settlementPath, settlement };
}

export async function runProperBettingCommand(options) {
  if (options.command === "init") return initializeProperBettingExperiment(options);
  if (options.command === "snapshot") return captureProperBettingSnapshot(options);
  if (options.command === "paper") return runProperBettingPaper(options);
  return settleProperBettingPaper(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProperBettingCommand(parseProperBettingArguments(process.argv.slice(2))).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
