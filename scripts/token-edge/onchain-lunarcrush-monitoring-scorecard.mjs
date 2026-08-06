import path from "node:path";
import { pathToFileURL } from "node:url";
import { readLedger, verifyLedger } from "./onchain-forward-core.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";
import { LUNARCRUSH_SOLANA_MONITORING_RULE } from "./onchain-lunarcrush-provider.mjs";

const HOUR_MS = 60 * 60_000;
const TRANSITION_MIN_MS = 45 * 60_000;
const TRANSITION_MAX_MS = 90 * 60_000;

export const LUNARCRUSH_PROVIDER_PRICE_INTEGRITY_RULE = Object.freeze({
  version: "lunarcrush-provider-price-integrity-v1",
  maximumImpliedSupplyChangeFactorInclusive: 2,
  purpose: "Reject provider-price transitions whose price/market-cap pair implies an implausible hourly token-supply discontinuity.",
});

export const LUNARCRUSH_MONITORING_SCREENS = Object.freeze([
  { id: "alt-rank-improvement-1000", test: (row) => row.altRankImprovement >= 1_000 },
  { id: "galaxy-improvement-10", test: (row) => row.galaxyScoreImprovement >= 10 },
  { id: "social-post-breadth-50", test: (row) => row.socialVolume24h >= 50 },
  {
    id: "interaction-depth-100-per-post",
    test: (row) => row.interactions24h / Math.max(1, row.socialVolume24h) >= 100,
  },
  {
    id: "dual-rank-galaxy-improvement",
    test: (row) => row.altRankImprovement >= 500 && row.galaxyScoreImprovement >= 5,
  },
  {
    id: "social-improvement-price-lag",
    test: (row) => row.altRankImprovement >= 500
      && row.galaxyScoreImprovement >= 5
      && row.priceChange1hPct >= -10
      && row.priceChange1hPct < 5,
  },
  {
    id: "high-breadth-dual-improvement",
    test: (row) => row.interactions24h >= 500
      && row.socialVolume24h >= 10
      && row.altRankImprovement >= 500
      && row.galaxyScoreImprovement >= 5,
  },
  {
    id: "active-contributor-acceleration",
    test: (row) => row.historyFeatures?.contributorsActiveZ >= 0.5,
  },
  {
    id: "interaction-post-creator-breakout",
    test: (row) => row.historyFeatures?.accelerationSignalCount >= 2,
  },
  {
    id: "distributed-creator-attention",
    test: (row) => row.creatorFeatures?.creatorCount >= 10
      && row.creatorFeatures?.interactions24h >= 500
      && row.creatorFeatures?.topCreatorInteractionShare <= 0.35
      && row.creatorFeatures?.creatorInteractionHhi <= 0.2,
  },
  {
    id: "concentrated-creator-attention",
    test: (row) => row.creatorFeatures?.creatorCount >= 3
      && row.creatorFeatures?.interactions24h >= 500
      && row.creatorFeatures?.topCreatorInteractionShare >= 0.5,
  },
  {
    id: "mid-tail-creator-swarm",
    test: (row) => row.creatorFeatures?.creatorCount >= 10
      && row.creatorFeatures?.interactions24h >= 500
      && row.creatorFeatures?.medianCreatorFollowers >= 500
      && row.creatorFeatures?.medianCreatorFollowers <= 100_000
      && row.creatorFeatures?.topCreatorInteractionShare <= 0.5,
  },
  {
    id: "creator-interaction-depth-500",
    test: (row) => row.creatorFeatures?.interactions24h
      / Math.max(1, row.creatorFeatures?.creatorCount) >= 500,
  },
  {
    id: "creator-breadth-acceleration",
    test: (row) => row.creatorFeatureDelta?.creatorCount >= 5
      && row.creatorFeatureDelta?.interactions24h >= 500,
  },
  {
    id: "creator-concentration-diffusion",
    test: (row) => row.creatorFeatures?.interactions24h >= 500
      && row.creatorFeatureDelta?.creatorCount >= 0
      && row.creatorFeatureDelta?.topCreatorInteractionShare <= -0.1,
  },
]);

export function buildLunarCrushMonitoringScorecard(events) {
  const historiesByDiscovery = linkedHistories(events);
  const creatorsByDiscovery = linkedCreatorAggregates(events);
  const discoveries = events.filter((event) => (
    event.type === "discovery"
    && event.provider === "lunarcrush-coin-list"
    && event.monitoringPanel?.ruleVersion === LUNARCRUSH_SOLANA_MONITORING_RULE.version
    && sameJson(event.monitoringPanel?.rule, LUNARCRUSH_SOLANA_MONITORING_RULE)
    && event.monitoringPanel?.researchOnly === true
    && event.monitoringPanel?.mutationAllowed === false
    && Date.parse(event.observedAt) > Date.parse(LUNARCRUSH_SOLANA_MONITORING_RULE.evidenceBoundary)
  )).sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  const frames = [];
  let providerPriceIntegrityRejectedObservations = 0;
  for (let index = 0; index < discoveries.length - 1; index += 1) {
    const source = discoveries[index];
    const target = discoveries[index + 1];
    const elapsedMs = Date.parse(target.observedAt) - Date.parse(source.observedAt);
    if (elapsedMs < TRANSITION_MIN_MS || elapsedMs > TRANSITION_MAX_MS) continue;
    const targetByToken = candidatePriceMap(target);
    const histories = historiesByDiscovery.get(source.id) ?? new Map();
    const creators = creatorsByDiscovery.get(source.id) ?? new Map();
    const prior = discoveries[index - 1];
    const priorIsAdjacent = prior
      && Date.parse(source.observedAt) - Date.parse(prior.observedAt) >= TRANSITION_MIN_MS
      && Date.parse(source.observedAt) - Date.parse(prior.observedAt) <= TRANSITION_MAX_MS;
    const priorCreators = priorIsAdjacent
      ? creatorsByDiscovery.get(prior.id) ?? new Map()
      : new Map();
    const observations = source.monitoringPanel.candidates.flatMap((candidate) => {
      const targetCandidate = targetByToken.get(exactText(candidate.tokenAddress));
      if (!(candidate.priceUsd > 0) || !(targetCandidate?.priceUsd > 0)) return [];
      const impliedSupplyChangeFactor = impliedSupplyChange(candidate, targetCandidate);
      if (!(impliedSupplyChangeFactor <= LUNARCRUSH_PROVIDER_PRICE_INTEGRITY_RULE
        .maximumImpliedSupplyChangeFactorInclusive)) {
        providerPriceIntegrityRejectedObservations += 1;
        return [];
      }
      const creatorFeatures = creators.get(exactText(candidate.tokenAddress)) ?? null;
      return [{
        ...candidate,
        sourceDiscoveryEventId: source.id,
        targetDiscoveryEventId: target.id,
        sourceObservedAt: source.observedAt,
        targetObservedAt: target.observedAt,
        elapsedHours: round(elapsedMs / HOUR_MS, 6),
        nextReturnPct: round(((targetCandidate.priceUsd / candidate.priceUsd) - 1) * 100, 6),
        impliedSupplyChangeFactor: round(impliedSupplyChangeFactor, 6),
        historyFeatures: histories.get(exactText(candidate.tokenAddress)) ?? null,
        creatorFeatures,
        creatorFeatureDelta: creatorDelta(
          creatorFeatures,
          priorCreators.get(exactText(candidate.tokenAddress)) ?? null,
        ),
      }];
    });
    frames.push({
      sourceDiscoveryEventId: source.id,
      targetDiscoveryEventId: target.id,
      sourceObservedAt: source.observedAt,
      targetObservedAt: target.observedAt,
      elapsedHours: round(elapsedMs / HOUR_MS, 6),
      observations,
    });
  }
  const observations = frames.flatMap((frame) => frame.observations);
  return {
    type: "lunarcrush-solana-monitoring-scorecard",
    ruleVersion: LUNARCRUSH_SOLANA_MONITORING_RULE.version,
    evidenceBoundary: LUNARCRUSH_SOLANA_MONITORING_RULE.evidenceBoundary,
    researchOnly: true,
    mutationAllowed: false,
    providerPriceIsNotExecutionEvidence: true,
    providerPriceIntegrityRule: LUNARCRUSH_PROVIDER_PRICE_INTEGRITY_RULE,
    providerPriceIntegrityRejectedObservations,
    discoveryEvents: discoveries.length,
    independentHourlyFrames: frames.length,
    observations: observations.length,
    uniqueTokens: new Set(observations.map((row) => exactText(row.tokenAddress))).size,
    historyFeatureObservations: observations.filter((row) => row.historyFeatures).length,
    creatorFeatureObservations: observations.filter((row) => row.creatorFeatures).length,
    creatorDeltaObservations: observations.filter((row) => row.creatorFeatureDelta).length,
    allCandidates: summarizeFrames(frames, () => true),
    screens: LUNARCRUSH_MONITORING_SCREENS.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, screen.test),
    })),
    chronologicalHalves: chronologicalHalves(frames),
    note: "This panel generates future hypotheses only. Provider price is not a fill, and no screen can authorize or mutate a challenger.",
  };
}

function impliedSupplyChange(source, target) {
  if (!(source?.priceUsd > 0) || !(source?.marketCapUsd > 0)
    || !(target?.priceUsd > 0) || !(target?.marketCapUsd > 0)) return null;
  const sourceImpliedSupply = source.marketCapUsd / source.priceUsd;
  const targetImpliedSupply = target.marketCapUsd / target.priceUsd;
  if (!(sourceImpliedSupply > 0) || !(targetImpliedSupply > 0)) return null;
  const ratio = targetImpliedSupply / sourceImpliedSupply;
  return ratio >= 1 ? ratio : 1 / ratio;
}

function creatorDelta(current, prior) {
  if (!current || !prior) return null;
  const fields = [
    "creatorCount", "interactions24h", "topCreatorInteractionShare", "creatorInteractionHhi",
  ];
  if (fields.some((field) => !Number.isFinite(current[field]) || !Number.isFinite(prior[field]))) {
    return null;
  }
  return Object.fromEntries(fields.map((field) => [field, round(current[field] - prior[field], 6)]));
}

function linkedCreatorAggregates(events) {
  const result = new Map();
  for (const event of events) {
    if (event.type !== "lunarcrush-creator-aggregate"
      || event.status !== "ready"
      || event.aggregateOnly !== true
      || event.rawCreatorIdentitiesRetained !== false
      || !event.sourceDiscoveryEventId
      || !event.creatorMetrics) continue;
    const byToken = result.get(event.sourceDiscoveryEventId) ?? new Map();
    byToken.set(exactText(event.tokenAddress), event.creatorMetrics);
    result.set(event.sourceDiscoveryEventId, byToken);
  }
  return result;
}

function linkedHistories(events) {
  const result = new Map();
  for (const event of events) {
    if (event.type !== "lunarcrush-social-snapshot"
      || event.status !== "ready"
      || !event.sourceDiscoveryEventId
      || !event.socialFeatures) continue;
    const byToken = result.get(event.sourceDiscoveryEventId) ?? new Map();
    byToken.set(exactText(event.tokenAddress), event.socialFeatures);
    result.set(event.sourceDiscoveryEventId, byToken);
  }
  return result;
}

function candidatePriceMap(discovery) {
  const result = new Map();
  for (const candidate of [
    ...(discovery.monitoringPanel?.candidates ?? []),
    ...(discovery.candidates ?? []),
  ]) {
    const key = exactText(candidate.tokenAddress);
    if (!result.has(key) || candidate.priceUsd > 0) result.set(key, candidate);
  }
  return result;
}

function summarizeFrames(frames, test) {
  const selectedFrames = frames.map((frame) => frame.observations.filter(test)).filter((rows) => rows.length);
  const selected = selectedFrames.flat();
  const frameMeans = selectedFrames.map((rows) => mean(rows.map((row) => row.nextReturnPct)));
  return {
    observations: selected.length,
    independentFrames: selectedFrames.length,
    uniqueTokens: new Set(selected.map((row) => exactText(row.tokenAddress))).size,
    riseRate: nullableRound(selected.length
      ? selected.filter((row) => row.nextReturnPct > 0).length / selected.length
      : null, 6),
    explosion25Rate: nullableRound(selected.length
      ? selected.filter((row) => row.nextReturnPct >= 25).length / selected.length
      : null, 6),
    averageEqualWeightFrameReturnPct: nullableRound(mean(frameMeans), 6),
    fourPercentCostProxyPct: nullableRound(mean(frameMeans) == null ? null : mean(frameMeans) - 4, 6),
    twelvePercentCostProxyPct: nullableRound(mean(frameMeans) == null ? null : mean(frameMeans) - 12, 6),
  };
}

function chronologicalHalves(frames) {
  if (frames.length < 4) return { status: "insufficient-frames", first: null, second: null };
  const midpoint = Math.floor(frames.length / 2);
  return {
    status: "available",
    first: summarizeFrames(frames.slice(0, midpoint), () => true),
    second: summarizeFrames(frames.slice(midpoint), () => true),
  };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function nullableRound(value, decimals) {
  return Number.isFinite(value) ? round(value, decimals) : null;
}

function round(value, decimals) {
  return Number(Number(value).toFixed(decimals));
}

function exactText(value) {
  return String(value ?? "").trim();
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const ledgerIndex = process.argv.indexOf("--ledger");
  const ledgerPath = path.resolve(
    ledgerIndex >= 0 && process.argv[ledgerIndex + 1]
      ? process.argv[ledgerIndex + 1]
      : defaultTokenEdgeLedgerPath(),
  );
  readLedger(ledgerPath).then((events) => {
    const verification = verifyLedger(events);
    if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
    process.stdout.write(`${JSON.stringify({
      ledgerPath,
      verification,
      scorecard: buildLunarCrushMonitoringScorecard(events),
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
