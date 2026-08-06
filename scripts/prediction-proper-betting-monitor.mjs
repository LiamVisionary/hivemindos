#!/usr/bin/env node

/**
 * Public-resolution monitor for append-only proper-betting paper cohorts.
 *
 * It reads public Gamma market state, writes immutable local outcome,
 * settlement, and aggregate scorecard artifacts, and has no order path.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const prediction = await import("../src/lib/services/trading/prediction-markets.ts");
const proper = await import("../src/lib/services/trading/prediction-proper-betting-paper.ts");
const monitor = await import("../src/lib/services/trading/prediction-proper-betting-monitor.ts");

function argumentValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1]?.trim();
    if (!value) throw new Error(`${name} requires a value.`);
    values.push(value);
  }
  return values;
}

export function parseProperBettingMonitorArguments(args) {
  const experimentDirs = argumentValues(args, "--experiment-dir");
  const includedDirs = argumentValues(args, "--include-experiment-dir");
  if (experimentDirs.length !== 1) {
    throw new Error("Monitor requires exactly one primary --experiment-dir.");
  }
  return {
    experimentDir: experimentDirs[0],
    includeExperimentDirs: includedDirs,
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function jsonFiles(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function typedArtifacts(root, directory, type) {
  const artifacts = [];
  for (const filePath of await jsonFiles(path.join(root, directory))) {
    const value = await readJson(filePath);
    if (value?.type === type) artifacts.push({ root, filePath, value });
  }
  return artifacts;
}

async function writeExclusiveJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return filePath;
}

function artifactName(value) {
  const normalized = String(value);
  if (/^[a-zA-Z0-9._-]{1,180}$/.test(normalized)) return normalized;
  return createHash("sha256").update(normalized).digest("hex");
}

function midpoint(book) {
  if (book?.midpoint != null && book.midpoint > 0 && book.midpoint < 1) return book.midpoint;
  const bid = book?.bids?.[0]?.price;
  const ask = book?.asks?.[0]?.price;
  return bid != null && ask != null ? (bid + ask) / 2 : null;
}

function yesMidpoint(snapshotMarket) {
  const yes = snapshotMarket.market.outcomes.find(
    (outcome) => outcome.label.trim().toLowerCase() === "yes",
  );
  return midpoint(snapshotMarket.books.find((book) => book.outcomeId === yes?.id));
}

function forecastEvaluations(runs, snapshots, forecasts) {
  const rows = [];
  for (const { value: run } of runs) {
    const snapshot = snapshots.find(({ value }) => (
      value.cohortId === run.cohortId && value.snapshotDigest === run.snapshotDigest
    ))?.value;
    const forecastSet = forecasts.find(({ value }) => (
      value.cohortId === run.cohortId && value.snapshotDigest === run.snapshotDigest
    ))?.value;
    if (!snapshot || !forecastSet) continue;
    const forecastByMarket = new Map(
      forecastSet.forecasts.map((forecast) => [forecast.marketId, forecast]),
    );
    for (const entry of snapshot.markets) {
      const forecast = forecastByMarket.get(entry.market.id);
      const marketYesMidpoint = yesMidpoint(entry);
      if (!forecast || marketYesMidpoint == null) continue;
      rows.push({
        runId: run.runId,
        marketId: entry.market.id,
        eventKey: entry.eventKey,
        forecastYesProbability: forecast.yesProbability,
        marketYesMidpoint,
      });
    }
  }
  return rows;
}

async function loadOutcomeArtifacts(roots) {
  const rows = [];
  for (const root of roots) {
    for (const filePath of await jsonFiles(path.join(root, "outcomes"))) {
      const value = await readJson(filePath);
      if (value?.type === "prediction-proper-betting-outcome") rows.push(value);
      if (Array.isArray(value?.outcomes)) {
        rows.push(...value.outcomes.map((outcome) => ({
          marketId: String(outcome.marketId),
          outcome: String(outcome.outcome).toLowerCase(),
          observedAt: value.observedAt ?? value.createdAt ?? new Date(0).toISOString(),
        })));
      }
    }
  }
  return rows.filter((row) => row.outcome === "yes" || row.outcome === "no");
}

export async function monitorProperBettingExperiments(options, fetcher = fetch, now = new Date()) {
  const primaryRoot = path.resolve(options.experimentDir);
  await readJson(path.join(primaryRoot, "preregistration-v1.json"));
  const eventClusterArtifact = await readOptionalJson(
    path.join(primaryRoot, "event-cluster-aliases.json"),
  );
  const eventClusterAliases = eventClusterArtifact?.type === "prediction-proper-betting-event-cluster-aliases"
    && eventClusterArtifact.aliases
    && typeof eventClusterArtifact.aliases === "object"
    ? eventClusterArtifact.aliases
    : {};
  const roots = [...new Set([
    primaryRoot,
    ...(options.includeExperimentDirs ?? []).map((root) => path.resolve(root)),
  ])];
  const snapshots = (await Promise.all(roots.map((root) => typedArtifacts(
    root,
    "snapshots",
    "prediction-proper-betting-snapshot",
  )))).flat();
  const forecastArtifacts = (await Promise.all(roots.map((root) => typedArtifacts(
    root,
    "forecasts",
    "prediction-proper-betting-forecasts",
  )))).flat();
  const forecasts = forecastArtifacts.filter(({ value }) => (
    typeof value.createdAt === "string"
    && value.createdAt.length > 0
    && typeof value.forecaster === "string"
    && value.forecaster.length > 0
  ));
  const runs = (await Promise.all(roots.map((root) => typedArtifacts(
    root,
    "runs",
    "prediction-proper-betting-paper-run",
  )))).flat();
  const existingOutcomes = await loadOutcomeArtifacts(roots);
  const outcomeByMarket = new Map(existingOutcomes.map((outcome) => [outcome.marketId, outcome]));
  const marketById = new Map(snapshots.flatMap(({ value: snapshot }) => (
    snapshot.markets.map((entry) => [entry.market.id, entry.market])
  )));
  const observedAt = now.toISOString();
  const publicChecks = [];
  for (const [marketId, frozenMarket] of marketById) {
    if (outcomeByMarket.has(marketId)) continue;
    try {
      const refreshed = await prediction.fetchPredictionMarketBySlug(frozenMarket.slug, fetcher);
      if (refreshed.id !== marketId) {
        publicChecks.push({ marketId, status: "error", reason: "Public slug returned a different market id." });
        continue;
      }
      const outcome = monitor.deriveResolvedPredictionOutcome(refreshed, observedAt);
      if (!outcome) {
        publicChecks.push({ marketId, status: "open" });
        continue;
      }
      const outcomePath = path.join(
        primaryRoot,
        "outcomes",
        `${artifactName(marketId)}.json`,
      );
      await writeExclusiveJson(outcomePath, outcome);
      outcomeByMarket.set(marketId, outcome);
      publicChecks.push({ marketId, status: "resolved", outcome: outcome.outcome, outcomePath });
    } catch (error) {
      publicChecks.push({
        marketId,
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const settlementPaths = [];
  const outcomeMap = new Map([...outcomeByMarket].map(([marketId, value]) => [marketId, value.outcome]));
  for (const { value: run } of runs) {
    const required = new Set(run.signals.map((signal) => signal.marketId));
    if (required.size === 0 || [...required].some((marketId) => !outcomeMap.has(marketId))) continue;
    const settlementPath = path.join(
      primaryRoot,
      "settlements",
      `${artifactName(run.runId)}.json`,
    );
    try {
      const settlement = proper.settleProperBettingCohort(run, outcomeMap);
      await writeExclusiveJson(settlementPath, settlement);
      settlementPaths.push(settlementPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }

  const scorecard = monitor.buildProperBettingScorecard({
    runs: runs.map(({ value }) => value),
    outcomes: [...outcomeByMarket.values()],
    forecastEvaluations: forecastEvaluations(runs, snapshots, forecasts),
    observedAt,
    eventClusterAliases,
  });
  const scorecardPath = await writeExclusiveJson(
    path.join(
      primaryRoot,
      "scorecards",
      `scorecard-${observedAt.replace(/[-:.TZ]/g, "")}.json`,
    ),
    scorecard,
  );
  return {
    researchOnly: true,
    ordersSubmitted: 0,
    roots,
    snapshots: snapshots.length,
    forecasts: forecasts.length,
    runs: runs.length,
    publicChecks,
    settlementPaths,
    scorecardPath,
    scorecard,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  monitorProperBettingExperiments(
    parseProperBettingMonitorArguments(process.argv.slice(2)),
  ).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
