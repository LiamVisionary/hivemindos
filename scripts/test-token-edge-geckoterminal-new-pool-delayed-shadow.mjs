#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import {
  registerGeckoTerminalNewPoolActivation,
  watchGeckoTerminalNewPools,
} from "./token-edge/onchain-geckoterminal-new-pool-activation.mjs";
import {
  buildGeckoTerminalNewPoolDelayedShadowScorecard,
  registerGeckoTerminalNewPoolDelayedShadow,
  resolveGeckoTerminalNewPoolDelayedShadows,
} from "./token-edge/onchain-geckoterminal-new-pool-delayed-shadow.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "token-edge-gecko-delayed-shadow-"));
try {
  const ledgerPath = path.join(root, "ledger.jsonl");
  await registerGeckoTerminalNewPoolActivation(
    { ledgerPath },
    { now: new Date("2026-08-04T03:58:30.000Z") },
  );
  await assert.rejects(
    registerGeckoTerminalNewPoolDelayedShadow(
      { ledgerPath, evidenceBoundary: "2026-08-04T04:00:00.000Z" },
      { now: new Date("2026-08-04T04:00:00.000Z") },
    ),
    /strictly after its evidence boundary/,
  );
  const registration = await registerGeckoTerminalNewPoolDelayedShadow(
    { ledgerPath, evidenceBoundary: "2026-08-04T04:00:00.000Z" },
    { now: new Date("2026-08-04T04:00:01.000Z") },
  );
  assert.equal(registration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolDelayedShadow(
    { ledgerPath, evidenceBoundary: "2026-08-04T04:00:00.000Z" },
    { now: new Date("2026-08-04T04:00:02.000Z") },
  )).status, "existing");

  const watchAt = new Date("2026-08-04T04:05:00.000Z");
  const firstBirth = poolRow({
    tokenAddress: "TokenDelayed11111111111111111111111111111",
    pairAddress: "PoolDelayed111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T04:04:00.000Z",
    priceUsd: 0.0001,
    liquidityUsd: 8_000,
  });
  const secondBirth = poolRow({
    tokenAddress: "TokenDelayed22222222222222222222222222222",
    pairAddress: "PoolDelayed222222222222222222222222222222",
    poolCreatedAt: "2026-08-04T04:04:15.000Z",
    priceUsd: 0.0002,
    liquidityUsd: 12_000,
  });
  const watch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: watchAt,
      clock: () => watchAt,
      fetcher: fakeProvider({ newPoolRows: [firstBirth, secondBirth] }),
    },
  );
  assert.equal(watch.watchedCandidates, 2);

  const early = await resolveGeckoTerminalNewPoolDelayedShadows(
    { ledgerPath, horizon: "1h" },
    { now: new Date("2026-08-04T05:04:59.000Z") },
  );
  assert.equal(early.dueCandidates, 0);
  assert.equal(early.requestsAttempted, 0);
  const openScore = buildGeckoTerminalNewPoolDelayedShadowScorecard(
    await readLedger(ledgerPath),
  );
  assert.equal(openScore.prospectiveCandidates, 4);
  assert.equal(openScore.openOutcomes, 4);
  assert.equal(openScore.horizons["1h"].prospectiveCandidates, 2);
  assert.equal(openScore.horizons["1h"].openOutcomes, 2);
  assert.equal(openScore.horizons["24h"].prospectiveCandidates, 2);
  assert.equal(openScore.horizons["24h"].openOutcomes, 2);

  const firstHourRows = [
    poolRow({
      tokenAddress: firstBirth.relationships.base_token.data.id.slice("solana_".length),
      pairAddress: firstBirth.attributes.address,
      poolCreatedAt: firstBirth.attributes.pool_created_at,
      priceUsd: 0.0003,
      liquidityUsd: 10_000,
    }),
    poolRow({
      tokenAddress: secondBirth.relationships.base_token.data.id.slice("solana_".length),
      pairAddress: secondBirth.attributes.address,
      poolCreatedAt: secondBirth.attributes.pool_created_at,
      priceUsd: 0.0001,
      liquidityUsd: 9_000,
    }),
  ];
  const oneHour = await resolveGeckoTerminalNewPoolDelayedShadows(
    { ledgerPath, horizon: "1h" },
    {
      now: new Date("2026-08-04T05:05:30.000Z"),
      clock: () => new Date("2026-08-04T05:05:31.000Z"),
      fetcher: fakeProvider({ multiPoolRows: firstHourRows }),
    },
  );
  assert.equal(oneHour.dueCandidates, 2);
  assert.equal(oneHour.requestsAttempted, 1);
  assert.equal(oneHour.recordedOutcomes, 2);
  assert.equal(oneHour.observedOutcomes, 2);
  assert.equal(oneHour.missedOutcomes, 0);
  assert.deepEqual(oneHour.outcomes.map((event) => event.horizon), ["1h", "1h"]);
  assert.deepEqual(oneHour.outcomes.map((event) => event.grossReturnPct), [200, -50]);
  assert.ok(oneHour.outcomes.every((event) => (
    event.decisionAuthority === false
      && event.promotionAuthority === false
      && event.tradingAuthority === false
      && event.mutationAllowed === false
  )));

  const repeated = await resolveGeckoTerminalNewPoolDelayedShadows(
    { ledgerPath, horizon: "1h" },
    {
      now: new Date("2026-08-04T05:06:00.000Z"),
      fetcher: async () => {
        throw new Error("resolved shadow must not call provider twice");
      },
    },
  );
  assert.equal(repeated.dueCandidates, 0);
  assert.equal(repeated.requestsAttempted, 0);

  const nextDayRows = firstHourRows.map((row, index) => poolRow({
    tokenAddress: row.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: row.attributes.address,
    poolCreatedAt: row.attributes.pool_created_at,
    priceUsd: index === 0 ? 0.0004 : 0.00005,
    liquidityUsd: index === 0 ? 14_000 : 7_000,
  }));
  const oneDay = await resolveGeckoTerminalNewPoolDelayedShadows(
    { ledgerPath, horizon: "24h" },
    {
      now: new Date("2026-08-05T04:05:30.000Z"),
      clock: () => new Date("2026-08-05T04:05:31.000Z"),
      fetcher: fakeProvider({ multiPoolRows: nextDayRows }),
    },
  );
  assert.equal(oneDay.requestsAttempted, 1);
  assert.equal(oneDay.recordedOutcomes, 2);
  assert.deepEqual(oneDay.outcomes.map((event) => event.horizon), ["24h", "24h"]);

  const events = await readLedger(ledgerPath);
  assert.deepEqual(verifyLedger(events), {
    ok: true,
    errors: [],
    eventCount: events.length,
  });
  assert.equal(events.filter((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
  )).length, 4);
  assert.equal(events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      || event.type === "geckoterminal-new-pool-jupiter-executable-decision"
  )).length, 0);
  const score = buildGeckoTerminalNewPoolDelayedShadowScorecard(events);
  assert.equal(score.candidateOutcomes, 4);
  assert.equal(score.observedOutcomes, 4);
  assert.equal(score.missedOutcomes, 0);
  assert.equal(score.prospectiveCandidates, 4);
  assert.equal(score.openOutcomes, 0);
  assert.equal(score.horizons["1h"].observedOutcomes, 2);
  assert.equal(score.horizons["24h"].observedOutcomes, 2);
  assert.equal(score.decisionAuthority, false);
  assert.equal(score.promotionAuthority, false);
  assert.equal(score.tradingAuthority, false);
  assert.equal(score.provisionalGate, false);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("token-edge GeckoTerminal delayed full-cohort shadow checks passed.");

function poolRow({
  tokenAddress,
  pairAddress,
  poolCreatedAt,
  priceUsd,
  liquidityUsd,
}) {
  return {
    id: `solana_${pairAddress}`,
    type: "pool",
    attributes: {
      address: pairAddress,
      name: "DELAYED / SOL",
      pool_created_at: poolCreatedAt,
      base_token_price_usd: String(priceUsd),
      reserve_in_usd: String(liquidityUsd),
      market_cap_usd: "100000",
      price_change_percentage: { m5: "0", h1: "0", h24: "0" },
      volume_usd: { m5: "2000", h1: "2000", h24: "2000" },
      transactions: {
        m5: { buys: 10, sells: 5 },
        h1: { buys: 10, sells: 5 },
      },
    },
    relationships: {
      base_token: { data: { id: `solana_${tokenAddress}` } },
      quote_token: { data: { id: "solana_So11111111111111111111111111111111111111112" } },
    },
  };
}

function fakeProvider({ newPoolRows = [], multiPoolRows = [] }) {
  return async (url) => {
    if (url.includes("/new_pools")) return jsonResponse({ data: newPoolRows });
    if (url.includes("/pools/multi/")) return jsonResponse({ data: multiPoolRows });
    throw new Error(`Unexpected test URL: ${url}`);
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return structuredClone(payload);
    },
  };
}
