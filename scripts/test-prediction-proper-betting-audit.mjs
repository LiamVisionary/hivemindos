import { strict as assert } from "node:assert";

const auditModule = await import("./audit-prediction-proper-betting-ledger.mjs");

const payload = {
  summary: {
    agent: "Fixture forecaster",
    venue: "Fixture exchange",
    starting_capital: 100,
    ending_nav: 104,
    net_pnl: 4,
    roi_pct: 4,
    sharpe_daily: 1,
    max_drawdown_pct: -10,
    forecaster_brier: 0.2,
    market_brier: 0.1,
  },
  trades: [
    {
      ticker: "OPEN-WINNER",
      title: "Open winner",
      action: "BUY",
      side: "YES",
      shares: 10,
      cost: 2,
      fee: 0.1,
      market_position: "open (YES 10@0.20)",
      market_pnl: 3,
    },
    {
      ticker: "SETTLED-LOSS",
      title: "Settled loss",
      action: "BUY",
      side: "NO",
      shares: 5,
      cost: 4,
      fee: 0.1,
      market_position: "settled",
      market_pnl: -4.1,
      market_outcome: "YES",
    },
  ],
};

const audit = auditModule.auditProperBettingLedger(payload, new Map([["OPEN-WINNER", "yes"]]));
assert.equal(audit.reconciliation.tradeRows, 2);
assert.equal(audit.reconciliation.uniqueMarkets, 2);
assert.equal(audit.reconciliation.archivedOpenOutcomes, 1);
assert.equal(audit.reconciliation.finalPnlAfterArchivedOpenSettlementsUsd, 3.8);
assert.equal(audit.reconciliation.finalEndingCapitalUsd, 103.8);
assert.equal(audit.reconciliation.finalRoi, 0.038);
assert.equal(audit.topMarkets[0].ticker, "OPEN-WINNER");
assert.equal(audit.topMarkets[0].finalPnlUsd, 7.9);
assert.match(audit.warnings.join(" "), /worse aggregate forecaster Brier/i);
assert.deepEqual(
  auditModule.parseProperBettingAuditArguments(["--ledger-url", "https://example.com/ledger.json", "--output", "/tmp/a.jsonl"]),
  { ledgerUrl: "https://example.com/ledger.json", outputPath: "/tmp/a.jsonl" },
);

process.stdout.write("Prediction proper-betting ledger audit contracts pass.\n");
