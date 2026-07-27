import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
// Keep the benchmark deterministic and local even when an embeddings provider
// is configured for ordinary recall.
process.env.HIVEMINDOS_EMBEDDINGS_URL = "";

const { answerFromAgentMemory, listAgentMemoryRecords, recallAgentMemory } = await import("../src/lib/services/obsidian/agent-memory/core.ts");
const { selectCanonicalMemoryHeads } = await import("../src/lib/services/obsidian/agent-memory/canonical.ts");
const { queryWordsForRecall } = await import("../src/lib/services/obsidian/agent-memory/query.ts");

const DEFAULT_CALLS = 1_000;
const UNSUPPORTED_QUERIES = [
  "quasar orchid hydraulics treaty ratification",
  "pelican observatory ceramic turbine maintenance",
  "subglacial vineyard payroll reconciliation",
  "martian beekeeping zoning variance",
  "cobalt accordion fisheries quota",
  "volcanic library elevator inspection",
  "neutrino bakery refrigeration permit",
  "coral telescope customs declaration",
  "saturnian canoe insurance deductible",
  "amber submarine pollination schedule",
];

function parseArgs() {
  const args = { calls: DEFAULT_CALLS, json: false, minTop1: null };
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--vault") args.vaultPath = argv[++index];
    else if (arg === "--calls") args.calls = Math.max(100, Number(argv[++index] ?? DEFAULT_CALLS));
    else if (arg === "--min-top1") args.minTop1 = Number(argv[++index]);
    else if (arg === "--json") args.json = true;
  }
  return args;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function rounded(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function retrievalMetrics(rows) {
  if (!rows.length) return { cases: 0, top1: 0, top3: 0, mrr: 0, p50Ms: 0, p95Ms: 0 };
  return {
    cases: rows.length,
    top1: rounded(rows.filter((row) => row.rank === 1).length / rows.length),
    top3: rounded(rows.filter((row) => row.rank > 0 && row.rank <= 3).length / rows.length),
    mrr: rounded(rows.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0) / rows.length),
    p50Ms: rounded(percentile(rows.map((row) => row.ms), 0.5)),
    p95Ms: rounded(percentile(rows.map((row) => row.ms), 0.95)),
  };
}

function titleTerms(record) {
  return [...new Set(queryWordsForRecall(record.title))].filter((term) => term.length >= 4);
}

function sparseTerms(record) {
  const terms = titleTerms(record);
  if (terms.length <= 4) return terms;
  return [...terms.slice(0, 2), ...terms.slice(-2)];
}

function topicTerms(record) {
  return titleTerms(record).slice(0, 8);
}

function typoTerms(record) {
  const terms = sparseTerms(record);
  const longest = terms.reduce((best, term) => term.length > best.length ? term : best, "");
  if (longest.length < 5) return terms;
  const index = Math.floor(longest.length / 2);
  const typo = `${longest.slice(0, index)}${longest.slice(index + 1)}`;
  return terms.map((term) => term === longest ? typo : term);
}

function naturalQuery(record) {
  const topic = topicTerms(record).join(" ");
  if (record.type === "instruction") return `what rule should we follow about ${topic}`;
  if (record.type === "decision") return `what did we decide about ${topic}`;
  if (record.type === "artifact") return `what artifact or proof exists for ${topic}`;
  if (record.type === "preference") return `what preference was recorded about ${topic}`;
  if (record.type === "goal") return `what goal do we have for ${topic}`;
  if (record.type === "commitment") return `what commitment was made about ${topic}`;
  if (record.type === "learning") return `what did we learn about ${topic}`;
  return `what do we currently know about ${topic}`;
}

const VARIANTS = [
  { id: "exact-auto", input: (record) => ({ query: record.title }) },
  { id: "exact-current", input: (record) => ({ query: record.title, temporalMode: "current" }) },
  { id: "sparse-title", input: (record) => ({ query: sparseTerms(record).join(" ") }) },
  { id: "noisy-natural", input: (record) => ({ query: `please recall the current durable context for ${topicTerms(record).join(" ")}` }) },
  { id: "typo", input: (record) => ({ query: typoTerms(record).join(" ") }) },
  { id: "natural-intent", input: (record) => ({ query: naturalQuery(record) }) },
  { id: "type-filtered", input: (record) => ({ query: topicTerms(record).join(" "), type: record.type }) },
  { id: "project-filtered", input: (record) => ({ query: topicTerms(record).join(" "), ...(record.project ? { project: record.project } : {}) }) },
  { id: "tag-filtered", input: (record) => {
    const tag = record.tags.find((value) => !["agent-memory", "evolved", "recently_changed"].includes(value));
    return { query: topicTerms(record).join(" "), ...(tag ? { tags: [tag] } : {}) };
  } },
];

async function timedRecall(input) {
  const started = performance.now();
  const result = await recallAgentMemory({ ...input, scope: "agent-memory", limit: 10, trackUsage: false });
  return { result, ms: performance.now() - started };
}

async function main() {
  const args = parseArgs();
  const listed = await listAgentMemoryRecords({ vaultPath: args.vaultPath });
  const durable = listed.records.filter((record) => record.type !== "action");
  const activeDurable = durable.filter((record) => record.status === "active");
  const canonical = selectCanonicalMemoryHeads(activeDurable);
  const eligible = canonical.records
    .filter((record) => record.status === "active" && titleTerms(record).length >= 2)
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.ok(eligible.length >= 20, `Need at least 20 active canonical memories; found ${eligible.length}.`);

  const rows = [];
  const operationalRows = [];
  const unsupportedRows = [];
  const temporalRows = [];
  let calls = 0;
  const benchmarkStarted = performance.now();

  for (const query of UNSUPPORTED_QUERIES) {
    if (calls >= args.calls) break;
    const started = performance.now();
    const result = await answerFromAgentMemory({ vaultPath: listed.vaultPath, query, scope: "agent-memory", limit: 5, trackUsage: false });
    unsupportedRows.push({ abstained: result.hits.length === 0, ms: performance.now() - started });
    calls += 1;
  }

  const activeOperational = listed.records
    .filter((record) => record.type === "action" && record.status === "active")
    .sort((left, right) => left.id.localeCompare(right.id));
  const operational = activeOperational.slice(0, 20);
  for (const record of operational) {
    if (calls + 2 > args.calls) break;
    const hidden = await timedRecall({ vaultPath: listed.vaultPath, query: record.title });
    operationalRows.push({ mode: "default-hidden", success: !hidden.result.hits.some((hit) => hit.id === record.id), ms: hidden.ms });
    calls += 1;
    const explicit = await timedRecall({ vaultPath: listed.vaultPath, query: record.title, type: "action" });
    const rank = explicit.result.hits.findIndex((hit) => hit.id === record.id) + 1;
    operationalRows.push({ mode: "explicit", success: rank > 0 && rank <= 3, rank, ms: explicit.ms });
    calls += 1;
  }

  const byId = new Map(durable.map((record) => [record.id, record]));
  const evolvedHeads = eligible.filter((record) => (record.supersedes ?? []).some((id) => byId.has(id))).slice(0, 8);
  for (const head of evolvedHeads) {
    const ancestor = (head.supersedes ?? []).map((id) => byId.get(id)).find(Boolean);
    if (!ancestor || calls + 3 > args.calls) continue;
    const equivalentHistoricalIds = (head.supersedes ?? [])
      .map((id) => byId.get(id))
      .filter((record) => record?.title === ancestor.title)
      .map((record) => record.id);
    for (const test of [
      { mode: "current", input: { query: head.title, temporalMode: "current" }, expectedIds: [head.id] },
      { mode: "historical", input: { query: `previously ${ancestor.title}`, temporalMode: "historical" }, expectedIds: equivalentHistoricalIds },
      { mode: "as-of", input: { query: ancestor.title, temporalMode: "as-of", asOf: ancestor.createdAt }, expectedIds: [ancestor.id] },
    ]) {
      const recalled = await timedRecall({ vaultPath: listed.vaultPath, ...test.input });
      const rank = recalled.result.hits.findIndex((hit) => test.expectedIds.includes(hit.id)) + 1;
      temporalRows.push({ mode: test.mode, rank, ms: recalled.ms });
      calls += 1;
    }
  }

  let generatedIndex = 0;
  while (calls < args.calls) {
    const record = eligible[Math.floor(generatedIndex / VARIANTS.length) % eligible.length];
    const variant = VARIANTS[generatedIndex % VARIANTS.length];
    const recalled = await timedRecall({ vaultPath: listed.vaultPath, ...variant.input(record) });
    const rank = recalled.result.hits.findIndex((hit) => hit.id === record.id) + 1;
    rows.push({ variant: variant.id, type: record.type, rank, ms: recalled.ms });
    calls += 1;
    generatedIndex += 1;
  }

  const byVariant = Object.fromEntries(VARIANTS.map((variant) => [variant.id, retrievalMetrics(rows.filter((row) => row.variant === variant.id))]));
  const byType = Object.fromEntries([...new Set(rows.map((row) => row.type))].sort().map((type) => [type, retrievalMetrics(rows.filter((row) => row.type === type))]));
  const result = {
    vaultPath: listed.vaultPath,
    calls,
    elapsedMs: rounded(performance.now() - benchmarkStarted),
    corpus: {
      physicalRecords: listed.records.length,
      durableRecords: durable.length,
      activeDurable: activeDurable.length,
      canonicalHeads: eligible.length,
      canonicalConflicts: canonical.conflicts.length,
      activeLegacyOperational: activeOperational.length,
      operationalRecordsTested: operational.length,
      evolvedHeadsTested: evolvedHeads.length,
    },
    retrieval: retrievalMetrics(rows),
    byVariant,
    byType,
    unsupported: {
      cases: unsupportedRows.length,
      abstained: unsupportedRows.filter((row) => row.abstained).length,
      rate: rounded(unsupportedRows.filter((row) => row.abstained).length / Math.max(1, unsupportedRows.length)),
    },
    operational: {
      cases: operationalRows.length,
      passed: operationalRows.filter((row) => row.success).length,
      rate: rounded(operationalRows.filter((row) => row.success).length / Math.max(1, operationalRows.length)),
    },
    temporal: {
      cases: temporalRows.length,
      top1: rounded(temporalRows.filter((row) => row.rank === 1).length / Math.max(1, temporalRows.length)),
      top3: rounded(temporalRows.filter((row) => row.rank > 0 && row.rank <= 3).length / Math.max(1, temporalRows.length)),
      byMode: Object.fromEntries(["current", "historical", "as-of"].map((mode) => [mode, retrievalMetrics(temporalRows.filter((row) => row.mode === mode))])),
    },
  };
  result.queriesPerSecond = rounded((result.calls / result.elapsedMs) * 1_000);

  if (args.minTop1 !== null) assert.ok(result.retrieval.top1 >= args.minTop1, `Top-1 ${result.retrieval.top1} is below ${args.minTop1}.`);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log("Agent Memory live recall benchmark");
  console.log(`Calls: ${result.calls}; physical records: ${result.corpus.physicalRecords}; canonical heads: ${result.corpus.canonicalHeads}`);
  console.log(`Sequential throughput: ${result.queriesPerSecond.toFixed(2)} queries/s over ${result.elapsedMs.toFixed(2)}ms`);
  console.log(`Generated retrieval Top-1/Top-3/MRR: ${result.retrieval.top1.toFixed(2)} / ${result.retrieval.top3.toFixed(2)} / ${result.retrieval.mrr.toFixed(2)}; p50/p95 ${result.retrieval.p50Ms.toFixed(2)}/${result.retrieval.p95Ms.toFixed(2)}ms`);
  console.log(`Unsupported abstention: ${result.unsupported.abstained}/${result.unsupported.cases}; operational routing: ${result.operational.passed}/${result.operational.cases}; temporal Top-1/Top-3: ${result.temporal.top1.toFixed(2)}/${result.temporal.top3.toFixed(2)}`);
  for (const [variant, metrics] of Object.entries(result.byVariant)) {
    console.log(`- ${variant}: Top-1/Top-3 ${metrics.top1.toFixed(2)}/${metrics.top3.toFixed(2)} (${metrics.cases} cases)`);
  }
}

await main();
