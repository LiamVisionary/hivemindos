#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const temp = await mkdtemp(join(tmpdir(), "hivemindos-trading-control-"));
process.env.HIVEMINDOS_TRADING_CONTROL_PATH = join(temp, "trading-control.json");

try {
  const {
    DEFAULT_TRADING_RISK_POLICY,
    evaluateTradingRisk,
  } = await import("../src/lib/services/trading/trading-risk-policy.ts");
  const {
    approveTradePlan,
    assertTradePlanExecutable,
    assertTradingLiveMode,
    capturePortfolioSnapshot,
    createTradePlan,
    createTradingThesis,
    readTradingControlOverview,
    recordLiveTradePlanResult,
    reconcileObservedPosition,
    rejectTradePlan,
    simulateTradePlan,
    updateTradingControlConfig,
    updateTradingThesis,
    upsertBrokerConnection,
  } = await import("../src/lib/services/trading/trading-control-store.ts");
  const { buildAlpacaOrderPayload } = await import("../src/lib/services/trading/alpaca-order.ts");

  const now = Date.parse("2026-08-05T12:00:00.000Z");
  const baseProposal = {
    accountId: "wallet:test",
    agentId: "agent:test",
    assetClass: "stock",
    asset: "AAPL",
    side: "buy",
    orderType: "limit",
    quantity: 1,
    notionalUsd: 100,
    estimatedPrice: 100,
    limitPrice: 100,
    quote: {
      capturedAt: new Date(now - 5_000).toISOString(),
      slippageBps: 25,
      liquidityUsd: 1_000_000,
      source: "test quote",
    },
    portfolio: {
      totalValueUsd: 1_000,
      currentAssetValueUsd: 0,
      dailyPnlPct: -1,
      drawdownPct: 2,
    },
    leverage: 1,
    source: "trade-ticket",
  };

  const allowed = evaluateTradingRisk({
    proposal: baseProposal,
    policy: { ...DEFAULT_TRADING_RISK_POLICY, cooldownSeconds: 0 },
    executionMode: "live",
    now,
  });
  assert.equal(allowed.decision, "allow");
  assert.ok(allowed.checks.every((check) => check.status !== "block"));

  const unknownExposure = evaluateTradingRisk({
    proposal: { ...baseProposal, portfolio: undefined },
    policy: DEFAULT_TRADING_RISK_POLICY,
    executionMode: "live",
    now,
  });
  assert.equal(unknownExposure.decision, "block", "live trading must fail closed when projected position size cannot be estimated");
  assert.match(unknownExposure.summary, /position size/i);

  const paperUnknownExposure = evaluateTradingRisk({
    proposal: { ...baseProposal, portfolio: undefined },
    policy: DEFAULT_TRADING_RISK_POLICY,
    executionMode: "paper",
    now,
  });
  assert.equal(paperUnknownExposure.decision, "allow", "paper mode may teach through warnings because it cannot move funds");
  assert.ok(paperUnknownExposure.checks.some((check) => check.status === "warn"));

  const stale = evaluateTradingRisk({
    proposal: {
      ...baseProposal,
      quote: { ...baseProposal.quote, capturedAt: new Date(now - 120_000).toISOString() },
    },
    policy: DEFAULT_TRADING_RISK_POLICY,
    executionMode: "live",
    now,
  });
  assert.equal(stale.decision, "block");
  assert.ok(stale.checks.some((check) => check.id === "quote-age" && check.status === "block"));

  const allowlist = evaluateTradingRisk({
    proposal: baseProposal,
    policy: { ...DEFAULT_TRADING_RISK_POLICY, allowedSymbols: ["MSFT"] },
    executionMode: "live",
    now,
  });
  assert.equal(allowlist.decision, "block");
  assert.ok(allowlist.checks.some((check) => check.id === "symbol-allowlist" && check.status === "block"));

  assert.deepEqual(
    buildAlpacaOrderPayload({
      ticker: "AAPL",
      side: "buy",
      notionalUsd: 25,
      orderType: "market",
      timeInForce: "day",
    }),
    { symbol: "AAPL", notional: "25.00", side: "buy", type: "market", time_in_force: "day" },
  );
  assert.deepEqual(
    buildAlpacaOrderPayload({
      ticker: "AAPL",
      side: "buy",
      notionalUsd: 95,
      qty: 1,
      orderType: "stop_limit",
      limitPrice: 95,
      stopPrice: 90,
      timeInForce: "gtc",
    }),
    { symbol: "AAPL", qty: "1", side: "buy", type: "stop_limit", time_in_force: "gtc", limit_price: "95", stop_price: "90" },
  );
  assert.throws(
    () => buildAlpacaOrderPayload({ ticker: "AAPL", side: "buy", notionalUsd: 95, orderType: "limit", timeInForce: "day" }),
    /share quantity/i,
  );

  let overview = await updateTradingControlConfig({
    executionMode: "paper",
    snapshotCadenceMinutes: 60,
    riskPolicy: { ...DEFAULT_TRADING_RISK_POLICY, cooldownSeconds: 0 },
  });
  assert.equal(overview.config.executionMode, "paper");
  await assert.rejects(assertTradingLiveMode(), /global trading mode is paper/i);

  const plan = await createTradePlan({
    title: "Buy one AAPL in practice",
    proposal: baseProposal,
    thesis: "Test the review lifecycle without risking funds.",
    evidence: ["Fixture quote at $100"],
  });
  assert.equal(plan.status, "review");
  assert.equal(plan.executionMode, "paper");
  assert.equal(plan.risk.decision, "allow");

  const approved = await approveTradePlan(plan.id, "Reviewed fixture plan");
  assert.equal(approved.status, "approved");
  const filled = await simulateTradePlan(plan.id, { now: new Date(now).toISOString() });
  assert.equal(filled.status, "filled");
  assert.equal(filled.execution?.kind, "simulation");

  const cryptoBuy = await createTradePlan({
    title: "Buy ETH with virtual cash",
    proposal: {
      ...baseProposal,
      accountId: "wallet:crypto-paper",
      assetClass: "crypto",
      asset: "ETH",
      side: "buy",
      orderType: "market",
      quantity: 0.05,
      notionalUsd: 100,
      estimatedPrice: 2_000,
      limitPrice: undefined,
      fromAsset: "USDC",
      fromQuantity: 100,
    },
  });
  await approveTradePlan(cryptoBuy.id);
  await simulateTradePlan(cryptoBuy.id, { now: new Date(now + 1_000).toISOString() });
  const cryptoSwap = await createTradePlan({
    title: "Swap paper ETH into BTC",
    proposal: {
      ...baseProposal,
      accountId: "wallet:crypto-paper",
      assetClass: "crypto",
      asset: "BTC",
      side: "swap",
      orderType: "market",
      quantity: 0.001,
      estimatedReceiveQuantity: 0.001,
      notionalUsd: 50,
      estimatedPrice: 50_000,
      limitPrice: undefined,
      fromAsset: "ETH",
      fromQuantity: 0.025,
    },
  });
  await approveTradePlan(cryptoSwap.id);
  const swapped = await simulateTradePlan(cryptoSwap.id, { now: new Date(now + 2_000).toISOString() });
  assert.match(swapped.execution?.detail ?? "", /BTC/);

  const rejectedSource = await createTradePlan({
    title: "Reject this draft",
    proposal: { ...baseProposal, asset: "MSFT" },
  });
  const rejected = await rejectTradePlan(rejectedSource.id, "Not part of the current thesis.");
  assert.equal(rejected.status, "rejected");

  await updateTradingControlConfig({ executionMode: "live" });
  await assert.rejects(assertTradingLiveMode(), /requires an approved Trade Plan/i);
  const externalLive = await createTradePlan({
    title: "External governed live report",
    proposal: { ...baseProposal, quote: { ...baseProposal.quote, capturedAt: new Date().toISOString() } },
  });
  await assert.doesNotReject(assertTradingLiveMode({ planId: externalLive.id }));
  await approveTradePlan(externalLive.id);
  await assert.doesNotReject(assertTradePlanExecutable({
    planId: externalLive.id,
    accountId: baseProposal.accountId,
    agentId: baseProposal.agentId,
    asset: baseProposal.asset,
    notionalUsd: 100.2,
    side: baseProposal.side,
    orderType: baseProposal.orderType,
  }));
  await assert.rejects(
    assertTradePlanExecutable({
      planId: externalLive.id,
      accountId: baseProposal.accountId,
      agentId: baseProposal.agentId,
      asset: baseProposal.asset,
      notionalUsd: 100.5,
      side: baseProposal.side,
      orderType: baseProposal.orderType,
    }),
    /slippage bound/i,
  );
  await assert.rejects(
    assertTradePlanExecutable({
      planId: externalLive.id,
      accountId: baseProposal.accountId,
      agentId: baseProposal.agentId,
      asset: baseProposal.asset,
      notionalUsd: baseProposal.notionalUsd,
      side: baseProposal.side,
      orderType: baseProposal.orderType,
      now: Date.parse(externalLive.proposal.quote.capturedAt) + 31_000,
    }),
    /no longer passes risk checks.*quote/i,
  );
  const recordedLive = await recordLiveTradePlanResult({
    planId: externalLive.id,
    execution: { status: "filled", detail: "Fixture venue reported a fill.", reference: "fixture-live-1", filledAt: new Date(now).toISOString() },
  });
  assert.equal(recordedLive.status, "filled");
  await assert.rejects(
    recordLiveTradePlanResult({ planId: externalLive.id, execution: { status: "filled", detail: "Duplicate report" } }),
    /filled; it cannot record/i,
  );
  await updateTradingControlConfig({ executionMode: "paper" });

  const externalSnapshot = await capturePortfolioSnapshot({
    reason: "manual",
    accounts: [{
      accountId: "wallet:test",
      label: "Test wallet",
      provider: "local-wallet",
      custody: "self-custody",
      cashUsd: 900,
      holdings: [{ asset: "AAPL", assetClass: "stock", quantity: 1, marketPrice: 105, marketValueUsd: 105, costBasisUsd: 100 }],
    }],
  });
  assert.equal(externalSnapshot.totalValueUsd, 1_005);
  assert.equal(externalSnapshot.accounts[0].holdings[0].unrealizedPnlUsd, 5);

  const reconciliation = await reconcileObservedPosition({
    accountId: "wallet:test",
    asset: "AAPL",
    assetClass: "stock",
    observedQuantity: 1,
    observedCostBasisUsd: 100,
    trackedQuantity: 1,
    trackedCostBasisUsd: 100,
    source: "fixture-broker",
  });
  assert.equal(reconciliation.status, "matched");

  let thesis = await createTradingThesis({
    title: "AAPL quality compounder",
    asset: "AAPL",
    assetClass: "stock",
    direction: "long",
    conviction: "medium",
    summary: "Margins and services mix remain the core watch.",
    invalidation: "Services growth stalls for two reviews.",
    catalysts: ["Earnings"],
    reviewCadenceDays: 14,
  });
  assert.equal(thesis.status, "watching");
  thesis = await updateTradingThesis(thesis.id, { status: "invalidated", note: "Fixture invalidation" });
  assert.equal(thesis.status, "invalidated");

  const ccxt = await upsertBrokerConnection({
    id: "ccxt:coinbase",
    packId: "ccxt",
    label: "Coinbase public data",
    enabled: true,
    readOnly: true,
    paper: true,
    settings: { exchange: "coinbase" },
  });
  assert.equal(ccxt.readOnly, true);
  assert.equal(ccxt.paper, true);

  const parallel = await Promise.all(Array.from({ length: 8 }, (_, index) => createTradePlan({
    title: `Concurrent plan ${index}`,
    proposal: { ...baseProposal, asset: `T${index}` },
  })));
  assert.equal(new Set(parallel.map((item) => item.id)).size, 8);

  overview = await readTradingControlOverview({ ensureScheduledSnapshot: true, now: new Date(now + 3_600_001).toISOString() });
  assert.ok(overview.plans.length >= 10, "serialized writes must preserve concurrent plans");
  assert.ok(overview.snapshots.length >= 2, "manual/event/scheduled snapshots should be retained");
  assert.equal(overview.simulator.accounts["wallet:test"].positions.AAPL.quantity, 1);
  assert.equal(overview.simulator.accounts["wallet:crypto-paper"].positions.ETH.quantity, 0.025);
  assert.equal(overview.simulator.accounts["wallet:crypto-paper"].positions.BTC.quantity, 0.001);
  assert.ok(overview.events.some((event) => event.kind === "plan.simulated"));
  assert.ok(overview.events.some((event) => event.kind === "snapshot.captured"));
  assert.ok(overview.events.some((event) => event.kind === "thesis.updated"));
  assert.ok(overview.reconciliations.some((item) => item.status === "matched"));

  console.log("Trading control domain tests passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
