#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
process.env.HIVEMINDOS_EMBEDDINGS_URL = "";

const { recallAgentMemory } = await import("../src/lib/services/obsidian/agent-memory/core.ts");

function parseArgs() {
  const args = { calls: 200, json: false, sizes: [100, 500, 1_500] };
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--calls") args.calls = Math.max(50, Number(argv[++index] || args.calls));
    else if (argv[index] === "--sizes") {
      args.sizes = String(argv[++index] || "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value >= 20);
    } else if (argv[index] === "--json") args.json = true;
  }
  assert.ok(args.sizes.length, "Provide at least one integer size of 20 or more.");
  return args;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 0;
}

function rounded(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function makeRecord(index) {
  const serial = String(index).padStart(4, "0");
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index % 60, 0)).toISOString();
  return {
    timestamp,
    action: "remember",
    id: `mem-scale-${serial}`,
    memoryType: "decision",
    title: `Project ${serial} deployment decision`,
    content: `Project ${serial} uses rollout strategy orbit-${serial}, with staged verification before release.`,
    status: "active",
    notePath: `Memory/Distillations/Agent Memory/decision/project-${serial}.md`,
    confidence: 0.9,
    tags: ["deployment", `project-${serial}`],
    project: `project-${serial}`,
    memoryKey: `decision:project-${serial}:deployment`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function queryFor(record, callIndex) {
  const serial = record.id.slice(-4);
  const variants = [
    record.title,
    `what did we decide about project ${serial} deployment`,
    `recall the rollout strategy orbit-${serial}`,
    `please find the current durable deployment context for project-${serial}`,
  ];
  return variants[callIndex % variants.length];
}

async function benchmarkSize(root, size, calls) {
  const vaultPath = join(root, `vault-${size}`);
  const indexPath = join(vaultPath, "Operations", "Brain Services", "Agent Memory Index.jsonl");
  const records = Array.from({ length: size }, (_, index) => makeRecord(index));
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");

  const firstRecord = records[Math.floor(size / 2)];
  const firstStarted = performance.now();
  const first = await recallAgentMemory({
    vaultPath,
    query: queryFor(firstRecord, 0),
    scope: "agent-memory",
    limit: 3,
    trackUsage: false,
  });
  const firstRecallMs = performance.now() - firstStarted;
  assert.equal(first.hits[0]?.id, firstRecord.id, `first recall should find the expected record at size ${size}`);

  const timings = [];
  const ranks = [];
  const measuredStarted = performance.now();
  for (let callIndex = 0; callIndex < calls; callIndex += 1) {
    const record = records[(callIndex * 37) % records.length];
    const started = performance.now();
    const result = await recallAgentMemory({
      vaultPath,
      query: queryFor(record, callIndex),
      scope: "agent-memory",
      limit: 3,
      trackUsage: false,
    });
    timings.push(performance.now() - started);
    ranks.push(result.hits.findIndex((hit) => hit.id === record.id) + 1);
  }
  const elapsedMs = performance.now() - measuredStarted;
  const top1 = ranks.filter((rank) => rank === 1).length / ranks.length;
  const top3 = ranks.filter((rank) => rank > 0 && rank <= 3).length / ranks.length;
  const mrr = ranks.reduce((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / ranks.length;
  assert.equal(top1, 1, `scale benchmark Top-1 should remain perfect at ${size} memories`);

  return {
    memories: size,
    calls,
    firstRecallMs: rounded(firstRecallMs),
    p50Ms: rounded(percentile(timings, 0.5)),
    p95Ms: rounded(percentile(timings, 0.95)),
    queriesPerSecond: rounded((calls / elapsedMs) * 1_000),
    top1: rounded(top1),
    top3: rounded(top3),
    mrr: rounded(mrr),
  };
}

const args = parseArgs();
const root = await mkdtemp(join(tmpdir(), "hivemindos-agent-memory-scale-"));
try {
  const results = [];
  for (const size of args.sizes) results.push(await benchmarkSize(root, size, args.calls));
  if (args.json) {
    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } else {
    console.log("Agent Memory indexed scale benchmark");
    console.log("Synthetic corpus; four exact, natural, sparse, and noisy query forms; local embeddings disabled.");
    for (const result of results) {
      console.log(`- ${result.memories} memories: Top-1/Top-3/MRR ${result.top1.toFixed(2)}/${result.top3.toFixed(2)}/${result.mrr.toFixed(2)}; p50/p95 ${result.p50Ms.toFixed(2)}/${result.p95Ms.toFixed(2)}ms; ${result.queriesPerSecond.toFixed(2)} queries/s; first ${result.firstRecallMs.toFixed(2)}ms`);
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
