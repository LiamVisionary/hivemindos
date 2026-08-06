#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import {
  captureGeckoTerminalNewPoolBirthEntries,
  markOpenGeckoTerminalNewPoolBirthPaths,
  registerGeckoTerminalNewPoolActivation,
  registerGeckoTerminalNewPoolBirthEntry,
  registerGeckoTerminalNewPoolBirthMarketCapFloorRemoved,
  registerGeckoTerminalNewPoolBirthPath,
  resolveGeckoTerminalNewPoolForecasts,
  watchGeckoTerminalNewPools,
} from "./token-edge/onchain-geckoterminal-new-pool-activation.mjs";
import {
  GECKOTERMINAL_NEW_POOL_BIRTH_BRACKET_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_ATTEMPT_COVERED_BRACKET_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_FAST_BRACKET_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_PREFIX_TAKE_PROFIT_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_BRACKET_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_MID_BRACKET_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_TAKE_PROFIT_RULE,
  buildGeckoTerminalNewPoolBirthBracketScorecard,
  buildGeckoTerminalNewPoolBirthAttemptCoveredBracketScorecard,
  buildGeckoTerminalNewPoolBirthFastBracketScorecard,
  buildGeckoTerminalNewPoolBirthPrefixTakeProfitScorecard,
  buildGeckoTerminalNewPoolBirthStandardBracketScorecard,
  buildGeckoTerminalNewPoolBirthStandardMidBracketScorecard,
  buildGeckoTerminalNewPoolBirthTakeProfitScorecard,
  registerGeckoTerminalNewPoolBirthBracket,
  registerGeckoTerminalNewPoolBirthAttemptCoveredBracket,
  registerGeckoTerminalNewPoolBirthFastBracket,
  registerGeckoTerminalNewPoolBirthPrefixTakeProfit,
  registerGeckoTerminalNewPoolBirthStandardBracket,
  registerGeckoTerminalNewPoolBirthStandardMidBracket,
  registerGeckoTerminalNewPoolBirthTakeProfit,
} from "./token-edge/onchain-geckoterminal-new-pool-birth-take-profit.mjs";
import {
  registerGeckoTerminalLiquidityCollapseScoring,
} from "./token-edge/onchain-geckoterminal-trending-monitoring.mjs";
import {
  GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE,
  GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE,
  GECKOTERMINAL_NEW_POOL_STANDARD_MID_PATH_RULE,
  buildGeckoTerminalNewPoolFastPathDisagreementScorecard,
  markOpenGeckoTerminalNewPoolFastPaths,
  markOpenGeckoTerminalNewPoolStandardMidPaths,
  registerGeckoTerminalNewPoolFastPath,
  registerGeckoTerminalNewPoolFastPathDisagreement,
  registerGeckoTerminalNewPoolStandardMidPath,
} from "./token-edge/onchain-geckoterminal-new-pool-fast-path.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "token-edge-newborn-tp-"));
try {
  const ledgerPath = path.join(root, "ledger.jsonl");
  await registerGeckoTerminalNewPoolActivation(
    { ledgerPath },
    { now: new Date("2026-08-04T03:58:30.000Z") },
  );
  await registerGeckoTerminalLiquidityCollapseScoring(
    { ledgerPath },
    { now: new Date("2026-08-04T03:59:00.000Z") },
  );
  await registerGeckoTerminalNewPoolBirthEntry(
    { ledgerPath },
    { now: new Date("2026-08-04T08:27:00.000Z") },
  );
  await registerGeckoTerminalNewPoolBirthMarketCapFloorRemoved(
    { ledgerPath },
    { now: new Date("2026-08-04T08:45:00.000Z") },
  );
  await registerGeckoTerminalNewPoolBirthPath(
    { ledgerPath },
    { now: new Date("2026-08-04T09:10:00.000Z") },
  );
  await assert.rejects(
    registerGeckoTerminalNewPoolBirthTakeProfit(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_TAKE_PROFIT_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const registration = await registerGeckoTerminalNewPoolBirthTakeProfit(
    { ledgerPath },
    { now: new Date("2026-08-04T09:28:00.000Z") },
  );
  assert.equal(registration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthTakeProfit(
    { ledgerPath },
    { now: new Date("2026-08-04T09:28:01.000Z") },
  )).status, "existing");

  const tokenAddress = "TokenFutureNewbornTakeProfit111111111111111";
  const pairAddress = "PoolFutureNewbornTakeProfit1111111111111111";
  const sourcePool = poolRow({
    tokenAddress,
    pairAddress,
    poolCreatedAt: "2026-08-04T09:29:00.000Z",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    marketCapUsd: 10_000,
  });
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T09:30:00.000Z"),
      clock: () => new Date("2026-08-04T09:30:00.000Z"),
      fetcher: fakeProvider({ newPoolRows: [sourcePool] }),
    },
  );
  const capture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T09:30:10.000Z"),
      captureClock: () => new Date("2026-08-04T09:30:10.000Z"),
      fetcher: fakeProvider({
        directPairs: [dexPair({ tokenAddress, pairAddress, priceUsd: 0.0001, liquidityUsd: 20_000 })],
      }),
    },
  );
  assert.equal(capture.recordedForecasts, 1);
  assert.equal(capture.forecasts[0].dueAt, "2026-08-04T10:30:10.000Z");

  for (let index = 1; index <= 11; index += 1) {
    const observedAt = new Date(Date.parse("2026-08-04T09:30:10.000Z") + index * 5 * 60_000);
    const priceUsd = index === 1 ? 0.000105 : index === 2 ? 0.000112 : 0.00009;
    const exactPool = poolRow({
      tokenAddress,
      pairAddress,
      poolCreatedAt: sourcePool.attributes.pool_created_at,
      priceUsd,
      liquidityUsd: 21_000,
      marketCapUsd: 10_000,
    });
    const marked = await markOpenGeckoTerminalNewPoolBirthPaths(
      { ledgerPath },
      {
        now: observedAt,
        fetcher: fakeProvider({
          exactPoolRows: [exactPool],
          directPairs: [dexPair({ tokenAddress, pairAddress, priceUsd, liquidityUsd: 21_000 })],
        }),
      },
    );
    assert.equal(marked.recordedObservations, 1);
  }
  const resolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T10:30:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress,
          pairAddress,
          poolCreatedAt: sourcePool.attributes.pool_created_at,
          priceUsd: 0.00008,
          liquidityUsd: 18_000,
          marketCapUsd: 10_000,
        })],
        directPairs: [dexPair({ tokenAddress, pairAddress, priceUsd: 0.00008, liquidityUsd: 18_000 })],
      }),
    },
  );
  assert.equal(resolution.observed, 1);
  const events = await readLedger(ledgerPath);
  assert.equal(verifyLedger(events).ok, true);
  const score = buildGeckoTerminalNewPoolBirthTakeProfitScorecard(events);
  assert.equal(score.candidateForecasts, 1);
  assert.equal(score.eligibleCompletePathObservations, 1);
  assert.equal(score.takeProfitExits, 1);
  assert.equal(score.observationsDetail[0].exitGrossReturnPct, 12);
  assert.equal(score.observationsDetail[0].exactOneHourGrossReturnPct, -20);
  assert.ok(score.parentFrameMeanNetReturnPct < 0);
  assert.ok(score.policyFrameMeanNetReturnPct > 0);
  assert.ok(score.pairedFrameMeanDeltaPct > 0);
  assert.equal(score.provisionalGate, false);

  const tampered = structuredClone(events);
  const pathToTamper = tampered.find((event) => (
    event.type === "geckoterminal-new-pool-path"
      && event.forecastId === capture.forecasts[0].id
      && event.grossReturnFromEntryPct === 12
  ));
  pathToTamper.providerPriceIntegrity.directPriceUsd = 0.0002;
  const tamperedScore = buildGeckoTerminalNewPoolBirthTakeProfitScorecard(tampered);
  assert.equal(tamperedScore.eligibleCompletePathObservations, 1);
  assert.equal(tamperedScore.takeProfitExits, 0);
  assert.equal(tamperedScore.pathExclusionCounts["invalid-path-provider-integrity"], 1);

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthPrefixTakeProfit(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_PREFIX_TAKE_PROFIT_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const prefixRegistration = await registerGeckoTerminalNewPoolBirthPrefixTakeProfit(
    { ledgerPath },
    { now: new Date("2026-08-04T11:07:00.000Z") },
  );
  assert.equal(prefixRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthPrefixTakeProfit(
    { ledgerPath },
    { now: new Date("2026-08-04T11:07:01.000Z") },
  )).status, "existing");

  const sparseTokenAddress = "TokenFuturePrefixTakeProfit11111111111111111";
  const sparsePairAddress = "PoolFuturePrefixTakeProfit111111111111111111";
  const sparseSourcePool = poolRow({
    tokenAddress: sparseTokenAddress,
    pairAddress: sparsePairAddress,
    poolCreatedAt: "2026-08-04T11:09:00.000Z",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    marketCapUsd: 10_000,
  });
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T11:10:00.000Z"),
      clock: () => new Date("2026-08-04T11:10:00.000Z"),
      fetcher: fakeProvider({ newPoolRows: [sparseSourcePool] }),
    },
  );
  const sparseCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T11:10:10.000Z"),
      captureClock: () => new Date("2026-08-04T11:10:10.000Z"),
      fetcher: fakeProvider({
        directPairs: [dexPair({
          tokenAddress: sparseTokenAddress,
          pairAddress: sparsePairAddress,
          priceUsd: 0.0001,
          liquidityUsd: 20_000,
        })],
      }),
    },
  );
  assert.equal(sparseCapture.recordedForecasts, 1);
  const sparseTakeProfitPrice = 0.000112;
  const sparseMark = await markOpenGeckoTerminalNewPoolBirthPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T11:15:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: sparseTokenAddress,
          pairAddress: sparsePairAddress,
          poolCreatedAt: sparseSourcePool.attributes.pool_created_at,
          priceUsd: sparseTakeProfitPrice,
          liquidityUsd: 21_000,
          marketCapUsd: 10_000,
        })],
        directPairs: [dexPair({
          tokenAddress: sparseTokenAddress,
          pairAddress: sparsePairAddress,
          priceUsd: sparseTakeProfitPrice,
          liquidityUsd: 21_000,
        })],
      }),
    },
  );
  assert.equal(sparseMark.recordedObservations, 1);
  const sparseResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T12:10:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: sparseTokenAddress,
          pairAddress: sparsePairAddress,
          poolCreatedAt: sparseSourcePool.attributes.pool_created_at,
          priceUsd: 0.00008,
          liquidityUsd: 18_000,
          marketCapUsd: 10_000,
        })],
        directPairs: [dexPair({
          tokenAddress: sparseTokenAddress,
          pairAddress: sparsePairAddress,
          priceUsd: 0.00008,
          liquidityUsd: 18_000,
        })],
      }),
    },
  );
  assert.equal(sparseResolution.observed, 1);
  const sparseEvents = await readLedger(ledgerPath);
  const unchangedV1Score = buildGeckoTerminalNewPoolBirthTakeProfitScorecard(sparseEvents);
  assert.equal(unchangedV1Score.candidateForecasts, 2);
  assert.equal(unchangedV1Score.eligibleCompletePathObservations, 1);
  assert.equal(unchangedV1Score.pathExclusionCounts["insufficient-path-marks"], 1);
  const prefixScore = buildGeckoTerminalNewPoolBirthPrefixTakeProfitScorecard(sparseEvents);
  assert.equal(prefixScore.candidateForecasts, 1);
  assert.equal(prefixScore.eligibleCompletePathObservations, 1);
  assert.equal(prefixScore.takeProfitExits, 1);
  assert.equal(prefixScore.observationsDetail[0].validPathMarks, 1);
  assert.equal(prefixScore.observationsDetail[0].exitGrossReturnPct, 12);
  assert.equal(prefixScore.observationsDetail[0].exactOneHourGrossReturnPct, -20);
  assert.ok(prefixScore.policyFrameMeanNetReturnPct > 0);
  assert.ok(prefixScore.pairedFrameMeanDeltaPct > 0);
  assert.equal(prefixScore.provisionalGate, false);

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthBracket(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_BRACKET_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const bracketRegistration = await registerGeckoTerminalNewPoolBirthBracket(
    { ledgerPath },
    { now: new Date("2026-08-04T13:00:00.000Z") },
  );
  assert.equal(bracketRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthBracket(
    { ledgerPath },
    { now: new Date("2026-08-04T13:00:01.000Z") },
  )).status, "existing");

  const bracketWinner = {
    tokenAddress: "TokenFutureBracketWinner111111111111111111111",
    pairAddress: "PoolFutureBracketWinner1111111111111111111111",
  };
  const bracketLoser = {
    tokenAddress: "TokenFutureBracketLoser1111111111111111111111",
    pairAddress: "PoolFutureBracketLoser11111111111111111111111",
  };
  const bracketPools = [bracketWinner, bracketLoser].map((item, index) => poolRow({
    ...item,
    poolCreatedAt: `2026-08-04T13:01:0${index}.000Z`,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    marketCapUsd: 10_000,
  }));
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T13:02:00.000Z"),
      clock: () => new Date("2026-08-04T13:02:00.000Z"),
      fetcher: fakeProvider({ newPoolRows: bracketPools }),
    },
  );
  const bracketCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T13:02:10.000Z"),
      captureClock: () => new Date("2026-08-04T13:02:10.000Z"),
      fetcher: fakeProvider({
        directPairs: [bracketWinner, bracketLoser].map((item) => dexPair({
          ...item,
          priceUsd: 0.0001,
          liquidityUsd: 20_000,
        })),
      }),
    },
  );
  assert.equal(bracketCapture.recordedForecasts, 2);
  const bracketMarkPrices = new Map([
    [bracketWinner.tokenAddress, 0.000112],
    [bracketLoser.tokenAddress, 0.000088],
  ]);
  const bracketMark = await markOpenGeckoTerminalNewPoolBirthPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T13:07:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: bracketPools.map((source) => poolRow({
          tokenAddress: source.relationships.base_token.data.id.slice("solana_".length),
          pairAddress: source.attributes.address,
          poolCreatedAt: source.attributes.pool_created_at,
          priceUsd: bracketMarkPrices.get(
            source.relationships.base_token.data.id.slice("solana_".length),
          ),
          liquidityUsd: 21_000,
          marketCapUsd: 10_000,
        })),
        directPairs: [bracketWinner, bracketLoser].map((item) => dexPair({
          ...item,
          priceUsd: bracketMarkPrices.get(item.tokenAddress),
          liquidityUsd: 21_000,
        })),
      }),
    },
  );
  assert.equal(bracketMark.recordedObservations, 2);
  const bracketResolutionPrices = new Map([
    [bracketWinner.tokenAddress, 0.00008],
    [bracketLoser.tokenAddress, 0.00015],
  ]);
  const bracketResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T14:02:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: bracketPools.map((source) => poolRow({
          tokenAddress: source.relationships.base_token.data.id.slice("solana_".length),
          pairAddress: source.attributes.address,
          poolCreatedAt: source.attributes.pool_created_at,
          priceUsd: bracketResolutionPrices.get(
            source.relationships.base_token.data.id.slice("solana_".length),
          ),
          liquidityUsd: 22_000,
          marketCapUsd: 10_000,
        })),
        directPairs: [bracketWinner, bracketLoser].map((item) => dexPair({
          ...item,
          priceUsd: bracketResolutionPrices.get(item.tokenAddress),
          liquidityUsd: 22_000,
        })),
      }),
    },
  );
  assert.equal(bracketResolution.observed, 2);
  const bracketScore = buildGeckoTerminalNewPoolBirthBracketScorecard(
    await readLedger(ledgerPath),
  );
  assert.equal(bracketScore.candidateForecasts, 2);
  assert.equal(bracketScore.eligibleCompletePathObservations, 2);
  assert.equal(bracketScore.takeProfitExits, 1);
  assert.equal(bracketScore.stopLossExits, 1);
  assert.deepEqual(
    bracketScore.observationsDetail.map((row) => row.exitSource).sort(),
    ["live-path-stop-loss", "live-path-take-profit"],
  );
  assert.deepEqual(
    bracketScore.observationsDetail.map((row) => row.exitGrossReturnPct).sort((a, b) => a - b),
    [-12, 12],
  );
  assert.equal(bracketScore.provisionalGate, false);

  await assert.rejects(
    registerGeckoTerminalNewPoolFastPath(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const fastPathRegistration = await registerGeckoTerminalNewPoolFastPath(
    { ledgerPath },
    { now: new Date("2026-08-04T15:00:00.000Z") },
  );
  assert.equal(fastPathRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolFastPath(
    { ledgerPath },
    { now: new Date("2026-08-04T15:00:01.000Z") },
  )).status, "existing");
  const fastTokenAddress = "TokenFutureOneMinutePath111111111111111111111";
  const fastPairAddress = "PoolFutureOneMinutePath1111111111111111111111";
  const fastPool = poolRow({
    tokenAddress: fastTokenAddress,
    pairAddress: fastPairAddress,
    poolCreatedAt: "2026-08-04T15:01:00.000Z",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    marketCapUsd: 10_000,
  });
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T15:02:00.000Z"),
      clock: () => new Date("2026-08-04T15:02:00.000Z"),
      fetcher: fakeProvider({ newPoolRows: [fastPool] }),
    },
  );
  const fastCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T15:02:10.000Z"),
      captureClock: () => new Date("2026-08-04T15:02:10.000Z"),
      fetcher: fakeProvider({
        directPairs: [dexPair({
          tokenAddress: fastTokenAddress,
          pairAddress: fastPairAddress,
          priceUsd: 0.0001,
          liquidityUsd: 20_000,
        })],
      }),
    },
  );
  assert.equal(fastCapture.recordedForecasts, 1);
  const firstFastMark = await markOpenGeckoTerminalNewPoolFastPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T15:03:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: fastTokenAddress,
          pairAddress: fastPairAddress,
          poolCreatedAt: fastPool.attributes.pool_created_at,
          priceUsd: 0.000108,
          liquidityUsd: 21_000,
          marketCapUsd: 10_000,
        })],
        directPairs: [dexPair({
          tokenAddress: fastTokenAddress,
          pairAddress: fastPairAddress,
          priceUsd: 0.000108,
          liquidityUsd: 21_000,
        })],
      }),
    },
  );
  assert.equal(firstFastMark.recordedObservations, 1);
  assert.equal(firstFastMark.observations[0].grossReturnFromEntryPct, 8);
  const duplicateFastMark = await markOpenGeckoTerminalNewPoolFastPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T15:03:40.000Z"),
      fetcher: async () => {
        throw new Error("duplicate one-minute bucket must not call providers");
      },
    },
  );
  assert.equal(duplicateFastMark.requestsAttempted, 0);
  assert.equal(duplicateFastMark.recordedObservations, 0);
  const collapsedFastMark = await markOpenGeckoTerminalNewPoolFastPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T15:04:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: fastTokenAddress,
          pairAddress: fastPairAddress,
          poolCreatedAt: fastPool.attributes.pool_created_at,
          priceUsd: 0.00005,
          liquidityUsd: 0,
          marketCapUsd: 10_000,
        })],
        directPairs: [dexPair({
          tokenAddress: fastTokenAddress,
          pairAddress: fastPairAddress,
          priceUsd: 0.00005,
          liquidityUsd: 0,
        })],
      }),
    },
  );
  assert.equal(collapsedFastMark.recordedObservations, 1);
  assert.equal(collapsedFastMark.liquidityCollapses, 1);
  const terminalFastReplay = await markOpenGeckoTerminalNewPoolFastPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T15:05:10.000Z"),
      fetcher: async () => {
        throw new Error("terminal one-minute collapse must not call providers");
      },
    },
  );
  assert.equal(terminalFastReplay.requestsAttempted, 0);
  assert.equal(terminalFastReplay.recordedObservations, 0);

  await assert.rejects(
    registerGeckoTerminalNewPoolFastPathDisagreement(
      { ledgerPath },
      { now: new Date(
        GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE.evidenceBoundary,
      ) },
    ),
    /strictly after its evidence boundary/,
  );
  const disagreementRegistration =
    await registerGeckoTerminalNewPoolFastPathDisagreement(
      { ledgerPath },
      { now: new Date("2026-08-04T15:05:20.000Z") },
    );
  assert.equal(disagreementRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolFastPathDisagreement(
    { ledgerPath },
    { now: new Date("2026-08-04T15:05:21.000Z") },
  )).status, "existing");
  const disagreementTokenAddress = "TokenFutureProviderDisagreement111111111111111";
  const disagreementPairAddress = "PoolFutureProviderDisagreement1111111111111111";
  const disagreementPool = poolRow({
    tokenAddress: disagreementTokenAddress,
    pairAddress: disagreementPairAddress,
    poolCreatedAt: "2026-08-04T15:06:00.000Z",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    marketCapUsd: 10_000,
  });
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T15:07:00.000Z"),
      clock: () => new Date("2026-08-04T15:07:00.000Z"),
      fetcher: fakeProvider({ newPoolRows: [disagreementPool] }),
    },
  );
  const disagreementCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T15:07:10.000Z"),
      captureClock: () => new Date("2026-08-04T15:07:10.000Z"),
      fetcher: fakeProvider({
        directPairs: [dexPair({
          tokenAddress: disagreementTokenAddress,
          pairAddress: disagreementPairAddress,
          priceUsd: 0.0001,
          liquidityUsd: 20_000,
        })],
      }),
    },
  );
  assert.equal(disagreementCapture.recordedForecasts, 1);
  const disagreementMark = await markOpenGeckoTerminalNewPoolFastPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T15:08:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: disagreementTokenAddress,
          pairAddress: disagreementPairAddress,
          poolCreatedAt: disagreementPool.attributes.pool_created_at,
          priceUsd: 0.0002,
          liquidityUsd: 20_000,
          marketCapUsd: 20_000,
        })],
        directPairs: [dexPair({
          tokenAddress: disagreementTokenAddress,
          pairAddress: disagreementPairAddress,
          priceUsd: 0.0001,
          liquidityUsd: 20_000,
        })],
      }),
    },
  );
  assert.equal(disagreementMark.recordedObservations, 0);
  assert.equal(disagreementMark.recordedDiagnostics, 1);
  assert.equal(disagreementMark.diagnostics[0].status, "price-disagreement");
  assert.equal(disagreementMark.diagnostics[0].priceRatio, 2);
  const duplicateDisagreementMark = await markOpenGeckoTerminalNewPoolFastPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T15:08:20.000Z"),
      fetcher: async () => {
        throw new Error("diagnostic must make the bucket idempotent");
      },
    },
  );
  assert.equal(duplicateDisagreementMark.requestsAttempted, 0);
  const disagreementResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T16:07:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [
          poolRow({
            tokenAddress: fastTokenAddress,
            pairAddress: fastPairAddress,
            poolCreatedAt: fastPool.attributes.pool_created_at,
            priceUsd: 0.00005,
            liquidityUsd: 0,
            marketCapUsd: 5_000,
          }),
          poolRow({
            tokenAddress: disagreementTokenAddress,
            pairAddress: disagreementPairAddress,
            poolCreatedAt: disagreementPool.attributes.pool_created_at,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
            marketCapUsd: 20_000,
          }),
        ],
        directPairs: [
          dexPair({
            tokenAddress: fastTokenAddress,
            pairAddress: fastPairAddress,
            priceUsd: 0.00005,
            liquidityUsd: 0,
          }),
          dexPair({
            tokenAddress: disagreementTokenAddress,
            pairAddress: disagreementPairAddress,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
          }),
        ],
      }),
    },
  );
  assert.equal(disagreementResolution.observed, 1);
  assert.equal(disagreementResolution.missed, 1);
  const disagreementEvents = await readLedger(ledgerPath);
  const disagreementScore =
    buildGeckoTerminalNewPoolFastPathDisagreementScorecard(disagreementEvents);
  assert.equal(disagreementScore.futureParentForecasts, 1);
  assert.equal(disagreementScore.diagnosticForecasts, 1);
  assert.equal(disagreementScore.eligibleLiveObservations, 1);
  assert.equal(disagreementScore.independentHourlyFrames, 1);
  assert.equal(disagreementScore.overall.netWinRate, 1);
  assert.equal(disagreementScore.featureSlices.find((slice) => (
    slice.field === "status" && slice.bucket === "price-disagreement"
  )).netWinRate, 1);
  assert.equal(disagreementScore.decisionAuthority, false);
  assert.equal(disagreementScore.promotionAuthority, false);
  assert.equal(disagreementScore.provisionalGate, false);
  const tamperedDisagreement = structuredClone(disagreementEvents);
  tamperedDisagreement.find((event) => (
    event.registrationId === disagreementRegistration.registrationId
      && event.type === "geckoterminal-new-pool-provider-diagnostic"
  )).priceRatio = 1;
  assert.deepEqual(
    buildGeckoTerminalNewPoolFastPathDisagreementScorecard(
      tamperedDisagreement,
    ).rejectionCounts,
    { "diagnostic-value-mismatch": 1 },
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthStandardBracket(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_BRACKET_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const standardBracketRegistration = await registerGeckoTerminalNewPoolBirthStandardBracket(
    { ledgerPath },
    { now: new Date("2026-08-04T16:00:00.000Z") },
  );
  assert.equal(standardBracketRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthStandardBracket(
    { ledgerPath },
    { now: new Date("2026-08-04T16:00:01.000Z") },
  )).status, "existing");
  const standardTokenAddress = "TokenFutureStandardBracket11111111111111111111";
  const standardPairAddress = "PoolFutureStandardBracket111111111111111111111";
  const standardPool = poolRow({
    tokenAddress: standardTokenAddress,
    pairAddress: standardPairAddress,
    poolCreatedAt: "2026-08-04T16:01:00.000Z",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    marketCapUsd: 100_000,
  });
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T16:02:00.000Z"),
      clock: () => new Date("2026-08-04T16:02:00.000Z"),
      fetcher: fakeProvider({ newPoolRows: [standardPool] }),
    },
  );
  const standardCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T16:02:10.000Z"),
      captureClock: () => new Date("2026-08-04T16:02:10.000Z"),
      fetcher: fakeProvider({
        directPairs: [dexPair({
          tokenAddress: standardTokenAddress,
          pairAddress: standardPairAddress,
          priceUsd: 0.0001,
          liquidityUsd: 20_000,
        })],
      }),
    },
  );
  assert.equal(standardCapture.recordedForecasts, 1);
  const standardMark = await markOpenGeckoTerminalNewPoolBirthPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T16:07:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: standardTokenAddress,
          pairAddress: standardPairAddress,
          poolCreatedAt: standardPool.attributes.pool_created_at,
          priceUsd: 0.000112,
          liquidityUsd: 21_000,
          marketCapUsd: 112_000,
        })],
        directPairs: [dexPair({
          tokenAddress: standardTokenAddress,
          pairAddress: standardPairAddress,
          priceUsd: 0.000112,
          liquidityUsd: 21_000,
        })],
      }),
    },
  );
  assert.equal(standardMark.recordedObservations, 1);
  const standardResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T17:02:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: standardTokenAddress,
          pairAddress: standardPairAddress,
          poolCreatedAt: standardPool.attributes.pool_created_at,
          priceUsd: 0.00005,
          liquidityUsd: 15_000,
          marketCapUsd: 50_000,
        })],
        directPairs: [dexPair({
          tokenAddress: standardTokenAddress,
          pairAddress: standardPairAddress,
          priceUsd: 0.00005,
          liquidityUsd: 15_000,
        })],
      }),
    },
  );
  assert.equal(standardResolution.observed, 1);
  const standardBracketScore = buildGeckoTerminalNewPoolBirthStandardBracketScorecard(
    await readLedger(ledgerPath),
  );
  assert.equal(standardBracketScore.candidateForecasts, 1);
  assert.equal(standardBracketScore.eligibleCompletePathObservations, 1);
  assert.equal(standardBracketScore.takeProfitExits, 1);
  assert.equal(standardBracketScore.stopLossExits, 0);
  assert.equal(standardBracketScore.observationsDetail[0].exitGrossReturnPct, 12);
  assert.equal(standardBracketScore.observationsDetail[0].exactOneHourGrossReturnPct, -50);
  assert.ok(standardBracketScore.policyFrameMeanNetReturnPct > 0);
  assert.equal(standardBracketScore.provisionalGate, false);

  await assert.rejects(
    registerGeckoTerminalNewPoolStandardMidPath(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_STANDARD_MID_PATH_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const standardMidRegistration = await registerGeckoTerminalNewPoolStandardMidPath(
    { ledgerPath },
    { now: new Date("2026-08-04T18:00:00.000Z") },
  );
  assert.equal(standardMidRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolStandardMidPath(
    { ledgerPath },
    { now: new Date("2026-08-04T18:00:01.000Z") },
  )).status, "existing");
  const wrongPhaseMidMark = await markOpenGeckoTerminalNewPoolStandardMidPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T18:02:10.000Z"),
      fetcher: async () => {
        throw new Error("wrong standard mid-bucket phase must not call providers");
      },
    },
  );
  assert.equal(wrongPhaseMidMark.requestsAttempted, 0);
  const standardMidTokenAddress = "TokenFutureStandardMidPath111111111111111111";
  const standardMidPairAddress = "PoolFutureStandardMidPath1111111111111111111";
  const standardMidPool = poolRow({
    tokenAddress: standardMidTokenAddress,
    pairAddress: standardMidPairAddress,
    poolCreatedAt: "2026-08-04T18:02:20.000Z",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    marketCapUsd: 100_000,
  });
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T18:02:30.000Z"),
      clock: () => new Date("2026-08-04T18:02:30.000Z"),
      fetcher: fakeProvider({ newPoolRows: [standardMidPool] }),
    },
  );
  const standardMidCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T18:02:40.000Z"),
      captureClock: () => new Date("2026-08-04T18:02:40.000Z"),
      fetcher: fakeProvider({
        directPairs: [dexPair({
          tokenAddress: standardMidTokenAddress,
          pairAddress: standardMidPairAddress,
          priceUsd: 0.0001,
          liquidityUsd: 20_000,
        })],
      }),
    },
  );
  assert.equal(standardMidCapture.recordedForecasts, 1);
  const standardMidMark = await markOpenGeckoTerminalNewPoolStandardMidPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T18:03:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: standardMidTokenAddress,
          pairAddress: standardMidPairAddress,
          poolCreatedAt: standardMidPool.attributes.pool_created_at,
          priceUsd: 0.000088,
          liquidityUsd: 19_000,
          marketCapUsd: 88_000,
        })],
        directPairs: [dexPair({
          tokenAddress: standardMidTokenAddress,
          pairAddress: standardMidPairAddress,
          priceUsd: 0.000088,
          liquidityUsd: 19_000,
        })],
      }),
    },
  );
  assert.equal(standardMidMark.recordedObservations, 1);
  assert.equal(standardMidMark.observations[0].grossReturnFromEntryPct, -12);
  const standardMidEvent = (await readLedger(ledgerPath)).find((event) => (
    event.id === standardMidMark.observations[0].id
  ));
  assert.equal(
    standardMidEvent.fastPathRuleVersion,
    GECKOTERMINAL_NEW_POOL_STANDARD_MID_PATH_RULE.version,
  );
  assert.equal(
    standardMidEvent.observationMode,
    "live-point-in-time-standard-mid-bucket-path",
  );
  const duplicateStandardMid = await markOpenGeckoTerminalNewPoolStandardMidPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T18:03:40.000Z"),
      fetcher: async () => {
        throw new Error("duplicate standard mid-bucket mark must not call providers");
      },
    },
  );
  assert.equal(duplicateStandardMid.requestsAttempted, 0);
  const standardMidResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T19:02:50.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: standardMidTokenAddress,
          pairAddress: standardMidPairAddress,
          poolCreatedAt: standardMidPool.attributes.pool_created_at,
          priceUsd: 0.00009,
          liquidityUsd: 18_000,
          marketCapUsd: 90_000,
        })],
        directPairs: [dexPair({
          tokenAddress: standardMidTokenAddress,
          pairAddress: standardMidPairAddress,
          priceUsd: 0.00009,
          liquidityUsd: 18_000,
        })],
      }),
    },
  );
  assert.equal(standardMidResolution.observed, 1);

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthStandardMidBracket(
      { ledgerPath },
      { now: new Date(
        GECKOTERMINAL_NEW_POOL_BIRTH_STANDARD_MID_BRACKET_RULE.evidenceBoundary,
      ) },
    ),
    /strictly after its evidence boundary/,
  );
  const standardMidBracketRegistration =
    await registerGeckoTerminalNewPoolBirthStandardMidBracket(
      { ledgerPath },
      { now: new Date("2026-08-04T19:03:00.000Z") },
    );
  assert.equal(standardMidBracketRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthStandardMidBracket(
    { ledgerPath },
    { now: new Date("2026-08-04T19:03:01.000Z") },
  )).status, "existing");

  const mixedTokenAddress = "TokenFutureStandardMixedPath11111111111111111";
  const mixedPairAddress = "PoolFutureStandardMixedPath111111111111111111";
  const mixedPool = poolRow({
    tokenAddress: mixedTokenAddress,
    pairAddress: mixedPairAddress,
    poolCreatedAt: "2026-08-04T19:04:00.000Z",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    marketCapUsd: 100_000,
  });
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T19:04:10.000Z"),
      clock: () => new Date("2026-08-04T19:04:10.000Z"),
      fetcher: fakeProvider({ newPoolRows: [mixedPool] }),
    },
  );
  const mixedCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T19:04:20.000Z"),
      captureClock: () => new Date("2026-08-04T19:04:20.000Z"),
      fetcher: fakeProvider({
        directPairs: [dexPair({
          tokenAddress: mixedTokenAddress,
          pairAddress: mixedPairAddress,
          priceUsd: 0.0001,
          liquidityUsd: 20_000,
        })],
      }),
    },
  );
  assert.equal(mixedCapture.recordedForecasts, 1);
  const mixedMidMark = await markOpenGeckoTerminalNewPoolStandardMidPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T19:08:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: mixedTokenAddress,
          pairAddress: mixedPairAddress,
          poolCreatedAt: mixedPool.attributes.pool_created_at,
          priceUsd: 0.000112,
          liquidityUsd: 21_000,
          marketCapUsd: 112_000,
        })],
        directPairs: [dexPair({
          tokenAddress: mixedTokenAddress,
          pairAddress: mixedPairAddress,
          priceUsd: 0.000112,
          liquidityUsd: 21_000,
        })],
      }),
    },
  );
  assert.equal(mixedMidMark.recordedObservations, 1);
  const mixedRegularMark = await markOpenGeckoTerminalNewPoolBirthPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T19:10:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: mixedTokenAddress,
          pairAddress: mixedPairAddress,
          poolCreatedAt: mixedPool.attributes.pool_created_at,
          priceUsd: 0.000088,
          liquidityUsd: 19_000,
          marketCapUsd: 88_000,
        })],
        directPairs: [dexPair({
          tokenAddress: mixedTokenAddress,
          pairAddress: mixedPairAddress,
          priceUsd: 0.000088,
          liquidityUsd: 19_000,
        })],
      }),
    },
  );
  assert.equal(mixedRegularMark.recordedObservations, 1);
  const mixedResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T20:04:30.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: mixedTokenAddress,
          pairAddress: mixedPairAddress,
          poolCreatedAt: mixedPool.attributes.pool_created_at,
          priceUsd: 0.00005,
          liquidityUsd: 15_000,
          marketCapUsd: 50_000,
        })],
        directPairs: [dexPair({
          tokenAddress: mixedTokenAddress,
          pairAddress: mixedPairAddress,
          priceUsd: 0.00005,
          liquidityUsd: 15_000,
        })],
      }),
    },
  );
  assert.equal(mixedResolution.observed, 1);
  const mixedEvents = await readLedger(ledgerPath);
  const parentMixedScore = buildGeckoTerminalNewPoolBirthStandardBracketScorecard(
    mixedEvents,
  );
  const parentMixedObservation = parentMixedScore.observationsDetail.find((row) => (
    row.tokenAddress === mixedTokenAddress
  ));
  assert.equal(parentMixedObservation.exitSource, "live-path-stop-loss");
  assert.equal(parentMixedObservation.exitGrossReturnPct, -12);
  const mixedScore = buildGeckoTerminalNewPoolBirthStandardMidBracketScorecard(mixedEvents);
  assert.equal(mixedScore.candidateForecasts, 1);
  assert.equal(mixedScore.eligibleCompletePathObservations, 1);
  assert.equal(mixedScore.takeProfitExits, 1);
  assert.equal(mixedScore.stopLossExits, 0);
  assert.equal(
    mixedScore.supplementalPathRegistrationId,
    standardMidRegistration.registrationId,
  );
  assert.equal(mixedScore.observationsDetail[0].exitGrossReturnPct, 12);
  assert.equal(mixedScore.observationsDetail[0].exactOneHourGrossReturnPct, -50);
  assert.ok(mixedScore.policyFrameMeanNetReturnPct > parentMixedObservation.policyBaseReturnPct);
  assert.equal(mixedScore.provisionalGate, false);

  const tamperedMixedEvents = structuredClone(mixedEvents);
  const mixedMidEvent = tamperedMixedEvents.find((event) => (
    event.id === mixedMidMark.observations[0].id
  ));
  mixedMidEvent.providerPriceIntegrity.directPriceUsd = 0.0002;
  const tamperedMixedScore = buildGeckoTerminalNewPoolBirthStandardMidBracketScorecard(
    tamperedMixedEvents,
  );
  assert.equal(tamperedMixedScore.takeProfitExits, 0);
  assert.equal(tamperedMixedScore.stopLossExits, 1);
  assert.equal(
    tamperedMixedScore.pathExclusionCounts["invalid-standard-mid-path-provider-integrity"],
    1,
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthFastBracket(
      { ledgerPath },
      { now: new Date(
        GECKOTERMINAL_NEW_POOL_BIRTH_FAST_BRACKET_RULE.evidenceBoundary,
      ) },
    ),
    /strictly after its evidence boundary/,
  );
  const fastBracketRegistration = await registerGeckoTerminalNewPoolBirthFastBracket(
    { ledgerPath },
    { now: new Date("2026-08-04T20:00:00.000Z") },
  );
  assert.equal(fastBracketRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthFastBracket(
    { ledgerPath },
    { now: new Date("2026-08-04T20:00:01.000Z") },
  )).status, "existing");
  const fastBracketTokenAddress = "TokenFutureLowCapFastBracket11111111111111111";
  const fastBracketPairAddress = "PoolFutureLowCapFastBracket111111111111111111";
  const fastBracketPool = poolRow({
    tokenAddress: fastBracketTokenAddress,
    pairAddress: fastBracketPairAddress,
    poolCreatedAt: "2026-08-04T20:01:00.000Z",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    marketCapUsd: 10_000,
  });
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T20:01:05.000Z"),
      clock: () => new Date("2026-08-04T20:01:05.000Z"),
      fetcher: fakeProvider({ newPoolRows: [fastBracketPool] }),
    },
  );
  const fastBracketCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T20:01:10.000Z"),
      captureClock: () => new Date("2026-08-04T20:01:10.000Z"),
      fetcher: fakeProvider({ directPairs: [dexPair({
        tokenAddress: fastBracketTokenAddress,
        pairAddress: fastBracketPairAddress,
        priceUsd: 0.0001,
        liquidityUsd: 20_000,
      })] }),
    },
  );
  assert.equal(fastBracketCapture.recordedForecasts, 1);
  const fastStop = await markOpenGeckoTerminalNewPoolFastPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T20:02:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: fastBracketTokenAddress,
          pairAddress: fastBracketPairAddress,
          poolCreatedAt: fastBracketPool.attributes.pool_created_at,
          priceUsd: 0.000088,
          liquidityUsd: 18_000,
          marketCapUsd: 8_800,
        })],
        directPairs: [dexPair({
          tokenAddress: fastBracketTokenAddress,
          pairAddress: fastBracketPairAddress,
          priceUsd: 0.000088,
          liquidityUsd: 18_000,
        })],
      }),
    },
  );
  assert.equal(fastStop.recordedObservations, 1);
  assert.equal(fastStop.observations[0].grossReturnFromEntryPct, -12);
  const slowStop = await markOpenGeckoTerminalNewPoolBirthPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T20:05:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: fastBracketTokenAddress,
          pairAddress: fastBracketPairAddress,
          poolCreatedAt: fastBracketPool.attributes.pool_created_at,
          priceUsd: 0.00001,
          liquidityUsd: 2_000,
          marketCapUsd: 1_000,
        })],
        directPairs: [dexPair({
          tokenAddress: fastBracketTokenAddress,
          pairAddress: fastBracketPairAddress,
          priceUsd: 0.00001,
          liquidityUsd: 2_000,
        })],
      }),
    },
  );
  assert.equal(slowStop.recordedObservations, 1);
  assert.equal(slowStop.observations[0].grossReturnFromEntryPct, -90);
  const fastBracketResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T21:01:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: fastBracketTokenAddress,
          pairAddress: fastBracketPairAddress,
          poolCreatedAt: fastBracketPool.attributes.pool_created_at,
          priceUsd: 0.00015,
          liquidityUsd: 25_000,
          marketCapUsd: 15_000,
        })],
        directPairs: [dexPair({
          tokenAddress: fastBracketTokenAddress,
          pairAddress: fastBracketPairAddress,
          priceUsd: 0.00015,
          liquidityUsd: 25_000,
        })],
      }),
    },
  );
  assert.equal(fastBracketResolution.observed, 1);
  const fastBracketEvents = await readLedger(ledgerPath);
  const slowBracketScore = buildGeckoTerminalNewPoolBirthBracketScorecard(
    fastBracketEvents,
  );
  const slowBracketObservation = slowBracketScore.observationsDetail.find((row) => (
    row.tokenAddress === fastBracketTokenAddress
  ));
  assert.equal(slowBracketObservation.exitGrossReturnPct, -90);
  const fastBracketScore = buildGeckoTerminalNewPoolBirthFastBracketScorecard(
    fastBracketEvents,
  );
  assert.equal(fastBracketScore.candidateForecasts, 1);
  assert.equal(fastBracketScore.eligibleCompletePathObservations, 1);
  assert.equal(fastBracketScore.stopLossExits, 1);
  assert.equal(fastBracketScore.observationsDetail[0].exitGrossReturnPct, -12);
  assert.ok(fastBracketScore.policyFrameMeanNetReturnPct
    > slowBracketObservation.policyBaseReturnPct);
  assert.equal(fastBracketScore.provisionalGate, false);
  const tamperedFastBracket = structuredClone(fastBracketEvents);
  tamperedFastBracket.find((event) => event.id === fastStop.observations[0].id)
    .providerPriceIntegrity.directPriceUsd = 0.0002;
  const tamperedFastBracketScore = buildGeckoTerminalNewPoolBirthFastBracketScorecard(
    tamperedFastBracket,
  );
  assert.equal(tamperedFastBracketScore.observationsDetail[0].exitGrossReturnPct, -90);
  assert.equal(
    tamperedFastBracketScore.pathExclusionCounts["invalid-fast-path-provider-integrity"],
    1,
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthAttemptCoveredBracket(
      { ledgerPath },
      { now: new Date(
        GECKOTERMINAL_NEW_POOL_BIRTH_ATTEMPT_COVERED_BRACKET_RULE.evidenceBoundary,
      ) },
    ),
    /strictly after its evidence boundary/,
  );
  const attemptCoveredRegistration =
    await registerGeckoTerminalNewPoolBirthAttemptCoveredBracket(
      { ledgerPath },
      { now: new Date("2026-08-04T21:02:00.000Z") },
    );
  assert.equal(attemptCoveredRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthAttemptCoveredBracket(
    { ledgerPath },
    { now: new Date("2026-08-04T21:02:01.000Z") },
  )).status, "existing");

  const attemptTokenAddress = "TokenFutureAttemptCovered111111111111111111111";
  const attemptPairAddress = "PoolFutureAttemptCovered1111111111111111111111";
  const attemptPool = poolRow({
    tokenAddress: attemptTokenAddress,
    pairAddress: attemptPairAddress,
    poolCreatedAt: "2026-08-04T21:03:00.000Z",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    marketCapUsd: 10_000,
  });
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T21:03:05.000Z"),
      clock: () => new Date("2026-08-04T21:03:05.000Z"),
      fetcher: fakeProvider({ newPoolRows: [attemptPool] }),
    },
  );
  const attemptCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T21:03:10.000Z"),
      captureClock: () => new Date("2026-08-04T21:03:10.000Z"),
      fetcher: fakeProvider({ directPairs: [dexPair({
        tokenAddress: attemptTokenAddress,
        pairAddress: attemptPairAddress,
        priceUsd: 0.0001,
        liquidityUsd: 20_000,
      })] }),
    },
  );
  assert.equal(attemptCapture.recordedForecasts, 1);
  for (const observedAt of [
    "2026-08-04T21:04:10.000Z",
    "2026-08-04T21:10:10.000Z",
    "2026-08-04T21:16:10.000Z",
  ]) {
    const disagreement = await markOpenGeckoTerminalNewPoolFastPaths(
      { ledgerPath },
      {
        now: new Date(observedAt),
        fetcher: fakeProvider({
          exactPoolRows: [poolRow({
            tokenAddress: attemptTokenAddress,
            pairAddress: attemptPairAddress,
            poolCreatedAt: attemptPool.attributes.pool_created_at,
            priceUsd: 0.0002,
            liquidityUsd: 22_000,
            marketCapUsd: 20_000,
          })],
          directPairs: [dexPair({
            tokenAddress: attemptTokenAddress,
            pairAddress: attemptPairAddress,
            priceUsd: 0.0001,
            liquidityUsd: 22_000,
          })],
        }),
      },
    );
    assert.equal(disagreement.recordedObservations, 0);
    assert.equal(disagreement.recordedDiagnostics, 1);
    assert.equal(disagreement.diagnostics[0].status, "price-disagreement");
  }
  const attemptExit = await markOpenGeckoTerminalNewPoolFastPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T21:22:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: attemptTokenAddress,
          pairAddress: attemptPairAddress,
          poolCreatedAt: attemptPool.attributes.pool_created_at,
          priceUsd: 0.00012,
          liquidityUsd: 21_000,
          marketCapUsd: 12_000,
        })],
        directPairs: [dexPair({
          tokenAddress: attemptTokenAddress,
          pairAddress: attemptPairAddress,
          priceUsd: 0.00012,
          liquidityUsd: 21_000,
        })],
      }),
    },
  );
  assert.equal(attemptExit.recordedObservations, 1);
  assert.equal(attemptExit.observations[0].grossReturnFromEntryPct, 20);
  const attemptResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T22:03:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: attemptTokenAddress,
          pairAddress: attemptPairAddress,
          poolCreatedAt: attemptPool.attributes.pool_created_at,
          priceUsd: 0.00005,
          liquidityUsd: 15_000,
          marketCapUsd: 5_000,
        })],
        directPairs: [dexPair({
          tokenAddress: attemptTokenAddress,
          pairAddress: attemptPairAddress,
          priceUsd: 0.00005,
          liquidityUsd: 15_000,
        })],
      }),
    },
  );
  assert.equal(attemptResolution.observed, 1);
  const attemptEvents = await readLedger(ledgerPath);
  const priorFastAttemptScore = buildGeckoTerminalNewPoolBirthFastBracketScorecard(
    attemptEvents,
  );
  assert.equal(priorFastAttemptScore.candidateForecasts, 2);
  assert.equal(
    priorFastAttemptScore.pathExclusionCounts["pre-exit-path-start-gap"],
    1,
  );
  const attemptCoveredScore =
    buildGeckoTerminalNewPoolBirthAttemptCoveredBracketScorecard(attemptEvents);
  assert.equal(attemptCoveredScore.candidateForecasts, 1);
  assert.equal(attemptCoveredScore.eligibleCompletePathObservations, 1);
  assert.equal(attemptCoveredScore.takeProfitExits, 1);
  assert.equal(attemptCoveredScore.observationsDetail[0].validCadenceAttempts, 3);
  assert.equal(attemptCoveredScore.observationsDetail[0].exitGrossReturnPct, 20);
  assert.equal(
    attemptCoveredScore.cadenceEvidenceRegistrationId,
    disagreementRegistration.registrationId,
  );
  assert.equal(attemptCoveredScore.provisionalGate, false);

  const tamperedAttemptEvents = structuredClone(attemptEvents);
  tamperedAttemptEvents.find((event) => (
    event.type === "geckoterminal-new-pool-provider-diagnostic"
      && event.tokenAddress === attemptTokenAddress
      && event.observedAt === "2026-08-04T21:10:10.000Z"
  )).priceRatio = 1;
  const tamperedAttemptScore =
    buildGeckoTerminalNewPoolBirthAttemptCoveredBracketScorecard(tamperedAttemptEvents);
  assert.equal(tamperedAttemptScore.eligibleCompletePathObservations, 0);
  assert.equal(
    tamperedAttemptScore.pathExclusionCounts["cadence-diagnostic-value-mismatch"],
    1,
  );
  assert.equal(
    tamperedAttemptScore.pathExclusionCounts["pre-exit-path-cadence-gap"],
    1,
  );
  assert.equal(verifyLedger(await readLedger(ledgerPath)).ok, true);

  console.log("token-edge GeckoTerminal newborn take-profit checks passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}

function poolRow({
  tokenAddress,
  pairAddress,
  poolCreatedAt,
  priceUsd,
  liquidityUsd,
  marketCapUsd,
}) {
  return {
    id: `solana_${pairAddress}`,
    type: "pool",
    attributes: {
      address: pairAddress,
      name: "NEW / SOL",
      pool_created_at: poolCreatedAt,
      base_token_price_usd: String(priceUsd),
      reserve_in_usd: String(liquidityUsd),
      market_cap_usd: String(marketCapUsd),
      fdv_usd: String(marketCapUsd),
      price_change_percentage: { m5: "2", h1: "10", h24: "20" },
      transactions: { m5: { buys: 12, sells: 6 }, h1: { buys: 100, sells: 50 } },
      volume_usd: { m5: "1000", h1: "5000" },
    },
    relationships: {
      base_token: { data: { id: `solana_${tokenAddress}`, type: "token" } },
      quote_token: {
        data: { id: "solana_So11111111111111111111111111111111111111112", type: "token" },
      },
    },
  };
}

function dexPair({ tokenAddress, pairAddress, priceUsd, liquidityUsd }) {
  return {
    chainId: "solana",
    pairAddress,
    baseToken: { address: tokenAddress, symbol: "NEW" },
    quoteToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL" },
    priceUsd: String(priceUsd),
    liquidity: { usd: liquidityUsd },
  };
}

function fakeProvider({ newPoolRows = [], exactPoolRows = [], directPairs = [] }) {
  return async (url) => {
    if (url.includes("/new_pools")) return jsonResponse({ data: newPoolRows });
    if (url.includes("/token-pairs/v1/")) {
      const tokenAddress = decodeURIComponent(url.split("/").at(-1));
      return jsonResponse(directPairs.filter((pair) => pair.baseToken.address === tokenAddress));
    }
    if (url.includes("/pools/")) {
      const pairAddress = decodeURIComponent(url.split("/").at(-1));
      return jsonResponse({
        data: exactPoolRows.find((row) => row.attributes.address === pairAddress) ?? null,
      });
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return structuredClone(payload);
    },
  };
}
