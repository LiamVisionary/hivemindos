#!/usr/bin/env node

import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const paper = await import("../src/lib/services/trading/prediction-updown-paper-v2.ts");
const reviewQueue = await import("../src/lib/services/brain-review-queue.ts");

function argumentValue(name) {
  const prefix = `${name}=`;
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1];
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function printUsage() {
  process.stdout.write([
    "Usage: node --import tsx scripts/polymarket-updown-paper-v2.mjs <step|status> [--root PATH] [--historical-root PATH]",
    "",
    "This prospective v2 command reads public Polymarket data and writes only local paper artifacts.",
    "It has no wallet, credential, order-submission, live-trading, commit, push, or deploy path.",
    "Applied Brain Review memories may influence only a newly frozen generation through bounded fields.",
    "New evidence-backed lessons are queued for review and are never auto-approved or auto-applied.",
    "",
  ].join("\n"));
}

function cleanAppliedLearning(proposal) {
  if (proposal?.status !== "applied" || !proposal.appliedMemoryId) return null;
  const lesson = proposal.metadata?.polymarketUpDownV2Learning;
  const suggestedChange = lesson?.suggestedChange;
  if (!suggestedChange || typeof suggestedChange.dimension !== "string") return null;
  return {
    proposalId: proposal.id,
    appliedMemoryId: proposal.appliedMemoryId,
    dimension: suggestedChange.dimension,
    value: suggestedChange.value,
    evidenceGenerationId: typeof lesson.generationId === "string" ? lesson.generationId : undefined,
  };
}

async function readAppliedLearning() {
  const queue = await reviewQueue.readBrainReviewQueue();
  const appliedProposals = queue.proposals
    .filter((proposal) => (
      proposal.status === "applied"
      && proposal.metadata?.polymarketUpDownV2Learning
    ))
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  return {
    learning: appliedProposals.map(cleanAppliedLearning).filter(Boolean),
    latestAppliedMemoryId: appliedProposals.at(-1)?.appliedMemoryId ?? null,
  };
}

const command = process.argv[2] ?? "step";
const root = argumentValue("--root")
  ?? process.env.HIVEMINDOS_UPDOWN_V2_PAPER_ROOT
  ?? paper.UPDOWN_V2_DEFAULT_ROOT;
const historicalRoot = argumentValue("--historical-root")
  ?? process.env.HIVEMINDOS_UPDOWN_PAPER_ROOT;

try {
  if (command === "step") {
    const applied = await readAppliedLearning();
    const result = await paper.runUpDownV2PaperStep({
      root,
      historicalRoot,
      appliedLearning: applied.learning,
      latestAppliedMemoryId: applied.latestAppliedMemoryId,
    });
    let knowledgeReceipt = null;
    if (result.run.knowledgeProposal) {
      try {
        const queued = await reviewQueue.createBrainReviewProposal(result.run.knowledgeProposal);
        knowledgeReceipt = {
          runId: result.run.runId,
          recordedAt: new Date().toISOString(),
          status: queued.deduplicated ? "deduplicated" : "enqueued",
          proposalId: queued.proposal.id,
          error: null,
        };
      } catch (error) {
        knowledgeReceipt = {
          runId: result.run.runId,
          recordedAt: new Date().toISOString(),
          status: "failed",
          proposalId: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await paper.recordUpDownV2KnowledgeReceipt(root, knowledgeReceipt);
    }
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
      review: result.run.review,
      policyContractUpgrade: result.run.policyContractUpgrade,
      negativeEvidence: result.run.negativeEvidence,
      consistentProfit: result.run.consistentProfit,
      knowledgeReceipt,
      summary: paper.summarizeUpDownV2State(result.state),
    }, null, 2)}\n`);
  } else if (command === "status") {
    const result = await paper.readUpDownV2PaperStatus(root);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      root,
      status: result.state.status,
      runs: result.state.runCount,
      lastRunId: result.state.lastRunId,
      activeGenerationId: result.state.activeGenerationId,
      negativeEvidence: result.negativeEvidence,
      consistentProfit: result.report,
      summary: paper.summarizeUpDownV2State(result.state),
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
