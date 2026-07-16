#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tradeIntents = await import("../src/features/dashboard/views/trade/trade-intents.ts");
const quantIntent = tradeIntents.CRYPTO_INTENTS.find((intent) => intent.id === "quant-research");

assert.ok(quantIntent, "Trade must expose the quant research action in its capability matrix");
assert.equal(quantIntent.group, "Read");
assert.equal(quantIntent.input, "quant-research");
assert.equal(quantIntent.mutating, false, "quant research must stay outside money-moving actions");

const manifest = {
  schemaVersion: 1,
  runId: "trade-test-run",
  researchOnly: true,
  liveTradingEnabled: false,
  status: "completed",
  startedAt: "2026-07-14T12:00:00.000Z",
  completedAt: "2026-07-14T12:01:00.000Z",
  graph: { schemaVersion: 1, researchOnly: true, stages: [] },
  candidates: [],
  audits: [],
  promotedCandidateIds: [],
  rejectedCandidateIds: ["weak-signal"],
  manifestPath: "/tmp/trade-test-run/manifest.json",
  reportPath: "/tmp/trade-test-run/report.md",
};

const requests = [];
globalThis.fetch = async (input, init = {}) => {
  requests.push({ input: String(input), init });
  if (init.method === "POST") {
    return Response.json({ ok: true, run: manifest });
  }
  return Response.json({ ok: true, runs: [manifest] });
};

const tradeApi = await import("../src/features/dashboard/views/trade/trade-api.ts");
const listResult = await tradeApi.fetchQuantResearchRuns();
assert.equal(listResult.ok, true);
assert.deepEqual(listResult.runs, [manifest]);
assert.equal(requests[0].input, "/api/quant-research?action=list");
assert.equal(requests[0].init.cache, "no-store");

const reviewedRequest = { schemaVersion: 1, researchOnly: true, dataset: { bars: [] } };
const runResult = await tradeApi.runTradeQuantResearch(reviewedRequest);
assert.equal(runResult.ok, true);
assert.deepEqual(runResult.run, manifest);
assert.equal(requests[1].input, "/api/quant-research");
assert.equal(requests[1].init.method, "POST");
assert.deepEqual(JSON.parse(requests[1].init.body), { action: "run", request: reviewedRequest });

const capabilityRail = await readFile(
  new URL("../src/components/trade/CapabilityRail.tsx", import.meta.url),
  "utf8",
);
const panel = await readFile(
  new URL("../src/components/trade/QuantResearchPanel.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/components/trade/trade-desk.css", import.meta.url),
  "utf8",
);
const runner = await readFile(
  new URL("../src/lib/services/quant-research/runner.ts", import.meta.url),
  "utf8",
);
const tradingDocs = await readFile(
  new URL("../docs/for-users/trading/index.md", import.meta.url),
  "utf8",
);

assert.match(capabilityRail, /<QuantResearchPanel\s*\/>/, "Trade action must open the quant research panel");
assert.match(capabilityRail, /requestAnimationFrame[\s\S]*scrollIntoView/, "opening an action must bring its shorter detail panel into view");
assert.match(panel, /Run reviewed request/, "panel must provide the reviewed JSON run action");
assert.match(panel, /accept="application\/json,.json"/, "run action must use a JSON file picker");
assert.match(panel, /fetchQuantResearchRuns/, "panel must load durable run history");
assert.match(panel, /live trading stays disabled/i, "panel must state the execution boundary");
assert.doesNotMatch(panel, /executeStockTrade|executePreparedRoute|prepareCryptoAction|quoteStockTrade/, "panel must not reach an order or wallet execution helper");
assert.match(styles, /\.tk-quant-runs/, "Trade must style quant run evidence without a new UI dependency");
assert.doesNotMatch(runner, /new URL\("\.\.\/\.\.\/\.\.\/\.\.\/", import\.meta\.url\)/, "Next must not interpret the project root as a directory module import");
assert.match(runner, /resolve\(\s*dirname\(fileURLToPath\(import\.meta\.url\)\),\s*"\.\.\/\.\.\/\.\.\/\.\."\s*,?\s*\)/, "runner must derive its project root without a directory import");
assert.match(tradingDocs, /Run a reviewed quant research request/, "trading docs must describe the Trade action");

console.log("Trade quant research action contract passed.");
