#!/usr/bin/env node

import {
  readUpDownPaperStatus,
  runUpDownPaperStep,
  UPDOWN_PAPER_DEFAULT_ROOT,
} from "../src/lib/services/trading/prediction-updown-paper-loop.ts";

function argumentValue(name) {
  const prefix = `${name}=`;
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1];
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function printUsage() {
  process.stdout.write([
    "Usage: node --import tsx scripts/polymarket-updown-paper-loop.mjs <step|status> [--root PATH]",
    "",
    "This command only reads public Polymarket market data and writes local paper artifacts.",
    "It contains no wallet, credential, order-submission, or live-trading path.",
    "",
  ].join("\n"));
}

const command = process.argv[2] ?? "step";
const root = argumentValue("--root") ?? process.env.HIVEMINDOS_UPDOWN_PAPER_ROOT ?? UPDOWN_PAPER_DEFAULT_ROOT;

try {
  if (command === "step") {
    const result = await runUpDownPaperStep({ root });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      root: result.root,
      runId: result.run.runId,
      priorRunId: result.run.priorRunId,
      status: result.state.status,
      snapshots: result.run.snapshotCount,
      settlements: result.run.settledMarketCount,
      fills: result.run.fills.length,
      errors: result.run.errors,
      evolution: result.run.evolution,
      consistentProfit: result.run.consistentProfit,
      reflection: result.run.reflection,
    }, null, 2)}\n`);
  } else if (command === "status") {
    const result = await readUpDownPaperStatus(root);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      root,
      status: result.state.status,
      runs: result.state.runCount,
      lastRunId: result.state.lastRunId,
      activeGenerationId: result.state.activeGenerationId,
      consistentProfit: result.report,
    }, null, 2)}\n`);
  } else if (command === "help" || command === "--help" || command === "-h") {
    printUsage();
  } else {
    printUsage();
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    root,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
}
