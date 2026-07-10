#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { percentile } from "./lib/standard-memory-benchmark.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--benchmark") args.benchmark = argv[++index];
    else if (argv[index] === "--predictions-dir") args.predictionsDir = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!new Set(["locomo", "longmemeval", "beam"]).has(args.benchmark)) throw new Error("--benchmark must be locomo, longmemeval, or beam");
  if (!args.predictionsDir) throw new Error("--predictions-dir is required");
  return args;
}

function distribution(values) {
  if (!values.length) return { samples: 0, p50: 0, p95: 0, mean: 0 };
  return {
    samples: values.length,
    p50: Math.round(percentile(values, 0.5) * 100) / 100,
    p95: Math.round(percentile(values, 0.95) * 100) / 100,
    mean: Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100,
  };
}

function safeSlug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function expectedEvidenceIds(benchmark, row) {
  if (benchmark === "longmemeval") return (row.answer_session_ids ?? []).map(safeSlug);
  if (benchmark !== "locomo") return [];
  return [...new Set((row.evidence ?? []).map((reference) => {
    const session = String(reference).match(/^D(\d+):/)?.[1];
    return session ? `session-${session}-` : null;
  }).filter(Boolean))];
}

function evidenceRecall(rows, benchmark) {
  const eligible = rows.map((row) => ({ row, expected: expectedEvidenceIds(benchmark, row) })).filter((entry) => entry.expected.length);
  if (!eligible.length) return undefined;
  return Object.fromEntries([1, 3, 10, 20, 50].map((cutoff) => {
    const hits = eligible.filter(({ row, expected }) => expected.some((id) => row.retrieval.search_results.slice(0, cutoff)
      .some((hit) => String(hit.metadata?.note_path ?? "").toLowerCase().includes(id)))).length;
    return [`top${cutoff}`, { hits, eligible: eligible.length, rate: Math.round((hits / eligible.length) * 10_000) / 100 }];
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const directory = resolve(args.predictionsDir);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json") && !name.includes("summary"));
  const rows = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(resolve(directory, file), "utf8"));
    if (parsed.question_id && parsed.benchmark === args.benchmark) rows.push(parsed);
  }
  const scored = rows.filter((row) => row.cutoff_results?.top_50);
  const scores = scored.map((row) => Number(row.cutoff_results.top_50.score));
  const passThreshold = args.benchmark === "beam" ? 0.5 : 1;
  const passed = scores.filter((score) => score >= passThreshold).length;
  const answerInputTokens = scored
    .map((row) => Number(row.cutoff_results.top_50.answerCall?.inputTokens ?? 0))
    .filter((tokens) => tokens > 0);
  const result = {
    schema: "hivemindos.standard-memory-summary.v1",
    benchmark: args.benchmark,
    questionsRetrieved: rows.length,
    questionsScored: scored.length,
    scoreStatus: scored.length === rows.length && rows.length ? "complete" : scored.length ? "partial" : "not-run",
    scorePercent: scores.length ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10_000) / 100 : null,
    passThreshold,
    passed,
    passRatePercent: scores.length ? Math.round((passed / scores.length) * 10_000) / 100 : null,
    retrievalLatencyMs: distribution(rows.map((row) => Number(row.retrieval.search_latency_ms))),
    retrievedHits: distribution(rows.map((row) => Number(row.retrieval.total_results))),
    zeroHitQuestions: rows.filter((row) => Number(row.retrieval.total_results) === 0).length,
    evidenceRecall: evidenceRecall(rows, args.benchmark),
    answerInputTokens: distribution(answerInputTokens),
    tokenUsageStatus: answerInputTokens.length === scored.length ? "reported" : answerInputTokens.length ? "partial" : "unavailable",
    devOnly: true,
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
