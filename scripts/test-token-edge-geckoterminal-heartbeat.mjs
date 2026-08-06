#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  GECKOTERMINAL_HEARTBEAT_PHASES,
  normalizeGeckoTerminalHeartbeatWatchResult,
  runGeckoTerminalHeartbeatPhase,
} from "./token-edge/onchain-geckoterminal-heartbeat.mjs";

assert.equal(normalizeGeckoTerminalHeartbeatWatchResult({
  status: "recorded",
  discoveryEventId: "discovery-1",
}).requestsAttempted, 1);
assert.equal(normalizeGeckoTerminalHeartbeatWatchResult({
  status: "skipped-existing-cadence",
}).requestsAttempted, 0);

assert.deepEqual(
  GECKOTERMINAL_HEARTBEAT_PHASES.map(({ minuteModulo, startSecond }) => ({
    minuteModulo,
    startSecond,
  })),
  [
    { minuteModulo: 0, startSecond: 5 },
    { minuteModulo: 1, startSecond: 20 },
    { minuteModulo: 2, startSecond: 35 },
    { minuteModulo: 3, startSecond: 50 },
    { minuteModulo: 4, startSecond: 0 },
  ],
);

{
  let now = new Date("2026-08-04T19:31:18.000Z");
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => now,
      sleep: async (milliseconds) => {
        now = new Date(now.getTime() + milliseconds);
      },
    }),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.phaseMinuteModulo, 1);
  assert.equal(result.startedAt, "2026-08-04T19:31:20.000Z");
  assert.deepEqual(calls, [
    "resolve-generic",
    "resolve-jupiter",
    "mark-fast-path",
    "watch",
    "capture-forecast-ab",
    "capture-forecast-posts-rescue",
    "capture",
  ]);
}

{
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:30:05.000Z"),
    }),
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, [
    "resolve-generic",
    "resolve-jupiter",
    "resolve-delayed-24h",
    "mark-birth-path",
    "score",
  ]);
}

{
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:33:50.000Z"),
    }),
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, [
    "resolve-generic",
    "resolve-jupiter",
    "resolve-delayed-1h",
    "mark-standard-mid",
    "score",
  ]);
}

{
  let now = new Date("2026-08-04T19:33:49.000Z");
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => now,
      sleep: async () => {
        now = new Date("2026-08-04T19:34:02.000Z");
      },
    }),
  );
  assert.equal(result.status, "skipped-stale-phase");
  assert.deepEqual(calls, []);
}

{
  let now = new Date("2026-08-04T19:33:49.000Z");
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => now,
      sleep: async () => {
        now = new Date("2026-08-04T19:38:50.000Z");
      },
    }),
  );
  assert.equal(result.status, "skipped-stale-phase");
  assert.deepEqual(calls, []);
}

{
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:34:02.000Z"),
    }),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.phaseMinuteModulo, 4);
  assert.deepEqual(calls, ["resolve-generic", "resolve-jupiter", "score"]);
}

{
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:31:30.000Z"),
      dueState: {
        genericDue: 1,
        jupiterDue: 1,
        genericWindowClosesAt: "2026-08-04T19:31:39.000Z",
        jupiterWindowClosesAt: "2026-08-04T19:31:39.000Z",
      },
    }),
  );
  assert.equal(result.status, "exact-window-only");
  assert.deepEqual(calls, ["resolve-jupiter", "resolve-generic"]);
}

{
  const calls = [];
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    heartbeatDependencies({
      calls,
      clock: () => new Date("2026-08-04T19:31:56.000Z"),
      dueState: {
        genericDue: 0,
        jupiterDue: 1,
        genericWindowClosesAt: null,
        jupiterWindowClosesAt: "2026-08-04T19:31:59.000Z",
      },
    }),
  );
  assert.equal(result.status, "exact-window-only-stale-phase");
  assert.deepEqual(calls, ["resolve-jupiter"]);
}

{
  const calls = [];
  const dependencies = heartbeatDependencies({
    calls,
    clock: () => new Date("2026-08-04T19:32:35.000Z"),
  });
  dependencies.actions.resolveGeneric = async () => {
    calls.push("resolve-generic");
    return { requestsAttempted: 0, recordedResolutions: 1 };
  };
  const result = await runGeckoTerminalHeartbeatPhase(
    { ledgerPath: "/tmp/unused-ledger.jsonl" },
    dependencies,
  );
  assert.equal(result.status, "exact-outcome-recorded-lower-priority-skipped");
  assert.deepEqual(calls, ["resolve-generic", "resolve-jupiter"]);
}

console.log("token-edge GeckoTerminal heartbeat phase checks passed.");

function heartbeatDependencies({
  calls,
  clock,
  sleep = async () => {},
  dueState = {
    genericDue: 0,
    jupiterDue: 0,
    genericWindowClosesAt: null,
    jupiterWindowClosesAt: null,
  },
}) {
  const action = (name, result = {}) => async () => {
    calls.push(name);
    return {
      requestsAttempted: 0,
      recordedResolutions: 0,
      ...result,
    };
  };
  return {
    clock,
    sleep,
    inspectDue: async () => dueState,
    actions: {
      resolveGeneric: action("resolve-generic"),
      resolveJupiter: action("resolve-jupiter"),
      markBirthPath: action("mark-birth-path"),
      markFastPath: action("mark-fast-path"),
      watch: action("watch"),
      captureForecastAb: action("capture-forecast-ab"),
      captureForecastPostsRescue: action("capture-forecast-posts-rescue"),
      capture: action("capture"),
      activate: action("activate"),
      resolveDelayedShadow1h: action("resolve-delayed-1h"),
      resolveDelayedShadow24h: action("resolve-delayed-24h"),
      markStandardMid: action("mark-standard-mid"),
      score: action("score"),
    },
  };
}
