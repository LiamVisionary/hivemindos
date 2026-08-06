#!/usr/bin/env node
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const runner = await import("../src/lib/services/penny-stock-paper/runner.ts");
const cadence = await import("../src/lib/services/penny-stock-paper/cadence.ts");

const args = process.argv.slice(2);
const command = args[0] ?? "policy";

try {
  if (command === "policy") {
    print({
      policy: await runner.readPennyPaperPolicy({ runRoot: option("--run-root") }),
      researchOnly: true,
      liveTradingEnabled: false,
      workflow: [
        "monitor (hourly market-hours evidence only)",
        "research",
        "review",
        "after-close (idempotent research, review, outcomes, and evolve)",
        "weekly-audit (read-only accumulated cohorts)",
      ],
    });
  } else if (command === "research") {
    const result = await runner.runPennyStockResearch({
      runRoot: option("--run-root"),
      runId: option("--run-id"),
      asOf: dateOption("--as-of"),
    });
    if (result.status === "skipped") {
      print(result);
      process.exit(0);
    }
    print({
      status: result.status,
      runId: result.runId,
      researchPath: result.researchPath,
      reportPath: result.reportPath,
      candidates: result.artifact.candidates.map((candidate) => ({
        rank: candidate.rank,
        symbol: candidate.symbol,
        score: candidate.score,
        marketCapUsd: candidate.marketCapUsd,
        averageDailyVolume90: candidate.averageDailyVolume90,
        averageDailyDollarVolume90: candidate.averageDailyDollarVolume90,
        limitTouchRatePct: candidate.methodEvidence.limitTouchRatePct,
        bounceRatePct: candidate.methodEvidence.bounceRatePct,
        conservativeEvPct: candidate.conservativeEv.expectedValueLowPctPerOrder,
        status: candidate.vetoed
          ? "veto"
          : candidate.reviewRequired
            ? "review-quarantine"
            : "eligible",
        risks: candidate.risks,
      })),
    });
  } else if (command === "after-close") {
    const result = await runner.runPennyStockAfterClose({
      runRoot: option("--run-root"),
      runId: option("--run-id"),
      asOf: dateOption("--as-of"),
      reviewedBy: option("--reviewed-by"),
    });
    print(result);
  } else if (command === "review") {
    const runId = requiredOption("--run-id");
    const symbolOption = requiredOption("--symbols");
    let symbols;
    if (symbolOption.toLowerCase() === "auto") {
      const result = await runner.listPennyPaperRuns({
        runRoot: option("--run-root"),
      });
      const run = result.find((value) => value.runId === runId);
      if (!run) throw new Error(`Research run ${runId} was not found.`);
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const root = option("--run-root") ?? runner.defaultPennyPaperRoot();
      const research = JSON.parse(await readFile(
        join(root, "runs", runId, "research.json"),
        "utf8",
      ));
      symbols = runner.reasonPennyStockSelection(research);
    } else if (["cash", "none", "0"].includes(symbolOption.toLowerCase())) {
      symbols = [];
    } else {
      symbols = symbolOption.split(",").map((value) => value.trim());
    }
    const result = await runner.reviewPennyStockSelection({
      runId,
      symbols,
      reviewedBy: requiredOption("--reviewed-by"),
      rationale: requiredOption("--rationale"),
      runRoot: option("--run-root"),
    });
    print({ selectionPath: result.path, selection: result.selection });
  } else if (command === "evolve") {
    const manifest = await runner.evolvePennyStockPaperRun({
      runId: requiredOption("--run-id"),
      runRoot: option("--run-root"),
      asOf: dateOption("--as-of"),
    });
    print({ manifest });
  } else if (command === "monitor") {
    const result = await cadence.runPennyStockEvidenceMonitor({
      runRoot: option("--run-root"),
      monitorId: option("--monitor-id"),
      asOf: dateOption("--as-of"),
    });
    print(result.status === "recorded"
      ? {
        status: result.status,
        monitorId: result.monitorId,
        artifactPath: result.artifactPath,
        reportPath: result.reportPath,
        sourceRunId: result.artifact.sourceRunId,
        newEvidenceAvailable: result.artifact.newEvidenceAvailable,
        deepRiskRefreshSymbols: result.artifact.deepRiskRefreshSymbols,
        materialAlerts: result.artifact.materialAlerts,
        policyMutationAllowed: result.artifact.policyMutationAllowed,
      }
      : result);
  } else if (command === "weekly-audit") {
    const result = await cadence.runPennyPaperWeeklyAudit({
      runRoot: option("--run-root"),
      auditId: option("--audit-id"),
      asOf: dateOption("--as-of"),
    });
    print({
      auditId: result.auditId,
      artifactPath: result.artifactPath,
      reportPath: result.reportPath,
      window: result.artifact.window,
      decisions: result.artifact.decisions,
      maturedOutcomes: result.artifact.maturedOutcomes,
      prospectiveEntryLearning: result.artifact.prospectiveEntryLearning,
      readinessGates: result.artifact.readinessGates,
      conclusion: result.artifact.conclusion,
      policyMutationAllowed: result.artifact.policyMutationAllowed,
    });
  } else if (command === "list") {
    print({ runs: await runner.listPennyPaperRuns({ runRoot: option("--run-root") }) });
  } else {
    throw new Error(
      "Usage: penny-stock-paper-lab.mjs policy | monitor [--monitor-id ID] [--as-of ISO] | after-close [--run-id ID] [--as-of ISO] [--reviewed-by NAME] | research [--run-id ID] [--as-of ISO] | review --run-id ID --symbols A,B,C --reviewed-by NAME --rationale TEXT | evolve --run-id ID [--as-of ISO] | weekly-audit [--audit-id ID] [--as-of ISO] | list [--run-root PATH]",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function dateOption(name) {
  const value = option(name);
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a valid ISO date.`);
  return date;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
