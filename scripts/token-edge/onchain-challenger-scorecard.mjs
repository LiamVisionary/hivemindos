import { createHash } from "node:crypto";
import {
  deriveLunarCrushMoveAlertFeatures,
  LUNARCRUSH_MAX_EVIDENCE_AVAILABILITY_LAG_MS,
  LUNARCRUSH_SOLANA_DISCOVERY_RULE,
  satisfiesLunarCrushSolanaDiscoveryRule,
} from "./onchain-lunarcrush-provider.mjs";
import {
  DEX_EARLY_SURFACE_RULE,
  satisfiesDexEarlySurfaceRule,
} from "./onchain-dex-early-rule.mjs";
import { independentAssetFrames, tokenEdgeAssetKey } from "./onchain-independent-frames.mjs";
import { exactLiveOutcomeTimingReason } from "./onchain-outcome-timing.mjs";

export function buildChallengerComparisons(options) {
  const {
    challengers,
    forecasts,
    observedByForecast,
    scorecardRows,
    durations,
    roundTripCostPct,
    minimumObservations,
    minimumUniqueTokens,
    bootstrapIterations,
    bootstrapMeanInterval,
  } = options;
  const forecastValues = [...forecasts.values()];
  const eventById = new Map((options.events ?? []).map((event) => [event.id, event]));
  return challengers.map((challenger) => {
    const registration = findChallengerRegistration(challenger, options.events ?? []);
    const baselineBySnapshot = new Map(forecastValues
      .filter((forecast) => (
        forecast.modelVersion === challenger.parentModelVersion
        && forecast.candidateId === challenger.parentCandidateId
        && forecast.horizon === challenger.horizon
      ))
      .map((forecast) => [forecast.snapshotId, forecast]));
    const candidateForecasts = forecastValues.filter((forecast) => (
      isChallengerCandidateForecast(forecast, challenger)
    ));
    const eligibleForecasts = candidateForecasts.filter((forecast) => {
      const baselineForecast = baselineBySnapshot.get(forecast.snapshotId);
      return hasExactProspectiveLineage(forecast, challenger, registration, eventById)
        && hasExactFrozenDecision(forecast, challenger, baselineForecast, eventById);
    });
    const incrementalCoverageOnly = challenger.changedDimension === "removeMaximumDexPairAge";
    const outcomePairs = eligibleForecasts
      .map((challengerForecast) => ({
        challengerForecast,
        baselineForecast: baselineBySnapshot.get(challengerForecast.snapshotId),
      }))
      .map((pair) => ({
        ...pair,
        challengerOutcome: observedByForecast.get(pair.challengerForecast.id),
        baselineOutcome: pair.baselineForecast
          ? observedByForecast.get(pair.baselineForecast.id)
          : null,
      }))
      .filter((pair) => {
        if (!pair.baselineForecast || pair.challengerOutcome?.status !== "observed") return false;
        if (incrementalCoverageOnly) {
          return isRemovedBlockerOnlyBaseline(pair.baselineForecast, challenger);
        }
        return pair.baselineOutcome?.status === "observed";
      })
      .map((pair) => (incrementalCoverageOnly
        ? { ...pair, baselineOutcome: pair.challengerOutcome }
        : pair));
    const horizonDriftedOutcomePairs = outcomePairs.filter((pair) => (
      exactLiveOutcomeTimingReason(pair.challengerOutcome)
      || exactLiveOutcomeTimingReason(pair.baselineOutcome)
    )).length;
    const pairs = outcomePairs.filter((pair) => (
      !exactLiveOutcomeTimingReason(pair.challengerOutcome)
      && !exactLiveOutcomeTimingReason(pair.baselineOutcome)
    ));
    const frameData = independentPairedPolicyFrames(
      pairs,
      durations[challenger.horizon].durationMs,
      roundTripCostPct,
    );
    const frames = frameData.frames;
    const deltas = frames.map((frame) => frame.challengerReturnPct - frame.baselineReturnPct);
    const deltaCi95 = deltas.length >= 2
      ? bootstrapMeanInterval(deltas, bootstrapIterations)
      : [null, null];
    const challengerRow = scorecardRows.find((row) => (
      row.modelVersion === challenger.modelVersion
      && row.candidateId === challenger.candidateId
      && row.horizon === challenger.horizon
    ));
    const uniqueTokens = new Set(pairs.map(({ challengerForecast }) => (
      assetKey(challengerForecast)
    ))).size;
    const outcomeMismatchCount = pairs.filter(({ challengerOutcome, baselineOutcome }) => (
      Math.abs(challengerOutcome.grossReturnPct - baselineOutcome.grossReturnPct) > 0.000001
    )).length;
    const evidenceReady = pairs.length >= minimumObservations
      && frames.length >= minimumObservations
      && uniqueTokens >= minimumUniqueTokens;
    return {
      challengerModelVersion: challenger.modelVersion,
      challengerCandidateId: challenger.candidateId,
      parentModelVersion: challenger.parentModelVersion,
      parentCandidateId: challenger.parentCandidateId,
      horizon: challenger.horizon,
      changedDimension: challenger.changedDimension,
      comparisonPopulation: incrementalCoverageOnly
        ? "incremental-coverage-only"
        : "same-snapshot-paired",
      unchangedPopulationForecastsExcluded: incrementalCoverageOnly
        ? eligibleForecasts.filter((forecast) => !isRemovedBlockerOnlyBaseline(
          baselineBySnapshot.get(forecast.snapshotId),
          challenger,
        )).length
        : 0,
      evidenceBoundary: challenger.evidenceBoundary,
      posthocDerived: challenger.posthocDerived,
      challengerRegistrationId: registration?.id ?? null,
      challengerRegisteredAt: registration?.registeredAt ?? null,
      lineageRejectedForecasts: candidateForecasts.length - eligibleForecasts.length,
      horizonDriftedOutcomePairs,
      matchedForecasts: pairs.length,
      pairedWeightedUniqueAssetOpportunities: frameData.weightedPairs,
      sameAssetOverlappingPairs: pairs.length - frameData.weightedPairs,
      independentPairedFrames: frames.length,
      uniqueTokens,
      outcomeMismatchCount,
      baselineAverageNetReturnPct: nullableRound(mean(frames, "baselineReturnPct"), 6),
      challengerAverageNetReturnPct: nullableRound(mean(frames, "challengerReturnPct"), 6),
      averagePairedDeltaPct: nullableRound(mean(deltas), 6),
      pairedBootstrapMeanDeltaCi95Pct: deltaCi95.map((value) => nullableRound(value, 6)),
      evidenceStatus: evidenceReady ? "eligible-for-frozen-audit" : "collecting",
      evidenceShortfall: {
        matchedForecasts: Math.max(0, minimumObservations - pairs.length),
        independentPairedFrames: Math.max(0, minimumObservations - frames.length),
        uniqueTokens: Math.max(0, minimumUniqueTokens - uniqueTokens),
      },
      provisionalPairedGate: Boolean(
        evidenceReady
        && outcomeMismatchCount === 0
        && deltaCi95[0] > 0
        && challengerRow?.provisionalPromotionGate
      ),
    };
  });
}

export function rejectedChallengerForecastIds(events, challengers) {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const forecastValues = events.filter((event) => event.type === "forecast");
  const baselineByChallengerSnapshot = new Map();
  for (const challenger of challengers) {
    for (const forecast of forecastValues) {
      if (forecast.modelVersion !== challenger.parentModelVersion
        || forecast.candidateId !== challenger.parentCandidateId
        || forecast.horizon !== challenger.horizon) continue;
      baselineByChallengerSnapshot.set(
        `${challenger.modelVersion}:${forecast.snapshotId}`,
        forecast,
      );
    }
  }
  const registrations = new Map(challengers.map((challenger) => [
    challenger.modelVersion,
    findChallengerRegistration(challenger, events),
  ]));
  return new Set(events.filter((event) => {
    const challenger = challengers.find((candidate) => (
      isChallengerCandidateForecast(event, candidate)
    ));
    if (!challenger) return false;
    const baselineForecast = baselineByChallengerSnapshot.get(
      `${challenger.modelVersion}:${event.snapshotId}`,
    );
    return !hasExactProspectiveLineage(
      event,
      challenger,
      registrations.get(challenger.modelVersion),
      eventById,
    ) || !hasExactFrozenDecision(event, challenger, baselineForecast, eventById);
  }).map((event) => event.id));
}

function isChallengerCandidateForecast(forecast, challenger) {
  return forecast?.type === "forecast"
    && forecast.modelVersion === challenger.modelVersion
    && forecast.candidateId === challenger.candidateId
    && forecast.horizon === challenger.horizon
    && forecast.status === "ready"
    && Date.parse(forecast.createdAt) > Date.parse(challenger.evidenceBoundary);
}

function hasExactProspectiveLineage(forecast, challenger, registration, eventById) {
  if (!registration) return false;
  const snapshot = eventById.get(forecast.snapshotId);
  const discovery = eventById.get(forecast.selectionDiscoveryEventId);
  const confirmation = eventById.get(forecast.selectionConfirmationEventId);
  const additionalEvidence = eventById.get(forecast.additionalEvidenceEventId);
  const selection = snapshot?.selection;
  const evidence = forecast.inputEvidence;
  const boundaryMs = Date.parse(challenger.evidenceBoundary);
  const registeredAtMs = Date.parse(registration.registeredAt);
  const discoveryAtMs = Date.parse(discovery?.observedAt ?? "");
  const confirmationAtMs = Date.parse(confirmation?.observedAt ?? "");
  const forecastAtMs = Date.parse(forecast.createdAt);
  return forecast.challengerRegistrationId === registration.id
    && forecast.challengerRegisteredAt === registration.registeredAt
    && evidence?.challengerRegistrationId === registration.id
    && evidence?.challengerRegisteredAt === registration.registeredAt
    && [boundaryMs, registeredAtMs, discoveryAtMs, confirmationAtMs, forecastAtMs]
      .every(Number.isFinite)
    && registeredAtMs > boundaryMs
    && discoveryAtMs > registeredAtMs
    && confirmationAtMs > discoveryAtMs
    && forecastAtMs > confirmationAtMs
    && snapshot?.type === "snapshot"
    && snapshot.observedAt === forecast.createdAt
    && sameAsset(snapshot, forecast)
    && selection?.status === "verified"
    && selection.provider === challenger.provider
    && selection.timeframe === challenger.selectionTimeframe
    && selection.discoveryEventId === discovery?.id
    && selection.confirmationEventId === confirmation?.id
    && selection.discoveryObservedAt === discovery.observedAt
    && selection.confirmationObservedAt === confirmation.observedAt
    && forecast.selectionProvider === challenger.provider
    && forecast.selectionTimeframe === challenger.selectionTimeframe
    && discovery?.type === "discovery"
    && discovery.provider === challenger.provider
    && discovery.timeframe === challenger.selectionTimeframe
    && hasEligibleAsset(discovery, forecast, challenger)
    && confirmation?.type === "market-confirmation"
    && confirmation.sourceEventId === discovery.id
    && hasEligibleAsset(confirmation, forecast, challenger)
    && evidence?.provider === challenger.provider
    && evidence?.timeframe === challenger.selectionTimeframe
    && evidence?.discoveryEventId === discovery.id
    && evidence?.confirmationEventId === confirmation.id
    && evidence?.discoveryObservedAt === discovery.observedAt
    && evidence?.confirmationObservedAt === confirmation.observedAt
    && hasRequiredSelectionEvidence(discovery, forecast, challenger)
    && hasRequiredAdditionalEvidence(
      forecast,
      challenger,
      registration,
      additionalEvidence,
    );
}

function hasRequiredSelectionEvidence(discovery, forecast, challenger) {
  if (challenger.changedDimension === "dexEarlySurfaceRise") {
    return hasDexEarlySurfaceSelectionEvidence(discovery, forecast, challenger);
  }
  if (!challenger.lunarcrushDiscoveryRuleVersion) return true;
  const discoveryAtMs = Date.parse(discovery?.observedAt ?? "");
  const availableAtMs = Date.parse(discovery?.availableAt ?? "");
  const collectionStartedAtMs = Date.parse(discovery?.collectionStartedAt ?? "");
  const generatedAtMs = discovery?.universe?.generatedAt == null
    ? null
    : Date.parse(discovery.universe.generatedAt);
  const candidates = Array.isArray(discovery?.candidates) ? discovery.candidates : [];
  const candidate = discovery?.candidates?.find((row) => (
    row?.status === "eligible" && sameAsset(row, forecast)
  ));
  return discovery?.type === "discovery"
    && discovery?.provider === "lunarcrush-coin-list"
    && discovery?.sourceProvider === "lunarcrush"
    && discovery?.researchOnly === true
    && discovery?.mutationAllowed === false
    && [discoveryAtMs, availableAtMs, collectionStartedAtMs].every(Number.isFinite)
    && discoveryAtMs === availableAtMs
    && collectionStartedAtMs <= availableAtMs
    && (generatedAtMs == null || (
      Number.isFinite(generatedAtMs) && generatedAtMs <= availableAtMs + 60_000
    ))
    && candidates.length > 0
    && candidates.length <= LUNARCRUSH_SOLANA_DISCOVERY_RULE.maximumCandidates
    && candidates.every((row) => satisfiesLunarCrushSolanaDiscoveryRule(row))
    && hasCanonicalDiscoveryCandidateOrder(candidates)
    && discovery?.ruleVersion === challenger.lunarcrushDiscoveryRuleVersion
    && sameJson(discovery?.rule, challenger.lunarcrushDiscoveryRule)
    && discovery?.universe?.complete === true
    && candidate?.ruleVersion === challenger.lunarcrushDiscoveryRuleVersion
    && satisfiesLunarCrushSolanaDiscoveryRule(candidate)
    && forecast.lunarcrushDiscoveryRuleVersion === challenger.lunarcrushDiscoveryRuleVersion
    && forecast.inputEvidence?.lunarcrushDiscoveryRuleVersion
      === challenger.lunarcrushDiscoveryRuleVersion
    && forecast.inputEvidence?.discoveryAvailableAt === discovery.availableAt
    && sameJson(forecast.inputEvidence?.lunarcrushDiscoveryMetrics, selectionMetrics(candidate));
}

function hasDexEarlySurfaceSelectionEvidence(discovery, forecast, challenger) {
  const discoveryAtMs = Date.parse(discovery?.observedAt ?? "");
  const availableAtMs = Date.parse(discovery?.availableAt ?? "");
  const collectionStartedAtMs = Date.parse(discovery?.collectionStartedAt ?? "");
  const candidates = Array.isArray(discovery?.candidates) ? discovery.candidates : [];
  const candidate = candidates.find((row) => row?.status === "eligible" && sameAsset(row, forecast));
  return discovery?.provider === "dexscreener-early-surface"
    && discovery?.sourceAttribution === "DEX Screener public API"
    && discovery?.timeframe === "5m"
    && discovery?.researchOnly === true
    && discovery?.mutationAllowed === false
    && [discoveryAtMs, availableAtMs, collectionStartedAtMs].every(Number.isFinite)
    && discoveryAtMs === availableAtMs
    && collectionStartedAtMs <= availableAtMs
    && discovery?.ruleVersion === challenger.dexEarlySurfaceRuleVersion
    && sameJson(discovery?.rule, challenger.dexEarlySurfaceRule)
    && candidates.length > 0
    && candidates.length <= DEX_EARLY_SURFACE_RULE.maximumCandidates
    && candidates.every((row) => row?.status === "eligible" && satisfiesDexEarlySurfaceRule(row))
    && hasCanonicalDexEarlyCandidateOrder(candidates)
    && candidate != null
    && forecast.dexEarlySurfaceRuleVersion === challenger.dexEarlySurfaceRuleVersion
    && forecast.inputEvidence?.dexEarlySurfaceRuleVersion === challenger.dexEarlySurfaceRuleVersion
    && forecast.inputEvidence?.discoveryAvailableAt === discovery.availableAt
    && sameJson(forecast.inputEvidence?.dexEarlySurfaceMetrics, dexEarlySurfaceMetrics(candidate));
}

function hasCanonicalDexEarlyCandidateOrder(candidates) {
  const addresses = candidates.map((candidate) => exactText(candidate.tokenAddress));
  if (new Set(addresses).size !== addresses.length) return false;
  return candidates.every((candidate, index) => {
    if (index === 0) return true;
    const prior = candidates[index - 1];
    return prior.sourceBreadth > candidate.sourceBreadth
      || (prior.sourceBreadth === candidate.sourceBreadth
        && prior.totalBoostAmount > candidate.totalBoostAmount)
      || (prior.sourceBreadth === candidate.sourceBreadth
        && prior.totalBoostAmount === candidate.totalBoostAmount
        && prior.hourlyTurnover > candidate.hourlyTurnover)
      || (prior.sourceBreadth === candidate.sourceBreadth
        && prior.totalBoostAmount === candidate.totalBoostAmount
        && prior.hourlyTurnover === candidate.hourlyTurnover
        && prior.pairAgeMinutes < candidate.pairAgeMinutes)
      || (prior.sourceBreadth === candidate.sourceBreadth
        && prior.totalBoostAmount === candidate.totalBoostAmount
        && prior.hourlyTurnover === candidate.hourlyTurnover
        && prior.pairAgeMinutes === candidate.pairAgeMinutes
        && exactText(prior.tokenAddress).localeCompare(exactText(candidate.tokenAddress)) <= 0);
  });
}

function hasCanonicalDiscoveryCandidateOrder(candidates) {
  const addresses = candidates.map((candidate) => exactText(candidate.tokenAddress));
  if (new Set(addresses).size !== addresses.length) return false;
  return candidates.every((candidate, index) => {
    if (index === 0) return true;
    const prior = candidates[index - 1];
    return prior.altRank < candidate.altRank
      || (prior.altRank === candidate.altRank
        && prior.galaxyScoreImprovement > candidate.galaxyScoreImprovement)
      || (prior.altRank === candidate.altRank
        && prior.galaxyScoreImprovement === candidate.galaxyScoreImprovement
        && prior.interactions24h > candidate.interactions24h)
      || (prior.altRank === candidate.altRank
        && prior.galaxyScoreImprovement === candidate.galaxyScoreImprovement
        && prior.interactions24h === candidate.interactions24h
        && exactText(prior.tokenAddress).localeCompare(exactText(candidate.tokenAddress)) <= 0);
  });
}

function hasRequiredAdditionalEvidence(forecast, challenger, registration, event) {
  if (!challenger.requiredEvidenceEventType) return true;
  if (challenger.changedDimension === "lunarcrushCreatorDistributionGate") {
    return hasLunarCreatorDistributionEvidence(forecast, challenger, registration, event);
  }
  if (challenger.changedDimension === "lunarcrushDiscoveryMagnitudeGate") {
    return hasLunarDiscoveryMagnitudeEvidence(forecast, challenger, registration, event);
  }
  const eventAtMs = Date.parse(event?.observedAt ?? "");
  const availableAtMs = Date.parse(event?.availableAt ?? "");
  const forecastAtMs = Date.parse(forecast.createdAt);
  const registeredAtMs = Date.parse(registration.registeredAt);
  const boundaryMs = Date.parse(challenger.evidenceBoundary);
  const historyThroughMs = Date.parse(event?.historyThrough ?? "");
  const historyGeneratedAtMs = Date.parse(event?.historyGeneratedAt ?? "");
  const historyRows = Array.isArray(event?.historyRows) ? event.historyRows : [];
  const lastHistoryRow = historyRows.at(-1);
  const recomputedFeatures = deriveLunarCrushMoveAlertFeatures(historyRows);
  return event?.type === challenger.requiredEvidenceEventType
    && event.status === "ready"
    && event.researchOnly === true
    && event.mutationAllowed === false
    && event.ruleVersion === challenger.lunarcrushRuleVersion
    && sameJson(event.rule, challenger.lunarcrushRule)
    && event.universe?.complete === true
    && event.identity?.matchStatus === "exact-single-contract-match"
    && normalize(event.identity?.network) === normalize(forecast.chain)
    && exactText(event.identity?.contractAddress) === exactText(forecast.tokenAddress)
    && sameAsset(event, forecast)
    && [eventAtMs, availableAtMs, forecastAtMs, registeredAtMs, boundaryMs, historyThroughMs,
      historyGeneratedAtMs].every(Number.isFinite)
    && eventAtMs > registeredAtMs
    && eventAtMs > boundaryMs
    && eventAtMs <= availableAtMs
    && availableAtMs <= forecastAtMs
    && forecastAtMs - availableAtMs <= LUNARCRUSH_MAX_EVIDENCE_AVAILABILITY_LAG_MS
    && historyGeneratedAtMs <= availableAtMs + 60_000
    && historyGeneratedAtMs <= forecastAtMs
    && historyThroughMs <= eventAtMs
    && historyRows.length === (challenger.lunarcrushRule?.minimumHistoryHours ?? 24) + 1
    && historyRows.every((row, index) => (
      Number.isFinite(row?.time)
      && row.time + 3_600 <= (eventAtMs / 1_000)
      && (index === 0 || row.time - historyRows[index - 1].time === 3_600)
    ))
    && Number.isFinite(lastHistoryRow?.time)
    && historyThroughMs === (lastHistoryRow.time + 3_600) * 1_000
    && eventAtMs - historyThroughMs <= (
      (challenger.lunarcrushRule?.maximumCompletedBarStalenessHours ?? 2) * 3_600_000
    )
    && event.socialFeatures != null
    && recomputedFeatures != null
    && sameJson(event.socialFeatures, recomputedFeatures)
    && forecast.additionalEvidenceEventId === event.id
    && forecast.additionalEvidenceDigest === event.digest
    && forecast.additionalEvidenceObservedAt === event.observedAt
    && forecast.additionalEvidenceAvailableAt === event.availableAt
    && forecast.maximumAdditionalEvidenceLagMs === LUNARCRUSH_MAX_EVIDENCE_AVAILABILITY_LAG_MS
    && forecast.inputEvidence?.additionalEvidenceEventId === event.id
    && forecast.inputEvidence?.additionalEvidenceDigest === event.digest
    && forecast.inputEvidence?.additionalEvidenceObservedAt === event.observedAt
    && forecast.inputEvidence?.additionalEvidenceAvailableAt === event.availableAt
    && forecast.inputEvidence?.maximumAdditionalEvidenceLagMs
      === LUNARCRUSH_MAX_EVIDENCE_AVAILABILITY_LAG_MS
    && forecast.inputEvidence?.lunarcrushRuleVersion === challenger.lunarcrushRuleVersion
    && exactText(forecast.inputEvidence?.lunarcrushContractAddress) === exactText(forecast.tokenAddress)
    && sameJson(forecast.inputEvidence?.socialFeatures, event.socialFeatures);
}

function hasLunarCreatorDistributionEvidence(forecast, challenger, registration, event) {
  const eventAtMs = Date.parse(event?.observedAt ?? "");
  const availableAtMs = Date.parse(event?.availableAt ?? "");
  const forecastAtMs = Date.parse(forecast.createdAt);
  const registeredAtMs = Date.parse(registration.registeredAt);
  const boundaryMs = Date.parse(challenger.evidenceBoundary);
  const metrics = event?.creatorMetrics;
  return event?.type === challenger.requiredEvidenceEventType
    && event.status === "ready"
    && event.provider === "lunarcrush"
    && event.profile === "social-discovery-creator-aggregate"
    && event.sourceDiscoveryEventId === forecast.selectionDiscoveryEventId
    && event.universe?.complete === true
    && event.identity?.matchStatus === "exact-single-contract-topic-match"
    && normalize(event.identity?.network) === normalize(forecast.chain)
    && exactText(event.identity?.contractAddress) === exactText(forecast.tokenAddress)
    && event.identity?.topicUniverseCoinRowCount === 1
    && event.topicJoinStatus === "provider-coin-row-exact-contract-unique-topic"
    && sameAsset(event, forecast)
    && event.aggregateOnly === true
    && event.rawCreatorIdentitiesRetained === false
    && event.researchOnly === true
    && event.mutationAllowed === false
    && event.creatorAggregateDigest === digestValue(metrics)
    && [eventAtMs, availableAtMs, forecastAtMs, registeredAtMs, boundaryMs].every(Number.isFinite)
    && eventAtMs > registeredAtMs
    && eventAtMs > boundaryMs
    && eventAtMs <= availableAtMs
    && availableAtMs <= forecastAtMs
    && forecastAtMs - availableAtMs <= challenger.maximumCreatorEvidenceLagMs
    && forecast.additionalEvidenceEventId === event.id
    && forecast.additionalEvidenceDigest === event.digest
    && forecast.additionalEvidenceObservedAt === event.observedAt
    && forecast.additionalEvidenceAvailableAt === event.availableAt
    && forecast.creatorAggregateDigest === event.creatorAggregateDigest
    && forecast.creatorDistributionRuleVersion === challenger.creatorDistributionRuleVersion
    && forecast.minimumCreatorCountInclusive === challenger.minimumCreatorCountInclusive
    && forecast.maximumTopCreatorInteractionShareInclusive
      === challenger.maximumTopCreatorInteractionShareInclusive
    && forecast.maximumCreatorInteractionHhiInclusive
      === challenger.maximumCreatorInteractionHhiInclusive
    && forecast.maximumCreatorEvidenceLagMs === challenger.maximumCreatorEvidenceLagMs
    && forecast.inputEvidence?.additionalEvidenceEventId === event.id
    && forecast.inputEvidence?.additionalEvidenceDigest === event.digest
    && forecast.inputEvidence?.additionalEvidenceObservedAt === event.observedAt
    && forecast.inputEvidence?.additionalEvidenceAvailableAt === event.availableAt
    && forecast.inputEvidence?.creatorAggregateDigest === event.creatorAggregateDigest
    && forecast.inputEvidence?.creatorDistributionRuleVersion
      === challenger.creatorDistributionRuleVersion
    && sameJson(forecast.inputEvidence?.creatorMetrics, metrics)
    && forecast.inputEvidence?.minimumCreatorCountInclusive
      === challenger.minimumCreatorCountInclusive
    && forecast.inputEvidence?.maximumTopCreatorInteractionShareInclusive
      === challenger.maximumTopCreatorInteractionShareInclusive
    && forecast.inputEvidence?.maximumCreatorInteractionHhiInclusive
      === challenger.maximumCreatorInteractionHhiInclusive
    && forecast.inputEvidence?.maximumCreatorEvidenceLagMs
      === challenger.maximumCreatorEvidenceLagMs;
}

function hasLunarDiscoveryMagnitudeEvidence(forecast, challenger, registration, event) {
  const eventAtMs = Date.parse(event?.observedAt ?? "");
  const availableAtMs = Date.parse(event?.availableAt ?? "");
  const forecastAtMs = Date.parse(forecast.createdAt);
  const registeredAtMs = Date.parse(registration.registeredAt);
  const boundaryMs = Date.parse(challenger.evidenceBoundary);
  const candidates = Array.isArray(event?.candidates) ? event.candidates : [];
  const candidate = candidates.find((row) => (
    row?.status === "eligible" && sameAsset(row, forecast)
  )) ?? null;
  return event?.type === challenger.requiredEvidenceEventType
    && event.provider === challenger.magnitudeProvider
    && event.sourceProvider === "lunarcrush"
    && event.chain === forecast.chain
    && event.timeframe === "1h"
    && event.researchOnly === true
    && event.mutationAllowed === false
    && event.universe?.complete === true
    && event.ruleVersion === challenger.magnitudeRuleVersion
    && sameJson(event.rule, challenger.magnitudeRule)
    && candidates.length <= challenger.magnitudeRule.maximumCandidates
    && candidates.every((row) => satisfiesLunarCrushSolanaDiscoveryRule(row))
    && hasCanonicalDiscoveryCandidateOrder(candidates)
    && [eventAtMs, availableAtMs, forecastAtMs, registeredAtMs, boundaryMs].every(Number.isFinite)
    && eventAtMs > registeredAtMs
    && eventAtMs > boundaryMs
    && eventAtMs <= availableAtMs
    && availableAtMs <= forecastAtMs
    && forecastAtMs - availableAtMs <= challenger.maximumMagnitudeEvidenceLagMs
    && forecast.additionalEvidenceEventId === event.id
    && forecast.additionalEvidenceDigest === event.digest
    && forecast.additionalEvidenceObservedAt === event.observedAt
    && forecast.additionalEvidenceAvailableAt === event.availableAt
    && forecast.maximumAdditionalEvidenceLagMs === challenger.maximumMagnitudeEvidenceLagMs
    && forecast.magnitudeRuleVersion === challenger.magnitudeRuleVersion
    && forecast.magnitudeAlert === Boolean(candidate)
    && forecast.inputEvidence?.additionalEvidenceEventId === event.id
    && forecast.inputEvidence?.additionalEvidenceDigest === event.digest
    && forecast.inputEvidence?.additionalEvidenceObservedAt === event.observedAt
    && forecast.inputEvidence?.additionalEvidenceAvailableAt === event.availableAt
    && forecast.inputEvidence?.maximumAdditionalEvidenceLagMs
      === challenger.maximumMagnitudeEvidenceLagMs
    && forecast.inputEvidence?.magnitudeRuleVersion === challenger.magnitudeRuleVersion
    && forecast.inputEvidence?.magnitudeAlert === Boolean(candidate)
    && sameJson(
      forecast.inputEvidence?.magnitudeCandidate,
      candidate ? selectionMetrics(candidate) : null,
    );
}

function hasExactFrozenDecision(forecast, challenger, baselineForecast, eventById) {
  const snapshot = eventById.get(forecast.snapshotId);
  if (challenger.changedDimension === "maximumLiquidityUsd") {
    const liquidityUsd = snapshot?.market?.liquidityUsd;
    if (!Number.isFinite(liquidityUsd)) return false;
    const predictedRise = liquidityUsd <= challenger.maximumLiquidityUsd;
    return forecast.maximumLiquidityUsd === challenger.maximumLiquidityUsd
      && forecast.inputEvidence?.currentLiquidityUsd === liquidityUsd
      && forecast.inputEvidence?.maximumLiquidityUsd === challenger.maximumLiquidityUsd
      && hasExpectedDecisionFields(forecast, predictedRise, {
        rise: { score: 0.7, probability: 0.6, returnPct: 6.4 },
        cash: { score: 0.54, probability: 0.4, returnPct: 0 },
      });
  }
  if (challenger.changedDimension === "exactMintLunarCrushMoveAlert"
    || challenger.changedDimension === "exactMintLunarCrushMoveAlert24h") {
    const evidence = eventById.get(forecast.additionalEvidenceEventId);
    const predictedRise = baselineForecast?.status === "ready"
      && baselineForecast.predictedRise === true
      && evidence?.socialFeatures?.largeMoveAlert === true;
    const policy = challenger.changedDimension === "exactMintLunarCrushMoveAlert24h"
      ? {
        rise: { score: 0.7, probability: 0.6, returnPct: 19.2 },
        cash: { score: 0.5, probability: 0.4, returnPct: 0 },
      }
      : {
        rise: { score: 0.72, probability: 0.62, returnPct: 8 },
        cash: { score: 0.5, probability: 0.38, returnPct: 0 },
      };
    return baselineForecast?.modelVersion === challenger.parentModelVersion
      && baselineForecast.candidateId === challenger.parentCandidateId
      && baselineForecast.horizon === challenger.horizon
      && forecast.lunarcrushRuleVersion === challenger.lunarcrushRuleVersion
      && hasExpectedDecisionFields(forecast, predictedRise, policy);
  }
  if (challenger.changedDimension === "pairAgeHoursWindow") {
    const pairCreatedAt = snapshot?.market?.pairCreatedAt;
    const pairAgeHours = Number.isFinite(pairCreatedAt)
      ? (Date.parse(snapshot.observedAt) - pairCreatedAt) / (60 * 60_000)
      : null;
    if (!Number.isFinite(pairAgeHours)) return false;
    const predictedRise = baselineForecast?.status === "ready"
      && baselineForecast.predictedRise === true
      && pairAgeHours >= challenger.minimumPairAgeHoursInclusive
      && pairAgeHours < challenger.maximumPairAgeHoursExclusive;
    return baselineForecast?.modelVersion === challenger.parentModelVersion
      && baselineForecast.candidateId === challenger.parentCandidateId
      && baselineForecast.horizon === challenger.horizon
      && forecast.pairAgeHours === pairAgeHours
      && forecast.minimumPairAgeHoursInclusive === challenger.minimumPairAgeHoursInclusive
      && forecast.maximumPairAgeHoursExclusive === challenger.maximumPairAgeHoursExclusive
      && forecast.inputEvidence?.pairAgeHours === pairAgeHours
      && forecast.inputEvidence?.minimumPairAgeHoursInclusive
        === challenger.minimumPairAgeHoursInclusive
      && forecast.inputEvidence?.maximumPairAgeHoursExclusive
        === challenger.maximumPairAgeHoursExclusive
      && hasExpectedDecisionFields(forecast, predictedRise, {
        rise: { score: 0.7, probability: 0.6, returnPct: 6.4 },
        cash: { score: 0.5, probability: 0.4, returnPct: 0 },
      });
  }
  if (challenger.changedDimension === "lunarcrushSocialDiscoveryRise") {
    const metrics = forecast.inputEvidence?.lunarcrushDiscoveryMetrics;
    return baselineForecast?.modelVersion === challenger.parentModelVersion
      && baselineForecast.candidateId === challenger.parentCandidateId
      && baselineForecast.horizon === challenger.horizon
      && baselineForecast.status === "ready"
      && forecast.lunarcrushDiscoveryRuleVersion === LUNARCRUSH_SOLANA_DISCOVERY_RULE.version
      && forecast.inputEvidence?.lunarcrushDiscoveryRuleVersion
        === LUNARCRUSH_SOLANA_DISCOVERY_RULE.version
      && satisfiesLunarCrushSolanaDiscoveryRule({
        ruleVersion: forecast.inputEvidence.lunarcrushDiscoveryRuleVersion,
        ...metrics,
      })
      && hasExpectedDecisionFields(forecast, true, {
        rise: { score: 0.74, probability: 0.64, returnPct: 8 },
        cash: { score: 0.5, probability: 0.36, returnPct: 0 },
      });
  }
  if (challenger.changedDimension === "lunarcrushCreatorDistributionGate") {
    const evidence = eventById.get(forecast.additionalEvidenceEventId);
    const metrics = evidence?.creatorMetrics;
    const predictedRise = baselineForecast?.status === "ready"
      && baselineForecast.predictedRise === true
      && metrics?.creatorCount >= challenger.minimumCreatorCountInclusive
      && metrics?.topCreatorInteractionShare
        <= challenger.maximumTopCreatorInteractionShareInclusive
      && metrics?.creatorInteractionHhi
        <= challenger.maximumCreatorInteractionHhiInclusive;
    return baselineForecast?.modelVersion === challenger.parentModelVersion
      && baselineForecast.candidateId === challenger.parentCandidateId
      && baselineForecast.horizon === challenger.horizon
      && forecast.lunarcrushDiscoveryRuleVersion === challenger.lunarcrushDiscoveryRuleVersion
      && forecast.creatorDistributionRuleVersion === challenger.creatorDistributionRuleVersion
      && hasExpectedDecisionFields(forecast, predictedRise, {
        rise: { score: 0.74, probability: 0.64, returnPct: 8 },
        cash: { score: 0.5, probability: 0.36, returnPct: 0 },
      });
  }
  if (challenger.changedDimension === "removeMaximumDexPairAge") {
    const pairCreatedAt = snapshot?.market?.pairCreatedAt;
    const pairAgeHours = Number.isFinite(pairCreatedAt)
      ? (Date.parse(snapshot.observedAt) - pairCreatedAt) / (60 * 60_000)
      : null;
    const parentDecisionIsExpected = baselineForecast?.status === "ready"
      ? baselineForecast.predictedRise === true
      : isRemovedBlockerOnlyBaseline(baselineForecast, challenger);
    if (!Number.isFinite(pairAgeHours) || !parentDecisionIsExpected) return false;
    return baselineForecast?.modelVersion === challenger.parentModelVersion
      && baselineForecast.candidateId === challenger.parentCandidateId
      && baselineForecast.horizon === challenger.horizon
      && forecast.lunarcrushDiscoveryRuleVersion === challenger.lunarcrushDiscoveryRuleVersion
      && forecast.removedMarketBlocker === challenger.removedBlocker
      && forecast.pairAgeHours === pairAgeHours
      && forecast.executionIntegrityRuleVersion === challenger.executionIntegrityRuleVersion
      && forecast.inputEvidence?.removedMarketBlocker === challenger.removedBlocker
      && forecast.inputEvidence?.pairAgeHours === pairAgeHours
      && sameJson(
        forecast.inputEvidence?.entryProviderPriceIntegrity,
        snapshot.market?.providerPriceIntegrity,
      )
      && validAgeUnboundedEntryIntegrity(snapshot.market, challenger)
      && hasExpectedDecisionFields(forecast, true, {
        rise: { score: 0.74, probability: 0.64, returnPct: 8 },
        cash: { score: 0.5, probability: 0.36, returnPct: 0 },
      });
  }
  if (challenger.changedDimension === "minimumHourlyVolumeToLiquidity") {
    const hourlyVolumeUsd = snapshot?.market?.volumeUsd?.h1;
    const liquidityUsd = snapshot?.market?.liquidityUsd;
    const hourlyVolumeToLiquidity = Number.isFinite(hourlyVolumeUsd) && liquidityUsd > 0
      ? hourlyVolumeUsd / liquidityUsd
      : null;
    if (!Number.isFinite(hourlyVolumeToLiquidity)) return false;
    const predictedRise = baselineForecast?.status === "ready"
      && baselineForecast.predictedRise === true
      && hourlyVolumeToLiquidity >= challenger.minimumHourlyVolumeToLiquidityInclusive;
    return baselineForecast?.modelVersion === challenger.parentModelVersion
      && baselineForecast.candidateId === challenger.parentCandidateId
      && baselineForecast.horizon === challenger.horizon
      && forecast.hourlyVolumeToLiquidity === hourlyVolumeToLiquidity
      && forecast.minimumHourlyVolumeToLiquidityInclusive
        === challenger.minimumHourlyVolumeToLiquidityInclusive
      && forecast.inputEvidence?.hourlyVolumeUsd === hourlyVolumeUsd
      && forecast.inputEvidence?.currentLiquidityUsd === liquidityUsd
      && forecast.inputEvidence?.hourlyVolumeToLiquidity === hourlyVolumeToLiquidity
      && forecast.inputEvidence?.minimumHourlyVolumeToLiquidityInclusive
        === challenger.minimumHourlyVolumeToLiquidityInclusive
      && hasExpectedDecisionFields(forecast, predictedRise, {
        rise: { score: 0.7, probability: 0.6, returnPct: 6.4 },
        cash: { score: 0.5, probability: 0.4, returnPct: 0 },
      });
  }
  if (challenger.changedDimension === "positiveDexHourlyMomentum") {
    const dexHourlyPriceChangePct = snapshot?.market?.priceChangePct?.h1;
    if (!Number.isFinite(dexHourlyPriceChangePct)) return false;
    const predictedRise = baselineForecast?.status === "ready"
      && baselineForecast.predictedRise === true
      && dexHourlyPriceChangePct > challenger.minimumDexHourlyPriceChangePctExclusive;
    return baselineForecast?.modelVersion === challenger.parentModelVersion
      && baselineForecast.candidateId === challenger.parentCandidateId
      && baselineForecast.horizon === challenger.horizon
      && forecast.dexHourlyPriceChangePct === dexHourlyPriceChangePct
      && forecast.minimumDexHourlyPriceChangePctExclusive
        === challenger.minimumDexHourlyPriceChangePctExclusive
      && forecast.inputEvidence?.dexHourlyPriceChangePct === dexHourlyPriceChangePct
      && forecast.inputEvidence?.minimumDexHourlyPriceChangePctExclusive
        === challenger.minimumDexHourlyPriceChangePctExclusive
      && hasExpectedDecisionFields(forecast, predictedRise, {
        rise: { score: 0.7, probability: 0.6, returnPct: 6.4 },
        cash: { score: 0.5, probability: 0.4, returnPct: 0 },
      });
  }
  if (challenger.changedDimension === "lunarcrushDiscoveryMagnitudeGate") {
    const event = eventById.get(forecast.additionalEvidenceEventId);
    const candidate = event?.candidates?.find((row) => (
      row?.status === "eligible" && sameAsset(row, forecast)
    )) ?? null;
    const predictedRise = baselineForecast?.status === "ready"
      && baselineForecast.predictedRise === true
      && candidate != null;
    return baselineForecast?.modelVersion === challenger.parentModelVersion
      && baselineForecast.candidateId === challenger.parentCandidateId
      && baselineForecast.horizon === challenger.horizon
      && forecast.magnitudeRuleVersion === challenger.magnitudeRuleVersion
      && forecast.magnitudeAlert === Boolean(candidate)
      && hasExpectedDecisionFields(forecast, predictedRise, {
        rise: { score: 0.72, probability: 0.62, returnPct: 8 },
        cash: { score: 0.5, probability: 0.38, returnPct: 0 },
      });
  }
  if (challenger.changedDimension === "dexEarlySurfaceRise") {
    const discovery = eventById.get(forecast.selectionDiscoveryEventId);
    const candidate = discovery?.candidates?.find((row) => (
      row?.status === "eligible" && sameAsset(row, forecast)
    ));
    return baselineForecast?.modelVersion === challenger.parentModelVersion
      && baselineForecast.candidateId === challenger.parentCandidateId
      && baselineForecast.horizon === challenger.horizon
      && baselineForecast.status === "ready"
      && candidate != null
      && forecast.dexEarlySurfaceRuleVersion === challenger.dexEarlySurfaceRuleVersion
      && forecast.inputEvidence?.dexEarlySurfaceRuleVersion
        === challenger.dexEarlySurfaceRuleVersion
      && sameJson(forecast.inputEvidence?.dexEarlySurfaceMetrics, dexEarlySurfaceMetrics(candidate))
      && hasExpectedDecisionFields(forecast, true, {
        rise: { score: 0.7, probability: 0.6, returnPct: 6.4 },
        cash: { score: 0.5, probability: 0.4, returnPct: 0 },
      });
  }
  return false;
}

function dexEarlySurfaceMetrics(candidate) {
  return {
    ruleVersion: candidate.ruleVersion ?? null,
    sourceBreadth: candidate.sourceBreadth ?? null,
    pairAgeMinutes: candidate.pairAgeMinutes ?? null,
    liquidityUsd: candidate.liquidityUsd ?? null,
    marketCapUsd: candidate.marketCapUsd ?? null,
    volumeH1Usd: candidate.volumeH1Usd ?? null,
    priceChangeH1Pct: candidate.priceChangeH1Pct ?? null,
    priceChangeH24Pct: candidate.priceChangeH24Pct ?? null,
    sourceTypes: candidate.sourceTypes ?? [],
    latestBoostAmount: candidate.latestBoostAmount ?? null,
    totalBoostAmount: candidate.totalBoostAmount ?? null,
    hourlyTurnover: candidate.hourlyTurnover ?? null,
    buySellTxnRatio: candidate.buySellTxnRatio ?? null,
    hasWebsite: candidate.hasWebsite ?? null,
    hasTwitter: candidate.hasTwitter ?? null,
  };
}

function selectionMetrics(candidate) {
  return {
    lunarcrushCoinId: candidate.lunarcrushCoinId ?? null,
    marketCapUsd: candidate.marketCapUsd ?? null,
    volume24hUsd: candidate.volume24hUsd ?? null,
    interactions24h: candidate.interactions24h ?? null,
    socialVolume24h: candidate.socialVolume24h ?? null,
    altRank: candidate.altRank ?? null,
    altRankPrevious: candidate.altRankPrevious ?? null,
    altRankImprovement: candidate.altRankImprovement ?? null,
    galaxyScore: candidate.galaxyScore ?? null,
    galaxyScorePrevious: candidate.galaxyScorePrevious ?? null,
    galaxyScoreImprovement: candidate.galaxyScoreImprovement ?? null,
    priceChange1hPct: candidate.priceChange1hPct ?? null,
    priceChange24hPct: candidate.priceChange24hPct ?? null,
  };
}

function hasExpectedDecisionFields(forecast, predictedRise, policy) {
  const expected = predictedRise ? policy.rise : policy.cash;
  return forecast.predictedRise === predictedRise
    && forecast.decision === (predictedRise ? "paper-long" : "paper-cash")
    && forecast.score === expected.score
    && forecast.predictedRiseProbability === expected.probability
    && forecast.predictedReturnPct === expected.returnPct;
}

function hasEligibleAsset(event, forecast, challenger) {
  return Array.isArray(event?.candidates) && event.candidates.some((candidate) => (
    sameAsset(candidate, forecast)
    && (
      candidate?.status === "eligible"
      || (
        challenger.changedDimension === "removeMaximumDexPairAge"
        && candidate?.ageUnboundedStatus === "eligible"
        && Array.isArray(candidate?.ageUnboundedBlockers)
        && candidate.ageUnboundedBlockers.length === 0
      )
    )
  ));
}

function isRemovedBlockerOnlyBaseline(forecast, challenger) {
  return forecast?.status === "blocked"
    && forecast.predictedRise == null
    && Array.isArray(forecast.blockers)
    && forecast.blockers.length === 1
    && forecast.blockers[0] === challenger.removedBlocker;
}

function validAgeUnboundedEntryIntegrity(market, challenger) {
  const integrity = market?.providerPriceIntegrity;
  const prices = [integrity?.tokenPairsPriceUsd, integrity?.tokenBatchPriceUsd];
  const liquidities = [
    integrity?.tokenPairsLiquidityUsd,
    integrity?.tokenBatchLiquidityUsd,
  ];
  return integrity?.ruleVersion === challenger.executionIntegrityRuleVersion
    && integrity?.selectedQuotePolicy === challenger.executionQuotePolicy
    && [...prices, ...liquidities].every((value) => Number.isFinite(value) && value > 0)
    && Math.max(...prices) / Math.min(...prices)
      <= challenger.maximumExecutionPriceRatioInclusive
    && Math.max(...liquidities) / Math.min(...liquidities)
      <= challenger.maximumExecutionLiquidityRatioInclusive
    && market.priceUsd === Math.min(...prices)
    && market.liquidityUsd === Math.min(...liquidities);
}

function sameAsset(left, right) {
  const chain = normalize(left?.chain);
  if (chain !== normalize(right?.chain)) return false;
  return chain === "solana"
    ? exactText(left?.tokenAddress) === exactText(right?.tokenAddress)
    : normalize(left?.tokenAddress) === normalize(right?.tokenAddress);
}

function assetKey(value) {
  const chain = normalize(value?.chain);
  const tokenAddress = chain === "solana"
    ? exactText(value?.tokenAddress)
    : normalize(value?.tokenAddress);
  return `${chain}:${tokenAddress}`;
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function exactText(value) {
  return String(value ?? "").trim();
}

export function findChallengerRegistration(challenger, events) {
  return events.find((event) => (
    event.type === "challenger-registration"
    && event.status === "frozen"
    && event.modelVersion === challenger.modelVersion
    && event.candidateId === challenger.candidateId
    && event.parentModelVersion === challenger.parentModelVersion
    && event.parentCandidateId === challenger.parentCandidateId
    && event.horizon === challenger.horizon
    && event.evidenceBoundary === challenger.evidenceBoundary
    && event.researchOnly === true
    && event.mutationAllowed === false
    && Object.entries(challenger).every(([key, value]) => sameJson(event[key], value))
  ));
}

function independentPairedPolicyFrames(pairs, durationMs, roundTripCostPct) {
  const weightedFrames = independentAssetFrames(pairs, {
    durationMs,
    timestamp: (pair) => Date.parse(pair.challengerForecast.createdAt),
    assetKey: (pair) => tokenEdgeAssetKey(pair.challengerForecast),
  });
  const frames = weightedFrames.map((frame) => {
    const values = frame.flatMap((pair) => {
      const grossReturnPct = pair.challengerOutcome.grossReturnPct;
      if (!Number.isFinite(grossReturnPct)) return [];
      return [{
      baselineReturnPct: pair.baselineForecast.predictedRise
        ? grossReturnPct - roundTripCostPct
        : 0,
      challengerReturnPct: pair.challengerForecast.predictedRise
        ? grossReturnPct - roundTripCostPct
        : 0,
      }];
    });
    return {
      baselineReturnPct: mean(values, "baselineReturnPct"),
      challengerReturnPct: mean(values, "challengerReturnPct"),
    };
  }).filter((frame) => (
    Number.isFinite(frame.baselineReturnPct) && Number.isFinite(frame.challengerReturnPct)
  ));
  return {
    frames,
    weightedPairs: weightedFrames.reduce((sum, frame) => sum + frame.length, 0),
  };
}

function mean(values, key = null) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + (key ? value[key] : value), 0) / values.length;
}

function nullableRound(value, digits) {
  return Number.isFinite(value) ? Math.round(value * (10 ** digits)) / (10 ** digits) : null;
}

function sameJson(left, right) {
  return canonicalValue(left) === canonicalValue(right);
}

function digestValue(value) {
  return createHash("sha256").update(canonicalValue(value)).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalValue(value[key])}`
    )).join(",")}}`;
  }
  return value === undefined ? "undefined" : JSON.stringify(value);
}
